// web/installer/tests/run.js - the browser installer's own tests.
//
//   node web/installer/tests/run.js
//
// No dependencies, no network, no device, no browser. It drives the two pure
// modules the installer's decisions live in - the manifest parser and the
// identity gate - plus the real device profile in devices/, so a profile edited
// into a shape the gate cannot read fails here rather than on somebody's
// e-reader.
//
// It prints one line per assertion and exits non-zero if any failed, which is
// the shape tests/lib.sh uses, so the output reads the same as the rest of the
// suite. It is not wired into ./test.sh: this round was allowed to change web/
// and two documents, and tests/ is neither. docs/web-installer.md records the
// wiring as the one outstanding piece.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseManifest, readArtefact, planArtefacts, checkDownloadSize, ManifestError } from '../lib/manifest.js';
import { parseProfile, gateIdentity, getvarNames, ProfileError } from '../lib/profile.js';

const here = dirname(fileURLToPath(import.meta.url));
const profilePath = join(here, '..', 'devices', 'kobo-libra2.json');

// The page is served from /kobo-libra2 on einkhub.com, out of public/ in the
// site's repository, and the release proxy is a route handler in that same
// repository rather than the standalone site's api/dl.js. siteRoot is where
// those two files are.
const siteRoot = join(here, '..', '..', '..');
const routeHandler = join('src', 'app', 'dl', '[asset]', 'route.ts');

let passed = 0;
let failed = 0;

function pass(name) {
	passed += 1;
	console.log(`    ok    ${name}`);
}

function fail(name, detail) {
	failed += 1;
	console.log(`    FAIL  ${name}${detail ? `: ${detail}` : ''}`);
}

function heading(text) {
	console.log(`\n  ${text}`);
}

