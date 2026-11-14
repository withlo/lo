// Each view's review threads and your pending review in the window, as main last sent them, kept
// until the view's tab closes; and what places them in the view's diff and counts them for its
// tree, as the diff and the tree ask.

import type { ThreadView } from '@lo/ui/code';

import { tabState } from '../../tab/window/shared.ts';
import type { DrawnDiff } from '../../diff/window/shared.ts';
import type { FileThreads } from '../../tree/window/shared.ts';
import type { ReviewView, ThreadsView } from '../contract.ts';
import { excerpts } from './excerpts.ts';
import { main } from './main.ts';
import { type Placed, placeThreads } from './placing.ts';

/** What main last sent of each view's threads and pending review. */
export const held = tabState<{ threads?: ThreadsView; review?: ReviewView }>(() => ({}));

/**
 * What each view's threads panel lists: the threads main last sent, once their openings are read.
 * Until they are, the panel keeps what it listed, so a row is never drawn without its opening, and
 * the rows never move as the openings come: an edited comment's row changes in one step, to its new
 * words, and a thread main just sent comes in whole. Nothing else waits for them.
 */
export const listed = tabState<ThreadsView | undefined>(() => undefined);

/** What each view's threads hold in each file of its diff as last placed, by the tree's key. */
const counted = tabState<ReadonlyMap<string, FileThreads>>(() => new Map());

/** Where each view's threads are in its diff as last placed, by their ids. */
const shown = tabState<ReadonlyMap<string, ThreadView['at']>>(() => new Map());

/** The Markdown of each thread's first comment in `view`: what its panel row shows words of. */
function openings(view: ThreadsView): string[] {
  return view.threads.flatMap((row) => (row.comments[0] ? [row.comments[0].body] : []));
}

/**
 * Lists `view`'s threads in its panel: at once when their openings are read, as they are for a
 * view with none, and otherwise once they are, or can't be, unless newer threads were sent since.
 */
function list(view: ThreadsView): void {
  const bodies = openings(view);
  if (excerpts.holds(bodies)) {
    listed.set(view.id, view);
    return;
  }
  void excerpts.ready(bodies).then(() => {
    if (held.get(view.id).threads === view) listed.set(view.id, view);
  });
}

/** Takes the threads main sent. Says whether they changed what was held. */
export function takeThreads(view: ThreadsView): boolean {
  if (held.get(view.id).threads === view) return false;
  held.update(view.id, (now) => ({ ...now, threads: view }));
  list(view);
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
