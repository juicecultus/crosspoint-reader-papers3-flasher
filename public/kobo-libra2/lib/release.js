// release.js - fetching a release, and refusing bytes that are not the bytes
// the manifest names.
//
// Everything this page sends to a device is checked against a sha256 from the
// manifest before one byte of it reaches the cable. There is no unverified
// path: an artefact with no hash is an artefact the manifest parser already
// refused.
//
// The URLs. GitHub sends no Access-Control-Allow-Origin on release downloads,
// so a page cannot fetch them cross-origin. vercel.json rewrites /dl/* onto
// the release, which makes the fetch same-origin and needs no CORS at all.
// docs/web-installer.md has the rewrite and what to change if the site ever
// moves off Vercel.

export class ReleaseError extends Error {
	constructor(message, detail) {
		super(message);
		this.name = 'ReleaseError';
		this.detail = detail || null;
	}
}

export async function fetchManifestText(url) {
	let response;
	try {
		response = await fetch(url, { cache: 'no-store' });
	} catch (err) {
		throw new ReleaseError(
			'The release could not be reached. Check the connection and reload.',
			err.message,
		);
	}
	if (response.status === 404) {
		throw new ReleaseError('NO_RELEASE');
	}
	if (!response.ok) {
		throw new ReleaseError(`The release server answered ${response.status}.`);
	}
	return response.text();
}

function toHex(buffer) {
	return Array.from(new Uint8Array(buffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function sha256Hex(bytes) {
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return toHex(digest);
}

function concat(chunks, total) {
	const out = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}

async function readAll(stream, expectedBytes, onProgress) {
	const reader = stream.getReader();
	const chunks = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.length;
		if (onProgress) onProgress(total, expectedBytes);
	}
	return concat(chunks, total);
}

// One artefact, downloaded, checked, and decompressed if the manifest says it
// is compressed. The returned bytes are what goes on the wire.
export async function fetchArtefact(artefact, onProgress) {
	let response;
	try {
		response = await fetch(artefact.url, { cache: 'no-store' });
	} catch (err) {
		throw new ReleaseError(
			`${artefact.label} could not be downloaded. Check the connection and try again.`,
			err.message,
		);
	}
	if (!response.ok) {
		throw new ReleaseError(`${artefact.label}: the release server answered ${response.status}.`);
	}
	if (!response.body) {
		throw new ReleaseError(`${artefact.label}: this browser gave no readable response body.`);
	}

	const downloaded = await readAll(response.body, artefact.size, (done, total) => {
		if (onProgress) onProgress({ phase: 'download', done, total });
	});

	if (downloaded.length !== artefact.size) {
		throw new ReleaseError(
			`${artefact.label}: the download is ${downloaded.length} bytes and the manifest says ${artefact.size}. Nothing was sent to the device.`,
		);
	}

	const got = await sha256Hex(downloaded);
	if (got !== artefact.sha256) {
		throw new ReleaseError(
			`${artefact.label}: the checksum does not match the manifest. Nothing was sent to the device.`,
			`expected ${artefact.sha256}, got ${got}`,
		);
	}

	if (artefact.encoding !== 'gzip') {
		return downloaded;
	}

	if (onProgress) onProgress({ phase: 'decompress', done: 0, total: artefact.sizeUncompressed || 0 });
	const stream = new Blob([downloaded]).stream().pipeThrough(new DecompressionStream('gzip'));
	const plain = await readAll(stream, artefact.sizeUncompressed || 0, (done, total) => {
		if (onProgress) onProgress({ phase: 'decompress', done, total });
	});

	if (artefact.sizeUncompressed && plain.length !== artefact.sizeUncompressed) {
		throw new ReleaseError(
			`${artefact.label}: unpacked to ${plain.length} bytes and the manifest says ${artefact.sizeUncompressed}. Nothing was sent to the device.`,
		);
	}
	if (artefact.sha256Uncompressed) {
		const gotPlain = await sha256Hex(plain);
		if (gotPlain !== artefact.sha256Uncompressed) {
			throw new ReleaseError(
				`${artefact.label}: the unpacked image does not match its checksum. Nothing was sent to the device.`,
			);
		}
	}
	return plain;
}

// The manifest URL and the artefact URLs, from the device profile. An artefact
// url in the manifest that is a bare path resolves against this origin, which
// is the shape the rewrite wants; an absolute https url is taken as it stands.
export function manifestUrl(profile) {
	const release = profile.release || {};
	const base = release.assetBase || '/dl/';
	const asset = release.manifestAsset || 'inkhub-manifest.json';
	return `${base}${asset}`;
}

export function resolveArtefactUrl(profile, url) {
	if (url.startsWith('https://')) {
		return url;
	}
	if (url.startsWith('/')) {
		return url;
	}
	const base = (profile.release && profile.release.assetBase) || '/dl/';
	return `${base}${url}`;
}
