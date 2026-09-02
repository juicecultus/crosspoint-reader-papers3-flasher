// profile.js - the device profile, and the gate that decides whether this
// browser is allowed to write to the thing on the other end of the cable.
//
// One profile per device, in devices/. Adding a device is adding a file there
// and a line in devices/index.json; nothing in this module knows about the
// Libra 2.
//
// The gate is deliberately per action. Two facts make that the honest shape:
//
//   Try InkHub Live writes nothing at all, and the image it boots runs the
//   project's own hwcfg gate before it starts anything, so a payload that lands
//   on the wrong board refuses on the board itself and says so in its report.
//
//   Install writes to partitions and raw sectors, and nothing whatsoever checks
//   the board before those writes land. So an install refuses unless the
//   bootloader answers the board revision and the panel, and matches. A
//   bootloader that will not answer is a refusal, not a shrug.
//
// No DOM, no USB. Pure functions over plain objects so tests/profile.test.js
// can drive every verdict from node.

export class ProfileError extends Error {
	constructor(message) {
		super(message);
		this.name = 'ProfileError';
	}
}

function must(condition, message) {
	if (!condition) {
		throw new ProfileError(message);
	}
}

function isPlainObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ACTIONS = ['live', 'install'];

export function parseProfile(raw) {
	must(isPlainObject(raw), 'profile: the top level must be an object');
	must(raw.schema === 1, `profile: schema must be 1, got ${JSON.stringify(raw.schema)}`);
	must(typeof raw.id === 'string' && raw.id.length > 0, 'profile: id must be a string');
	must(typeof raw.name === 'string' && raw.name.length > 0, 'profile: name must be a string');

	must(isPlainObject(raw.usb), 'profile: usb must be an object');
	for (const field of ['vendorId', 'productId', 'interfaceClass', 'interfaceSubclass', 'interfaceProtocol']) {
		must(
			typeof raw.usb[field] === 'number' && Number.isInteger(raw.usb[field]) && raw.usb[field] >= 0,
			`profile: usb.${field} must be a whole number`,
		);
	}

	must(Array.isArray(raw.checks) && raw.checks.length > 0, 'profile: checks must be a non-empty array');
	const seen = new Set();
	for (const check of raw.checks) {
		must(isPlainObject(check), 'profile: every check must be an object');
		must(typeof check.id === 'string' && check.id.length > 0, 'profile: every check needs an id');
		must(!seen.has(check.id), `profile: two checks share the id ${check.id}`);
		seen.add(check.id);
		must(
			check.source === 'usb' || check.source === 'getvar',
			`profile: check ${check.id}: source must be usb or getvar`,
		);
		if (check.source === 'getvar') {
			must(
				typeof check.name === 'string' && check.name.length > 0,
				`profile: check ${check.id}: a getvar check needs a name`,
			);
		}
		must(Array.isArray(check.requiredFor), `profile: check ${check.id}: requiredFor must be an array`);
		for (const action of check.requiredFor) {
			must(ACTIONS.includes(action), `profile: check ${check.id}: unknown action ${action}`);
		}
	}

	must(isPlainObject(raw.artefacts), 'profile: artefacts must be an object');
	const keys = new Set();
	for (const [name, artefact] of Object.entries(raw.artefacts)) {
		must(isPlainObject(artefact), `profile: artefact ${name} must be an object`);
		must(
			typeof artefact.key === 'string' && artefact.key.length > 0,
			`profile: artefact ${name} needs the manifest key its fields are named with`,
		);
		must(!keys.has(artefact.key), `profile: two artefacts share the manifest key ${artefact.key}`);
		keys.add(artefact.key);
		must(Array.isArray(artefact.required), `profile: artefact ${name}: required must be an array`);
		for (const action of artefact.required) {
			must(ACTIONS.includes(action), `profile: artefact ${name}: unknown action ${action}`);
		}
	}

	must(isPlainObject(raw.actions), 'profile: actions must be an object');

	return raw;
}

// The getvar names the page should ask for, in profile order and without
// repeats. serialno is in here and is never gated on: it goes in the log so a
// support conversation has something to name the device by.
export function getvarNames(profile) {
	const names = [];
	for (const check of profile.checks) {
		if (check.source === 'getvar' && !names.includes(check.name)) {
			names.push(check.name);
		}
	}
	return names;
}

