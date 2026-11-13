// How many review threads each file in a pull request's tab's tree has on screen, which another
// feature, such as the comments, counts: a file's row shows them, and stands out while any is
// unresolved. The tree asks for a tab's counts as it's drawn and each time they change.

import { useSyncExternalStore } from 'react';

/** A file's threads on screen: how many, and how many of them are unresolved. */
export interface FileThreads {
  readonly total: number;
  readonly unresolved: number;
}

/** What counts the threads on each file of pull requests' tabs. */
export interface FileCounter {
  /** Tab `tab`'s files' threads on screen, by each file's key, for those that have any. */
  countsIn(tab: string): ReadonlyMap<string, FileThreads>;
}

const NONE: ReadonlyMap<string, FileThreads> = new Map();

let current: FileCounter | undefined;
const listeners = new Set<() => void>();
/** Each tab's counts, as last read, so a tree drawn again gets the same map while they hold. */
const read = new Map<string, ReadonlyMap<string, FileThreads>>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Takes `given` as what counts the files' threads. Returns a function that lets it go. */
export function countWith(given: FileCounter): () => void {
  current = given;
  read.clear();
  changed();
  return () => {
    if (current !== given) return;
    current = undefined;
    read.clear();
    changed();
  };
}

/** Says tab `tab`'s counts changed, so its tree, if it's drawn, reads them again. */
export function countsChanged(tab: string): void {
  read.delete(tab);
  changed();
}

/** Tab `tab`'s files' threads on screen, by key. */
export function countsOf(tab: string): ReadonlyMap<string, FileThreads> {
  let counts = read.get(tab);
  if (!counts) {
    counts = current?.countsIn(tab) ?? NONE;
    read.set(tab, counts);
  }
  return counts;
}

/** {@link countsOf}, re-rendering when they change. */
export function useCounts(tab: string): ReadonlyMap<string, FileThreads> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => countsOf(tab),
  );
}
