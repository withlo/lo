// What the diff shares with other features' window code: the slot over the diff, where what it
// compares is said, and showing the diff.

import { defineSlot } from '../../../window/slots.tsx';
import { showMiddle, type PullTab } from '../../tab/window/shared.ts';
import { DIFF_VIEW } from './whole.ts';

/**
 * Over a pull request's tab's diff, the same height from its first frame on: a note on what it
 * compares, such as "r3 → r5, since you last looked". A view here draws one line, so what's below
 * never moves when its text changes.
 */
export const notes = defineSlot<{ tab: PullTab }>('diff.notes');

/**
 * Shows pull request's tab `tab`'s diff in its middle, as `` ` `` and `~` step to it, such as when
 * the tab opens on it. Says whether the tab has a diff.
 */
export function showDiff(tab: string): boolean {
  return showMiddle(tab, DIFF_VIEW);
}
