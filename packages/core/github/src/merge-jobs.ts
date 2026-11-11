/**
 * Async merges, followed until GitHub says how each ended (`docs/design.md`, "Stacks", and "Async
 * merge fails" under "Errors and edge cases").
 *
 * GitHub runs a merge it took in the background, and answers how it's going when asked about its
 * UUID. {@link MergeJobs} asks 1 s after GitHub took it, then doubles the wait after each answer that
 * it's still pending, up to every 10 s, and stops after 10 minutes, saying it doesn't know how the
 * merge ended. A rate limit makes it wait until GitHub says. A merge into a queue ends when it's in
 * the queue.
 *
 * It's one for the whole app, not part of a tab, so a merge goes on being followed when the tab that
 * started it closes, and a tab that opens the pull request again finds it. Each pull request has at
 * most one job at a time. {@link MergeJobs.stop} ends them all, as when Lo quits.
 *
 * The merge itself is a write, sent once ({@link GithubError.mayHavePosted}): when its answer is
 * lost, the job ends not knowing (`noAnswer`) rather than sending it again. Asking how it's going is
 * a read, so a failure waiting may fix, such as the network or a token that can't be read now, is
 * asked again at the next wait. GitHub can answer `failed` for a merge that landed, so before a job
 * ends that way, it reads the pull request, and for a stack the stack, once. When a job ends, its
 * pull request and repository are read again, whatever the outcome.
 */

import type { GithubClient } from './client.ts';
import { GithubError, MAX_RETRY_AFTER, type GithubErrorDetail } from './errors.ts';
import {
  isMerged,
  isRefusal,
  isStackMerge,
  mergedState,
  mergeRefusalFrom,
  stacksHolding,
  statusName,
  type AsyncMerge,
  type AsyncMergeDetails,
  type MergeRefusal,
  type MergeRequest,
  type Submitted,
} from './merge-writes.ts';
import type { PullRef, Target } from './refs.ts';

/** How a job asks GitHub how its merge is going. Times are milliseconds. */
export interface JobConfig {
  /** The wait before the first time, after GitHub took the merge. */
  firstWait: number;
  /** The longest wait: each answer that the merge is still pending doubles the wait up to this. */
  maxWait: number;
  /**
   * How long a job follows a merge GitHub keeps pending before it stops (`stillPending`).
   * `github/gh-stack` gives up after 10 minutes too. A rate limit that lasts past it stops it too.
   */
  followFor: number;
  /** Wall-clock time, in milliseconds since the Unix epoch, for when a rate limit resets. */
  now: () => number;
  /** A clock that only moves forward, for how long a job has followed its merge. */
  monotonic: () => number;
}

/** How long GitHub asks to wait after a secondary rate limit that doesn't say: at least a minute. */
const SECONDARY_WAIT = 60_000;

/**
 * What a job needs of the account's poller: `Poller` is one. A request given up on through `signal`
 * while it waits for its turn is never made.
 */
export interface MergePoller {
  readonly login: string;
  mergeAsync(
    pull: PullRef,
    request: MergeRequest,
    signal?: AbortSignal,
  ): Promise<Submitted | MergeRefusal>;
  mergeAsyncResult(pull: PullRef, uuid: string, signal?: AbortSignal): Promise<AsyncMerge>;
  readOnce<T>(request: (client: GithubClient) => Promise<T>, signal?: AbortSignal): Promise<T>;
  changed(target: Target): Promise<void>;
}

/** Where a job stands. */
export type JobState =
  /** Lo is sending the merge. */
  | { kind: 'sending' }
  /**
   * GitHub took it and is running it: Lo asks again after a wait. `trouble` is why the last time Lo
   * asked got no answer, when waiting may fix it, such as the network or a rate limit.
   */
  | { kind: 'pending'; trouble: GithubErrorDetail | undefined }
  /** It ended. */
  | { kind: 'done'; outcome: Outcome };

