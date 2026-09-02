// fastboot.js - the fastboot protocol over WebUSB, for this bootloader.
//
// Why this file exists rather than a library. The Android web flashers use
// kdrag0n's fastboot.js, which is written for phones: it splits images into
// sparse chunks, it asks the device about slots, and it assumes a bootloader
// that answers the standard variable set. This bootloader is a Freescale
// U-Boot with nine commands and six variables, it answers
// "FAILVariable not implemented" to almost every getvar a phone flasher asks,
// and every payload here fits under its 400 MiB download buffer in one shot,
// so there is nothing for the sparse writer to do. Against that, a library
// loaded from a CDN into a page that writes to somebody's e-reader is a third
// party with a write channel to a stranger's device.
//
// So: the protocol, from the specification, in about two hundred lines, with
// nothing in it this device does not use. docs/web-installer-survey.md section
// 3 is the argument in full.
//
// The protocol. A command is an ASCII string of at most 64 bytes on the bulk
// OUT endpoint. Every reply is a packet on the bulk IN endpoint whose first
// four bytes are one of INFO, DATA, OKAY or FAIL, and whose remainder is the
// message. INFO repeats until OKAY or FAIL ends the exchange.

const MAX_COMMAND_BYTES = 64;
const CHUNK_BYTES = 1024 * 1024; // a multiple of the 512 byte OUT packet
const REPLY_BYTES = 64;
const DEFAULT_TIMEOUT_MS = 30000;
const BOOT_TIMEOUT_MS = 60000;

