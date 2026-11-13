// What follows the tab on screen: the registry's history, which `⌃o` and `⌃i` walk one view at a
// time, so each layer of a stack has its own, and the window's title.

import type { Registry } from '@lo/ui/commands';
import type { StoreApi } from 'zustand/vanilla';

import { viewIds } from '../contract.ts';
import { activeOf, tabOnScreen, type TabsState } from './store.ts';
import { windowTitle } from './title.ts';

/**
 * Keeps `registry` and the window's title in step with the tabs in `store`: a view shown walks its
 * own history (and drops any keys held for the last one), a closed tab's views' histories go, and
 * the window is titled after the tab on screen. Returns a function that stops it.
 */
export function follow(
  registry: Registry,
  store: StoreApi<TabsState>,
  setTitle: (title: string) => void,
): () => void {
  return store.subscribe((next, previous) => {
    const open = new Set(viewIds(next.tabs));
    for (const id of viewIds(previous.tabs)) {
      if (!open.has(id)) registry.history.close(id);
    }
    const shown = activeOf(next)?.id ?? next.active;
    const before = activeOf(previous)?.id ?? previous.active;
    if (shown !== undefined && shown !== before) registry.tab(shown);
    setTitle(windowTitle(tabOnScreen(next)));
  });
}