/** How a job ended. */
export type Outcome =
  /**
   * It merged, as the commit `sha` when GitHub names it: "already merged" answers name it too.
   * `githubSaid` is GitHub's message when it answered `failed` though the pull request reads merged.
   */
  | { kind: 'merged'; sha: string | undefined; githubSaid: string | undefined }
  /** It's in the merge queue, which merges it later, or takes it out. GitHub's answer doesn't follow the queue. */
  | { kind: 'enqueued' }
  /**
   * GitHub ran it, and it didn't merge: GitHub's `message`, and what Lo makes of it. The base
   * branch's rules are checked only then. `landed` is what Lo read afterwards of the layers below,
   * for a stack's merge: the ones that merged anyway, bottom to top. Empty for any other merge, and
   * nothing when Lo couldn't read them.
   */
  | { kind: 'failed'; message: string; why: MergeRefusal; landed: number[] | undefined }
  /**
   * GitHub was already running another merge of the pull request (a `409`), which Lo followed
   * instead of starting one: `running` is what GitHub said of it, and `ended` how it ended. It may
   * have merged another head than the one on screen, or with another method.
   */
  | { kind: 'alreadyRunning'; running: AsyncMergeDetails; ended: Outcome }
  /**
   * GitHub refused it before running it, such as a draft, a closed pull request, or a head that
   * moved, or Lo did, such as for a stack's layer that moved, or it couldn't be asked, such as for a
   * signed-out account. Nothing was done.
   */
  | { kind: 'refused'; why: MergeRefusal | GithubErrorDetail }
  /** Lo doesn't know whether it merged. The pull request is read again, which shows whether it did. */
  | { kind: 'unknown'; unknown: Unknown };

/** Why Lo doesn't know how a merge ended. */
export type Unknown =
  /**
   * The merge may have reached GitHub, but its answer didn't reach Lo: the connection was lost, the
   * request timed out, or GitHub's server failed. Lo doesn't send it again.
   */
  | { kind: 'noAnswer'; error: GithubErrorDetail }
  /**
   * GitHub took the merge, but no longer answers about it, in a way waiting won't fix: it forgot the
   * UUID ("not found", which it says 24 hours after a merge's last change), or refused to say.
   */
  | { kind: 'lost'; error: GithubErrorDetail }
  /** It was still pending when Lo stopped asking ({@link JobConfig.followFor}). */
  | { kind: 'stillPending' }
  /**
   * The jobs were stopped before it ended ({@link MergeJobs.stop}). A merge not sent by then never
   * is; one sent may have been taken, and Lo asks nothing more about it.
   */
  | { kind: 'stopped' }
  /** GitHub answered a status Lo doesn't know, which is never read as merged. */
  | { kind: 'status'; status: string };

/** Whether Lo can ask again how it went: it doesn't know, and GitHub may still answer. */
function resumable(outcome: Outcome): boolean {
  if (outcome.kind === 'alreadyRunning') return resumable(outcome.ended);
  return outcome.kind === 'unknown' && outcome.unknown.kind !== 'noAnswer';
}

/** An async merge Lo started, and where it stands, as plain data. */
export interface Job {
  /** The pull request it merges. */
  pull: { owner: string; name: string; number: number };
  /** The account it merges as. */
  login: string;
  /** What Lo asked for. */
  request: MergeRequest;
  state: JobState;
  /**
   * The UUID GitHub gave the merge, once it took it: this request's, or after a `409` the one GitHub
   * was already running for the pull request. Kept for any answer that gave one, so
   * {@link MergeJobs.followAgain} can ask about it.
   */
  uuid: string | undefined;
  /**
   * When GitHub answered `409`, what it said of the merge it was already running, from Lo or from
   * elsewhere: the head, method and way that merge asked for, which may not be `request`'s. Kept for
   * good, since answers once it's ended don't say, and its ending is reported as that merge's.
   */
  running: AsyncMergeDetails | undefined;
  /** GitHub's latest answer about it. */
  answer: AsyncMerge | undefined;
  /** How many times Lo asked how it's going. */
  polls: number;
}

