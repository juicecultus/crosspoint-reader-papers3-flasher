// The device profile and the identity gate.
//
//   yarn test
//
// No dependencies, no network, no device, no browser. It drives the module the
// installer's write decision lives in, plus the real device profile in
// src/kobo/devices, so a profile edited into a shape the gate cannot read fails
// here rather than on somebody's e-reader.
//
// Ported from web/installer/tests/run.js in the libra2-linux repository. The
// assertions that sniffed the static page's DOM are gone: this page is a Next
// route and has no index.html to read.

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  gateIdentity,
  getvarNames,
  parseProfile,
  ProfileError,
  type DeviceDescription,
  type GetvarAnswer,
  type ProfileAction,
} from '../profile.ts';

const profilePath = new URL('../devices/kobo-libra2.json', import.meta.url);
const profileText = readFileSync(profilePath, 'utf8');

const usbFields = {
  vendorId: 1,
  productId: 2,
  interfaceClass: 3,
  interfaceSubclass: 4,
  interfaceProtocol: 5,
};

describe('the Kobo Libra 2 profile', () => {
  const profile = parseProfile(JSON.parse(profileText));

  it('devices/kobo-libra2.json parses and passes the schema', () => {
    assert.equal(profile.id, 'kobo-libra2');
    assert.equal(profile.name, 'Kobo Libra 2');
  });

  it('reports the USB identity this bootloader answers with', () => {
    assert.equal(profile.usb.vendorId, 0x18d1, 'vendor id is 0x18d1');
    assert.equal(profile.usb.productId, 0x0d02, 'product id is 0x0d02');
    assert.equal(profile.usb.interfaceClass, 0xff, 'interface class is 0xff');
    assert.equal(
      profile.usb.interfaceSubclass,
      0x42,
      'interface subclass is 0x42',
    );
    assert.equal(
      profile.usb.interfaceProtocol,
      0x03,
      'interface protocol is 0x03',
    );
  });

  // The board revision is the row docs/second-device.md marks must match
  // exactly, and it is the one thing standing between a fastboot write and
  // the wrong hardware. If it ever stops being required for an install, this
  // assertion is where that is noticed.
  it('requires the board revision before an install', () => {
    const pcb = profile.checks.find((c) => c.id === 'hwcfg-pcb');
    assert.ok(pcb, 'the board revision check exists');
    assert.equal(
      String(pcb.expect),
      '101',
      'the board revision expected is 101',
    );
    assert.ok(
      pcb.requiredFor.includes('install'),
      'an install requires the board revision',
    );
  });

  // The check payload is not a gate. Three fastboot writes are a complete
  // install, because the bootloader writes the device tree's header sector
  // itself out of the body sent to the dtb target (DEVIATIONS 344). If the
  // check ever goes back to being required for an install, this is where it
  // is noticed.
  it('treats the check payload as optional and not as a gate', () => {
    const check = profile.artefacts.finisher;
    assert.ok(check, 'the check artefact is in the profile');
    assert.ok(
      !check.required.includes('install'),
      'an install does not require the check',
    );
    assert.ok(
      Array.isArray(check.optional) && check.optional.includes('install'),
      'and an install uses it when a release carries it',
    );
  });

  it('names three fastboot writes and one optional RAM boot', () => {
    const writes = profile.actions.install.writes;
    const bootStep = writes.find((w) => w.via === 'fastboot-boot');
    assert.ok(bootStep, 'the install step that RAM-boots the check exists');
    assert.equal(
      bootStep.optional,
      true,
      'and it is the one step marked optional',
    );
    assert.equal(
      writes.filter((w) => w.optional !== true).length,
      3,
      'the steps that are not optional are the three fastboot writes',
    );
  });

  it('asks the bootloader only for variables it answers', () => {
    const names = getvarNames(profile);
    assert.ok(
      names.includes('hwcfg.PCB'),
      'the getvar list asks for hwcfg.PCB',
    );
    assert.ok(
      names.includes('max-download-size'),
      'the getvar list asks for max-download-size',
    );
    assert.ok(
      !names.includes('product'),
      'the getvar list does not ask for product, which this bootloader refuses',
    );
    assert.ok(
      !names.includes('serial'),
      'the getvar list does not ask for serial, which this bootloader refuses',
    );
    assert.equal(
      names.length,
      new Set(names).size,
      'no getvar name is asked twice',
    );
  });

  // The backup pass is its own action. It is sent by its own button before
  // anything is written, and the install neither sends it nor waits for it.
  it('carries the backup pass as its own action', () => {
    const backup = profile.artefacts.backup;
    assert.ok(backup, 'the backup artefact is in the profile');
    assert.ok(
      backup.required.includes('backup'),
      'the backup pass is required for the backup action',
    );
    assert.ok(
      backup.required.length === 1 && backup.optional === undefined,
      'and it belongs to no other action',
    );
    assert.equal(
      backup.asset,
      'fastboot-backup.img',
      'and the asset it names is the one tools/release.sh publishes',
    );
    assert.ok(profile.actions.backup, 'the profile has a backup action');
    assert.equal(
      profile.actions.backup.artefact,
      'backup',
      'it sends the backup artefact',
    );
    assert.equal(
      profile.actions.backup.via,
      'fastboot-boot',
      'by RAM-booting it, the way Live is sent',
    );
  });
});

