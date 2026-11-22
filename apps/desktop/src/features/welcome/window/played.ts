// The mark's moves in the welcome play once each time it opens: Unmeld as its first step shows,
// Kiss as its last does. A step the reader comes back to draws the mark at rest.

import { useEffect, useState } from 'react';

import { markPlayed } from './actions.ts';
import { welcomeStore, type MarkMove } from './store.ts';

/**
 * Whether the step's mark plays `move` as the step shows: only while it's the step on screen, and
 * only the first time since the welcome opened. Read once, as the step is drawn.
 */
export function usePlayOnce(move: MarkMove, shown: boolean): boolean {
  const [plays] = useState(() => shown && !welcomeStore.getState().played.includes(move));
  useEffect(() => {
    if (plays) markPlayed(move);
  }, [plays, move]);
  return plays;
}
