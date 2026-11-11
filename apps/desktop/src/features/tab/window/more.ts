// The strip's menu of the tabs that don't fit, "N more": which tabs it holds, and whether it's open,
// so a key can open it.

import { createStore } from 'zustand/vanilla';

export interface MoreState {
  /** The tabs that don't fit, by id. */
  readonly folded: readonly string[];
  readonly open: boolean;
}

export const moreStore = createStore<MoreState>()(() => ({ folded: [], open: false }));

export function setFolded(folded: readonly string[]): void {
  const state = moreStore.getState();
  if (state.folded.join('\n') === folded.join('\n')) return;
  // A menu with nothing in it closes.
  moreStore.setState({ folded, open: state.open && folded.length > 0 });
}

export function setMoreOpen(open: boolean): void {
  moreStore.setState({ open });
}
