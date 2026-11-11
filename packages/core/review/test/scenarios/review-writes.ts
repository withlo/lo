/**
 * The writes recorded on E11, `rozed-dev/e2e#23`, as `rozed-bot`, its author, which can only
 * comment on it. The recorder runs each scenario against GitHub (`scenarios`, with
 * `LO_RECORD_WRITES=1`), and `review-writes.test.ts` replays the recording through the same
 * scenario function, so both send the same requests in the same order. Comments are planned by
 * `@lo/review`'s pending review, as the UI plans them.
 */

import {
  addConversationComment,
  type CommentId,
  deleteComment,
  deletePendingReview,
  describeReviewRefusal,
  editComment,
  Fields,
  GithubClient,
  GithubError,
  pendingReview,
  type PendingReviewRead,
  PullRef,
  pullRequestCheck,
  type PullRequestCheck,
  resolveThread,
  reviewComment,
  type ReviewCommentRead,
  type ReviewThread,
  type ReviewThreadList,
  reviewThreads,
  type ReviewWriteRefusal,
  sendReviewWrite,
  type Sent,
  Token,
} from '@lo/github';
import type { Scenario } from '@lo/testing';

import {
  Line,
  Lines,
  YourReview,
  yourReview,
  type Mutation,
  type NewComment,
  type Posting,
  type ReviewRefusal,
} from '../../src/index.ts';

export const BOT = 'rozed-bot';
export const REPO = 'rozed-dev/e2e';
export const NUMBER = 23;
export const REVIEWED = 'e11/review.txt';
export const NOTES = 'e11/notes.md';

/** Every comment's text starts with this, so the recorder's clean-up finds them. */
export const MARK = 'Fixture E11:';

/** Waits for GitHub to show a write: a pause when recording, nothing when replaying. */
export type Pause = (milliseconds: number) => Promise<void>;

const SETTLE = 2000;

export const PULL = new PullRef('rozed-dev', 'e2e', NUMBER);

/** What a write answered: what it made, or why GitHub refused it. */
export type Answer = Sent | ReviewWriteRefusal;

/** What an edit or a delete answered: nothing, or why GitHub refused it. */
export type Done = undefined | ReviewWriteRefusal;

function text(what: string): string {
  return `${MARK} ${what}`;
}

function thread(path: string, lines: Lines | undefined, what: string): NewComment {
  return { kind: 'thread', path, lines, body: text(what) };
}

function replyTo(threadId: string, what: string): NewComment {
  return { kind: 'reply', thread: threadId, body: text(what) };
}

/** The pull request's node ID and head, from REST. */
export async function pullRequest(client: GithubClient): Promise<{ id: string; head: string }> {
  return client.get(`/repos/${REPO}/pulls/${NUMBER}`, (json) => {
    const pull = new Fields(json, 'pull request');
    return { id: pull.text('node_id'), head: pull.fields('head').text('sha') };
  });
}

function check(client: GithubClient): Promise<PullRequestCheck> {
  return pullRequestCheck(client, 'rozed-dev', 'e2e', NUMBER);
}

/** `value`, or a failure saying why not, for a scenario that goes on only when it did. */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(what);
  return value;
}

/** What `review` planned, which must be a plan and not a refusal to make one. */
function planned(plan: Mutation | ReviewRefusal): Mutation {
  if ('refusal' in plan) throw new Error(`not planned: ${JSON.stringify(plan)}`);
  return plan;
}

/** What `C` sent at once, which must not have gone into a pending review. */
function now(posting: Posting | ReviewRefusal): Mutation {
  if ('refusal' in posting || posting.pending) {
    throw new Error(`not posted at once: ${JSON.stringify(posting)}`);
  }
  return posting.mutation;
}

/** What `answer` made, which must not be a refusal. */
function made(answer: Answer): Sent {
  if ('refusal' in answer) throw new Error(`refused: ${describeReviewRefusal(answer)}`);
  return answer;
}

/** The node ID `answer` made, which must not be a refusal. */
function idOf(answer: string | ReviewWriteRefusal): string {
  if (typeof answer !== 'string') throw new Error(`refused: ${describeReviewRefusal(answer)}`);
  return answer;
}

