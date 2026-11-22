import { useEffect, useState } from 'react';

/** What a screen reader hears of a countdown, the same however long is left. */
export const COUNTDOWN_SAID = 'soon';

/**
 * How long until `at`, from `now`, as a countdown says it: "in 8 s", "in 2 min", "in 3 h", in the
 * largest whole unit, rounded up, and never under a second.
 */
export function countdownWords(at: number, now: number): string {
  const seconds = Math.max(1, Math.ceil((at - now) / 1000));
  if (seconds < 60) return `in ${seconds} s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  return `in ${Math.floor(hours / 24)} d`;
}

export interface CountdownProps {
  /** When it runs out, as `Date.now()` counts. */
  at: number;
}

/**
 * How long until `at`, counted down each second: "Retrying <Countdown at={retryAt} />." reads
 * "Retrying in 8 s.". What it counts is drawn for the eye alone. A screen reader hears "soon", the
 * same throughout, so an alert or live region that holds it, as a `Problem`'s reason does, isn't
 * read again each second. Nothing in a `Problem` changes on a timer except through this.
 */
export function Countdown({ at }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Once it's run out it says "in 1 s" until what it waits for comes, so it stops counting.
    if (now >= at) return undefined;
    // Drawn again as the count goes down a second, just past it.
    const timer = setTimeout(() => setNow(Date.now()), ((at - now) % 1000 || 1000) + 1);
    return () => clearTimeout(timer);
  }, [at, now]);
  return (
    <>
      <span aria-hidden="true">{countdownWords(at, now)}</span>
      <span className="sr-only">{COUNTDOWN_SAID}</span>
    </>
  );
}
