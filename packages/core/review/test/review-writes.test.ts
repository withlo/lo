/**
 * Comments, replies, reviews and their edits, replayed from what `rozed-bot` wrote on its own pull
 * request, E11 (`rozed-dev/e2e#23`), through the scenarios that recorded them
 * (`scenarios/review-writes.ts`). The replaying `fetch` answers a request only when it's the one
 * recorded, variables and all, so each test also checks what Lo sends.
 */

import { GithubClient, type PullRequestCheck, type ReviewThreadList, Token } from '@lo/github';
import { replayFetch, type ReplayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

import { Line, Lines, Thread, threadsFromGithub } from '../src/index.ts';
import {
  BOT,
  conversation,
  edits,
  EDIT_PENDING_EDITED,
  MARK,
  NOTES,
  pending,
  posted,
  REVIEWED,
  stale,
  threads,
  type Found,
} from './scenarios/review-writes.ts';

function client(fetch: ReplayFetch): GithubClient {
  return new GithubClient({ fetch, token: new Token('gho_FAKE') });
}

async function noPause(): Promise<void> {}

/** The body of a request, which is JSON when it has one. */
function bodyOf(seen: ReplayFetch['seen'][number]): unknown {
  return seen.body.length === 0 ? undefined : JSON.parse(new TextDecoder().decode(seen.body));
}

/** What each request was: a GraphQL operation's name, or a REST method and path. */
function requests(fetch: ReplayFetch): string[] {
  return fetch.seen.map((seen) => {
    const body = bodyOf(seen);
    if (
      typeof body === 'object' &&
      body !== null &&
      'operationName' in body &&
      typeof body.operationName === 'string'
    ) {
      return body.operationName;
    }
    return `${seen.method} ${seen.url.replace('https://api.github.com', '')}`;
  });
}

/** The variables of each GraphQL request named `operation`, in order. */
function variables(fetch: ReplayFetch, operation: string): unknown[] {
  return fetch.seen.flatMap((seen) => {
    const body = bodyOf(seen);
    if (
      typeof body === 'object' &&
      body !== null &&
      'operationName' in body &&
      body.operationName === operation &&
      'variables' in body
    ) {
      return [body.variables];
    }
    return [];
  });
}

/** The comments of every thread in `list`, by ID. */
function commentIds(list: ReviewThreadList): string[] {
  return list.nodes
    .flatMap((thread) => thread.comments.nodes ?? [])
    .filter((comment) => comment !== null)
    .map((comment) => comment.id);
}

/** The comment a read found, and its thread, for a read that found them. */
function here(found: Found) {
  if (found.kind !== 'here') throw new Error('gone');
  const { comment, thread } = found.read;
  if (!comment || !('body' in comment)) throw new Error('not a review comment');
  if (!thread || !('isResolved' in thread)) throw new Error('not a review thread');
  return { comment, thread };
}

test('a pending review starts with a line thread and gathers threads and replies', async () => {
  const fetch = replayFetch('review_writes_e2e_23_pending');
  const seen = await pending(client(fetch), noPause);

  expect(requests(fetch)).toEqual([
    'GET /repos/rozed-dev/e2e/pulls/23',
    'PendingReview',
    'AddPullRequestReview',
    'PendingReview',
    'AddPullRequestReviewThread',
    'AddPullRequestReviewThread',
    'AddPullRequestReviewThread',
    'ReviewState',
    'AddPullRequestReviewThread',
    'ReviewState',
    'ReviewThreads',
    'AddPullRequestReviewThreadReply',
    'PendingReview',
    'PullRequestCheck',
    'AddPullRequestReview',
    'POST /repos/rozed-dev/e2e/pulls/23/comments',
    'AddPullRequestReviewThreadReply',
    'SubmitPullRequestReview',
    'PendingReview',
  ]);
  expect(seen.id).toMatch(/^PR_/);
  expect(seen.before).toEqual({ kind: 'read', review: undefined });
  const review = seen.started.review;
  expect(review).toMatch(/^PRR_/);
  expect(seen.started.comment).toBeDefined();

  // `reviews(states: PENDING, author: $login)` finds your pending review, on the commit it was
  // started on.
  expect(seen.afterStart).toMatchObject({
    kind: 'read',
    review: { id: review, commit: { oid: seen.head }, comments: { totalCount: 1 } },
  });

  // Each thread added to it names it, and the thread GitHub made.
  for (const sent of [seen.range, seen.file, seen.reply]) {
    expect(sent.review).toBe(review);
    expect(sent.thread).toBeDefined();
    expect(sent.comment).toBeDefined();
  }
  // Nobody pushed: GitHub put the line thread on the head it was written on, which its answer
  // names, so Lo kept it there rather than taking it back.
  expect(seen.range.landedOn).toBeUndefined();
  // A range from the base starts on the base's side; GitHub's default would be the head's.
  // A file-level thread has no lines.
  const added = variables(fetch, 'AddPullRequestReviewThread');
  expect(added[0]).toMatchObject({ startSide: 'LEFT', startLine: 10 });
  expect(added[1]).toMatchObject({ subjectType: 'FILE' });
  expect(added[1]).not.toHaveProperty('line');
  // GitHub answers `thread: null`, with no error, for a line outside the diff and for a file the
  // pull request doesn't change; Lo asks whether the review is still pending, and it is.
  expect(seen.outside).toEqual({ refusal: 'notInDiff' });
  expect(seen.unchanged).toEqual({ refusal: 'notInDiff' });

  // Your pending threads are among the review threads, for you: pending, and not resolvable.
  // Others on E11, left by other checks, aren't this scenario's.
  const mine = threadsFromGithub(seen.threads).filter((thread) =>
    thread.comments[0]?.body.startsWith(MARK),
  );
  expect(mine).toHaveLength(3);
  for (const thread of mine) {
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0]?.state).toBe('PENDING');
    expect(thread.comments[0]?.author).toBe(BOT);
    expect(thread.viewerCanReply).toBe(true);
    expect(thread.viewerCanResolve).toBe(false);
    expect(thread.currentOn).toBe(seen.head);
  }
  const onLines = mine
    .filter((thread) => thread.path === REVIEWED)
    .map((thread) => Thread.currentLines(thread));
  expect(onLines).toContainEqual(Lines.one(Line.right(10)));
  expect(onLines).toContainEqual(Lines.range(Line.left(10), Line.right(11)));
  const file = mine.find((thread) => thread.path === NOTES);
  expect(file?.subject).toBe('FILE');
  expect(file && Thread.currentLines(file)).toBeUndefined();

  // Four comments, which the check counts too, without asking for yours by login.
  expect(seen.beforeSubmit).toMatchObject({
    kind: 'read',
    review: { comments: { totalCount: 4 } },
  });
  expect(seen.check.viewerPendingReview?.nodes?.[0]).toEqual({
    viewerDidAuthor: true,
    comments: { totalCount: 4 },
  });

  // While it's pending, GitHub refuses a comment posted at once, through GraphQL or REST.
  expect(seen.postWhilePending).toEqual({ refusal: 'pendingReviewExists' });
  expect(seen.fileCommentWhilePending).toEqual({ refusal: 'pendingReviewExists' });
  // A reply sent to be posted at once isn't refused: it joins the pending review, quietly but
  // for its state, which Lo reads.
  const joined = seen.replyWhilePending;
  expect(joined.joinedPending).toBe(review);
  expect(joined.review).toBe(review);
  const replies = variables(fetch, 'AddPullRequestReviewThreadReply');
  expect(replies[1]).not.toHaveProperty('pullRequestReviewId');
  expect(seen.reply.joinedPending).toBeUndefined();

  expect(seen.submitted.review).toBe(review);
  expect(seen.after).toEqual({ kind: 'read', review: undefined });
  expect(seen.review.pending).toBeUndefined();
});

