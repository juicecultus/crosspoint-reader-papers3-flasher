// profile.ts - the device profile, and the gate that decides whether this
// browser is allowed to write to the thing on the other end of the cable.
//
// One profile per device, in devices/. Adding a device is adding a file there;
// nothing in this module knows about the Libra 2.
//
// The gate is deliberately per action. These facts make that the honest shape:
//
//   The backup pass writes one new folder on the reader's own books partition
//   and nothing else, and the image it boots runs the project's own hwcfg gate
//   and reads the partition table off the card before it copies anything. So
//   it is gated the way Live is: the USB identity, and the rest reported.
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
// No DOM, no USB. Pure functions over plain objects so tests/profile.test.ts
// can drive every verdict from node.

export type ProfileAction = 'backup' | 'live' | 'install';

export interface UsbIdentity {
  vendorId: number;
  productId: number;
  interfaceClass: number;
  interfaceSubclass: number;
  interfaceProtocol: number;
  vendorIdHex?: string;
  productIdHex?: string;
  manufacturerName?: string;
  productName?: string;
  note?: string;
}

export interface ProfileCheck {
  id: string;
  source: 'usb' | 'getvar';
  name?: string;
  label?: string;
  expect?: string | number | null;
  requiredFor: ProfileAction[];
  why?: string;
}

export interface ProfileArtefact {
  key: string;
  required: ProfileAction[];
  optional?: ProfileAction[];
  asset?: string;
  label?: string;
  note?: string;
}

export interface InstallWrite {
  step: number;
  artefact: string;
  via: 'fastboot-flash' | 'fastboot-boot';
  label: string;
  target?: string;
  optional?: boolean;
  note?: string;
}

export interface BootAction {
  artefact: string;
  via: string;
  writes?: string;
  note?: string;
}

export interface DeviceProfile {
  schema: number;
  id: string;
  name: string;
  model?: string;
  soc?: string;
  board?: string;
  summary?: string;
  usb: UsbIdentity;
  entry: {
    title: string;
    warnings: string[];
    note?: string;
    source?: string;
  };
  checks: ProfileCheck[];
  unreadable?: string[];
  unwritable?: string[];
  artefacts: Record<string, ProfileArtefact>;
  actions: {
    backup?: BootAction;
    live?: BootAction;
    install: { writes: InstallWrite[] };
  };
  release?: {
    owner?: string;
    repo?: string;
    manifestAsset?: string;
    assetBase?: string;
    upstream?: string;
    note?: string;
  };
  finish: {
    title: string;
    steps: string[];
    expect: string;
    source?: string;
  };
  recovery?: {
    gesture: string;
    untouched: string;
  };
}

// What the browser knows about the thing on the other end of the cable. The
// interface fields are only there once an interface has been chosen.
export interface DeviceDescription {
  vendorId: number;
  productId: number;
  manufacturerName?: string | null;
  productName?: string | null;
  serialNumber?: string | null;
  interfaceClass?: number;
  interfaceSubclass?: number;
  interfaceProtocol?: number;
}

// One getvar answer: a value for an answer, an error for a refusal.
export interface GetvarAnswer {
  value?: string;
  error?: string;
}

export type CheckState = 'pass' | 'fail' | 'declined' | 'noted';

export interface CheckResult {
  id: string;
  label: string;
  expected: string | null;
  required: boolean;
  why: string | null;
  actual: string | null;
  state: CheckState;
  detail: string | null;
}

export interface GateResult {
  action: ProfileAction;
  ok: boolean;
  checks: CheckResult[];
  failed: CheckResult[];
  declined: CheckResult[];
}

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}

