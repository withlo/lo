// What the comments feature offers the others in main: posts' HTML, as GitHub renders it, read on
// demand for a view of a pull request's tab; each view's threads and your pending review, as read,
// and a turn among the writes to its pull request, for submitting a review; and the submit
// dialog's summary, kept as a draft like any comment box's.

import type {
  PendingReviewRead,
  PullRef,
  RenderedBodies,
  ReviewWrite,
  ReviewWriteRefusal,
  Sent,
} from '@lo/github';

import { defineService } from '../../main/services.ts';
import type { ReviewView, ThreadsView } from './contract.ts';

/** What to read besides the posts. */
export interface BodiesOptions {
  /** Whether to read the description's HTML too. */
  readonly description: boolean;
}

/**
 * The HTML GitHub renders for posts, read for the posts someone is waiting on and never kept: its
 * images' addresses are signed for a few minutes, so every read brings new ones.
 */
export interface BodiesService {
  /**
   * The HTML of the posts on view `id`'s pull request named by `posts`, by node ID, and of its
   * description when asked, read as the view's account, 100 posts a request, each at the front of
   * the account's queue. Throws an `IpcError`: `missing` for no such view, `refused` for one that
   * acts as nobody, has no account yet, or shows a run of a stack's layers, and `failed` when
   * GitHub couldn't be read.
   */
  read(id: string, posts: readonly string[], options: BodiesOptions): Promise<RenderedBodies>;
}

export const bodies = defineService<BodiesService>('comments.bodies');

/**
 * A write's turn on a pull request: its account, the pull request, and your pending review as read
 * after the last write's answer.
 */
export interface WriteTurn {
  readonly login: string;
  readonly pull: PullRef;
  /** Your pending review, or nothing when it couldn't be read. */
  readonly review: PendingReviewRead | undefined;
  /**
   * Sends `write` through the account's poller (`sendReview`), so the next write plans from your
   * pending review as read after its answer.
   */
  send(write: ReviewWrite): Promise<Sent | ReviewWriteRefusal>;
}

/** Each view's threads and your pending review, and the writes to its pull request. */
export interface ReviewsService {
  /** View `id`'s threads and your pending review as main last read them: nothing for one it doesn't follow. */
  current(id: string): { threads: ThreadsView | undefined; review: ReviewView | undefined };
  /**
   * Runs `write` as the next write to view `id`'s pull request, as its account, once the last one
   * has its answer: one write to a pull request goes at a time, comments and reviews alike. Throws
   * an `IpcError`: `missing` for no such view, `refused` for one that acts as nobody or shows a run
   * of a stack's layers.
   */
  inTurn<T>(id: string, write: (turn: WriteTurn) => Promise<T>): Promise<T>;
}

export const reviews = defineService<ReviewsService>('comments.reviews');

/** The submit dialog's summary, as main keeps it. */
export interface SummaryDraft {
  readonly text: string;
  /** When it was last saved, in milliseconds since the Unix epoch. */
  readonly savedAt: number;
  /** Whether it was saved before Lo started. */
  readonly restored: boolean;
  /**
   * The summary sent, from when Lo submits the review until GitHub answers, or, when the answer was
   * lost, until Lo knows whether it was submitted: it may be on GitHub.
   */
  readonly sent: string | null;
  /** When it was sent, while it's marked sent. */
  readonly sentAt: number | null;
}

/**
 * The submit dialog's summary on each pull request, for each account, kept on this computer as
 * comment boxes' drafts are, with the mark of a review sent.
 */
export interface DraftsService {
  /** `login`'s summary on `pull`, if there is one. */
  summary(login: string, pull: PullRef): SummaryDraft | undefined;
  /** Keeps `text` as the summary: blank text removes it, unless it's marked sent. */
  saveSummary(login: string, pull: PullRef, text: string): void;
  /**
   * Marks the summary sent, `sent` the text sent, at `at`, even a blank one, so the mark outlasts
   * a restart; `null` settles it.
   */
  markSummarySent(login: string, pull: PullRef, sent: string | null, at: number): void;
  /** Removes the summary, once its review is submitted. */
  takeSummary(login: string, pull: PullRef): void;
  /** Every summary marked sent, by its account and pull request, as after a restart. */
  markedSummaries(): { login: string; pull: PullRef; summary: SummaryDraft }[];
}

export const drafts = defineService<DraftsService>('comments.drafts');