/** Nothing, as an edit or a delete answers when GitHub took it. */
function accepted(answer: Done): void {
  if (answer !== undefined) throw new Error(`refused: ${describeReviewRefusal(answer)}`);
}

/** Sends what `review` planned and records its acceptance there, as the UI does. */
async function send(client: GithubClient, review: YourReview, write: Mutation): Promise<Answer> {
  const sent = await sendReviewWrite(client, PULL, write);
  if (!('refusal' in sent)) review.accepted(write, sent.review);
  return sent;
}

/** The review a pending review read found: none, or else a failure, since a scenario starts with none. */
function noPendingReview(read: PendingReviewRead): void {
  if (read.kind !== 'read' || read.review !== undefined) {
    throw new Error('rozed-bot has a pending review on #23');
  }
}

/** The thread whose first comment says `what`. */
export function threadSaying(list: ReviewThreadList, what: string): ReviewThread {
  const body = text(what);
  const found = list.nodes.find(
    (node) => (node.comments.nodes ?? []).find((comment) => comment !== null)?.body === body,
  );
  return must(found, `no thread says ${JSON.stringify(body)}`);
}

/** The comment that says `what`, in any thread. */
export function commentSaying(list: ReviewThreadList, what: string): string {
  const body = text(what);
  const found = list.nodes
    .flatMap((node) => node.comments.nodes ?? [])
    .find((comment) => comment?.body === body);
  return must(found, `no comment says ${JSON.stringify(body)}`).id;
}

export const LINE = 'a line thread, the first comment of a pending review.';
export const RANGE = "a range from the base's line 10 to the head's line 11.";
export const FILE = 'a file-level thread.';
export const OUTSIDE = "line 25, outside the diff's hunks.";
export const UNCHANGED = "a file-level thread on a file the pull request doesn't change.";
export const PENDING_REPLY = 'a reply in the pending review.';
export const SUMMARY = "the pending review's summary, submitted as a comment.";
export const JOINED_REPLY = 'a reply sent to be posted at once, which joined the pending review.';

/** What the pending review scenario saw. */
export interface Pending {
  id: string;
  head: string;
  before: PendingReviewRead;
  started: Sent;
  afterStart: PendingReviewRead;
  range: Sent;
  file: Sent;
  outside: Answer;
  unchanged: Answer;
  threads: ReviewThreadList;
  reply: Sent;
  beforeSubmit: PendingReviewRead;
  check: PullRequestCheck;
  postWhilePending: Answer;
  fileCommentWhilePending: Answer;
  replyWhilePending: Sent;
  submitted: Sent;
  after: PendingReviewRead;
  review: YourReview;
}

/**
 * Starts a pending review with a line thread, adds a range, a file-level thread and a reply, tries
 * a line outside the diff and a file the pull request doesn't change, and a thread, a file comment
 * and a reply posted at once while the review is pending, then submits it as a comment.
 */
