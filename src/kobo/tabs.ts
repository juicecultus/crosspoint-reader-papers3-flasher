// tabs.ts - which tab a link opens.
//
// The static page carried this as tabFromHash() in app.js, because the strip
// was hand-wired there and a fragment was the only way to link into a tab. The
// strip is Chakra's now and the wiring is gone, but the links are not: a
// fragment is what somebody pastes into an issue or a forum post when they mean
// "the Install tab", and it has to keep working.
//
// A pure function over text, so the tests can ask it rather than a browser.

// The four tabs, in the order the strip draws them. The first is what a bare
// visit gets.
export const TAB_NAMES = ['try', 'install', 'back', 'help'] as const;

export type TabName = (typeof TAB_NAMES)[number];

// An unknown fragment opens the first tab, which is what a bare visit gets too.
// Nothing here throws: a bad fragment is a reader's typo, not a fault.
export function tabFromHash(
  hash: string | null | undefined,
  names: readonly string[] = TAB_NAMES,
): string {
  const wanted = String(hash || '').replace(/^#/, '');
  return names.includes(wanted) ? wanted : (names[0] ?? '');
}
