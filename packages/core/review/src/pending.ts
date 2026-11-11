/**
 * Your pending review, and what Lo sends GitHub to comment and to submit a review
 * (`docs/design.md`, "Reviews" and "Acting on what you saw").
 *
 * Comments collect into a pending review, which GitHub stores, so it survives quitting Lo and shows
 * as pending on the web. GitHub keeps at most one per person per pull request. {@link YourReview}
 * holds yours and plans each step as a {@link Mutation}, the variables of the GraphQL mutation (or
 * the body of the REST request) that `@lo/github` sends: `c` adds a comment to it, starting it on
 * the first; `C` posts one comment at once; the submit dialog submits it, or reviews without one.
 * A review records the commit you looked at, so it approves or requests changes only while the
 * revision it's recorded on is on screen.
 *
 * GitHub's API leaves much of this undocumented. These were checked against GitHub:
 *
 * - A review is recorded on the commit it's started on (`addPullRequestReview`'s `commitOID`), and
 *   so are the threads it's started with. A thread added to it later (`addPullRequestReviewThread`,
 *   which takes no commit) goes on the pull request's current head instead, whatever the review's
 *   commit. So a line comment on an older revision is possible only by starting a review there.
 *   With a review pending, a new line comment is taken only while the right column shows the
 *   latest head; elsewhere it's refused, and the UI offers to submit the pending review or to
 *   switch to the latest revision.
 * - Replies have no lines, so they join the pending review from any revision.
 * - `addPullRequestReview`'s threads can't be file-level (its draft thread input has no subject
 *   type). So `c` on a file with no pending review is two calls: start an empty review, then
 *   `addPullRequestReviewThread` with `subjectType: FILE`. A reply as the first comment is two
 *   calls too: start, then reply. `C` on a file posts REST's file comment.
 * - A comment posted at once is a review of its own, which GitHub refuses while you have a pending
 *   review ("User can only have one pending review per pull request"), so `C` adds to the pending
 *   review instead, and says so.
 * - GitHub refuses a line outside the diff. `addPullRequestReview` answers "Line could not be
 *   resolved" and REST "could not be resolved", but `addPullRequestReviewThread` returns
 *   `thread: null` with no error. A null thread is a refusal, not an acceptance.
 *
 * Each call is planned and accepted on its own, so a failure loses nothing: the pending count
 * changes only when GitHub accepts a comment, and a comment's draft is kept until a mutation that
 * sends it ({@link sendsComment}) is accepted. The UI sends one call at a time and waits for its
 * answer: two `c`s before the first is accepted would plan two reviews, and GitHub refuses the
 * second.
 */

import type {
  AddPullRequestReviewMutationVariables,
  AddPullRequestReviewThreadMutationVariables,
  DraftPullRequestReviewThread,
  PendingReviewRead,
  ReviewWrite,
  ViewerPendingReview,
} from '@lo/github';

import { githubEnum } from './enums.ts';
import type { Lines } from './threads.ts';

/** What submitting a review does, in the order the submit dialog lists them. */
export const REVIEW_EVENTS = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'] as const;

/**
 * What submitting a review does: GraphQL's `PullRequestReviewEvent`, without `DISMISS`, which
 * dismisses someone else's review. `COMMENT` gives feedback without approving or requesting
 * changes.
 */
export type ReviewEvent = (typeof REVIEW_EVENTS)[number];

/** Reads a review event by its GraphQL name, ignoring case. Throws `UnknownValue` for any other. */
export function readReviewEvent(value: string): ReviewEvent {
  return githubEnum(REVIEW_EVENTS, value);
}

/**
 * Your pending review on GitHub: a review of yours whose `state` is `PENDING`. Field docs name the
 * `PullRequestReview` field each one comes from.
 */
