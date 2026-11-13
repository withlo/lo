// The review threads under the lines of pull requests' tabs' diffs, which another feature, such as
// the comments, places and draws. The diff asks for them each time it's drawn and each time they
// change, saying what each of its columns shows, and gives them to the view, which has the
// threader draw each one in an element of its own. A file's header counts what its threads hold.
// A thread that comes on a line on screen waits for the line to leave the screen, so nothing the
// reader is looking at moves: a diff waits a moment for its tab's threads before it's first drawn,
// so those on its first screen come with it.

import type { RenderThread, ThreadView } from '@lo/ui/code';

import type { PullTab } from '../../tab/window/shared.ts';

/** A file of a diff as drawn, as its threads are looked up. */
export interface ThreadedFile {
  /** Its name in the view. */
  readonly id: string;
  /** Its key, as the tree names it. */
  readonly key: string;
  /** Its path in the newer column, the head's: none for a file the pull request deletes. */
  readonly path: string | null;
  /** Its path in the older column: none for a file the pull request adds. */
  readonly old: string | null;
  /**
   * Whether it shows from a revision of its own, as a file a push changed since it was viewed
   * does, so its older column shows something other than the diff's.
   */
  readonly since: boolean;
}

/** What a diff draws, as its threads are placed on it. */
export interface DrawnDiff {
  /** The head its newer column shows. */
  readonly at: string;
  /** The comparison of revisions it shows, by its key, or none for the whole pull request. */
  readonly comparison: string | null;
  /** The commit a stack's layer is compared with, when it's that. */
  readonly compareFrom: string | null;
  readonly files: readonly ThreadedFile[];
}

/** What a file's threads on screen hold. */
export interface ThreadCounts {
  readonly threads: number;
  readonly unresolved: number;
  readonly comments: number;
}

/** A diff's threads, placed under its lines, and what each file's hold, by the file's name. */
export interface DiffThreads {
  readonly threads: readonly ThreadView[];
  readonly counts: ReadonlyMap<string, ThreadCounts>;
}

/** What places the review threads of pull requests' diffs, and draws them. */
export interface Threader {
  /** The threads of tab `tab`'s diff, as `drawn` shows it. */
  threadsIn(tab: string, drawn: DrawnDiff): DiffThreads;
  /**
   * Whether tab `tab`'s threads' first read has ended: with its threads, with why there are none,
   * or with none to read.
   */
  settled(tab: string): boolean;
  /**
   * What draws the threads of `tab`'s view in the elements the code view makes for them. A
   * thread's own button that opens or collapses it calls `toggle` with its id.
   */
  render(tab: PullTab, toggle: (thread: string) => void): RenderThread;
}

/**
 * How long a view's diff, the first time its files are ready, waits for its threads' first read
 * before it's drawn anyway.
 */
export const WAIT_FOR_THREADS = 1_000;

/** No threads at all. */
export const NO_THREADS: DiffThreads = { threads: [], counts: new Map() };

let current: Threader | undefined;

/** Each drawn diff's listeners, by tab, which ask for its threads again. */
const listeners = new Map<string, Set<() => void>>();

/** Takes `given` as what places and draws the diffs' threads. Returns a function that lets it go. */
export function threadWith(given: Threader): () => void {
  current = given;
  for (const tab of listeners.keys()) changed(tab);
  return () => {
    if (current !== given) return;
    current = undefined;
    for (const tab of listeners.keys()) changed(tab);
  };
}

/** What places and draws the diffs' threads now, if anything does. */
export function threader(): Threader | undefined {
  return current;
}

/** Says tab `tab`'s threads changed, so its diff, if it's drawn, asks for them again. */
export function changed(tab: string): void {
  for (const listener of listeners.get(tab) ?? []) listener();
}

/**
 * Calls `listener` each time tab `tab`'s threads change, as for a diff drawn. Returns a function
 * that stops it.
 */
export function onThreads(tab: string, listener: () => void): () => void {
  let each = listeners.get(tab);
  if (!each) {
    each = new Set();
    listeners.set(tab, each);
  }
  each.add(listener);
  return () => {
    const kept = listeners.get(tab);
    kept?.delete(listener);
    if (kept?.size === 0) listeners.delete(tab);
  };
}

/** Whether two lists of threads place the same threads the same way, in the same order. */
export function sameThreads(a: readonly ThreadView[], b: readonly ThreadView[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

/** Whether two files' counts are the same. */
export function sameCounts(a: ThreadCounts | undefined, b: ThreadCounts | undefined): boolean {
  return (
    a?.threads === b?.threads && a?.unresolved === b?.unresolved && a?.comments === b?.comments
  );
}
