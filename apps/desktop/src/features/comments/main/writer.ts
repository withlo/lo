// Writing comments, in main: each view's drafts, as the window hands over what the reader types,
// and sending one, which only the reader does. `@lo/review`'s pending review plans each write from
// your pending review as the account's poller last read it, and the poller sends it. One write to a
// pull request goes at a time: a second waits for the first's answer, and is planned from your
// pending review as read after it, since two comments planned from one read would each start a
// review, and GitHub refuses the second. A draft stays until GitHub takes its comment, and is
// marked with the text sent, and when, while it's sent: when GitHub's answer is lost, the mark
// stays, a restart included, and once a while has passed since it was sent, Lo reads the threads
// afresh and looks among your comments for it, by GitHub's clock: found, the draft goes; otherwise
// the reader is told, and may send it again. Until then it can't be sent again. Text that changed
// since it was sent is never dropped. Nothing is ever sent again by itself.
//
// Replies go as comments do. Editing your comment, resolving or unresolving a thread and deleting
// your comment take their turn among the pull request's writes too. An edit is kept as a draft with
// the text it started from, and goes only while a read of the comment, made as it's sent, finds
// GitHub's text still that one, so it never overwrites an edit made elsewhere since. A delete goes
// only while such a read finds the comment as the question showed it. Each whose answer is lost is
// settled the same way as a comment, from a read made a while after, and never sent again by
// itself. A comment on the pull request itself, in its conversation, takes its turn the same way and
// posts at once, joining no review; one whose answer was lost is looked for in the timeline read
// afresh, only its newest page where Lo keeps it. Nothing here calls Electron.

import {
  type Cached,
  GithubError,
  PENDING_REVIEW,
  type PendingReviewRead,
  type PollEvent,
  type Poller,
  PullRef,
  type PullRequestTimeline,
  type ReadKind,
  type ReadMark,
  REVIEW_THREADS,
  type ReviewThreadList,
  type ReviewWrite,
  type ReviewWriteRefusal,
  type Sent,
  TIMELINE,
  describeReviewRefusal,
  reviewThreads,
} from '@lo/github';
import {
  afterLostEdit,
  beforeEdit,
  type NewComment,
  type ReviewRefusal,
  sameCommentText,
  sendsComment,
  yourReview,
} from '@lo/review';

import { IpcError } from '../../../ipc/contract.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type {
  ActOutcome,
  ActRow,
  ActsView,
  Change,
  DeleteAsked,
  DraftHomeRow,
  DraftPlaceRow,
  DraftRow,
  DraftsView,
  EditPlaceRow,
  SendOutcome,
  SendRefusal,
  Sending,
  ThreadRow,
} from '../contract.ts';
import { actRefusal, asAsked, changeRefused, inThread, readComment } from './acting.ts';
import { holdsPullComment, postOnPull } from './conversation.ts';
import { type DraftStore, type Kept, placeJson } from './drafts.ts';
import { threadRows } from './threads.ts';

/** What the writer uses of an account's poller. */
export type WriterPoller = Pick<
  Poller,
  | 'sendReview'
  | 'addConversationComment'
  | 'timeline'
  | 'resolveThread'
  | 'editComment'
  | 'deleteComment'
  | 'pendingReview'
  | 'pullRequest'
  | 'cachedRead'
  | 'readAfresh'
  | 'readSince'
  | 'readOnce'
  | 'onEvent'
>;

export interface WriterOptions {
  /** The poller of each account, as the accounts feature provides it. */
  readonly poller: (login: string) => Promise<WriterPoller>;
  /** What main has of a view now, or nothing once it's closed. */
  readonly view: (id: string) => PullTabInfo | undefined;
  readonly drafts: DraftStore;
  readonly publish: (view: DraftsView) => void;
  /** Tells a view how the changes asked of its pull request stand. */
  readonly publishActs?: (view: ActsView) => void;
  /**
   * Whether the file at `path` is the same at commits `from` and `to` in view `id`'s local copy,
   * so a draft on its lines at the one can move to the other.
   */
  readonly unchanged?: (id: string, from: string, to: string, path: string) => Promise<boolean>;
  readonly log: (line: string) => void;
  readonly now?: () => number;
  /** How long after sending a comment whose answer was lost Lo waits before it looks for it. */
  readonly settleAfter?: number;
  /** How long Lo waits for your pending review to be read again before it plans a write. */
  readonly readWait?: number;
  /** How long Lo waits to look again when it couldn't read the threads, as while offline. */
  readonly retryAfter?: number;
}

/** How long after sending a comment whose answer was lost Lo waits before it looks for it. */
export const SETTLE_AFTER = 10_000;

/** How long Lo waits for your pending review to be read again before it plans a write. */
export const READ_WAIT = 120_000;

/** How long Lo waits to look again for a comment when it couldn't read the threads. */
export const RETRY_AFTER = 30_000;

/**
 * How much earlier than it was sent, by GitHub's clock, GitHub may say a comment was made: its
 * times, and the `Date` its clock is read from, are to the second, and the answer took a while.
 */
export const CLOCK_SLACK = 5_000;

/** A view's account and pull request, as it writes. */
interface Target {
  readonly login: string;
  readonly pull: PullRef;
}

/**
 * A write's turn on a pull request, which {@link Writer.inTurn} hands it: the account and pull
 * request, the account's poller, and your pending review as read after the last write's answer.
 */