export async function pending(client: GithubClient, pause: Pause): Promise<Pending> {
  const { id, head } = await pullRequest(client);
  const before = await pendingReview(client, PULL, BOT);
  noPendingReview(before);
  const review = yourReview(id, before);

  const line = thread(REVIEWED, Lines.one(Line.right(10)), LINE);
  const start = planned(review.add(head, head, line));
  if (start.kind !== 'startReview' || start.variables.threads == null) {
    throw new Error(`not a review started with a thread: ${JSON.stringify(start)}`);
  }
  const started = made(await send(client, review, start));
  await pause(SETTLE);
  const afterStart = await pendingReview(client, PULL, BOT);

  const range = Lines.range(Line.left(10), Line.right(11));
  const addRange = planned(review.add(head, head, thread(REVIEWED, range, RANGE)));
  const sentRange = made(await send(client, review, addRange));
  const addFile = planned(review.add(head, head, thread(NOTES, undefined, FILE)));
  const file = made(await send(client, review, addFile));
  const outsideDiff = thread(REVIEWED, Lines.one(Line.right(25)), OUTSIDE);
  const addOutside = planned(review.add(head, head, outsideDiff));
  const outside = await send(client, review, addOutside);
  const addUnchanged = planned(review.add(head, head, thread('README.md', undefined, UNCHANGED)));
  const unchanged = await send(client, review, addUnchanged);
  await pause(SETTLE);

  const listed = await reviewThreads(client, PULL);
  const lineThread = threadSaying(listed, LINE).id;
  const addReply = planned(review.add(head, head, replyTo(lineThread, PENDING_REPLY)));
  const reply = made(await send(client, review, addReply));
  await pause(SETTLE);
  const beforeSubmit = await pendingReview(client, PULL, BOT);
  const checked = await check(client);

  // Posted at once, as `C` would without a pending review: GitHub refuses both while one is.
  const nothingPending = new YourReview(id);
  const line50 = thread(REVIEWED, Lines.one(Line.right(50)), 'never posted.');
  const postWhilePending = await send(
    client,
    nothingPending,
    now(nothingPending.post(head, head, line50)),
  );
  const notes = thread(NOTES, undefined, 'never posted either.');
  const fileCommentWhilePending = await send(
    client,
    nothingPending,
    now(nothingPending.post(head, head, notes)),
  );
  // A reply isn't refused: it quietly joins the pending review.
  const joining = replyTo(lineThread, JOINED_REPLY);
  const replyWhilePending = made(
    await send(client, nothingPending, now(nothingPending.post(head, head, joining))),
  );

  const submit = planned(review.submit('COMMENT', text(SUMMARY), true, head, head));
  const submitted = made(await send(client, review, submit));
  await pause(SETTLE);
  const after = await pendingReview(client, PULL, BOT);
  return {
    id,
    head,
    before,
    started,
    afterStart,
    range: sentRange,
    file,
    outside,
    unchanged,
    threads: listed,
    reply,
    beforeSubmit,
    check: checked,
    postWhilePending,
    fileCommentWhilePending,
    replyWhilePending,
    submitted,
    after,
    review,
  };
}

export const POSTED_REPLY = 'a reply posted at once.';
export const POSTED_LINE = 'a line thread posted at once, on line 50.';
export const POSTED_FILE = 'a file-level comment posted at once, through REST.';
export const REVIEW_SUMMARY = 'a review with only a summary.';
export const JOINING_REPLY = 'a reply that started an empty pending review.';

/** What the posted-at-once scenario saw. */
export interface Posted {
  reply: Sent;
  line: Sent;
  file: Sent;
  summary: Sent;
  approve: Answer;
  requestChanges: Answer;
  empty: Answer;
  startedEmpty: Sent;
  joined: Sent;
  submittedEmpty: Sent;
  after: PendingReviewRead;
}

/**
 * Posts a reply, a line thread, a file-level comment and a review with only a summary at once;
 * tries approving, requesting changes and an empty comment, which GitHub refuses its author; then a
 * reply as the first comment of a pending review, submitted without a summary.
 */
export async function posted(client: GithubClient, pause: Pause): Promise<Posted> {
  const { id, head } = await pullRequest(client);
  const listed = await reviewThreads(client, PULL);
  const lineThread = threadSaying(listed, LINE).id;
  const rangeThread = threadSaying(listed, RANGE).id;
  const review = new YourReview(id);

  const postReply = now(review.post(head, head, replyTo(lineThread, POSTED_REPLY)));
  const reply = made(await send(client, review, postReply));
  const line50 = thread(REVIEWED, Lines.one(Line.right(50)), POSTED_LINE);
  const postLine = now(review.post(head, head, line50));
  const line = made(await send(client, review, postLine));
  const postFile = now(review.post(head, head, thread(NOTES, undefined, POSTED_FILE)));
  const file = made(await send(client, review, postFile));
  const submitSummary = planned(review.submit('COMMENT', text(REVIEW_SUMMARY), true, head, head));
  const summary = made(await send(client, review, submitSummary));

  // Lo offers its author only Comment; these ask GitHub anyway.
  const approvePlan = planned(review.submit('APPROVE', '', false, head, head));
  const approve = await send(client, review, approvePlan);
  const requestPlan = planned(
    review.submit('REQUEST_CHANGES', text('never sent.'), false, head, head),
  );
  const requestChanges = await send(client, review, requestPlan);
  const emptyReview: Mutation = {
    kind: 'review',
    head,
    variables: {
      pullRequestId: id,
      commitOID: head,
      event: 'COMMENT',
      body: undefined,
      threads: undefined,
    },
  };
  const empty = await send(client, review, emptyReview);

  const first = replyTo(rangeThread, JOINING_REPLY);
  const start = planned(review.add(head, head, first));
  if (start.kind !== 'startReview' || start.variables.threads != null) {
    throw new Error(`not an empty review started: ${JSON.stringify(start)}`);
  }
  const startedEmpty = made(await send(client, review, start));
  const add = planned(review.add(head, head, first));
  if (add.kind !== 'addReply') throw new Error(`not a reply added: ${JSON.stringify(add)}`);
  const joined = made(await send(client, review, add));
  const submit = planned(review.submit('COMMENT', '', true, head, head));
  const submittedEmpty = made(await send(client, review, submit));
  await pause(SETTLE);
  const after = await pendingReview(client, PULL, BOT);
  return {
    reply,
    line,
    file,
    summary,
    approve,
    requestChanges,
    empty,
    startedEmpty,
    joined,
    submittedEmpty,
    after,
  };
}

