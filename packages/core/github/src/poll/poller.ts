/**
 * One account's poller: what it watches, when each poll is due, and what each answer changed
 * (`docs/design.md`, "GitHub API").
 *
 * Times are milliseconds: wall-clock times since the Unix epoch, and, for what's due, the config's
 * monotonic clock, which doesn't move while the computer sleeps.
 */

import type { Conditional, GithubClient, HeardLimit, RequestGate, TooFast } from '../client.ts';
import { GithubError, MAX_RETRY_AFTER, type GithubErrorDetail } from '../errors.ts';
import { unchecked } from '../json.ts';
import { readMergeFacts, type MergeFacts } from '../merge.ts';
import type {
  AsyncMerge,
  AutoMergeRequest,
  AutoMergeState,
  ConversionStep,
  Dequeued,
  GithubStack,
  Jumped,
  MergeRefusal,
  MergeRequest,
  QueueEntry,
  Retarget,
  StepDone,
  Submitted,
} from '../merge-writes.ts';
import { PAGE_SIZE } from '../pager.ts';
import { pendingReview, type PendingReviewRead } from '../pending.ts';
import {
  listsTheSame,
  pullLastModified,
  readListedPulls,
  readPullSummary,
  type ListedPage,
  type ListedPulls,
  type PullSummary,
} from '../pulls.ts';
import { readPushHistory, type PushHistory } from '../push-history.ts';
import {
  branchesToCheck,
  MAX_OPEN_PULL_REQUESTS,
  openPullRequestsPaged,
  pullRequest,
  pullRequestCheck,
  RECENTLY_UPDATED_MERGED,
  type OpenPullRequestList,
  type PullRequest,
  type PullRequestCheck,
} from '../queries.ts';
import { RateLimits } from '../rate-limit.ts';
import { PullRef, RepoRef, type Target } from '../refs.ts';
import type { CommentId, ReviewWrite, ReviewWriteRefusal, Sent } from '../review-writes.ts';
import { readStackLayers, type StackLayerList } from '../stack-layers.ts';
import { reviewThreads, type ReviewThreadList } from '../threads.ts';
import { readTimeline, type PullRequestTimeline } from '../timeline.ts';
import { noTrunkRules, readTrunkRules, type TrunkRuleList } from '../trunk-rules.ts';
import type { CacheEntry, PollCache } from './cache.ts';
import {
  backoff,
  interval,
  pollConfig,
  rateLimitState,
  type Cooldown,
  type PauseReason,
  type PollConfig,
  type RateLimitState,
  type Tier,
} from './governor.ts';
import { abandoned, RequestQueue } from './queue.ts';
import {
  addToStackIn,
  createStackIn,
  dequeueOn,
  disableAutoMergeOn,
  enableAutoMergeOn,
  enqueueOn,
  jumpOn,
  mergeAsyncOn,
  mergeAsyncResultOf,
  retargetIn,
  runConversionStepIn,
  unstackIn,
} from './merge-writes.ts';
import {
  addConversationCommentOn,
  deleteCommentOn,
  editCommentOn,
  resolveThreadOn,
  sendReview,
} from './review-writes.ts';
import {
  MERGE_FACTS,
  PENDING_REVIEW,
  PUSH_HISTORY,
  REVIEW_THREADS,
  sameJson,
  STACK_LAYERS,
  stamp,
  TIMELINE,
  type ReadKind,
  type ReadMark,
  type SinceMark,
} from './reads.ts';

/** What a poll found. */
export type PollEvent =
  /**
   * GitHub's REST view of a watched pull request changed: a push, a retitle, a merge or a close.
   * Sent for every watched pull request, the open one included.
   */
  | { kind: 'summary'; pull: PullRef; summary: PullSummary }
  /**
   * The open pull request's cheap check changed, or was made for the first time: its checks'
   * state, review decision, merge state, review threads or merge queue entry, or anything that
   * means its details changed.
   */
  | { kind: 'check'; pull: PullRef; check: PullRequestCheck }
  /** The open pull request's details changed, or were fetched for the first time. */
  | { kind: 'details'; pull: PullRef; details: PullRequest }
  /** A watched repository's open pull requests changed. */
  | { kind: 'openPullRequests'; repo: RepoRef; list: OpenPullRequestList }
  /**
   * A watched repository's branch rulesets changed, or were read for the first time:
   * {@link Poller.trunkRules} has them.
   */
  | { kind: 'trunkRules'; repo: RepoRef }
  /**
   * A poll failed for a reason that isn't the network, the rate limit or the token, such as a pull
   * request that's gone or an organization's single sign-on. It's tried again at its next interval.
   */
  | { kind: 'failed'; target: Target; error: GithubErrorDetail }
  /**
   * A read {@link Poller.readCached} keeps for a pull request changed, or was read for the first
   * time, or came from the cache: {@link Poller.cachedRead} has it.
   */
  | { kind: 'read'; pull: PullRef; name: string }
  /**
   * A read {@link Poller.readCached} keeps was read again, and GitHub gave the same value:
   * {@link Poller.cachedRead} has it, with when GitHub confirmed it. So what says how old a read
   * is, or that the last one failed, hears that it's current.
   */
  | { kind: 'confirmed'; pull: PullRef; name: string }
  /**
   * A read {@link Poller.readCached} keeps failed for a reason that isn't the network, the rate
   * limit or the token. It's tried again at the open pull request's next interval, waiting longer
   * each time it fails in a row.
   */
  | { kind: 'readFailed'; pull: PullRef; name: string; error: GithubErrorDetail };

/** GitHub couldn't be reached, or the account's token couldn't be read. */
export interface Offline {
  /** When the first request failed. */
  since: number;
  /** When the next request will try. */
  retryAt: number;
  /** What went wrong, as a sentence. */
  error: string;
}

/**
 * How polling is going, for banners (`docs/design.md`, "Rate limit", and "Offline", "Rate limit
 * used up" and "Signed out" under "Errors and edge cases").
 */
export interface PollStatus {
  rateLimit: RateLimitState;
  /** Set while GitHub can't be reached, or the account's token can't be read. */
  offline: Offline | undefined;
  /** GitHub refused the account's token, so nothing is polled until it signs in again. */
  signedOut: boolean;
}

/** How often Lo lists each watched repository's open pull requests now ({@link Poller.listSchedule}). */
export interface ListSchedule {
  /** The time between lists: now, or once Lo lists them again. */
  every: number;
  /**
   * Whether Lo lists them now. It doesn't while the account is signed out, or while the rate limit
   * is very low or used up; a list asked for then waits until it does.
   */
  listing: boolean;
}

/** Something Lo read, and when GitHub last confirmed it. */
export interface Cached<T> {
  value: T;
  fetchedAt: number;
}

/** A pull request's details as Lo has them. */
export interface PullRequestAnswer {
  details: PullRequest;
  /** When GitHub last confirmed them. */
  fetchedAt: number;
  /**
   * While GitHub can't be reached, how old the details are: they're from the cache, and the app
   * shows them read-only with when they're from (`docs/design.md`, "Offline").
   */
  offlineAge: number | undefined;
}

/**
 * A pause GitHub asked for in a refusal: until a reset it named, a wall-clock time in milliseconds
 * since the Unix epoch, or until a wait from the refusal is over, in milliseconds by the monotonic
 * clock.
 */
type Pause = { clock: 'wall' | 'monotonic'; until: number; reason: PauseReason };

/** A write's result as it came: its value, or what it threw. */
export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * A read {@link Poller.readCached} keeps, to run again after a write: by its name, and whether it
 * reads everything again rather than what's new, as for an edit of an item a read of the newest
 * page doesn't reach.
 */
export interface Reread {
  name: string;
  afresh: boolean;
}

/** How {@link Poller.writeChanging} runs a write, beyond its turn in the account's queue. */
export interface WriteOptions<T> {
  /**
   * The reads {@link Poller.readCached} keeps to make due at once afterwards, for each pull request
   * the write changes, given its result.
   */
  again?: ((result: Settled<T>) => readonly Reread[]) | undefined;
  /**
   * What the write answers instead of being sent while GitHub has asked Lo to hold off, given when
   * that ends ({@link Poller.writesHeldUntil}). Without it, the write waits until then, and is sent.
   */
  whilePaused?: ((until: number) => T) | undefined;
  /**
   * Whether it creates content, as a comment or a review does, which GitHub limits apart: one GitHub
   * takes ends a run of refusals of content sent too fast.
   */
  content?: boolean | undefined;
  /**
   * Gives the write up: while it waits for its turn or for a pause to end, it's never sent, and
   * none of the requests it's made of is sent once it's given up, though one already sent finishes.
   */
  signal?: AbortSignal | undefined;
  /**
   * A write to send after this one in the same turn, given what this one answered, or nothing: for
   * one that undoes it, which nothing else in the account's queue may go before. It's sent the
   * spacing after this one, and not at all when GitHub has asked Lo to hold off by then. Its answer
   * is taken in as any write's is, then left to whoever made it: the write answers what it did,
   * even when making or sending the follow-up throws.
   */
  followUp?: ((answer: T) => ((client: GithubClient) => Promise<unknown>) | undefined) | undefined;
}

/**
 * Adds to a repository's open pull request list the merged pull requests its stacks link through,
 * as `@lo/stacks`' `lookUpMerged` does: carrying over what `known`, the list read before, found
 * for a branch whose tip hasn't moved, with `rules` in force, at `now`. It says when it stopped
 * short in the list's `mergedTruncated`. Each request goes through `client`, which takes a turn in
 * the account's queue for each.
 */
export type LookUpMerged = (
  client: GithubClient,
  repo: RepoRef,
  list: OpenPullRequestList,
  known: OpenPullRequestList | undefined,
  rules: TrunkRuleList,
  now: number,
) => Promise<void>;

/** The accounts a poller's account is one of: `Accounts` is one. */
export interface PollAccounts {
  /** The account's client. Throws a `GithubError`: `unauthorized` when it's signed out, `tokenUnavailable` when its token can't be read now. */
  client(login: string): Promise<GithubClient>;
  /** Whether there's an account with this login. */
  account(login: string): unknown;
  isSignedOut(login: string): boolean;
  /** Calls `listener` when an account is added, removed or signed out, until the returned function is called. */
  onChange(listener: () => void): () => void;
}

export interface PollerOptions {
  accounts: PollAccounts;
  /** The account the poller polls as. */
  login: string;
  cache: PollCache;
  config?: Partial<PollConfig> | undefined;
  /**
   * Looks up the merged pull requests a watched repository's stacks link through, after each new
   * list of its open pull requests. Without it, a list holds only the merged pull requests GitHub
   * updated most recently.
   */
  lookUpMerged?: LookUpMerged | undefined;
  /**
   * Notes the heads a poll saw of a pull request, at `at`, for its revisions: called once for each
   * answer that brings them anew.
   */
  seen?:
    | ((login: string, pull: PullRef, heads: readonly string[], at: number) => Promise<void>)
    | undefined;
  /** Where the poller says what it did that's worth a line in a log. */
  log?: ((message: string) => void) | undefined;
}

/** How long after the last of a burst of writes the stack trees that show its pull requests read their layers again. */
const WRITES_READ_BACK_AFTER = 2000;
/** How long a repository's rulesets are kept before they're read again. */
const TRUNK_RULES_MAX_AGE = 30 * 60_000;
/**
 * How old a list of open pull requests may be for its lookups of merged pull requests to carry
 * over, while their branches stay put: a list kept from before a restart may have missed a merge.
 */
