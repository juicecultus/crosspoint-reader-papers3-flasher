// manifest.ts - reading the release manifest, and refusing a bad one.
//
// The manifest is round 9c's. tools/release.sh writes it, the device's own
// updater at mainline/rootfs/usr/sbin/libra2-update reads it, and it is
// published as a release asset called manifest.json beside manifest.json.minisig
// and the bundle. This module consumes that document as it is actually written;
// it does not invent a second shape and it does not accept an older one.
//
// The one rule of that document worth restating, because it is what this parser
// is built around: EVERY KEY IS UNIQUE ACROSS THE WHOLE DOCUMENT, and
// "artefacts" is therefore a flat map of scalars with the artefact's name in the
// key rather than a map of nested objects. release.sh refuses to write a
// manifest that breaks the rule; the device's reader is a shell script with no
// jq and depends on it; and this parser enforces it too, so all three agree.
//
// What this page needs that the device does not. The updater downloads one tar
// bundle and unpacks it with busybox. A browser has no tar and no xz, so the
// pieces it sends have to be published as their own assets with their own URLs,
// under their own keys. Those keys are named in the device profile. A release
// that does not carry them is not a broken release: the page says which asset is
// missing and refuses the action rather than doing most of it.
//
// No DOM, no fetch, no browser API. Pure functions over text, so the tests can
// drive every refusal from node.

import type { DeviceProfile, ProfileAction } from './profile.ts';

const SCHEMAS_SUPPORTED = [1];
const PRODUCT = 'inkhub';
const SHA256_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

// Every artefact field is a flat scalar with the artefact's name in the key.
export type ArtefactFields = Record<string, string | number>;

export interface Manifest {
  schema: number;
  product: string | null;
  version: string;
  build: number;
  commit: string | null;
  date: string | null;
  minBuild: number | null;
  notes: string | null;
  notesUrl: string | null;
  artefacts: ArtefactFields;
}

export interface Artefact {
  key: string;
  file: string | null;
  url: string;
  size: number;
  sha256: string;
  encoding: 'raw' | 'gzip';
  sizeUncompressed: number | null;
  sha256Uncompressed: string | null;
}

export interface PlannedArtefact {
  name: string;
  label: string;
  optional: boolean;
  url: string;
  size: number;
  sha256: string;
  sha256Uncompressed: string | null;
  sizeUncompressed: number | null;
  encoding: 'raw' | 'gzip';
}

export interface UnplannedArtefact {
  name: string;
  label: string;
  asset: string | null;
  key: string;
}

