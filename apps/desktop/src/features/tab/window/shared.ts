// What the tab feature shares with other features' window code: the tabs and the one on screen,
// state a feature keeps for each tab, and the slot each kind of tab draws what it holds in. A pull
// request's tab holds a view of each layer of a stack the reader has shown; what's shared names it
// by its view on screen, so what follows the tab on screen follows the layer on screen.

import { createElement, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { defineSlot } from '../../../window/slots.tsx';
import type { Files, LocalState, PullView, Tab } from '../contract.ts';
import { makeTabState, type TabState, useKept } from './kept.ts';
import { middleIds, panels, type Panels } from './panels.ts';
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
  Tab,
} from '../contract.ts';
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

/** What goes on a pull request's header's second row, after its branches: the revision picker. */
export const header = defineSlot<{ tab: PullTab }>('tab.header');

/**
 * Banners of other features' about a pull request's tab, under Lo's own: a view draws one banner
 * or nothing. Two show at most, the most urgent first.
 */
export const banners = defineSlot<{ tab: PullTab }>('tab.banners');

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
 * history to itself until it's shown again. The tab shows the first of them as it opens.
 */
export const middle = defineSlot<{ tab: PullTab; shown: boolean }, MiddleSwitch>('tab.middle');

/**
 * What the middle says while there's nothing to show yet: that the pull request is opening, or
 * what will show. A middle view that waits before it knows what to draw draws this meanwhile, so
 * the tab looks as it does with no view at all.
 */
export function MiddlePlaceholder({ tab }: { tab: PullTab }): ReactNode {
  return createElement(Placeholder, { tab: tab.id });
}

/**
 * Shows the middle view `id`, one of those in {@link middle}, in pull request's tab `tab`, as
 * `` ` `` and `~` step to it. Says whether the tab has it. A view that shows something another
 * feature asks for, such as a file whole, calls this to come on screen.
 */
export function showMiddle(tab: string, id: string): boolean {
  const at = middleIds.ids.indexOf(id);
  if (at < 0) return false;
  if (panels.get(tab).middle !== at) panels.update(tab, (current) => ({ ...current, middle: at }));
  return true;
}

/**
 * The id of the middle view on screen in pull request's tab `tab`, and of each of the tab's middle
 * views in their order, re-rendering when another is shown.
 */
export function useMiddle(tab: string): { shown: string | undefined; ids: readonly string[] } {
  const at = useTabState(panels, tab, (value: Panels) => value.middle);
  const { ids } = middleIds;
  return { shown: ids[at % Math.max(1, ids.length)], ids };
}

/** The right panel of a pull request's tab: its threads. */
export const right = defineSlot<{ tab: PullTab }>('tab.right');

/** Items in a pull request's tab's status bar, after Lo's own. */
export const status = defineSlot<{ tab: PullTab }>('tab.status');

/**
 * `text` without the characters that turn the direction of the text after them around until
 * they're closed (embeddings, overrides and isolates), which a pull request's author could use to
 * make a title or a file's name read as something else. The marks right-to-left text places numbers
 * and punctuation with (LRM, RLM, ALM) stay: they change no more than their neighbours.
 */
export function withoutBidi(text: string): string {
  return text.replaceAll(/[\u202A-\u202E\u2066-\u2069]/g, '');
}

/** What main last said of a view of a pull request's tab, re-rendering when it changes. */
export function usePull(tab: string): PullView | undefined {
  return useStore(pullsStore, (state) => state.views.get(tab));
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

/**
 * Dialogs over the whole window, whatever tab is on screen: signing in, say. A feature puts one view
 * here, which draws its dialogs while they're open and nothing otherwise.
 */
export const dialogs = defineSlot('tab.dialogs');

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
