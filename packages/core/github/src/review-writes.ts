/**
 * What Lo writes to a pull request's review (`docs/design.md`, "Reviews" and "Acting on what you
 * saw"): the comments and reviews `@lo/review`'s pending review plans as a {@link ReviewWrite},
 * resolving and unresolving threads, editing and deleting comments, and commenting on the pull
 * request itself. The poller runs them in the account's queue and reads back what they change.
 *
 * GitHub refuses some of these in ways its API leaves undocumented. These were checked against
 * GitHub, and are what the recorded answers in `testing/fixtures/github` show:
 *
 * - `addPullRequestReviewThread` refuses a line outside the diff, or a file the pull request
 *   doesn't change, by answering `thread: null` with no error, and refuses a review submitted since
 *   the same way. So after a `null`, Lo asks whether the review is still pending: if it is, that's
 *   `notInDiff`, and otherwise `gone`, never an acceptance. `addPullRequestReview` refuses a line
 *   outside the diff with "Line could not be resolved", and REST with "could not be resolved".
 * - `addPullRequestReviewThread` puts the thread on the pull request's head when GitHub gets it,
 *   which may be newer than the one the comment was written on, where the line may hold other
 *   code. Lo takes such a thread back out and refuses it as `headMoved`.
 * - A reply to a review submitted since is answered `comment: null`, explained the same way. A
 *   review, thread or comment deleted since is "not found" (`gone`).
 * - While you have a pending review, GitHub refuses another, even one posted at once: "User can only
 *   have one pending review per pull request" (`pendingReviewExists`).
 * - A pull request's author can only comment: "Review Can not approve your own pull request"
 *   (`ownPullRequest`).
 * - A COMMENT review with neither a body nor a comment is refused with an empty message
 *   (`nothingToSubmit`).
 * - A reply sent to be posted at once, while you have a pending review, quietly joins it
 *   ({@link Sent.joinedPending}).
 * - A blank edit is refused: "Body can't be blank".
 * - A review without a summary goes once its last comment is deleted, from the timeline too.
 *
 * GitHub's refusals come back as values ({@link ReviewWriteRefusal}), whose sentences
 * ({@link describeReviewRefusal}) the UI can show as they are. Anything else that goes wrong throws
 * a {@link GithubError}.
 *
 * Lo never sends a write again by itself. A write that failed may still have been done, when its
 * answer was lost or GitHub's server failed ({@link GithubError.mayHavePosted}): before offering to
 * send it again, the UI checks whether it was, against what the write's read-back brings.
 */

import type { GithubClient } from './client.ts';
import { GithubError, type GithubErrorDetail } from './errors.ts';
import {
  AddCommentDocument,
  AddPullRequestReviewDocument,
  AddPullRequestReviewThreadDocument,
  AddPullRequestReviewThreadReplyDocument,
  DeleteIssueCommentDocument,
  DeletePullRequestReviewCommentDocument,
  DeletePullRequestReviewDocument,
  ResolveReviewThreadDocument,
  ReviewCommentDocument,
  ReviewStateDocument,
  SubmitPullRequestReviewDocument,
  UnresolveReviewThreadDocument,
  UpdateIssueCommentDocument,
  UpdatePullRequestReviewCommentDocument,
  type AddPullRequestReviewMutationVariables,
  type AddPullRequestReviewThreadMutationVariables,
  type AddPullRequestReviewThreadReplyMutationVariables,
  type ReviewCommentQuery,
  type SubmitPullRequestReviewMutationVariables,
  type TypedDocumentString,
} from './generated/graphql.ts';
import { isRecord } from './graphql.ts';
import { Fields } from './json.ts';
import type { PullRef } from './refs.ts';

/** REST's `POST /repos/{owner}/{repo}/pulls/{number}/comments` body for a file-level comment. */
export interface FileCommentBody {
  commit_id: string;
  path: string;
  body: string;
  subject_type: 'file';
}

/**
 * A step of `@lo/review`'s pending review, as Lo sends it: a GraphQL mutation's variables, or a
 * REST request's body, with the head it was planned against.
 */
