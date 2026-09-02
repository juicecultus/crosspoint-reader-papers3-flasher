// The tab strip, and the links into it.
//
// Ported from the tab-strip block of web/installer/tests/run.js. The assertions
// that read the static page's markup are gone with the markup: the strip is
// Chakra's now. What survives is what a fragment does, which is a pure function
// and can be asked here rather than in a browser, plus the check that the page
// and this module still agree about the four names.

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { tabFromHash, TAB_NAMES } from '../tabs.ts';

const page = readFileSync(
  new URL('../../app/kobo-libra2/page.tsx', import.meta.url),
  'utf8',
);

describe('the tab strip', () => {
  it('is Try it, Install, Go back to Kobo and Help', () => {
    assert.equal(TAB_NAMES.join(','), 'try,install,back,help');
  });

  // One list of tabs and not two. A name here with no trigger and panel in the
  // page is a link that opens nothing.
  it('names a tab the page draws', () => {
    for (const name of TAB_NAMES) {
      assert.ok(
        page.includes(`<Tabs.Trigger value="${name}">`),
        `the ${name} tab has a trigger`,
      );
      assert.ok(
        page.includes(`<Tabs.Content value="${name}">`),
        `the ${name} tab has a panel`,
      );
    }
  });

  it('reads the labels a reader clicks', () => {
    for (const label of ['Try it', 'Install', 'Go back to Kobo', 'Help']) {
      assert.ok(page.includes(label), `the strip says ${label}`);
    }
  });
});

// A link into a tab. This is the whole of what a fragment does.
describe('a link into a tab', () => {
  it('#install opens the Install tab', () => {
    assert.equal(tabFromHash('#install', TAB_NAMES), 'install');
  });

  it('#back opens the Go back to Kobo tab', () => {
    assert.equal(tabFromHash('#back', TAB_NAMES), 'back');
  });

  it('#help opens the Help tab', () => {
    assert.equal(tabFromHash('#help', TAB_NAMES), 'help');
  });

  it('a bare visit opens the first tab', () => {
    assert.equal(tabFromHash('', TAB_NAMES), 'try');
  });

  it('and so does a fragment for a tab that is not there', () => {
    assert.equal(tabFromHash('#nonsense', TAB_NAMES), 'try');
  });

  it('and so does no fragment at all', () => {
    assert.equal(tabFromHash(null, TAB_NAMES), 'try');
    assert.equal(tabFromHash(undefined, TAB_NAMES), 'try');
  });

  it('reads a fragment written without its hash', () => {
    assert.equal(tabFromHash('help', TAB_NAMES), 'help');
  });

  it('knows the four names without being told them', () => {
    assert.equal(tabFromHash('#back'), 'back');
    assert.equal(tabFromHash('#nonsense'), 'try');
  });
});

// The two directions the fragment moves in. Both are the hook's, and both are
// asserted on the source, because a jsdom is a dependency this site does not
// carry for one hook.
describe('the fragment and the open tab', () => {
  const hook = readFileSync(
    new URL('../useTabHash.ts', import.meta.url),
    'utf8',
  );

  it('reopens a tab when the fragment changes', () => {
    assert.ok(hook.includes("'hashchange'"));
  });

  it('writes the fragment when a tab is chosen', () => {
    assert.ok(hook.includes('window.location.hash = next'));
  });

  it('reads the fragment after mount, not during the server render', () => {
    assert.ok(hook.includes('useEffect'));
    assert.ok(!/useState\(\(\) => tabFromHash\(window/.test(hook));
  });

  it('is what the page drives its strip with', () => {
    assert.ok(page.includes('useTabHash(TAB_NAMES)'));
    assert.ok(page.includes('value={tab}'));
    assert.ok(page.includes('onValueChange={(event) => show(event.value)}'));
  });
});
