// Each view's review threads and your pending review, in main: read through the account's poller,
// which keeps them, once the view has been on screen, and followed as the poller reads them again,
// as the revisions follow the push history. A first read that can't be answered, because GitHub
// can't be reached, the account is signed out or the rate limit holds every read, fails with why,
// so the window isn't left waiting for it. The poller reads them again only for the pull request
// on screen, so a hidden view keeps what it had and catches up once it's shown. A view that acts as
// nobody, or shows a run of a stack's layers, reads none. With them goes the comparison of
// revisions the view shows, which says where its threads are. Nothing here calls Electron.

import {
  type Cached,
  GithubError,
  PENDING_REVIEW,
  type PendingReviewRead,
  type PollEvent,
  type Poller,
  type PollStatus,
  PullRef,
  type ReadKind,
  type ReadPriority,
  REVIEW_THREADS,
  type ReviewThreadList,
} from '@lo/github';
import { pendingReviewFrom, threadFromGithub } from '@lo/review';

import type { PullTabInfo } from '../../tab/service.ts';
import {
  BODY_LIMIT,
  type Compared,
  type PendingReviewRow,
  type ReviewView,
  type ThreadRow,
  type ThreadsView,
} from '../contract.ts';

/** What the threads use of an account's poller: its two reads, its events and its status. */
export interface ThreadsPoller extends Pick<
  Poller,
  'reviewThreads' | 'pendingReview' | 'onEvent' | 'onChange' | 'status'
> {
  cachedRead<T>(pull: PullRef, kind: ReadKind<T>): Cached<T> | undefined;
}

export interface ThreadReadsOptions {
  /** The poller of each account, as the accounts feature provides it. */
  readonly poller: (login: string) => Promise<ThreadsPoller>;
  /** What main has of a view now, or nothing once it's closed. */
  readonly view: (id: string) => PullTabInfo | undefined;
  /** The view on screen, if a pull request's is. */
  readonly onScreen: () => string | undefined;
  /** The comparison of revisions a view shows, if it shows one. */
  readonly compared: (id: string) => Compared | null;
  readonly publishThreads: (view: ThreadsView) => void;
  readonly publishReview: (view: ReviewView) => void;
  readonly log: (line: string) => void;
}

