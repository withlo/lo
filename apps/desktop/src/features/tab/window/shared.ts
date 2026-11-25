// What the tab feature shares with other features' window code: the tabs and the one on screen,
// and a way to show another; state a feature keeps for each tab; and the slot each kind of tab
// draws what it holds in. A pull request's tab holds a view of each layer of a stack the reader has
// shown; what's shared names it by its view on screen, so what follows the tab on screen follows
// the layer on screen.

import type { Handler, NoTarget } from '@lo/ui/commands';
import { createElement, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { defineSlot } from '../../../window/slots.tsx';
import {
  runViewId,
  viewIds,
  type Files,
  type LocalState,
  type PullView,
  type Run,
  type Tab,
} from '../contract.ts';
import { blocked } from './banners.ts';
import { makeTabState, type TabState, useKept } from './kept.ts';
import { panelDrawn } from './layout.ts';
import { main } from './main.ts';
import {
  INSTEAD,
  keptRight,
  middleIds,
  middleOf,
  opening,
  panels,
  putRightBack,
  rightIds,
  showRightView,
  type Panels,
  type RightKept,
} from './panels.ts';
import { Placeholder } from './Placeholder.tsx';
import { activeOf, pullsStore, tabsStore, type TabsState } from './store.ts';

export type {
  Acting,
  Connection,
  Files,
  Header,
  Kind,
  LocalState,
  Problem,
  PullView,
  Run,
  Tab,
} from '../contract.ts';
export type { RightKept } from './panels.ts';
export type { TabsState } from './store.ts';

/**
 * A pull request's tab, as what's shared names it: by its view on screen, that view's id and its
 * layer's number.
 */
export type PullTab = Extract<Tab, { kind: 'pull' }>;

/**
 * Where each kind of tab draws what it holds, under the strip. The feature that owns a kind puts
 * one view here, which draws a tab of its kind and nothing for the others: Settings' for
 * `settings`, the Recent list's for `recent`. Only the tab on screen is drawn, a pull request's as
 * its view on screen, and drawn afresh each time it's shown, so a view keeps what it needs across
 * switches in a {@link tabState}.
 */
export const kinds = defineSlot<{ tab: Tab }>('tab.kinds');

/**
 * What covers the tab on screen, whatever its kind, such as the welcome screen while no account is
 * signed in. A view here draws itself over the tab, or nothing when it doesn't apply.
 */
export const cover = defineSlot<{ tab: Tab }>('tab.cover');

/** What sits at the end of the strip of tabs, after the room the tabs take: the gear for Settings. */
export const stripEnd = defineSlot('tab.stripEnd');

/** What goes on a pull request's header's second row, after its branches: the revision picker. */
export const header = defineSlot<{ tab: PullTab }>('tab.header');

/**
 * Whether a pull request can merge, on its header's first row, between the connection chip and
 * the account: the merge status, and what it opens.
 */
export const headerStatus = defineSlot<{ tab: PullTab }>('tab.headerStatus');

/**
 * What a view's banner says for a tab while it draws one: how urgent it is (`tone`, as the banner
 * draws it), and its title, as the banner shows it.
 */
export interface BannerSaid {
  readonly tone: 'info' | 'warn' | 'danger';
  readonly title: string;
}

/**
 * What a view in {@link banners} says of itself, so a tab makes room only for the banners it has,
 * puts them in order and tells a screen reader of one that arrives behind the one shown: what it
 * draws for a tab now, and when that may change.
 */
export interface BannerSwitch {
  /** What the view's banner for `tab` says now, or nothing while it draws none. */
  readonly said: (tab: PullTab) => BannerSaid | undefined;
  /**
   * Calls `listener` when `said` may say otherwise for `tab`, which is on screen until it stops.
   * Returns a function that stops it.
   */
  readonly subscribe: (tab: PullTab, listener: () => void) => () => void;
}

/**
 * Banners of other features' about a pull request's tab, beside Lo's own: a view draws one banner
 * while it says one, and nothing otherwise. The tab shows one at a time, the most urgent first,
 * then in the slot's order, Lo's own first.
 */
export const banners = defineSlot<{ tab: PullTab }, BannerSwitch>('tab.banners');

/** The left panel of a pull request's tab: the stack, then the files. */
export const left = defineSlot<{ tab: PullTab }>('tab.left');

/**
 * What the header's view switch shows of a middle view. A view with no `label` isn't in the switch,
 * though `` ` `` and `~` still step to it.
 */
export interface MiddleSwitch {
  /** Its name in the switch, a word or two: "Diff". */
  readonly label?: string | undefined;
  /**
   * What goes before its name for a tab, such as whether the tab's pull request has an overview.
   * It says what it means itself, to a screen reader too.
   */
  readonly mark?: ((props: { tab: PullTab }) => ReactNode) | undefined;
}

/**
 * The middle of a pull request's tab: its overview, its diff or its timeline. Each view here is
 * one of the middle views, in order; `` ` `` and `~` go from one to the next, and the header's view
 * switch lists those with a label. One is on screen at a time, and `shown` says which: a view the
 * tab has shown stays drawn, hidden, while another is on screen, so coming back to it is instant
 * and finds it as it was. A hidden view keeps its keys, its focus and its place in the window's
 * history to itself until it's shown again. The tab opens on the one Settings names, and shows the
 * timeline in place of one that isn't there, or has nothing to show as it opens ({@link showInstead}).
 * A view that comes and goes, as the overview's does with Overview, takes `present`.
 */
export const middle = defineSlot<{ tab: PullTab; shown: boolean }, MiddleSwitch>('tab.middle');

/**
 * What the middle says while there's nothing to show yet: that the pull request is opening, or
 * `status`, what the view reads once it's there. A middle view that waits before it has anything
 * to draw draws this meanwhile, so the tab looks as it does with no view at all, and waits once.
 */
export function MiddlePlaceholder({
  tab,
  status,
}: {
  tab: PullTab;
  status?: string | undefined;
}): ReactNode {
  return createElement(Placeholder, { tab: tab.id, status });
}

/**
 * Shows the middle view `id`, one of those in {@link middle}, in pull request's tab `tab`, as
 * `` ` `` and `~` step to it. Says whether the tab has it. A view that shows something another
 * feature asks for, such as a file whole, calls this to come on screen.
 */
export function showMiddle(tab: string, id: string): boolean {
  if (!middleIds.ids.includes(id)) return false;
  if (panels.get(tab).middle !== id) panels.update(tab, (current) => ({ ...current, middle: id }));
  return true;
}

/**
 * Shows the view pull request's tab `tab` opens on in place of the one Settings names, when that one
 * has nothing to show: the timeline, where the description is first, as Overview does for a pull
 * request with no overview. Says whether the tab has it.
 */
export function showInstead(tab: string): boolean {
  return showMiddle(tab, INSTEAD);
}

/**
 * The middle view pull request's tab `tab` opened on, by id, or is opening on as it's first drawn:
 * nothing before it's drawn. A view drawn as the tab opens is the one when it's this.
 */
export function openedOn(tab: string): string | undefined {
  return panels.get(tab).opened ?? opening.get(tab);
}

/** The id of the middle view on screen in pull request's tab `tab`. */
export function middleShown(tab: string): string | undefined {
  return middleOf(panels.get(tab).middle ?? opening.get(tab), middleIds.ids, undefined);
}

/** The pull request's tab on screen, or why there's none. */
function pullOnScreen(): PullTab | string {
  const tab = activeTab();
  return tab?.kind === 'pull' ? tab : 'Open a pull request first';
}

/**
 * The handler of a command that shows the middle view `id` in the pull request's tab on screen, as
 * its segment of the header's switch does: an option of a choice, checked while it's on screen.
 */
export function showingMiddle(id: string): Handler<NoTarget> {
  return {
    run() {
      const tab = pullOnScreen();
      if (typeof tab !== 'string') showMiddle(tab.id, id);
    },
    enabled() {
      const tab = pullOnScreen();
      if (typeof tab === 'string') return tab;
      return middleIds.ids.includes(id) || '';
    },
    checked() {
      const tab = pullOnScreen();
      return typeof tab !== 'string' && middleShown(tab.id) === id;
    },
  };
}

/**
 * The id of the middle view on screen in pull request's tab `tab`, and of each of the tab's middle
 * views in their order, re-rendering when another is shown.
 */
export function useMiddle(tab: string): { shown: string | undefined; ids: readonly string[] } {
  const chosen = useTabState(panels, tab, (value: Panels) => value.middle);
  const { ids } = middleIds;
  return { shown: middleOf(chosen ?? opening.get(tab), ids, undefined), ids };
}

/**
 * Across the top of a pull request's tab's middle, over whichever of its views is on screen: what
 * says the middle shows something other than the pull request's own diff, as the bar over a run of
 * a stack's layers does. A view here draws nothing when it doesn't apply.
 */
export const over = defineSlot<{ tab: PullTab }>('tab.over');

/** What the header's toggle for the right panel shows of a view in it, and what it's called. */
export interface RightToggle {
  /**
   * What goes after the toggle's icon for a tab, such as how many of its threads are unresolved.
   * It says what it means itself, to a screen reader too.
   */
  readonly count?: ((props: { tab: PullTab }) => ReactNode) | undefined;
  /** What the panel is while it shows this view, to a screen reader: "Threads", "References". */
  readonly label: string;
}

/**
 * The right panel of a pull request's tab: one of its views at a time, the threads first. It's
 * open or closed for the whole window, by `⌘⇧\` or the header's toggle, each tab showing the
 * view it showed last, and takes focus as it opens: its element named by `data-lo-scope`. Another
 * view comes with `showRight`. Opening or closing it changes the middle's width, as the left panel
 * does.
 */
export const right = defineSlot<{ tab: PullTab }, RightToggle>('tab.right');

/**
 * Shows view `id` of the right panel in pull request's tab `tab`, opening the panel if it's
 * closed, and focus goes into it as it's drawn, unless `focus` is false; or, with none, closes the
 * panel, and focus in it goes back to the middle view. `⌘⇧\` opens it on the view shown last.
 */
export function showRight(tab: string, id: string | undefined, focus = true): void {
  showRightView(tab, id, focus);
}

/** How pull request's tab `tab`'s right panel stands now, for `putRight` to put back. */
export function rightKept(tab: string): RightKept {
  return keptRight(tab);
}

/**
 * Puts pull request's tab `tab`'s right panel back as `kept` had it, on its view, open or closed,
 * without taking focus; closing, focus in it goes back to the middle view.
 */
export function putRight(tab: string, kept: RightKept): void {
  putRightBack(tab, kept);
}

/** The view pull request's tab `tab`'s right panel shows, by id, or none while it isn't drawn. */
export function rightShown(tab: string): string | undefined {
  if (!panelDrawn('threads') || rightIds.length === 0) return undefined;
  const chosen = panels.get(tab).right;
  return chosen !== undefined && rightIds.includes(chosen) ? chosen : rightIds[0];
}

/** Items in a pull request's tab's status bar, after Lo's own. */
export const status = defineSlot<{ tab: PullTab }>('tab.status');

export { withoutBidi } from '../../../ipc/cause.ts';

/** What main last said of a view of a pull request's tab, re-rendering when it changes. */
export function usePull(tab: string): PullView | undefined {
  return useStore(pullsStore, (state) => state.views.get(tab));
}

/**
 * Whether tab `tab` can't show its pull request now, so why takes its view's place, and what's
 * around the view, such as the files beside it, has nothing to show or act on. Re-renders when that
 * changes.
 */
export function useBlocked(tab: string): boolean {
  return useStore(pullsStore, (state) => blocked(state.views.get(tab)));
}

/** A pull request's tab's local copy, re-rendering when it changes. */
export function useLocalCopy(tab: string): LocalState | undefined {
  return useStore(pullsStore, (state) => state.locals.get(tab));
}

/** The files a pull request's tab's pull request changes, re-rendering when they change. */
export function useChangedFiles(tab: string): Files | undefined {
  return useStore(pullsStore, (state) => state.files.get(tab));
}

/** What main last said of a pull request's tab, read once. */
export function pullOf(tab: string): PullView | undefined {
  return pullsStore.getState().views.get(tab);
}

/** A pull request's tab's local copy, as main last said, read once. */
export function localCopyOf(tab: string): LocalState | undefined {
  return pullsStore.getState().locals.get(tab);
}

/**
 * Calls `listener` with a pull request's tab and its local copy each time main says it anew.
 * Returns a function that stops it.
 */
export function onLocalCopy(listener: (tab: string, local: LocalState) => void): () => void {
  return pullsStore.subscribe((next, previous) => {
    if (next.locals === previous.locals) return;
    for (const [tab, local] of next.locals) {
      if (previous.locals.get(tab) !== local) listener(tab, local);
    }
  });
}

/** The files a pull request's tab's pull request changes, as main last said, read once. */
export function changedFiles(tab: string): Files | undefined {
  return pullsStore.getState().files.get(tab);
}

/**
 * Calls `listener` with a pull request's tab and its changed files each time main says them anew.
 * Returns a function that stops it.
 */
export function onChangedFiles(listener: (tab: string, files: Files) => void): () => void {
  return pullsStore.subscribe((next, previous) => {
    if (next.files === previous.files) return;
    for (const [tab, files] of next.files) {
      if (previous.files.get(tab) !== files) listener(tab, files);
    }
  });
}

/** The run of a stack's layers that view `id` of a pull request's tab shows as one diff, if any. */
function runIn(tabs: readonly Tab[], id: string): Run | undefined {
  for (const tab of tabs) {
    if (tab.kind === 'pull' && tab.run && runViewId(tab, tab.run.layers) === id) return tab.run;
  }
  return undefined;
}

/**
 * The run of a stack's layers view `id` shows as one diff, read once: nothing for a view of one
 * layer. A view of a run marks no file viewed and compares no revisions, and has no overview.
 */
export function runOf(id: string): Run | undefined {
  return runIn(tabsStore.getState().tabs, id);
}

/** The run of a stack's layers view `id` shows as one diff, re-rendering when that changes. */
export function useRun(id: string): Run | undefined {
  return useStore(tabsStore, (state) => runIn(state.tabs, id));
}

/**
 * Shows the tab that holds view `id`, as a click on it in the strip does, for what opens in it to
 * be seen: settled once main has done so, or at once where it's on screen or no tab holds it.
 */
export async function showTabOf(id: string): Promise<void> {
  const { tabs, active } = tabsStore.getState();
  const held = tabs.find((tab) => viewIds([tab]).includes(id));
  if (!held || held.id === active) return;
  await main().select({ id: held.id });
}

function runLayersIn(tabs: readonly Tab[], id: string): string {
  for (const tab of tabs) {
    if (tab.kind !== 'pull' || !tab.run || runViewId(tab, tab.run.layers) !== id) continue;
    const stack = tab.stack?.layers ?? [];
    const [bottom] = tab.run.layers;
    const top = tab.run.layers.at(-1);
    const first = bottom === undefined ? -1 : stack.indexOf(bottom);
    const last = top === undefined ? -1 : stack.indexOf(top);
    if (first >= 0 && last >= 0) return `layers ${first + 1}–${last + 1}`;
  }
  return 'these layers';
}

/**
 * The layers the run view `id` shows as one diff spans, by their places in its tab's stack, bottom
 * first: "layers 2–3", or "these layers" while the stack doesn't hold them. The empty states of
 * other views name it so, since each layer has its own. Re-renders when the stack arrives.
 */
export function useRunLayers(id: string): string {
  return useStore(tabsStore, (state) => runLayersIn(state.tabs, id));
}

/**
 * The id the view of a run of `layers`, bottom first, would have in the pull request's tab that
 * holds view `id`, before main has made it: nothing when no tab holds that view.
 */
export function runViewOf(id: string, layers: readonly number[]): string | undefined {
  const held = tabsStore.getState().tabs.find((tab) => viewIds([tab]).includes(id));
  return held && runViewId(held, layers);
}

/**
 * Dialogs over the whole window, whatever tab is on screen: signing in, say. A feature puts one view
 * here, which draws its dialogs while they're open and nothing otherwise.
 */
export const dialogs = defineSlot('tab.dialogs');

/**
 * Toasts that wait for the reader, in the window's toast region below a note that passes: an update
 * on offer, say. A view here draws its toast while it has something to say and nothing otherwise.
 * It never takes focus and stays until it's acted on, so a toast that the reader may leave must say
 * so itself, with a button for it.
 */
export const toasts = defineSlot('tab.toasts');

/**
 * The tabs in the strip and the one on screen, as main sent them, re-rendering when they change: a
 * pull request's tab by its own id, with the layers it has views of.
 */
export function useTabs(): TabsState {
  return useStore(tabsStore);
}

/**
 * The tab on screen, a pull request's as its view on screen, re-rendering when another tab or layer
 * is shown.
 */
export function useActiveTab(): Tab | undefined {
  return useStore(tabsStore, activeOf);
}

/** The tab on screen now, a pull request's as its view on screen. */
export function activeTab(): Tab | undefined {
  return activeOf(tabsStore.getState());
}

/**
 * Calls `listener` with the id of each tab, and of each view of a pull request's tab, as it closes:
 * a layer's view as the stack loses the layer, a run's as the run ends. An id can come back, as a
 * run viewed again does. Returns a function that stops it.
 */
export function onClosed(listener: (id: string) => void): () => void {
  return tabsStore.subscribe((next, previous) => {
    const open = new Set(viewIds(next.tabs));
    for (const id of viewIds(previous.tabs)) if (!open.has(id)) listener(id);
  });
}

/**
 * State a feature keeps for each open tab: a value a tab, or a view of a pull request's tab, by its
 * id, forgotten as the tab closes.
 */
export type { TabState } from './kept.ts';

/**
 * Makes a store of a feature's state for each tab, a Zustand store of its own: what the tree has
 * open, say, so a tab shows it again when it's back on screen. Each view of a pull request's tab
 * has its own value, by the view's id, so each layer keeps its own. A value starts as `initial()`
 * makes it, the first time it's asked for, and goes when its tab closes.
 */
export function tabState<T>(initial: () => T): TabState<T> {
  return makeTabState(initial);
}

/**
 * `tab`'s value in `state`, or what `select` picks from it, re-rendering when that changes. What
 * `select` returns is compared by identity, so it picks a value rather than making a new one.
 */
export function useTabState<T>(state: TabState<T>, tab: string): T;
export function useTabState<T, U>(state: TabState<T>, tab: string, select: (value: T) => U): U;
export function useTabState<T, U>(
  state: TabState<T>,
  tab: string,
  select?: (value: T) => U,
): T | U {
  return useKept(state, tab, select);
}
