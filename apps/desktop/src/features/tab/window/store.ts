// The tabs as the window knows them, and what main last said of each view of a pull request's tab.
// Only the tab feature writes here; other features read them through `shared.ts`.

import { createStore } from 'zustand/vanilla';

import {
  onScreen,
  viewIds,
  type Files,
  type Local,
  type LocalState,
  type PullView,
  type Tab,
  type Tabs,
} from '../contract.ts';

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

/** The tab on screen in `state`, as main sent it. */
export function tabOnScreen({ tabs, active }: TabsState): Tab | undefined {
  return tabs.find((tab) => tab.id === active);
}

/** Each tab main sent as its view on screen, made once, so what compares them sees no change. */
const onScreenViews = new WeakMap<Tab, Tab>();

/**
 * The tab on screen in `state`, as features that follow it see it: a pull request's tab as its view
 * on screen, by that view's id and its layer's number.
 */
export function activeOf(state: TabsState): Tab | undefined {
  const tab = tabOnScreen(state);
  if (!tab) return undefined;
  let view = onScreenViews.get(tab);
  if (!view) {
    view = onScreen(tab);
    onScreenViews.set(tab, view);
  }
  return view;
}

/** What main last said of each view of a pull request's tab, by the view's id. */
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

/** Keeps what main said of a view of a pull request's tab, while the tab is open. */
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

/**
 * Whether `id` is a view of an open tab, as far as the window knows: a tab still opening counts.
 */
function isOpen(id: string): boolean {
  const { tabs } = tabsStore.getState();
  return tabs.length === 0 || viewIds(tabs).includes(id);
}

// A closed tab's views go with it.
tabsStore.subscribe((next) => {
  const open = new Set(viewIds(next.tabs));
  const { views, files, locals } = pullsStore.getState();
  const keep = <T>(map: ReadonlyMap<string, T>) => new Map([...map].filter(([id]) => open.has(id)));
  if ([...views.keys(), ...files.keys(), ...locals.keys()].every((id) => open.has(id))) return;
  pullsStore.setState({ views: keep(views), files: keep(files), locals: keep(locals) });
});