describe('the profile schema', () => {
  it('refuses a profile with no schema', () => {
    assert.throws(() => parseProfile({}), /schema/);
  });

  it('refuses a profile with a future schema', () => {
    assert.throws(
      () => parseProfile({ schema: 2, id: 'x', name: 'x' }),
      /schema must be 1/,
    );
  });

  it('refuses two checks sharing an id', () => {
    assert.throws(
      () =>
        parseProfile({
          schema: 1,
          id: 'x',
          name: 'x',
          usb: usbFields,
          checks: [
            { id: 'a', source: 'usb', requiredFor: [] },
            { id: 'a', source: 'usb', requiredFor: [] },
          ],
          artefacts: {},
          actions: {},
        }),
      /share the id/,
    );
  });

  it('refuses a check naming an action that does not exist', () => {
    assert.throws(
      () =>
        parseProfile({
          schema: 1,
          id: 'x',
          name: 'x',
          usb: usbFields,
          checks: [{ id: 'a', source: 'usb', requiredFor: ['reflash'] }],
          artefacts: {},
          actions: {},
        }),
      /unknown action/,
    );
  });

  it('refuses an artefact both required and optional for one action', () => {
    assert.throws(
      () =>
        parseProfile({
          schema: 1,
          id: 'x',
          name: 'x',
          usb: usbFields,
          checks: [{ id: 'a', source: 'usb', requiredFor: [] }],
          artefacts: {
            thing: {
              key: 'thing',
              required: ['install'],
              optional: ['install'],
            },
          },
          actions: {},
        }),
      /both required and optional/,
    );
  });

  it('refuses an artefact optional for an action that does not exist', () => {
    assert.throws(
      () =>
        parseProfile({
          schema: 1,
          id: 'x',
          name: 'x',
          usb: usbFields,
          checks: [{ id: 'a', source: 'usb', requiredFor: [] }],
          artefacts: {
            thing: { key: 'thing', required: [], optional: ['wipe'] },
          },
          actions: {},
        }),
      /unknown action/,
    );
  });

  it('throws ProfileError, which is an Error', () => {
    assert.ok(new ProfileError('x') instanceof Error);
  });
});