export type ReviewWrite =
  /**
   * `addPullRequestReview` with no `event`, which starts your pending review, recorded on
   * `commitOID`. A line comment goes in its `threads`, on that commit's lines: the only way to put a
   * pending thread on a revision older than the latest head. Without one, it starts an empty review,
   * for a file-level comment or a reply, which can't go in `threads`.
   */
  (
    | { kind: 'startReview'; variables: AddPullRequestReviewMutationVariables }
    /**
     * `addPullRequestReviewThread` to your pending review, with `subjectType: FILE` for a
     * file-level comment. GitHub puts the thread on the pull request's current head. It refuses a
     * line outside the diff by returning `thread: null` without an error, which isn't an acceptance.
     */
    | { kind: 'addThread'; variables: AddPullRequestReviewThreadMutationVariables }
    /** `addPullRequestReviewThreadReply` to a thread, in your pending review. */
    | { kind: 'addReply'; variables: AddPullRequestReviewThreadReplyMutationVariables }
    /** `addPullRequestReview` with `event: COMMENT` and the line comment in `threads`: one comment, posted at once. */
    | { kind: 'postThread'; variables: AddPullRequestReviewMutationVariables }
    /** REST's file-level comment, posted at once: `addPullRequestReview`'s threads can't be file-level. */
    | { kind: 'postFileComment'; body: FileCommentBody }
    /** `addPullRequestReviewThreadReply` with no `pullRequestReviewId`: a reply, posted at once. */
    | { kind: 'postReply'; variables: AddPullRequestReviewThreadReplyMutationVariables }
    /**
     * `submitPullRequestReview` with the summary as `body`. No `body` keeps a summary written for the
     * pending review on GitHub's page; an empty one would wipe it.
     */
    | { kind: 'submitReview'; variables: SubmitPullRequestReviewMutationVariables }
    /** `addPullRequestReview` with `event` and the summary as `body`, or none: a review with no comments, submitted at once. */
    | { kind: 'review'; variables: AddPullRequestReviewMutationVariables }
  ) & {
    /**
     * The pull request's latest head (`headRefOid`) when it was planned. For an `addThread` on lines,
     * GitHub picks the commit: it puts the thread on whatever head is current when it gets it, which
     * can be a later one if someone pushed since Lo last looked, and that head's line may hold
     * different code. The writer compares the thread's `commit.oid` in GitHub's answer with this.
     * Every other write names its commit, as a review started on an older revision does, or has no
     * lines.
     */
    readonly head: string;
  };

/** Why GitHub refused a comment, a review, or an edit of one. Nothing was posted. */
export type ReviewWriteRefusal =
  /**
   * The lines aren't in the pull request's diff, or the file isn't one it changes, and the review
   * the thread was sent to is still pending. GitHub's web pages take a comment outside the diff,
   * but its API doesn't, so the UI offers a comment on the file instead.
   */
  | { refusal: 'notInDiff' }
  /**
   * Someone pushed after the comment was written, and GitHub put its thread on the new head, `head`,
   * where its lines may hold other code. Lo took the thread back out. Nothing when GitHub didn't
   * say which commit it used.
   */
  | { refusal: 'headMoved'; head: string | undefined }
  /**
   * You have a pending review already, perhaps started elsewhere, and GitHub allows one per person
   * per pull request. It also refuses a comment or review posted at once while you have one.
   */
  | { refusal: 'pendingReviewExists' }
  /** You opened the pull request, and GitHub lets its author only comment. */
  | { refusal: 'ownPullRequest' }
  /** A comment, or a request for changes, with neither a summary nor a comment. */
  | { refusal: 'nothingToSubmit' }
  /**
   * The review, thread or comment it names is gone, or the review is no longer pending: your
   * pending review was submitted or deleted elsewhere since Lo read it, or the thread or comment
   * was deleted.
   */
  | { refusal: 'gone' }
  /**
   * GitHub's limit on how fast content is created: "was submitted too quickly", in GitHub's words.
   * Nothing was posted, so it can be sent again after a wait.
   */
  | { refusal: 'tooFast'; message: string }
  /** GitHub answered nothing, or refused with an empty message where that means nothing else. */
  | { refusal: 'unexplained' }
  /** Any other refusal, in GitHub's words, such as a blank comment's. */
  | { refusal: 'other'; message: string };

