// Each view's review threads and your pending review in the window, as main last sent them, kept
// until the view's tab closes; and what places them in the view's diff and counts them for its
// tree, as the diff and the tree ask.

import type { ThreadView } from '@lo/ui/code';

import { tabState } from '../../tab/window/shared.ts';
import type { DrawnDiff } from '../../diff/window/shared.ts';
import type { FileThreads } from '../../tree/window/shared.ts';
import type { ReviewView, ThreadsView } from '../contract.ts';
import { main } from './main.ts';
import { type Placed, placeThreads } from './placing.ts';

/** What main last sent of each view's threads and pending review. */
export const held = tabState<{ threads?: ThreadsView; review?: ReviewView }>(() => ({}));

/** What each view's threads hold in each file of its diff as last placed, by the tree's key. */
const counted = tabState<ReadonlyMap<string, FileThreads>>(() => new Map());

/** Where each view's threads are in its diff as last placed, by their ids. */
const shown = tabState<ReadonlyMap<string, ThreadView['at']>>(() => new Map());

/** Takes the threads main sent. Says whether they changed what was held. */
export function takeThreads(view: ThreadsView): boolean {
  if (held.get(view.id).threads === view) return false;
  held.update(view.id, (now) => ({ ...now, threads: view }));
  return true;
}

/** Takes the pending review main sent. */
export function takeReview(view: ReviewView): void {
  held.update(view.id, (now) => ({ ...now, review: view }));
}

/** View `view`'s threads placed in its diff as `drawn` shows it: none for a run of layers. */
export function placedIn(view: string, drawn: DrawnDiff): Placed {
  const threads = held.get(view).threads;
  const placed = placeThreads(
    threads?.status === 'run' ? [] : (threads?.threads ?? []),
    drawn,
    threads?.compared ?? null,
  );
  counted.set(view, placed.byKey);
  shown.set(view, new Map(placed.threads.map((thread) => [thread.id, thread.at])));
  return placed;
}

/** Where thread `id` is in view `view`'s diff as last placed: nowhere when it isn't there. */
export function shownAt(view: string, id: string): ThreadView['at'] | undefined {
  return shown.get(view).get(id);
}

/**
 * The threads in view `view`'s diff as last placed under a line of file `file`, on `side`, or with
 * no line, under its header: by their ids, in their order.
 */
export function shownUnder(
  view: string,
  file: string,
  line?: { readonly side: 'old' | 'new'; readonly line: number },
): string[] {
  const ids: string[] = [];
  for (const [id, at] of shown.get(view)) {
    if (at.file !== file) continue;
    const under = 'line' in at ? line && at.side === line.side && at.line === line.line : !line;
    if (under) ids.push(id);
  }
  return ids;
}

/** What view `view`'s threads hold in each file of its diff as last placed, by the tree's key. */
export function countsIn(view: string): ReadonlyMap<string, FileThreads> {
  return counted.get(view);
}

/** Whether two files' counts maps say the same. */
export function sameCounts(
  a: ReadonlyMap<string, FileThreads> | undefined,
  b: ReadonlyMap<string, FileThreads>,
): boolean {
  if (a?.size !== b.size) return false;
  for (const [key, count] of b) {
    const was = a.get(key);
    if (was?.total !== count.total || was.unresolved !== count.unresolved) return false;
  }
  return true;
}

const asked = new Set<string>();

/**
 * Asks main for a view's threads and pending review, for a view the window wants before main said
 * anything of it, and calls `then` if main had its threads.
 */
export function catchUp(view: string, then: () => void): void {
  if (asked.has(view)) return;
  asked.add(view);
  main()
    .current({ id: view })
    .then(({ threads, review }) => {
      const now = held.get(view);
      if (review && now.review === undefined) takeReview(review);
      if (threads && now.threads === undefined) {
        takeThreads(threads);
        then();
      }
    })
    .catch((error: unknown) => console.error("Lo couldn't ask about a view's threads:", error))
    .finally(() => asked.delete(view));
}