test('comments and reviews post at once and its author can only comment', async () => {
  const fetch = replayFetch('review_writes_e2e_23_posted');
  const seen = await posted(client(fetch), noPause);

  expect(requests(fetch)).toEqual([
    'GET /repos/rozed-dev/e2e/pulls/23',
    'ReviewThreads',
    'AddPullRequestReviewThreadReply',
    'AddPullRequestReview',
    'POST /repos/rozed-dev/e2e/pulls/23/comments',
    'AddPullRequestReview',
    'AddPullRequestReview',
    'AddPullRequestReview',
    'AddPullRequestReview',
    'AddPullRequestReview',
    'AddPullRequestReviewThreadReply',
    'SubmitPullRequestReview',
    'PendingReview',
  ]);
  // A reply posted at once is a review of its own, as is a line comment.
  for (const review of [seen.reply.review, seen.line.review, seen.summary.review]) {
    expect(review).toMatch(/^PRR_/);
  }
  expect(seen.reply.comment).toBeDefined();
  expect(seen.line.comment).toBeDefined();
  // REST's file comment names its comment, not its review's node ID.
  expect(seen.file.review).toBeUndefined();
  expect(seen.file.comment).toMatch(/^PRRC_/);
  const reply = variables(fetch, 'AddPullRequestReviewThreadReply')[0];
  expect(reply).not.toHaveProperty('pullRequestReviewId');
  // Without a pending review, it's posted.
  expect(seen.reply.joinedPending).toBeUndefined();

  expect(seen.approve).toEqual({ refusal: 'ownPullRequest' });
  expect(seen.requestChanges).toEqual({ refusal: 'ownPullRequest' });
  // GitHub's message for a comment with nothing in it is empty.
  expect(seen.empty).toEqual({ refusal: 'nothingToSubmit' });
  // An approval without a summary sends none.
  const reviews = variables(fetch, 'AddPullRequestReview');
  expect(reviews[2]).toMatchObject({ event: 'APPROVE' });
  expect(reviews[2]).not.toHaveProperty('body');

  // A reply as the first comment: an empty review, then the reply joins it.
  const started = seen.startedEmpty.review;
  expect(started).toBeDefined();
  expect(seen.startedEmpty.comment).toBeUndefined();
  expect(seen.joined.review).toBe(started);
  expect(seen.submittedEmpty.review).toBe(started);
  // Submitted without a summary, it sends none: an empty one would wipe a summary written for the
  // pending review on GitHub's page.
  const submits = variables(fetch, 'SubmitPullRequestReview');
  expect(submits[0]).not.toHaveProperty('body');
  expect(seen.after).toEqual({ kind: 'read', review: undefined });
});

