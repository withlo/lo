// What main makes of the reads and answers that resolving, editing and deleting go by, as plain
// functions: a comment as a fresh read finds it, GitHub's refusals in the window's terms, and
// whether a comment is still as a question to delete it showed it. Nothing here calls Electron.

import {
  type CommentId,
  describeReviewRefusal,
  GithubError,
  type GithubClient,
  type ReviewCommentRead,
  type ReviewWriteRefusal,
  reviewComment,
} from '@lo/github';
import {
  type CommentChange,
  type CommentNow,
  changeRefusal,
  commentText,
  deleteFactsNow,
  type ThreadComment,
} from '@lo/review';

import type { ActRefusal, DeleteAsked, ThreadCommentRow } from '../contract.ts';

/** A comment in a review thread, by its node ID, as the poller's writes name it. */
export function inThread(comment: string): CommentId {
  return { kind: 'thread', id: comment };
}

/**
 * The comment a fresh read found, with its thread, as `@lo/review` reads it: nothing when it's
 * gone, deleted or out of the account's sight.
 */
export function commentNow(read: ReviewCommentRead): CommentNow | undefined {
  const { comment, thread } = read;
  if (comment?.__typename !== 'PullRequestReviewComment') return undefined;
  const pending = comment.state === 'PENDING';
  const inThreadNow = thread?.__typename === 'PullRequestReviewThread' ? thread : undefined;
  return {
    body: comment.body,
    author: comment.author?.login,
    state: pending ? 'PENDING' : 'SUBMITTED',
    lastEditedAt: comment.lastEditedAt ?? undefined,
    editor: comment.editor?.login,
    viewerDidAuthor: comment.viewerDidAuthor,
    viewerCanUpdate: comment.viewerCanUpdate,
    viewerCanDelete: comment.viewerCanDelete,
    cannotUpdate: comment.viewerCannotUpdateReasons,
    threadComments: inThreadNow?.comments.totalCount ?? 1,
    resolved: inThreadNow?.isResolved ?? false,
    reviewComments: pending ? comment.pullRequestReview?.comments.totalCount : undefined,
  };
}

/**
 * Reads the comment `comment` in the thread `thread` as GitHub has it now: nothing when it's gone,
 * which GitHub answers as "not found".
 */
export async function readComment(
  client: GithubClient,
  thread: string,
  comment: string,
): Promise<CommentNow | undefined> {
  try {
    return commentNow(await reviewComment(client, comment, thread));
  } catch (error) {
    if (error instanceof GithubError && error.detail.kind === 'notFound') return undefined;
    throw error;
  }
}

/** A comment of a thread main read, as `@lo/review` reads it. */
export function coreComment(row: ThreadCommentRow): ThreadComment {
  return {
    id: row.id,
    author: row.author ?? undefined,
    body: row.body,
    state: row.state,
    createdAt: row.createdAt,
    url: row.url,
    hidden: row.hidden ?? undefined,
    viewerCanUpdate: row.viewerCanUpdate,
    viewerCanDelete: row.viewerCanDelete,
  };
}

/**
 * Why Lo won't make `change` to `comment` as `login`, from what it last read of it: nothing when
 * it's theirs and GitHub lets them.
 */
export function changeRefused(
  comment: ThreadCommentRow,
  login: string,
  change: CommentChange,
): ActRefusal | undefined {
  const refused = changeRefusal(coreComment(comment), login, change);
  if (refused === undefined) return undefined;
  switch (refused.refusal) {
    case 'theirs':
      return { kind: 'theirs', author: refused.author ?? null };
    case 'notAllowed':
    case 'noneOfYours':
      return { kind: 'notAllowed', reasons: [] };
    default:
      refused satisfies never;
      return { kind: 'notAllowed', reasons: [] };
  }
}

/** GitHub's refusal of an edit, a resolve or a delete, or Lo's while GitHub asked it to hold off. */
export function actRefusal(refusal: ReviewWriteRefusal): ActRefusal {
  switch (refusal.refusal) {
    case 'paused':
      return { kind: 'paused', until: refusal.until };
    case 'gone':
      return { kind: 'gone' };
    case 'notInDiff':
    case 'headMoved':
    case 'pendingReviewExists':
    case 'ownPullRequest':
    case 'nothingToSubmit':
    case 'tooFast':
    case 'unexplained':
    case 'other':
      return { kind: 'github', message: `${describeReviewRefusal(refusal)}.` };
    default:
      refusal satisfies never;
      return { kind: 'github', message: 'GitHub refused it.' };
  }
}

/**
 * Whether `now`, the comment as a fresh read found it, is as the question to delete it showed it,
 * `asked`: the same text, in your pending review or not alike, and its thread's only comment or not
 * alike, so deleting it does what the question said.
 */
export function asAsked(asked: DeleteAsked, now: CommentNow): boolean {
  const facts = deleteFactsNow(now);
  return (
    facts.body === commentText(asked.body) &&
    facts.pending === asked.pending &&
    facts.onlyComment === asked.onlyComment
  );
}
