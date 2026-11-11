// What the tab feature shares with other features' window code: the tabs and the one on screen,
// state a feature keeps for each tab, and the slot each kind of tab draws what it holds in.

import { useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { defineSlot } from '../../../window/slots.tsx';
import type { Files, LocalState, PullView, Tab } from '../contract.ts';
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

/** A pull request's tab. */
export type PullTab = Extract<Tab, { kind: 'pull' }>;

/**
 * Where each kind of tab draws what it holds, under the strip. The feature that owns a kind puts
 * one view here, which draws a tab of its kind and nothing for the others: Settings' for
 * `settings`, the Recent list's for `recent`. Only the tab on screen is drawn, and drawn afresh
 * each time it's shown, so a view keeps what it needs across switches in a {@link tabState}.
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
 * The middle of a pull request's tab: its overview, its diff or its timeline. Each view here is
 * one of the middle views, in order; `` ` `` and `~` go from one to the next.
 */
export const middle = defineSlot<{ tab: PullTab }>('tab.middle');

/** The right panel of a pull request's tab: its threads. */
export const right = defineSlot<{ tab: PullTab }>('tab.right');

/** Items in a pull request's tab's status bar, after Lo's own. */
export const status = defineSlot<{ tab: PullTab }>('tab.status');

/** What main last said of a pull request's tab, re-rendering when it changes. */
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

/**
 * Dialogs over the whole window, whatever tab is on screen: signing in, say. A feature puts one view
 * here, which draws its dialogs while they're open and nothing otherwise.
 */
export const dialogs = defineSlot('tab.dialogs');

/** The tabs and the one on screen, re-rendering when they change. */
export function useTabs(): TabsState {
  return useStore(tabsStore);
}

/** The tab on screen, re-rendering when another is shown. */
export function useActiveTab(): Tab | undefined {
  return useStore(tabsStore, activeOf);
}

/** The tab on screen now. */
export function activeTab(): Tab | undefined {
  return activeOf(tabsStore.getState());
}

/** State a feature keeps for each open tab: a value a tab, forgotten as the tab closes. */
export interface TabState<T> {
  /** `tab`'s value: the one `initial` made for it, until it's set. */
  get(tab: string): T;
  set(tab: string, value: T): void;
  /** Sets `tab`'s value from its current one. */
  update(tab: string, change: (current: T) => T): void;
  /** Calls `listener` when a tab's value is set. Returns a function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
}

/** A value of a tab's, boxed, so a value that's undefined is still one. */
interface Box<T> {
  readonly value: T;
}

/**
 * Makes a store of a feature's state for each tab, a Zustand store of its own: what the tree has
 * open, say, so a tab shows it again when it's back on screen. A tab's value starts as `initial()`
 * makes it, the first time it's asked for, and goes when the tab closes.
 */
export function tabState<T>(initial: () => T): TabState<T> {
  const store = createStore<ReadonlyMap<string, Box<T>>>()(() => new Map());
  /** The values `initial` made for tabs whose value hasn't been set, kept so each is made once. */
  const initials = new Map<string, Box<T>>();
  const boxOf = (tab: string): Box<T> => {
    const box = store.getState().get(tab) ?? initials.get(tab);
    if (box) return box;
    const made = { value: initial() };
    initials.set(tab, made);
    return made;
  };
  const set = (tab: string, value: T) => {
    initials.delete(tab);
    store.setState(new Map(store.getState()).set(tab, { value }), true);
  };
  // A closed tab's value goes with it.
  tabsStore.subscribe((next, previous) => {
    const open = new Set(next.tabs.map(({ id }) => id));
    const closed = previous.tabs.filter(({ id }) => !open.has(id)).map(({ id }) => id);
    for (const id of closed) initials.delete(id);
    const values = store.getState();
    if (!closed.some((id) => values.has(id))) return;
    store.setState(new Map([...values].filter(([id]) => open.has(id))), true);
  });
  return {
    get: (tab) => boxOf(tab).value,
    set,
    update: (tab, change) => set(tab, change(boxOf(tab).value)),
    subscribe: (listener) => store.subscribe(listener),
  };
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
  const read = () => (select ? select(state.get(tab)) : state.get(tab));
  return useSyncExternalStore(state.subscribe, read);
}