export interface Turn extends Target {
  readonly poller: WriterPoller;
  /** Your pending review, or nothing when it couldn't be read. */
  readonly review: PendingReviewRead | undefined;
  /**
   * Sends `write` with the poller, so the next write in turn plans from your pending review as
   * read after its answer.
   */
  send(write: ReviewWrite): Promise<Sent | ReviewWriteRefusal>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether two logins name one account: GitHub's ignore case. */
function sameLogin(a: string | null | undefined, b: string | undefined): boolean {
  return a != null && b !== undefined && a.toLowerCase() === b.toLowerCase();
}

/** `@lo/review`'s refusal to plan a comment, as the box says it. */
export function planRefusal(refusal: ReviewRefusal): SendRefusal {
  switch (refusal.refusal) {
    case 'notLatest':
      return { kind: 'notLatest', head: refusal.head };
    case 'pendingUnknown':
      return { kind: 'pendingUnknown' };
    case 'blank':
      return { kind: 'github', message: 'A comment needs some text.' };
    case 'otherRevision':
    case 'ownPullRequest':
    case 'nothingToSubmit':
      return { kind: 'github', message: `Lo can't send that: ${refusal.refusal}.` };
    default:
      refusal satisfies never;
      return { kind: 'github', message: "Lo can't send that." };
  }
}

/** GitHub's refusal of a write, or Lo's while GitHub asked it to hold off, as the box says it. */
export function writeRefusal(refusal: ReviewWriteRefusal): SendRefusal {
  switch (refusal.refusal) {
    case 'notInDiff':
      return { kind: 'notInDiff' };
    case 'headMoved':
      return { kind: 'headMoved', head: refusal.head ?? null };
    case 'paused':
      return { kind: 'paused', until: refusal.until };
    case 'pendingReviewExists':
    case 'ownPullRequest':
    case 'nothingToSubmit':
    case 'gone':
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
 * Whether `thread` is on `place`'s file and lines, or on the file as it is, as it is now or was, or
 * is the thread a reply is in.
 */
function threadOn(thread: ThreadRow, place: DraftPlaceRow): boolean {
  if (place.kind === 'reply') return thread.id === place.thread;
  if (place.kind === 'edit' || place.kind === 'conversation') return false;
  if (thread.path !== place.path) return false;
  const { lines } = place;
  if (lines === null) return thread.subject === 'FILE';
  const { start, end } = lines;
  if (thread.subject !== 'LINE' || thread.side !== end.side) return false;
  if (start === null) {
    return (
      [thread.line, thread.originalLine].includes(end.number) &&
      [thread.startLine, thread.originalStartLine].some(
        (first) => first === null || first === end.number,
      )
    );
  }
  return (
    (thread.startSide ?? thread.side) === start.side &&
    ((thread.line === end.number && thread.startLine === start.number) ||
      (thread.originalLine === end.number && thread.originalStartLine === start.number))
  );
}

/**
 * Whether `threads` hold the comment `login` sent as `sent` at `place`, at `sentAt`: a thread on
 * its file and lines, or on the file as it is, or the thread replied to, with a comment of
 * `login`'s whose text is the same, made no earlier than it was sent, give or take
 * {@link CLOCK_SLACK}.
 */
export function holdsComment(
  threads: readonly ThreadRow[],
  login: string,
  place: DraftPlaceRow,
  sent: string,
  sentAt: number,
): boolean {
  return threads.some(
    (thread) =>
      threadOn(thread, place) &&
      thread.comments.some(
        (comment) =>
          sameLogin(comment.author, login) &&
          Date.parse(comment.createdAt) >= sentAt - CLOCK_SLACK &&
          sameCommentText(comment.body, sent),
      ),
  );
}

/** The threads `poller` last read of `pull`, by id: nothing when it hasn't read them. */
function threadsOf(poller: WriterPoller, pull: PullRef): Map<string, ThreadRow> | undefined {
  const list = poller.cachedRead<ReviewThreadList>(pull, REVIEW_THREADS)?.value;
  return list && new Map(threadRows(list).map((thread) => [thread.id, thread]));
}

/** Whether a write starts or adds to your pending review, rather than posting at once. */
function intoReview(write: ReviewWrite): boolean {
  return write.kind === 'startReview' || write.kind === 'addThread' || write.kind === 'addReply';
}

export class Writer {
  readonly #options: WriterOptions;
  readonly #now: () => number;
  /** The views heard of, which each get their account's drafts on their pull request. */
  readonly #views = new Set<string>();
  /** How sending each draft stands, by its account, pull request and place. */
  readonly #sending = new Map<string, Sending>();
  /** The head on screen each view's drafts were last moved to. */
  readonly #shown = new Map<string, string>();
  /** The last write to each pull request, by its key, which the next one waits for. */
  readonly #lastWrite = new Map<string, Promise<unknown>>();
  /**
   * The pull requests, by their keys, written to since your pending review on them was last read
   * afresh: the next write is planned from a read made after.
   */
  readonly #written = new Set<string>();
  /** The waits before looking for comments whose answers were lost. */
  readonly #looking = new Set<ReturnType<typeof setTimeout>>();
  /**
   * How each resolve, unresolve or delete asked stands, by its account, pull request and thread,
   * one a thread at a time: kept until it's done, or another is asked of the thread.
   */
  readonly #acts = new Map<string, { target: Target; row: ActRow }>();
  #stopped = false;

  /**
   * A writer of the drafts in `options.drafts`: one marked sent before Lo started, whose answer
   * was lost, is looked for once the wait after it was sent has passed, whatever's on screen.
   */
  constructor(options: WriterOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    for (const { account, pull, kept } of options.drafts.marked()) {
      if (kept.sent === null) continue;
      const target = { login: account, pull };
      this.#lost(target, this.#key(target, kept.place), kept.place, kept.sent, kept.sentAt);
    }
  }

  /**
   * Follows view `id`, sending it its drafts: as it opens, and as its account or pull request
   * changes.
   */
  follow(id: string): void {
    if (this.#stopped) return;
    if (!this.#options.view(id)) {
      this.#views.delete(id);
      return;
    }
    this.#views.add(id);
    this.#publish(id);
    this.#publishActs(id);
  }

  /** The drafts of view `id`'s account on its pull request now. */
  draftsOf(id: string): DraftsView {
    const target = this.#targetOf(id);
    if (!target) return { id, drafts: [] };
    const { login, pull } = target;
    return {
      id,
      drafts: this.#options.drafts.of(login, pull).map((kept) => this.#row(target, kept)),
    };
  }

  /**
   * Keeps `text` as the draft at `place` on view `id`, as typed: blank removes it. `home`, when
   * it's given, is the overview's code block its box was written on, or none.
   */
  save(id: string, place: DraftPlaceRow, text: string, home?: DraftHomeRow | null): void {
    const { login, pull } = this.#writing(id);
    const key = this.#key({ login, pull }, place);
    // What's typed after it didn't post says nothing more of it. Whether one Lo can't tell of
    // posted still stands.
    if (this.#sending.get(key) === 'notPosted') this.#sending.delete(key);
    if (this.#options.drafts.save(login, pull, place, text, home)) this.#changed({ login, pull });
  }

  /**
   * Removes the draft at `place` on view `id`, as "Discard" does: whatever Lo was looking for of it
   * on GitHub, it stops.
   */
  discard(id: string, place: DraftPlaceRow): void {
    const target = this.#writing(id);
    const key = this.#key(target, place);
    const had = this.#sending.delete(key);
    if (this.#options.drafts.take(target.login, target.pull, place) || had) this.#changed(target);
  }

  /**
   * Sends `text` as the comment at `place` on view `id`, into your pending review or posted now,
   * once the last write to its pull request has its answer. The text is kept as the draft until
   * GitHub takes it.
   */
  send(
    id: string,
    place: DraftPlaceRow,
    text: string,
    how: 'review' | 'now',
  ): Promise<SendOutcome> {
    const info = this.#options.view(id);
    if (!info) throw new IpcError('missing', "There's no pull request's tab with that id.");
    if (place.kind === 'edit') throw new IpcError('refused', 'An edit is sent with `edit`.');
    if (info.run) return Promise.resolve({ kind: 'refused', refusal: { kind: 'run' } });
    const target = this.#targetOf(id);
    if (!target) return Promise.resolve({ kind: 'refused', refusal: { kind: 'signIn' } });
    const key = this.#key(target, place);
    const stands = this.#standing(key, this.#options.drafts.get(target.login, target.pull, place));
    // Sent already, and not settled: sending it again could post it twice.
    if (stands === 'waiting' || stands === 'sending' || stands === 'checking') {
      const message =
        stands === 'checking'
          ? 'Lo is still looking whether it posted.'
          : 'It’s being sent already.';
      return Promise.resolve({ kind: 'refused', refusal: { kind: 'github', message } });
    }
    this.#options.drafts.save(target.login, target.pull, place, text);
    const pull = target.pull.key;
    this.#sending.set(key, this.#lastWrite.has(pull) ? 'waiting' : 'sending');
    this.#changed(target);
    return this.#inTurn(pull, () =>
      this.#send(target, key, place, text, how).catch((error: unknown): SendOutcome => {
        this.#options.log(`sending a comment: ${describe(error)}`);
        // It didn't post: what may have came back as lost.
        this.#unsent(target, key, place);
        return { kind: 'refused', refusal: { kind: 'github', message: describe(error) } };
      }),
    );
  }

  /**
   * Runs `write` as the next write to the pull request keyed `pull`, once the last one has its
   * answer. `write` never fails.
   */
  #inTurn<T>(pull: string, write: () => Promise<T>): Promise<T> {
    const run = (this.#lastWrite.get(pull) ?? Promise.resolve()).then(write);
    this.#lastWrite.set(pull, run);
    void run.finally(() => {
      if (this.#lastWrite.get(pull) === run) this.#lastWrite.delete(pull);
    });
    return run;
  }

  /**
   * Starts an edit of your comment at `place` on view `id`, its draft's text, and what the edit is
   * from, `base`, GitHub's text as the window shows it: refused for a comment that, as Lo last read
   * it, isn't yours or GitHub doesn't let you edit. A draft there already stays as it is.
   */
  async editing(id: string, place: EditPlaceRow, base: string): Promise<ActOutcome> {
    const target = this.#actTarget(id);
    if ('kind' in target) return target;
    const { login, pull } = target;
    const poller = await this.#options.poller(login);
    const comment = threadsOf(poller, pull)
      ?.get(place.thread)
      ?.comments.find((each) => each.id === place.comment);
    const refusal = comment && changeRefused(comment, login, 'edit');
    if (refusal) return { kind: 'refused', refusal };
    if (this.#options.drafts.startEdit(login, pull, place, base)) this.#changed(target);
    return { kind: 'done' };
  }

  /**
   * Sends `text` over the comment the edit at `place` on view `id` is of, once the last write to
   * its pull request has its answer, and only if a read of the comment made then finds GitHub's
   * text still the one the edit started from. The text is kept as the draft until GitHub takes it.
   */
  edit(id: string, place: EditPlaceRow, text: string): Promise<ActOutcome> {
    const target = this.#actTarget(id);
    if ('kind' in target) return Promise.resolve(target);
    const { login, pull } = target;
    const key = this.#key(target, place);
    const kept = this.#options.drafts.get(login, pull, place);
    const base = kept?.base;
    if (base == null) {
      const message =
        'Lo doesn’t have the text this edit started from. Discard it, then edit again.';
      return Promise.resolve({ kind: 'refused', refusal: { kind: 'github', message } });
    }
    const stands = this.#standing(key, kept);
    if (stands === 'waiting' || stands === 'sending' || stands === 'checking') {
      return Promise.resolve({ kind: 'refused', refusal: { kind: 'busy' } });
    }
    this.#options.drafts.save(login, pull, place, text);
    this.#sending.set(key, this.#lastWrite.has(pull.key) ? 'waiting' : 'sending');
    this.#changed(target);
    return this.#inTurn(pull.key, () =>
      this.#edit(target, key, place, text, base).catch((error: unknown): ActOutcome => {
        this.#options.log(`editing a comment: ${describe(error)}`);
        this.#unsent(target, key, place);
        return { kind: 'refused', refusal: { kind: 'github', message: describe(error) } };
      }),
    );
  }

  /**
   * Resolves the thread `thread` on view `id`, or with `resolved` false unresolves it, once the
   * last write to its pull request has its answer: nothing is sent for a thread Lo last read as it
   * is already, and one GitHub doesn't let you change is refused.
   */
  resolve(id: string, thread: string, resolved: boolean): Promise<ActOutcome> {
    const change: Change = resolved ? 'resolve' : 'unresolve';
    return this.#act(id, { thread, comment: null, change }, async (target, poller) => {
      const row = threadsOf(poller, target.pull)?.get(thread);
      if (row?.resolved === resolved) return { kind: 'done' };
      if (row && !(resolved ? row.viewerCanResolve : row.viewerCanUnresolve)) {
        return { kind: 'refused', refusal: { kind: 'cantResolve', resolved } };
      }
      return () => poller.resolveThread(target.pull, thread, resolved);
    });
  }

  /**
   * Deletes your comment `comment` in the thread `thread` on view `id`, once the last write to its
   * pull request has its answer, and only if a read of it made then finds it as the question showed
   * it, `asked`.
   */
  remove(id: string, thread: string, comment: string, asked: DeleteAsked): Promise<ActOutcome> {
    return this.#act(id, { thread, comment, change: 'delete' }, async (target, poller) => {
      const { login, pull } = target;
      const held = threadsOf(poller, pull)
        ?.get(thread)
        ?.comments.find((each) => each.id === comment);
      const refused = held && changeRefused(held, login, 'delete');
      if (refused) return { kind: 'refused', refusal: refused };
      const now = await poller.readOnce((client) => readComment(client, thread, comment));
      if (!now) {
        poller.readAfresh(pull, REVIEW_THREADS);
        return { kind: 'refused', refusal: { kind: 'gone' } };
      }
      if (!now.viewerDidAuthor) {
        return { kind: 'refused', refusal: { kind: 'theirs', author: now.author ?? null } };
      }
      if (!now.viewerCanDelete) {
        return { kind: 'refused', refusal: { kind: 'notAllowed', reasons: now.cannotUpdate } };
      }
      if (!asAsked(asked, now)) {
        // What the question showed may be older than GitHub's: the card is brought up to date.
        poller.readAfresh(pull, REVIEW_THREADS);
        return { kind: 'refused', refusal: { kind: 'changed' } };
      }
      // Deleting a pending comment changes your pending review, perhaps to none.
      if (now.state === 'PENDING') this.#written.add(pull.key);
      return () => poller.deleteComment(pull, inThread(comment));
    });
  }

  /** How the changes asked of view `id`'s pull request stand now. */
  actsOf(id: string): ActsView {
    const target = this.#targetOf(id);
    if (!target) return { id, acts: [] };
    const acts = [...this.#acts.values()]
      .filter(({ target: of }) => sameLogin(of.login, target.login) && of.pull.equals(target.pull))
      .map(({ row }) => row);
    return { id, acts };
  }

  /**
   * Runs `write` as the next write to view `id`'s pull request, as its account, once the last one
   * has its answer, as a review submitted does: comments sent meanwhile wait for it, and the next
   * write plans from your pending review as read after what it sent. Throws an `IpcError` for no
   * such view, or one that can't write.
   */
  inTurn<T>(id: string, write: (turn: Turn) => Promise<T>): Promise<T> {
    const target = this.#writing(id);
    const { login, pull } = target;
    const key = pull.key;
    const before = this.#lastWrite.get(key);
    const run = (before ?? Promise.resolve()).then(async () => {
      const poller = await this.#options.poller(login);
      const review = await this.#reviewRead(poller, pull);
      return write({
        login,
        pull,
        poller,
        review,
        send: async (each) => {
          try {
            return await poller.sendReview(pull, each);
          } finally {
            this.#written.add(key);
          }
        },
      });
    });
    // The next write waits for this one's answer, whatever it is.
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.#lastWrite.set(key, settled);
    void settled.then(() => {
      if (this.#lastWrite.get(key) === settled) this.#lastWrite.delete(key);
    });
    return run;
  }

  /**
   * View `id`'s head on screen may have changed, as when the reader loads a newer push: its new
   * threads' drafts written on older revisions move to it where their file is the same there, and
   * the rest stay on the revision they were written on.
   */
  async headShown(id: string): Promise<void> {
    const head = this.#options.view(id)?.shown;
    const target = this.#targetOf(id);
    const unchanged = this.#options.unchanged;
    if (head === undefined || !target || !unchanged || this.#shown.get(id) === head) return;
    this.#shown.set(id, head);
    const { login, pull } = target;
    const same = new Set<string>();
    for (const kept of this.#options.drafts.of(login, pull)) {
      // A reply or an edit is wherever its thread is.
      if (kept.place.kind !== 'thread') continue;
      const { commit, path } = kept.place;
      if (commit === head || kept.sent !== null) continue;
      const moves = await unchanged(id, commit, head, path).catch(() => false);
      if (moves) same.add(`${commit}|${path}`);
    }
    if (same.size === 0 || this.#stopped) return;
    const moved = this.#options.drafts.moveToLatest(login, pull, head, (place) =>
      same.has(`${place.commit}|${place.path}`) ? { ...place, commit: head } : undefined,
    );
    if (moved) this.#changed(target);
  }

  /** Forgets every draft of `login`, as the account is removed. */
  forget(login: string): void {
    this.#options.drafts.forget(login);
    for (const id of this.#views) this.#publish(id);
  }

  /** Sends nothing more, and tells nothing more. */
  stop(): void {
    this.#stopped = true;
    for (const timer of this.#looking) clearTimeout(timer);
    this.#looking.clear();
  }

  async #send(
    target: Target,
    key: string,
    place: DraftPlaceRow,
    text: string,
    how: 'review' | 'now',
  ): Promise<SendOutcome> {
    const { login, pull } = target;
    // Discarded while it waited: nothing goes.
    if (!this.#options.drafts.get(login, pull, place)) {
      this.#settled(target, key, null);
      return { kind: 'refused', refusal: { kind: 'github', message: 'It was discarded.' } };
    }
    this.#sending.set(key, 'sending');
    this.#changed(target);
    const poller = await this.#options.poller(login);
    if (place.kind === 'conversation') return this.#sendOnPull(target, key, place, text, poller);
    const details = poller.pullRequest(pull)?.details;
    const read = await this.#reviewRead(poller, pull);
    if (!details) {
      this.#settled(target, key, null);
      const message = 'Lo hasn’t read the pull request from GitHub yet. Send it once it has.';
      return { kind: 'refused', refusal: { kind: 'github', message } };
    }
    const review = yourReview(details.id, read ?? { kind: 'unknown', why: 'not read since' });
    const head = details.headRefOid;
    if (place.kind === 'edit') throw new Error('An edit is sent with `edit`.');
    // A reply has no lines, so it goes from any revision.
    const on = place.kind === 'thread' ? place.commit : head;
    if (
      place.kind === 'reply' &&
      threadsOf(poller, pull)?.get(place.thread)?.viewerCanReply === false
    ) {
      this.#settled(target, key, null);
      const message = 'GitHub doesn’t let you reply to this thread.';
      return { kind: 'refused', refusal: { kind: 'github', message } };
    }
    const comment: NewComment =
      place.kind === 'reply'
        ? { kind: 'reply', thread: place.thread, body: text }
        : {
            kind: 'thread',
            path: place.path,
            lines: place.lines
              ? { start: place.lines.start ?? undefined, end: place.lines.end }
              : undefined,
            body: text,
          };
    const planned =
      how === 'review' ? review.add(on, head, comment) : review.post(on, head, comment);
    let joined = false;
    let write: ReviewWrite | ReviewRefusal;
    if ('refusal' in planned) write = planned;
    else if ('mutation' in planned) {
      joined = planned.pending;
      write = planned.mutation;
    } else write = planned;
    if ('refusal' in write) {
      this.#settled(target, key, null);
      return { kind: 'refused', refusal: planRefusal(write) };
    }
    // From here it may be on GitHub, until GitHub says otherwise: a restart keeps that.
    const sentAt = this.#now();
    this.#options.drafts.markSent(login, pull, place, text, sentAt);
    this.#changed(target);
    // A comment on the file, with no pending review, starts an empty one first: two writes.
    for (let step = 0; step < 2; step++) {
      if ('refusal' in write) {
        this.#unsent(target, key, place);
        return { kind: 'refused', refusal: planRefusal(write) };
      }
      let sent;
      try {
        sent = await poller.sendReview(pull, write);
      } catch (error) {
        if (!(error instanceof GithubError) || !error.mayHavePosted()) throw error;
        this.#lost(target, key, place, text, sentAt);
        return { kind: 'lost' };
      } finally {
        this.#written.add(pull.key);
      }
      if ('refusal' in sent) {
        this.#unsent(target, key, place);
        return { kind: 'refused', refusal: writeRefusal(sent) };
      }
      if (write.kind === 'startReview' && !sendsComment(write)) {
        review.accepted(write, sent.review);
        write = review.add(on, head, comment);
        continue;
      }
      this.#posted(target, key, place, text);
      return {
        kind: 'sent',
        pending: intoReview(write),
        joined,
        thread: sent.thread ?? null,
        landedOn: sent.landedOn ? { head: sent.landedOn.head ?? null } : null,
      };
    }
    this.#unsent(target, key, place);
    return { kind: 'refused', refusal: { kind: 'github', message: 'GitHub didn’t take it.' } };
  }

  /**
   * Posts `text` on the pull request itself, from the draft at `place`, in its turn: it joins no
   * review, so it posts at once however it was sent. Its answer lost, Lo looks for it in the
   * timeline, as for any comment.
   */
  async #sendOnPull(
    target: Target,
    key: string,
    place: DraftPlaceRow,
    text: string,
    poller: WriterPoller,
  ): Promise<SendOutcome> {
    const { login, pull } = target;
    const details = poller.pullRequest(pull)?.details;
    if (!details) {
      this.#settled(target, key, null);
      const message = 'Lo hasn’t read the pull request from GitHub yet. Send it once it has.';
      return { kind: 'refused', refusal: { kind: 'github', message } };
    }
    // From here it may be on GitHub, until GitHub says otherwise: a restart keeps that.
    const sentAt = this.#now();
    this.#options.drafts.markSent(login, pull, place, text, sentAt);
    this.#changed(target);
    let sent;
    try {
      sent = await postOnPull(poller, pull, details.id, text);
    } catch (error) {
      if (!(error instanceof GithubError) || !error.mayHavePosted()) throw error;
      this.#lost(target, key, place, text, sentAt);
      return { kind: 'lost' };
    }
    if (typeof sent !== 'string') {
      this.#unsent(target, key, place);
      return { kind: 'refused', refusal: writeRefusal(sent) };
    }
    this.#posted(target, key, place, text);
    return { kind: 'sent', pending: false, joined: false, thread: null, landedOn: null };
  }

  /**
   * Sends `text` over the comment the edit at `place` is of, which started from `base`, as the
   * write's turn comes: only once a read of the comment made now finds GitHub's text still `base`.
   */
  async #edit(
    target: Target,
    key: string,
    place: EditPlaceRow,
    text: string,
    base: string,
  ): Promise<ActOutcome> {
    const { login, pull } = target;
    // Discarded while it waited: nothing goes.
    if (!this.#options.drafts.get(login, pull, place)) {
      this.#settled(target, key, null);
      return { kind: 'refused', refusal: { kind: 'github', message: 'It was discarded.' } };
    }
    this.#sending.set(key, 'sending');
    this.#changed(target);
    const poller = await this.#options.poller(login);
    const now = await poller.readOnce((client) => readComment(client, place.thread, place.comment));
    const before = beforeEdit(base, text, now);
    switch (before.kind) {
      case 'send':
        break;
      case 'alreadySo':
        this.#posted(target, key, place, text);
        return { kind: 'done' };
      case 'changed':
      case 'gone':
        // The threads don't watch for edits: what the card shows is brought up to date.
        poller.readAfresh(pull, REVIEW_THREADS);
        this.#settled(target, key, null);
        return { kind: 'refused', refusal: { kind: before.kind } };
      case 'theirs':
        this.#settled(target, key, null);
        return { kind: 'refused', refusal: { kind: 'theirs', author: now?.author ?? null } };
      case 'notAllowed':
        this.#settled(target, key, null);
        return { kind: 'refused', refusal: { kind: 'notAllowed', reasons: before.reasons } };
      default:
        before satisfies never;
        throw new Error('Lo can’t tell what the comment’s read says.');
    }
    // From here it may be on GitHub, until GitHub says otherwise: a restart keeps that.
    const sentAt = this.#now();
    this.#options.drafts.markSent(login, pull, place, text, sentAt);
    this.#changed(target);
    let answer;
    try {
      answer = await poller.editComment(pull, inThread(place.comment), text);
    } catch (error) {
      if (!(error instanceof GithubError) || !error.mayHavePosted()) throw error;
      this.#lost(target, key, place, text, sentAt);
      return { kind: 'lost' };
    }
    if (answer !== undefined) {
      this.#unsent(target, key, place);
      return { kind: 'refused', refusal: actRefusal(answer) };
    }
    this.#posted(target, key, place, text);
    return { kind: 'done' };
  }

  /**
   * Does `asked` to a thread on view `id`, once the last write to its pull request has its answer,
   * one change a thread at a time: `step` checks what Lo read and settles it, or gives the write to
   * send. A write whose answer is lost is `checking` until `look` reads whether it went (`true`),
   * or a while after.
   */
  #act(
    id: string,
    asked: Omit<ActRow, 'stands'>,
    step: (
      target: Target,
      poller: WriterPoller,
    ) => Promise<ActOutcome | (() => Promise<undefined | ReviewWriteRefusal>)>,
  ): Promise<ActOutcome> {
    const target = this.#actTarget(id);
    if ('kind' in target) return Promise.resolve(target);
    const { pull } = target;
    const key = this.#actKey(target, asked.thread);
    const stands = this.#acts.get(key)?.row.stands;
    if (stands === 'waiting' || stands === 'sending' || stands === 'checking') {
      return Promise.resolve({ kind: 'refused', refusal: { kind: 'busy' } });
    }
    this.#setAct(target, key, {
      ...asked,
      stands: this.#lastWrite.has(pull.key) ? 'waiting' : 'sending',
    });
    const run = async (): Promise<ActOutcome> => {
      this.#setAct(target, key, { ...asked, stands: 'sending' });
      const poller = await this.#options.poller(target.login);
      const next = await step(target, poller);
      if (typeof next !== 'function') {
        this.#setAct(target, key, undefined);
        return next;
      }
      const sentAt = this.#now();
      let answer;
      try {
        answer = await next();
      } catch (error) {
        if (!(error instanceof GithubError) || !error.mayHavePosted()) throw error;
        this.#actLost(target, key, asked, sentAt);
        return { kind: 'lost' };
      }
      this.#setAct(target, key, undefined);
      return answer === undefined
        ? { kind: 'done' }
        : { kind: 'refused', refusal: actRefusal(answer) };
    };
    return this.#inTurn(pull.key, () =>
      run().catch((error: unknown): ActOutcome => {
        this.#options.log(`changing a thread: ${describe(error)}`);
        this.#setAct(target, key, undefined);
        return { kind: 'refused', refusal: { kind: 'github', message: describe(error) } };
      }),
    );
  }

  /**
   * GitHub's answer to `asked`, sent at `sentAt`, was lost: it's `checking` until a read made a
   * while after it was sent says whether it went. Done, the threads are read again; otherwise it's
   * `notDone`, or `unknown` when GitHub refuses the read. Nothing's sent again.
   */
  #actLost(target: Target, key: string, asked: Omit<ActRow, 'stands'>, sentAt: number): void {
    const { login, pull } = target;
    const checking: ActRow = { ...asked, stands: 'checking' };
    this.#setAct(target, key, checking);
    // Asked again meanwhile: what's found says nothing of it.
    const still = () => !this.#stopped && this.#acts.get(key)?.row === checking;
    const { thread, comment } = asked;
    const look = async (poller: WriterPoller): Promise<'again' | undefined> => {
      let done: boolean | 'again';
      if (comment !== null) {
        done =
          (await poller.readOnce((client) => readComment(client, thread, comment))) === undefined;
      } else {
        const list = await poller.readOnce((client) => reviewThreads(client, pull));
        const found = threadRows(list).find((each) => each.id === thread);
        // A thread that's gone has nothing left to resolve.
        if (found) done = found.resolved === (asked.change === 'resolve');
        else done = list.missing > 0 ? 'again' : true;
      }
      if (!still() || done === 'again') return done === 'again' ? 'again' : undefined;
      if (done) {
        this.#setAct(target, key, undefined);
        poller.readAfresh(pull, REVIEW_THREADS);
      } else {
        this.#setAct(target, key, { ...asked, stands: 'notDone' });
      }
      return undefined;
    };
    this.#lookAfter(login, sentAt, still, look, (error) => {
      this.#options.log(`looking whether a change to a thread went: ${describe(error)}`);
      this.#setAct(target, key, { ...asked, stands: 'unknown' });
    });
  }

  /** How the change to the thread at `key` stands now, or that there's none. */
  #setAct(target: Target, key: string, row: ActRow | undefined): void {
    if (row) this.#acts.set(key, { target, row });
    else if (!this.#acts.delete(key)) return;
    for (const id of this.#views) {
      const other = this.#targetOf(id);
      if (other && sameLogin(other.login, target.login) && other.pull.equals(target.pull)) {
        this.#publishActs(id);
      }
    }
  }

  #actKey({ login, pull }: Target, thread: string): string {
    return `${login.toLowerCase()}|${pull.key}|${thread}`;
  }

  /** The account and pull request view `id` changes threads on, or why it can't. */
  #actTarget(id: string): Target | ActOutcome {
    const info = this.#options.view(id);
    if (!info) throw new IpcError('missing', "There's no pull request's tab with that id.");
    if (info.run) return { kind: 'refused', refusal: { kind: 'run' } };
    return this.#targetOf(id) ?? { kind: 'refused', refusal: { kind: 'signIn' } };
  }

  #publishActs(id: string): void {
    const publish = this.#options.publishActs;
    if (this.#stopped || !publish) return;
    try {
      publish(this.actsOf(id));
    } catch (error) {
      this.#options.log(`sending how changes stand: ${describe(error)}`);
    }
  }

  /**
   * Your pending review on `pull`, from which a write is planned: as the poller last read it, or,
   * after a write to `pull`, as read again after its answer. Nothing when that can't be read.
   */
  async #reviewRead(poller: WriterPoller, pull: PullRef): Promise<PendingReviewRead | undefined> {
    if (!this.#written.has(pull.key)) {
      return (
        poller.cachedRead<PendingReviewRead>(pull, PENDING_REVIEW)?.value ??
        (await poller.pendingReview(pull))?.value
      );
    }
    let mark = poller.readAfresh(pull, PENDING_REVIEW);
    if (!mark) {
      // Not kept, as for a pull request no view follows: kept from now.
      await poller.pendingReview(pull);
      mark = poller.readAfresh(pull, PENDING_REVIEW);
    }
    if (!mark) return undefined;
    const readWait = this.#options.readWait ?? READ_WAIT;
    const read = await this.#readAfter(poller, pull, PENDING_REVIEW, mark, this.#now() + readWait);
    if (typeof read !== 'object') return undefined;
    this.#written.delete(pull.key);
    return read.value;
  }

  /**
   * `pull`'s timeline as read afresh after now, as `#reviewRead` reads your pending review: never
   * what the poller had, which may be from before the write, even from before Lo started. The
   * poller keeps it, from now if it didn't, and reads it again; only its newest page, joined to what
   * it had, with when it was made. `again` when no such read came in time, to look again in a while.
   */
  async #timelineNow(
    poller: WriterPoller,
    pull: PullRef,
  ): Promise<Cached<Pick<PullRequestTimeline, 'items'>> | 'again'> {
    let mark = poller.readAfresh(pull, TIMELINE);
    if (!mark) {
      // Not kept, as for a pull request whose timeline isn't on screen: kept from now. What it
      // answers at once may be what an earlier run kept, so it says nothing of the write.
      await poller.timeline(pull);
      mark = poller.readAfresh(pull, TIMELINE);
    }
    if (!mark) return 'again';
    const readWait = this.#options.readWait ?? READ_WAIT;
    const read = await this.#readAfter(poller, pull, TIMELINE, mark, this.#now() + readWait);
    return typeof read === 'object' ? read : 'again';
  }

  /**
   * What the read of `kind` kept for `pull` holds once a run that started after `mark` has
   * finished with it, or why there's none by `deadline`: `stale`, when the read is no longer the
   * one marked, `failed` or `late`.
   */
  async #readAfter<T>(
    poller: WriterPoller,
    pull: PullRef,
    kind: ReadKind<T>,
    mark: ReadMark,
    deadline: number,
  ): Promise<Cached<T> | 'stale' | 'failed' | 'late' | 'stopped'> {
    for (;;) {
      if (this.#stopped) return 'stopped';
      const since = poller.readSince<T>(pull, kind, mark);
      if (since.kind === 'read') return since.read;
      if (since.kind === 'stale') return 'stale';
      const heard = await this.#nextRead(poller, pull, kind.name, deadline - this.#now());
      if (heard !== 'read') return heard;
    }
  }

  /**
   * The comment sent from the draft at `place` posted: the draft goes, unless its text changed
   * since.
   */
  #posted(target: Target, key: string, place: DraftPlaceRow, text: string): void {
    const { login, pull } = target;
    const kept = this.#options.drafts.get(login, pull, place);
    if (kept?.text === text) this.#options.drafts.take(login, pull, place);
    else this.#options.drafts.markSent(login, pull, place, null);
    this.#settled(target, key, null);
  }

  /** The comment sent from the draft at `place` didn't post: the draft stays, as it is. */
  #unsent(target: Target, key: string, place: DraftPlaceRow): void {
    this.#options.drafts.markSent(target.login, target.pull, place, null);
    this.#settled(target, key, null);
  }

  /**
   * GitHub's answer to sending `text` at `place`, at `sentAt` by this computer's clock, was lost:
   * the draft stays marked sent, and is `checking` until Lo knows. Once the wait after it was sent
   * has passed, Lo reads the threads afresh, then, and looks for it, or for an edit, reads the
   * comment. When the read can't be made, as while offline, it stays `checking` and Lo tries again
   * in a while.
   */
  #lost(
    target: Target,
    key: string,
    place: DraftPlaceRow,
    text: string,
    sentAt: number | null,
  ): void {
    const { login, pull } = target;
    const at = sentAt ?? this.#now();
    this.#sending.set(key, 'checking');
    this.#changed(target);
    // Discarded, or sent again, meanwhile: what's found says nothing of it.
    const still = () =>
      !this.#stopped && this.#options.drafts.get(login, pull, place)?.sentAt === sentAt;
    const unknown = (error: unknown) => {
      this.#options.log(`looking whether a comment posted: ${describe(error)}`);
      this.#settled(target, key, 'unknown');
    };
    if (place.kind === 'edit') {
      const base = this.#options.drafts.get(login, pull, place)?.base ?? null;
      const look = async (poller: WriterPoller) => {
        const found = await poller.readOnce((client) =>
          readComment(client, place.thread, place.comment),
        );
        if (!still()) return undefined;
        const after =
          base === null ? { kind: 'notTaken' as const } : afterLostEdit(base, text, found);
        if (after.kind === 'taken') {
          this.#posted(target, key, place, text);
          // The threads don't watch for edits: they show the new text once they're read again.
          poller.readAfresh(pull, REVIEW_THREADS);
          return undefined;
        }
        this.#options.drafts.markSent(login, pull, place, null);
        const now = { notTaken: 'notPosted', changed: 'changed', gone: 'gone' } as const;
        this.#settled(target, key, now[after.kind]);
        return undefined;
      };
      this.#lookAfter(login, at, still, look, unknown);
      return;
    }
    if (place.kind === 'conversation') {
      const look = async (poller: WriterPoller) => {
        const read = await this.#timelineNow(poller, pull);
        if (!still() || read === 'again') return still() ? 'again' : undefined;
        // Only a read made the wait after it was sent, once GitHub has stored it, says whether it
        // posted.
        if (read.fetchedAt < at + (this.#options.settleAfter ?? SETTLE_AFTER)) return 'again';
        const timeline = read.value;
        // When it was sent, by GitHub's clock.
        const ahead = await poller.readOnce((client) => Promise.resolve(client.githubAhead()));
        const sentThere = at + (ahead ?? 0);
        if (!still()) return undefined;
        if (holdsPullComment(timeline, login, text, sentThere, CLOCK_SLACK)) {
          this.#posted(target, key, place, text);
        } else {
          this.#options.drafts.markSent(login, pull, place, null);
          this.#settled(target, key, 'notPosted');
        }
        return undefined;
      };
      this.#lookAfter(login, at, still, look, unknown);
      return;
    }
    const look = async (poller: WriterPoller) => {
      const read = await poller.readOnce(async (client) => ({
        list: await reviewThreads(client, pull),
        ahead: client.githubAhead(),
      }));
      if (!still()) return undefined;
      // When it was sent, by GitHub's clock.
      const sentThere = at + (read.ahead ?? 0);
      const threads = threadRows(read.list);
      // Not found where GitHub left threads out: it may be among them.
      if (read.list.missing > 0 && !holdsComment(threads, login, place, text, sentThere)) {
        return 'again';
      }
      this.#look(target, key, place, text, sentThere, threads);
      return undefined;
    };
    this.#lookAfter(login, at, still, look, unknown);
  }

  /**
   * Looks whether a write whose answer was lost went, once the wait after `at`, when it was sent
   * by this computer's clock, has passed: `look` reads GitHub through the account's poller and
   * settles it, or says to look `again` in a while, as when the read left something out. When
   * GitHub can't be read, as while offline, Lo looks again in a while too; when it refuses the
   * read, `unknown` settles it. Nothing more once `still` says it's no longer wanted, or Lo stops.
   */
  #lookAfter(
    login: string,
    at: number,
    still: () => boolean,
    look: (poller: WriterPoller) => Promise<'again' | undefined>,
    unknown: (error: unknown) => void,
  ): void {
    const settleAfter = this.#options.settleAfter ?? SETTLE_AFTER;
    const retryAfter = this.#options.retryAfter ?? RETRY_AFTER;
    const once = async (): Promise<void> => {
      if (!still()) return;
      let again;
      try {
        again = await look(await this.#options.poller(login));
      } catch (error) {
        if (!still()) return;
        if (!(error instanceof GithubError) || error.isWaitable()) {
          later(retryAfter);
          return;
        }
        unknown(error);
        return;
      }
      if (again === 'again' && still()) later(retryAfter);
    };
    const later = (wait: number): void => {
      if (this.#stopped) return;
      const timer = setTimeout(() => {
        this.#looking.delete(timer);
        once().catch((error: unknown) => {
          if (still()) unknown(error);
        });
      }, wait);
      this.#looking.add(timer);
    };
    later(Math.max(0, at + settleAfter - this.#now()));
  }

  /**
   * Waits for the poller to read `pull`'s read named `name`, or fail to, for `wait` milliseconds at
   * most.
   */
  #nextRead(
    poller: WriterPoller,
    pull: PullRef,
    name: string,
    wait: number,
  ): Promise<'read' | 'failed' | 'late'> {
    return new Promise((resolve) => {
      if (wait <= 0) {
        resolve('late');
        return;
      }
      const done = (how: 'read' | 'failed' | 'late') => {
        clearTimeout(timer);
        stop();
        resolve(how);
      };
      const timer = setTimeout(() => done('late'), wait);
      const stop = poller.onEvent((event: PollEvent) => {
        if (event.kind !== 'read' && event.kind !== 'confirmed' && event.kind !== 'readFailed') {
          return;
        }
        if (!event.pull.equals(pull) || event.name !== name) return;
        done(event.kind === 'readFailed' ? 'failed' : 'read');
      });
    });
  }

  /**
   * Looks among `threads` for the comment sent as `sent` at `place`, at `sentAt` by GitHub's clock,
   * and settles it: found, as {@link Writer.#posted}; otherwise it didn't post.
   */
  #look(
    target: Target,
    key: string,
    place: DraftPlaceRow,
    sent: string,
    sentAt: number,
    threads: readonly ThreadRow[],
  ): void {
    const { login, pull } = target;
    const kept = this.#options.drafts.get(login, pull, place);
    if (!kept) return;
    if (holdsComment(threads, login, place, sent, sentAt)) {
      this.#posted(target, key, place, sent);
      return;
    }
    this.#options.drafts.markSent(login, pull, place, null);
    this.#settled(target, key, 'notPosted');
  }

  /**
   * How sending the draft at `key`, `kept`, stands: as Lo is sending it, or, for one marked sent
   * before Lo started, `checking` until a read settles it.
   */
  #standing(key: string, kept: Kept | undefined): Sending | undefined {
    return this.#sending.get(key) ?? (kept?.sent == null ? undefined : 'checking');
  }

  /** Sending the draft at `key` stands as `now`, or not at all. */
  #settled(target: Target, key: string, now: Sending | null): void {
    if (now === null) this.#sending.delete(key);
    else this.#sending.set(key, now);
    this.#changed(target);
  }

  /** The account and pull request view `id` writes as and on, if it acts as an account. */
  #targetOf(id: string): Target | undefined {
    const info = this.#options.view(id);
    if (info?.acting?.kind !== 'account' || info.run) return undefined;
    const { owner, name } = info.repository;
    return { login: info.acting.login, pull: new PullRef(owner, name, info.number) };
  }

  /** {@link Writer.#targetOf}, or the refusal of a view that can't write. */
  #writing(id: string): Target {
    const info = this.#options.view(id);
    if (!info) throw new IpcError('missing', "There's no pull request's tab with that id.");
    const target = this.#targetOf(id);
    if (!target) throw new IpcError('refused', 'Sign in to comment.');
    return target;
  }

  #key({ login, pull }: Target, place: DraftPlaceRow): string {
    return `${login.toLowerCase()}|${pull.key}|${placeJson(place)}`;
  }

  #row(target: Target, kept: Kept): DraftRow {
    return {
      place: kept.place,
      text: kept.text,
      savedAt: Math.max(0, Math.round(kept.savedAt)),
      restored: kept.restored,
      sending: this.#standing(this.#key(target, kept.place), kept) ?? null,
      sent: kept.sent,
      base: kept.base,
      home: kept.home,
    };
  }

  /** Tells every view of `target`'s account on its pull request what its drafts are now. */
  #changed(target: Target): void {
    for (const id of this.#views) {
      const other = this.#targetOf(id);
      if (other && sameLogin(other.login, target.login) && other.pull.equals(target.pull)) {
        this.#publish(id);
      }
    }
  }

  #publish(id: string): void {
    if (this.#stopped) return;
    try {
      this.#options.publish(this.draftsOf(id));
    } catch (error) {
      this.#options.log(`sending the drafts: ${describe(error)}`);
    }
  }
}
