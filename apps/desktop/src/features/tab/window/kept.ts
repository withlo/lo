// State a feature keeps for each open tab, which goes as the tab closes. The tab's own modules make
// theirs here; other features make theirs through `shared.ts`.

import { useSyncExternalStore } from 'react';
import { createStore } from 'zustand/vanilla';

import { tabsStore } from './store.ts';

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
export function makeTabState<T>(initial: () => T): TabState<T> {
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
export function useKept<T>(state: TabState<T>, tab: string): T;
export function useKept<T, U>(state: TabState<T>, tab: string, select?: (value: T) => U): T | U;
export function useKept<T, U>(state: TabState<T>, tab: string, select?: (value: T) => U): T | U {
  const read = () => (select ? select(state.get(tab)) : state.get(tab));
  return useSyncExternalStore(state.subscribe, read);
}