export const EDITED = 'a reply posted at once, edited.';

/** What the threads scenario saw. */
export interface Threads {
  before: ReviewThreadList;
  thread: string;
  comment: string;
  /** The check read at the start, then after resolving, unresolving, editing and deleting. */
  checks: [
    initial: PullRequestCheck,
    resolved: PullRequestCheck,
    unresolved: PullRequestCheck,
    edited: PullRequestCheck,
    deleted: PullRequestCheck,
  ];
  resolved: Done;
  unresolved: Done;
  edited: Done;
  blank: Done;
  deleted: Done;
  deletedAgain: Done;
  after: ReviewThreadList;
}

/**
 * Resolves and unresolves the line thread, then edits the reply posted at once, tries a blank
 * edit, and deletes the reply, twice, reading the check after each.
 */
export async function threads(client: GithubClient, pause: Pause): Promise<Threads> {
  const before = await reviewThreads(client, PULL);
  const threadId = threadSaying(before, LINE).id;
  const comment = commentSaying(before, POSTED_REPLY);
  const initial = await check(client);

  const resolved = await resolveThread(client, threadId, true);
  await pause(SETTLE);
  const afterResolving = await check(client);
  const unresolved = await resolveThread(client, threadId, false);
  await pause(SETTLE);
  const afterUnresolving = await check(client);

  const id: CommentId = { kind: 'thread', id: comment };
  const edited = await editComment(client, id, text(EDITED));
  await pause(SETTLE);
  const afterEditing = await check(client);
  const blank = await editComment(client, id, '');

  const deleted = await deleteComment(client, id);
  await pause(SETTLE);
  const afterDeleting = await check(client);
  const deletedAgain = await deleteComment(client, id);
  const after = await reviewThreads(client, PULL);
  return {
    before,
    thread: threadId,
    comment,
    checks: [initial, afterResolving, afterUnresolving, afterEditing, afterDeleting],
    resolved,
    unresolved,
    edited,
    blank,
    deleted,
    deletedAgain,
    after,
  };
}

export const FIRST = 'a comment on the pull request itself.';
export const SECOND = "a second comment, so the first isn't the newest item.";
export const FIRST_EDITED = 'a comment on the pull request itself, edited.';

/** What the conversation scenario saw. */
export interface Conversation {
  first: string;
  second: string;
  /** The check read at the start, then after commenting, editing and deleting. */
  checks: [
    initial: PullRequestCheck,
    commented: PullRequestCheck,
    edited: PullRequestCheck,
    deleted: PullRequestCheck,
  ];
  edited: Done;
  deleted: [first: Done, second: Done];
}

/**
 * Comments twice on the pull request itself, edits the first, then deletes both, reading the
 * check before and after each step.
 */