/** The refusal as a sentence for the person who wrote it, as in "Couldn't post the comment: …". */
export function describeReviewRefusal(refusal: ReviewWriteRefusal): string {
  switch (refusal.refusal) {
    case 'notInDiff':
      return "GitHub takes comments only on lines and files in the pull request's diff";
    case 'headMoved':
      return 'Someone pushed to the pull request since Lo showed it, so Lo took the comment back';
    case 'pendingReviewExists':
      return 'You have a pending review on this pull request already, and GitHub allows only one';
    case 'ownPullRequest':
      return "GitHub doesn't let a pull request's author approve it or request changes";
    case 'nothingToSubmit':
      return 'A review needs a summary or a comment';
    case 'gone':
      return 'It was submitted or deleted elsewhere since Lo last looked';
    case 'tooFast':
      return `GitHub turned it away as sent too soon after others (${refusal.message}); wait a minute and send it`;
    case 'unexplained':
      return 'GitHub refused it without saying why';
    case 'other':
      return `GitHub refused it: ${refusal.message}`;
    default:
      return refusal satisfies never;
  }
}

/** Sorts one of GitHub's messages. `empty` is what an empty one means for the write that got it. */
function fromMessage(message: string, empty: ReviewWriteRefusal): ReviewWriteRefusal {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  if (trimmed === '') return empty;
  if (lower.includes('could not be resolved')) return { refusal: 'notInDiff' };
  if (lower.includes('one pending review')) return { refusal: 'pendingReviewExists' };
  if (lower.includes('your own pull request')) return { refusal: 'ownPullRequest' };
  if (lower.includes('submitted too quickly')) return { refusal: 'tooFast', message: trimmed };
  return { refusal: 'other', message: trimmed };
}

/** The most telling of several messages: the first Lo can say more about than GitHub's words, or else all of them. */
function fromMessages(messages: readonly string[], empty: ReviewWriteRefusal): ReviewWriteRefusal {
  const known = messages
    .map((message) => fromMessage(message, empty))
    .find((refusal) => refusal.refusal !== 'other');
  if (known) return known;
  const words = messages.map((message) => message.trim()).filter((message) => message !== '');
  return words.length === 0 ? empty : { refusal: 'other', message: words.join('; ') };
}

/**
 * GitHub's refusal in `detail`, as a value: GraphQL errors of type `UNPROCESSABLE`, and REST's
 * `422`, whose `errors` hold strings or objects with a `message`. `empty` is what an empty message
 * means. Nothing for any other error.
 */
export function reviewRefusal(
  detail: GithubErrorDetail,
  empty: ReviewWriteRefusal,
): ReviewWriteRefusal | undefined {
  if (detail.kind === 'graphql') {
    const messages = detail.errors
      .filter((error) => error.type === 'UNPROCESSABLE')
      .map((error) => error.message);
    return messages.length === 0 ? undefined : fromMessages(messages, empty);
  }
  if (detail.kind === 'api' && detail.status === 422) {
    const messages = detail.errors.map(validationMessage);
    return messages.length === 0
      ? fromMessage(detail.message, empty)
      : fromMessages(messages, empty);
  }
  return undefined;
}

/**
 * One of a REST error's `errors`: a string, or an object with a `message`, or with a `field` and a
 * `code` such as `missing_field`.
 */
export function validationMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (!isRecord(error)) return '';
  const text = (key: string) => (typeof error[key] === 'string' ? error[key] : undefined);
  const message = text('message');
  if (message !== undefined) return message;
  const [field, code] = [text('field'), text('code')];
  return field !== undefined && code !== undefined ? `${field}: ${code}` : '';
}

/** What GitHub made of an accepted write, by node ID: what the UI needs to follow it up. */
export interface Sent {
  /**
   * The review the write started, added to, posted or submitted. A comment posted at once is a
   * review of its own. REST's file comment doesn't name its review's node ID, so it has none.
   */
  review?: string | undefined;
  /**
   * The thread it added to your pending review, or replied to. `addPullRequestReview` doesn't name
   * the thread its comment starts, so a `startReview` with a thread and a `postThread` leave it out,
   * as REST's file comment does; the threads' read finds it.
   */
  thread?: string | undefined;
  /** The comment it posted, or added to your pending review. */
  comment?: string | undefined;
  /**
   * For a reply sent to be posted at once (`postReply`), the pending review it went into instead.
   * GitHub does that quietly when you have a pending review, such as one started elsewhere that Lo
   * hasn't read yet. The UI says the reply was added to your pending review.
   */
  joinedPending?: string | undefined;
  /**
   * For a thread GitHub put on another head than the one planned, which Lo couldn't take back out:
   * the head it's on. It's in your pending review there, where its lines may hold other code, so
   * the UI flags it.
   */
  landedOn?: string | undefined;
}

