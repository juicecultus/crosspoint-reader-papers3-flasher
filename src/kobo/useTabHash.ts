'use client';

// The fragment and the open tab, kept in step.
//
// Reading it: the fragment is the browser's, so the first render is the first
// tab on the server and on the client alike, and the effect corrects it after
// mount. That way a deep link opens its tab without the markup disagreeing with
// itself on the way in.
//
// Writing it: choosing a tab sets the fragment, so the address bar always names
// what is on screen and the page can be linked to from where it stands. Setting
// it fires hashchange, which lands back on the same value, so the two
// directions do not fight.

import { useEffect, useState } from 'react';
import { tabFromHash, TAB_NAMES } from './tabs.ts';

export function useTabHash(names: readonly string[] = TAB_NAMES) {
  const [tab, setTab] = useState(() => tabFromHash('', names));

  useEffect(() => {
    const open = () => setTab(tabFromHash(window.location.hash, names));
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [names]);

  const show = (next: string) => {
    setTab(next);
    window.location.hash = next;
  };

  return { tab, show };
}