export interface ArtefactPlan {
  action: ProfileAction;
  present: PlannedArtefact[];
  missing: UnplannedArtefact[];
  absent: UnplannedArtefact[];
  ok: boolean;
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

function must(condition: boolean, message: string): void {
  if (!condition) {
    throw new ManifestError(message);
  }
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface RawManifest {
  schema: number;
  product?: string;
  version: string;
  build: number;
  commit?: string;
  date?: string;
  min_build?: number;
  notes?: string;
  notes_url?: string;
  artefacts: ArtefactFields;
}

// parseManifest(text) -> manifest, or throws ManifestError.
//
// Every refusal names the field. A manifest that half parses is worse than one
// that does not parse at all, so nothing here recovers from anything.
export function parseManifest(text: string): Manifest {
  must(typeof text === 'string', 'manifest: expected text');
  must(text.trim().length > 0, 'manifest: the file is empty');

  let raw: RawManifest;
  try {
    raw = JSON.parse(text) as RawManifest;
  } catch (err) {
    throw new ManifestError(
      `manifest: not valid JSON (${(err as Error).message})`,
    );
  }
  must(isPlainObject(raw), 'manifest: the top level must be an object');

  must(typeof raw.schema === 'number', 'manifest: schema must be a number');
  must(
    SCHEMAS_SUPPORTED.includes(raw.schema),
    `manifest: schema ${raw.schema} is newer than this page understands. Reload the page, and if it still says this, the page is older than the release.`,
  );

  if (raw.product !== undefined) {
    must(
      raw.product === PRODUCT,
      `manifest: this is a ${raw.product} release, not an ${PRODUCT} one`,
    );
  }

  must(typeof raw.version === 'string', 'manifest: version must be a string');
  must(
    VERSION_RE.test(raw.version),
    `manifest: version "${raw.version}" is not a version number`,
  );

  must(
    typeof raw.build === 'number' &&
      Number.isInteger(raw.build) &&
      raw.build > 0,
    'manifest: build must be a whole number greater than zero',
  );

  must(isPlainObject(raw.artefacts), 'manifest: artefacts must be an object');
  for (const [key, value] of Object.entries(raw.artefacts)) {
    must(
      !isPlainObject(value) && !Array.isArray(value),
      `manifest: artefacts.${key} is nested. Every artefact field is a flat scalar with the artefact's name in the key.`,
    );
  }
  must(
    Object.keys(raw.artefacts).length > 0,
    'manifest: the release lists no artefacts',
  );

  return {
    schema: raw.schema,
    product: raw.product || null,
    version: raw.version,
    build: raw.build,
    commit: typeof raw.commit === 'string' ? raw.commit : null,
    date: typeof raw.date === 'string' ? raw.date : null,
    minBuild: typeof raw.min_build === 'number' ? raw.min_build : null,
    notes: typeof raw.notes === 'string' ? raw.notes : null,
    notesUrl: typeof raw.notes_url === 'string' ? raw.notes_url : null,
    artefacts: raw.artefacts,
  };
}

// A size we are going to hand to download:%08x, so it has to fit in eight hex
// digits as well as being a sane number. No arbitrary cap beyond that: the cap
// that matters is the device's own max-download-size, checked at send time
// against the value the device reported, not against a number written here.
function readSize(value: unknown, where: string): number {
  must(typeof value === 'number', `${where}: must be a number`);
  const size = value as number;
  must(Number.isInteger(size), `${where}: must be a whole number of bytes`);
  must(size > 0, `${where}: must be greater than zero`);
  must(
    size <= 0xffffffff,
    `${where}: does not fit in the fastboot download command`,
  );
  return size;
}

function readSha256(value: unknown, where: string): string {
  must(typeof value === 'string', `${where}: must be a string`);
  const lower = (value as string).toLowerCase();
  must(SHA256_RE.test(lower), `${where}: must be 64 hex characters`);
  return lower;
}

// The URL rules. An artefact URL is either absolute https, or a path that the
// page resolves against its own origin. Anything else is refused, including
// http, because a payload fetched in the clear is a payload anyone on the path
// can replace, and the hash that would have caught it came over the same wire.
function readUrl(value: unknown, where: string): string {
  must(
    typeof value === 'string' && value.length > 0,
    `${where}: must be a string`,
  );
  const url = value as string;
  if (url.startsWith('/')) {
    must(!url.startsWith('//'), `${where}: must not be protocol-relative`);
    return url;
  }
  must(
    url.startsWith('https://'),
    `${where}: must be https or an absolute path`,
  );
  return url;
}

// One artefact, read out of the flat map by its key prefix. Returns null when
// the release does not carry it, and throws when it carries a broken one: a
// missing artefact is a fact about the release, a malformed one is a fault.
export function readArtefact(manifest: Manifest, key: string): Artefact | null {
  const a = manifest.artefacts;
  const url = a[`${key}_url`];
  const size = a[`${key}_size`];
  const sha256 = a[`${key}_sha256`];

  if (url === undefined && size === undefined && sha256 === undefined) {
    return null;
  }

  const file = a[`${key}_file`];
  const artefact: Artefact = {
    key,
    file: typeof file === 'string' ? file : null,
    url: readUrl(url, `artefacts.${key}_url`),
    size: readSize(size, `artefacts.${key}_size`),
    sha256: readSha256(sha256, `artefacts.${key}_sha256`),
    encoding: 'raw',
    sizeUncompressed: null,
    sha256Uncompressed: null,
  };

  const encoding = a[`${key}_encoding`];
  if (encoding !== undefined) {
    must(
      encoding === 'raw' || encoding === 'gzip',
      `artefacts.${key}_encoding: must be raw or gzip`,
    );
    artefact.encoding = encoding as 'raw' | 'gzip';
  }
  if (a[`${key}_plain_size`] !== undefined) {
    artefact.sizeUncompressed = readSize(
      a[`${key}_plain_size`],
      `artefacts.${key}_plain_size`,
    );
  }
  if (a[`${key}_plain_sha256`] !== undefined) {
    artefact.sha256Uncompressed = readSha256(
      a[`${key}_plain_sha256`],
      `artefacts.${key}_plain_sha256`,
    );
  }
  return artefact;
}

// Which of a profile's artefacts this release actually carries, and which it
// does not. The page uses the missing list to say plainly what it cannot do
// rather than to fall back to something it can.
//
// An artefact is required for an action or optional for it. The difference is
// the difference between a release that cannot do the thing and a release that
// does it without the extra. The Libra 2's finisher is the optional one: the
// three fastboot writes are a complete install, because the bootloader writes
// the device tree's header sector itself from the body sent to the dtb target
// (DEVIATIONS 344), so the finisher is the read-back and not the boot gate. A
// release that carries it gets verified; a release that does not still
// installs, and the absent list is how the page says which of the two happened.
//
// The backup pass is NOT one of those. It is its own action, required for it
// and for nothing else, because it is a separate RAM boot with its own button
// sequence and the install neither sends it nor waits for it. A release that
// does not carry it cannot offer the pass, and says so, and the install is
// offered either way.
export function planArtefacts(
  profile: DeviceProfile,
  manifest: Manifest,
  action: ProfileAction,
): ArtefactPlan {
  must(
    isPlainObject(profile) && isPlainObject(profile.artefacts),
    'profile: artefacts must be an object',
  );
  must(
    isPlainObject(manifest) && isPlainObject(manifest.artefacts),
    'manifest: artefacts must be an object',
  );
  must(
    action === 'backup' || action === 'live' || action === 'install',
    `action must be backup, live or install, got ${action}`,
  );

  const present: PlannedArtefact[] = [];
  const missing: UnplannedArtefact[] = [];
  const absent: UnplannedArtefact[] = [];

  for (const [name, want] of Object.entries(profile.artefacts)) {
    const requiredFor = Array.isArray(want.required) ? want.required : [];
    const optionalFor = Array.isArray(want.optional) ? want.optional : [];
    const required = requiredFor.includes(action);
    const optional = optionalFor.includes(action);
    if (!required && !optional) {
      continue;
    }
    must(
      typeof want.key === 'string' && want.key.length > 0,
      `profile: artefact ${name} has no manifest key`,
    );

    const have = readArtefact(manifest, want.key);
    if (!have) {
      const row: UnplannedArtefact = {
        name,
        label: want.label || name,
        asset: want.asset || null,
        key: want.key,
      };
      if (required) {
        missing.push(row);
      } else {
        absent.push(row);
      }
      continue;
    }
    present.push({
      name,
      label: want.label || name,
      optional,
      url: have.url,
      size: have.size,
      sha256: have.sha256,
      sha256Uncompressed: have.sha256Uncompressed,
      sizeUncompressed: have.sizeUncompressed,
      encoding: have.encoding,
    });
  }

  return { action, present, missing, absent, ok: missing.length === 0 };
}

// The bytes actually pushed at the device, against what the device said it can
// take. maxDownloadSize is the string the device answered, "0x19000000" on this
// bootloader, and it is read from the wire rather than from the profile so that
// a device answering something smaller is refused rather than overrun.
export function checkDownloadSize(
  byteLength: number,
  maxDownloadSize: string,
): number {
  must(
    typeof byteLength === 'number' &&
      Number.isInteger(byteLength) &&
      byteLength > 0,
    'download: byteLength must be a whole number greater than zero',
  );
  must(
    typeof maxDownloadSize === 'string' && maxDownloadSize.length > 0,
    'download: the device did not report max-download-size',
  );

  const limit = Number.parseInt(
    maxDownloadSize,
    maxDownloadSize.startsWith('0x') ? 16 : 10,
  );
  must(
    Number.isInteger(limit) && limit > 0,
    `download: could not read max-download-size "${maxDownloadSize}"`,
  );
  must(
    byteLength <= limit,
    `download: ${byteLength} bytes is more than this bootloader accepts (${maxDownloadSize} = ${limit} bytes)`,
  );
  return limit;
}
