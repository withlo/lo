// Submitting a review, in main: what the submit dialog shows, read as it opens; the summary, kept
// through the comments feature's drafts as it's typed; and submitting, which only the reader does.
// `@lo/review`'s pending review plans it, and it goes in its turn among the writes to the pull
// request, comments included, so it's planned from your pending review as read after the last one.
// The summary is kept until GitHub takes it, and is marked with the text sent, and when, while it's
// sent. When GitHub's answer is lost, the mark stays, a restart included, and once a while has
// passed since it was sent, Lo reads your latest reviews afresh and looks among them for it, by
// GitHub's clock: found, it was submitted, and the summary goes; otherwise the reader is told, and
// may submit it again. A read that can't be made, as while offline, is tried again in a while; one
// GitHub refuses says Lo can't tell, and then only "Submit anyway" sends. Until Lo knows, nothing
// more is sent. Nothing is ever sent again by itself. Nothing here calls Electron.

import {
  GithubError,
  PENDING_REVIEW,
  PullRef,
  describeReviewRefusal,
  type PendingReviewRead,
  type Poller,
  type ReviewWriteRefusal,
} from '@lo/github';
import {
  pendingReviewFrom,
  REVIEW_EVENTS,
  sameCommentText,
  yourReview,
  type ReviewEvent,
  type ReviewRefusal,
} from '@lo/review';

import { IpcError } from '../../../ipc/contract.ts';
import type { PendingReviewRow, ThreadRow } from '../../comments/contract.ts';
import type { DraftsService, ReviewsService } from '../../comments/service.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import {
  IN_A_LAYER,
  SIGN_IN,
  type DialogView,
  type PendingCommentRow,
  type Submission,
  type SubmitOutcome,
  type SubmitRefusal,
  type Submitting,
} from '../contract.ts';

/** What submitting uses of an account's poller. */
export type SubmitPoller = Pick<
  Poller,
  'pullRequest' | 'cachedRead' | 'pendingReview' | 'writesHeldUntil'
>;

/** One of your reviews, as `YourReviews` reads it. */
export interface ReviewNode {
  readonly id: string;
  /** GraphQL's `PullRequestReviewState`: `PENDING`, `COMMENTED`, `APPROVED` and so on. */
  readonly state: string;
  readonly body: string;
  /** When it was submitted, by GitHub's clock; nothing for a pending one. */
  readonly submittedAt: string | null;
}

/**
 * Your latest reviews on a pull request, read afresh, and how far GitHub's clock is ahead of this
 * computer's, by that answer's, if GitHub said.
 */
export interface ReviewsRead {
  readonly reviews: readonly ReviewNode[];
  readonly ahead: number | undefined;
}

export interface SubmitterOptions {
  /** What main has of a view now, or nothing once it's closed. */
  readonly view: (id: string) => PullTabInfo | undefined;
  /** The head view `id`'s newer column shows: the revision on screen. */
  readonly onScreen: (id: string) => string | undefined;
  /** The poller of each account, as the accounts feature provides it. */
  readonly poller: (login: string) => Promise<SubmitPoller>;
  /** The comments feature's threads, pending review and writes. */
  readonly reviews: ReviewsService;
  /** The comments feature's drafts, the summary's among them. */
  readonly drafts: DraftsService;
  /** `login`'s latest reviews on `pull`, read afresh from GitHub. */
  readonly readReviews: (login: string, pull: PullRef) => Promise<ReviewsRead>;
  readonly publish: (submission: Submission) => void;
  readonly log: (line: string) => void;
  readonly now?: () => number;
  /** How long after sending a review whose answer was lost Lo waits before it looks for it. */
  readonly settleAfter?: number;
  /** How long Lo waits to look again when it couldn't read your reviews, as while offline. */
  readonly retryAfter?: number;
}

/** How long after sending a review whose answer was lost Lo waits before it looks for it. */
export const SETTLE_AFTER = 10_000;

/** How long Lo waits to look again for a review when it couldn't read your reviews. */
export const RETRY_AFTER = 30_000;

/**
 * How much earlier than it was sent, by GitHub's clock, GitHub may say a review was submitted: its
 * times, and the `Date` its clock is read from, are to the second, and the answer took a while.
 */