/** A comment Lo can edit or delete, by node ID. */
export type CommentId =
  /** A comment in a review thread (`PullRequestReviewComment`, `PRRC_…`), pending or posted. */
  | { kind: 'thread'; id: string }
  /** A comment on the pull request itself, in its conversation (`IssueComment`, `IC_…`). */
  | { kind: 'conversation'; id: string };

/**
 * Runs a write's GraphQL mutation: its data, or GitHub's refusal, with "not found" as `gone`, since
 * a node the write names is gone.
 */
async function mutate<TResult, TVariables>(
  client: GithubClient,
  document: TypedDocumentString<TResult, TVariables>,
  variables: TVariables,
  empty: ReviewWriteRefusal,
): Promise<{ data: TResult } | ReviewWriteRefusal> {
  try {
    return { data: await client.graphql(document, variables) };
  } catch (error) {
    if (!(error instanceof GithubError)) throw error;
    if (error.detail.kind === 'notFound') return { refusal: 'gone' };
    const refusal = reviewRefusal(error.detail, empty);
    if (refusal) return refusal;
    throw error;
  }
}

const UNEXPLAINED: ReviewWriteRefusal = { refusal: 'unexplained' };

/**
 * Sends `write`, which `@lo/review`'s pending review planned for `pull`. {@link Sent} names what it
 * made; a refusal, including a thread GitHub answered with `null`, comes back as a value. Never sent
 * again by itself: a failure may still have posted ({@link GithubError.mayHavePosted}).
 */
export async function sendReviewWrite(
  client: GithubClient,
  pull: PullRef,
  write: ReviewWrite,
): Promise<Sent | ReviewWriteRefusal> {
  switch (write.kind) {
    case 'startReview':
    case 'postThread':
    case 'review':
      return addReview(client, write.variables);
    case 'addThread':
      return addThread(client, write.variables, write.head);
    case 'addReply':
    case 'postReply':
      return reply(client, write.variables);
    case 'postFileComment':
      return postFileComment(client, pull, write.body);
    case 'submitReview':
      return submitReview(client, write.variables);
    default:
      return write satisfies never;
  }
}

/**
 * `addPullRequestReview`: starts a pending review without `event`, or posts one at once with it,
 * holding its thread if any. A thread sent that comes back without its comment is a refusal,
 * though GitHub may have started the review.
 */
async function addReview(
  client: GithubClient,
  variables: AddPullRequestReviewMutationVariables,
): Promise<Sent | ReviewWriteRefusal> {
  const empty: ReviewWriteRefusal =
    variables.event == null ? UNEXPLAINED : { refusal: 'nothingToSubmit' };
  const answer = await mutate(client, AddPullRequestReviewDocument, variables, empty);
  if ('refusal' in answer) return answer;
  const review = answer.data.addPullRequestReview?.pullRequestReview;
  if (!review) return UNEXPLAINED;
  const comment = (review.comments.nodes ?? []).find((node) => node != null)?.id;
  const threads = variables.threads;
  const thread = Array.isArray(threads) ? threads.length > 0 : threads != null;
  if (thread && comment === undefined) return { refusal: 'notInDiff' };
  return { review: review.id, comment };
}

/**
 * `addPullRequestReviewThread` to your pending review, on lines or on the file. A line thread GitHub
 * put on another head than `head`, the one planned, is taken back out and refused as `headMoved`.
 */