function usbActual(device, usb) {
	const parts = [
		`${hex4(device.vendorId)}:${hex4(device.productId)}`,
	];
	if (device.manufacturerName) {
		parts.push(device.manufacturerName);
	}
	if (device.productName) {
		parts.push(device.productName);
	}
	if (device.interfaceClass !== undefined) {
		parts.push(`interface ${device.interfaceClass}/${device.interfaceSubclass}/${device.interfaceProtocol}`);
	}
	void usb;
	return parts.join(', ');
}

function hex4(n) {
	if (typeof n !== 'number') {
		return String(n);
	}
	return `0x${n.toString(16).padStart(4, '0')}`;
}

function usbMatches(device, usb) {
	if (device.vendorId !== usb.vendorId || device.productId !== usb.productId) {
		return false;
	}
	// The interface fields are only present once an interface has been chosen.
	// Before that the check runs on the ids alone, which is what Chrome's own
	// device picker filtered on.
	if (device.interfaceClass === undefined) {
		return true;
	}
	return (
		device.interfaceClass === usb.interfaceClass
		&& device.interfaceSubclass === usb.interfaceSubclass
		&& device.interfaceProtocol === usb.interfaceProtocol
	);
}

// Normalising a getvar answer before comparing it. The device answers
// max-download-size as "0x19000000" and hwcfg.PCB as "101", and a bootloader
// that answered "0X19000000" or " 101" would be the same bootloader. Numbers
// compare as numbers when both sides read as numbers, and as trimmed lowercase
// strings otherwise. Nothing here coerces a mismatch into a match.
function sameValue(expected, actual) {
	const a = String(expected).trim().toLowerCase();
	const b = String(actual).trim().toLowerCase();
	if (a === b) {
		return true;
	}
	const na = numberOf(a);
	const nb = numberOf(b);
	return na !== null && nb !== null && na === nb;
}

function numberOf(text) {
	if (/^0x[0-9a-f]+$/.test(text)) {
		return Number.parseInt(text.slice(2), 16);
	}
	if (/^[0-9]+$/.test(text)) {
		return Number.parseInt(text, 10);
	}
	return null;
}

// gateIdentity(profile, action, device, getvars) -> verdict
//
//   device   { vendorId, productId, manufacturerName, productName,
//              interfaceClass, interfaceSubclass, interfaceProtocol }
//   getvars  { name: { value } } for an answer, { error } for a refusal, and
//            absent for a variable that was never asked
//
// Every check comes back as one of:
//
//   pass      it answered and it matched
//   fail      it answered and it did not match, or it is required and the
//             bootloader would not answer it
//   declined  the bootloader would not answer it and this action does not
//             require it
//   noted     it answered and there is nothing to compare it against
//
// ok is true only when nothing failed. There is no third state and no override.
export function gateIdentity(profile, action, device, getvars) {
	must(ACTIONS.includes(action), `gate: unknown action ${action}`);
	must(isPlainObject(device), 'gate: device must be an object');
	must(isPlainObject(getvars), 'gate: getvars must be an object');

	const checks = [];

	for (const check of profile.checks) {
		const required = check.requiredFor.includes(action);
		const row = {
			id: check.id,
			label: check.label || check.name || check.id,
			expected: check.expect === undefined || check.expect === null ? null : String(check.expect),
			required,
			why: check.why || null,
			actual: null,
			state: 'fail',
			detail: null,
		};

		if (check.source === 'usb') {
			row.actual = usbActual(device, profile.usb);
			if (usbMatches(device, profile.usb)) {
				row.state = 'pass';
			} else {
				row.state = 'fail';
				row.detail = 'This is not the USB identity the Libra 2 bootloader reports.';
			}
			checks.push(row);
			continue;
		}

		const answer = getvars[check.name];
		if (!answer || (answer.value === undefined && !answer.error)) {
			row.state = required ? 'fail' : 'declined';
			row.detail = 'not asked';
			checks.push(row);
			continue;
		}
		if (answer.error) {
			row.state = required ? 'fail' : 'declined';
			row.detail = answer.error;
			checks.push(row);
			continue;
		}

		row.actual = String(answer.value);
		if (row.expected === null) {
			row.state = 'noted';
			checks.push(row);
			continue;
		}
		row.state = sameValue(row.expected, row.actual) ? 'pass' : 'fail';
		checks.push(row);
	}

	const failed = checks.filter((c) => c.state === 'fail');
	const declined = checks.filter((c) => c.state === 'declined');

	return {
		action,
		ok: failed.length === 0,
		checks,
		failed,
		declined,
	};
}
