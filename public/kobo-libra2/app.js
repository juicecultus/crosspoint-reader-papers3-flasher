// app.js - the page's own wiring. Everything that decides anything lives in
// lib/; this file reads the profile, draws what those decisions say, and drives
// the cable.
//
// Two rules it keeps throughout:
//
//   Nothing is sent to the device that has not been checked against a sha256
//   from the release manifest.
//
//   Nothing is written to the device unless the bootloader answered the board
//   revision and the panel and both matched. A bootloader that will not answer
//   is a refusal.

import { FastbootDevice, FastbootError, browserSupport } from './lib/fastboot.js';
import { parseManifest, planArtefacts, checkDownloadSize } from './lib/manifest.js';
import { parseProfile, gateIdentity, getvarNames } from './lib/profile.js';
import { fetchManifestText, fetchArtefact, manifestUrl, resolveArtefactUrl, ReleaseError } from './lib/release.js';

const $ = (id) => document.getElementById(id);

const state = {
	profile: null,
	manifest: null,
	device: null,
	getvars: {},
	gate: { live: null, install: null },
	busy: false,
};

// --- small drawing helpers ---------------------------------------------------

function verdict(el, kind, ...lines) {
	el.className = `verdict ${kind}`;
	el.replaceChildren(...lines.map((line) => {
		const p = document.createElement('p');
		if (line instanceof Node) {
			p.append(line);
		} else {
			p.textContent = line;
		}
		return p;
	}));
	el.hidden = false;
}

function bytes(n) {
	if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
	if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
	return `${n} bytes`;
}

function log(text, kind) {
	const el = $('log');
	const line = document.createElement('span');
	line.textContent = `${text}\n`;
	if (kind) line.className = `line-${kind}`;
	el.append(line);
	el.scrollTop = el.scrollHeight;
}

function phase(text) {
	$('phase').textContent = text;
}

function bar(done, total, label) {
	const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
	$('bar-fill').style.width = `${pct}%`;
	$('bar-label').textContent = label || (total > 0 ? `${bytes(done)} of ${bytes(total)}` : '');
}

