// The tabs as the window knows them, and what main last said of each pull request's tab. Only the
// tab feature writes here; other features read them through `shared.ts`.

import { createStore } from 'zustand/vanilla';

import type { Files, Local, LocalState, PullView, Tab, Tabs } from '../contract.ts';

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

/** What main last said of each pull request's tab, by the tab's id. */
export interface PullsState {
  readonly views: ReadonlyMap<string, PullView>;
  readonly files: ReadonlyMap<string, Files>;
  readonly locals: ReadonlyMap<string, LocalState>;
}

export const pullsStore = createStore<PullsState>()(() => ({
  views: new Map(),
  files: new Map(),
  locals: new Map(),
}));

/** Keeps what main said of a pull request's tab, while the tab is open. */
export function showPull(view: PullView): void {
  if (!isOpen(view.id)) return;
  const { views } = pullsStore.getState();
  pullsStore.setState({ views: new Map(views).set(view.id, view) });
}

export function showFiles(files: Files): void {
  if (!isOpen(files.id)) return;
  const state = pullsStore.getState();
  pullsStore.setState({ files: new Map(state.files).set(files.id, files) });
}

export function showLocal({ id, state }: Local): void {
  if (!isOpen(id)) return;
  const { locals } = pullsStore.getState();
  pullsStore.setState({ locals: new Map(locals).set(id, state) });
}

/** Whether `id` is an open tab, as far as the window knows: a tab still opening counts. */
function isOpen(id: string): boolean {
  const { tabs } = tabsStore.getState();
  return tabs.length === 0 || tabs.some((tab) => tab.id === id);
}

// A closed tab's pull request goes with it.
tabsStore.subscribe((next) => {
  const open = new Set(next.tabs.map(({ id }) => id));
  const { views, files, locals } = pullsStore.getState();
  const keep = <T>(map: ReadonlyMap<string, T>) => new Map([...map].filter(([id]) => open.has(id)));
  if ([...views.keys(), ...files.keys(), ...locals.keys()].every((id) => open.has(id))) return;
  pullsStore.setState({ views: keep(views), files: keep(files), locals: keep(locals) });
});
