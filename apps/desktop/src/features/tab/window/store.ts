// The tabs as the window knows them: what main last said. Only the tab feature writes here; other
// features read the tabs through `shared.ts`.

import { createStore } from 'zustand/vanilla';

import type { Tab, Tabs } from '../contract.ts';

export interface TabsState {
  /** The tabs in the strip's order: none only until main first says. */
  readonly tabs: readonly Tab[];
  /** The tab on screen: undefined only until main first says. */
  readonly active: string | undefined;
}

export const tabsStore = createStore<TabsState>()(() => ({ tabs: [], active: undefined }));

/** Shows the tabs main sent. */
export function showTabs({ tabs, active }: Tabs): void {
  tabsStore.setState({ tabs, active }, true);
}

/** The tab on screen in `state`. */
export function activeOf({ tabs, active }: TabsState): Tab | undefined {
  return tabs.find((tab) => tab.id === active);
}
