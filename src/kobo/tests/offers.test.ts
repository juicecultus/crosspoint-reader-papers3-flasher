// What a device and a release together put in reach.
//
// This is app.js's canDo() and hasCheck(), which the static page could only be
// checked on by loading it in a browser. As src/kobo/offers.ts they are pure
// functions, so every refusal a reader can be shown is asserted here instead.

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseManifest, planArtefacts, type Manifest } from '../manifest.ts';
import {
  formatBytes,
  hasCheck,
  lockedOffers,
  offerAction,
  offerActions,
} from '../offers.ts';
import {
  gateIdentity,
  parseProfile,
  type DeviceDescription,
  type GateResult,
  type GetvarAnswer,
} from '../profile.ts';

const profilePath = new URL('../devices/kobo-libra2.json', import.meta.url);
const profile = parseProfile(JSON.parse(readFileSync(profilePath, 'utf8')));

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

const silent: Record<string, GetvarAnswer> = {
  ...answersGood,
  'hwcfg.PCB': { error: 'Variable not implemented' },
};

const gatesFor = (answers: Record<string, GetvarAnswer>) => ({
  backup: gateIdentity(profile, 'backup', libra2, answers),
  live: gateIdentity(profile, 'live', libra2, answers),
  install: gateIdentity(profile, 'install', libra2, answers),
});

function manifestFrom(extra: Record<string, unknown>): Manifest {
  return parseManifest(
    JSON.stringify({
      schema: 1,
      product: 'inkhub',
      version: '0.8.0',
      build: 412,
      artefacts: {
        live_url: '/dl/fastboot-live.img',
        live_size: 20172800,
        live_sha256: 'a'.repeat(64),
        webp1_url: '/dl/p1.ext4.gz',
        webp1_size: 68000000,
        webp1_sha256: '7'.repeat(64),
        webp1_encoding: 'gzip',
        webp1_plain_size: 268435456,
        webp1_plain_sha256: '3'.repeat(64),
        webkernel_url: '/dl/zImage',
        webkernel_size: 4259904,
        webkernel_sha256: '8'.repeat(64),
        webdtb_url: '/dl/imx6sll-kobo-libra2.dtb',
        webdtb_size: 28274,
        webdtb_sha256: '9'.repeat(64),
        ...extra,
      },
    }),
  );
}

const plainRelease = manifestFrom({});
const fullRelease = manifestFrom({
  finisher_url: '/dl/fastboot-finish.img',
  finisher_size: 20000000,
  finisher_sha256: 'f'.repeat(64),
  backup_url: '/dl/fastboot-backup.img',
  backup_size: 21000000,
  backup_sha256: 'b'.repeat(64),
});

describe('what is on offer', () => {
  it('offers nothing before a device has answered', () => {
    const locked = lockedOffers('Connect the device in step 4 first.');
    for (const action of ['backup', 'live', 'install'] as const) {
      assert.equal(locked[action].ok, false);
      assert.equal(
        locked[action].ok === false && locked[action].quiet,
        true,
        'and the line carries a next step, not a refusal',
      );
    }
  });

  it('offers nothing when there is no release', () => {
    const offer = offerAction(
      profile,
      null,
      gatesFor(answersGood).live,
      'live',
    );
    assert.equal(offer.ok, false);
    assert.equal(
      offer.ok === false && offer.why,
      'There is no release to send.',
    );
  });

  it('offers nothing when the gate did not pass', () => {
    const gates = gatesFor(silent);
    const offer = offerAction(profile, plainRelease, gates.install, 'install');
    assert.equal(offer.ok, false);
    assert.equal(
      offer.ok === false && offer.why,
      'The identity checks this needs did not pass.',
    );
  });

  // The decisive pair. A bootloader that will not name the board keeps Install
  // out of reach and leaves Live exactly where it was, because Live writes
  // nothing and the image checks the board on the device.
  it('keeps Live in reach when Install is not', () => {
    const offers = offerActions(profile, plainRelease, gatesFor(silent));
    assert.equal(offers.install.ok, false);
    assert.equal(offers.live.ok, true);
  });

  it('names the asset a release does not carry', () => {
    const offers = offerActions(profile, plainRelease, gatesFor(answersGood));
    assert.equal(offers.backup.ok, false);
    assert.equal(
      offers.backup.ok === false && offers.backup.why,
      'This release does not carry the backup pass (fastboot-backup.img), so this page cannot do it.',
    );
    assert.equal(
      offers.backup.ok === false && offers.backup.quiet,
      false,
      'and that one is a refusal, drawn as one',
    );
  });

  it('offers all three from a release that carries everything', () => {
    const offers = offerActions(profile, fullRelease, gatesFor(answersGood));
    assert.equal(offers.backup.ok, true);
    assert.equal(offers.live.ok, true);
    assert.equal(offers.install.ok, true);
  });

  // The check payload is what makes an install verify itself. A release without
  // it still installs, and the page has to say which of the two it is doing.
  it('knows whether a release can check its own writing', () => {
    assert.equal(
      hasCheck(planArtefacts(profile, plainRelease, 'install')),
      false,
    );
    assert.equal(
      hasCheck(planArtefacts(profile, fullRelease, 'install')),
      true,
    );
    assert.equal(hasCheck(null), false);
  });

  // The backup pass is sent by its own button and is no part of the install, so
  // carrying it must not make an install look like one that verifies itself.
  it('does not mistake the backup pass for the check', () => {
    const backupOnly = manifestFrom({
      backup_url: '/dl/fastboot-backup.img',
      backup_size: 21000000,
      backup_sha256: 'b'.repeat(64),
    });
    assert.equal(
      hasCheck(planArtefacts(profile, backupOnly, 'install')),
      false,
    );
  });

  it('refuses an action the profile does not know', () => {
    const gate: GateResult = gatesFor(answersGood).install;
    const offer = offerAction(profile, plainRelease, gate, 'wipe' as 'install');
    assert.equal(offer.ok, false);
    assert.match(
      offer.ok === false ? offer.why : '',
      /backup, live or install/,
    );
  });
});

describe('sizes a reader reads', () => {
  it('says bytes, KiB and MiB', () => {
    assert.equal(formatBytes(512), '512 bytes');
    assert.equal(formatBytes(2048), '2.0 KiB');
    assert.equal(formatBytes(20172800), '19.2 MiB');
  });
});