test('threads resolve and comments edit and delete and the check sees some', async () => {
  const fetch = replayFetch('review_writes_e2e_23_threads');
  const seen = await threads(client(fetch), noPause);

  expect(requests(fetch)).toEqual([
    'ReviewThreads',
    'PullRequestCheck',
    'ResolveReviewThread',
    'PullRequestCheck',
    'UnresolveReviewThread',
    'PullRequestCheck',
    'UpdatePullRequestReviewComment',
    'PullRequestCheck',
    'UpdatePullRequestReviewComment',
    'DeletePullRequestReviewComment',
    'PullRequestCheck',
    'DeletePullRequestReviewComment',
    'ReviewThreads',
  ]);
  expect(seen.resolved).toBeUndefined();
  expect(seen.unresolved).toBeUndefined();
  expect(seen.edited).toBeUndefined();
  expect(seen.deleted).toBeUndefined();
  expect(seen.blank).toEqual({ refusal: 'other', message: "Body can't be blank" });
  // GitHub says "not found".
  expect(seen.deletedAgain).toEqual({ refusal: 'gone' });

  const [initial, resolved, unresolved, edited, deleted] = seen.checks;
  const index = seen.before.nodes.findIndex((thread) => thread.id === seen.thread);
  expect(index).toBeGreaterThanOrEqual(0);
  const state = (check: PullRequestCheck) => check.reviewThreads.nodes?.[index];
  const count = (check: PullRequestCheck): number => {
    const total = state(check)?.comments.totalCount;
    if (total === undefined) throw new Error('the thread is not in the check');
    return total;
  };
  expect(state(resolved)?.isResolved).toBe(true);
  expect(state(unresolved)).toEqual(state(initial));
  // An edit moves nothing the threads watch, only the pull request's time: Lo reads them again
  // itself.
  expect(edited.reviewThreads).toEqual(unresolved.reviewThreads);
  expect(edited.timelineEvents).toEqual(unresolved.timelineEvents);
  expect(edited.updatedAt).not.toBe(unresolved.updatedAt);
  // Resolving doesn't move even that.
  expect(resolved.updatedAt).toBe(initial.updatedAt);
  // A deleted reply moves its thread's count.
  expect(count(deleted)).toBe(count(edited) - 1);
  expect(commentIds(seen.before)).toContain(seen.comment);
  expect(commentIds(seen.after)).not.toContain(seen.comment);
});