export interface PendingReview {
  /** `id`. */
  readonly id: string;
  /**
   * `commit.oid`: the revision it's recorded on, which the review shows once submitted, and the
   * one the threads it was started with are on. Threads added to it later are on the heads that
   * were current when they were added, so they may be on later revisions. Nothing once GitHub no
   * longer has the commit: it's on no revision Lo shows, so it submits only as a comment.
   */
  readonly commit: string | undefined;
  /**
   * `comments.totalCount`: its threads and replies. {@link YourReview.accepted} counts the ones Lo
   * adds. Deleting a pending comment isn't one of the mutations planned here, so the pending review
   * is read again after one.
   */
  readonly comments: number;
}

/** Your pending review as `@lo/github` reads it, or nothing when you have none. */
export function pendingReviewFrom(
  read: ViewerPendingReview | undefined,
): PendingReview | undefined {
  if (read === undefined) return undefined;
  return {
    id: read.id,
    commit: read.commit?.oid,
    comments: Math.max(0, read.comments.totalCount),
  };
}

/**
 * Your review of the pull request with node ID `pullRequestId`, from `@lo/github`'s read of your
 * pending review: one that plans nothing when the read couldn't say whether you have one.
 */
export function yourReview(pullRequestId: string, read: PendingReviewRead): YourReview {
  return read.kind === 'unknown'
    ? YourReview.unknown(pullRequestId)
    : new YourReview(pullRequestId, pendingReviewFrom(read.review));
}

/** A new thread, on lines of the right column's revision or on a file. */
export interface NewThread {
  readonly kind: 'thread';
  readonly path: string;
  /**
   * The lines, of those GitHub takes a comment on (`CommentableLines`). Nothing for a file-level
   * comment, `subjectType: FILE`, which only `addPullRequestReviewThread` takes.
   */
  readonly lines?: Lines | undefined;
  /** In Markdown. */
  readonly body: string;
}

/** A reply to the thread with id `thread`. */
export interface NewReply {
  readonly kind: 'reply';
  readonly thread: string;
  readonly body: string;
}

/** A comment you write. */
export type NewComment = NewThread | NewReply;

/**
 * What to send GitHub: a GraphQL mutation's variables, or a REST request's body, with the head it
 * was planned against, as `@lo/github`'s `sendReviewWrite` takes it.
 *
 * - `startReview` starts your pending review on `commitOID`, holding the line comment it was
 *   planned for, if any: the only way to put a pending thread on a revision older than the latest
 *   head. Without one, it starts an empty review on the latest head, for a file-level comment or a
 *   reply, which can't go in `threads`; once it's accepted, {@link YourReview.add} plans the
 *   comment's own mutation.
 * - `addThread` adds a thread to your pending review, which GitHub puts on the pull request's
 *   current head. The sender checks that it's the head planned, `head`, and takes back a line
 *   thread that landed on a later one.
 * - `addReply` adds a reply to your pending review.
 * - `postThread`, `postFileComment` and `postReply` post one comment at once.
 * - `submitReview` submits your pending review, and `review` submits one with no comments.
 */
export type Mutation = ReviewWrite;

/**
 * Whether accepting `mutation` sends the comment it was planned for, so the comment's draft can
 * go: every comment mutation does but a `startReview` without a thread, which only starts the
 * review the comment then joins. Submitting a review sends no comment.
 */
export function sendsComment(mutation: Mutation): boolean {
  switch (mutation.kind) {
    case 'startReview':
      return draftCount(mutation.variables.threads) > 0;
    case 'addThread':
    case 'addReply':
    case 'postThread':
    case 'postFileComment':
    case 'postReply':
      return true;
    case 'submitReview':
    case 'review':
      return false;
    default:
      return mutation satisfies never;
  }
}

function draftCount(threads: AddPullRequestReviewMutationVariables['threads']): number {
  if (threads == null) return 0;
  return Array.isArray(threads) ? threads.length : 1;
}

