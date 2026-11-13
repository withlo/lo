// Writing comments, in main: each view's drafts, as the window hands over what the reader types,
// and sending one, which only the reader does. `@lo/review`'s pending review plans each write from
// your pending review as the account's poller last read it, and the poller sends it. One write to a
// pull request goes at a time: a second waits for the first's answer, since two comments sent at
// once would each start a review, and GitHub refuses the second. A draft stays until GitHub takes
// its comment. When GitHub's answer is lost, the draft is marked with the text sent, and once the
// write's read-back lands, and no sooner than a while after the failure, Lo looks among your
// comments for it: found, the draft goes; otherwise the reader is told, and may send it again.
// Nothing is ever sent again by itself. Nothing here calls Electron.

import {
  GithubError,
  PENDING_REVIEW,
  type PendingReviewRead,
  type PollEvent,
  type Poller,
  PullRef,
  REVIEW_THREADS,
  type ReviewThreadList,
  type ReviewWrite,
  type ReviewWriteRefusal,
  describeReviewRefusal,
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
  /** How long after a lost answer Lo waits, at least, before it looks whether it posted. */
  readonly settleAfter?: number;
  /** How long Lo waits for the read that says whether it posted, before it says it can't tell. */
  readonly readWait?: number;
}

/** How long after a lost answer Lo waits, at least, before it looks whether the comment posted. */
export const SETTLE_AFTER = 10_000;

/** How long Lo waits for the read that says whether a comment posted. */
export const READ_WAIT = 120_000;