test('an edit of a conversation comment moves only the pull requests time', async () => {
  const fetch = replayFetch('review_writes_e2e_23_conversation');
  const seen = await conversation(client(fetch), noPause);

  expect(requests(fetch)).toEqual([
    'GET /repos/rozed-dev/e2e/pulls/23',
    'PullRequestCheck',
    'AddComment',
    'AddComment',
    'PullRequestCheck',
    'UpdateIssueComment',
    'PullRequestCheck',
    'DeleteIssueComment',
    'DeleteIssueComment',
    'PullRequestCheck',
  ]);
  expect(seen.first).toMatch(/^IC_/);
  expect(seen.second).toMatch(/^IC_/);
  expect(seen.edited).toBeUndefined();
  expect(seen.deleted).toEqual([undefined, undefined]);
  const [initial, commented, edited, deleted] = seen.checks;
  expect(commented.timelineEvents.filteredCount).toBe(initial.timelineEvents.filteredCount + 2);
  expect(commented.timelineEvents.updatedAt).not.toBe(initial.timelineEvents.updatedAt);
  // The timeline's time is its newest item's creation: an edit doesn't move it, so Lo reads the
  // timeline again itself. The pull request's own time moves.
  expect(edited.timelineEvents).toEqual(commented.timelineEvents);
  expect(edited.updatedAt).not.toBe(commented.updatedAt);
  // Deleting both takes the count and the time back.
  expect(deleted.timelineEvents).toEqual(initial.timelineEvents);
  expect(deleted.comments).toEqual(initial.comments);
});

test('writes naming what changed elsewhere are refused as gone', async () => {
  const fetch = replayFetch('review_writes_e2e_23_stale');
  const seen = await stale(client(fetch), noPause);

  expect(requests(fetch)).toEqual([
    'GET /repos/rozed-dev/e2e/pulls/23',
    'PendingReview',
    'AddPullRequestReview',
    'DeletePullRequestReview',
    'AddPullRequestReviewThread',
    'SubmitPullRequestReview',
    'AddPullRequestReview',
    'SubmitPullRequestReview',
    'AddPullRequestReviewThread',
    'ReviewState',
    'ReviewThreads',
    'AddPullRequestReviewThreadReply',
    'ReviewState',
    'DeletePullRequestReviewComment',
    'AddPullRequestReviewThreadReply',
    'PendingReview',
  ]);
  expect(seen.deleted).toBeUndefined();
  // A pending review deleted since: GitHub says "not found".
  expect(seen.threadOnDeleted).toEqual({ refusal: 'gone' });
  expect(seen.submitDeleted).toEqual({ refusal: 'gone' });
  // A review submitted since: GitHub answers `null` with no error, as for a line outside the
  // diff, and the review's state says why.
  expect(seen.submitted.review).toBeDefined();
  expect(seen.threadOnSubmitted).toEqual({ refusal: 'gone' });
  expect(seen.replyOnSubmitted).toEqual({ refusal: 'gone' });
  // A thread whose only comment was deleted since: "not found".
  expect(seen.deletedComment).toBeUndefined();
  expect(seen.replyToDeleted).toEqual({ refusal: 'gone' });
  expect(seen.after).toEqual({ kind: 'read', review: undefined });
});