/** What `C` sends. */
export interface Posting {
  mutation: Mutation;
  /**
   * Whether the comment is added to your pending review instead of posted at once: GitHub posts
   * nothing else from you while you have one, so the UI says so.
   */
  pending: boolean;
}

/** Why Lo won't send a comment or a review. */
export type ReviewRefusal =
  /** The comment is blank, which GitHub refuses. */
  | { refusal: 'blank' }
  /**
   * GitHub's answer didn't say whether you have a pending review. Starting one would be refused if
   * you do, and adding to one needs its id, so nothing that does either is planned until it's read
   * again. A reply posted at once (`C`) starts no review, so it's still planned.
   */
  | { refusal: 'pendingUnknown' }
  /**
   * The right column shows a revision older than the latest head, `head`, but a new line comment
   * would join your pending review, and GitHub puts the threads it adds to one on the latest head.
   * Submit the pending review first, or switch to the latest revision.
   */
  | { refusal: 'notLatest'; head: string }
  /**
   * Your pending review is recorded on another revision, `reviewOn`, so approving it or
   * requesting changes with it would record that on code that isn't on screen. Submit it as a
   * comment, or switch to its revision. Nothing when GitHub no longer has its commit.
   */
  | { refusal: 'otherRevision'; reviewOn: string | undefined }
  /** You opened the pull request, and GitHub lets its author only comment. */
  | { refusal: 'ownPullRequest' }
  /**
   * A comment or a request for changes needs a summary or a pending comment: GitHub requires a
   * body for them when the review holds nothing else.
   */
  | { refusal: 'nothingToSubmit' };

/** What the submit dialog shows. */
export interface SubmitDialog {
  /** The choices, in order: Comment, Approve and Request changes, or only Comment on your own pull request. */
  choices: readonly ReviewEvent[];
  /** How many comments your pending review holds. */
  pendingComments: number;
  /** The account you're acting as. */
  account: string;
  /**
   * The revision the review is recorded on: your pending review's, or else the right column's.
   * Nothing when GitHub no longer has your pending review's commit.
   */
  on: string | undefined;
  /**
   * Whether that's the revision on screen. When it isn't, your pending review was started on
   * another, and the dialog says which: it submits only as a comment there.
   */
  onScreen: boolean;
}

const ONLY_COMMENT: readonly ReviewEvent[] = ['COMMENT'];

/**
 * The submit dialog's choices: only Comment on your own pull request, since GitHub refuses its
 * author's approval or request for changes.
 */
export function reviewChoices(own: boolean): readonly ReviewEvent[] {
  return own ? ONLY_COMMENT : REVIEW_EVENTS;
}

/**
 * Your review of a pull request: your pending review on GitHub, if you have one, and the
 * mutations that comment on it and submit it.
 */
export class YourReview {
  /** The pull request's node ID, its `id`, which `addPullRequestReview` takes. */
  readonly pullRequestId: string;
  #pending: PendingReview | undefined;
  /** Whether GitHub said whether you have a pending review. */
  #known = true;

  /** Your review of the pull request with node ID `pullRequestId`, from your pending review on GitHub. */
  constructor(pullRequestId: string, pending?: PendingReview) {
    this.pullRequestId = pullRequestId;
    this.#pending = pending;
  }

  /**
   * Your review when GitHub's answer didn't say whether you have a pending review: it refuses every
   * comment and submission but a reply posted at once, with `pendingUnknown`.
   */
  static unknown(pullRequestId: string): YourReview {
    const review = new YourReview(pullRequestId);
    review.#known = false;
    return review;
  }

  /** Whether it's known whether you have a pending review. */
  get known(): boolean {
    return this.#known;
  }

  /** Your pending review, if you have one. */
  get pending(): PendingReview | undefined {
    return this.#pending;
  }

  /** How many comments your pending review holds. */
  get pendingComments(): number {
    return this.#pending?.comments ?? 0;
  }