/** A view's account and pull request, as it writes. */
interface Target {
  readonly login: string;
  readonly pull: PullRef;
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
 * Whether `threads` hold the comment sent as `sent` by `login` at `place`: a thread on its file,
 * on its lines or on the file as it is, with a comment of `login`'s whose text is the same.
 */
export function holdsComment(
  threads: readonly ThreadRow[],
  login: string,
  place: DraftPlaceRow,
  sent: string,
): boolean {
  return threads.some((thread) => {
    if (thread.path !== place.path) return false;
    const { lines } = place;
    if (lines === null) {
      if (thread.subject !== 'FILE') return false;
    } else {
      const { end } = lines;
      const at = [thread.line, thread.originalLine];
      if (thread.subject !== 'LINE' || thread.side !== end.side || !at.includes(end.number)) {
        return false;
      }
    }
    return thread.comments.some(
      (comment) => sameLogin(comment.author, login) && sameCommentText(comment.body, sent),
    );
  });
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
  #stopped = false;

  constructor(options: WriterOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  /** Follows view `id`, sending it its drafts: as it opens, and as its account or pull request changes. */
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
    const stands = this.#sending.get(key);
    // What's typed after a send settled says nothing more of it.
    if (stands === 'notPosted' || stands === 'unknown') this.#sending.delete(key);
    if (this.#options.drafts.save(login, pull, place, text)) this.#changed({ login, pull });
  }

  /** Removes the draft at `place` on view `id`, as "Discard" does. */
  discard(id: string, place: DraftPlaceRow): void {
    const target = this.#writing(id);
    const key = this.#key(target, place);
    if (this.#sending.get(key) === 'checking') return;
    this.#sending.delete(key);
    if (this.#options.drafts.take(target.login, target.pull, place)) this.#changed(target);
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
    const stands = this.#sending.get(key);
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
        this.#settled(target, key, null);
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
   * View `id`'s threads were read, at `fetchedAt`: a draft whose answer was lost before Lo started,
   * and which nothing since Lo started is settling, is settled against them, once they were read
   * after it was sent and the wait.
   */
  threadsRead(id: string, rows: readonly ThreadRow[], fetchedAt: number): void {
    const target = this.#targetOf(id);
    if (!target) return;
    const settleAfter = this.#options.settleAfter ?? SETTLE_AFTER;
    for (const kept of this.#options.drafts.of(target.login, target.pull)) {
      if (kept.sent === null || fetchedAt < kept.savedAt + settleAfter) continue;
      const key = this.#key(target, kept.place);
      if (this.#sending.has(key)) continue;
      this.#look(target, key, kept.place, kept.sent, rows);
    }
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
  }

  async #send(
    target: Target,
    key: string,
    place: DraftPlaceRow,
    text: string,
    how: 'review' | 'now',
  ): Promise<SendOutcome> {
    const { login, pull } = target;
    this.#sending.set(key, 'sending');
    this.#changed(target);
    const poller = await this.#options.poller(login);
    const details = poller.pullRequest(pull)?.details;
    const read: PendingReviewRead | undefined =
      poller.cachedRead<PendingReviewRead>(pull, PENDING_REVIEW)?.value ??
      (await poller.pendingReview(pull))?.value;
    if (!details) {
      this.#settled(target, key, null);
      const message = 'Lo hasn’t read the pull request from GitHub yet. Send it once it has.';
      return { kind: 'refused', refusal: { kind: 'github', message } };
    }
    const review = yourReview(details.id, read ?? { kind: 'unknown', why: 'not read yet' });
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
    // A comment on the file, with no pending review, starts an empty one first: two writes.
    for (let step = 0; step < 2; step++) {
      if ('refusal' in write) {
        this.#settled(target, key, null);
        return { kind: 'refused', refusal: planRefusal(write) };
      }
      let sent;
      try {
        sent = await poller.sendReview(pull, write);
      } catch (error) {
        if (!(error instanceof GithubError) || !error.mayHavePosted()) throw error;
        this.#lost(target, key, place, text, poller);
        return { kind: 'lost' };
      }
      if ('refusal' in sent) {
        this.#settled(target, key, null);
        return { kind: 'refused', refusal: writeRefusal(sent) };
      }
      if (write.kind === 'startReview' && !sendsComment(write)) {
        review.accepted(write, sent.review);
        write = review.add(place.commit, head, comment);
        continue;
      }
      this.#options.drafts.take(login, pull, place);
      this.#settled(target, key, null);
      return {
        kind: 'sent',
        pending: intoReview(write),
        joined,
        thread: sent.thread ?? null,
        landedOn: sent.landedOn ? { head: sent.landedOn.head ?? null } : null,
      };
    }
    this.#settled(target, key, null);
    return { kind: 'refused', refusal: { kind: 'github', message: 'GitHub didn’t take it.' } };
  }

  /**
   * GitHub's answer to sending `text` at `place` was lost: the draft is marked sent, and once the
   * threads are read again after the failure, and no sooner than the wait, Lo looks for it.
   */
  #lost(
    target: Target,
    key: string,
    place: DraftPlaceRow,
    text: string,
    poller: WriterPoller,
  ): void {
    const { login, pull } = target;
    const failedAt = this.#now();
    this.#options.drafts.markSent(login, pull, place, text);
    this.#sending.set(key, 'checking');
    this.#changed(target);
    const mark = poller.readAfresh(pull, REVIEW_THREADS);
    const settleAfter = this.#options.settleAfter ?? SETTLE_AFTER;
    const readWait = this.#options.readWait ?? READ_WAIT;
    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, settleAfter));
      if (!mark) return this.#settled(target, key, 'unknown');
      const deadline = failedAt + settleAfter + readWait;
      for (;;) {
        if (this.#stopped) return undefined;
        const since = poller.readSince<ReviewThreadList>(pull, REVIEW_THREADS, mark);
        if (since.kind === 'read') {
          return this.#look(target, key, place, text, threadRows(since.read.value));
        }
        if (since.kind === 'stale') return this.#settled(target, key, 'unknown');
        const heard = await this.#nextRead(poller, pull, deadline - this.#now());
        if (heard !== 'read') return this.#settled(target, key, 'unknown');
      }
    })().catch((error: unknown) => {
      this.#options.log(`looking whether a comment posted: ${describe(error)}`);
      this.#settled(target, key, 'unknown');
    });
  }

  /** Waits for the poller to read `pull`'s threads, or fail to, for `wait` milliseconds at most. */
  #nextRead(
    poller: WriterPoller,
    pull: PullRef,
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
        if (!event.pull.equals(pull) || event.name !== REVIEW_THREADS.name) return;
        done(event.kind === 'readFailed' ? 'failed' : 'read');
      });
    });
  }

  /** Looks among `threads` for the comment sent as `sent` at `place`, and settles it. */
  #look(
    target: Target,
    key: string,
    place: DraftPlaceRow,
    sent: string,
    threads: readonly ThreadRow[],
  ): void {
    const { login, pull } = target;
    if (holdsComment(threads, login, place, sent)) {
      this.#options.drafts.take(login, pull, place);
      this.#settled(target, key, null);
      return;
    }
    this.#options.drafts.markSent(login, pull, place, null);
    this.#settled(target, key, 'notPosted');
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
      sending: this.#sending.get(this.#key(target, kept.place)) ?? null,
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
