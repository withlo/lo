// Comments on a pull request itself, in its conversation, in main: the write, which joins no
// review, and whether one whose answer was lost posted, as the pull request's timeline read afresh
// says. The writer sends them, in turn with every other write to the pull request, from the draft
// of the pull request's own comment box. Your comments there are edited and deleted as a review
// thread's are, from what a fresh read of the timeline finds of them. Nothing here calls Electron.

import {
  type CommentId,
  GithubError,
  type GithubClient,
  type Poller,
  type PullRef,
  type PullRequestTimeline,
  readTimeline,
  type ReviewWriteRefusal,
  type TimelineComment,
} from '@lo/github';
import { type CommentNow, sameCommentText } from '@lo/review';

import type { ThreadCommentRow } from '../contract.ts';

/** What a comment on a pull request uses of an account's poller. */
export type ConversationPoller = Pick<Poller, 'addConversationComment'>;

/**
 * Posts `body` on `pull`, whose node ID is `pullRequestId`, in its conversation: the comment's node
 * ID, or GitHub's refusal, as while GitHub asked Lo to hold off writing. Never sent again by
 * itself: an answer lost throws an error that may have posted.
 */
export function postOnPull(
  poller: ConversationPoller,
  pull: PullRef,
  pullRequestId: string,
  body: string,
): Promise<string | ReviewWriteRefusal> {
  return poller.addConversationComment(pull, pullRequestId, body);
}

/**
 * Whether `timeline` holds a comment of `login`'s on the pull request itself whose text is `sent`,
 * made no earlier than `sentAt`, by GitHub's clock, give or take `slack` milliseconds.
 */
export function holdsPullComment(
  timeline: Pick<PullRequestTimeline, 'items'>,
  login: string,
  sent: string,
  sentAt: number,
  slack: number,
): boolean {
  const lower = login.toLowerCase();
  return timeline.items.some(
    ({ item }) =>
      item.kind === 'comment' &&
      item.comment.author?.login.toLowerCase() === lower &&
      Date.parse(item.comment.createdAt) >= sentAt - slack &&
      sameCommentText(item.comment.body, sent),
  );
}

/** A comment on the pull request itself, by its node ID, as the poller's writes name it. */
export function onPull(comment: string): CommentId {
  return { kind: 'conversation', id: comment };
}

/** The comment `id` on the pull request itself, as `timeline` holds it, if it does. */
export function pullComment(
  timeline: Pick<PullRequestTimeline, 'items'> | undefined,
  id: string,
): TimelineComment | undefined {
  for (const { item } of timeline?.items ?? []) {
    if (item.kind === 'comment' && item.comment.id === id) return item.comment;
  }
  return undefined;
}

/** A comment on the pull request itself as a thread's comment row has it, to judge a change to it. */
export function pullCommentRow(comment: TimelineComment): ThreadCommentRow {
  return {
    id: comment.id,
    author: comment.author?.login ?? null,
    authorType: comment.author?.type ?? null,
    body: comment.body,
    state: 'SUBMITTED',
    createdAt: comment.createdAt,
    url: comment.url,
    hidden: comment.hidden ?? null,
    viewerCanUpdate: comment.viewerCanUpdate,
    viewerCanDelete: comment.viewerCanDelete,
  };
}

/**
 * A comment on the pull request itself as `@lo/review` reads one a fresh read found, read as
 * `login`: yours when its author is. It's in no thread and no review.
 */
export function pullCommentNow(comment: TimelineComment, login: string): CommentNow {
  const author = comment.author?.login;
  return {
    body: comment.body,
    author,
    state: 'SUBMITTED',
    lastEditedAt: comment.lastEditedAt,
    editor: undefined,
    viewerDidAuthor: author !== undefined && author.toLowerCase() === login.toLowerCase(),
    viewerCanUpdate: comment.viewerCanUpdate,
    viewerCanDelete: comment.viewerCanDelete,
    cannotUpdate: [],
    threadComments: 1,
    resolved: false,
    reviewComments: undefined,
  };
}

/**
 * The comment `id` on the pull request itself, as `timeline`, read just now as `login`, has it:
 * nothing when it's gone. One that may be among the older items the read left out can't be told
 * from one that's gone, so that fails, as a read that settles nothing.
 */
export function pullCommentIn(
  timeline: PullRequestTimeline,
  id: string,
  login: string,
): CommentNow | undefined {
  const found = pullComment(timeline, id);
  if (found) return pullCommentNow(found, login);
  if (timeline.leftOut > 0) {
    throw new GithubError({
      kind: 'inconsistent',
      message: 'Lo can’t find the comment among the timeline’s newest events.',
    });
  }
  return undefined;
}

/**
 * Reads `pull`'s timeline afresh, in full, and finds the comment `id` on the pull request itself
 * there, as `login` reads it: nothing when it's gone.
 */
export async function readPullComment(
  client: GithubClient,
  pull: PullRef,
  id: string,
  login: string,
): Promise<CommentNow | undefined> {
  return pullCommentIn(await readTimeline(client, pull), id, login);
}