  /**
   * What `c` sends next: `comment`, written while the right column shows revision `on`, added to
   * your pending review, or starting one. `head` is the pull request's latest head
   * (`headRefOid`).
   *
   * With no pending review, a line comment starts one on `on`, with the comment in it. A
   * file-level comment or a reply starts an empty one on `head` first: once that's accepted, call
   * it again for the comment's own mutation.
   */
  add(on: string, head: string, comment: NewComment): Mutation | ReviewRefusal {
    if (isBlank(comment.body)) return { refusal: 'blank' };
    if (!this.#known) return { refusal: 'pendingUnknown' };
    const pending = this.#pending;
    if (!pending) {
      if (comment.kind === 'thread' && comment.lines !== undefined) {
        return this.#addReview('startReview', on, head, undefined, undefined, comment);
      }
      return this.#addReview('startReview', head, head, undefined, undefined);
    }
    switch (comment.kind) {
      case 'thread':
        if (comment.lines !== undefined && on !== head) return { refusal: 'notLatest', head };
        return { kind: 'addThread', head, variables: threadVariables(pending.id, comment) };
      case 'reply':
        return {
          kind: 'addReply',
          head,
          variables: {
            pullRequestReviewThreadId: comment.thread,
            body: comment.body,
            pullRequestReviewId: pending.id,
          },
        };
      default:
        return comment satisfies never;
    }
  }

  /**
   * What `C` sends: `comment`, written while the right column shows revision `on`, posted at
   * once, or added to your pending review if you have one, as {@link YourReview.add} adds it.
   */
  post(on: string, head: string, comment: NewComment): Posting | ReviewRefusal {
    if (this.#pending) {
      const added = this.add(on, head, comment);
      return 'refusal' in added ? added : { mutation: added, pending: true };
    }
    if (isBlank(comment.body)) return { refusal: 'blank' };
    if (!this.#known && comment.kind !== 'reply') return { refusal: 'pendingUnknown' };
    return { mutation: this.#postNow(on, head, comment), pending: false };
  }

  #postNow(on: string, head: string, comment: NewComment): Mutation {
    switch (comment.kind) {
      case 'thread':
        if (comment.lines !== undefined) {
          return this.#addReview('postThread', on, head, 'COMMENT', undefined, comment);
        }
        return {
          kind: 'postFileComment',
          head,
          body: { commit_id: on, path: comment.path, body: comment.body, subject_type: 'file' },
        };
      case 'reply':
        return {
          kind: 'postReply',
          head,
          variables: {
            pullRequestReviewThreadId: comment.thread,
            body: comment.body,
            pullRequestReviewId: undefined,
          },
        };
      default:
        return comment satisfies never;
    }
  }

  /**
   * Records that GitHub accepted `mutation`. `reviewId` is the id GitHub gave a review the
   * mutation started (`addPullRequestReview`'s `pullRequestReview.id`); without it, starting a
   * review records nothing.
   *
   * Call it only for an acceptance. GitHub refuses most mutations with an error, but
   * `addPullRequestReviewThread` refuses a line outside the diff by returning `thread: null` with
   * no error: that's a refusal, so don't call it, and keep the comment's draft.
   */
  accepted(mutation: Mutation, reviewId?: string): void {
    const pending = this.#pending;
    switch (mutation.kind) {
      case 'startReview':
        if (reviewId !== undefined) {
          this.#pending = {
            id: reviewId,
            commit: mutation.variables.commitOID,
            comments: draftCount(mutation.variables.threads),
          };
        }
        return;
      case 'addThread':
      case 'addReply':
        if (pending) this.#pending = { ...pending, comments: pending.comments + 1 };
        return;
      case 'postThread':
      case 'postFileComment':
      case 'postReply':
        return;
      case 'submitReview':
      case 'review':
        this.#pending = undefined;
        return;
      default:
        mutation satisfies never;
    }
  }

  /**
   * Records that GitHub deleted one of your pending review's comments. A review whose last comment
   * goes goes with it (checked against GitHub); one with a summary written on GitHub's page may
   * stay, which the next read of it shows.
   */
  pendingCommentDeleted(): void {
    const pending = this.#pending;
    if (!pending) return;
    const comments = Math.max(0, pending.comments - 1);
    this.#pending = comments === 0 ? undefined : { ...pending, comments };
  }

  /**
   * What the submit dialog shows, for `account`, on your own pull request or not, with the right
   * column showing revision `on`.
   */
  submitDialog(account: string, own: boolean, on: string): SubmitDialog {
    const reviewOn = this.#pending ? this.#pending.commit : on;
    return {
      choices: reviewChoices(own),
      pendingComments: this.pendingComments,
      account,
      on: reviewOn,
      onScreen: reviewOn === on,
    };
  }

  /**
   * What submitting sends: your pending review with `event` and the summary `body`, or a review of
   * revision `on`, the right column's, when you have no pending review. `head` is the pull
   * request's latest head (`headRefOid`). A blank summary sends none, so a summary written for the
   * pending review on GitHub's page stays. Approving or requesting changes with a pending review
   * recorded on another revision than `on` is refused: a review records the commit you looked at.
   */
  submit(
    event: ReviewEvent,
    body: string,
    own: boolean,
    on: string,
    head: string,
  ): Mutation | ReviewRefusal {
    if (!reviewChoices(own).includes(event)) return { refusal: 'ownPullRequest' };
    if (!this.#known) return { refusal: 'pendingUnknown' };
    const pending = this.#pending;
    if (pending && event !== 'COMMENT' && pending.commit !== on) {
      return { refusal: 'otherRevision', reviewOn: pending.commit };
    }
    const blank = isBlank(body);
    if (event !== 'APPROVE' && blank && this.pendingComments === 0) {
      return { refusal: 'nothingToSubmit' };
    }
    const summary = blank ? undefined : body;
    if (!pending) return this.#addReview('review', on, head, event, summary);
    return {
      kind: 'submitReview',
      head,
      variables: { pullRequestReviewId: pending.id, event, body: summary },
    };
  }

  /**
   * `addPullRequestReview` on `commit`, as `kind`, with the line comment `thread` if any, planned
   * with the pull request at `head`.
   */
  #addReview(
    kind: 'startReview' | 'postThread' | 'review',
    commit: string,
    head: string,
    event: ReviewEvent | undefined,
    body: string | undefined,
    thread?: NewThread,
  ): Mutation {
    return {
      kind,
      head,
      variables: {
        pullRequestId: this.pullRequestId,
        commitOID: commit,
        event,
        body,
        threads: thread && [draftThread(thread)],
      },
    };
  }
}

function isBlank(text: string): boolean {
  return text.trim() === '';
}

/**
 * `line`, `side`, `startLine` and `startSide` for `lines`, as GitHub's inputs take them, or none
 * for a file-level comment. The start's side is always sent with its line: GitHub's default is
 * `RIGHT`, which would turn a range from the base into one from the head.
 */
function position(lines: Lines | undefined) {
  return {
    line: lines?.end.number,
    side: lines?.end.side,
    startLine: lines?.start?.number,
    startSide: lines?.start?.side,
  };
}

/** A line comment as `addPullRequestReview`'s `threads` take it. */
function draftThread(thread: NewThread): DraftPullRequestReviewThread {
  return { path: thread.path, body: thread.body, ...position(thread.lines) };
}

/** `addPullRequestReviewThread`'s variables for `thread`, added to the pending review `review`. */
function threadVariables(
  review: string,
  thread: NewThread,
): AddPullRequestReviewThreadMutationVariables {
  return {
    pullRequestReviewId: review,
    path: thread.path,
    body: thread.body,
    subjectType: thread.lines === undefined ? 'FILE' : 'LINE',
    ...position(thread.lines),
  };
}