export class FastbootError extends Error {
	constructor(message, detail) {
		super(message);
		this.name = 'FastbootError';
		this.detail = detail || null;
	}
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function withTimeout(promise, ms, what) {
	let timer;
	const timeout = new Promise((_resolve, reject) => {
		timer = setTimeout(() => {
			reject(new FastbootError(
				`The device stopped answering during ${what}. Unplug the cable, power the device off by holding power, and start again.`,
			));
		}, ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class FastbootDevice {
	constructor(device) {
		this.device = device;
		this.interfaceNumber = null;
		this.endpointIn = null;
		this.endpointOut = null;
		this.outPacketSize = 512;
	}

	// The filters Chrome's own device picker uses. A user who has no Libra 2 in
	// fastboot sees an empty picker rather than a list of their webcams.
	static filters(profile) {
		return [{ vendorId: profile.usb.vendorId, productId: profile.usb.productId }];
	}

	get description() {
		const d = this.device;
		return {
			vendorId: d.vendorId,
			productId: d.productId,
			manufacturerName: d.manufacturerName || null,
			productName: d.productName || null,
			serialNumber: d.serialNumber || null,
			interfaceClass: this.interfaceClass ?? undefined,
			interfaceSubclass: this.interfaceSubclass ?? undefined,
			interfaceProtocol: this.interfaceProtocol ?? undefined,
		};
	}

	async open(profile) {
		await this.device.open();
		if (this.device.configuration === null) {
			await this.device.selectConfiguration(1);
		}

		const usb = profile.usb;
		let found = null;
		for (const iface of this.device.configuration.interfaces) {
			for (const alt of iface.alternates) {
				if (
					alt.interfaceClass === usb.interfaceClass
					&& alt.interfaceSubclass === usb.interfaceSubclass
					&& alt.interfaceProtocol === usb.interfaceProtocol
				) {
					found = { iface, alt };
					break;
				}
			}
			if (found) break;
		}
		if (!found) {
			throw new FastbootError(
				'This device answered, but it has no fastboot interface. It is not in fastboot, or it is not a Libra 2.',
			);
		}

		this.interfaceClass = found.alt.interfaceClass;
		this.interfaceSubclass = found.alt.interfaceSubclass;
		this.interfaceProtocol = found.alt.interfaceProtocol;
		this.interfaceNumber = found.iface.interfaceNumber;

		for (const ep of found.alt.endpoints) {
			if (ep.direction === 'in' && ep.type === 'bulk') this.endpointIn = ep.endpointNumber;
			if (ep.direction === 'out' && ep.type === 'bulk') {
				this.endpointOut = ep.endpointNumber;
				this.outPacketSize = ep.packetSize || 512;
			}
		}
		if (this.endpointIn === null || this.endpointOut === null) {
			throw new FastbootError('The fastboot interface has no bulk endpoint pair.');
		}

		try {
			await this.device.claimInterface(this.interfaceNumber);
		} catch (err) {
			throw new FastbootError(
				'The browser could not claim the device. On Windows the fastboot interface needs the WinUSB driver; on Linux it needs a udev rule. The runbook has both.',
				err.message,
			);
		}
	}

	async close() {
		try {
			if (this.interfaceNumber !== null) {
				await this.device.releaseInterface(this.interfaceNumber);
			}
		} catch (err) {
			// A device that has already rebooted out of fastboot cannot release
			// an interface, and that is the expected end of a boot or an install.
			void err;
		}
		try {
			await this.device.close();
		} catch (err) {
			void err;
		}
	}

	async _write(bytes, timeoutMs) {
		const result = await withTimeout(
			this.device.transferOut(this.endpointOut, bytes),
			timeoutMs || DEFAULT_TIMEOUT_MS,
			'a write to the device',
		);
		if (result.status !== 'ok') {
			throw new FastbootError(`The device rejected a write (${result.status}).`);
		}
		return result.bytesWritten;
	}

	async _readPacket(timeoutMs) {
		const result = await withTimeout(
			this.device.transferIn(this.endpointIn, REPLY_BYTES),
			timeoutMs || DEFAULT_TIMEOUT_MS,
			'a read from the device',
		);
		if (result.status !== 'ok') {
			throw new FastbootError(`The device rejected a read (${result.status}).`);
		}
		return decoder.decode(result.data);
	}

	// Reads replies until one of them ends the exchange. INFO lines are handed
	// to onInfo as the bootloader emits them, which is how a long flash says
	// anything at all while it runs.
	async _readReply(onInfo, timeoutMs) {
		for (;;) {
			const packet = await this._readPacket(timeoutMs);
			const status = packet.slice(0, 4);
			const payload = packet.slice(4);
			if (status === 'INFO') {
				if (onInfo) onInfo(payload);
				continue;
			}
			if (status === 'OKAY' || status === 'FAIL' || status === 'DATA') {
				return { status, payload };
			}
			throw new FastbootError(
				`The device answered something this page does not understand: ${JSON.stringify(packet)}`,
			);
		}
	}

	async command(text, options) {
		const opts = options || {};
		const bytes = encoder.encode(text);
		if (bytes.length > MAX_COMMAND_BYTES) {
			throw new FastbootError(`Command longer than ${MAX_COMMAND_BYTES} bytes: ${text}`);
		}
		await this._write(bytes, opts.timeoutMs);
		return this._readReply(opts.onInfo, opts.timeoutMs);
	}

	// getvar, refusing on FAIL. Use tryGetvar where a refusal is information
	// rather than an error, which is most of the identity gate.
	async getvar(name) {
		const reply = await this.command(`getvar:${name}`);
		if (reply.status !== 'OKAY') {
			throw new FastbootError(`getvar ${name}: ${reply.payload || 'refused'}`);
		}
		return reply.payload;
	}

	async tryGetvar(name) {
		try {
			const reply = await this.command(`getvar:${name}`);
			if (reply.status === 'OKAY') {
				return { value: reply.payload };
			}
			return { error: reply.payload || 'refused' };
		} catch (err) {
			return { error: err.message };
		}
	}

	// download:%08x, then exactly that many bytes, then the device's OKAY.
	//
	// The bytes go out in one megabyte slices so that progress can be reported
	// and so that no single transferOut has to hold the whole image. Every slice
	// but the last is a multiple of the OUT packet size, so the bootloader never
	// sees a short packet before the end.
	async download(bytes, onProgress) {
		const size = bytes.byteLength;
		const header = `download:${size.toString(16).padStart(8, '0')}`;
		const reply = await this.command(header);
		if (reply.status !== 'DATA') {
			throw new FastbootError(`The device refused the download: ${reply.status}${reply.payload}`);
		}
		const agreed = Number.parseInt(reply.payload.trim(), 16);
		if (agreed !== size) {
			throw new FastbootError(
				`The device agreed to ${agreed} bytes when this page offered ${size}.`,
			);
		}

		let sent = 0;
		while (sent < size) {
			const end = Math.min(sent + CHUNK_BYTES, size);
			await this._write(bytes.subarray(sent, end), 60000);
			sent = end;
			if (onProgress) onProgress(sent, size);
		}

		const done = await this._readReply(null, 120000);
		if (done.status !== 'OKAY') {
			throw new FastbootError(`The device refused the transferred bytes: ${done.payload}`);
		}
	}

	// flash writes what was downloaded to a named target. This bootloader
	// registers raw sector ranges (mbr, sn, bootloader, hwcfg, ntxfw, dtb,
	// bootenv, kernel, waveform, logo) and the three MBR partitions (rootfs,
	// recoveryfs, vfat). There is no read command, so nothing written here can
	// be read back from the browser.
	async flash(target, onInfo) {
		const reply = await this.command(`flash:${target}`, { onInfo, timeoutMs: 300000 });
		if (reply.status !== 'OKAY') {
			throw new FastbootError(`flash ${target} failed: ${reply.payload || 'refused'}`);
		}
	}

	// boot runs what was downloaded from RAM. The device answers OKAY and then
	// stops being a fastboot device, so the USB connection goes away underneath
	// us; that disappearance is success, not a fault.
	async boot(onInfo) {
		try {
			const reply = await this.command('boot', { onInfo, timeoutMs: BOOT_TIMEOUT_MS });
			if (reply.status !== 'OKAY') {
				throw new FastbootError(`boot failed: ${reply.payload || 'refused'}`);
			}
		} catch (err) {
			if (err instanceof FastbootError) throw err;
			// A USB error here is the device leaving fastboot to run the image,
			// which is what was asked for.
			return;
		}
	}
}

// Whether this browser can do any of it, and one sentence per reason it cannot.
export function browserSupport(nav, isSecureContext) {
	const reasons = [];
	const ua = (nav && nav.userAgent) || '';
	const usb = nav && nav.usb;

	if (!isSecureContext) {
		reasons.push('This page is not on a secure connection, and WebUSB only works over https.');
	}
	if (!usb) {
		if (/Firefox\//.test(ua)) {
			reasons.push('Firefox does not implement WebUSB. Use Google Chrome or Microsoft Edge on a desktop computer.');
		} else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) {
			reasons.push('Safari does not implement WebUSB. Use Google Chrome or Microsoft Edge on a desktop computer.');
		} else {
			reasons.push('This browser does not have WebUSB. Use Google Chrome or Microsoft Edge on a desktop computer.');
		}
	}
	if (usb && /Android/.test(ua)) {
		reasons.push('Chrome on Android has WebUSB, but flashing wants a cable to a computer and a screen you can read while it runs. Use a desktop computer.');
	}
	if (typeof DecompressionStream === 'undefined') {
		reasons.push('This browser cannot decompress the system image (it has no DecompressionStream).');
	}
	if (!(globalThis.crypto && globalThis.crypto.subtle)) {
		reasons.push('This browser cannot check the download against its checksum (it has no Web Crypto).');
	}

	return { ok: reasons.length === 0, reasons };
}
