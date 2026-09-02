// What the page says, and the house style it says it in.
//
// The copy is the product here. The static installer's tests read index.html;
// this route has no index.html, so these read the page source instead. They are
// the sentences a reader is owed, each said once, and the ones that used to
// lecture and are not coming back.

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const page = read('../../app/kobo-libra2/page.tsx');
const hook = read('../useKoboOperations.ts');

// JSX wraps where prettier likes, so the copy is read with its whitespace
// flattened and its entities put back. A sentence broken across two lines is
// the same sentence.
const prose = page.replace(/&apos;/g, "'").replace(/\s+/g, ' ');

describe('the page copy', () => {
  // The button sequence, once, with the hold and the dark screen in it.
  it('writes the fastboot sequence once', () => {
    assert.equal(
      (prose.match(/TOP page-turn button/g) || []).length,
      1,
      'the fastboot sequence is written once',
    );
    assert.ok(
      prose.includes('Power the device fully off.'),
      'the device goes fully off first',
    );
    assert.ok(
      prose.includes('for ten seconds'),
      'and it holds the top button for ten seconds',
    );
    assert.ok(
      prose.includes('The screen stays dark'),
      'and it says the screen stays dark',
    );
  });

  // The warning that keeps a reader off Kobo's factory-restore gesture is a
  // fact about the device, so it lives in the profile and the page draws it.
  it('draws the entry warnings from the profile', () => {
    const profile = read('../devices/kobo-libra2.json');
    assert.ok(
      profile.includes('Do not hold power together with a page key'),
      'the profile carries the warning',
    );
    assert.ok(
      page.includes('profile.entry.warnings.map'),
      "and the page draws the profile's warnings rather than its own",
    );
  });

  it('says the things a reader is owed', () => {
    assert.ok(prose.includes('Your books stay'), 'your books stay');
    assert.ok(
      prose.includes('reading positions and annotations do not come across'),
      'Kobo reading positions and annotations do not come across',
    );
    assert.ok(
      prose.includes('panel calibration'),
      'the panel calibration is never touched',
    );
    assert.ok(
      prose.includes('Device information'),
      'the way back is one action in Settings',
    );
    assert.ok(
      prose.includes('erases the device the way a Kobo factory reset does'),
      'and it erases the device the way a Kobo factory reset does',
    );
    assert.ok(
      prose.includes('asks once whether to allow the new device'),
      'a Mac asks once',
    );
    assert.ok(
      prose.includes('writes nothing at all until every answer matches'),
      'the page refuses to write until the device is a Libra 2',
    );
    assert.ok(prose.includes('Safari has no WebUSB'), 'Safari cannot do this');
    assert.ok(prose.includes('we have not tested it'), 'Windows is untested');
    assert.ok(
      prose.includes('the first start is the check'),
      'and it says what happens when a release carries no check',
    );
  });

  // The backup pass, in the words the committed static page uses for it.
  it('offers the backup pass in the Install tab', () => {
    assert.ok(prose.includes('Back up first'), 'the card is Back up first');
    assert.ok(
      prose.includes('Writes one folder to your own card'),
      'and it says what it writes',
    );
    assert.ok(
      prose.includes('Back up the device'),
      'and the button is Back up the device',
    );
    assert.ok(
      prose.includes(
        "The device copies Kobo's own system and the two files Bluetooth needs",
      ),
      'and it says what the device copies',
    );
    assert.ok(
      prose.includes('Why this means starting again afterwards'),
      'and it says the button sequence is done twice',
    );
    assert.ok(
      prose.includes('Bluetooth works when you run the backup pass first'),
      'and Help says Bluetooth depends on that pass',
    );
  });

  it('asks for a typed word before an install', () => {
    assert.ok(
      prose.includes('Type <b>install</b> to start.'),
      'an install asks for a typed word',
    );
    assert.ok(
      page.includes("typed.trim().toLowerCase() === 'install'"),
      'and the button is out of reach until it is typed',
    );
  });

  // The amber box. It told a reader that the project's rule was that they take
  // a backup a browser cannot take, which is a lecture and is not coming back.
  it('does not lecture', () => {
    assert.ok(
      !prose.includes('A browser cannot take a backup'),
      'the page does not tell a reader a browser cannot take the backup they must have',
    );
    assert.ok(
      !prose.includes("the project's own rule"),
      "and it does not appeal to the project's own rule",
    );
    assert.ok(
      !/\byou must\b/i.test(prose),
      'nothing on the page tells a reader what they must do',
    );
    assert.ok(
      prose.includes('You do not need a backup to come back'),
      'the backup paragraph says a reader does not need one',
    );
  });

  // It used to say a browser could not finish an install on its own, which was
  // wrong: the bootloader writes that sector itself (DEVIATIONS 344). A page
  // that says it again is a page that talks a reader out of an install that
  // works.
  it('does not say the browser cannot write the last sector', () => {
    assert.ok(!prose.includes('Write the last sector.'));
  });

  // The factory-restore gesture does not fire on a device carrying our images
  // (DEVIATIONS 347), so nothing that drives the cable may send a reader to it
  // as a way out.
  it('does not send anybody to the factory-restore gesture', () => {
    assert.ok(!/factory restore/i.test(hook));
  });
});

// The bar across the top says which device you are on. The Libra 2 has one page
// rather than a Flash and a Debug page, and the bar names it either way.
describe('the header bar', () => {
  const bar = read('../../components/HeaderBar/HeaderBar.tsx');

  it('knows the Kobo Libra 2', () => {
    assert.ok(
      bar.includes("base: '/kobo-libra2'"),
      'the route is in the table',
    );
    assert.ok(bar.includes("label: 'Kobo Libra 2'"), 'and it names the device');
  });

  it('offers the one page this device has', () => {
    assert.ok(
      bar.includes("pages: [{ href: '/kobo-libra2', label: 'Install' }]"),
      'one entry, not a Flash and Debug pair',
    );
    assert.ok(
      !bar.includes('/kobo-libra2/debug'),
      'and no debug page, because there is none',
    );
  });

  it('still names the other two devices', () => {
    for (const label of ['Xteink X3', 'Paper S3']) {
      assert.ok(bar.includes(label), `the bar still names the ${label}`);
    }
    assert.ok(
      bar.includes("{ href: '/x3/debug', label: 'Debug' }"),
      'and they keep their debug page',
    );
  });

  it('still says what to do when no device is chosen', () => {
    assert.ok(bar.includes('Select a device to get started'));
  });
});

describe('house style', () => {
  const files = [
    '../fastboot.ts',
    '../manifest.ts',
    '../offers.ts',
    '../profile.ts',
    '../release.ts',
    '../koboLibra2.ts',
    '../useKoboOperations.ts',
    '../tabs.ts',
    '../useTabHash.ts',
    '../webusb.d.ts',
    '../devices/kobo-libra2.json',
    '../../app/kobo-libra2/page.tsx',
    '../../app/kobo-libra2/layout.tsx',
    '../../app/dl/[asset]/route.ts',
    '../../components/HeaderBar/HeaderBar.tsx',
    '../../components/ActionCard/ActionCard.tsx',
    '../../components/Disclosure/Disclosure.tsx',
    '../../components/VersionMeta/VersionMeta.tsx',
    '../../../next.config.ts',
  ];

  for (const file of files) {
    it(`${file} has no em-dash`, () => {
      // The character itself, by its code point, so a grep for an em-dash over
      // this repository does not stop on the test that forbids one.
      assert.ok(!read(file).includes('\u2014'));
    });
  }
});
