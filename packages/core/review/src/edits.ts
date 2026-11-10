/**
 * Editing and deleting your own comments in review threads (`docs/design.md`, "Comments"): which
 * comment a key acts on, and what a fresh read of the comment says about an edit or delete about
 * to go, or one whose answer was lost.
 *
 * Lo edits and deletes only your own comments: a comment GitHub lets you change but someone else
 * wrote, as a maintainer may, is theirs, and changing it is for GitHub's page. GitHub's
 * `updatePullRequestReviewComment` takes no expected text, so before an edit Lo reads the comment
 * afresh and sends the edit only when GitHub's text is still the one the edit started from (its
 * base): otherwise it would overwrite a newer edit made elsewhere. Texts are compared as GitHub
 * keeps them ({@link commentText}), never by `updatedAt`, which moves for changes to more than the
 * text.
 */

import type { CommentCannotUpdateReason } from '@lo/github';

import type { CommentState, Thread, ThreadComment } from './threads.ts';

/** What's done to a comment. */
export type CommentChange = 'edit' | 'delete';

/** Why Lo won't edit or delete a comment. */
export type EditRefusal =
  /** The thread has no comment of yours. */
  | { refusal: 'noneOfYours' }
  /** The comment is someone else's: their login, or nothing for a deleted account. */
  | { refusal: 'theirs'; author: string | undefined }
  /** It's yours, but GitHub doesn't let you change it now, as when the conversation is locked. */
  | { refusal: 'notAllowed' };

/** Whether `comment` is `viewer`'s own. Logins ignore case, as GitHub's do; a deleted account's comment is nobody's. */
export function isYours(comment: ThreadComment, viewer: string): boolean {
  return comment.author !== undefined && asciiLowercase(comment.author) === asciiLowercase(viewer);
}

/** Why Lo wouldn't make `change` to `comment` for `viewer`, or nothing when it would: it's theirs, and GitHub lets them. */
export function changeRefusal(
  comment: ThreadComment,
  viewer: string,
  change: CommentChange,
): EditRefusal | undefined {
  if (!isYours(comment, viewer)) return { refusal: 'theirs', author: comment.author };
  const allowed = change === 'edit' ? comment.viewerCanUpdate : comment.viewerCanDelete;
  return allowed ? undefined : { refusal: 'notAllowed' };
}

/** The comment of `thread` that a key makes `change` to for `viewer`: their newest one GitHub lets them change. */
export function newestYours(
  thread: Pick<Thread, 'comments'>,
  viewer: string,
  change: CommentChange,
): ThreadComment | EditRefusal {
  const yours = thread.comments.filter((comment) => isYours(comment, viewer)).toReversed();
  if (yours.length === 0) return { refusal: 'noneOfYours' };
  const allowed = yours.find((comment) => changeRefusal(comment, viewer, change) === undefined);
  return allowed ?? { refusal: 'notAllowed' };
}

/** A comment's text as GitHub keeps it, to compare: Unix line ends, trimmed. */
export function commentText(text: string): string {
  return text.replaceAll('\r\n', '\n').trim();
}

/** Whether two comment texts are the same as GitHub keeps them. */
export function sameCommentText(a: string, b: string): boolean {
  return commentText(a) === commentText(b);
}

/** A review thread comment as a fresh read of it finds it, with its thread. */
export interface CommentNow {
  /** `body`. */
  body: string;
  /** `author.login`; nothing for a deleted account. */
  author: string | undefined;
  /** `state`. */
  state: CommentState;
  /** `lastEditedAt`: when its text last changed, if it ever did, as an ISO 8601 time. */
  lastEditedAt: string | undefined;
  /** `editor.login`: who changed it last, if anyone did. */
  editor: string | undefined;
  /** `viewerDidAuthor`: whether it's the reader's own, as GitHub says. */
  viewerDidAuthor: boolean;
  /** `viewerCanUpdate`. */
  viewerCanUpdate: boolean;
  /** `viewerCanDelete`. */
  viewerCanDelete: boolean;
  /** `viewerCannotUpdateReasons`, such as `LOCKED`. */
  cannotUpdate: CommentCannotUpdateReason[];
  /** How many comments its thread holds, this one included. */
  threadComments: number;
  /** Whether its thread is resolved. */
  resolved: boolean;
  /** For a pending comment, how many comments your pending review holds, this one included. */
  reviewComments: number | undefined;
}

