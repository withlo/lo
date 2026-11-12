// What the overview's views read of a tab, re-rendering as it changes.

import { useEffect, useMemo, useState } from 'react';

import { useTabState } from '../../tab/window/shared.ts';
import { standingOf, type Standing } from './facts.ts';
import { checked, states } from './store.ts';

/** What tab `tab`'s overview is now, from what main said and what the check found. */
export function useStanding(tab: string): Standing {
  const state = useTabState(states, tab);
  const result = useTabState(checked, tab);
  return useMemo(() => standingOf(state, result), [state, result]);
}

/** The time now, ticking every `every` milliseconds while `ticking`, for what counts or ages. */
export function useNow(ticking: boolean, every = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [ticking, every]);
  return now;
}