function assertEq(name, expected, actual) {
	if (expected === actual) {
		pass(name);
	} else {
		fail(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

function assertTrue(name, value) {
	if (value === true) {
		pass(name);
	} else {
		fail(name, `expected true, got ${JSON.stringify(value)}`);
	}
}

function assertThrows(name, fn, wantSubstring) {
	try {
		fn();
	} catch (err) {
		if (!wantSubstring || err.message.includes(wantSubstring)) {
			pass(name);
		} else {
			fail(name, `threw "${err.message}", wanted it to mention "${wantSubstring}"`);
		}
		return;
	}
	fail(name, 'did not throw');
}

// --- the real device profile -------------------------------------------------

heading('the Kobo Libra 2 profile');

const profileText = readFileSync(profilePath, 'utf8');
let profile = null;
try {
	profile = parseProfile(JSON.parse(profileText));
	pass('devices/kobo-libra2.json parses and passes the schema');
} catch (err) {
	fail('devices/kobo-libra2.json parses and passes the schema', err.message);
}

if (profile) {
	assertEq('vendor id is 0x18d1', 0x18d1, profile.usb.vendorId);
	assertEq('product id is 0x0d02', 0x0d02, profile.usb.productId);
	assertEq('interface class is 0xff', 0xff, profile.usb.interfaceClass);
	assertEq('interface subclass is 0x42', 0x42, profile.usb.interfaceSubclass);
	assertEq('interface protocol is 0x03', 0x03, profile.usb.interfaceProtocol);

	// The board revision is the row docs/second-device.md marks must match
	// exactly, and it is the one thing standing between a fastboot write and
	// the wrong hardware. If it ever stops being required for an install, this
	// assertion is where that is noticed.
	const pcb = profile.checks.find((c) => c.id === 'hwcfg-pcb');
	assertTrue('the board revision check exists', Boolean(pcb));
	if (pcb) {
		assertEq('the board revision expected is 101', '101', String(pcb.expect));
		assertTrue('an install requires the board revision', pcb.requiredFor.includes('install'));
	}

	const names = getvarNames(profile);
	assertTrue('the getvar list asks for hwcfg.PCB', names.includes('hwcfg.PCB'));
	assertTrue('the getvar list asks for max-download-size', names.includes('max-download-size'));
	assertTrue(
		'the getvar list does not ask for product, which this bootloader refuses',
		!names.includes('product'),
	);
	assertTrue(
		'the getvar list does not ask for serial, which this bootloader refuses',
		!names.includes('serial'),
	);
	assertEq('no getvar name is asked twice', names.length, new Set(names).size);
}

// --- the profile schema refuses a broken profile ------------------------------

heading('the profile schema');

assertThrows('a profile with no schema is refused', () => parseProfile({}), 'schema');
assertThrows(
	'a profile with a future schema is refused',
	() => parseProfile({ schema: 2, id: 'x', name: 'x' }),
	'schema must be 1',
);
assertThrows(
	'a profile with two checks sharing an id is refused',
	() => parseProfile({
		schema: 1,
		id: 'x',
		name: 'x',
		usb: { vendorId: 1, productId: 2, interfaceClass: 3, interfaceSubclass: 4, interfaceProtocol: 5 },
		checks: [
			{ id: 'a', source: 'usb', requiredFor: [] },
			{ id: 'a', source: 'usb', requiredFor: [] },
		],
		artefacts: {},
		actions: {},
	}),
	'share the id',
);
assertThrows(
	'a check naming an action that does not exist is refused',
	() => parseProfile({
		schema: 1,
		id: 'x',
		name: 'x',
		usb: { vendorId: 1, productId: 2, interfaceClass: 3, interfaceSubclass: 4, interfaceProtocol: 5 },
		checks: [{ id: 'a', source: 'usb', requiredFor: ['reflash'] }],
		artefacts: {},
		actions: {},
	}),
	'unknown action',
);
assertTrue('ProfileError is the error type', new ProfileError('x') instanceof Error);

// --- the identity gate --------------------------------------------------------

heading('the identity gate');

const libra2 = {
	vendorId: 0x18d1,
	productId: 0x0d02,
	manufacturerName: 'FSL',
	productName: 'USB download gadget',
	interfaceClass: 0xff,
	interfaceSubclass: 0x42,
	interfaceProtocol: 0x03,
};

const answersGood = {
	version: { value: '0.4' },
	'max-download-size': { value: '0x19000000' },
	'hwcfg.PCB': { value: '101' },
	'hwcfg.DisplayResolution': { value: '16' },
	serialno: { value: '80311141234567890' },
};

// The bootloader's own refusal wording, from the field session of 2026-08-30.
const declined = { error: 'Variable not implemented' };

if (profile) {
	const good = gateIdentity(profile, 'install', libra2, answersGood);
	assertTrue('a Libra 2 answering everything passes the install gate', good.ok);
	assertEq('nothing was declined', 0, good.declined.length);
	assertEq(
		'the serial is noted and not gated on',
		'noted',
		good.checks.find((c) => c.id === 'serialno').state,
	);

	const wrongBoard = gateIdentity(profile, 'install', libra2, {
		...answersGood,
		'hwcfg.PCB': { value: '49' },
	});
	assertTrue('a different board revision fails the install gate', wrongBoard.ok === false);
	assertEq('and it is the board revision that failed', 'hwcfg-pcb', wrongBoard.failed[0].id);

	const wrongPanel = gateIdentity(profile, 'install', libra2, {
		...answersGood,
		'hwcfg.DisplayResolution': { value: '17' },
	});
	assertTrue('a different panel fails the install gate', wrongPanel.ok === false);

	// The decisive one. A bootloader that will not say what board it is on is a
	// bootloader this page will not write to.
	const silentInstall = gateIdentity(profile, 'install', libra2, {
		...answersGood,
		'hwcfg.PCB': declined,
	});
	assertTrue('a bootloader that refuses hwcfg.PCB fails the install gate', silentInstall.ok === false);
	assertEq(
		'and the refusal is recorded as a failure, not a shrug',
		'fail',
		silentInstall.checks.find((c) => c.id === 'hwcfg-pcb').state,
	);

	// Live writes nothing and the image carries its own board gate, so the same
	// silence is survivable there and is reported rather than hidden.
	const silentLive = gateIdentity(profile, 'live', libra2, {
		...answersGood,
		'hwcfg.PCB': declined,
	});
	assertTrue('the same silence still allows InkHub Live', silentLive.ok);
	assertEq(
		'and Live records it as declined so the page can say so',
		'declined',
		silentLive.checks.find((c) => c.id === 'hwcfg-pcb').state,
	);

	const notALibra = gateIdentity(
		profile,
		'live',
		{ ...libra2, vendorId: 0x1234, productId: 0x5678 },
		answersGood,
	);
	assertTrue('a device with other USB ids fails even the Live gate', notALibra.ok === false);

	const wrongInterface = gateIdentity(
		profile,
		'live',
		{ ...libra2, interfaceClass: 0x08, interfaceSubclass: 0x06, interfaceProtocol: 0x50 },
		answersGood,
	);
	assertTrue('a mass-storage interface on the same ids is refused', wrongInterface.ok === false);

	// The device answers max-download-size in hex and the profile writes it in
	// hex; a bootloader answering the same number in decimal is the same
	// bootloader. Nothing else about the comparison is loose.
	const decimal = gateIdentity(profile, 'install', libra2, {
		...answersGood,
		'max-download-size': { value: '419430400' },
	});
	assertTrue('0x19000000 and 419430400 are the same answer', decimal.ok);

	const smaller = gateIdentity(profile, 'install', libra2, {
		...answersGood,
		'max-download-size': { value: '0x8000000' },
	});
	assertTrue('a smaller download buffer fails the gate', smaller.ok === false);
}

// --- the manifest -------------------------------------------------------------
//
// The shape is the one tools/release.sh actually writes and
// mainline/rootfs/usr/sbin/libra2-update actually reads: artefacts is a FLAT map
// of scalars, with the artefact's name in the key, because every key in that
// document has to be unique for a shell script with no jq to read it.

heading('the release manifest');

const releaseArtefacts = {
	bundle_name: 'inkhub-0.8.0-b412.tar',
	bundle_url: 'https://github.com/juicecultus/libra2-linuxos/releases/download/v0.8.0/inkhub-0.8.0-b412.tar',
	bundle_size: 53420032,
	bundle_sha256: '1'.repeat(64),
	p1_file: 'p1.ext4.xz',
	p1_size: 48700000,
	p1_sha256: '2'.repeat(64),
	p1_plain_size: 268435456,
	p1_plain_sha256: '3'.repeat(64),
	kernel_file: 'kernel-slot.img',
	kernel_size: 4260416,
	kernel_sha256: '4'.repeat(64),
	dtb_file: 'dtb.bin',
	dtb_size: 28274,
	dtb_sha256: '5'.repeat(64),
	dtb_hdr_file: 'dtb-hdr.bin',
	dtb_hdr_size: 512,
	dtb_hdr_sha256: '6'.repeat(64),
};

// What this page needs on top, because it has no tar and no xz.
const webArtefacts = {
	live_file: 'fastboot-live.img',
	live_url: '/dl/fastboot-live.img',
	live_size: 20172800,
	live_sha256: '2d1715e566a9cbbd03ed99bab77744485acc4b8ce63b02987f51a2d205d6521d',
	webp1_file: 'p1.ext4.gz',
	webp1_url: '/dl/p1.ext4.gz',
	webp1_size: 68000000,
	webp1_sha256: '7'.repeat(64),
	webp1_encoding: 'gzip',
	webp1_plain_size: 268435456,
	webp1_plain_sha256: '3'.repeat(64),
	webkernel_file: 'zImage',
	webkernel_url: '/dl/zImage',
	webkernel_size: 4259904,
	webkernel_sha256: '8'.repeat(64),
	webdtb_file: 'imx6sll-kobo-libra2.dtb',
	webdtb_url: '/dl/imx6sll-kobo-libra2.dtb',
	webdtb_size: 28274,
	webdtb_sha256: '9'.repeat(64),
};

function manifestText(artefacts) {
	return JSON.stringify({
		schema: 1,
		product: 'inkhub',
		version: '0.8.0',
		build: 412,
		commit: '9f3c2a1',
		date: '2026-09-10T12:00:00Z',
		min_build: 380,
		notes: 'Software update from Settings. Clock and time.',
		notes_url: 'https://github.com/juicecultus/libra2-linuxos/releases/tag/v0.8.0',
		artefacts,
	});
}

const goodManifest = manifestText({ ...releaseArtefacts, ...webArtefacts });
const parsed = parseManifest(goodManifest);

assertEq('the version comes through', '0.8.0', parsed.version);
assertEq('the build number comes through', 412, parsed.build);
assertEq('the product comes through', 'inkhub', parsed.product);
assertEq('min_build is carried', 380, parsed.minBuild);
assertTrue('ManifestError is the error type', new ManifestError('x') instanceof Error);

// The device updater's own artefacts are readable by the same reader, which is
// the point of consuming this document rather than writing a second one.
const bundle = readArtefact(parsed, 'bundle');
assertEq('the bundle is readable by key', 53420032, bundle.size);
assertEq('and its url is the release URL', releaseArtefacts.bundle_url, bundle.url);

const liveArtefact = readArtefact(parsed, 'live');
assertEq('the live image is readable by key', 20172800, liveArtefact.size);
assertEq('it is raw by default', 'raw', liveArtefact.encoding);

const webRootfs = readArtefact(parsed, 'webp1');
assertEq('gzip encoding is read', 'gzip', webRootfs.encoding);
assertEq('the unpacked size is read', 268435456, webRootfs.sizeUncompressed);
assertEq('the unpacked checksum is read', '3'.repeat(64), webRootfs.sha256Uncompressed);

assertEq('an artefact the release does not carry reads as absent', null, readArtefact(parsed, 'finisher'));

assertThrows('an empty file is refused', () => parseManifest(''), 'empty');
assertThrows('a file that is not JSON is refused', () => parseManifest('not json'), 'not valid JSON');
assertThrows('a JSON array is refused', () => parseManifest('[]'), 'top level');
assertThrows(
	'a schema this page does not know is refused',
	() => parseManifest(JSON.stringify({ schema: 99, version: '1.0.0', build: 1, artefacts: {} })),
	'newer than this page understands',
);
assertThrows(
	'a release of some other product is refused',
	() => parseManifest(JSON.stringify({ schema: 1, product: 'something-else', version: '1.0.0', build: 1, artefacts: { a_url: '/x' } })),
	'not an inkhub one',
);
assertThrows(
	'a manifest with no artefacts is refused',
	() => parseManifest(JSON.stringify({ schema: 1, version: '1.0.0', build: 1, artefacts: {} })),
	'no artefacts',
);
assertThrows(
	'a version that is not a version number is refused',
	() => parseManifest(JSON.stringify({ schema: 1, version: 'latest', build: 1, artefacts: { a_url: '/x' } })),
	'not a version number',
);

// The flat rule, which release.sh enforces on the way out and the device's own
// reader depends on. A nested manifest would read fine here and not there.
assertThrows(
	'a nested artefact is refused, because the device reader cannot read one',
	() => parseManifest(manifestText({ live: { url: '/dl/x.img', size: 10, sha256: 'e'.repeat(64) } })),
	'is nested',
);

const badArtefact = (extra, wanted, name) => assertThrows(name, () => {
	const m = parseManifest(manifestText({ ...webArtefacts, ...extra }));
	readArtefact(m, 'live');
}, wanted);

badArtefact({ live_sha256: undefined }, 'must be a string', 'an artefact with no sha256 is refused');
badArtefact({ live_sha256: 'abc' }, '64 hex characters', 'a truncated sha256 is refused');
badArtefact({ live_url: 'http://example.com/x.img' }, 'https', 'an http artefact url is refused');
badArtefact({ live_url: '//example.com/x.img' }, 'protocol-relative', 'a protocol-relative artefact url is refused');
badArtefact({ live_size: 0 }, 'greater than zero', 'a zero-length artefact is refused');
badArtefact({ live_size: 0x100000000 }, 'does not fit', 'an artefact too big for the download command is refused');
badArtefact({ live_encoding: 'xz' }, 'raw or gzip', 'an encoding no browser has is refused');

// --- what a release can and cannot do ----------------------------------------

heading('planning an action against a release');

if (profile) {
	const livePlan = planArtefacts(profile, parsed, 'live');
	assertTrue('Live is possible from this release', livePlan.ok);
	assertEq('Live sends one artefact', 1, livePlan.present.length);
	assertEq('and it is the live image', 'live', livePlan.present[0].name);

	// The finisher does not exist yet, so this release cannot complete an
	// install. The plan says so by name rather than doing three quarters of it.
	const installPlan = planArtefacts(profile, parsed, 'install');
	assertTrue('an install is refused when the finisher is missing', installPlan.ok === false);
	assertEq('exactly one artefact is missing', 1, installPlan.missing.length);
	assertEq('and it is the finisher', 'finisher', installPlan.missing[0].name);
	assertEq(
		'the missing artefact names the asset a release should carry',
		'fastboot-finish.img',
		installPlan.missing[0].asset,
	);

	const complete = parseManifest(manifestText({
		...releaseArtefacts,
		...webArtefacts,
		finisher_file: 'fastboot-finish.img',
		finisher_url: '/dl/fastboot-finish.img',
		finisher_size: 20000000,
		finisher_sha256: 'f'.repeat(64),
	}));
	const plan = planArtefacts(profile, complete, 'install');
	assertTrue('a release carrying all five artefacts can install', plan.ok);
	assertEq('an install sends four artefacts', 4, plan.present.length);
	assertEq(
		'and the rootfs is sent unpacked',
		'gzip',
		plan.present.find((a) => a.name === 'rootfs').encoding,
	);
	assertEq(
		'the kernel sent is the bare zImage, not the slot image with its header',
		'/dl/zImage',
		plan.present.find((a) => a.name === 'kernel').url,
	);

	assertThrows(
		'an unknown action is refused',
		() => planArtefacts(profile, parsed, 'wipe'),
		'live or install',
	);
}


// --- the download size, against what the device said --------------------------

heading('the download size, against the device');

assertEq(
	'a 256 MiB partition image fits this bootloader',
	0x19000000,
	checkDownloadSize(268435456, '0x19000000'),
);
assertEq('a decimal answer is read too', 419430400, checkDownloadSize(1024, '419430400'));
assertThrows(
	'an image larger than the buffer is refused before it is sent',
	() => checkDownloadSize(0x19000001, '0x19000000'),
	'more than this bootloader accepts',
);
assertThrows(
	'a device that reported no buffer size is refused',
	() => checkDownloadSize(1024, ''),
	'did not report',
);
assertThrows(
	'an unreadable buffer size is refused',
	() => checkDownloadSize(1024, 'plenty'),
	'could not read',
);

// --- the page and its script agree about element ids --------------------------
//
// app.js reaches into the page by id. A renamed or deleted id is a page that
// throws on load, in a browser, on somebody else's machine, and nothing else in
// this file would catch it. So the ids the script asks for are checked against
// the ids the page defines.

heading('the page and app.js agree about ids');

const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const appJs = readFileSync(join(here, '..', 'app.js'), 'utf8');

const definedIds = new Set(
	Array.from(html.matchAll(/\sid="([^"]+)"/g)).map((m) => m[1]),
);
const usedIds = new Set(
	Array.from(appJs.matchAll(/\$\('([^']+)'\)/g)).map((m) => m[1]),
);

assertTrue('index.html defines some ids', definedIds.size > 0);
assertTrue('app.js asks for some ids', usedIds.size > 0);

const orphans = Array.from(usedIds).filter((id) => !definedIds.has(id)).sort();
if (orphans.length === 0) {
	pass(`every id app.js asks for is in index.html (${usedIds.size} of them)`);
} else {
	fail('every id app.js asks for is in index.html', `missing: ${orphans.join(', ')}`);
}

// The module graph, checked by reading it rather than by loading a browser.
for (const file of ['app.js', 'lib/fastboot.js', 'lib/manifest.js', 'lib/profile.js', 'lib/release.js']) {
	const source = readFileSync(join(here, '..', file), 'utf8');
	const bad = Array.from(source.matchAll(/from\s+'([^']+)'/g))
		.map((m) => m[1])
		.filter((spec) => !spec.startsWith('.') && !spec.startsWith('node:'));
	if (bad.length === 0) {
		pass(`${file} imports nothing from outside this directory`);
	} else {
		fail(`${file} imports nothing from outside this directory`, bad.join(', '));
	}
}

// --- the page's place on einkhub.com -----------------------------------------
//
// The installer is not at the root of a site of its own here. It is served from
// /kobo-libra2, its files sit under public/kobo-libra2, and the release proxy is
// a Next route handler at the same /dl/ prefix the profile names. Each of those
// is a thing that breaks silently in somebody's browser if it is moved, so each
// of them is asserted here.

heading('the page is served from /kobo-libra2');

assertTrue(
	'index.html loads the stylesheet from the route it is served at',
	html.includes('href="/kobo-libra2/styles.css"'),
);
assertTrue(
	'index.html loads app.js from the route it is served at',
	html.includes('src="/kobo-libra2/app.js"'),
);
assertTrue(
	'index.html links back to the site it now lives in',
	html.includes('<nav class="site-nav"'),
);
assertTrue(
	'app.js resolves the device files against its own module URL',
	appJs.includes("new URL(name, import.meta.url)")
		&& !appJs.includes("fetch('devices/index.json'"),
);

const nextConfig = readFileSync(join(siteRoot, 'next.config.ts'), 'utf8');
assertTrue(
	'the site rewrites /kobo-libra2 onto the installer page',
	nextConfig.includes("source: '/kobo-libra2', destination: '/kobo-libra2/index.html'"),
);

const route = readFileSync(join(siteRoot, routeHandler), 'utf8');
assertEq(
	'the profile fetches its assets from /dl/',
	'/dl/',
	profile ? profile.release.assetBase : null,
);
assertTrue(
	'and the route handler that answers /dl/ is the release proxy',
	route.includes('releases/latest/download/'),
);
assertTrue(
	'the proxy still refuses an asset name that is not a flat filename',
	route.includes('ASSET_RE') && route.includes('That is not an asset name.'),
);
assertTrue(
	'and still answers a missing release with the plain sentence',
	route.includes('No published release carries'),
);

// House style, in the files this round wrote.
for (const file of ['index.html', 'styles.css', 'app.js', 'lib/fastboot.js', 'lib/manifest.js', 'lib/profile.js', 'lib/release.js', 'devices/kobo-libra2.json', 'devices/index.json']) {
	const source = readFileSync(join(here, '..', file), 'utf8');
	if (source.includes('\u2014')) {
		fail(`${file} has no em-dash`);
	} else {
		pass(`${file} has no em-dash`);
	}
}

// And in the two files in the site's repository that this page brought with it.
for (const file of ['next.config.ts', routeHandler]) {
	const source = readFileSync(join(siteRoot, file), 'utf8');
	if (source.includes('\u2014')) {
		fail(`${file} has no em-dash`);
	} else {
		pass(`${file} has no em-dash`);
	}
}

// --- summary ------------------------------------------------------------------

console.log(`\n  run.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