export async function conversation(client: GithubClient, pause: Pause): Promise<Conversation> {
  const { id } = await pullRequest(client);
  const initial = await check(client);
  const first = idOf(await addConversationComment(client, id, text(FIRST)));
  await pause(SETTLE);
  const second = idOf(await addConversationComment(client, id, text(SECOND)));
  await pause(SETTLE);
  const afterCommenting = await check(client);
  const edited = await editComment(client, { kind: 'conversation', id: first }, text(FIRST_EDITED));
  await pause(SETTLE);
  const afterEditing = await check(client);
  const deleted: [Done, Done] = [
    await deleteComment(client, { kind: 'conversation', id: first }),
    await deleteComment(client, { kind: 'conversation', id: second }),
  ];
  await pause(SETTLE);
  const afterDeleting = await check(client);
  return {
    first,
    second,
    checks: [initial, afterCommenting, afterEditing, afterDeleting],
    edited,
    deleted,
  };
}

export const STALE_LINE = 'a thread for a pending review deleted since.';
export const STALE_SUBMITTED = 'the thread of a review submitted since.';
export const STALE_ADDED = 'a thread for a review submitted since.';
export const STALE_REPLY = 'a reply for a review submitted since.';
export const STALE_ORPHAN = 'a reply to a thread deleted since.';

/** What the stale scenario saw. */
export interface Stale {
  deleted: Done;
  threadOnDeleted: Answer;
  submitDeleted: Answer;
  submitted: Sent;
  threadOnSubmitted: Answer;
  replyOnSubmitted: Answer;
  deletedComment: Done;
  replyToDeleted: Answer;
  after: PendingReviewRead;
}

/**
 * Sends what Lo would plan with IDs that are no longer current, as when a review or thread changed
 * elsewhere since Lo read it: a thread added to, and a submission of, a pending review deleted
 * since; a thread and a reply added to a review submitted since; and a reply to a thread whose
 * only comment was deleted since.
 */
export async function stale(client: GithubClient, pause: Pause): Promise<Stale> {
  const { id, head } = await pullRequest(client);
  noPendingReview(await pendingReview(client, PULL, BOT));

  // An empty pending review, deleted as on GitHub's web pages, while Lo still holds it.
  const review = new YourReview(id);
  const startEmpty: Mutation = {
    kind: 'startReview',
    head,
    variables: {
      pullRequestId: id,
      commitOID: head,
      event: undefined,
      body: undefined,
      threads: undefined,
    },
  };
  const startedEmpty = made(await send(client, review, startEmpty));
  const deleted = await deletePendingReview(
    client,
    must(startedEmpty.review, 'the review had no id'),
  );
  await pause(SETTLE);
  const line10 = thread(REVIEWED, Lines.one(Line.right(10)), STALE_LINE);
  const addToDeleted = planned(review.add(head, head, line10));
  const threadOnDeleted = await send(client, review, addToDeleted);
  const submitToDeleted = planned(
    review.submit('COMMENT', text('never submitted.'), true, head, head),
  );
  const submitDeleted = await send(client, review, submitToDeleted);

  // A pending review with a thread, submitted, while Lo still holds it as pending.
  const fresh = new YourReview(id);
  const line30 = thread(REVIEWED, Lines.one(Line.right(30)), STALE_SUBMITTED);
  const start = planned(fresh.add(head, head, line30));
  const started = made(await send(client, fresh, start));
  const submit = planned(fresh.submit('COMMENT', '', true, head, head));
  const submitted = made(await send(client, fresh, submit));
  await pause(SETTLE);
  const held = new YourReview(id, {
    id: must(started.review, 'the review had no id'),
    commit: head,
    comments: 1,
  });
  const line50 = thread(REVIEWED, Lines.one(Line.right(50)), STALE_ADDED);
  const addToSubmitted = planned(held.add(head, head, line50));
  const threadOnSubmitted = await send(client, held, addToSubmitted);
  const listed = await reviewThreads(client, PULL);
  const submittedThread = threadSaying(listed, STALE_SUBMITTED).id;
  const replyPlan = planned(held.add(head, head, replyTo(submittedThread, STALE_REPLY)));
  const replyOnSubmitted = await send(client, held, replyPlan);
  await pause(SETTLE);

  // The thread's only comment deleted, as elsewhere, then a reply to it posted at once.
  const only: CommentId = {
    kind: 'thread',
    id: must(started.comment, 'the thread had no comment'),
  };
  const deletedComment = await deleteComment(client, only);
  await pause(SETTLE);
  const nothingPending = new YourReview(id);
  const reply = replyTo(submittedThread, STALE_ORPHAN);
  const post = now(nothingPending.post(head, head, reply));
  const replyToDeleted = await send(client, nothingPending, post);
  await pause(SETTLE);
  const after = await pendingReview(client, PULL, BOT);
  return {
    deleted,
    threadOnDeleted,
    submitDeleted,
    submitted,
    threadOnSubmitted,
    replyOnSubmitted,
    deletedComment,
    replyToDeleted,
    after,
  };
}