const CARRY_MAX_AGE = 60 * 60_000;
/** The most pages of open pull requests read, as many as the open pull request list holds. */
const MAX_LISTED_PAGES = MAX_OPEN_PULL_REQUESTS / PAGE_SIZE;
/** What a write waiting for a pause to end fails with when the poller stops first. */
const STOPPED_WAITING =
  "Lo stopped polling for the account before GitHub's pause ended, so the write wasn't sent";

/** The names the poller keeps its own reads under in the cache. */
const SUMMARY = 'PullSummary';
const CHECK = 'PullRequestCheck';
const DETAILS = 'PullRequest';
const LISTED = 'ListedPulls';
const LIST = 'OpenPullRequests';
const RULES = 'TrunkRules';

/** When a pull request or a repository was polled, and whether it's owed a poll at once. */
class Schedule {
  lastPolled: number | undefined;
  /** How many times it was asked to be polled at once: opened, Lo came to the foreground, or a write changed it. */
  forced = 0;
  /** `forced` as it was when the last poll to finish was chosen. A poll asked for while another was in flight is still owed when that one finishes. */
  served = 0;

  force(): void {
    this.forced += 1;
  }

  isForced(): boolean {
    return this.forced > this.served;
  }

  /** A poll chosen when `forced` was `ticket` finished. */
  polled(at: number, ticket: number): void {
    this.lastPolled = at;
    this.serve(ticket);
  }

  /** A poll chosen when `forced` was `ticket` finished without an answer, so it isn't owed again at once. */
  serve(ticket: number): void {
    this.served = Math.max(this.served, ticket);
  }
}

/** A read kind with its type erased, for the poller's table of reads. */
interface Kind {
  name: string;
  watched: readonly string[];
  complete: (value: unknown) => boolean;
}

function erase<T>(kind: ReadKind<T>): Kind {
  const { complete } = kind;
  return {
    name: kind.name,
    watched: kind.watched,
    complete: (value) => complete?.(unchecked<T>(value)) ?? true,
  };
}

type ReadFn = (client: GithubClient, known: unknown) => Promise<unknown>;

/** A read the poller keeps for a pull request. */
interface ReadState {
  /** Which read it is ({@link nextReadId}): its marks carry it. */
  id: number;
  kind: Kind;
  run: ReadFn;
  value: unknown;
  /** The watched fields of the check the value was read at, or nothing when it must be read again whatever they are. */
  stamp: string | undefined;
  /** When GitHub last confirmed the value; nothing while it has none. */
  fetchedAt: number | undefined;
  /** How many times in a row reading it failed, or gave a value that isn't complete. */
  failures: number;
  /** When it may be read again after those failures. */
  retryAt: number | undefined;
  /** How many times it was made due at once whatever its stamp. A run that started before the last time doesn't stamp its value, so it's read again. */
  generation: number;
  /** The `generation` of the newest run that finished with all of the value and started at that generation: every mark up to it is past. */
  finished: number | undefined;
  /** The `generation` of the newest run that finished at all and started at that generation. */
  landed: number | undefined;
  /** When it's due again after a write it shows, whatever its stamp. */
  againAt: number | undefined;
  /** Whether its next run is given nothing Lo has, so it reads everything again. A run that started since clears it. */
  afresh: boolean;
  /** Whether what the cache holds is still loading, which the read waits for. */
  loading: boolean;
}

let readIds = 0;

/** A number for a new read, never given to another while Lo runs, which its marks carry. */
function nextReadId(): number {
  readIds += 1;
  return readIds;
}

interface PullState {
  pull: PullRef;
  schedule: Schedule;
  summary: Cached<PullSummary> | undefined;
  /**
   * The check the details were last fetched in full at, and when. A different check means they're
   * stale, and none means they must be fetched again whatever the check says.
   */
  check: Cached<PullRequestCheck> | undefined;
  /** The latest check, as {@link Poller.check} returns it and `check` events send it. */
  latestCheck: PullRequestCheck | undefined;
  details: Cached<PullRequest> | undefined;
  reads: Map<string, ReadState>;
  /** Loads from the cache under way, which the pull request isn't polled during. */
  loading: Promise<void>[];
}

interface RepoState {
  repo: RepoRef;
  schedule: Schedule;
  /** GitHub's REST list of the open pull requests, page by page with their ETags: what tells whether `list` changed. */
  listed: Cached<ListedPulls> | undefined;
  list: Cached<OpenPullRequestList> | undefined;
  rules: Cached<TrunkRuleList> | undefined;
  /** How many reads of `rules` in a row couldn't read the rulesets, and when they may be read again. */
  rulesFailures: number;
  rulesRetryAt: number | undefined;
  /** How many times in a row the lookups of merged pull requests stopped short, and when they may run again without the list changing. */
  lookupFailures: number;
  lookupRetryAt: number | undefined;
  /**
   * How many writes have changed the open pull requests. A poll chosen before the latest one may
   * have read them, or the cache, before it, so what it read isn't kept: the poll the write asked
   * for reads them again.
   */
  written: number;
  loading: Promise<void>[];
}

interface OfflineState {
  attempts: number;
  retryAt: number;
  status: Offline;
}

/** One run of a read, as a poll. */
interface ReadJob {
  name: string;
  run: ReadFn;
  known: unknown;
  /** The watched fields of the check it's read at. */
  stamp: string;
  /** The read's generation when it started. */
  generation: number;
  /** When it started. */
  started: number;
}

/** One poll: a few requests run back to back in the account's queue. */
type Job =
  /** The open pull request: a free conditional GET, the 1-point check, then its details only when either says something changed. */
  | {
      kind: 'open';
      pull: PullRef;
      summary: PullSummary | undefined;
      check: PullRequestCheck | undefined;
      haveDetails: boolean;
    }
  /** Another watched pull request: the conditional GET alone. */
  | { kind: 'watched'; pull: PullRef; summary: PullSummary | undefined }
  /**
   * A watched repository: conditional GETs of its open pull requests, a page at a time, then the
   * full list when they changed, then its rulesets when they're due, and the merged pull requests
   * its stacks link through, carried over from `list` where their branches haven't moved.
   */
  | {
      kind: 'repo';
      repo: RepoRef;
      listed: ListedPulls | undefined;
      list: OpenPullRequestList | undefined;
      /** Whether `list` is recent enough to carry its lookups over from. */
      carry: boolean;
      /** Whether to look up merged pull requests again while the pull requests haven't changed, because the last lookups stopped short. */
      retryLookups: boolean;
      rules: TrunkRuleList | undefined;
      readRules: boolean;
      /** The repository's count of writes when the poll was chosen. */
      written: number;
    }
  /** A read {@link Poller.readCached} keeps for the open pull request. */
  | { kind: 'read'; pull: PullRef; read: ReadJob };

type Outcome =
  | {
      kind: 'open';
      summary: Conditional<PullSummary>;
      check: PullRequestCheck;
      details: PullRequest | undefined;
    }
  | { kind: 'watched'; summary: Conditional<PullSummary> }
  | {
      kind: 'repo';
      listed: ListedPulls;
      list: OpenPullRequestList | undefined;
      rules: TrunkRuleList | undefined;
      /** The repository's count of writes when the poll was chosen. */
      written: number;
    }
  | {
      kind: 'read';
      name: string;
      value: unknown;
      stamp: string;
      generation: number;
      started: number;
    };

/** What to do next: run a poll, chosen when its target's `forced` was `ticket`, or wait. */
type Step = { kind: 'run'; job: Job; ticket: number } | { kind: 'wait'; wait: number | undefined };

type CacheWrite = () => Promise<void>;

function targetOf(job: Job): Target {
  return job.kind === 'repo' ? job.repo : job.pull;
}

function detailOf(error: unknown): GithubErrorDetail {
  return error instanceof GithubError
    ? error.detail
    : { kind: 'decode', message: error instanceof Error ? error.message : String(error) };
}

/**
 * The read a refusal holds, when Lo refused a write for want of it, as it refuses a merge when it
 * can't read the stack: the write answered as the read did.
 */
export function readBehind(value: unknown): GithubErrorDetail | undefined {
  if (typeof value !== 'object' || value === null || !('refusal' in value)) return undefined;
  const read: unknown = Reflect.get(value, 'read');
  return typeof read === 'object' && read !== null && 'kind' in read
    ? unchecked<GithubErrorDetail>(read)
    : undefined;
}

/** What a settled request says about the account's connection: the error, or the read behind a refusal. */
function behind(result: Settled<unknown>): GithubErrorDetail | undefined {
  return result.ok ? readBehind(result.value) : detailOf(result.error);
}

/**
 * Whether GitHub answered, even with an error: it can be reached. A write Lo didn't send for want
 * of a read answered as the read did.
 */
export function answered(result: Settled<unknown>): boolean {
  if (!result.ok && !(result.error instanceof GithubError)) return false;
  const kind = behind(result)?.kind;
  return kind !== 'network' && kind !== 'refusedUrl' && kind !== 'tokenUnavailable';
}

/** Whether a write's answer is a refusal, Lo's or GitHub's, rather than what the write made. */
function isRefusalValue(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'refusal' in value;
}

/** Whether a write's answer is GitHub's refusal of content sent too fast. */
function isTooFast(value: unknown): boolean {
  return isRefusalValue(value) && Reflect.get(Object(value), 'refusal') === 'tooFast';
}

/** A gate that lets each request through until `signal` gives up what it's part of. */
function givenUpOn(signal: AbortSignal): RequestGate {
  return () =>
    signal.aborted ? Promise.reject(abandoned(signal)) : Promise.resolve(() => undefined);
}

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

/** A sorted copy of `items`, by `key`. */
function sorted<T>(items: Iterable<T>, compare: (a: T, b: T) => number): T[] {
  return [...items].toSorted(compare);
}

/**
 * Polls GitHub for one account: the open pull request every 20 s, other watched pull requests and
 * their repositories' open pull requests every 2 minutes, and everything every 5 minutes while Lo
 * is in the background. Each poll asks first whether anything changed, with requests that are free
 * when nothing did, and fetches details only when something did. Requests run one at a time in the
 * account's {@link RequestQueue}, slowed or paused by the rate limit and backed off while offline.
 *
 * The app says whether Lo is in the foreground ({@link Poller.setForeground}), which pull requests
 * are in tabs ({@link Poller.watch}) and which tab is active ({@link Poller.setOpen}). What changed
 * arrives as {@link PollEvent}s; {@link Poller.status} is for banners, and {@link Poller.onChange}
 * hears when anything here changes. {@link Poller.stop} ends it.
 */
export class Poller {
  readonly #accounts: PollAccounts;
  readonly #login: string;
  readonly #cache: PollCache;
  readonly #config: PollConfig;
  readonly #queue: RequestQueue;
  readonly #lookUpMerged: LookUpMerged | undefined;
  readonly #seen: PollerOptions['seen'];
  readonly #log: (message: string) => void;
  #foreground = true;
  #open: PullRef | undefined;
  /** When the open pull request was opened. */
  #openedAt: number | undefined;
  readonly #pulls = new Map<string, PullState>();
  readonly #repos = new Map<string, RepoState>();
  /** The sets of layers each pull request's stack trees asked about, by the set's key, and when each was last asked. */
  readonly #layerAsks = new Map<string, Map<string, { ids: string[]; at: number }>>();
  /** The layers each pull request's read of them reads: the sets asked about lately. */
  readonly #layerUnion = new Map<string, Set<string>>();
  #limits = new RateLimits();
  #cooldown: Pause | undefined;
  #secondaryAttempts = 0;
  /**
   * Until when writes wait after GitHub turned one away as content sent too fast, and how many in a
   * row it has, as the account's client keeps it ({@link GithubClient.tooFast}).
   */
  #tooFast: TooFast | undefined;
  /** The client's refusals for the rate limit already taken in ({@link GithubClient.rateLimited}). */
  readonly #heardLimits = new WeakSet<object>();
  /** Wakes each write waiting for a pause to end, so it sees that the poller stopped. */
  readonly #pauseWaiters = new Set<() => void>();
  #offline: OfflineState | undefined;
  /** The error each target's polls keep failing with, so it's logged once. */
  readonly #failures = new Map<string, string>();
  #signedOut = false;
  #status: PollStatus = { rateLimit: { kind: 'normal' }, offline: undefined, signedOut: false };
  /** The writes sent or waiting in the account's queue, each done when it and what follows it here have finished. */
  readonly #writes = new Set<Promise<void>>();
  readonly #listeners = new Set<(event: PollEvent) => void>();
  readonly #observers = new Set<() => void>();
  #stopped = false;
  #woken = false;
  #wakeUp: (() => void) | undefined;
  readonly #unsubscribe: () => void;