async function addThread(
  client: GithubClient,
  variables: AddPullRequestReviewThreadMutationVariables,
  head: string,
): Promise<Sent | ReviewWriteRefusal> {
  const review = variables.pullRequestReviewId;
  const answer = await mutate(client, AddPullRequestReviewThreadDocument, variables, UNEXPLAINED);
  if ('refusal' in answer) return answer;
  // GitHub's refusal of a line outside the diff: no thread, and no error. It refuses a review
  // that's no longer pending the same way.
  const thread = answer.data.addPullRequestReviewThread?.thread;
  if (!thread) return refusedIn(client, review, { refusal: 'notInDiff' });
  const comment = (thread.comments.nodes ?? []).find((node) => node != null);
  const sent: Sent = {
    review: comment?.pullRequestReview?.id ?? undefined,
    thread: thread.id,
    comment: comment?.id,
  };
  // A file-level thread names no line, and goes on the latest head from any revision.
  if (variables.subjectType === 'FILE') return sent;
  const landed = comment?.commit?.oid;
  if (landed !== undefined && landed.toLowerCase() === head.toLowerCase()) return sent;
  if (comment === undefined) return { ...sent, landedOn: landed };
  try {
    await client.graphql(DeletePullRequestReviewCommentDocument, { id: comment.id });
  } catch {
    // It stays in your pending review, on the other head, where the UI shows it as it is.
    return { ...sent, landedOn: landed };
  }
  return { refusal: 'headMoved', head: landed };
}

/** `addPullRequestReviewThreadReply` to a thread: in the pending review its variables name, or without one, posted at once. */
async function reply(
  client: GithubClient,
  variables: AddPullRequestReviewThreadReplyMutationVariables,
): Promise<Sent | ReviewWriteRefusal> {
  const review = variables.pullRequestReviewId ?? undefined;
  const answer = await mutate(
    client,
    AddPullRequestReviewThreadReplyDocument,
    variables,
    UNEXPLAINED,
  );
  if ('refusal' in answer) return answer;
  const comment = answer.data.addPullRequestReviewThreadReply?.comment;
  // As a thread's: a review that's no longer pending.
  if (!comment) return review === undefined ? UNEXPLAINED : refusedIn(client, review, UNEXPLAINED);
  const joined = comment.pullRequestReview?.id;
  return {
    joinedPending: review === undefined && comment.state === 'PENDING' ? joined : undefined,
    review: joined,
    thread: variables.pullRequestReviewThreadId,
    comment: comment.id,
  };
}

/**
 * The refusal of a thread or a reply GitHub answered with `null`, sent to the review `review`:
 * `gone` when the review is no longer pending, and otherwise `pending`, what the `null` means while
 * it is. When its state can't be read, `pending`.
 */
async function refusedIn(
  client: GithubClient,
  review: string,
  pending: ReviewWriteRefusal,
): Promise<ReviewWriteRefusal> {
  try {
    const { node } = await client.graphql(ReviewStateDocument, { id: review });
    if (!node) return { refusal: 'gone' };
    const { __typename: typename } = node;
    return typename === 'PullRequestReview' && 'state' in node && node.state === 'PENDING'
      ? pending
      : { refusal: 'gone' };
  } catch (error) {
    if (error instanceof GithubError && error.detail.kind === 'notFound')
      return { refusal: 'gone' };
    return pending;
  }
}

/** REST's file-level comment, posted at once. */
async function postFileComment(
  client: GithubClient,
  pull: PullRef,
  body: FileCommentBody,
): Promise<Sent | ReviewWriteRefusal> {
  // GitHub's documented order, which the recorded requests were written in.
  const json = JSON.stringify({
    commit_id: body.commit_id,
    path: body.path,
    body: body.body,
    subject_type: body.subject_type,
  });
  try {
    const nodeId = await client.write('POST', `${pull.restPath()}/comments`, json, (posted) =>
      new Fields(posted, 'comment').text('node_id'),
    );
    return { comment: nodeId };
  } catch (error) {
    if (!(error instanceof GithubError)) throw error;
    const refusal = reviewRefusal(error.detail, UNEXPLAINED);
    if (refusal) return refusal;
    throw error;
  }
}

/** `submitPullRequestReview`: submits the pending review its variables name. */
async function submitReview(
  client: GithubClient,
  variables: SubmitPullRequestReviewMutationVariables,
): Promise<Sent | ReviewWriteRefusal> {
  const answer = await mutate(client, SubmitPullRequestReviewDocument, variables, {
    refusal: 'nothingToSubmit',
  });
  if ('refusal' in answer) return answer;
  const review = answer.data.submitPullRequestReview?.pullRequestReview;
  return review ? { review: review.id } : UNEXPLAINED;
}

/**
 * Resolves the review thread `thread`, or with `resolved: false` unresolves it. Never sent again by
 * itself ({@link GithubError.mayHavePosted}).
 */