describe('the identity gate', () => {
  const profile = parseProfile(JSON.parse(profileText));

  const libra2: DeviceDescription = {
    vendorId: 0x18d1,
    productId: 0x0d02,
    manufacturerName: 'FSL',
    productName: 'USB download gadget',
    interfaceClass: 0xff,
    interfaceSubclass: 0x42,
    interfaceProtocol: 0x03,
  };

  const answersGood: Record<string, GetvarAnswer> = {
    version: { value: '0.4' },
    'max-download-size': { value: '0x19000000' },
    'hwcfg.PCB': { value: '101' },
    'hwcfg.DisplayResolution': { value: '16' },
    serialno: { value: '80311141234567890' },
  };

  // The bootloader's own refusal wording, from the field session of 2026-08-30.
  const declined: GetvarAnswer = { error: 'Variable not implemented' };

  const stateOf = (
    action: ProfileAction,
    answers: Record<string, GetvarAnswer>,
    id: string,
    device: DeviceDescription = libra2,
  ) => {
    const result = gateIdentity(profile, action, device, answers);
    return result.checks.find((c) => c.id === id)?.state;
  };

  it('passes a Libra 2 that answers everything', () => {
    const good = gateIdentity(profile, 'install', libra2, answersGood);
    assert.ok(
      good.ok,
      'a Libra 2 answering everything passes the install gate',
    );
    assert.equal(good.declined.length, 0, 'nothing was declined');
    assert.equal(
      stateOf('install', answersGood, 'serialno'),
      'noted',
      'the serial is noted and not gated on',
    );
  });

  // The answers as the dev unit's bootloader actually gives them, measured
  // 2026-09-02: a bracketed field index, the field name, an equals sign and
  // the value in hex. serialno refuses with "Value not set".
  it("reads the bootloader's own answer format", () => {
    const measured = gateIdentity(profile, 'install', libra2, {
      ...answersGood,
      'hwcfg.PCB': { value: '[0] PCB=0x65' },
      'hwcfg.DisplayResolution': { value: '[31] DisplayResolution=0x10' },
      'hwcfg.RAMType': { value: '[29] RAMType=0x05' },
      'hwcfg.RamSize': { value: '[16] RamSize=0x03' },
      serialno: { error: 'Value not set' },
    });
    assert.ok(measured.ok, "the bootloader's own answer format passes");
    const wrong = gateIdentity(profile, 'install', libra2, {
      ...answersGood,
      'hwcfg.PCB': { value: '[0] PCB=0x31' },
    });
    assert.ok(!wrong.ok, 'and a different board in that format is refused');
  });

  it('refuses a different board revision', () => {
    const wrongBoard = gateIdentity(profile, 'install', libra2, {
      ...answersGood,
      'hwcfg.PCB': { value: '49' },
    });
    assert.equal(wrongBoard.ok, false);
    assert.equal(
      wrongBoard.failed[0]?.id,
      'hwcfg-pcb',
      'and it is the board revision that failed',
    );
  });

  it('refuses a different panel', () => {
    const wrongPanel = gateIdentity(profile, 'install', libra2, {
      ...answersGood,
      'hwcfg.DisplayResolution': { value: '17' },
    });
    assert.equal(wrongPanel.ok, false);
  });

  // The decisive one. A bootloader that will not say what board it is on is a
  // bootloader this page will not write to.
  it('refuses an install when the bootloader will not name the board', () => {
    const silent = gateIdentity(profile, 'install', libra2, {
      ...answersGood,
      'hwcfg.PCB': declined,
    });
    assert.equal(silent.ok, false);
    assert.equal(
      stateOf(
        'install',
        { ...answersGood, 'hwcfg.PCB': declined },
        'hwcfg-pcb',
      ),
      'fail',
      'and the refusal is recorded as a failure, not a shrug',
    );
  });

  // Live writes nothing and the image carries its own board gate, so the same
  // silence is survivable there and is reported rather than hidden.
  it('still allows Live when the bootloader will not name the board', () => {
    const silentLive = gateIdentity(profile, 'live', libra2, {
      ...answersGood,
      'hwcfg.PCB': declined,
    });
    assert.ok(silentLive.ok, 'the same silence still allows InkHub Live');
    assert.equal(
      stateOf('live', { ...answersGood, 'hwcfg.PCB': declined }, 'hwcfg-pcb'),
      'declined',
      'and Live records it as declined so the page can say so',
    );
  });

  it('refuses a device with other USB ids, even for Live', () => {
    const notALibra = gateIdentity(
      profile,
      'live',
      { ...libra2, vendorId: 0x1234, productId: 0x5678 },
      answersGood,
    );
    assert.equal(notALibra.ok, false);
  });

  it('refuses a mass-storage interface on the same ids', () => {
    const wrongInterface = gateIdentity(
      profile,
      'live',
      {
        ...libra2,
        interfaceClass: 0x08,
        interfaceSubclass: 0x06,
        interfaceProtocol: 0x50,
      },
      answersGood,
    );
    assert.equal(wrongInterface.ok, false);
  });

  // The device answers max-download-size in hex and the profile writes it in
  // hex; a bootloader answering the same number in decimal is the same
  // bootloader. Nothing else about the comparison is loose.
  it('reads the same buffer size in hex or in decimal', () => {
    const decimal = gateIdentity(profile, 'install', libra2, {
      ...answersGood,
      'max-download-size': { value: '419430400' },
    });
    assert.ok(decimal.ok, '0x19000000 and 419430400 are the same answer');
    const smaller = gateIdentity(profile, 'install', libra2, {
      ...answersGood,
      'max-download-size': { value: '0x8000000' },
    });
    assert.equal(smaller.ok, false, 'a smaller download buffer fails the gate');
  });

  it('refuses an unknown action', () => {
    assert.throws(
      () => gateIdentity(profile, 'wipe' as ProfileAction, libra2, answersGood),
      /unknown action/,
    );
  });
});
