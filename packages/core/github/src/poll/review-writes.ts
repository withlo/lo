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
 *
 * While GitHub has asked Lo to hold off writing (the poller's `writesHeldUntil`), none is sent: each
 * is refused (`paused`), as GitHub's own refusal of content sent too fast is, and its draft stays
 * until the person sends it again. Lo doesn't post by itself minutes after they asked.
 */

import type { GithubClient } from '../client.ts';
import { GithubError } from '../errors.ts';
import { CHECKED_THREADS } from '../queries.ts';
import type { PullRef } from '../refs.ts';
import {
  addConversationComment,
  deleteComment,
  editComment,
  offHead,
  resolveThread,
  reviewComment,
  sendReviewWrite,
  type CommentId,
  type ReviewWrite,
  type ReviewWriteRefusal,
  type Sent,
} from '../review-writes.ts';
import type { ReviewThreadList } from '../threads.ts';
import type { Reread, WriteOptions } from './poller.ts';
import { PENDING_REVIEW, REVIEW_THREADS, TIMELINE, type ReadKind } from './reads.ts';

/** What these writes need of the poller. */
export interface ReviewWriter {
  writeChanging<T>(
    targets: readonly PullRef[],
    request: (client: GithubClient) => Promise<T>,
    options?: WriteOptions<T>,
  ): Promise<T>;
  readOnce<T>(request: (client: GithubClient) => Promise<T>, signal?: AbortSignal): Promise<T>;
  cachedRead<T>(pull: PullRef, kind: ReadKind<T>): { value: T } | undefined;
}

/** Lo's refusal of a write while GitHub has asked it to hold off, until `until`. */
function paused(until: number): ReviewWriteRefusal {
  return { refusal: 'paused', until };
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
 * GitHub puts a line thread added to your pending review on the pull request's head when it gets
 * it. When that isn't the head the comment was planned on, or GitHub doesn't say which it is
 * ({@link offHead}), Lo takes the thread back ({@link takeBack}) and refuses the write as
 * `headMoved`, so the draft stays for the head it was written on. One it can't take back comes
 * back flagged with where it landed ({@link Sent.landedOn}). The delete goes in the add's own turn
 * in the account's queue, so no write waiting there, such as your review's submit, can go before
 * it and publish the thread where it landed.
 *
 * It's never sent again by itself. When it fails in a way that may have posted it anyway
 * ({@link GithubError.mayHavePosted}), the UI compares the draft with your newest comments, as the
 * read-back brings them, before offering to send it again.
 */
export async function sendReview(
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
  // The delete that takes back a thread GitHub put on another head, once it's sent.
  let deleting: Promise<undefined | ReviewWriteRefusal> | undefined;
  const sent = await writer.writeChanging(
    [pull],
    (client) => sendReviewWrite(client, pull, write),
    {
      whilePaused: paused,
      content: true,
      again: (result) => {
        const again = unchecked ? [THREADS] : [];
        let changedElsewhere: boolean;
        if (result.ok) {
          const answer = result.value;
          if ('refusal' in answer) {
            changedElsewhere =
              answer.refusal === 'pendingReviewExists' ||
              answer.refusal === 'gone' ||
              (answer.refusal === 'notInDiff' && namedReview);
          } else {
            changedElsewhere = answer.joinedPending !== undefined || offHead(write, answer);
          }
        } else {
          changedElsewhere =
            sendsComment && result.error instanceof GithubError && result.error.mayHavePosted();
        }
        return changedElsewhere ? [...again, PENDING, THREADS] : again;
      },
      followUp: (answer) => {
        const comment = 'refusal' in answer || !offHead(write, answer) ? undefined : answer.comment;
        if (comment === undefined) return undefined;
        return (client) => (deleting = deleteComment(client, { kind: 'thread', id: comment }));
      },
    },
  );
  if ('refusal' in sent || !offHead(write, sent)) return sent;
  return takeBack(writer, sent, deleting);
}

/**
 * Settles the taking back of the line thread `sent`, which GitHub put on another head than the one
 * planned, or on one it didn't name. `deleting` is the delete of its comment, which takes the
 * thread with it, sent the spacing after the add in the add's own turn, or nothing when it wasn't
 * sent: GitHub asked Lo to hold off by then, or there's no comment to delete. Once GitHub says the
 * comment is deleted, or gone, the write is refused as `headMoved`. When GitHub's answer doesn't
 * say so, or is lost, Lo reads whether the comment is still there. When it is, when that can't be
 * read, or when the delete wasn't sent or was refused, the thread comes back flagged with the head
 * it landed on.
 */
async function takeBack(
  writer: ReviewWriter,
  sent: Sent,
  deleting: Promise<undefined | ReviewWriteRefusal> | undefined,
): Promise<Sent | ReviewWriteRefusal> {
  const moved: ReviewWriteRefusal = { refusal: 'headMoved', head: sent.commit };
  const flagged: Sent = { ...sent, landedOn: { head: sent.commit } };
  const { comment, thread } = sent;
  if (comment === undefined || deleting === undefined) return flagged;
  let deleted: { ok: true; value: undefined | ReviewWriteRefusal } | { ok: false; error: unknown };
  try {
    deleted = { ok: true, value: await deleting };
  } catch (error) {
    deleted = { ok: false, error };
  }
  if (deleted.ok) {
    // Deleted, by GitHub's answer, or gone already.
    if (deleted.value === undefined || deleted.value.refusal === 'gone') return moved;
    // Answered with nothing that says it was deleted: it may have been.
    if (deleted.value.refusal !== 'unexplained') return flagged;
  } else if (!(deleted.error instanceof GithubError) || !deleted.error.mayHavePosted()) {
    // Not done: never sent, or refused, as for the rate limit.
    return flagged;
  }
  return (await confirmedGone(writer, comment, thread)) ? moved : flagged;
}

/**
 * Whether the comment `comment`, in the thread `thread`, is gone, by a read: true only when GitHub
 * says it is. A comment that's gone answers "not found".
 */
async function confirmedGone(
  writer: ReviewWriter,
  comment: string,
  thread: string | undefined,
): Promise<boolean> {
  if (thread === undefined) return false;
  try {
    const read = await writer.readOnce((client) => reviewComment(client, comment, thread));
    if (!read.comment) return true;
    const { __typename: typename } = read.comment;
    return typename !== 'PullRequestReviewComment';
  } catch (error) {
    return error instanceof GithubError && error.detail.kind === 'notFound';
  }
}

/** Resolves the review thread `thread` on `pull`, or with `resolved: false` unresolves it. Never sent again by itself. */
export function resolveThreadOn(
  writer: ReviewWriter,
  pull: PullRef,
  thread: string,
  resolved: boolean,
): Promise<undefined | ReviewWriteRefusal> {
  const unchecked = !checksThread(writer, pull, thread);
  return writer.writeChanging([pull], (client) => resolveThread(client, thread, resolved), {
    again: (result) => (unchecked || gone(result) ? [THREADS] : []),
    whilePaused: paused,
  });
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
  return writer.writeChanging([pull], (client) => editComment(client, comment, body), {
    // A pending comment that's gone may have gone with its review.
    again: (result) =>
      inThread ? (gone(result) ? [THREADS, PENDING] : [THREADS]) : [TIMELINE_IN_FULL],
    whilePaused: paused,
    content: true,
  });
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
  return writer.writeChanging([pull], (client) => deleteComment(client, comment), {
    again: (result) =>
      comment.kind === 'thread' && gone(result) ? [...again, PENDING, THREADS] : again,
    whilePaused: paused,
  });
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
  return writer.writeChanging(
    [pull],
    (client) => addConversationComment(client, pullRequestId, body),
    { whilePaused: paused, content: true },
  );
}
