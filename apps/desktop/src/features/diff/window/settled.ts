// Whether a view's diff may be drawn yet, as far as its review threads go. A thread that comes on a
// line on screen waits for the line to leave the screen, so a view's first draw waits a moment for
// its threads, so those on its first screen come with it. Only the first: a tab drawn anew as it
// comes back on screen never waits. The middle says it waits only once the wait has gone on long
// enough to see.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { tabState, useTabState } from '../../tab/window/shared.ts';
import { onThreads, threader, WAIT_FOR_THREADS } from './threads.ts';

/** How long, in milliseconds, a first draw waits for its threads before the middle says so. */
export const SAY_WAITING_AFTER = 100;

/**
 * Whether each view's diff has been drawn once, or has waited its turn: from then on it never waits
 * for its threads again, though its tab is drawn anew each time it comes back on screen. `since` is
 * when its files were first ready, which the wait counts from.
 */
const firstDraws = tabState<{ readonly since?: number; readonly done: boolean }>(() => ({
  done: false,
}));

/**
 * Whether view `tab`'s diff may be drawn, as far as its threads go. Only its first draw waits: until
 * its threads' first read ends, with an answer or why there's none, or {@link WAIT_FOR_THREADS}
 * after its files are ready, whichever is first. Threads that come later, on lines on screen, wait
 * for their lines to leave the screen, so nothing the reader is looking at moves: a bounded wait,
 * once a view, rather than lines moving with no input.
 */
export function useThreadsSettled(tab: string, ready: boolean): boolean {
  const done = useTabState(firstDraws, tab, (value) => value.done);
  const subscribe = useCallback((listener: () => void) => onThreads(tab, listener), [tab]);
  const known = useSyncExternalStore(subscribe, () => done || (threader()?.settled(tab) ?? true));
  useEffect(() => {
    if (done || !ready) return undefined;
    const finish = () => firstDraws.update(tab, (now) => ({ ...now, done: true }));
    if (known) {
      finish();
      return undefined;
    }
    const since = firstDraws.get(tab).since ?? Date.now();
    firstDraws.update(tab, (now) => (now.since === undefined ? { ...now, since } : now));
    const timer = setTimeout(finish, Math.max(0, since + WAIT_FOR_THREADS - Date.now()));
    return () => clearTimeout(timer);
  }, [tab, ready, known, done]);
  return done || known;
}

/**
 * Whether the middle says view `tab` waits for its threads: only while its first draw waits for
 * their first read, and only once it has waited {@link SAY_WAITING_AFTER}, so a wait that ends
 * sooner draws nothing in the meantime. `settled` is what {@link useThreadsSettled} says. A view
 * whose threads are settled, as on each switch back to its tab, never says it.
 */
export function useSaysWaiting(tab: string, settled: boolean): boolean {
  const since = useTabState(firstDraws, tab, (value) => value.since);
  const [said, setSaid] = useState<string>();
  useEffect(() => {
    if (settled || since === undefined) return undefined;
    const timer = setTimeout(
      () => setSaid(tab),
      Math.max(0, since + SAY_WAITING_AFTER - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [tab, settled, since]);
  return !settled && said === tab;
}
