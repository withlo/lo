// What follows the tab on screen: the registry's history, which `⌃o` and `⌃i` walk one tab at a
// time, and the window's title.

import type { Registry } from '@lo/ui/commands';
import type { StoreApi } from 'zustand/vanilla';

import { activeOf, type TabsState } from './store.ts';
import { windowTitle } from './title.ts';

/**
 * Keeps `registry` and the window's title in step with the tabs in `store`: a tab shown walks its
 * own history (and drops any keys held for the last one), a closed tab's history goes, and the
 * window is titled after the tab on screen. Returns a function that stops it.
 */
export function follow(
  registry: Registry,
  store: StoreApi<TabsState>,
  setTitle: (title: string) => void,
): () => void {
  return store.subscribe((next, previous) => {
    const open = new Set(next.tabs.map(({ id }) => id));
    for (const { id } of previous.tabs) {
      if (!open.has(id)) registry.history.close(id);
    }
    if (next.active !== undefined && next.active !== previous.active) registry.tab(next.active);
    setTitle(windowTitle(activeOf(next)));
  });
}