function showProgress() {
	$('step-progress').hidden = false;
	$('step-progress').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- step 1: the browser -----------------------------------------------------

function checkBrowser() {
	const support = browserSupport(navigator, window.isSecureContext);
	if (support.ok) {
		verdict($('browser-verdict'), 'good',
			'This browser can do it. Chrome or Edge on a computer, on a secure connection, with WebUSB.');
		return true;
	}
	verdict($('browser-verdict'), 'bad', ...support.reasons);
	$('connect').disabled = true;
	return false;
}

// --- the device profile ------------------------------------------------------

// The page is served from a path on einkhub.com rather than from the root of a
// site of its own, so the files this module fetches are resolved against this
// module's own URL. That is the whole of the base path: move the directory and
// nothing in here needs an edit.
const asset = (name) => new URL(name, import.meta.url).href;

async function loadProfile() {
	const index = await (await fetch(asset('devices/index.json'), { cache: 'no-cache' })).json();
	const entry = index.devices.find((d) => d.status === 'supported');
	if (!entry) {
		throw new Error('devices/index.json lists no supported device.');
	}
	const raw = await (await fetch(asset(entry.profile), { cache: 'no-cache' })).json();
	return parseProfile(raw);
}

function drawEntrySteps(profile) {
	$('entry-steps').replaceChildren(...profile.entry.steps.map((text) => {
		const li = document.createElement('li');
		li.textContent = text;
		return li;
	}));
	$('entry-warnings').replaceChildren(...profile.entry.warnings.map((text) => {
		const p = document.createElement('p');
		p.textContent = text;
		return p;
	}));
}

function drawFinish(profile) {
	$('finish-title').textContent = profile.finish.title;
	$('finish-steps').replaceChildren(...profile.finish.steps.map((text) => {
		const li = document.createElement('li');
		li.textContent = text;
		return li;
	}));
	$('finish-expect').textContent = profile.finish.expect;
}

// --- step 2: the release -----------------------------------------------------

async function loadRelease(profile) {
	const el = $('release-verdict');
	let text;
	try {
		text = await fetchManifestText(manifestUrl(profile));
	} catch (err) {
		if (err instanceof ReleaseError && err.message === 'NO_RELEASE') {
			verdict(el, 'waiting',
				'There is no published release yet, so there is nothing for this page to send.',
				"InkHub runs on hardware today and the code is public. What is not published is a downloadable image, and the reason is in the repository: the panel waveform inside the image belongs to E Ink and is not this project's to redistribute. Until the image reads that file off your own device instead of carrying a copy, there is nothing here to hand you.",
				'Everything else on this page is finished and waiting for that release.');
			return null;
		}
		verdict(el, 'bad', err.message, err.detail || '');
		return null;
	}

	let manifest;
	try {
		manifest = parseManifest(text);
	} catch (err) {
		verdict(el, 'bad',
			'The release manifest could not be read, so nothing will be sent to any device.',
			err.message);
		return null;
	}

	verdict(el, 'good', `InkHub ${manifest.version}, build ${manifest.build}.`);

	const facts = $('release-facts');
	const rows = [
		['version', manifest.version],
		['build', String(manifest.build)],
	];
	if (manifest.commit) rows.push(['commit', manifest.commit]);
	if (manifest.date) rows.push(['published', manifest.date]);
	facts.replaceChildren(...rows.flatMap(([k, v]) => {
		const dt = document.createElement('dt');
		dt.textContent = k;
		const dd = document.createElement('dd');
		dd.textContent = v;
		return [dt, dd];
	}));
	facts.hidden = false;

	if (manifest.notes) {
		const notes = $('release-notes');
		const p = document.createElement('p');
		p.textContent = manifest.notes;
		notes.replaceChildren(p);
		if (manifest.notesUrl) {
			const a = document.createElement('a');
			a.href = manifest.notesUrl;
			a.textContent = 'The full release notes.';
			const wrap = document.createElement('p');
			wrap.append(a);
			notes.append(wrap);
		}
		notes.hidden = false;
	}

	return manifest;
}

// --- step 4: connect and gate ------------------------------------------------

const STATE_WORDS = {
	pass: 'matches',
	fail: 'refused',
	declined: 'not answered',
	noted: 'noted',
};

function drawGate(result) {
	const tbody = $('gate-table').querySelector('tbody');
	tbody.replaceChildren(...result.checks.map((check) => {
		const tr = document.createElement('tr');
		const th = document.createElement('th');
		th.scope = 'row';
		th.textContent = check.label;
		const expected = document.createElement('td');
		expected.className = 'value';
		expected.textContent = check.expected === null ? 'anything' : check.expected;
		const actual = document.createElement('td');
		actual.className = 'value';
		actual.textContent = check.actual === null ? (check.detail || 'no answer') : check.actual;
		const state = document.createElement('td');
		state.className = `state-${check.state}`;
		state.textContent = STATE_WORDS[check.state];
		tr.append(th, expected, actual, state);
		return tr;
	}));
	$('gate-table').hidden = false;
}

async function connect() {
	const el = $('connect-verdict');
	let usbDevice;
	try {
		usbDevice = await navigator.usb.requestDevice({
			filters: FastbootDevice.filters(state.profile),
		});
	} catch (err) {
		verdict(el, 'waiting',
			'No device was picked. If the picker was empty, the Libra 2 is not in fastboot yet: power it fully off and try step 3 again.',
			err.message);
		return;
	}

	const fb = new FastbootDevice(usbDevice);
	try {
		await fb.open(state.profile);
	} catch (err) {
		verdict(el, 'bad', err.message, err.detail || '');
		return;
	}

	state.device = fb;

	// Ask for everything the profile names, once. A refusal is an answer and is
	// recorded as one.
	const answers = {};
	for (const name of getvarNames(state.profile)) {
		answers[name] = await fb.tryGetvar(name);
	}
	state.getvars = answers;

	const live = gateIdentity(state.profile, 'live', fb.description, answers);
	const install = gateIdentity(state.profile, 'install', fb.description, answers);
	state.gate = { live, install };
	drawGate(install);

	const notes = $('gate-notes');
	const paragraphs = [];

	if (!live.ok) {
		verdict(el, 'bad',
			'This is not a Kobo Libra 2 running the bootloader this software was built against, so this page will not send it anything.',
			live.failed.map((c) => c.label).join(', ') + ' did not match.');
		$('step-choose').hidden = true;
		return;
	}

	verdict(el, 'good', 'Connected. The bootloader answered and this is a Libra 2.');

	if (install.ok) {
		paragraphs.push('Every check an install needs was answered and matched.');
	} else {
		const names = install.failed.map((c) => c.label).join(', ');
		paragraphs.push(
			`Install is not offered: ${names} did not match or was not answered. Trying InkHub Live is still safe, because it writes nothing and the image checks the board on the device before it starts anything.`,
		);
	}
	if (install.declined.length > 0 || live.declined.length > 0) {
		paragraphs.push(
			'A check shown as not answered is a variable this bootloader declines to report. That is expected for some of them and it is why an install refuses when the board revision is one of them.',
		);
	}

	notes.replaceChildren(...paragraphs.map((text) => {
		const p = document.createElement('p');
		p.textContent = text;
		return p;
	}));
	notes.hidden = paragraphs.length === 0;

	offerActions();
}

// --- step 5: what is on offer ------------------------------------------------

function offerActions() {
	$('step-choose').hidden = false;

	const canDo = (action) => {
		if (!state.manifest) {
			return { ok: false, why: 'There is no release to send.' };
		}
		if (!state.gate[action] || !state.gate[action].ok) {
			return { ok: false, why: 'The identity checks this needs did not pass.' };
		}
		let plan;
		try {
			plan = planArtefacts(state.profile, state.manifest, action);
		} catch (err) {
			return { ok: false, why: err.message };
		}
		if (!plan.ok) {
			const names = plan.missing.map((m) => `${m.label} (${m.asset})`).join(', ');
			return { ok: false, why: `This release does not carry ${names}, so this page cannot do it.` };
		}
		return { ok: true, plan };
	};

	const liveCan = canDo('live');
	$('do-live').disabled = !liveCan.ok;
	$('live-unavailable').textContent = liveCan.ok ? '' : liveCan.why;
	$('live-unavailable').hidden = liveCan.ok;

	const installCan = canDo('install');
	$('install-confirm').hidden = !installCan.ok;
	$('install-unavailable').textContent = installCan.ok ? '' : installCan.why;
	$('install-unavailable').hidden = installCan.ok;
	$('do-install').disabled = true;

	state.plans = { live: liveCan.plan || null, install: installCan.plan || null };
}

function watchConfirm() {
	$('install-typed').addEventListener('input', (event) => {
		const typed = event.target.value.trim().toLowerCase();
		const plan = state.plans && state.plans.install;
		$('do-install').disabled = !(plan && typed === 'install');
	});
}

// --- sending -----------------------------------------------------------------

async function getBytes(artefact) {
	const url = resolveArtefactUrl(state.profile, artefact.url);
	log(`fetching ${artefact.label} from ${url}`);
	const data = await fetchArtefact({ ...artefact, url }, (p) => {
		if (p.phase === 'download') {
			phase(`Downloading ${artefact.label}`);
			bar(p.done, p.total);
		} else {
			phase(`Unpacking ${artefact.label}`);
			bar(p.done, p.total);
		}
	});
	log(`checksum matches, ${bytes(data.length)} ready`, 'good');
	return data;
}

async function sendDownload(artefact, data) {
	const max = state.getvars['max-download-size'];
	checkDownloadSize(data.length, max && max.value ? max.value : '');
	phase(`Sending ${artefact.label} to the device`);
	log(`download: ${data.length} bytes`);
	await state.device.download(data, (done, total) => bar(done, total));
	log('the device took every byte', 'good');
}

async function runLive() {
	if (state.busy) return;
	state.busy = true;
	$('do-live').disabled = true;
	$('do-install').disabled = true;
	showProgress();

	try {
		const artefact = state.plans.live.present[0];
		const data = await getBytes(artefact);
		await sendDownload(artefact, data);

		phase('Starting InkHub from memory');
		log('boot');
		await state.device.boot((info) => log(`device: ${info.trim()}`));
		log('the device left fastboot to run the image', 'good');

		bar(1, 1, 'done');
		phase('InkHub is starting on the device. Nothing was written to it.');

		drawLiveFinish();
	} catch (err) {
		failed(err);
	} finally {
		state.busy = false;
	}
}

async function runInstall() {
	if (state.busy) return;
	state.busy = true;
	$('do-live').disabled = true;
	$('do-install').disabled = true;
	showProgress();

	const byName = Object.fromEntries(state.plans.install.present.map((a) => [a.name, a]));
	const steps = state.profile.actions.install.writes;

	try {
		log("The order below is the runbook's, and it is not arbitrary: the longest");
		log('transfer happens while every raw slot is still the one Kobo shipped, and');
		log('the sector the bootloader checks on every boot is written last.');
		log('');

		for (const step of steps) {
			const artefact = byName[step.artefact];
			if (!artefact) {
				throw new Error(`${step.label}: the release does not carry it.`);
			}
			const data = await getBytes(artefact);
			await sendDownload(artefact, data);

			if (step.via === 'fastboot-flash') {
				phase(`Writing ${step.label}`);
				log(`flash:${step.target}`);
				await state.device.flash(step.target, (info) => log(`device: ${info.trim()}`));
				log(`${step.label} written`, 'good');
				log('this channel cannot read it back; the finisher does that on the device');
			} else if (step.via === 'fastboot-boot') {
				phase('Starting the finisher on the device');
				log('boot');
				await state.device.boot((info) => log(`device: ${info.trim()}`));
				log('the finisher is running on the device', 'good');
			} else {
				throw new Error(`Unknown step type ${step.via}.`);
			}
			log('');
		}

		bar(1, 1, 'done');
		phase('Every payload is on the device. The finisher is writing the last sector and checking the rest.');
		drawInstallFinish();
	} catch (err) {
		failed(err);
	} finally {
		state.busy = false;
	}
}

function failed(err) {
	const message = err instanceof FastbootError || err instanceof ReleaseError
		? err.message
		: `${err.name}: ${err.message}`;
	log(message, 'bad');
	if (err.detail) log(err.detail, 'bad');
	phase('It stopped here.');
	verdict($('connect-verdict'), 'bad',
		message,
		'Nothing further was sent. Unplug the cable, power the device off by holding the power button, and start again from step 3.');
	$('connect-verdict').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function drawLiveFinish() {
	const section = $('step-finish');
	$('finish-title').textContent = 'Watch the screen';
	$('finish-steps').replaceChildren(...[
		'Nothing shows for the first few seconds while the kernel unpacks the system.',
		'By about twenty seconds, the InkHub splash: the name on a white screen.',
		'By about a minute, the home screen: the status bar, the app tiles, and the version along the bottom.',
		'If the screen has not changed after two and a half minutes, hold the power button for about ten seconds. That is the end of the session and nothing was written.',
	].map((text) => {
		const li = document.createElement('li');
		li.textContent = text;
		return li;
	}));
	$('finish-expect').textContent = "To end a live session at any point, hold the power button until the device goes off, then power it on normally. It comes back on Kobo's own firmware, untouched.";
	section.hidden = false;
	section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function drawInstallFinish() {
	drawFinish(state.profile);
	const section = $('step-finish');
	const first = document.createElement('li');
	first.textContent = 'Wait for the finisher to report on the screen. It reads the three slots back, writes the last sector, and says whether every read-back matched. If it says a read-back did not match, do not power-cycle: read what it says and use the factory restore.';
	$('finish-steps').prepend(first);
	section.hidden = false;
	section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- start -------------------------------------------------------------------

async function main() {
	const usable = checkBrowser();

	try {
		state.profile = await loadProfile();
	} catch (err) {
		verdict($('release-verdict'), 'bad', `The device profile could not be loaded: ${err.message}`);
		return;
	}

	drawEntrySteps(state.profile);
	drawFinish(state.profile);

	state.manifest = await loadRelease(state.profile);

	if (!usable) return;

	$('connect').addEventListener('click', () => {
		connect().catch((err) => failed(err));
	});
	$('do-live').addEventListener('click', () => runLive());
	$('do-install').addEventListener('click', () => runInstall());
	watchConfirm();
}

main();