function must(condition: boolean, message: string): void {
  if (!condition) {
    throw new ProfileError(message);
  }
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The actions a profile may name. Backup is one of them and not a step of the
// install: it is a separate RAM boot, with a separate button sequence in front
// of it, and the install happens with or without it.
const ACTIONS: ProfileAction[] = ['backup', 'live', 'install'];

const USB_FIELDS = [
  'vendorId',
  'productId',
  'interfaceClass',
  'interfaceSubclass',
  'interfaceProtocol',
] as const;

export function parseProfile(input: unknown): DeviceProfile {
  must(isPlainObject(input), 'profile: the top level must be an object');
  // Everything below is the proof that this shape is the shape. Nothing reads
  // the profile until parseProfile has returned.
  const raw = input as DeviceProfile;

  must(
    raw.schema === 1,
    `profile: schema must be 1, got ${JSON.stringify(raw.schema)}`,
  );
  must(
    typeof raw.id === 'string' && raw.id.length > 0,
    'profile: id must be a string',
  );
  must(
    typeof raw.name === 'string' && raw.name.length > 0,
    'profile: name must be a string',
  );

  must(isPlainObject(raw.usb), 'profile: usb must be an object');
  for (const field of USB_FIELDS) {
    must(
      typeof raw.usb[field] === 'number' &&
        Number.isInteger(raw.usb[field]) &&
        raw.usb[field] >= 0,
      `profile: usb.${field} must be a whole number`,
    );
  }

  must(
    Array.isArray(raw.checks) && raw.checks.length > 0,
    'profile: checks must be a non-empty array',
  );
  const seen = new Set<string>();
  for (const check of raw.checks) {
    must(isPlainObject(check), 'profile: every check must be an object');
    must(
      typeof check.id === 'string' && check.id.length > 0,
      'profile: every check needs an id',
    );
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
    must(
      Array.isArray(check.requiredFor),
      `profile: check ${check.id}: requiredFor must be an array`,
    );
    for (const action of check.requiredFor) {
      must(
        ACTIONS.includes(action),
        `profile: check ${check.id}: unknown action ${action}`,
      );
    }
  }

  must(isPlainObject(raw.artefacts), 'profile: artefacts must be an object');
  const keys = new Set<string>();
  for (const [name, artefact] of Object.entries(raw.artefacts)) {
    must(
      isPlainObject(artefact),
      `profile: artefact ${name} must be an object`,
    );
    must(
      typeof artefact.key === 'string' && artefact.key.length > 0,
      `profile: artefact ${name} needs the manifest key its fields are named with`,
    );
    must(
      !keys.has(artefact.key),
      `profile: two artefacts share the manifest key ${artefact.key}`,
    );
    keys.add(artefact.key);
    must(
      Array.isArray(artefact.required),
      `profile: artefact ${name}: required must be an array`,
    );
    for (const action of artefact.required) {
      must(
        ACTIONS.includes(action),
        `profile: artefact ${name}: unknown action ${action}`,
      );
    }
    // optional is the second list, and it means the action happens without
    // this artefact and does something more with it. An artefact in both
    // lists for the same action is a profile that cannot be read either way,
    // so it is refused here rather than resolved.
    if (artefact.optional !== undefined) {
      must(
        Array.isArray(artefact.optional),
        `profile: artefact ${name}: optional must be an array`,
      );
      for (const action of artefact.optional) {
        must(
          ACTIONS.includes(action),
          `profile: artefact ${name}: unknown action ${action}`,
        );
        must(
          !artefact.required.includes(action),
          `profile: artefact ${name}: ${action} cannot be both required and optional`,
        );
      }
    }
  }

  must(isPlainObject(raw.actions), 'profile: actions must be an object');

  return raw;
}

// The getvar names the page should ask for, in profile order and without
// repeats. serialno is in here and is never gated on: it goes in the log so a
// support conversation has something to name the device by.
export function getvarNames(profile: DeviceProfile): string[] {
  const names: string[] = [];
  for (const check of profile.checks) {
    if (
      check.source === 'getvar' &&
      check.name &&
      !names.includes(check.name)
    ) {
      names.push(check.name);
    }
  }
  return names;
}

function hex4(n: number | undefined): string {
  if (typeof n !== 'number') {
    return String(n);
  }
  return `0x${n.toString(16).padStart(4, '0')}`;
}

function usbActual(device: DeviceDescription, usb: UsbIdentity): string {
  const parts = [`${hex4(device.vendorId)}:${hex4(device.productId)}`];
  if (device.manufacturerName) {
    parts.push(device.manufacturerName);
  }
  if (device.productName) {
    parts.push(device.productName);
  }
  if (device.interfaceClass !== undefined) {
    parts.push(
      `interface ${device.interfaceClass}/${device.interfaceSubclass}/${device.interfaceProtocol}`,
    );
  }
  void usb;
  return parts.join(', ');
}

function usbMatches(device: DeviceDescription, usb: UsbIdentity): boolean {
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
    device.interfaceClass === usb.interfaceClass &&
    device.interfaceSubclass === usb.interfaceSubclass &&
    device.interfaceProtocol === usb.interfaceProtocol
  );
}

// The Libra 2's bootloader answers an hwcfg variable as its field index
// in brackets, the field's name, an equals sign and the value in hex:
// "[0] PCB=0x65" for hwcfg.PCB (measured 2026-09-02, dev unit). Only the
// value after the equals sign is the answer; the index and the name are
// the bootloader's own labelling and are dropped before comparing.
function valuePart(text: string): string {
  const m = /^(?:\[\d+\]\s*)?(?:[a-z0-9_.]+=)?(.*)$/.exec(text);
  return m && m[1] !== undefined ? m[1].trim() : text;
}

function numberOf(raw: string): number | null {
  const text = valuePart(raw);
  if (/^0x[0-9a-f]+$/.test(text)) {
    return Number.parseInt(text.slice(2), 16);
  }
  if (/^[0-9]+$/.test(text)) {
    return Number.parseInt(text, 10);
  }
  return null;
}

// Normalising a getvar answer before comparing it. The device answers
// max-download-size as "0x19000000" and hwcfg.PCB as "101", and a bootloader
// that answered "0X19000000" or " 101" would be the same bootloader. Numbers
// compare as numbers when both sides read as numbers, and as trimmed lowercase
// strings otherwise. Nothing here coerces a mismatch into a match.
function sameValue(expected: string, actual: string): boolean {
  const a = valuePart(String(expected).trim().toLowerCase());
  const b = valuePart(String(actual).trim().toLowerCase());
  if (a === b) {
    return true;
  }
  const na = numberOf(a);
  const nb = numberOf(b);
  return na !== null && nb !== null && na === nb;
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
export function gateIdentity(
  profile: DeviceProfile,
  action: ProfileAction,
  device: DeviceDescription,
  getvars: Record<string, GetvarAnswer>,
): GateResult {
  must(ACTIONS.includes(action), `gate: unknown action ${action}`);
  must(isPlainObject(device), 'gate: device must be an object');
  must(isPlainObject(getvars), 'gate: getvars must be an object');

  const checks: CheckResult[] = [];

  for (const check of profile.checks) {
    const required = check.requiredFor.includes(action);
    const row: CheckResult = {
      id: check.id,
      label: check.label || check.name || check.id,
      expected:
        check.expect === undefined || check.expect === null
          ? null
          : String(check.expect),
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
        row.detail =
          'This is not the USB identity the Libra 2 bootloader reports.';
      }
      checks.push(row);
      continue;
    }

    const answer = check.name === undefined ? undefined : getvars[check.name];
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