/** Whether a job is still going: being sent, pending, or being checked after GitHub said it failed. */
export function isRunning(job: Job): boolean {
  return job.state.kind !== 'done';
}

/** A job changed: it was started, GitHub answered about it, or it ended. */
export interface JobChanged {
  pull: PullRef;
  /** Whether it has ended. */
  done: boolean;
}

interface Held {
  pullRef: PullRef;
  job: Job;
  poller: MergePoller;
}

/** What to do after GitHub's answer: ask again, after the next wait and at least `atLeast` from now, or end. */
type Next = { kind: 'ask'; atLeast: number | undefined } | { kind: 'end'; outcome: Outcome };

/** The async merges Lo started, by pull request. */
export class MergeJobs {
  readonly #config: JobConfig;
  readonly #jobs = new Map<string, Held>();
  readonly #listeners = new Set<(changed: JobChanged) => void>();
  /** Aborted by {@link MergeJobs.stop}: gives up every wait, and every request still waiting for its turn. */
  readonly #stopping = new AbortController();

  constructor(config: Partial<JobConfig> = {}) {
    this.#config = {
      firstWait: 1000,
      maxWait: 10_000,
      followFor: 10 * 60_000,
      now: () => Date.now(),
      monotonic: () => performance.now(),
      ...config,
    };
  }

  /** Calls `listener` each time a job changes, until the returned function is called. */
  onChange(listener: (changed: JobChanged) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The job for `pull`, running or ended, until it's forgotten. */
  job(pull: PullRef): Job | undefined {
    const held = this.#jobs.get(pull.key);
    return held && structuredClone(held.job);
  }

  /** Every job, running or ended, as plain data. */
  list(): Job[] {
    return [...this.#jobs.values()].map((held) => structuredClone(held.job));
  }

  /**
   * Asks GitHub to merge `pull` as `request` says, as `poller`'s account, in its queue, and follows
   * the merge until it ends. Refused while a job for `pull` is running, and once the jobs are
   * stopped; an ended one is replaced.
   */
  merge(
    poller: MergePoller,
    pull: PullRef,
    request: MergeRequest,
  ): undefined | { refusal: 'alreadyMerging' } | { refusal: 'stopped' } {
    if (this.#stopping.signal.aborted) return { refusal: 'stopped' };
    const known = this.#jobs.get(pull.key);
    if (known && isRunning(known.job)) return { refusal: 'alreadyMerging' };
    const held: Held = {
      pullRef: pull,
      poller,
      job: {
        pull: { owner: pull.repo.owner, name: pull.repo.name, number: pull.number },
        login: poller.login,
        request,
        state: { kind: 'sending' },
        uuid: undefined,
        running: undefined,
        answer: undefined,
        polls: 0,
      },
    };
    this.#jobs.set(pull.key, held);
    this.#emit(pull, false);
    void this.#follow(held, request);
    return undefined;
  }

  /**
   * Asks GitHub again about a merge Lo stopped following without knowing how it ended: it was still
   * pending, GitHub didn't answer about it, or answered a status Lo doesn't know. A read, never the
   * merge sent again. Answers whether it did: only a job that ended that way, with a UUID, can, and
   * only until the jobs are stopped.
   */
  followAgain(pull: PullRef): boolean {
    if (this.#stopping.signal.aborted) return false;
    const held = this.#jobs.get(pull.key);
    const state = held?.job.state;
    if (!held || state?.kind !== 'done' || !resumable(state.outcome) || !held.job.uuid)
      return false;
    held.job.state = { kind: 'pending', trouble: undefined };
    this.#emit(pull, false);
    void this.#follow(held, undefined);
    return true;
  }

  /** Forgets the job for `pull` once it has ended, as when the UI has shown how. A running job isn't forgotten. Answers whether it was. */
  forget(pull: PullRef): boolean {
    const held = this.#jobs.get(pull.key);
    if (!held || isRunning(held.job)) return false;
    this.#jobs.delete(pull.key);
    return true;
  }

  /**
   * Stops following merges, as when Lo quits: every running job ends at once as `stopped`, and its
   * pull request and repository are read again, as after any job. Nothing more is sent or asked: a
   * merge not yet sent never is, whether it waits for its turn in the account's queue, through the
   * second between writes, or between its stack lookup and the merge itself, and every wait ends
   * now. A request already sent finishes, as a poller's write does once it's sent, and its answer is
   * dropped. Jobs that ended stay readable, and no merge starts after this.
   */
  stop(): void {
    if (this.#stopping.signal.aborted) return;
    // First, so a listener that hears a job end can't start another.
    this.#stopping.abort(new Error('Lo stopped following merges'));
    for (const held of this.#jobs.values()) {
      if (!isRunning(held.job)) continue;
      this.#finish(held, { kind: 'unknown', unknown: { kind: 'stopped' } });
      void Promise.all([held.poller.changed(held.pullRef), held.poller.changed(held.pullRef.repo)]);
    }
  }

  #emit(pull: PullRef, done: boolean): void {
    for (const listener of this.#listeners) listener({ pull, done });
  }

  /** Whether `held` is still `pull`'s job, and still running: not ended, by stopping or otherwise. */
  #current(held: Held): boolean {
    return this.#jobs.get(held.pullRef.key) === held && isRunning(held.job);
  }

  /**
   * Sends `request`, if any, then asks about the merge until it ends, checks a `failed` answer
   * against the pull request, and ends the job.
   */
  async #follow(held: Held, request: MergeRequest | undefined): Promise<void> {
    const { poller, pullRef: pull } = held;
    const { signal } = this.#stopping;
    let ending: Outcome | undefined;
    if (request) {
      let submitted: { ok: true; value: Submitted | MergeRefusal } | { ok: false; error: unknown };
      try {
        submitted = { ok: true, value: await poller.mergeAsync(pull, request, signal) };
      } catch (error) {
        submitted = { ok: false, error };
      }
      if (!this.#current(held)) return;
      const next = this.#sent(held, submitted);
      if (next.kind === 'end') ending = next.outcome;
    }
    ending ??= await this.#followUntilDone(held);
    if (ending === undefined) return;
    if (ending.kind === 'failed') {
      ending = await checkFailed(poller, pull, isStackMerge(held.job.request), ending, signal);
    }
    if (!this.#current(held)) return;
    this.#finish(held, ending);
    await Promise.all([poller.changed(pull), poller.changed(pull.repo)]);
  }

  /** Takes in GitHub's answer to sending the merge. */
  #sent(
    held: Held,
    submitted: { ok: true; value: Submitted | MergeRefusal } | { ok: false; error: unknown },
  ): Next {
    const { job } = held;
    let next: Next;
    if (!submitted.ok) {
      const detail = detailOf(submitted.error);
      next =
        submitted.error instanceof GithubError && submitted.error.mayHavePosted()
          ? {
              kind: 'end',
              outcome: { kind: 'unknown', unknown: { kind: 'noAnswer', error: detail } },
            }
          : { kind: 'end', outcome: { kind: 'refused', why: detail } };
    } else if (isRefusal(submitted.value)) {
      next = { kind: 'end', outcome: { kind: 'refused', why: submitted.value } };
    } else {
      const answer = submitted.value;
      switch (answer.kind) {
        case 'accepted':
          job.uuid = answer.uuid;
          job.answer = answer.answer;
          next = { kind: 'ask', atLeast: undefined };
          break;
        case 'alreadyRunning':
          job.uuid = answer.uuid;
          job.running = answer.answer.details;
          job.answer = answer.answer;
          next = { kind: 'ask', atLeast: undefined };
          break;
        case 'done':
          // An answer Lo doesn't know keeps its UUID, to ask about again.
          job.uuid = answer.answer.details.uuid;
          job.answer = answer.answer;
          next = {
            kind: 'end',
            // An answer that something is pending, with no UUID to ask about it by.
            outcome: outcomeOf(answer.answer) ?? {
              kind: 'unknown',
              unknown: { kind: 'status', status: statusName(answer.answer.status) },
            },
          };
          break;
        default:
          return answer satisfies never;
      }
    }
    if (next.kind === 'ask') {
      job.state = { kind: 'pending', trouble: undefined };
      this.#emit(held.pullRef, false);
    }
    return next;
  }

  /** Takes in GitHub's answer to asking how the merge goes, or what kept it from answering. */
  #answered(
    held: Held,
    answer: { ok: true; value: AsyncMerge } | { ok: false; error: unknown },
  ): Next {
    const { job } = held;
    job.polls += 1;
    let next: Next;
    if (answer.ok) {
      const outcome = outcomeOf(answer.value);
      job.answer = answer.value;
      if (outcome) {
        next = { kind: 'end', outcome };
      } else {
        job.state = { kind: 'pending', trouble: undefined };
        next = { kind: 'ask', atLeast: undefined };
      }
    } else {
      const detail = detailOf(answer.error);
      const retry = retryOf(detail, this.#config.now());
      if (retry.kind === 'later') {
        job.state = { kind: 'pending', trouble: detail };
        next = { kind: 'ask', atLeast: retry.atLeast };
      } else {
        next = {
          kind: 'end',
          outcome: { kind: 'unknown', unknown: { kind: 'lost', error: detail } },
        };
      }
    }
    if (next.kind === 'ask') this.#emit(held.pullRef, false);
    return next;
  }

  /**
   * Asks about the merge `held` follows, after each wait, until it ends or
   * {@link JobConfig.followFor} has passed. Nothing when the job is gone.
   */
  async #followUntilDone(held: Held): Promise<Outcome | undefined> {
    const { firstWait, maxWait, followFor, monotonic } = this.#config;
    const { signal } = this.#stopping;
    const started = monotonic();
    let wait = firstWait;
    for (;;) {
      const uuid = held.job.uuid;
      if (!this.#current(held) || uuid === undefined) return undefined;
      if (monotonic() - started + wait > followFor) {
        return { kind: 'unknown', unknown: { kind: 'stillPending' } };
      }
      await delay(wait, signal);
      if (!this.#current(held)) return undefined;
      wait = Math.min(wait * 2, maxWait);
      let answer: { ok: true; value: AsyncMerge } | { ok: false; error: unknown };
      try {
        answer = {
          ok: true,
          value: await held.poller.mergeAsyncResult(held.pullRef, uuid, signal),
        };
      } catch (error) {
        answer = { ok: false, error };
      }
      if (!this.#current(held)) return undefined;
      const next = this.#answered(held, answer);
      if (next.kind === 'end') return next.outcome;
      wait = Math.max(wait, next.atLeast ?? 0);
    }
  }

  /** Ends `held`'s job with `outcome`: as the merge GitHub was already running when it answered `409`, if it did. */
  #finish(held: Held, outcome: Outcome): void {
    const { running } = held.job;
    held.job.state = {
      kind: 'done',
      outcome: running ? { kind: 'alreadyRunning', running, ended: outcome } : outcome,
    };
    this.#emit(held.pullRef, true);
  }
}

/** Waits `wait` milliseconds, or until `signal` aborts. */
function delay(wait: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, wait);
    signal.addEventListener('abort', done, { once: true });
  });
}

function detailOf(error: unknown): GithubErrorDetail {
  return error instanceof GithubError
    ? error.detail
    : { kind: 'decode', message: error instanceof Error ? error.message : String(error) };
}

/**
 * What really happened to a merge GitHub answered `failed` about: GitHub has said so of a stack
 * that landed. Reads the pull request once, and for a stack's merge the stack, and ends as merged
 * when the pull request merged, or as the failure with the layers below that merged anyway.
 */
async function checkFailed(
  poller: MergePoller,
  pull: PullRef,
  stack: boolean,
  failed: Extract<Outcome, { kind: 'failed' }>,
  signal: AbortSignal,
): Promise<Outcome> {
  let merged;
  try {
    merged = await poller.readOnce((client) => mergedState(client, pull), signal);
  } catch {
    return { ...failed, landed: undefined };
  }
  if (isMerged(merged)) {
    return { kind: 'merged', sha: merged.merge_commit_sha, githubSaid: failed.message };
  }
  return { ...failed, landed: stack ? await landedBelow(poller, pull, signal) : [] };
}

/** The layers below `pull` in its GitHub stack that are merged, bottom to top, or nothing when the stack can't be read. */
async function landedBelow(
  poller: MergePoller,
  pull: PullRef,
  signal: AbortSignal,
): Promise<number[] | undefined> {
  let holding;
  try {
    holding = await poller.readOnce(
      (client) => stacksHolding(client, pull.repo, pull.number),
      signal,
    );
  } catch {
    return undefined;
  }
  const stack = holding?.find((found) =>
    found.pull_requests.some((layer) => layer.number === pull.number),
  );
  if (!stack) return undefined;
  const top = stack.pull_requests.findIndex((layer) => layer.number === pull.number);
  return stack.pull_requests
    .slice(0, top)
    .filter((layer) => layer.merged_at !== undefined)
    .map((layer) => layer.number);
}

/** Whether to ask how a merge goes again after asking failed with an error, and at least how long to wait first. */
type Retry = { kind: 'later'; atLeast: number | undefined } | { kind: 'never' };

/**
 * Waiting may get an answer: the network, a server error, a token that can't be read now, or a rate
 * limit, which asks to wait at least so long. It won't when GitHub forgot the UUID, or refused to
 * say.
 */
export function retryOf(detail: GithubErrorDetail, now: number): Retry {
  if (new GithubError(detail).isWaitable() || detail.kind === 'tokenUnavailable') {
    return { kind: 'later', atLeast: rateLimitWait(detail, now) };
  }
  return { kind: 'never' };
}

/**
 * How long a rate limit asks to wait: until `retry-after`, or until the limit resets, or a minute
 * for a secondary limit that doesn't say. Nothing for any other error.
 */
export function rateLimitWait(detail: GithubErrorDetail, now: number): number | undefined {
  if (detail.kind !== 'rateLimited') return undefined;
  // A reset too far off to be a time, or past the clock's skew, waits an hour at most.
  const untilReset =
    detail.reset === undefined
      ? undefined
      : Math.min(Math.max(detail.reset * 1000 - now, 0), MAX_RETRY_AFTER * 1000);
  if (detail.retryAfter !== undefined) return detail.retryAfter * 1000;
  if (untilReset !== undefined) return untilReset;
  return detail.secondary ? SECONDARY_WAIT : undefined;
}

/** How an answer ends a job, or nothing while the merge is pending. */
function outcomeOf(answer: AsyncMerge): Outcome | undefined {
  const { status, details } = answer;
  if (typeof status !== 'string') {
    return { kind: 'unknown', unknown: { kind: 'status', status: status.unknown } };
  }
  switch (status) {
    case 'pending':
      return undefined;
    case 'merged':
      return { kind: 'merged', sha: details.sha, githubSaid: undefined };
    case 'enqueued':
      return { kind: 'enqueued' };
    case 'failed':
      return {
        kind: 'failed',
        message: details.message,
        why: mergeRefusalFrom(details.message),
        landed: undefined,
      };
    default:
      return status satisfies never;
  }
}