export const CLOCK_SLACK = 5_000;

/** The state a submitted review has, by its verdict. */
const STATES: Readonly<Record<ReviewEvent, string>> = {
  COMMENT: 'COMMENTED',
  APPROVE: 'APPROVED',
  REQUEST_CHANGES: 'CHANGES_REQUESTED',
};

/** The verdict a submitted review's state says, if it says one. */
function eventOf(state: string): ReviewEvent | null {
  return REVIEW_EVENTS.find((event) => STATES[event] === state) ?? null;
}

/** What a send was, for the read that looks for it: its verdict and the pending review it submitted. */
interface Asked {
  readonly event: ReviewEvent;
  readonly pending: string | undefined;
}

/** A view's account and pull request. */
interface Target {
  readonly login: string;
  readonly pull: PullRef;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether two logins name one account: GitHub's ignore case. */
function sameLogin(a: string | null | undefined, b: string): boolean {
  return a != null && a.toLowerCase() === b.toLowerCase();
}

/** `@lo/review`'s refusal to plan a review, as the dialog says it. */
export function planRefusal(refusal: ReviewRefusal): SubmitRefusal {
  switch (refusal.refusal) {
    case 'otherRevision':
      return { kind: 'otherRevision', reviewOn: refusal.reviewOn ?? null };
    case 'nothingToSubmit':
      return { kind: 'nothingToSubmit' };
    case 'pendingUnknown':
      return { kind: 'pendingUnknown' };
    case 'ownPullRequest':
      return { kind: 'ownPullRequest' };
    case 'blank':
    case 'notLatest':
      return { kind: 'github', message: `Lo can't submit that: ${refusal.refusal}.` };
    default:
      refusal satisfies never;
      return { kind: 'github', message: "Lo can't submit that." };
  }
}

/** GitHub's refusal of a review, or Lo's while GitHub asked it to hold off, in the core's words. */
export function writeRefusal(refusal: ReviewWriteRefusal): SubmitRefusal {
  if (refusal.refusal === 'paused') return { kind: 'paused', until: refusal.until };
  return { kind: 'github', message: `${describeReviewRefusal(refusal)}.` };
}

/** Your pending review as GitHub's answer says it, as the dialog takes it. */
export function pendingRow(read: PendingReviewRead): PendingReviewRow {
  if (read.kind === 'unknown') return { kind: 'unknown' };
  const review = pendingReviewFrom(read.review);
  if (!review) return { kind: 'none' };
  return {
    kind: 'pending',
    id: review.id,
    commit: review.commit ?? null,
    comments: review.comments,
  };
}

/** A comment's first line that has text, as a line of plain words: Markdown's marks left as typed. */
export function openingOf(body: string): string {
  const line = body
    .split(/\r?\n/)
    .map((each) => each.trim())
    .find((each) => each !== '' && !each.startsWith('```'));
  return (line ?? '').slice(0, 200);
}

/** A file's name, the last part of its path. */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Where a thread is in its file, as the dialog's list says it: `new 41`, `old 30`, or on the file. */
function lineOf(thread: ThreadRow): string | null {
  if (thread.subject === 'FILE') return null;
  const line = thread.line ?? thread.originalLine;
  if (line === null) return null;
  return `${thread.side === 'RIGHT' ? 'new' : 'old'} ${line}`;
}

/** The comments of `login`'s pending review among `threads`, in the threads' order. */
export function pendingComments(threads: readonly ThreadRow[], login: string): PendingCommentRow[] {
  return threads.flatMap((thread) =>
    thread.comments.flatMap((comment, index) =>
      comment.state === 'PENDING' && sameLogin(comment.author, login)
        ? [
            {
              file: fileName(thread.path),
              line: lineOf(thread),
              reply: index > 0,
              opening: openingOf(comment.body),
            },
          ]
        : [],
    ),
  );
}

/**
 * Whether `reviews` hold the review sent with the summary `sent` at `sentAt`, by GitHub's clock, as
 * `asked`, if Lo knows: its pending review, submitted since, or one submitted no earlier than it
 * was sent, give or take {@link CLOCK_SLACK}, with that summary and verdict. Its verdict, when they
 * do, or `null` for one whose verdict Lo can't name; nothing when they don't.
 */
export function submittedAmong(
  reviews: readonly ReviewNode[],
  sent: string,
  sentAt: number,
  asked: Asked | undefined,
): { event: ReviewEvent | null } | undefined {
  const found = reviews.find((review) => {
    if (review.state === 'PENDING' || review.submittedAt === null) return false;
    if (asked?.pending !== undefined) return review.id === asked.pending;
    if (Date.parse(review.submittedAt) < sentAt - CLOCK_SLACK) return false;
    if (asked && review.state !== STATES[asked.event]) return false;
    return sent.trim() === '' || sameCommentText(review.body, sent);
  });
  return found && { event: eventOf(found.state) };
}

export class Submitter {
  readonly #options: SubmitterOptions;
  readonly #now: () => number;
  /** The views heard of, which each hear how submitting on their pull request stands. */
  readonly #views = new Set<string>();
  /** How submitting stands, by account and pull request. */
  readonly #submitting = new Map<string, Submitting>();
  /** What each send was, by account and pull request, while Lo may look for it. */
  readonly #asked = new Map<string, Asked>();
  /** The waits before looking for reviews whose answers were lost. */
  readonly #looking = new Set<ReturnType<typeof setTimeout>>();
  #stopped = false;

