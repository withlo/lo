// What the window keeps of each merge queue's tab: what main last said of it, and the row the
// keyboard is on, each forgotten as the tab closes.

import { createStore } from 'zustand/vanilla';

import { tabState } from '../../tab/window/shared.ts';
import type { QueueState } from '../contract.ts';

/** What main last said of each merge queue's tab, by its id. */
export const queuesStore = createStore<{ readonly states: ReadonlyMap<string, QueueState> }>()(
  () => ({ states: new Map() }),
);

/** Keeps what main says of a merge queue's tab. */
export function showQueue(state: QueueState): void {
  queuesStore.setState(({ states }) => ({ states: new Map(states).set(state.id, state) }));
}

/** Forgets a merge queue's tab that closed. */
export function forgetQueue(id: string): void {
  if (!queuesStore.getState().states.has(id)) return;
  queuesStore.setState(({ states }) => {
    const next = new Map(states);
    next.delete(id);
    return { states: next };
  });
}

/** What main last said of merge queue tab `id`, read once. */
export function queueOf(id: string): QueueState | undefined {
  return queuesStore.getState().states.get(id);
}

/** The key of the row the keyboard is on in each merge queue's tab: the first, until it moves. */
export const focusedRows = tabState<string | undefined>(() => undefined);