export const EDIT_PENDING = 'a pending comment, to edit and then delete.';
export const EDIT_PENDING_EDITED = 'a pending comment, edited.';
export const EDIT_POSTED = 'a thread posted at once, whose first comment goes under a reply.';
export const EDIT_REPLY = 'a reply posted at once, to edit.';
export const EDIT_REPLY_EDITED = 'a reply posted at once, edited in a resolved thread.';

/** A comment read afresh, as Lo reads it before and after an edit: what GitHub has, or that it's gone. */
export type Found = { kind: 'here'; read: ReviewCommentRead } | { kind: 'gone' };

/** Reads `comment` in `threadId` afresh. GitHub answers "not found" once the comment is gone. */
async function readComment(
  client: GithubClient,
  comment: string,
  threadId: string,
): Promise<Found> {
  try {
    return { kind: 'here', read: await reviewComment(client, comment, threadId) };
  } catch (error) {
    if (error instanceof GithubError && error.detail.kind === 'notFound') return { kind: 'gone' };
    throw error;
  }
}

/** What the edits scenario saw. */
export interface Edits {
  pendingThread: string;
  pending: string;
  pendingRead: Found;
  pendingEdited: Done;
  pendingAfterEdit: Found;
  pendingDeleted: Done;
  pendingGone: Found;
  reviewAfterDelete: PendingReviewRead;
  postedThread: string;
  first: string;
  reply: string;
  replyRead: Found;
  resolved: Done;
  replyEdited: Done;
  replyAfterEdit: Found;
  firstDeleted: Done;
  threadsAfter: ReviewThreadList;
  replyDeleted: Done;
  threadsEnd: ReviewThreadList;
}

/**
 * What Lo's edits and deletes of your own comments meet, reading each comment afresh as Lo does
 * before and after them: a pending review's only comment read, edited, read, deleted and read
 * again, with your pending review read after; then a thread posted at once with a reply, the reply
 * read, the thread resolved, the reply edited in it and read, the thread's first comment deleted
 * under the reply, and the reply deleted, with the threads read after each delete.
 */
export async function edits(client: GithubClient, pause: Pause): Promise<Edits> {
  const { id, head } = await pullRequest(client);
  noPendingReview(await pendingReview(client, PULL, BOT));

  const review = new YourReview(id);
  const line30 = thread(REVIEWED, Lines.one(Line.right(30)), EDIT_PENDING);
  const start = planned(review.add(head, head, line30));
  made(await send(client, review, start));
  await pause(SETTLE);
  const pendingThreads = await reviewThreads(client, PULL);
  const pendingThread = threadSaying(pendingThreads, EDIT_PENDING).id;
  const pendingComment = commentSaying(pendingThreads, EDIT_PENDING);
  const pendingRead = await readComment(client, pendingComment, pendingThread);
  const pendingId: CommentId = { kind: 'thread', id: pendingComment };
  const pendingEdited = await editComment(client, pendingId, text(EDIT_PENDING_EDITED));
  await pause(SETTLE);
  const pendingAfterEdit = await readComment(client, pendingComment, pendingThread);
  const pendingDeleted = await deleteComment(client, pendingId);
  await pause(SETTLE);
  const pendingGone = await readComment(client, pendingComment, pendingThread);
  const reviewAfterDelete = await pendingReview(client, PULL, BOT);
  // What's below posts at once, which a pending review left behind would take.
  if (reviewAfterDelete.kind === 'read' && reviewAfterDelete.review !== undefined) {
    accepted(await deletePendingReview(client, reviewAfterDelete.review.id));
    await pause(SETTLE);
  }

  const none = new YourReview(id);
  const line50 = thread(REVIEWED, Lines.one(Line.right(50)), EDIT_POSTED);
  const postThread = now(none.post(head, head, line50));
  made(await send(client, none, postThread));
  await pause(SETTLE);
  const postedThreads = await reviewThreads(client, PULL);
  const postedThread = threadSaying(postedThreads, EDIT_POSTED).id;
  const first = commentSaying(postedThreads, EDIT_POSTED);
  const postReply = now(none.post(head, head, replyTo(postedThread, EDIT_REPLY)));
  made(await send(client, none, postReply));
  await pause(SETTLE);
  const repliedThreads = await reviewThreads(client, PULL);
  const reply = commentSaying(repliedThreads, EDIT_REPLY);
  const replyRead = await readComment(client, reply, postedThread);
  const resolved = await resolveThread(client, postedThread, true);
  await pause(SETTLE);
  const replyId: CommentId = { kind: 'thread', id: reply };
  const replyEdited = await editComment(client, replyId, text(EDIT_REPLY_EDITED));
  await pause(SETTLE);
  const replyAfterEdit = await readComment(client, reply, postedThread);
  const firstDeleted = await deleteComment(client, { kind: 'thread', id: first });
  await pause(SETTLE);
  const threadsAfter = await reviewThreads(client, PULL);
  const replyDeleted = await deleteComment(client, replyId);
  await pause(SETTLE);
  const threadsEnd = await reviewThreads(client, PULL);
  return {
    pendingThread,
    pending: pendingComment,
    pendingRead,
    pendingEdited,
    pendingAfterEdit,
    pendingDeleted,
    pendingGone,
    reviewAfterDelete,
    postedThread,
    first,
    reply,
    replyRead,
    resolved,
    replyEdited,
    replyAfterEdit,
    firstDeleted,
    threadsAfter,
    replyDeleted,
    threadsEnd,
  };
}