  constructor(options: SubmitterOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Looks for every review sent before Lo started whose answer was lost, as its summary's mark
   * says, once the wait after it was sent has passed, whatever's on screen.
   */
  resume(): void {
    for (const { login, pull, summary } of this.#options.drafts.markedSummaries()) {
      const target = { login, pull };
      if (summary.sent === null || this.#submitting.has(keyOf(target))) continue;
      this.#lost(target, summary.sent, summary.sentAt ?? summary.savedAt);
    }
  }

  /**
   * Follows view `id`, telling it how submitting on its pull request stands: as it opens, and as
   * its account or pull request changes.
   */
  follow(id: string): void {
    if (this.#stopped) return;
    const target = this.#targetOf(id);
    if (!target) {
      this.#views.delete(id);
      return;
    }
    this.#views.add(id);
    const kept = this.#options.drafts.summary(target.login, target.pull);
    this.#publish(id, this.#standing(keyOf(target), kept?.sent ?? null) ?? null, null);
  }

  /** What the submit dialog shows for view `id`. */
  async dialog(id: string): Promise<DialogView> {
    const { info, target } = this.#writing(id);
    const { login, pull } = target;
    const poller = await this.#options.poller(login);
    const details = poller.pullRequest(pull)?.details;
    if (!details) {
      throw new IpcError('refused', 'Lo hasn’t read the pull request from GitHub yet.');
    }
    const current = this.#options.reviews.current(id);
    let pending = current.review?.review;
    if (pending === undefined || pending.kind === 'loading') {
      const read =
        poller.cachedRead<PendingReviewRead>(pull, PENDING_REVIEW)?.value ??
        (await poller.pendingReview(pull))?.value;
      pending = read ? pendingRow(read) : { kind: 'unknown' };
    }
    const kept = this.#options.drafts.summary(login, pull);
    const head = details.headRefOid.toLowerCase();
    return {
      login,
      owner: info.repository.owner,
      repo: info.repository.name,
      number: info.number,
      own: sameLogin(details.author?.login, login),
      on: (this.#options.onScreen(id) ?? head).toLowerCase(),
      head,
      pending,
      comments: pendingComments(current.threads?.threads ?? [], login),
      summary: kept ? { text: kept.text, savedAt: kept.savedAt, restored: kept.restored } : null,
      submitting: this.#standing(keyOf(target), kept?.sent ?? null) ?? null,
      pausedUntil: poller.writesHeldUntil() ?? null,
    };
  }

  /** Keeps `text` as the summary on view `id`'s pull request, as typed: blank removes it. */
  draft(id: string, text: string): void {
    const { target } = this.#writing(id);
    const key = keyOf(target);
    // What's typed after it wasn't submitted says nothing more of it.
    if (this.#submitting.get(key) === 'notSubmitted') this.#settled(target, null, null);
    this.#options.drafts.saveSummary(target.login, target.pull, text);
  }

  /**
   * Submits your review of view `id`'s pull request with `event` and the summary `body`, in its
   * turn among the writes to it. Never while one is sent, or while Lo looks whether one whose
   * answer was lost was submitted; and once Lo can't tell, only `anyway`.
   */
  async submit(
    id: string,
    event: ReviewEvent,
    body: string,
    anyway: boolean,
  ): Promise<SubmitOutcome> {
    const info = this.#options.view(id);
    if (!info) throw new IpcError('missing', "There's no pull request's tab with that id.");
    if (info.run) return { kind: 'refused', refusal: { kind: 'run' } };
    const target = this.#targetOf(id);
    if (!target) return { kind: 'refused', refusal: { kind: 'signIn' } };
    const { login, pull } = target;
    const key = keyOf(target);
    const stands = this.#standing(key, this.#options.drafts.summary(login, pull)?.sent ?? null);
    if (stands === 'sending' || stands === 'checking' || (stands === 'unknown' && !anyway)) {
      return { kind: 'refused', refusal: { kind: 'busy', why: stands } };
    }
    this.#options.drafts.saveSummary(login, pull, body);
    this.#settled(target, 'sending', null);
    try {
      return await this.#options.reviews.inTurn(id, async (turn) => {
        const poller = await this.#options.poller(login);
        const details = poller.pullRequest(pull)?.details;
        if (!details) {
          this.#settled(target, null, null);
          const message = 'Lo hasn’t read the pull request from GitHub yet. Submit it once it has.';
          return { kind: 'refused', refusal: { kind: 'github', message } };
        }
        const own = sameLogin(details.author?.login, login);
        const on = (this.#options.onScreen(id) ?? details.headRefOid).toLowerCase();
        const review = yourReview(details.id, turn.review ?? { kind: 'unknown', why: 'not read' });
        const planned = review.submit(event, body, own, on, details.headRefOid);
        if ('refusal' in planned) {
          this.#settled(target, null, null);
          return { kind: 'refused', refusal: planRefusal(planned) };
        }
        // From here it may be on GitHub, until GitHub says otherwise: a restart keeps that.
        const sentAt = this.#now();
        this.#options.drafts.markSummarySent(login, pull, body, sentAt);
        this.#asked.set(key, { event, pending: review.pending?.id });
        let sent;
        try {
          sent = await turn.send(planned);
        } catch (error) {
          if (!(error instanceof GithubError) || !error.mayHavePosted()) throw error;
          this.#lost(target, body, sentAt);
          return { kind: 'lost' };
        }
        if ('refusal' in sent) {
          this.#unsent(target);
          return { kind: 'refused', refusal: writeRefusal(sent) };
        }
        this.#submitted(target, body, event);
        return { kind: 'submitted', event };
      });
    } catch (error) {
      // It didn't go: anything that may have came back as lost.
      this.#options.log(`submitting a review: ${describe(error)}`);
      this.#unsent(target);
      if (error instanceof IpcError) throw error;
      return { kind: 'refused', refusal: { kind: 'github', message: describe(error) } };
    }
  }

  /** Sends nothing more, looks for nothing more, and tells nothing more. */
  stop(): void {
    this.#stopped = true;
    for (const timer of this.#looking) clearTimeout(timer);
    this.#looking.clear();
  }

  /** The review sent with the summary `sent` was submitted: the summary goes, unless it changed. */
  #submitted(target: Target, sent: string, event: ReviewEvent | null): void {
    const { login, pull } = target;
    const kept = this.#options.drafts.summary(login, pull);
    if (kept && sameCommentText(kept.text, sent)) this.#options.drafts.takeSummary(login, pull);
    else this.#options.drafts.markSummarySent(login, pull, null, this.#now());
    this.#asked.delete(keyOf(target));
    this.#settled(target, null, { event });
  }

  /** The review wasn't submitted: the summary stays, as it is. */
  #unsent(target: Target): void {
    this.#options.drafts.markSummarySent(target.login, target.pull, null, this.#now());
    this.#asked.delete(keyOf(target));
    this.#settled(target, null, null);
  }

  /**
   * GitHub's answer to the review sent with the summary `sent`, at `sentAt` by this computer's
   * clock, was lost: the summary stays marked sent, and submitting is `checking` until Lo knows.
   * Once the wait after it was sent has passed, Lo reads your reviews afresh, then, and looks for
   * it. When the read can't be made, as while offline, it stays `checking` and Lo tries again in a
   * while.
   */
  #lost(target: Target, sent: string, sentAt: number): void {
    const { login, pull } = target;
    const settleAfter = this.#options.settleAfter ?? SETTLE_AFTER;
    const retryAfter = this.#options.retryAfter ?? RETRY_AFTER;
    this.#settled(target, 'checking', null);
    // Settled, or sent again, meanwhile: what's found says nothing of it.
    const still = () =>
      !this.#stopped && this.#options.drafts.summary(login, pull)?.sentAt === sentAt;
    const look = async (): Promise<void> => {
      if (!still()) return;
      let read: ReviewsRead;
      try {
        read = await this.#options.readReviews(login, pull);
      } catch (error) {
        if (!still()) return;
        if (!(error instanceof GithubError) || error.isWaitable()) {
          later(retryAfter);
          return;
        }
        this.#options.log(`looking whether a review was submitted: ${describe(error)}`);
        this.#settled(target, 'unknown', null);
        return;
      }
      if (!still()) return;
      // When it was sent, by GitHub's clock.
      const sentThere = sentAt + (read.ahead ?? 0);
      const found = submittedAmong(read.reviews, sent, sentThere, this.#asked.get(keyOf(target)));
      if (found) {
        this.#submitted(target, sent, found.event);
        return;
      }
      this.#options.drafts.markSummarySent(login, pull, null, this.#now());
      this.#asked.delete(keyOf(target));
      this.#settled(target, 'notSubmitted', null);
    };
    const later = (wait: number): void => {
      if (this.#stopped) return;
      const timer = setTimeout(() => {
        this.#looking.delete(timer);
        look().catch((error: unknown) => {
          this.#options.log(`looking whether a review was submitted: ${describe(error)}`);
          if (still()) this.#settled(target, 'unknown', null);
        });
      }, wait);
      this.#looking.add(timer);
    };
    later(Math.max(0, sentAt + settleAfter - this.#now()));
  }

  /**
   * How submitting stands at `key`, the summary marked sent with `sent` if it is: as Lo is
   * sending it, or, for one marked sent before Lo started, `checking` until a read settles it.
   */
  #standing(key: string, sent: string | null): Submitting | undefined {
    return this.#submitting.get(key) ?? (sent === null ? undefined : 'checking');
  }

  /** Submitting on `target` stands as `now`, or not at all, and `submitted` was, if anything. */
  #settled(target: Target, now: Submitting | null, submitted: Submission['submitted']): void {
    const key = keyOf(target);
    if (now === null) this.#submitting.delete(key);
    else this.#submitting.set(key, now);
    for (const id of this.#views) {
      const other = this.#targetOf(id);
      if (other && keyOf(other) === key) this.#publish(id, now, submitted);
    }
  }

  #publish(id: string, state: Submitting | null, submitted: Submission['submitted']): void {
    const number = this.#options.view(id)?.number;
    if (this.#stopped || number === undefined) return;
    try {
      this.#options.publish({ id, number, state, submitted });
    } catch (error) {
      this.#options.log(`telling how a review stands: ${describe(error)}`);
    }
  }

  /** The account and pull request view `id` submits as and on, if it can. */
  #targetOf(id: string): Target | undefined {
    const info = this.#options.view(id);
    if (info?.acting?.kind !== 'account' || info.run) return undefined;
    const { owner, name } = info.repository;
    return { login: info.acting.login, pull: new PullRef(owner, name, info.number) };
  }

  /** View `id` and what it submits as and on, or the refusal of one that can't. */
  #writing(id: string): { info: PullTabInfo; target: Target } {
    const info = this.#options.view(id);
    if (!info) throw new IpcError('missing', "There's no pull request's tab with that id.");
    if (info.run) throw new IpcError('refused', IN_A_LAYER);
    const target = this.#targetOf(id);
    if (!target) throw new IpcError('refused', SIGN_IN);
    return { info, target };
  }
}

/** What submitting is kept by: an account's, on a pull request. */
function keyOf({ login, pull }: Target): string {
  return `${login.toLowerCase()}|${pull.key}`;
}
