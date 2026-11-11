/**
 * The writes that comment and review, run in an account's queue like any of the poller's writes,
 * each reading back what it changed.
 *
 * None is ever sent again by Lo itself. A write that failed may still have been done, when its
 * answer was lost or GitHub's server failed ({@link GithubError.mayHavePosted}); the read-back below
 * still runs, so the UI can check what's there before it offers to send again.
 *
 * The open pull request's check (`PullRequestCheck`) sees most of what they change, so the reads
 * that watch it read again on their own: a new thread or comment moves the count of threads, a reply
 * or a deleted comment its thread's count of comments, resolving a thread its state, a change to
 * your pending review its count of comments, a comment on the pull request itself, or deleting one,
 * the timeline's count, and an edit the pull request's own time, which the timeline watches for its
 * newest page. The check doesn't see:
 *
 * - an edit of a comment in a review thread, which the threads don't watch the pull request's time
 *   for: every comment on the pull request would read them all again;
 * - an edit of an item past the timeline's newest page, which a read of the newest page misses;
 * - anything on a thread past the first {@link CHECKED_THREADS}, whose state and comments it doesn't
 *   read;
 * - a deleted comment's review, in the timeline, whose count of comments it shows;
 * - your pending review, when a reply sent to be posted at once joined it, when GitHub's refusal
 *   says it changed elsewhere (a second one refused, something it names gone, or a thread refused
 *   that may have started one), or when a thread landed on another head than the one planned;
 * - a comment whose answer was lost, which may be in the threads and your pending review, or in
 *   neither.
 *
 * For those the write reads the threads, your pending review or the timeline again itself, the
 * timeline in full.
 */

import type { GithubClient } from '../client.ts';
import { GithubError } from '../errors.ts';
import { CHECKED_THREADS } from '../queries.ts';
import type { PullRef } from '../refs.ts';
import {
  addConversationComment,
  deleteComment,
  editComment,
  resolveThread,
  sendReviewWrite,
  type CommentId,
  type ReviewWrite,
  type ReviewWriteRefusal,
  type Sent,
} from '../review-writes.ts';
import type { ReviewThreadList } from '../threads.ts';
import { PENDING_REVIEW, REVIEW_THREADS, TIMELINE, type ReadKind } from './reads.ts';

/** What these writes need of the poller. */
export interface ReviewWriter {
  writeChanging<T>(
    targets: readonly PullRef[],
    request: (client: GithubClient) => Promise<T>,
    again?: (result: { ok: true; value: T } | { ok: false; error: unknown }) => readonly Reread[],
  ): Promise<T>;
  cachedRead<T>(pull: PullRef, kind: ReadKind<T>): { value: T } | undefined;
}

interface Reread {
  name: string;
  afresh: boolean;
}

const THREADS: Reread = { name: REVIEW_THREADS.name, afresh: false };
const PENDING: Reread = { name: PENDING_REVIEW.name, afresh: false };
const TIMELINE_IN_FULL: Reread = { name: TIMELINE.name, afresh: true };

type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Whether GitHub said what the write named is gone. */
function gone(result: Result<unknown>): boolean {
  return (
    result.ok &&
    typeof result.value === 'object' &&
    result.value !== null &&
    'refusal' in result.value &&
    result.value.refusal === 'gone'
  );
}

/**
 * Whether the check reads `thread`'s state and count of comments: whether it's among the first
 * {@link CHECKED_THREADS} of `pull`'s threads, as last read. One Lo hasn't read isn't.
 */
function checksThread(writer: ReviewWriter, pull: PullRef, thread: string): boolean {
  const threads = writer.cachedRead(pull, REVIEW_THREADS)?.value;
  return threads?.nodes.slice(0, CHECKED_THREADS).some((node) => node.id === thread) ?? false;
}

/**
 * What Lo last read of `comment`, in a review thread of `pull`: whether the check counts its
 * thread's comments, and whether it's pending. Nothing when Lo hasn't read it.
 */
function heldComment(
  writer: ReviewWriter,
  pull: PullRef,
  comment: string,
): { checked: boolean; pending: boolean } | undefined {
  const threads: ReviewThreadList | undefined = writer.cachedRead(pull, REVIEW_THREADS)?.value;
  for (const [index, node] of (threads?.nodes ?? []).entries()) {
    const held = (node.comments.nodes ?? []).find((known) => known?.id === comment);
    if (held) return { checked: index < CHECKED_THREADS, pending: held.state === 'PENDING' };
  }
  return undefined;
}