export async function resolveThread(
  client: GithubClient,
  thread: string,
  resolved: boolean,
): Promise<undefined | ReviewWriteRefusal> {
  let now: boolean | undefined;
  if (resolved) {
    const answer = await mutate(
      client,
      ResolveReviewThreadDocument,
      { threadId: thread },
      UNEXPLAINED,
    );
    if ('refusal' in answer) return answer;
    now = answer.data.resolveReviewThread?.thread?.isResolved;
  } else {
    const answer = await mutate(
      client,
      UnresolveReviewThreadDocument,
      { threadId: thread },
      UNEXPLAINED,
    );
    if ('refusal' in answer) return answer;
    now = answer.data.unresolveReviewThread?.thread?.isResolved;
  }
  return now === resolved ? undefined : UNEXPLAINED;
}

/** Replaces `comment`'s text with `body`. Never sent again by itself ({@link GithubError.mayHavePosted}). */
export async function editComment(
  client: GithubClient,
  comment: CommentId,
  body: string,
): Promise<undefined | ReviewWriteRefusal> {
  if (comment.kind === 'thread') {
    const answer = await mutate(
      client,
      UpdatePullRequestReviewCommentDocument,
      { id: comment.id, body },
      UNEXPLAINED,
    );
    if ('refusal' in answer) return answer;
    return answer.data.updatePullRequestReviewComment?.pullRequestReviewComment
      ? undefined
      : UNEXPLAINED;
  }
  const answer = await mutate(
    client,
    UpdateIssueCommentDocument,
    { id: comment.id, body },
    UNEXPLAINED,
  );
  if ('refusal' in answer) return answer;
  return answer.data.updateIssueComment?.issueComment ? undefined : UNEXPLAINED;
}

/**
 * Deletes `comment`. A thread whose last comment is deleted is gone, and so is a review without a
 * summary. Never sent again by itself ({@link GithubError.mayHavePosted}).
 */
export async function deleteComment(
  client: GithubClient,
  comment: CommentId,
): Promise<undefined | ReviewWriteRefusal> {
  if (comment.kind === 'thread') {
    const answer = await mutate(
      client,
      DeletePullRequestReviewCommentDocument,
      { id: comment.id },
      UNEXPLAINED,
    );
    if ('refusal' in answer) return answer;
    return answer.data.deletePullRequestReviewComment ? undefined : UNEXPLAINED;
  }
  const answer = await mutate(client, DeleteIssueCommentDocument, { id: comment.id }, UNEXPLAINED);
  if ('refusal' in answer) return answer;
  return answer.data.deleteIssueComment ? undefined : UNEXPLAINED;
}

/**
 * Deletes your pending review `review` with its comments, as "Cancel review" on GitHub does. GitHub
 * deletes only a pending review. Never sent again by itself ({@link GithubError.mayHavePosted}).
 */
export async function deletePendingReview(
  client: GithubClient,
  review: string,
): Promise<undefined | ReviewWriteRefusal> {
  const answer = await mutate(
    client,
    DeletePullRequestReviewDocument,
    { pullRequestReviewId: review },
    UNEXPLAINED,
  );
  if ('refusal' in answer) return answer;
  return answer.data.deletePullRequestReview?.pullRequestReview ? undefined : UNEXPLAINED;
}

/**
 * Comments `body` on the pull request whose node ID is `pullRequestId`, in its conversation. Returns
 * the comment's node ID. Never sent again by itself ({@link GithubError.mayHavePosted}).
 */
export async function addConversationComment(
  client: GithubClient,
  pullRequestId: string,
  body: string,
): Promise<string | ReviewWriteRefusal> {
  const answer = await mutate(
    client,
    AddCommentDocument,
    { subjectId: pullRequestId, body },
    UNEXPLAINED,
  );
  if ('refusal' in answer) return answer;
  return answer.data.addComment?.commentEdge?.node?.id ?? UNEXPLAINED;
}

/** A review comment and its thread as GitHub has them now, read before an edit. */
export type ReviewCommentRead = ReviewCommentQuery;

/**
 * The comment `comment` in the thread `thread`, as GitHub has it now: its text, whether you may
 * edit or delete it, its review's state and count of comments, and whether its thread is
 * resolved. A read, to check before an edit what it would change.
 */
export async function reviewComment(
  client: GithubClient,
  comment: string,
  thread: string,
): Promise<ReviewCommentRead> {
  return client.graphql(ReviewCommentDocument, { comment, thread });
}
