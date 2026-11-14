// The threads you wrote on a revision that GitHub put on a newer push, as its answer said, where
// their lines may hold other code: each view's, in the window's memory, until its tab closes. Their
// cards say so.

import { tabState } from '../../tab/window/shared.ts';

/** The ids of each view's threads that landed on a newer push. */
export const landed = tabState<ReadonlySet<string>>(() => new Set());
