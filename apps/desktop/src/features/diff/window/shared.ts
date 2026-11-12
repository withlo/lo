// What the diff shares with other features' window code: the slot over the diff, where what it
// compares is said.

import { defineSlot } from '../../../window/slots.tsx';
import type { PullTab } from '../../tab/window/shared.ts';

/**
 * Over a pull request's tab's diff, the same height from its first frame on: a note on what it
 * compares, such as "r3 → r5, since you last looked". A view here draws one line, so what's below
 * never moves when its text changes.
 */
export const notes = defineSlot<{ tab: PullTab }>('diff.notes');