/**
 * Edits and deletes of the bot's own comments, each read afresh before and after, as Lo reads them:
 * the read shows a pending comment's edit without an editor or time, a posted one's with both, and
 * NOT_FOUND once the comment is gone, which Lo reads as gone. A pending review goes with its only
 * comment; a thread stays when its first comment goes under a reply, which becomes its first, and
 * goes with its last; an edit goes through in a resolved thread.
 */
test('comments edited and deleted read as lo reads them', async () => {
  const fetch = replayFetch('review_writes_e2e_23_edits');
  const seen = await edits(client(fetch), noPause);

  expect(requests(fetch)).toEqual([
    'GET /repos/rozed-dev/e2e/pulls/23',
    'PendingReview',
    'AddPullRequestReview',
    'ReviewThreads',
    'ReviewComment',
    'UpdatePullRequestReviewComment',
    'ReviewComment',
    'DeletePullRequestReviewComment',
    'ReviewComment',
    'PendingReview',
    'AddPullRequestReview',
    'ReviewThreads',
    'AddPullRequestReviewThreadReply',
    'ReviewThreads',
    'ReviewComment',
    'ResolveReviewThread',
    'UpdatePullRequestReviewComment',
    'ReviewComment',
    'DeletePullRequestReviewComment',
    'ReviewThreads',
    'DeletePullRequestReviewComment',
    'ReviewThreads',
  ]);
  // The read names the comment and its thread.
  expect(variables(fetch, 'ReviewComment')[0]).toEqual({
    comment: seen.pending,
    thread: seen.pendingThread,
  });
  const pendingNow = here(seen.pendingRead);
  expect(pendingNow.comment.state).toBe('PENDING');
  expect(pendingNow.comment.viewerDidAuthor).toBe(true);
  expect(pendingNow.comment.viewerCanUpdate).toBe(true);
  expect(pendingNow.comment.viewerCanDelete).toBe(true);
  expect(pendingNow.thread.comments.totalCount).toBe(1);
  // Your pending review holds it alone.
  expect(pendingNow.comment.pullRequestReview).toEqual({
    state: 'PENDING',
    comments: { totalCount: 1 },
  });
  expect(seen.pendingEdited).toBeUndefined();
  const edited = here(seen.pendingAfterEdit).comment;
  expect(edited.body).toBe(`${MARK} ${EDIT_PENDING_EDITED}`);
  // GitHub records no edit of a pending comment.
  expect([edited.lastEditedAt, edited.editor]).toEqual([null, null]);
  expect(seen.pendingDeleted).toBeUndefined();
  expect(seen.pendingGone).toEqual({ kind: 'gone' });
  expect(seen.reviewAfterDelete).toEqual({ kind: 'read', review: undefined });

  const replyNow = here(seen.replyRead);
  // A posted comment's review isn't pending.
  expect(replyNow.comment.pullRequestReview?.state).not.toBe('PENDING');
  expect([
    replyNow.comment.state,
    replyNow.thread.comments.totalCount,
    replyNow.thread.isResolved,
  ]).toEqual(['SUBMITTED', 2, false]);
  expect(seen.resolved).toBeUndefined();
  expect(seen.replyEdited).toBeUndefined();
  const replyEdited = here(seen.replyAfterEdit);
  expect(replyEdited.thread.isResolved).toBe(true);
  expect(replyEdited.comment.editor?.login).toBe(BOT);
  expect(replyEdited.comment.lastEditedAt).toBe('2026-11-09T17:56:21Z');
  expect(seen.firstDeleted).toBeUndefined();
  const after = seen.threadsAfter.nodes.find((thread) => thread.id === seen.postedThread);
  expect(after, 'the thread stays').toBeDefined();
  const ids = (after?.comments.nodes ?? []).filter((comment) => comment !== null).map((c) => c.id);
  expect(ids).toEqual([seen.reply]);
  expect(ids).not.toContain(seen.first);
  expect(seen.replyDeleted).toBeUndefined();
  expect(
    seen.threadsEnd.nodes.every((thread) => thread.id !== seen.postedThread),
    'the thread goes with its last comment',
  ).toBe(true);
});
