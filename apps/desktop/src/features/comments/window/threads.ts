// Each view's review threads and your pending review in the window, as main last sent them, kept
// until the view's tab closes; and what places them in the view's diff and counts them for its
// tree, as the diff and the tree ask.

import type { ThreadView } from '@lo/ui/code';

import { tabState } from '../../tab/window/shared.ts';
import type { DrawnDiff } from '../../diff/window/shared.ts';
import { revisionLabel, revisionsOf } from '../../revisions/window/shared.ts';
import type { FileThreads } from '../../tree/window/shared.ts';
import type { ReviewView, ThreadRow, ThreadsView } from '../contract.ts';
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

/** How far apart GitHub's times of a review and its comments can be: it times them to the second. */
const SLACK = 1000;

/**
 * The review thread a review's first comment is in, among `threads`: the thread of the earliest
 * comment the review's author wrote while the review was open, from when they started it, `from`,
 * to when they submitted it, `to`. None when none fits. GitHub does say which review a comment came
 * with (`PullRequestReviewComment.pullRequestReview`), but the threads Lo reads don't ask for it,
 * and asking would change the query every recorded reply is matched by; the times say the same.
 */
export function threadOfReview(
  threads: readonly ThreadRow[],
  review: { readonly author: string; readonly from: string; readonly to: string },
): string | undefined {
  const from = Date.parse(review.from) - SLACK;
  const to = Date.parse(review.to) + SLACK;
  const author = review.author.toLowerCase();
  let first: { thread: string; at: number } | undefined;
  for (const thread of threads) {
    for (const comment of thread.comments) {
      if (comment.state !== 'SUBMITTED' || comment.author?.toLowerCase() !== author) continue;
      const at = Date.parse(comment.createdAt);
      if (at >= from && at <= to && (!first || at < first.at)) first = { thread: thread.id, at };
    }
  }
  return first?.thread;
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

/**
 * View `view`'s threads placed in its diff as `drawn` shows it, their marks naming its revisions:
 * none for a run of layers.
 */
export function placedIn(view: string, drawn: DrawnDiff): Placed {
  const threads = held.get(view).threads;
  const known = revisionsOf(view);
  const placed = placeThreads(
    threads?.status === 'run' ? [] : (threads?.threads ?? []),
    drawn,
    threads?.compared ?? null,
    (head) => revisionLabel(known, head),
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
