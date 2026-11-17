// What the window knows of each view's pull request in a merge queue, as main last said: its place
// while it's queued, and why it last left one. And what the merge panel read of what's ahead in the
// queue a pull request ready for one would join, as it opened. A closed view's is forgotten. Only
// this feature writes here.

import { createStore } from 'zustand/vanilla';

import { tabState } from '../../tab/window/shared.ts';
import type { InQueue, Queued } from '../contract.ts';
import { main } from './main.ts';
import type { AheadRead } from './places.ts';

/** Each view's pull request in a merge queue, by the view's id, as main last said. */
export const queues = createStore<{ readonly views: ReadonlyMap<string, InQueue> }>()(() => ({
  views: new Map(),
}));

/** Takes a view's place in a merge queue as main says it. */
export function takeQueued({ id, queue }: Queued): void {
  queues.setState(({ views }) => ({ views: new Map(views).set(id, queue) }));
}

/** Forgets a closed view's place in a merge queue. */
export function forgetQueued(id: string): void {
  if (!queues.getState().views.has(id)) return;
  queues.setState(({ views }) => {
    const next = new Map(views);
    next.delete(id);
    return { views: next };
  });
}

/** View `id`'s pull request in a merge queue, as main last said, read once. */
export function queueOf(id: string): InQueue | undefined {
  return queues.getState().views.get(id);
}

/** Asks main for view `id`'s place in a merge queue, once the window has none, as after a reload. */
export function catchUpQueue(id: string): void {
  main()
    .queue({ id })
    .then((queue) => {
      if (!queues.getState().views.has(id)) takeQueued({ id, queue });
    })
    .catch((error: unknown) => console.error('Lo couldn’t ask about the merge queue:', error));
}

/** What each view's merge panel read of what's ahead in the queue, while it's open. */
export const aheads = tabState<AheadRead>(() => ({ kind: 'none' }));

/** Reads what's ahead in view `id`'s pull request's queue, unless it was read since the panel opened. */
export function readAhead(id: string): void {
  if (aheads.get(id).kind !== 'none') return;
  aheads.set(id, { kind: 'reading' });
  const settle = (read: AheadRead) => {
    if (aheads.get(id).kind === 'reading') aheads.set(id, read);
  };
  main()
    .ahead({ id })
    .then((ahead) => settle({ kind: 'read', ahead }))
    .catch((error: unknown) =>
      settle({ kind: 'failed', why: error instanceof Error ? error.message : String(error) }),
    );
}

/** Forgets what view `id`'s panel read of what's ahead, as it closes, so it reads again next time. */
export function forgetAhead(id: string): void {
  if (aheads.get(id).kind !== 'none') aheads.set(id, { kind: 'none' });
}

/** Forgets why view `id`'s pull request left its merge queue, as the reader dismisses it. */
export function dismissLeft(id: string): void {
  const queue = queueOf(id);
  if (queue?.left) takeQueued({ id, queue: { ...queue, left: null } });
  main()
    .forgetLeft({ id })
    .catch((error: unknown) => console.error('Lo couldn’t forget why it left the queue:', error));
}
