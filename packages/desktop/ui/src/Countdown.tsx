import { useEffect, useState } from 'react';

/** How long until `at`, from `now`, in the largest whole unit, rounded up as a countdown counts. */
function left(at: number, now: number): { count: number; unit: 's' | 'min' | 'h' | 'd' } {
  const seconds = Math.max(1, Math.ceil((at - now) / 1000));
  if (seconds < 60) return { count: seconds, unit: 's' };
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return { count: minutes, unit: 'min' };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { count: hours, unit: 'h' };
  return { count: Math.floor(hours / 24), unit: 'd' };
}

/** Each unit's word, as a screen reader hears it. */
const SPELLED = { s: 'second', min: 'minute', h: 'hour', d: 'day' } as const;

/**
 * How long until `at`, from `now`, as a countdown shows it: "in 8 s", "in 2 min", "in 3 h", in the
 * largest whole unit, rounded up, and never under a second.
 */
export function countdownWords(at: number, now: number): string {
  const { count, unit } = left(at, now);
  return `in ${count} ${unit}`;
}

/** The same, spelled out, as a screen reader hears it: "in 8 seconds", "in 1 minute". */
export function countdownSaid(at: number, now: number): string {
  const { count, unit } = left(at, now);
  return `in ${count} ${SPELLED[unit]}${count === 1 ? '' : 's'}`;
}

export interface CountdownProps {
  /** When it runs out, as `Date.now()` counts. */
  at: number;
}

/**
 * How long until `at`, counted down each second: "Retrying <Countdown at={retryAt} />." reads
 * "Retrying in 8 s.". What it counts is drawn for the eye alone. A screen reader hears the wait as
 * it stood when first drawn, spelled out ("in 8 seconds"), and nothing after, so an alert or live
 * region that holds it, as a `Problem`'s reason does, isn't read again each second. A new `at` is a
 * new reading. Nothing in a `Problem` changes on a timer except through this.
 */
export function Countdown({ at }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  // What a screen reader hears, set once for each time it counts to, which starts the count over.
  const [heard, setHeard] = useState(() => ({ at, said: countdownSaid(at, now) }));
  if (heard.at !== at) {
    const from = Date.now();
    setNow(from);
    setHeard({ at, said: countdownSaid(at, from) });
  }
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
      <span className="sr-only">{heard.said}</span>
    </>
  );
}