/** The schema GitHub's GraphQL queries were checked against when these were recorded. */
const SCHEMA = 'github/docs@03caf3ce9bc56af9d147500036b0bb6dda352674';

/** Waits when recording, so GitHub shows a write before it's read back. */
const wait: Pause = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

/**
 * A recording of one scenario: `run` sends its requests through the `fetch` it's given, as the bot
 * whose token it's handed.
 */
function recording(
  name: string,
  description: string,
  run: (client: GithubClient, pause: Pause) => Promise<unknown>,
): Scenario {
  return {
    name: `review_writes_e2e_23_${name}`,
    description,
    repo: REPO,
    schema: SCHEMA,
    writes: true,
    async run(fetch, token) {
      await run(new GithubClient({ fetch, token: new Token(token) }), wait);
      return undefined;
    },
  };
}

/** The recordings `node testing/scripts/record.ts` makes from this module. */
export const scenarios: Scenario[] = [
  recording(
    'pending',
    "rozed-bot's pending review on rozed-dev/e2e#23: started with a line thread, then a range from the base to the head and a file-level thread, a line outside the diff and a file the PR doesn't change refused, a reply, a comment posted at once refused while it's pending, then submitted as a comment",
    pending,
  ),
  recording(
    'posted',
    'Comments posted at once on rozed-dev/e2e#23 by rozed-bot, its author: a reply, a line thread, a REST file-level comment and a review with only a summary; approving, requesting changes and an empty comment refused; then a reply that starts an empty pending review, submitted without a summary',
    posted,
  ),
  recording(
    'threads',
    'On rozed-dev/e2e#23, as rozed-bot: a thread resolved and unresolved, a reply edited, edited blank, and deleted twice, with the check read after each',
    threads,
  ),
  recording(
    'conversation',
    'On rozed-dev/e2e#23, as rozed-bot: two comments on the pull request itself, the first edited, then both deleted, with the check read before and after each step',
    conversation,
  ),
  recording(
    'stale',
    "rozed-bot's writes on rozed-dev/e2e#23 with IDs no longer current: a thread added to and a submission of a pending review deleted since, a thread and a reply added to a review submitted since, and a reply to a thread deleted since",
    stale,
  ),
  recording(
    'edits',
    "rozed-bot's own comments on rozed-dev/e2e#23 edited and deleted, each read afresh before and after: a pending review's only comment, and a reply in a thread posted at once, edited once the thread was resolved, with the thread's first comment deleted under it",
    edits,
  ),
];