/** A view followed: whose and which pull request, and what's been read of it. */
interface Followed {
  readonly id: string;
  readonly pull: PullRef;
  /** The account it reads as, once it acts as one. */
  readonly login: string | undefined;
  readonly run: boolean;
  /** Whether its reads have been asked for: once, the first time it's on screen. */
  started: boolean;
  poller: ThreadsPoller | undefined;
  stop: (() => void) | undefined;
  /** The poller's values last taken, so the same value isn't sent again. */
  threadsRead: ReviewThreadList | undefined;
  reviewRead: PendingReviewRead | undefined;
  threads: ThreadsView;
  review: ReviewView;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether two logins name one account: GitHub's ignore case. */
function sameLogin(a: string | undefined, b: string | undefined): boolean {
  return a?.toLowerCase() === b?.toLowerCase();
}

/** Whether two comparisons are the same, or both none. */
function sameCompared(a: Compared | null, b: Compared | null): boolean {
  return a?.key === b?.key && a?.from === b?.from && a?.replayed === b?.replayed;
}

/**
 * Why no read can be answered now, as `status` says: GitHub can't be reached, the account is signed
 * out, or the rate limit holds every read. Nothing when reads go on.
 */
export function stallOf(status: PollStatus): string | undefined {
  if (status.signedOut) return 'The account is signed out of GitHub.';
  if (status.offline) return `GitHub can’t be reached: ${status.offline.error}`;
  if (status.rateLimit.kind === 'paused') {
    return `GitHub’s rate limit holds every read until ${new Date(status.rateLimit.until).toISOString()}.`;
  }
  return undefined;
}

/** The longest path a thread may be on and still be sent: none of the diff's is longer. */
const PATH_LIMIT = 4096;

/**
 * The threads GitHub gave, as the window takes them: those on a path longer than any file the diff
 * shows left out, and what GitHub says of a comment cut to what the window takes.
 */
export function threadRows(list: ReviewThreadList): ThreadRow[] {
  return list.nodes.flatMap((node) => {
    if (node.path.length > PATH_LIMIT) return [];
    const types = new Map<string, string>();
    for (const comment of node.comments.nodes ?? []) {
      if (!comment?.author) continue;
      const { __typename: type } = comment.author;
      types.set(comment.id, type);
    }
    const thread = threadFromGithub(node);
    const row: ThreadRow = {
      id: thread.id,
      path: thread.path,
      subject: thread.subject,
      side: thread.side,
      startSide: thread.startSide ?? null,
      line: thread.line ?? null,
      startLine: thread.startLine ?? null,
      originalLine: thread.originalLine ?? null,
      originalStartLine: thread.originalStartLine ?? null,
      outdated: thread.outdated,
      resolved: thread.resolved,
      currentOn: thread.currentOn ?? null,
      writtenOn: thread.writtenOn ?? null,
      comments: thread.comments.map((comment) => ({
        id: comment.id,
        author: comment.author ?? null,
        authorType: types.get(comment.id)?.slice(0, 64) ?? null,
        body: comment.body.slice(0, BODY_LIMIT),
        state: comment.state,
        createdAt: comment.createdAt.slice(0, 64),
        url: comment.url.slice(0, 2048),
        hidden: comment.hidden?.slice(0, 64) ?? null,
        viewerCanUpdate: comment.viewerCanUpdate,
        viewerCanDelete: comment.viewerCanDelete,
      })),
      viewerCanReply: thread.viewerCanReply,
      viewerCanResolve: thread.viewerCanResolve,
      viewerCanUnresolve: thread.viewerCanUnresolve,
    };
    return [row];
  });
}

/** Your pending review as GitHub's answer says it, as the window takes it. */
export function reviewRow(read: PendingReviewRead): PendingReviewRow {
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

export class ThreadReads {
  readonly #options: ThreadReadsOptions;
  readonly #views = new Map<string, Followed>();
  #stopped = false;

  constructor(options: ThreadReadsOptions) {
    this.#options = options;
  }

  /**
   * Follows view `id` as it is now: a new pull request or account starts it afresh, and once it's
   * on screen with the head GitHub gave, its reads are asked for. A closed view is let go.
   */
  follow(id: string): void {
    if (this.#stopped) return;
    const info = this.#options.view(id);
    if (!info) {
      this.#drop(id);
      return;
    }
    const login = info.acting?.kind === 'account' ? info.acting.login : undefined;
    const pull = new PullRef(info.repository.owner, info.repository.name, info.number);
    const run = info.run !== undefined;
    let followed = this.#views.get(id);
    if (
      !followed ||
      followed.pull.key !== pull.key ||
      !sameLogin(followed.login, login) ||
      followed.run !== run
    ) {
      followed?.stop?.();
      followed = this.#fresh(id, pull, login, run);
      this.#views.set(id, followed);
      this.#sendThreads(followed);
      this.#sendReview(followed);
    }
    const status = run ? 'run' : info.acting?.kind === 'anonymous' ? 'signIn' : undefined;
    if (status && followed.threads.status !== status) {
      followed.threads = { ...followed.threads, status, threads: [], missing: 0, problem: null };
      this.#sendThreads(followed);
    }
    this.compared(id);
    // Read for the first time once it's on screen at the head GitHub gave: a pull request GitHub
    // never answered for has nothing to read.
    if (
      login !== undefined &&
      !run &&
      !followed.started &&
      info.shown !== undefined &&
      this.#options.onScreen() === id
    ) {
      followed.started = true;
      void this.#watch(followed, login);
    }
  }

  /** The comparison view `id` shows may have changed: its threads say so if it did. */
  compared(id: string): void {
    const followed = this.#views.get(id);
    if (!followed || followed.run) return;
    const now = this.#options.compared(id);
    if (sameCompared(now, followed.threads.compared)) return;
    followed.threads = { ...followed.threads, compared: now };
    this.#sendThreads(followed);
  }

  /** What's held of view `id`'s threads and pending review now. */
  current(id: string): { threads: ThreadsView | undefined; review: ReviewView | undefined } {
    const followed = this.#views.get(id);
    return { threads: followed?.threads, review: followed?.review };
  }

  /** Follows nothing more, and sends nothing more. */
  stop(): void {
    this.#stopped = true;
    for (const followed of this.#views.values()) followed.stop?.();
    this.#views.clear();
  }

  #fresh(id: string, pull: PullRef, login: string | undefined, run: boolean): Followed {
    return {
      id,
      pull,
      login,
      run,
      started: false,
      poller: undefined,
      stop: undefined,
      threadsRead: undefined,
      reviewRead: undefined,
      threads: {
        id,
        status: run ? 'run' : 'loading',
        threads: [],
        missing: 0,
        compared: null,
        problem: null,
      },
      review: { id, review: { kind: 'loading' } },
    };
  }

  #drop(id: string): void {
    this.#views.get(id)?.stop?.();
    this.#views.delete(id);
  }

  /** Whether `followed` is still what view `id` is followed as. */
  #current(followed: Followed): boolean {
    return !this.#stopped && this.#views.get(followed.id) === followed;
  }

  async #watch(followed: Followed, login: string): Promise<void> {
    let poller: ThreadsPoller;
    try {
      poller = await this.#options.poller(login);
    } catch (error) {
      if (this.#current(followed)) this.#fail(followed, describe(error));
      return;
    }
    if (!this.#current(followed)) return;
    followed.poller = poller;
    const events = poller.onEvent((event) => this.#heard(followed, poller, event));
    const changes = poller.onChange(() => this.#stalled(followed, poller));
    followed.stop = () => {
      events();
      changes();
    };
    const { pull } = followed;
    // The diff's first draw waits on the first read of the view's threads while it's on screen, so
    // that read goes ahead of polls and of the tab's other reads in the account's queue.
    const waiting = (): ReadPriority =>
      this.#current(followed) && this.#options.onScreen() === followed.id
        ? 'foreground'
        : 'background';
    const [threads, review] = await Promise.allSettled([
      poller.reviewThreads(pull, waiting),
      poller.pendingReview(pull),
    ]);
    if (!this.#current(followed)) return;
    if (threads.status === 'rejected') this.#fail(followed, describe(threads.reason));
    else if (threads.value) this.#takeThreads(followed, threads.value.value);
    if (review.status === 'rejected') {
      this.#options.log(`reading the pending review: ${describe(review.reason)}`);
    } else if (review.value) this.#takeReview(followed, review.value.value);
    this.#stalled(followed, poller);
  }

  /**
   * Ends the wait for a view's first read when the poller can't answer it now: it fails with why,
   * and the threads come once a read does.
   */
  #stalled(followed: Followed, poller: ThreadsPoller): void {
    if (!this.#current(followed) || followed.poller !== poller) return;
    if (followed.threadsRead || followed.threads.status !== 'loading') return;
    const why = stallOf(poller.status());
    if (why !== undefined) this.#fail(followed, why);
  }

  #heard(followed: Followed, poller: ThreadsPoller, event: PollEvent): void {
    if (!this.#current(followed) || followed.poller !== poller) return;
    switch (event.kind) {
      case 'read':
      case 'confirmed': {
        if (!event.pull.equals(followed.pull)) return;
        if (event.name === REVIEW_THREADS.name) {
          const cached = poller.cachedRead(followed.pull, REVIEW_THREADS);
          if (cached) this.#takeThreads(followed, cached.value);
        } else if (event.name === PENDING_REVIEW.name) {
          const cached = poller.cachedRead(followed.pull, PENDING_REVIEW);
          if (cached) this.#takeReview(followed, cached.value);
        }
        return;
      }
      case 'readFailed':
        if (!event.pull.equals(followed.pull) || event.name !== REVIEW_THREADS.name) return;
        // What was read before stays: it's only not current.
        if (!followed.threadsRead) this.#fail(followed, new GithubError(event.error).message);
        return;
      case 'summary':
      case 'check':
      case 'details':
      case 'openPullRequests':
      case 'trunkRules':
      case 'failed':
        return;
      default:
        event satisfies never;
    }
  }

  #takeThreads(followed: Followed, list: ReviewThreadList): void {
    if (followed.threadsRead === list) return;
    followed.threadsRead = list;
    followed.threads = {
      ...followed.threads,
      status: 'ready',
      threads: threadRows(list),
      missing: list.missing,
      problem: null,
    };
    this.#sendThreads(followed);
  }

  #takeReview(followed: Followed, read: PendingReviewRead): void {
    if (followed.reviewRead === read) return;
    followed.reviewRead = read;
    followed.review = { id: followed.id, review: reviewRow(read) };
    this.#sendReview(followed);
  }

  #fail(followed: Followed, problem: string): void {
    this.#options.log(`${followed.pull.toString()}: ${problem}`);
    followed.threads = { ...followed.threads, status: 'failed', problem: problem.slice(0, 4096) };
    this.#sendThreads(followed);
  }

  #sendThreads(followed: Followed): void {
    try {
      this.#options.publishThreads(followed.threads);
    } catch (error) {
      this.#options.log(`sending the threads: ${describe(error)}`);
    }
  }

  #sendReview(followed: Followed): void {
    try {
      this.#options.publishReview(followed.review);
    } catch (error) {
      this.#options.log(`sending the pending review: ${describe(error)}`);
    }
  }
}