  /** Starts polling for `login`, an account in `accounts`, in the foreground and with nothing watched. */
  constructor(options: PollerOptions) {
    this.#accounts = options.accounts;
    this.#login = options.login;
    this.#cache = options.cache;
    this.#config = pollConfig(options.config);
    this.#queue = new RequestQueue(this.#config.writeSpacing, this.#config.monotonic);
    this.#lookUpMerged = options.lookUpMerged;
    this.#seen = options.seen;
    this.#log = options.log ?? (() => {});
    // An account that signs in again resumes polling.
    this.#unsubscribe = this.#accounts.onChange(() => {
      if (
        this.#signedOut &&
        this.#accounts.account(this.#login) !== undefined &&
        !this.#accounts.isSignedOut(this.#login)
      ) {
        this.#signedOut = false;
        this.#wake();
      }
    });
    void this.#loop().catch((error: unknown) => this.#log(`stopped polling: ${String(error)}`));
  }

  /** Stops polling. Writes already sent finish; those waiting for a pause to end are never sent. */
  stop(): void {
    this.#stopped = true;
    this.#unsubscribe();
    this.#wake();
    for (const wake of this.#pauseWaiters) wake();
  }

  /** Calls `listener` with each {@link PollEvent}, until the returned function is called. */
  onEvent(listener: (event: PollEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Calls `listener` when what the poller holds or its status changes, until the returned function is called. */
  onChange(listener: () => void): () => void {
    this.#observers.add(listener);
    return () => this.#observers.delete(listener);
  }

  get login(): string {
    return this.#login;
  }

  status(): PollStatus {
    return this.#status;
  }

  /** The account's request queue, for requests made outside polls. */
  get queue(): RequestQueue {
    return this.#queue;
  }

  get foreground(): boolean {
    return this.#foreground;
  }

  /** Says whether Lo is in the foreground. Coming back polls the open pull request at once. */
  setForeground(foreground: boolean): void {
    if (this.#foreground === foreground) return;
    this.#foreground = foreground;
    if (foreground && this.#open) this.#pulls.get(this.#open.key)?.schedule.force();
    this.#wake();
    this.#changed();
  }

  /**
   * Starts watching a pull request, such as one in a tab, and the open pull requests of its
   * repository. What's cached about them loads first, and resolves this.
   */
  async watch(pull: PullRef): Promise<void> {
    await this.#watching(pull).loaded;
  }

  #watching(pull: PullRef): { state: PullState; loaded: Promise<void> } {
    const existing = this.#pulls.get(pull.key);
    if (existing) return { state: existing, loaded: this.#loaded(existing.loading) };
    const state: PullState = {
      pull,
      schedule: new Schedule(),
      summary: undefined,
      check: undefined,
      latestCheck: undefined,
      details: undefined,
      reads: new Map(),
      loading: [],
    };
    this.#pulls.set(pull.key, state);
    this.#load(state.loading, async () => {
      const [summary, check] = await Promise.all([
        this.#cached<PullSummary>(pull, SUMMARY),
        this.#cached<PullRequestCheck>(pull, CHECK),
      ]);
      if (this.#pulls.get(pull.key) !== state) return;
      state.summary ??= summary;
      if (state.check === undefined && check !== undefined) {
        state.check = check;
        state.latestCheck ??= check.value;
      }
    });
    if (!this.#repos.has(pull.repo.key)) {
      const repo: RepoState = {
        repo: pull.repo,
        schedule: new Schedule(),
        listed: undefined,
        list: undefined,
        rules: undefined,
        rulesFailures: 0,
        rulesRetryAt: undefined,
        lookupFailures: 0,
        lookupRetryAt: undefined,
        written: 0,
        loading: [],
      };
      this.#repos.set(pull.repo.key, repo);
      this.#load(repo.loading, async () => {
        const [listed, list, rules] = await Promise.all([
          this.#cached<ListedPulls>(pull.repo, LISTED),
          this.#cached<OpenPullRequestList>(pull.repo, LIST),
          this.#cached<TrunkRuleList>(pull.repo, RULES),
        ]);
        if (this.#repos.get(pull.repo.key) !== repo) return;
        // ETags kept from before a write that changed the open pull requests would say they hadn't.
        if (repo.written === 0) repo.listed ??= listed;
        repo.list ??= list;
        repo.rules ??= rules;
      });
    }
    this.#wake();
    this.#changed();
    return { state, loaded: this.#loaded(state.loading, this.#repos.get(pull.repo.key)?.loading) };
  }

  /** Runs `load`, a load from the cache, as one of `loading`, waking the poll loop once it's done. */
  #load(loading: Promise<void>[], load: () => Promise<void>): void {
    const done: Promise<void> = load()
      .catch((error: unknown) => this.#log(`reading the cache: ${String(error)}`))
      .finally(() => {
        const at = loading.indexOf(done);
        if (at >= 0) void loading.splice(at, 1);
        this.#wake();
        this.#changed();
      });
    loading.push(done);
  }

  async #loaded(...lists: (Promise<void>[] | undefined)[]): Promise<void> {
    await Promise.all(lists.flatMap((list) => list ?? []));
  }

  /** What the cache holds as `name` for `target`, or nothing when it holds nothing or can't be read. */
  async #cached<T>(target: Target, name: string): Promise<Cached<T> | undefined> {
    try {
      const entry = await this.#cache.get(this.#login, target.key, name);
      return entry && { value: unchecked<T>(entry.value), fetchedAt: entry.fetchedAt };
    } catch (error) {
      this.#log(`reading the cache: ${String(error)}`);
      return undefined;
    }
  }

  /** Stops watching a pull request, and its repository when no other watched pull request is in it. */
  unwatch(pull: PullRef): void {
    if (!this.#pulls.delete(pull.key)) return;
    this.#failures.delete(pull.key);
    this.#layerAsks.delete(pull.key);
    this.#layerUnion.delete(pull.key);
    if (this.#open?.equals(pull)) {
      this.#open = undefined;
      this.#openedAt = undefined;
    }
    if (![...this.#pulls.values()].some((state) => state.pull.repo.equals(pull.repo))) {
      this.#repos.delete(pull.repo.key);
      this.#failures.delete(pull.repo.key);
    }
    this.#wake();
    this.#changed();
  }

  /** Whether it watches `pull`. */
  watches(pull: PullRef): boolean {
    return this.#pulls.has(pull.key);
  }

  get open(): PullRef | undefined {
    return this.#open;
  }

  /**
   * Makes `pull` the open pull request, the one in the active tab, watching it if it wasn't, and
   * refreshes its details. Resolves with its cached details, if there are any, once the cache has
   * answered, before any request.
   */
  async setOpen(pull: PullRef | undefined): Promise<PullRequestAnswer | undefined> {
    if (pull === undefined ? this.#open === undefined : this.#open?.equals(pull)) {
      if (pull === undefined) return undefined;
      const state = this.#pulls.get(pull.key);
      if (state) await this.#loaded(state.loading);
      return this.pullRequest(pull);
    }
    this.#open = pull;
    this.#openedAt = undefined;
    if (pull === undefined) {
      this.#wake();
      this.#changed();
      return undefined;
    }
    const { state, loaded } = this.#watching(pull);
    if (state.details === undefined) {
      this.#load(state.loading, async () => {
        const details = await this.#cached<PullRequest>(pull, DETAILS);
        if (this.#pulls.get(pull.key) === state) state.details ??= details;
      });
    }
    state.schedule.force();
    this.#openedAt = this.#config.now();
    this.#wake();
    this.#changed();
    await Promise.all([loaded, this.#loaded(state.loading)]);
    if (this.#open?.equals(pull)) this.#recordRecent(pull);
    return this.pullRequest(pull);
  }

  /** A watched pull request's details, as last fetched. */
  pullRequest(pull: PullRef): PullRequestAnswer | undefined {
    const details = this.#pulls.get(pull.key)?.details;
    if (!details) return undefined;
    return {
      details: details.value,
      fetchedAt: details.fetchedAt,
      offlineAge: this.#offline ? this.#config.now() - details.fetchedAt : undefined,
    };
  }

  /** The open pull request's cheap check: its checks' state, review decision, merge state, review threads and merge queue entry. */
  check(pull: PullRef): PullRequestCheck | undefined {
    return this.#pulls.get(pull.key)?.latestCheck;
  }

  /** GitHub's REST view of a watched pull request, as last fetched. */
  summary(pull: PullRef): PullSummary | undefined {
    return this.#pulls.get(pull.key)?.summary?.value;
  }

  /** A watched repository's open pull requests, as last fetched. */
  openPullRequests(repo: RepoRef): Cached<OpenPullRequestList> | undefined {
    return this.#repos.get(repo.key)?.list;
  }

  /**
   * The branch rulesets that name trunks in a watched repository, read with its open pull requests
   * and again every 30 minutes, or nothing until they've been read once. When they can't be read,
   * they're tried again after a wait, and what they hold says why.
   */
  trunkRules(repo: RepoRef): Cached<TrunkRuleList> | undefined {
    return this.#repos.get(repo.key)?.rules;
  }

  /**
   * Reads something about `pull` with `request`, keeping it as `kind` says, watching `pull` if it
   * wasn't. Resolves with what Lo has once the cache has answered, before any request: what was
   * read before, or what the cache holds, even from before a restart, which also comes as a `read`
   * event.
   *
   * While `pull` is the open pull request, `request` runs in the account's queue, after the open
   * pull request's poll: when Lo has nothing yet, when a field the kind watches in the open pull
   * request's check is no longer what it was when it was read, and, like the details, on the
   * 5-minute refresh in the foreground. `request` is given the value Lo has, so it can ask GitHub
   * whether that changed, and its client takes a turn in the queue for each request, so a write
   * can go between them. Each time the value changes, a `read` event says so, and each time GitHub
   * gives the same value again, a `confirmed` event does. A read is kept for as long as `pull` is
   * watched; asking again replaces its `request`.
   */
  async readCached<T>(
    pull: PullRef,
    kind: ReadKind<T>,
    request: (client: GithubClient, known: T | undefined) => Promise<T>,
  ): Promise<Cached<T> | undefined> {
    const { state, loaded } = this.#watching(pull);
    const run: ReadFn = (client, known) =>
      request(client, known === undefined ? undefined : unchecked<T>(known));
    const existing = state.reads.get(kind.name);
    if (existing) {
      existing.run = run;
      await loaded;
      return this.cachedRead(pull, kind);
    }
    const read: ReadState = {
      id: nextReadId(),
      kind: erase(kind),
      run,
      value: undefined,
      stamp: undefined,
      fetchedAt: undefined,
      failures: 0,
      retryAt: undefined,
      generation: 0,
      finished: undefined,
      landed: undefined,
      againAt: undefined,
      afresh: false,
      loading: true,
    };
    state.reads.set(kind.name, read);
    this.#wake();
    this.#changed();
    let entry: CacheEntry | undefined;
    try {
      entry = await this.#cache.get(this.#login, pull.key, kind.name);
    } catch (error) {
      this.#log(`reading the cache: ${String(error)}`);
    }
    read.loading = false;
    // GitHub may have answered meanwhile, or the read been let go of.
    if (
      entry &&
      read.value === undefined &&
      this.#pulls.get(pull.key)?.reads.get(kind.name) === read
    ) {
      read.value = entry.value;
      read.stamp = entry.stamp;
      read.fetchedAt = entry.fetchedAt;
      this.#emit({ kind: 'read', pull, name: kind.name });
    }
    this.#wake();
    this.#changed();
    await loaded;
    return this.cachedRead(pull, kind);
  }

  /** What a read {@link Poller.readCached} keeps for `pull` holds, and when GitHub last confirmed it. */
  cachedRead<T>(pull: PullRef, kind: ReadKind<T>): Cached<T> | undefined {
    const read = this.#pulls.get(pull.key)?.reads.get(kind.name);
    if (read?.value === undefined || read.fetchedAt === undefined) return undefined;
    return { value: unchecked<T>(read.value), fetchedAt: read.fetchedAt };
  }

  /**
   * `pull`'s push history, as {@link Poller.readCached} keeps it, read as this account. It's read
   * again after a push, a retarget, a merge or a close, and when a review is submitted.
   */
  pushHistory(pull: PullRef): Promise<Cached<PushHistory> | undefined> {
    return this.readCached(pull, PUSH_HISTORY, (client, known) =>
      readPushHistory(client, pull, this.#login, known),
    );
  }

  /**
   * `pull`'s review threads, each with every comment, as {@link Poller.readCached} keeps them, read
   * as this account. They're read again after a push, when a thread is added, deleted, resolved or
   * unresolved, or gains or loses a comment, and on the 5-minute refresh.
   */
  reviewThreads(pull: PullRef): Promise<Cached<ReviewThreadList> | undefined> {
    return this.readCached(pull, REVIEW_THREADS, (client) => reviewThreads(client, pull));
  }

  /**
   * This account's pending review on `pull`, as {@link Poller.readCached} keeps it. It's read again
   * when the check's count of its comments changes, from Lo or anywhere else, and on the 5-minute
   * refresh.
   */
  pendingReview(pull: PullRef): Promise<Cached<PendingReviewRead> | undefined> {
    return this.readCached(pull, PENDING_REVIEW, (client) =>
      pendingReview(client, pull, this.#login),
    );
  }

  /**
   * What decides whether `pull` can merge, as {@link Poller.readCached} keeps it, read as this
   * account. It's read again when GitHub's verdict or what explains it may have moved, and on the
   * 5-minute refresh, which also asks whether the base branch's rules changed, for free when they
   * didn't.
   */
  mergeFacts(pull: PullRef): Promise<Cached<MergeFacts> | undefined> {
    return this.readCached(pull, MERGE_FACTS, (client, known) =>
      readMergeFacts(client, pull, this.#login, known),
    );
  }

  /**
   * Reads what decides `pull`'s merge again at its next turn, as when the merge panel won't act on
   * a read GitHub left part of, or one that's old. A read that keeps failing still waits as long as
   * its failures say: asking again doesn't make GitHub answer sooner.
   */
  readMergeFactsAgain(pull: PullRef): void {
    this.#readAgain(pull, MERGE_FACTS.name, false, false);
  }

  /**
   * `pull`'s timeline, as {@link Poller.readCached} keeps it, read as this account. It's read again
   * when an item it shows is added or deleted, the pull request is updated, the latest commit's
   * checks change or the description is edited, and on the 5-minute refresh: each time only its
   * newest page. So a change to an older item shows at the hourly full read, unless Lo made it.
   */
  timeline(pull: PullRef): Promise<Cached<PullRequestTimeline> | undefined> {
    return this.readCached(pull, TIMELINE, (client, known) =>
      readTimeline(client, pull, { known, now: new Date(this.#config.now()) }),
    );
  }

  /**
   * What the stack tree shows of the layers whose node IDs are `ids`, kept for `pull`, the layer
   * that's open, as {@link Poller.readCached} keeps it. It reads the layers of every set asked about
   * in the last 5 minutes, so two trees asking about different sets for one pull request share a
   * read rather than take turns. It's read again:
   *
   * - when the open layer's state, head, review decision, checks, queue entry or retargets change;
   * - a couple of seconds after Lo last writes to another layer it shows, once for a burst of
   *   writes. Writes to the open layer itself, such as viewed marks, aren't read back: the tab
   *   holds them;
   * - on the 5-minute refresh;
   * - at once when asked about a layer it doesn't read.
   *
   * Until then it returns what it holds, which may be about other layers too. When another pull
   * request the poller watches in the repository holds a newer read of these layers, as the layer
   * a stack's tab showed before this one does, it starts from that read.
   */
  async stackLayers(
    pull: PullRef,
    ids: readonly string[],
  ): Promise<Cached<StackLayerList> | undefined> {
    const wall = this.#config.now();
    const maxAge = this.#config.detailsMaxAge;
    let asks = this.#layerAsks.get(pull.key);
    if (!asks) {
      asks = new Map();
      this.#layerAsks.set(pull.key, asks);
    }
    asks.set([...new Set(ids)].toSorted().join('\n'), { ids: [...ids], at: wall });
    for (const [key, ask] of asks) if (wall - ask.at >= maxAge) asks.delete(key);
    // These layers first, in the order asked, then the other sets'.
    const asked = [...ids];
    for (const key of [...asks.keys()].toSorted()) {
      for (const id of asks.get(key)?.ids ?? []) if (!asked.includes(id)) asked.push(id);
    }
    const union = new Set(asked);
    const repo = pull.repo;
    const reading = this.readCached(pull, STACK_LAYERS, (client, known) =>
      readStackLayers(client, repo, asked, known, this.#config.now()),
    );
    const before = this.#layerUnion.get(pull.key);
    this.#layerUnion.set(pull.key, union);
    let cached = await reading;
    cached = this.#adoptStackLayers(pull, union) ?? cached;
    const read = before ?? new Set(cached?.value.ids ?? []);
    if ([...union].some((id) => !read.has(id)))
      this.#readAgain(pull, STACK_LAYERS.name, false, true);
    return cached;
  }

  /**
   * Makes `pull`'s read of its stack's layers start from another watched pull request's of the same
   * repository, when that one read every layer of `ids` after `pull`'s own read: a stack's tab moves
   * from layer to layer, and the layers' state is the same whichever is open. It counts as read at
   * `pull`'s check, so that only a change to `pull` since reads the layers again, when that check is
   * the latest and was seen no later than the read; otherwise the read runs once the check comes.
   */
  #adoptStackLayers(pull: PullRef, ids: ReadonlySet<string>): Cached<StackLayerList> | undefined {
    const state = this.#pulls.get(pull.key);
    const own = state?.reads.get(STACK_LAYERS.name);
    if (!state || !own) return undefined;
    const ownAt = own.value === undefined ? undefined : own.fetchedAt;
    let best: { value: unknown; fetchedAt: number } | undefined;
    for (const other of this.#pulls.values()) {
      if (other.pull.equals(pull) || !other.pull.repo.equals(pull.repo)) continue;
      const read = other.reads.get(STACK_LAYERS.name);
      if (read?.value === undefined || read.fetchedAt === undefined) continue;
      const layers = unchecked<StackLayerList>(read.value);
      if (![...ids].every((id) => layers.ids.includes(id))) continue;
      if (ownAt !== undefined && read.fetchedAt <= ownAt) continue;
      if (!best || read.fetchedAt > best.fetchedAt)
        best = { value: read.value, fetchedAt: read.fetchedAt };
    }
    if (!best) return undefined;
    const check = state.check;
    const seen =
      check !== undefined &&
      check.fetchedAt <= best.fetchedAt &&
      sameJson(state.latestCheck, check.value);
    own.value = best.value;
    own.fetchedAt = best.fetchedAt;
    own.stamp =
      seen && state.latestCheck ? stamp(state.latestCheck, STACK_LAYERS.watched) : undefined;
    return this.cachedRead(pull, STACK_LAYERS);
  }

  /**
   * Reads the state of `pull`'s stack tree's layers again at once, as {@link Poller.stackLayers}
   * keeps it: for a tree whose open pull request list shows a layer at a newer head than the state
   * read for it, which belongs to the head before.
   */
  readStackLayersAgain(pull: PullRef): void {
    this.#readAgain(pull, STACK_LAYERS.name, false, true);
  }

  /**
   * Stops reading the state of `pull`'s stack tree's layers ({@link Poller.stackLayers}), whose
   * tree no longer asks about any. A read under way is dropped when it ends. What the cache holds
   * stays, for if the tree asks again.
   */
  forgetStackLayers(pull: PullRef): void {
    this.#layerAsks.delete(pull.key);
    this.#layerUnion.delete(pull.key);
    if (this.#pulls.get(pull.key)?.reads.delete(STACK_LAYERS.name)) {
      this.#wake();
      this.#changed();
    }
  }

  /** How often Lo lists each watched repository's open pull requests now. */
  listSchedule(): ListSchedule {
    const normal =
      interval('watched', this.#foreground, { kind: 'normal' }, this.#config) ??
      this.#config.watchedInterval;
    const every = interval('watched', this.#foreground, this.#status.rateLimit, this.#config);
    return every !== undefined && !this.#signedOut
      ? { every, listing: true }
      : { every: normal, listing: false };
  }

  /**
   * Lists a watched repository's open pull requests again at once, as for a pull request that
   * opened after the list was read. While Lo doesn't list them, it lists them as soon as it does
   * again.
   */
  listAgain(repo: RepoRef): void {
    const state = this.#repos.get(repo.key);
    if (!state) return;
    state.schedule.force();
    this.#wake();
    this.#changed();
  }

  /**
   * Makes the read of `kind` kept for `pull` due at once, whatever wait its failures set, reading
   * everything again, and returns a mark for {@link Poller.readSince}: what a run that starts after
   * this call reads, as after a write whose answer was lost, to see whether it was done. Nothing
   * when the read isn't kept.
   */
  readAfresh<T>(pull: PullRef, kind: ReadKind<T>): ReadMark | undefined {
    this.#readAgain(pull, kind.name, true, true);
    const read = this.#pulls.get(pull.key)?.reads.get(kind.name);
    return read && { read: read.id, generation: read.generation };
  }

  /**
   * Where the read of `kind` kept for `pull` stands against `mark` ({@link Poller.readAfresh}):
   * what it holds once a run that started after the mark was taken has finished with all of it.
   */
  readSince<T>(pull: PullRef, kind: ReadKind<T>, mark: ReadMark): SinceMark<Cached<T>> {
    const read = this.#pulls.get(pull.key)?.reads.get(kind.name);
    if (!read || read.id !== mark.read) return { kind: 'stale' };
    const past = (run: number | undefined) => run !== undefined && run >= mark.generation;
    if (past(read.finished)) {
      const cached = this.cachedRead(pull, kind);
      return cached ? { kind: 'read', read: cached } : { kind: 'waiting' };
    }
    return past(read.landed) ? { kind: 'partial' } : { kind: 'waiting' };
  }

  /** What the read of `kind` kept for `pull` holds once a run that started after `mark` was taken has finished with all of it: nothing until then. */
  readAfter<T>(pull: PullRef, kind: ReadKind<T>, mark: ReadMark): Cached<T> | undefined {
    const since = this.readSince(pull, kind, mark);
    return since.kind === 'read' ? since.read : undefined;
  }

  /**
   * Makes the read named `name` kept for `pull` due at once, whatever the fields it watches say. A
   * run already under way doesn't stamp what it reads, so it runs again. `afresh`, its next run isn't
   * given the value Lo has, so it reads everything rather than what's new. Unless `forgetFailures`,
   * a read that failed still waits as its failures say.
   */
  #readAgain(pull: PullRef, name: string, afresh: boolean, forgetFailures: boolean): void {
    const read = this.#pulls.get(pull.key)?.reads.get(name);
    if (!read) return;
    read.afresh ||= afresh;
    read.stamp = undefined;
    read.generation += 1;
    if (forgetFailures) {
      read.failures = 0;
      read.retryAt = undefined;
    }
    this.#wake();
    this.#changed();
  }

  /**
   * After a write to `pull`, makes every stack tree that shows it read its layers again a couple of
   * seconds after the last write of a burst, so the burst is read back once. The open pull
   * request's own tree doesn't read back a write to itself: its tab holds what it wrote.
   */
  #layerWritten(pull: PullRef): void {
    const soon = this.#config.monotonic() + WRITES_READ_BACK_AFTER;
    for (const state of this.#pulls.values()) {
      const other = state.pull;
      if (!other.repo.equals(pull.repo) || (other.equals(pull) && this.#open?.equals(pull)))
        continue;
      const read = state.reads.get(STACK_LAYERS.name);
      if (read?.value === undefined) continue;
      const layers = unchecked<StackLayerList>(read.value);
      if (layers.layers.some((layer) => layer.number === pull.number)) read.againAt = soon;
    }
    this.#wake();
    this.#changed();
  }

  /**
   * Runs a write (a comment, a review, viewed marks, a merge) that changes `target`, with the
   * account's client, in the account's queue: after any poll in flight, ahead of waiting polls, and
   * at least a second after the previous write.
   *
   * Afterwards what Lo knows about `target` is out of date, whether or not the write succeeded (a
   * failed one may still have reached GitHub): a pull request's details are fetched in full again,
   * and so are the layers of every stack tree that shows it; a repository's open pull requests are
   * listed again; and either is polled at once if it's watched. A rate limit the write runs into
   * pauses polling as a poll's would.
   *
   * While GitHub has asked Lo to hold off ({@link Poller.writesHeldUntil}), it isn't sent: it waits
   * until then, checking again at its turn in the queue, since a pause can start while it waits.
   *
   * Never sent again by Lo itself: one that failed may still have been done
   * ({@link GithubError.mayHavePosted}). Nothing stops it once it's sent, so closing what asked for
   * it can't cut a merge or a review off halfway.
   */
  write<T>(target: Target, request: (client: GithubClient) => Promise<T>): Promise<T> {
    return this.writeChanging([target], request);
  }

  /**
   * {@link Poller.write} for a write that changes each of `targets`, such as a GitHub stack's pull
   * requests and their repository's list of open ones, run as `options` say: it can make reads due
   * again afterwards, answer something else rather than wait while GitHub has asked Lo to hold off,
   * be given up on before it's sent, and send a write that undoes it in the same turn.
   */
  writeChanging<T>(
    targets: readonly Target[],
    request: (client: GithubClient) => Promise<T>,
    options: WriteOptions<T> = {},
  ): Promise<T> {
    const written = this.#writeChanging(targets, request, options);
    const finished = written.then(() => {}).finally(() => this.#writes.delete(finished));
    this.#writes.add(finished);
    return written.then((result) => {
      if (result.ok) return result.value;
      throw result.error;
    });
  }

  async #writeChanging<T>(
    targets: readonly Target[],
    request: (client: GithubClient) => Promise<T>,
    options: WriteOptions<T>,
  ): Promise<Settled<T>> {
    const { again, whilePaused, content, signal, followUp } = options;
    let result: Settled<T> | undefined;
    while (result === undefined) {
      let client: GithubClient;
      try {
        client = await this.#client();
      } catch (error) {
        return { ok: false, error };
      }
      this.#takeIn(client);
      const until = this.writesHeldUntil();
      if (until !== undefined) {
        if (whilePaused) return { ok: true, value: whilePaused(until) };
        if (signal?.aborted) return { ok: false, error: abandoned(signal) };
        if (this.#stopped) return { ok: false, error: new Error(STOPPED_WAITING) };
        await this.#pause(until, signal);
        continue;
      }
      // Each request the write makes checks first that it hasn't been given up on.
      const sending = signal ? client.gated(givenUpOn(signal)) : client;
      const turn = await settle(
        this.#queue.write(async (): Promise<Settled<T> | undefined> => {
          // The answer of a request before this turn may have asked Lo to hold off: the client
          // recorded it before that request's turn ended.
          this.#takeIn(client);
          if (this.writesHeldUntil() !== undefined) return undefined;
          const answer = await settle(request(sending));
          // Taken in within the turn, so the write after it sees what this one's answer said.
          this.#answeredWith(client, answer);
          this.#heardWrite(client, answer, content ?? false);
          if (answer.ok && followUp) await this.#followUp(client, sending, followUp, answer.value);
          return answer;
        }, signal),
      );
      // Given up on before it was sent.
      if (!turn.ok) return turn;
      result = turn.value;
    }
    const rereads = again?.(result) ?? [];
    for (const target of targets) {
      if (target instanceof PullRef) {
        for (const reread of rereads) this.#readAgain(target, reread.name, reread.afresh, true);
      }
    }
    await Promise.all(targets.map((target) => this.#invalidate(target)));
    return result;
  }

  /**
   * Sends the write `followUp` makes of `answer`, the answer of the write just sent, in the same
   * turn ({@link WriteOptions.followUp}). Whatever it throws is logged and goes no further: the
   * write it follows was sent, and answers as it did.
   */
  async #followUp<T>(
    client: GithubClient,
    sending: GithubClient,
    followUp: (answer: T) => ((client: GithubClient) => Promise<unknown>) | undefined,
    answer: T,
  ): Promise<void> {
    try {
      const next = followUp(answer);
      if (next === undefined) return;
      await new Promise((resolve) => setTimeout(resolve, this.#config.writeSpacing));
      // This write's answer, or anything heard since, may have asked Lo to hold off.
      this.#takeIn(client);
      if (this.writesHeldUntil() !== undefined) return;
      const followed = await settle(Promise.resolve().then(() => next(sending)));
      this.#answeredWith(client, followed);
      this.#heardWrite(client, followed, false);
    } catch (error) {
      this.#log(`a write's follow-up failed: ${String(error)}`);
    }
  }

  /**
   * Until when GitHub has asked Lo to hold off writing, or nothing when it hasn't: while polling is
   * paused by a rate limit, used up or secondary, and for a minute after GitHub turned a write away
   * as content sent too fast, doubling with each in a row. Writes refuse or wait until then, as
   * {@link WriteOptions.whilePaused} says.
   */
  writesHeldUntil(): number | undefined {
    const { now, monotonic, secondaryMaxWait } = this.#config;
    const wall = now();
    const state = rateLimitState(this.#limits, this.#cooldownAt(wall), wall, this.#config);
    const paused = state.kind === 'paused' ? state.until : undefined;
    // Timed by the monotonic clock, so a wall clock set back or forward doesn't stretch or end it.
    const left =
      this.#tooFast === undefined
        ? 0
        : Math.min(this.#tooFast.until - monotonic(), secondaryMaxWait);
    const tooFast = left > 0 ? wall + left : undefined;
    if (paused === undefined || tooFast === undefined) return paused ?? tooFast;
    return Math.max(paused, tooFast);
  }

  /**
   * Waits for a pause until `until` to end, for a write: until then, or `maxWait` at most, since
   * timers stop while the computer sleeps, or until the poller stops or `signal` gives the write up.
   */
  async #pause(until: number, signal: AbortSignal | undefined): Promise<void> {
    const wait = Math.min(Math.max(until - this.#config.now(), 1), this.#config.maxWait);
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        this.#pauseWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, wait);
      signal?.addEventListener('abort', done, { once: true });
      this.#pauseWaiters.add(done);
    });
  }

  /**
   * Takes in a sent write's answer: GitHub turning it away as content sent too fast ("was submitted
   * too quickly") holds every write for a minute, doubling with each in a row up to 15 minutes.
   * GitHub doesn't say which writes count, so it holds them all. A write of content GitHub takes
   * (`content`) ends the run; one of anything else says nothing about that limit. Polls go on:
   * reads aren't content. The run is kept on the account's client, so a poller that replaces this
   * one holds writes as long, and doubles from where this one got to.
   */
  #heardWrite(client: GithubClient, result: Settled<unknown>, content: boolean): void {
    if (!result.ok) return;
    const known = client.tooFast();
    if (!isTooFast(result.value)) {
      if (content && known && !isRefusalValue(result.value)) {
        client.setTooFast({ ...known, inARow: 0 });
        this.#tooFast = client.tooFast();
      }
      return;
    }
    const inARow = (known?.inARow ?? 0) + 1;
    const { secondaryFirstWait, secondaryMaxWait, monotonic } = this.#config;
    const wait = backoff(inARow, secondaryFirstWait, secondaryMaxWait, 0, 0);
    client.setTooFast({ inARow, until: monotonic() + wait });
    this.#tooFast = client.tooFast();
    this.#log(`GitHub turned a write away as sent too fast; writing again in ${wait / 1000} s`);
    this.#changed();
  }

  /** Settles once every write sent or waiting in the account's queue has, with what follows it here. */
  async unfinishedWrites(): Promise<void> {
    while (this.#writes.size > 0) await Promise.all(this.#writes);
  }

  /** Whether any write is sent or waiting in the account's queue. */
  hasUnfinishedWrites(): boolean {
    return this.#writes.size > 0;
  }

  /** How long the account's queue waits between writes, for a write that sends two in its turn. */
  get writeSpacing(): number {
    return this.#config.writeSpacing;
  }

  /**
   * Runs a read that isn't a poll, such as asking how an async merge went, with the account's
   * client, in the account's queue: after any request in flight, and behind waiting writes. Its rate
   * limit is recorded as a poll's is. One given up on through `signal` while it waits is never made.
   */
  async readOnce<T>(
    request: (client: GithubClient) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const client = await this.#client();
    const result = await settle(this.#queue.read(() => request(client), signal));
    this.#answeredWith(client, result);
    if (result.ok) return result.value;
    throw result.error;
  }

  /**
   * Something Lo did changed `target` on GitHub after the write that asked for it returned, as an
   * async merge does when it ends: forgets what makes `target` look current, so it's fetched again,
   * at once if it's watched.
   */
  async changed(target: Target): Promise<void> {
    await this.#invalidate(target);
  }

  /** Sends `write`, which `@lo/review`'s pending review planned for `pull`, reading back what the check can't see ({@link sendReview}). */
  sendReview(pull: PullRef, write: ReviewWrite): Promise<Sent | ReviewWriteRefusal> {
    return sendReview(this, pull, write);
  }

  /** Resolves or unresolves a review thread on `pull` ({@link resolveThreadOn}). */
  resolveThread(
    pull: PullRef,
    thread: string,
    resolved: boolean,
  ): Promise<undefined | ReviewWriteRefusal> {
    return resolveThreadOn(this, pull, thread, resolved);
  }

  /** Replaces the text of a comment on `pull` ({@link editCommentOn}). */
  editComment(
    pull: PullRef,
    comment: CommentId,
    body: string,
  ): Promise<undefined | ReviewWriteRefusal> {
    return editCommentOn(this, pull, comment, body);
  }

  /** Deletes a comment on `pull` ({@link deleteCommentOn}). */
  deleteComment(pull: PullRef, comment: CommentId): Promise<undefined | ReviewWriteRefusal> {
    return deleteCommentOn(this, pull, comment);
  }

  /** Comments on `pull` in its conversation ({@link addConversationCommentOn}). */
  addConversationComment(
    pull: PullRef,
    pullRequestId: string,
    body: string,
  ): Promise<string | ReviewWriteRefusal> {
    return addConversationCommentOn(this, pull, pullRequestId, body);
  }

  /**
   * Asks GitHub to merge `pull` in the background ({@link mergeAsyncOn}). Only `MergeJobs` sends
   * one. One given up on through `signal` while it waits for its turn is never sent.
   */
  mergeAsync(
    pull: PullRef,
    request: MergeRequest,
    signal?: AbortSignal,
  ): Promise<Submitted | MergeRefusal> {
    return mergeAsyncOn(this, pull, request, signal);
  }

  /** Where an async merge stands: a read in the account's queue ({@link mergeAsyncResultOf}). */
  mergeAsyncResult(pull: PullRef, uuid: string, signal?: AbortSignal): Promise<AsyncMerge> {
    return mergeAsyncResultOf(this, pull, uuid, signal);
  }

  /** Adds `pull` to its base branch's merge queue ({@link enqueueOn}). */
  enqueue(
    pull: PullRef,
    pullRequestId: string,
    expectedHead: string,
    jumping: boolean,
  ): Promise<QueueEntry | MergeRefusal> {
    return enqueueOn(this, pull, pullRequestId, expectedHead, jumping);
  }

  /** Takes `pull` out of `branch`'s merge queue, with the layers above it that leave with it ({@link dequeueOn}). */
  dequeue(
    pull: PullRef,
    pullRequestId: string,
    branch: string,
    above: readonly number[],
  ): Promise<Dequeued | MergeRefusal> {
    return dequeueOn(this, pull, pullRequestId, branch, above);
  }

  /** Moves `pull` to the front of its base branch's merge queue ({@link jumpOn}). */
  jump(pull: PullRef, pullRequestId: string, expectedHead: string): Promise<Jumped | MergeRefusal> {
    return jumpOn(this, pull, pullRequestId, expectedHead);
  }

  /** Turns on auto-merge for `pull` ({@link enableAutoMergeOn}). */
  enableAutoMerge(
    pull: PullRef,
    pullRequestId: string,
    request: AutoMergeRequest,
  ): Promise<AutoMergeState | MergeRefusal> {
    return enableAutoMergeOn(this, pull, pullRequestId, request);
  }

  /** Turns auto-merge off for `pull` ({@link disableAutoMergeOn}). */
  disableAutoMerge(pull: PullRef, pullRequestId: string): Promise<AutoMergeState | MergeRefusal> {
    return disableAutoMergeOn(this, pull, pullRequestId);
  }

  /**
   * Makes `prs`, bottom to top, a GitHub stack in `repo` ({@link createStackIn}). Each of these stack
   * writes can be given up on through `signal`, as when the plan it's a step of is cancelled.
   */
  createStack(
    repo: RepoRef,
    prs: readonly number[],
    signal?: AbortSignal,
  ): Promise<GithubStack | MergeRefusal> {
    return createStackIn(this, repo, prs, signal);
  }

  /** Adds `prs` to the top of GitHub stack `stack` in `repo` ({@link addToStackIn}). */
  addToStack(
    repo: RepoRef,
    stack: number,
    prs: readonly number[],
    signal?: AbortSignal,
  ): Promise<GithubStack | MergeRefusal> {
    return addToStackIn(this, repo, stack, prs, signal);
  }

  /** Takes what it can out of GitHub stack `stack` in `repo`, while it holds exactly `prs` ({@link unstackIn}). */
  unstack(
    repo: RepoRef,
    stack: number,
    prs: readonly number[],
    signal?: AbortSignal,
  ): Promise<{ left: GithubStack | undefined } | MergeRefusal> {
    return unstackIn(this, repo, stack, prs, signal);
  }

  /** Moves a pull request in `repo` onto another base branch, as a plan's step does ({@link retargetIn}). */
  retarget(
    repo: RepoRef,
    move: Retarget,
    signal?: AbortSignal,
  ): Promise<PullSummary | MergeRefusal> {
    return retargetIn(this, repo, move, signal);
  }

  /** Runs one step of "Make this a GitHub stack" ({@link runConversionStepIn}). */
  runConversionStep(
    repo: RepoRef,
    step: ConversionStep,
    signal?: AbortSignal,
  ): Promise<StepDone | MergeRefusal> {
    return runConversionStepIn(this, repo, step, signal);
  }

  /**
   * The account's client, for a write or a read outside polls. Throws a `GithubError`:
   * `unauthorized` for a signed-out account, `tokenUnavailable` when its token can't be read now.
   */
  async #client(): Promise<GithubClient> {
    try {
      return await this.#accounts.client(this.#login);
    } catch (error) {
      if (error instanceof GithubError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new GithubError(
        this.#accountSignedOut()
          ? { kind: 'unauthorized', message }
          : { kind: 'tokenUnavailable', message },
        { cause: error },
      );
    }
  }

  /**
   * Takes in what a write's or a read's answer says about the account: GitHub answered, so it's not
   * offline; the rate limits it reported; and a rate limit it ran into, which pauses polling as a
   * poll's would.
   */
  #answeredWith(client: GithubClient, result: Settled<unknown>): void {
    if (answered(result)) this.#offline = undefined;
    this.#takeIn(client);
  }

  /**
   * Takes in what the account's answers said about the rate limit: what's left of each limit, and
   * each refusal the client heard that isn't taken in yet, which pauses polling and writes as
   * {@link Poller.#rateLimited} says, from when GitHub answered. A refusal heard long before, as by
   * the client of a poller this one replaced, asks for a pause that's over. Also the run of writes
   * GitHub turned away as content sent too fast, which holds writes ({@link Poller.#heardWrite}).
   */
  #takeIn(client: GithubClient): void {
    this.#limits = client.rateLimits();
    this.#tooFast = client.tooFast();
    for (const heard of client.rateLimited()) {
      if (this.#heardLimits.has(heard)) continue;
      this.#heardLimits.add(heard);
      this.#log(`GitHub's rate limit: ${heard.detail.message}`);
      this.#rateLimited(heard);
    }
    this.#refreshStatus();
  }

  /**
   * The pause GitHub asked for in a refusal, as the governor takes it at `wall`: until a wall-clock
   * time. One timed by the monotonic clock ends after the time it has left, however the wall clock
   * has been set since.
   */
  #cooldownAt(wall: number): Cooldown | undefined {
    const pause = this.#cooldown;
    if (pause === undefined || pause.clock === 'wall') return pause;
    const left = pause.until - this.#config.monotonic();
    return left > 0 ? { until: wall + left, reason: pause.reason } : undefined;
  }

  /** Forgets what makes `target` look current, so it's fetched again, at once if it's watched. */
  async #invalidate(target: Target): Promise<void> {
    let name: string;
    if (target instanceof PullRef) {
      const state = this.#pulls.get(target.key);
      if (state) {
        state.check = undefined;
        state.schedule.force();
      }
      this.#layerWritten(target);
      name = CHECK;
    } else {
      const state = this.#repos.get(target.key);
      if (state) {
        state.listed = undefined;
        state.written += 1;
        state.schedule.force();
      }
      name = LISTED;
    }
    this.#wake();
    this.#changed();
    try {
      await this.#cache.remove(this.#login, target.key, name);
    } catch (error) {
      this.#log(`writing the cache: ${String(error)}`);
    }
  }

  #recordRecent(pull: PullRef): void {
    const openedAt = this.#openedAt;
    if (openedAt === undefined) return;
    const title = this.#pulls.get(pull.key)?.details?.value.title;
    void this.#cache
      .recordRecent({ pull, title, login: this.#login, openedAt })
      .catch((error: unknown) => this.#log(`recording a recent pull request: ${String(error)}`));
  }

  #emit(event: PollEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  #changed(): void {
    for (const observer of this.#observers) observer();
  }

  #wake(): void {
    this.#woken = true;
    this.#wakeUp?.();
  }

  /** Waits `wait`, or until woken. A wake while nothing waits ends the next wait at once. */
  async #sleep(wait: number): Promise<void> {
    if (!this.#woken) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          this.#wakeUp = undefined;
          resolve();
        };
        const timer = setTimeout(done, wait);
        this.#wakeUp = done;
      });
    }
    this.#woken = false;
  }

  #refreshStatus(): void {
    const now = this.#config.now();
    const status: PollStatus = {
      rateLimit: rateLimitState(this.#limits, this.#cooldownAt(now), now, this.#config),
      offline: this.#offline && { ...this.#offline.status },
      signedOut: this.#signedOut,
    };
    if (!sameJson(status, this.#status)) {
      this.#status = status;
      this.#changed();
    }
  }

  /** The next poll to run, or how long to wait for one. */
  #nextStep(): Step {
    this.#refreshStatus();
    if (this.#signedOut) return { kind: 'wait', wait: undefined };
    const config = this.#config;
    const now = config.monotonic();
    const wall = config.now();
    const rateLimit = this.#status.rateLimit;
    if (rateLimit.kind === 'paused') {
      return { kind: 'wait', wait: Math.max(rateLimit.until - wall, 1) };
    }
    const due = (schedule: Schedule, tier: Tier): number | undefined => {
      const every = interval(tier, this.#foreground, rateLimit, config);
      if (every === undefined) return undefined;
      return schedule.lastPolled !== undefined && !schedule.isForced()
        ? schedule.lastPolled + every
        : now;
    };

    // The open pull request first, then the other pull requests, then the repositories; earliest
    // due first.
    let next: { at: number; job: Job; ticket: number; forced: boolean } | undefined;
    const consider = (schedule: Schedule, tier: Tier, job: () => Job) => {
      const at = due(schedule, tier);
      if (at !== undefined && (next === undefined || at < next.at)) {
        next = { at, job: job(), ticket: schedule.forced, forced: schedule.isForced() };
      }
    };
    // In the foreground, and unless the rate limit is very low, details older than
    // `detailsMaxAge` are fetched again whatever the check says.
    const refreshDetails = this.#foreground && rateLimit.kind !== 'openOnly';
    const open = this.#open;
    const openState = open && this.#pulls.get(open.key);
    if (open && openState && openState.loading.length === 0) {
      consider(openState.schedule, 'open', () => ({
        kind: 'open',
        pull: open,
        summary: openState.summary?.value,
        check:
          openState.check &&
          (!refreshDetails || wall - openState.check.fetchedAt < config.detailsMaxAge)
            ? openState.check.value
            : undefined,
        haveDetails: openState.details !== undefined,
      }));
    }
    for (const state of sorted(this.#pulls.values(), (a, b) => PullRef.compare(a.pull, b.pull))) {
      if (open?.equals(state.pull) || state.loading.length > 0) continue;
      consider(state.schedule, 'watched', () => ({
        kind: 'watched',
        pull: state.pull,
        summary: state.summary?.value,
      }));
    }
    for (const state of sorted(this.#repos.values(), (a, b) => RepoRef.compare(a.repo, b.repo))) {
      if (state.loading.length > 0) continue;
      const ready = (retryAt: number | undefined) => retryAt === undefined || retryAt <= now;
      const rules = state.rules;
      const rulesDue =
        rules === undefined ||
        (rules.value.unavailable !== undefined
          ? ready(state.rulesRetryAt)
          : wall - rules.fetchedAt >= TRUNK_RULES_MAX_AGE);
      const truncated = state.list?.value.mergedTruncated ?? false;
      consider(state.schedule, 'watched', () => ({
        kind: 'repo',
        repo: state.repo,
        listed: state.listed?.value,
        list: state.list?.value,
        carry: state.list !== undefined && wall - state.list.fetchedAt < CARRY_MAX_AGE,
        retryLookups: truncated && ready(state.lookupRetryAt),
        rules: rules?.value,
        readRules: rulesDue,
        written: state.written,
      }));
    }
    // The open pull request's reads, once its check says what they watch.
    if (
      open &&
      openState &&
      openState.latestCheck !== undefined &&
      openState.loading.length === 0 &&
      interval('open', this.#foreground, rateLimit, config) !== undefined
    ) {
      const check = openState.latestCheck;
      const reads = sorted(openState.reads, ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      for (const [name, read] of reads) {
        // What the cache holds is still loading.
        if (read.loading) continue;
        const current = stamp(check, read.kind.watched);
        let at: number | undefined;
        if (read.value === undefined || read.stamp !== current) {
          at = now;
        } else if (refreshDetails && read.fetchedAt !== undefined) {
          at = now + Math.max(config.detailsMaxAge - (wall - read.fetchedAt), 0);
        }
        // A write reads it back a little later.
        if (read.againAt !== undefined)
          at = at === undefined ? read.againAt : Math.min(at, read.againAt);
        // A read that keeps failing waits longer each time, whatever made it due.
        if (at !== undefined && read.retryAt !== undefined) at = Math.max(at, read.retryAt);
        if (at !== undefined && (next === undefined || at < next.at)) {
          next = {
            at,
            job: {
              kind: 'read',
              pull: open,
              read: {
                name,
                run: read.run,
                known: read.afresh ? undefined : read.value,
                stamp: current,
                generation: read.generation,
                started: now,
              },
            },
            ticket: 0,
            forced: false,
          };
        }
      }
    }
    // While the limit is low, intervals are longer and some tiers aren't polled at all. Wake at its
    // reset, when they're back.
    const untilReset =
      rateLimit.kind === 'slowed' || rateLimit.kind === 'openOnly'
        ? Math.max(rateLimit.low.reset - wall, 1)
        : undefined;
    const chosen: { at: number; job: Job; ticket: number; forced: boolean } | undefined = next;
    if (chosen === undefined) return { kind: 'wait', wait: untilReset };
    let at = chosen.at;
    // Opening a pull request or coming back to the foreground tries at once, whatever the backoff.
    const offline = this.#offline;
    if (offline && !chosen.forced) {
      at = Math.max(at, offline.retryAt);
      // The banner says when the next try really is, which can be after the backoff.
      const retryAt = wall + Math.max(at - now, 0);
      if (offline.status.retryAt !== retryAt) {
        offline.status.retryAt = retryAt;
        this.#refreshStatus();
      }
    }
    if (at <= now) return { kind: 'run', job: chosen.job, ticket: chosen.ticket };
    const wait = at - now;
    return { kind: 'wait', wait: untilReset === undefined ? wait : Math.min(wait, untilReset) };
  }

  /** The poll loop: runs whatever is due, one poll at a time, and sleeps until the next is due or something changes. */
  async #loop(): Promise<void> {
    while (!this.#stopped) {
      const step = this.#nextStep();
      if (step.kind === 'wait') {
        // Timers stop while the computer sleeps, and waits are worked out from the wall clock, so
        // none is trusted for longer than `maxWait`.
        const max = this.#config.maxWait;
        await this.#sleep(step.wait === undefined ? max : Math.min(step.wait, max));
        continue;
      }
      const { job, ticket } = step;
      let client: GithubClient;
      try {
        client = await this.#accounts.client(this.#login);
      } catch (error) {
        this.#lostClient(targetOf(job), ticket, error);
        continue;
      }
      if (this.#stopped) return;
      const result = await this.#run(job, client);
      const writes = this.#finish(job, ticket, result, client);
      for (const write of writes) {
        try {
          await write();
        } catch (error) {
          this.#log(`writing the cache: ${String(error)}`);
        }
      }
    }
  }

  /**
   * Runs `job`. Its requests start only once it holds the queue. A read, which can be many requests,
   * takes a turn for each, so a write can go between them; so do a repository's rulesets and
   * lookups, after its open pull requests.
   */
  async #run(job: Job, client: GithubClient): Promise<Settled<Outcome>> {
    switch (job.kind) {
      case 'read': {
        const gated = client.gated(this.#queue.gate());
        const { read } = job;
        return settle(
          read.run(gated, read.known).then((value): Outcome => ({
            kind: 'read',
            name: read.name,
            value,
            stamp: read.stamp,
            generation: read.generation,
            started: read.started,
          })),
        );
      }
      case 'repo': {
        const listed = await settle(this.#queue.read(() => pollRepo(client, job)));
        if (!listed.ok) return listed;
        const gated = client.gated(this.#queue.gate());
        return settle(this.#finishRepo(gated, job, listed.value));
      }
      case 'open':
      case 'watched':
        return settle(this.#queue.read(() => pollPull(client, job)));
      default:
        return job satisfies never;
    }
  }

  /**
   * The rest of a repository's poll, after its open pull requests: its rulesets, when they're due,
   * then the merged pull requests its stacks link through, for a new list or for one whose lookups
   * stopped short.
   */
  async #finishRepo(
    client: GithubClient,
    job: Extract<Job, { kind: 'repo' }>,
    outcome: Extract<Outcome, { kind: 'repo' }>,
  ): Promise<Outcome> {
    let list = outcome.list;
    if (list === undefined && job.retryLookups && job.list) {
      list = { ...structuredClone(job.list), lookups: [], mergedTruncated: false };
    }
    let rules: TrunkRuleList | undefined;
    if (job.readRules || job.rules === undefined) {
      const basis = list ?? job.list;
      rules = await readTrunkRules(
        client,
        job.repo,
        job.rules,
        basis ? branchesToCheck(basis) : [],
      );
    }
    if (list && this.#lookUpMerged) {
      const inForce = rules ?? job.rules ?? noTrunkRules();
      const carried = job.carry ? job.list : undefined;
      await this.#lookUpMerged(client, job.repo, list, carried, inForce, this.#config.now());
    }
    return { kind: 'repo', listed: outcome.listed, list, rules, written: job.written };
  }

  /** Takes in a poll's answer: updates what's known, sends events, and returns the cache writes to make. */
  #finish(job: Job, ticket: number, result: Settled<Outcome>, client: GithubClient): CacheWrite[] {
    this.#takeIn(client);
    const now = this.#config.monotonic();
    const wall = this.#config.now();
    const target = targetOf(job);
    const read = job.kind === 'read' ? job.read.name : undefined;
    let writes: CacheWrite[] = [];
    if (answered(result)) this.#offline = undefined;
    if (result.ok) {
      this.#secondaryAttempts = 0;
      this.#failures.delete(target.key);
      // A read keeps its own times, apart from its pull request's polls.
      if (read === undefined) this.#schedule(target)?.polled(now, ticket);
      writes = this.#apply(result.value, target, wall);
    } else {
      const detail = detailOf(result.error);
      if (detail.kind === 'network' || detail.kind === 'tokenUnavailable') {
        if (read === undefined) this.#schedule(target)?.serve(ticket);
        this.#backOff(new GithubError(detail).message, now, wall);
      } else if (detail.kind === 'rateLimited') {
        // Taken in from the client above, as it heard it.
      } else if (detail.kind === 'unauthorized' && this.#accounts.isSignedOut(this.#login)) {
        // The client's renewal has already signed the account out, or read a newer token from `gh`
        // for an account imported from it.
        this.#signedOut = true;
      } else if (read !== undefined && target instanceof PullRef) {
        this.#log(`reading ${read} for ${target.toString()}: ${new GithubError(detail).message}`);
        this.#readFailed(target, read, now);
        if (this.#isWatched(target)) {
          this.#emit({ kind: 'readFailed', pull: target, name: read, error: detail });
        }
      } else {
        // Logged once while it keeps failing the same way.
        const message = new GithubError(detail).message;
        if (this.#failures.get(target.key) !== message) {
          this.#log(`polling ${target.toString()}: ${message}`);
          this.#failures.set(target.key, message);
        }
        if (this.#isWatched(target)) {
          this.#schedule(target)?.polled(now, ticket);
          this.#emit({ kind: 'failed', target, error: detail });
        }
      }
    }
    this.#refreshStatus();
    this.#changed();
    return writes;
  }

  /**
   * Notes that a read failed, or gave a value that isn't complete, so it waits before it's read
   * again: the open pull request's interval, doubling with each failure in a row, up to the
   * 5-minute refresh's.
   */
  #readFailed(pull: PullRef, name: string, now: number): void {
    const read = this.#pulls.get(pull.key)?.reads.get(name);
    if (!read) return;
    const { openInterval, detailsMaxAge, jitter, random } = this.#config;
    read.failures += 1;
    read.retryAt = now + backoff(read.failures, openInterval, detailsMaxAge, jitter, random());
  }

  /**
   * Pauses polling as a rate-limit refusal `heard` asks, from when the client heard it: until the
   * limit that was hit resets, or, for GitHub's secondary limits, for as long as GitHub asked or a
   * minute doubling.
   *
   * A reset is a time by GitHub's clock, so that pause stays on the wall clock, and ends on time
   * when the computer sleeps through it. A wait is timed from the refusal by the monotonic clock, so
   * a wall clock set forward doesn't end it early, nor one set back stretch it.
   */
  #rateLimited(heard: HeardLimit): void {
    const { detail, at: wall, monotonic: from } = heard;
    const usedUp = (resource: string) => this.#limits.get(resource)?.remaining === 0;
    // The limit GitHub names, else whichever is at zero. With none at zero, it can only have been a
    // secondary limit.
    const resource = detail.secondary
      ? undefined
      : detail.resource !== undefined && usedUp(detail.resource)
        ? detail.resource
        : ['graphql', 'core'].find(usedUp);
    if (resource !== undefined) {
      // A reset GitHub's clock or a proxy put too far off waits an hour at most.
      const latest = wall + MAX_RETRY_AFTER * 1000;
      const reset = detail.reset ?? this.#limits.get(resource)?.reset;
      const until = reset === undefined ? undefined : Math.min(reset * 1000, latest);
      const reason: PauseReason = { kind: 'usedUp', resource };
      // Without a reset still to come, a minute.
      this.#cooldown =
        until !== undefined && until > wall
          ? { clock: 'wall', until, reason }
          : { clock: 'monotonic', until: from + this.#config.secondaryFirstWait, reason };
    } else {
      this.#secondaryAttempts += 1;
      const wait =
        detail.retryAfter !== undefined
          ? detail.retryAfter * 1000
          : backoff(
              this.#secondaryAttempts,
              this.#config.secondaryFirstWait,
              this.#config.secondaryMaxWait,
              0,
              0,
            );
      this.#cooldown = { clock: 'monotonic', until: from + wait, reason: { kind: 'secondary' } };
    }
  }

  #isWatched(target: Target): boolean {
    return target instanceof PullRef ? this.#pulls.has(target.key) : this.#repos.has(target.key);
  }

  /** A watched pull request's or repository's schedule. */
  #schedule(target: Target): Schedule | undefined {
    return target instanceof PullRef
      ? this.#pulls.get(target.key)?.schedule
      : this.#repos.get(target.key)?.schedule;
  }

  #apply(outcome: Outcome, target: Target, wall: number): CacheWrite[] {
    const writes: CacheWrite[] = [];
    const login = this.#login;
    const cache = this.#cache;
    const put = (name: string, value: unknown, stamped?: string) =>
      writes.push(() =>
        cache.put(login, target.key, [{ name, entry: { value, fetchedAt: wall, stamp: stamped } }]),
      );
    const touch = (name: string) => writes.push(() => cache.touch(login, target.key, name, wall));
    // Every head a poll brings is noted as seen, once for each answer that brings it anew.
    const see = (pull: PullRef, heads: (string | undefined)[]) => {
      const seen = this.#seen;
      const unique = [...new Set(heads.filter((head) => head !== undefined))].toSorted();
      if (seen && unique.length > 0) writes.push(() => seen(login, pull, unique, wall));
    };
    switch (outcome.kind) {
      case 'open': {
        if (!(target instanceof PullRef)) return writes;
        const state = this.#pulls.get(target.key);
        if (!state) return writes;
        const summary = takeSummary(state, outcome.summary, wall);
        const check = outcome.check;
        const changedCheck = sameJson(state.latestCheck, check) ? undefined : check;
        if (changedCheck) state.latestCheck = check;
        let changedDetails: PullRequest | undefined;
        if (outcome.details) {
          const details = outcome.details;
          if (!state.details || !sameJson(state.details.value, details)) changedDetails = details;
          state.details = { value: details, fetchedAt: wall };
          state.check = { value: check, fetchedAt: wall };
          // Together, so a restart never pairs old details with a newer check.
          writes.push(() =>
            cache.put(login, target.key, [
              { name: DETAILS, entry: { value: details, fetchedAt: wall } },
              { name: CHECK, entry: { value: check, fetchedAt: wall } },
            ]),
          );
        } else {
          // Nothing changed: the details are current as of now.
          if (state.details) state.details.fetchedAt = wall;
          touch(DETAILS);
        }
        see(target, [summary?.head.sha, changedCheck?.headRefOid, changedDetails?.headRefOid]);
        if (summary) {
          put(SUMMARY, summary);
          this.#emit({ kind: 'summary', pull: target, summary });
        } else {
          touch(SUMMARY);
        }
        if (changedCheck) this.#emit({ kind: 'check', pull: target, check: changedCheck });
        if (changedDetails) {
          if (this.#open?.equals(target)) this.#recordRecent(target);
          this.#emit({ kind: 'details', pull: target, details: changedDetails });
        }
        return writes;
      }
      case 'watched': {
        if (!(target instanceof PullRef)) return writes;
        const state = this.#pulls.get(target.key);
        if (!state) return writes;
        const summary = takeSummary(state, outcome.summary, wall);
        if (summary) {
          // The details need fetching again when it's opened, even if the check doesn't show what
          // changed.
          state.check = undefined;
          see(target, [summary.head.sha]);
          writes.push(() => cache.remove(login, target.key, CHECK));
          put(SUMMARY, summary);
          this.#emit({ kind: 'summary', pull: target, summary });
        } else {
          touch(SUMMARY);
        }
        return writes;
      }
      case 'repo': {
        if (!(target instanceof RepoRef)) return writes;
        const state = this.#repos.get(target.key);
        if (!state) return writes;
        const { watchedInterval, jitter, random } = this.#config;
        const now = this.#config.monotonic();
        const { rules, list, listed } = outcome;
        if (rules) {
          if (rules.unavailable !== undefined) {
            state.rulesFailures += 1;
            const wait = backoff(
              state.rulesFailures,
              watchedInterval,
              TRUNK_RULES_MAX_AGE,
              jitter,
              random(),
            );
            state.rulesRetryAt = now + wait;
          } else {
            state.rulesFailures = 0;
            state.rulesRetryAt = undefined;
          }
          const changed = !state.rules || !sameJson(state.rules.value, rules);
          state.rules = { value: rules, fetchedAt: wall };
          put(RULES, rules);
          if (changed) this.#emit({ kind: 'trunkRules', repo: target });
        }
        // A write changed the open pull requests since this poll was chosen, so it may have read
        // them before the write: neither they nor their ETags are kept. The poll the write asked
        // for, still owed, reads them again in full.
        if (outcome.written !== state.written) return writes;
        // Lookups that stopped short run again after a wait, if the pull requests don't change.
        if (list) {
          if (list.mergedTruncated) {
            state.lookupFailures += 1;
            const wait = backoff(
              state.lookupFailures,
              watchedInterval,
              TRUNK_RULES_MAX_AGE,
              jitter,
              random(),
            );
            state.lookupRetryAt = now + wait;
          } else {
            state.lookupFailures = 0;
            state.lookupRetryAt = undefined;
          }
        }
        if (state.listed && sameJson(state.listed.value, listed)) {
          state.listed.fetchedAt = wall;
          touch(LISTED);
        } else {
          // New ETags, if nothing else.
          state.listed = { value: listed, fetchedAt: wall };
          put(LISTED, listed);
        }
        if (list) {
          const changed = !state.list || !sameJson(state.list.value, list);
          state.list = { value: list, fetchedAt: wall };
          put(LIST, list);
          if (changed) this.#emit({ kind: 'openPullRequests', repo: target, list });
        } else {
          if (state.list) state.list.fetchedAt = wall;
          touch(LIST);
        }
        return writes;
      }
      case 'read': {
        if (!(target instanceof PullRef)) return writes;
        const read = this.#pulls.get(target.key)?.reads.get(outcome.name);
        if (!read) return writes;
        const { value, generation, started } = outcome;
        const changed = read.value === undefined || !sameJson(read.value, value);
        // A value that isn't complete is kept without a stamp, so it's read again once its wait is
        // over. So is one whose read started before it was asked to read again, which it then does
        // at once.
        const complete = read.kind.complete(value);
        const current = generation === read.generation;
        const stamped = complete && current ? outcome.stamp : undefined;
        const restamped = read.stamp !== stamped;
        if (current) read.afresh = false;
        read.value = value;
        read.stamp = stamped;
        read.fetchedAt = wall;
        // Every mark taken before this run started is past.
        if (current) {
          read.landed = generation;
          if (complete) read.finished = generation;
        }
        // A write's read-back is done once a read started after it was due.
        if (read.againAt !== undefined && read.againAt <= started) read.againAt = undefined;
        if (complete) {
          read.failures = 0;
          read.retryAt = undefined;
        }
        if (changed) put(outcome.name, value, stamped);
        else if (restamped) {
          writes.push(() => cache.touch(login, target.key, outcome.name, wall, { stamp: stamped }));
        } else touch(outcome.name);
        if (!complete) this.#readFailed(target, outcome.name, this.#config.monotonic());
        this.#emit({ kind: changed ? 'read' : 'confirmed', pull: target, name: outcome.name });
        return writes;
      }
      default:
        return outcome satisfies never;
    }
  }

  /**
   * Waits longer each time before trying again, while GitHub can't be reached or the account's
   * token can't be read, and says so in the status.
   */
  #backOff(error: string, now: number, wall: number): void {
    const attempts = (this.#offline?.attempts ?? 0) + 1;
    const { offlineFirstWait, offlineMaxWait, jitter, random } = this.#config;
    const wait = backoff(attempts, offlineFirstWait, offlineMaxWait, jitter, random());
    this.#log(`${error}; trying again in ${Math.round(wait / 1000)} s`);
    this.#offline = {
      attempts,
      retryAt: now + wait,
      status: { since: this.#offline?.status.since ?? wall, retryAt: wall + wait, error },
    };
    this.#changed();
  }

  /** Whether the accounts say the account is signed out, or it's gone. Only then is it signed out here. */
  #accountSignedOut(): boolean {
    return (
      this.#accounts.account(this.#login) === undefined || this.#accounts.isSignedOut(this.#login)
    );
  }

  /**
   * There was no client for a poll. A signed-out account stops polling until it signs in again;
   * anything else, such as a token that can't be read now, is tried again later.
   */
  #lostClient(target: Target, ticket: number, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (this.#accountSignedOut()) {
      this.#log(`not polling for ${this.#login}: ${message}`);
      this.#signedOut = true;
    } else {
      this.#schedule(target)?.serve(ticket);
      this.#backOff(message, this.#config.monotonic(), this.#config.now());
    }
    this.#refreshStatus();
  }
}

/** A conditional GET of a pull request, asking about changes since GitHub last updated the summary Lo has. */
function getSummary(
  client: GithubClient,
  pull: PullRef,
  known: PullSummary | undefined,
): Promise<Conditional<PullSummary>> {
  const since = known && pullLastModified(known);
  return client.getModifiedSince(pull.restPath(), since, readPullSummary);
}

/** Whether GitHub's answer holds a summary other than the one Lo has. A `200` can bring the same one back. */
function summaryChanged(answer: Conditional<PullSummary>, known: PullSummary | undefined): boolean {
  return !answer.notModified && (known === undefined || !sameJson(known, answer.value));
}

/**
 * Takes in GitHub's answer about a pull request, returning its summary when it changed. A `304`,
 * or a `200` with the same summary, only confirms the one Lo has.
 */
function takeSummary(
  state: PullState,
  answer: Conditional<PullSummary>,
  wall: number,
): PullSummary | undefined {
  if (answer.notModified || !summaryChanged(answer, state.summary?.value)) {
    if (state.summary) state.summary.fetchedAt = wall;
    return undefined;
  }
  state.summary = { value: answer.value, fetchedAt: wall };
  return answer.value;
}

/** A pull request's poll: the open one's, or another watched one's. */
async function pollPull(
  client: GithubClient,
  job: Extract<Job, { kind: 'open' | 'watched' }>,
): Promise<Outcome> {
  const summary = await getSummary(client, job.pull, job.summary);
  if (job.kind === 'watched') return { kind: 'watched', summary };
  const { owner, name } = job.pull.repo;
  const check = await pullRequestCheck(client, owner, name, job.pull.number);
  const changed =
    !job.haveDetails || summaryChanged(summary, job.summary) || !sameJson(job.check, check);
  const details = changed ? await pullRequest(client, owner, name, job.pull.number) : undefined;
  return { kind: 'open', summary, check, details };
}

/**
 * A repository's open pull requests: conditional GETs of them, a page at a time while pages are
 * full, each with the ETag Lo has for it, then the full list when they changed.
 */
async function pollRepo(
  client: GithubClient,
  job: Extract<Job, { kind: 'repo' }>,
): Promise<Extract<Outcome, { kind: 'repo' }>> {
  const { repo } = job;
  const listed: ListedPulls = { pages: [] };
  for (let number = 1; number <= MAX_LISTED_PAGES; number++) {
    const known = job.listed?.pages[number - 1];
    const answer = await client.getConditional(
      repo.openPullsPath(number),
      known?.etag,
      readListedPulls,
    );
    let page: ListedPage;
    if (!answer.notModified) {
      page = { etag: answer.etag, pulls: answer.value };
    } else if (known) {
      page = known;
    } else {
      throw new GithubError({
        kind: 'inconsistent',
        message: `GitHub said page ${number} of ${repo.toString()}'s open pull requests hadn't changed, but Lo never read it`,
      });
    }
    listed.pages.push(page);
    if (page.pulls.length < PAGE_SIZE) break;
  }
  const changed = job.listed === undefined || !listsTheSame(job.listed, listed);
  const list =
    changed || job.list === undefined
      ? await openPullRequestsPaged(client, repo, PAGE_SIZE, RECENTLY_UPDATED_MERGED)
      : undefined;
  return { kind: 'repo', listed, list, rules: undefined, written: job.written };
}