/**
 * Sends `write`, which `@lo/review`'s pending review planned for `pull`. {@link Sent} names what
 * GitHub made, including a reply that joined a pending review instead of posting; a refusal,
 * including a thread GitHub answered with `null`, comes back as a value.
 *
 * It's never sent again by itself. When it fails in a way that may have posted it anyway
 * ({@link GithubError.mayHavePosted}), the UI compares the draft with your newest comments, as the
 * read-back brings them, before offering to send it again.
 */
export function sendReview(
  writer: ReviewWriter,
  pull: PullRef,
  write: ReviewWrite,
): Promise<Sent | ReviewWriteRefusal> {
  // A reply posted at once moves only its thread's count of comments.
  const unchecked =
    write.kind === 'postReply' &&
    !checksThread(writer, pull, write.variables.pullRequestReviewThreadId);
  // A comment whose answer was lost may be there, in your pending review or not.
  const sendsComment = write.kind !== 'submitReview' && write.kind !== 'review';
  // A thread refused may have started a review, or been refused because the review is gone.
  const threads = write.kind === 'startReview' ? write.variables.threads : undefined;
  const namedReview =
    write.kind === 'addThread' || (Array.isArray(threads) ? threads.length > 0 : threads != null);
  return writer.writeChanging(
    [pull],
    (client) => sendReviewWrite(client, pull, write),
    (result) => {
      const again = unchecked ? [THREADS] : [];
      let changedElsewhere: boolean;
      if (result.ok) {
        const sent = result.value;
        if ('refusal' in sent) {
          changedElsewhere =
            sent.refusal === 'pendingReviewExists' ||
            sent.refusal === 'gone' ||
            sent.refusal === 'headMoved' ||
            (sent.refusal === 'notInDiff' && namedReview);
        } else {
          changedElsewhere = sent.joinedPending !== undefined || sent.landedOn !== undefined;
        }
      } else {
        changedElsewhere =
          sendsComment && result.error instanceof GithubError && result.error.mayHavePosted();
      }
      return changedElsewhere ? [...again, PENDING, THREADS] : again;
    },
  );
}

/** Resolves the review thread `thread` on `pull`, or with `resolved: false` unresolves it. Never sent again by itself. */
export function resolveThreadOn(
  writer: ReviewWriter,
  pull: PullRef,
  thread: string,
  resolved: boolean,
): Promise<undefined | ReviewWriteRefusal> {
  const unchecked = !checksThread(writer, pull, thread);
  return writer.writeChanging(
    [pull],
    (client) => resolveThread(client, thread, resolved),
    (result) => (unchecked || gone(result) ? [THREADS] : []),
  );
}

/**
 * Replaces the text of `comment`, on `pull`, with `body`. The threads don't watch for edits, so an
 * edit in a thread reads them again; one on the pull request itself reads the timeline in full,
 * since the comment may be past its newest page. Never sent again by itself.
 */
export function editCommentOn(
  writer: ReviewWriter,
  pull: PullRef,
  comment: CommentId,
  body: string,
): Promise<undefined | ReviewWriteRefusal> {
  const inThread = comment.kind === 'thread';
  return writer.writeChanging(
    [pull],
    (client) => editComment(client, comment, body),
    // A pending comment that's gone may have gone with its review.
    (result) => (inThread ? (gone(result) ? [THREADS, PENDING] : [THREADS]) : [TIMELINE_IN_FULL]),
  );
}

/**
 * Deletes `comment`, on `pull`. A thread whose last comment goes is gone, and so is a posted review
 * without a summary, so a posted comment reads the timeline again in full: its review may be past
 * the newest page, and the check doesn't count it out. A pending comment doesn't. Never sent again
 * by itself.
 */
export function deleteCommentOn(
  writer: ReviewWriter,
  pull: PullRef,
  comment: CommentId,
): Promise<undefined | ReviewWriteRefusal> {
  const again: Reread[] = [];
  if (comment.kind === 'thread') {
    const held = heldComment(writer, pull, comment.id);
    if (!held?.checked) again.push(THREADS);
    if (!held?.pending) again.push(TIMELINE_IN_FULL);
  } else {
    again.push(TIMELINE_IN_FULL);
  }
  return writer.writeChanging(
    [pull],
    (client) => deleteComment(client, comment),
    (result) => (comment.kind === 'thread' && gone(result) ? [...again, PENDING, THREADS] : again),
  );
}

/**
 * Comments `body` on `pull`, whose node ID is `pullRequestId`, in its conversation: the box at the
 * bottom of its timeline. Answers with the comment's node ID. Never sent again by itself.
 */
export function addConversationCommentOn(
  writer: ReviewWriter,
  pull: PullRef,
  pullRequestId: string,
  body: string,
): Promise<string | ReviewWriteRefusal> {
  return writer.writeChanging([pull], (client) =>
    addConversationComment(client, pullRequestId, body),
  );
}
