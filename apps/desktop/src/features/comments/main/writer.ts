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
// since it was sent is never dropped. Nothing is ever sent again by itself. Nothing here calls
// Electron.

import {
  type Cached,
  GithubError,
  PENDING_REVIEW,
  type PendingReviewRead,
  type PollEvent,
  type Poller,
  PullRef,
  type ReadKind,
  type ReadMark,
  type ReviewWrite,
  type ReviewWriteRefusal,
  type Sent,
  describeReviewRefusal,
  reviewThreads,
} from '@lo/github';
import {
  type NewThread,
  type ReviewRefusal,
  sameCommentText,
  sendsComment,
  yourReview,
} from '@lo/review';

import { IpcError } from '../../../ipc/contract.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type {
  DraftPlaceRow,
  DraftRow,
  DraftsView,
  SendOutcome,
  SendRefusal,
  Sending,
  ThreadRow,
} from '../contract.ts';
import { type DraftStore, type Kept, placeJson } from './drafts.ts';
import { threadRows } from './threads.ts';

/** What the writer uses of an account's poller. */
export type WriterPoller = Pick<
  Poller,
  | 'sendReview'
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
 * Whether `thread` is on `place`'s file and lines, or on the file as it is, as it is now or was.
 */
function threadOn(thread: ThreadRow, place: DraftPlaceRow): boolean {
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
 * its file and lines, or on the file as it is, with a comment of `login`'s whose text is the same,
 * made no earlier than it was sent, give or take {@link CLOCK_SLACK}.
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

  /** Keeps `text` as the draft at `place` on view `id`, as typed: blank removes it. */
  save(id: string, place: DraftPlaceRow, text: string): void {
    const { login, pull } = this.#writing(id);
    const key = this.#key({ login, pull }, place);
    // What's typed after it didn't post says nothing more of it. Whether one Lo can't tell of
    // posted still stands.
    if (this.#sending.get(key) === 'notPosted') this.#sending.delete(key);
    if (this.#options.drafts.save(login, pull, place, text)) this.#changed({ login, pull });
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
    const before = this.#lastWrite.get(pull);
    this.#sending.set(key, before ? 'waiting' : 'sending');
    this.#changed(target);
    const run = (before ?? Promise.resolve()).then(() =>
      this.#send(target, key, place, text, how).catch((error: unknown): SendOutcome => {
        this.#options.log(`sending a comment: ${describe(error)}`);
        // It didn't post: what may have came back as lost.
        this.#unsent(target, key, place);
        return { kind: 'refused', refusal: { kind: 'github', message: describe(error) } };
      }),
    );
    this.#lastWrite.set(pull, run);
    void run.finally(() => {
      if (this.#lastWrite.get(pull) === run) this.#lastWrite.delete(pull);
    });
    return run;
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
    const details = poller.pullRequest(pull)?.details;
    const read = await this.#reviewRead(poller, pull);
    if (!details) {
      this.#settled(target, key, null);
      const message = 'Lo hasn’t read the pull request from GitHub yet. Send it once it has.';
      return { kind: 'refused', refusal: { kind: 'github', message } };
    }
    const review = yourReview(details.id, read ?? { kind: 'unknown', why: 'not read since' });
    const head = details.headRefOid;
    const comment: NewThread = {
      kind: 'thread',
      path: place.path,
      lines: place.lines
        ? { start: place.lines.start ?? undefined, end: place.lines.end }
        : undefined,
      body: text,
    };
    const planned =
      how === 'review'
        ? review.add(place.commit, head, comment)
        : review.post(place.commit, head, comment);
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
        write = review.add(place.commit, head, comment);
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
   * has passed, Lo reads the threads afresh, then, and looks for it. When the read can't be made, as
   * while offline, it stays `checking` and Lo tries again in a while.
   */
  #lost(
    target: Target,
    key: string,
    place: DraftPlaceRow,
    text: string,
    sentAt: number | null,
  ): void {
    const { login, pull } = target;
    const settleAfter = this.#options.settleAfter ?? SETTLE_AFTER;
    const retryAfter = this.#options.retryAfter ?? RETRY_AFTER;
    const at = sentAt ?? this.#now();
    this.#sending.set(key, 'checking');
    this.#changed(target);
    // Discarded, or sent again, meanwhile: what's found says nothing of it.
    const still = () =>
      !this.#stopped && this.#options.drafts.get(login, pull, place)?.sentAt === sentAt;
    const look = async (): Promise<void> => {
      if (!still()) return;
      let read;
      try {
        const poller = await this.#options.poller(login);
        read = await poller.readOnce(async (client) => ({
          list: await reviewThreads(client, pull),
          ahead: client.githubAhead(),
        }));
      } catch (error) {
        if (!still()) return;
        if (!(error instanceof GithubError) || error.isWaitable()) {
          later(retryAfter);
          return;
        }
        this.#options.log(`looking whether a comment posted: ${describe(error)}`);
        this.#settled(target, key, 'unknown');
        return;
      }
      if (!still()) return;
      // When it was sent, by GitHub's clock.
      const sentThere = at + (read.ahead ?? 0);
      const threads = threadRows(read.list);
      // Not found where GitHub left threads out: it may be among them.
      if (read.list.missing > 0 && !holdsComment(threads, login, place, text, sentThere)) {
        later(retryAfter);
        return;
      }
      this.#look(target, key, place, text, sentThere, threads);
    };
    const later = (wait: number): void => {
      if (this.#stopped) return;
      const timer = setTimeout(() => {
        this.#looking.delete(timer);
        look().catch((error: unknown) => {
          this.#options.log(`looking whether a comment posted: ${describe(error)}`);
          if (still()) this.#settled(target, key, 'unknown');
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