/**
 * What a fresh read says about an edit from `base` to new text, about to be sent:
 *
 * - `send`: GitHub's text is still the base, so it can go.
 * - `alreadySo`: GitHub's text is already the new text: there's nothing to send.
 * - `changed`: GitHub's text is neither: someone changed it since the edit started.
 * - `gone`: the comment is gone: deleted, or out of the reader's sight.
 * - `theirs`: GitHub says it isn't yours.
 * - `notAllowed`: GitHub no longer lets you edit it, for its `reasons`.
 */
export type BeforeEdit =
  | { kind: 'send' }
  | { kind: 'alreadySo' }
  | { kind: 'changed'; now: CommentNow }
  | { kind: 'gone' }
  | { kind: 'theirs' }
  | { kind: 'notAllowed'; reasons: CommentCannotUpdateReason[] };

/**
 * What `found`, read just now, says about sending `text` over the comment whose text the edit
 * started from, `base`. Nothing found means the comment is gone.
 */
export function beforeEdit(base: string, text: string, found: CommentNow | undefined): BeforeEdit {
  if (found === undefined) return { kind: 'gone' };
  if (!found.viewerDidAuthor) return { kind: 'theirs' };
  if (sameCommentText(found.body, text)) return { kind: 'alreadySo' };
  if (!found.viewerCanUpdate) return { kind: 'notAllowed', reasons: found.cannotUpdate };
  return sameCommentText(found.body, base) ? { kind: 'send' } : { kind: 'changed', now: found };
}

/**
 * What a read made after an edit's answer was lost says about it:
 *
 * - `taken`: GitHub has the text sent: it took the edit.
 * - `notTaken`: GitHub still has the base: it didn't.
 * - `changed`: GitHub has another text: someone changed it, before or after the edit went in.
 * - `gone`: the comment is gone.
 */
export type AfterEdit =
  | { kind: 'taken' }
  | { kind: 'notTaken' }
  | { kind: 'changed'; now: CommentNow }
  | { kind: 'gone' };

/**
 * What `found` says about an edit from `base` that sent `sent`, whose answer was lost. The text
 * sent is looked for first, so an edit that went in is never taken for someone else's.
 */
export function afterLostEdit(
  base: string,
  sent: string,
  found: CommentNow | undefined,
): AfterEdit {
  if (found === undefined) return { kind: 'gone' };
  if (sameCommentText(found.body, sent)) return { kind: 'taken' };
  if (sameCommentText(found.body, base)) return { kind: 'notTaken' };
  return { kind: 'changed', now: found };
}

/**
 * What deleting a comment would do, as a question shows it: what it says, whether it's pending,
 * and whether its thread goes with it. Frozen when asked, and compared with a fresh read when
 * answered.
 */
export interface DeleteFacts {
  /** Its text, as GitHub keeps it ({@link commentText}). */
  body: string;
  /** Whether it's in your pending review. */
  pending: boolean;
  /** Whether it's its thread's only comment, so the thread goes too. */
  onlyComment: boolean;
  /**
   * For a pending comment, how many comments your pending review holds, this one included: the
   * question says how many it'll hold after. Nothing for a posted one.
   */
  reviewComments: number | undefined;
}

/**
 * The facts of deleting `comment` in `thread`, as Lo last read them, with your pending review
 * holding `reviewComments` comments, as Lo last knew.
 */
export function deleteFacts(
  thread: Pick<Thread, 'comments'>,
  comment: ThreadComment,
  reviewComments: number | undefined,
): DeleteFacts {
  const pending = comment.state === 'PENDING';
  return {
    body: commentText(comment.body),
    pending,
    onlyComment: thread.comments.length <= 1,
    reviewComments: pending ? reviewComments : undefined,
  };
}

/** The facts of deleting the comment as a fresh read found it. */
export function deleteFactsNow(now: CommentNow): DeleteFacts {
  const pending = now.state === 'PENDING';
  return {
    body: commentText(now.body),
    pending,
    onlyComment: now.threadComments <= 1,
    reviewComments: pending ? now.reviewComments : undefined,
  };
}

/** `text` with its ASCII letters lowercased, as GitHub's logins are. */
function asciiLowercase(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
