// The release manifest, what a release lets an action do, and the download size
// the device agreed to.
//
// The shape is the one tools/release.sh actually writes and
// mainline/rootfs/usr/sbin/libra2-update actually reads: artefacts is a FLAT map
// of scalars, with the artefact's name in the key, because every key in that
// document has to be unique for a shell script with no jq to read it.
//
// Ported from web/installer/tests/run.js in the libra2-linux repository.

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkDownloadSize,
  ManifestError,
  parseManifest,
  planArtefacts,
  readArtefact,
  type ArtefactFields,
} from '../manifest.ts';
import { parseProfile, type ProfileAction } from '../profile.ts';

const profilePath = new URL('../devices/kobo-libra2.json', import.meta.url);
const profile = parseProfile(JSON.parse(readFileSync(profilePath, 'utf8')));

const releaseArtefacts: ArtefactFields = {
  bundle_name: 'inkhub-0.8.0-b412.tar',
  bundle_url:
    'https://github.com/juicecultus/libra2-linuxos/releases/download/v0.8.0/inkhub-0.8.0-b412.tar',
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
const webArtefacts: ArtefactFields = {
  live_file: 'fastboot-live.img',
  live_url: '/dl/fastboot-live.img',
  live_size: 20172800,
  live_sha256:
    '2d1715e566a9cbbd03ed99bab77744485acc4b8ce63b02987f51a2d205d6521d',
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

function manifestText(artefacts: Record<string, unknown>): string {
  return JSON.stringify({
    schema: 1,
    product: 'inkhub',
    version: '0.8.0',
    build: 412,
    commit: '9f3c2a1',
    date: '2026-09-10T12:00:00Z',
    min_build: 380,
    notes: 'Software update from Settings. Clock and time.',
    notes_url:
      'https://github.com/juicecultus/libra2-linuxos/releases/tag/v0.8.0',
    artefacts,
  });
}

const parsed = parseManifest(
  manifestText({ ...releaseArtefacts, ...webArtefacts }),
);

describe('the release manifest', () => {
  it('carries the release through', () => {
    assert.equal(parsed.version, '0.8.0', 'the version comes through');
    assert.equal(parsed.build, 412, 'the build number comes through');
    assert.equal(parsed.product, 'inkhub', 'the product comes through');
    assert.equal(parsed.minBuild, 380, 'min_build is carried');
    assert.ok(
      new ManifestError('x') instanceof Error,
      'ManifestError is the error type',
    );
  });

  // The device updater's own artefacts are readable by the same reader, which
  // is the point of consuming this document rather than writing a second one.
  it("reads the device updater's own artefacts", () => {
    const bundle = readArtefact(parsed, 'bundle');
    assert.ok(bundle);
    assert.equal(bundle.size, 53420032, 'the bundle is readable by key');
    assert.equal(
      bundle.url,
      releaseArtefacts.bundle_url,
      'and its url is the release URL',
    );
  });

  it('reads the artefacts this page sends', () => {
    const live = readArtefact(parsed, 'live');
    assert.ok(live);
    assert.equal(live.size, 20172800, 'the live image is readable by key');
    assert.equal(live.encoding, 'raw', 'it is raw by default');

    const webRootfs = readArtefact(parsed, 'webp1');
    assert.ok(webRootfs);
    assert.equal(webRootfs.encoding, 'gzip', 'gzip encoding is read');
    assert.equal(
      webRootfs.sizeUncompressed,
      268435456,
      'the unpacked size is read',
    );
    assert.equal(
      webRootfs.sha256Uncompressed,
      '3'.repeat(64),
      'the unpacked checksum is read',
    );
  });

  it('reads an artefact the release does not carry as absent', () => {
    assert.equal(readArtefact(parsed, 'finisher'), null);
  });

  it('refuses a manifest it cannot read', () => {
    assert.throws(() => parseManifest(''), /empty/, 'an empty file is refused');
    assert.throws(
      () => parseManifest('not json'),
      /not valid JSON/,
      'a file that is not JSON is refused',
    );
    assert.throws(
      () => parseManifest('[]'),
      /top level/,
      'a JSON array is refused',
    );
    assert.throws(
      () =>
        parseManifest(
          JSON.stringify({
            schema: 99,
            version: '1.0.0',
            build: 1,
            artefacts: {},
          }),
        ),
      /newer than this page understands/,
      'a schema this page does not know is refused',
    );
    assert.throws(
      () =>
        parseManifest(
          JSON.stringify({
            schema: 1,
            product: 'something-else',
            version: '1.0.0',
            build: 1,
            artefacts: { a_url: '/x' },
          }),
        ),
      /not an inkhub one/,
      'a release of some other product is refused',
    );
    assert.throws(
      () =>
        parseManifest(
          JSON.stringify({
            schema: 1,
            version: '1.0.0',
            build: 1,
            artefacts: {},
          }),
        ),
      /no artefacts/,
      'a manifest with no artefacts is refused',
    );
    assert.throws(
      () =>
        parseManifest(
          JSON.stringify({
            schema: 1,
            version: 'latest',
            build: 1,
            artefacts: { a_url: '/x' },
          }),
        ),
      /not a version number/,
      'a version that is not a version number is refused',
    );
  });

  // The flat rule, which release.sh enforces on the way out and the device's
  // own reader depends on. A nested manifest would read fine here and not there.
  it('refuses a nested artefact, because the device reader cannot read one', () => {
    assert.throws(
      () =>
        parseManifest(
          manifestText({
            live: { url: '/dl/x.img', size: 10, sha256: 'e'.repeat(64) },
          }),
        ),
      /is nested/,
    );
  });

  it('refuses a broken artefact', () => {
    const bad = (extra: Record<string, unknown>, wanted: RegExp) => {
      assert.throws(() => {
        const m = parseManifest(manifestText({ ...webArtefacts, ...extra }));
        readArtefact(m, 'live');
      }, wanted);
    };

    bad({ live_sha256: undefined }, /must be a string/);
    bad({ live_sha256: 'abc' }, /64 hex characters/);
    bad({ live_url: 'http://example.com/x.img' }, /https/);
    bad({ live_url: '//example.com/x.img' }, /protocol-relative/);
    bad({ live_size: 0 }, /greater than zero/);
    bad({ live_size: 0x100000000 }, /does not fit/);
    bad({ live_encoding: 'xz' }, /raw or gzip/);
  });
});

describe('planning an action against a release', () => {
  it('offers Live from a release that carries the live image', () => {
    const livePlan = planArtefacts(profile, parsed, 'live');
    assert.ok(livePlan.ok, 'Live is possible from this release');
    assert.equal(livePlan.present.length, 1, 'Live sends one artefact');
    assert.equal(livePlan.present[0]?.name, 'live', 'and it is the live image');
  });

  // The three fastboot writes are a complete install, because the bootloader
  // writes the device tree's header sector itself out of the body sent to the
  // dtb target (DEVIATIONS 344). So a release with no check payload installs,
  // and the check is the only thing it does not get.
  it('offers an install from a release with no check payload', () => {
    const plan = planArtefacts(profile, parsed, 'install');
    assert.ok(
      plan.ok,
      'an install is offered by a release with no check payload',
    );
    assert.equal(plan.missing.length, 0, 'nothing an install needs is missing');
    assert.equal(plan.present.length, 3, 'it sends the three writes');
    assert.equal(plan.absent.length, 1, 'the one optional artefact is absent');
    assert.ok(
      plan.absent.some((a) => a.name === 'finisher'),
      'and it is the check',
    );
    assert.equal(
      plan.absent[0]?.asset,
      'fastboot-finish.img',
      'the absent artefact names the asset a release can carry',
    );
    assert.ok(
      plan.present.every((a) => a.optional === false),
      'and none of the three writes is the optional one',
    );
  });

  // The backup pass is not one of the install's artefacts at all. It has its
  // own action, it is sent by its own button before anything is written, and an
  // install plan that carried it would make hasCheck() say a release verifies
  // its own writing when it does no such thing.
  it('keeps the backup pass out of the install plan', () => {
    const plan = planArtefacts(profile, parsed, 'install');
    assert.ok(
      !plan.present.some((a) => a.name === 'backup') &&
        !plan.absent.some((a) => a.name === 'backup') &&
        !plan.missing.some((a) => a.name === 'backup'),
    );
  });

  it('verifies its own writing when the release carries the check', () => {
    const complete = parseManifest(
      manifestText({
        ...releaseArtefacts,
        ...webArtefacts,
        finisher_file: 'fastboot-finish.img',
        finisher_url: '/dl/fastboot-finish.img',
        finisher_size: 20000000,
        finisher_sha256: 'f'.repeat(64),
      }),
    );
    const plan = planArtefacts(profile, complete, 'install');
    assert.ok(plan.ok, 'a release carrying the check as well can install');
    assert.equal(plan.present.length, 4, 'an install sends four artefacts');
    assert.equal(plan.absent.length, 0, 'and nothing is absent from that one');
    assert.equal(
      plan.present.find((a) => a.name === 'finisher')?.optional,
      true,
      'and the check is the artefact marked optional',
    );
    assert.equal(
      plan.present.find((a) => a.name === 'rootfs')?.encoding,
      'gzip',
      'and the rootfs is sent unpacked',
    );
    assert.equal(
      plan.present.find((a) => a.name === 'kernel')?.url,
      '/dl/zImage',
      'the kernel sent is the bare zImage, not the slot image with its header',
    );
  });

  // The release fixture above carries neither the check nor the backup pass,
  // which is the state of every release published so far. A page offered a
  // backup it cannot fetch would be a page that lies about what it has.
  it('does not offer a backup pass a release does not carry', () => {
    assert.equal(
      readArtefact(parsed, 'backup'),
      null,
      'a release with no backup pass reads it as absent',
    );
    const plan = planArtefacts(profile, parsed, 'backup');
    assert.ok(!plan.ok, 'so the backup pass is not offered from that release');
    assert.equal(plan.missing.length, 1, 'and the one thing missing is named');
    assert.equal(plan.missing[0]?.name, 'backup', 'and it is the backup pass');
    assert.equal(
      plan.missing[0]?.asset,
      'fastboot-backup.img',
      'and the missing row names the asset a release would carry',
    );
  });

  it('runs the backup pass from a release that carries it', () => {
    const withBackup = parseManifest(
      manifestText({
        ...releaseArtefacts,
        ...webArtefacts,
        backup_file: 'fastboot-backup.img',
        backup_url: '/dl/fastboot-backup.img',
        backup_size: 21000000,
        backup_sha256: 'b'.repeat(64),
      }),
    );
    const plan = planArtefacts(profile, withBackup, 'backup');
    assert.ok(plan.ok, 'a release that carries it can run the pass');
    assert.equal(plan.present.length, 1, 'the pass sends one artefact');
    assert.equal(plan.present[0]?.name, 'backup', 'and it is the backup image');
    assert.equal(
      plan.present[0]?.url,
      '/dl/fastboot-backup.img',
      'fetched from the same-origin path the manifest names',
    );
    assert.equal(
      planArtefacts(profile, withBackup, 'install').present.length,
      3,
      'and carrying it changes nothing about the install',
    );
  });

  it('refuses an unknown action', () => {
    assert.throws(
      () => planArtefacts(profile, parsed, 'wipe' as ProfileAction),
      /backup, live or install/,
    );
  });
});

describe('the download size, against the device', () => {
  it('reads the buffer the device reported', () => {
    assert.equal(
      checkDownloadSize(268435456, '0x19000000'),
      0x19000000,
      'a 256 MiB partition image fits this bootloader',
    );
    assert.equal(
      checkDownloadSize(1024, '419430400'),
      419430400,
      'a decimal answer is read too',
    );
  });

  it('refuses more bytes than the bootloader accepts', () => {
    assert.throws(
      () => checkDownloadSize(0x19000001, '0x19000000'),
      /more than this bootloader accepts/,
    );
  });

  it('refuses a device that reported no buffer size', () => {
    assert.throws(() => checkDownloadSize(1024, ''), /did not report/);
  });

  it('refuses an unreadable buffer size', () => {
    assert.throws(() => checkDownloadSize(1024, 'plenty'), /could not read/);
  });
});
