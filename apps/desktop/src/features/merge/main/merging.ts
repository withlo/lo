// Merging, in main: `⏎` in the merge panel plans the merge from what GitHub said last, and the plan
// is kept under a key for the reader to confirm; the window confirms the key and never sends the
// merge itself. A plan runs once. As it's confirmed, main checks it again: the view still acts as
// the plan's account, signed in; what GitHub said is whole, at the head on screen, which is still
// GitHub's head, and confirmed in the last 7 minutes, else it's read again; where the pull request
// sits is known, from the stacks' list and the open pull requests read afresh from each branch the
// merge goes into, and it's alone or a GitHub stack's bottom layer; nothing else merges it; no
// conversion to a GitHub stack runs on its path; and GitHub can be reached and isn't holding writes.
// When something the confirmation named changed, by then or in a read that lands while it checks,
// it asks again with a new plan. Cancelled while it checks, it stops, its reads given up, and sends
// nothing; right before it sends, the tab, the account and the connection are checked once more.
//
// The merge goes through the app's one `MergeJobs`, in the pull request's turn among merge writes,
// with the head on screen as its `sha`, so GitHub merges only that head. A job outlives its view.
// A GitHub stack's layer merges with the open layers below it, each named with its head as GitHub's
// Stacks API gave it, and the merge holds the turn of every layer it names; Lo reads the stack at
// each change of the merge, to say how far it got. A chain that can't be a GitHub stack merges from
// its bottom layer, and Lo moves the layers on it onto the root once that merged (`./chains.ts`),
// holding their turns meanwhile.
// The method is remembered for the repository once GitHub takes a merge with it. A merge whose end
// Lo can't tell is settled by reading the pull request, never by sending it again, and holds the
// pull request's turn until a read made after it ended does. Asked again how it went, it holds the
// turns it held again, each as soon as no other write holds it. Nothing here calls Electron.
//
// `a` plans auto-merge, and `⌥⏎` a merge past the base branch's rules, the same way, and each is
// checked the same way as it's confirmed, a merge past the rules only with the pull request's number
// typed. That merge goes through the jobs as any merge does; auto-merge is one request, sent in the
// pull request's turn with the head on screen, which GitHub turns on only while it's the head. When
// GitHub won't turn it on because nothing blocks the merge now, Lo reads the pull request again and
// offers the merge in its place, for the reader to confirm. With auto-merge on, `a` turns it off at
// once, in the turn too. An answer to either that Lo can't read is settled by reading the pull
// request, as a merge's is.
//
// Approve and ship (`./ship.ts`) weighs its press as a merge's press is weighed, asks what its
// merge takes with it the same way, and sends the step after its approval here too, in the turns it
// took at the press; the auto-merge watch (`./watch.ts`) turns auto-merge off the same way, each
// hearing GitHub's answer to auto-merge's write.

import {
  adminOverride,
  describeMergeRefusal,
  directMerge,
  factsOnto,
  GithubError,
  isFullSha,
  isRefusal,
  MERGE_FACTS,
  openPullRequest,
  openPullsFromHead,
  pullRequestCheck,
  PullRef,
  queueMerge,
  rulesBase,
  rulesOnto,
  STACK_LAYERS,
  stackHolding,
  stacksHolding,
  withCommit,
  withLayersBelow,
  type Cached,
  type GithubClient,
  type GithubErrorDetail,
  type AutoMergeState,
  type Job,
  type MergeFacts,
  type MergeJobs,
  type MergePoller as JobsPoller,
  type MergeRefusal,
  type MergeRequest,
  type Outcome,
  type PollEvent,
  type Poller,
  type ReadKind,
  type ReadPriority,
  type RepoRef,
} from '@lo/github';
import {
  allowedMethods,
  checksCutShort,
  incomplete,
  mergeAction,
  mergeSnapshot,
  methodList,
  pickedMethod,
  type MergeSnapshot,
} from '@lo/review';

import type { Converting, Forest } from '../../stacks/service.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type {
  Asked,
  AutoAction,
  Confirmed,
  JobState,
  JobView,
  LayerState,
  MergePlan,
  Method,
  Off,
  OverrideAction,
  Placement,
  PlanKind,
  Planned,
  Progress,
  Refusal,
  Together,
  WriteKind,
} from '../contract.ts';
import type { MergeTurn, MergeWrites } from '../service.ts';
import { aboveStackBottom, aloneOrBottom, autoActionOf, overrideActionOf } from './auto.ts';
import { ChainRun, type Looked } from './chains.ts';
import { namedOf } from './status.ts';
import {
  convertFirst,
  layerState,
  namesOf,
  needsStacks,
  numbers,
  placementOf,
  takingOf,
  togetherChanged,
  togetherOf,
  type Taking,
} from './together.ts';
import type { MergeTurns } from './turns.ts';
import {
  leftToLookUp,
  placedBy,
  unmergedIn,
  where,
  type OpenFromHead,
  type Where,
} from './where.ts';

/** How long what GitHub said of a merge is taken as current at the press: 7 minutes. */
export const FRESH_FOR = 7 * 60_000;

/** How many times the checks at a press weigh it, when reads land while they wait: 3. */
export const LOOKS = 3;

/** What merging uses of an account's poller. */
export interface MergingPoller
  extends
    Omit<JobsPoller, 'readOnce'>,
    Pick<
      Poller,
      | 'mergeFacts'
      | 'readAfresh'
      | 'readSince'
      | 'readMergeFactsAgain'
      | 'onEvent'
      | 'status'
      | 'writesHeldUntil'
      | 'listAgain'
      | 'pullRequest'
      | 'enableAutoMerge'
      | 'disableAutoMerge'
      | 'openPullRequests'
      | 'runConversionStep'
    > {
  cachedRead<T>(pull: PullRef, kind: ReadKind<T>): Cached<T> | undefined;
  readOnce<T>(
    request: (client: GithubClient) => Promise<T>,
    signal?: AbortSignal,
    priority?: ReadPriority,
  ): Promise<T>;
}

/** What merging uses of the app's merge jobs. */
export type Jobs = Pick<MergeJobs, 'merge' | 'job' | 'onChange' | 'followAgain' | 'forget'>;

export interface MergingOptions {
  /** An account's poller. Throws for an account Lo doesn't have. */
  readonly poller: (login: string) => Promise<MergingPoller>;
  /** What main has of a view now, or nothing once it's closed. */
  readonly view: (id: string) => PullTabInfo | undefined;
  /** The head on screen in view `id`: the newer side of what it compares. */
  readonly headOnScreen: (id: string) => string | undefined;
  /**
   * Whether view `id`'s head holds its base branch's tip, as its merge status last had it from the
   * local copy: nothing when it can't tell, or the rules don't ask.
   */
  readonly headContainsBase: (id: string) => boolean | undefined;
  /** The merge method last used in `repo`, if Lo remembers one. */
  readonly method: (repo: RepoRef) => Method | undefined;
  /** Remembers `method` as the one last used in `repo`. */
  readonly remember: (repo: RepoRef, method: Method) => void;
  /** `repo`'s stacks as `login`'s poller lists them, once they're known. */
  readonly forest: (repo: RepoRef, login: string) => Forest | undefined;
  /** The conversion to a GitHub stack changing `repo`'s base branches, if one is. */
  readonly converting: (repo: RepoRef) => Converting | undefined;
  /** The turns of merge writes to pull requests, app-wide, and when one is given back. */
  readonly turns: MergeWrites & Pick<MergeTurns, 'onGiven'>;
  /** The app's merge jobs. */
  readonly jobs: Jobs;
  /** Sends a merge to the window, each time it changes. */
  readonly publish: (job: JobView) => void;
  readonly log: (line: string) => void;
  /** The time, in milliseconds since the Unix epoch. */
  readonly now?: () => number;
  /** A new plan's key. */
  readonly newKey?: () => string;
  /** How long a read at the press may take before Lo gives up on it, in milliseconds: 20 s. */
  readonly readWait?: number;
  /** How long Lo waits for the open pull requests to be listed again, in milliseconds: 15 s. */
  readonly listWait?: number;
  /** How often a chain's merge reads its bottom layer while it waits for it to merge: a minute. */
  readonly chainEvery?: number;
}

/**
 * What the reader chose in the panel: the method, and a squash's title and message as typed; and
 * what they asked for, a merge unless it says.
 */
export interface Choice {
  readonly method: Method | null;
  readonly title: string;
  readonly message: string;
  readonly asked?: Asked | undefined;
}

/** A plan kept for the reader to confirm. */
interface Kept {
  readonly plan: MergePlan;
  readonly pull: PullRef;
}

/** A merge write's plan: as confirmed, or one made for auto-merge turned off, which has none. */
type SentPlan = Omit<MergePlan, 'kind'> & { readonly kind: WriteKind };

/** A merge Lo sent, as it follows it. */
interface Sent {
  readonly plan: SentPlan;
  readonly pull: PullRef;
  readonly poller: MergingPoller;
  turn: MergeTurn | undefined;
  /**
   * While GitHub is asked again how a merge went, and until a read settles it, the pull requests it
   * names whose turns another write held then: each is taken as soon as it's given back.
   */
  lacking: readonly number[];
  /** Whether the method was remembered for the repository. */
  remembered: boolean;
  /**
   * Where a write the jobs don't follow stands, as auto-merge turned on or off, which Lo follows
   * itself; nothing for a merge.
   */
  own: JobState | undefined;
  /**
   * For a merge Lo can't tell the end of: what GitHub has shown of the pull request since; for
   * auto-merge, whether it's on.
   */
  shows: 'merged' | 'enqueued' | 'open' | 'autoMergeOn' | 'autoMergeOff' | undefined;
  /** Stops listening for the reads that settle it. */
  unwatch: (() => void) | undefined;
  /** When it ended, by {@link MergingOptions.now}: what Lo acts on next is read after then. */
  endedAt: number | undefined;
  /** The reader dismissed it while Lo couldn't tell yet: forgotten once a read settles it. */
  dismissed: boolean;
  /** For a GitHub stack's merge, its layers as the Stacks API said at its last read. */
  stack: StackRead | undefined;
  /** For a chain's, its run, and the turns of the layers it moves. */
  chain: { readonly run: ChainRun; turn: MergeTurn | undefined } | undefined;
  /** Hears GitHub's answer to a write Lo follows itself, or nothing once that's lost. */
  heard?: ((answer: AutoAnswer) => void) | undefined;
  /** Whether the auto-merge watch sent it, by itself. */
  watch?: boolean;
}

/** A GitHub stack's layers, read as its merge goes. */
interface StackRead {
  /** Each layer's state, by its number, as the Stacks API last said. */
  readonly states: Map<number, LayerState>;
  /** When GitHub took the merge. */
  takenAt: number | undefined;
  /** Whether a read is under way, and whether another is due once it's done. */
  reading: boolean;
  again: boolean;
}

/**
 * What GitHub answered a write to auto-merge: auto-merge as it has it now; its refusal, or none
 * when Lo couldn't send it; or nothing Lo could read, as the answer was lost, which a read settles.
 */
export type AutoAnswer = AutoMergeState | { readonly refused: MergeRefusal | undefined } | 'lost';

/** What else a write Lo follows itself takes: who hears its answer, and whether the watch sent it. */
interface OwnOptions {
  readonly heard?: ((answer: AutoAnswer) => void) | undefined;
  readonly watch?: boolean;
}

/**
 * What a merge takes with it, from where its pull request sits, read afresh, and what decides it
 * once it goes so, as {@link Merging.goesAs} says; or why Lo doesn't merge it so: `unknown` when Lo
 * can't tell yet where it sits, which a read again may settle.
 */
export type Goes =
  | {
      readonly kind: 'goes';
      readonly onto: (facts: MergeFacts) => MergeFacts;
      readonly together: Together | null;
    }
  | { readonly kind: 'where'; readonly why: string; readonly unknown: boolean }
  | { readonly kind: 'unread'; readonly why: string };

/** A press's plan, and how a read that lands meanwhile plans: nothing when it plans none. */
export interface PressPlan<P> {
  readonly kind: 'plan';
  readonly plan: P;
  readonly again: (facts: MergeFacts) => P | undefined;
}

/** What {@link Merging.weigh} weighs a press with. */
export interface Press<P> {
  /** The view it was pressed in. */
  readonly id: string;
  readonly pull: PullRef;
  /** Whether what Lo read is read again whatever it is, as approve and ship's press does. */
  readonly afresh: boolean;
  /** Why what decides the merge can't be acted on, at `head`, the head on screen, if it can't. */
  readonly vet?: (facts: MergeFacts, head: string) => Refusal | undefined;
  /** The plan `facts` give in `view`, with where the pull request sits read afresh; or why not. */
  readonly plan: (
    facts: MergeFacts,
    view: PullTabInfo,
    signal: AbortSignal,
  ) => Promise<PressPlan<P> | { readonly kind: 'refused'; readonly refusal: Refusal }>;
  /** Whether `now` goes as `was` does, as its confirmation names it. */
  readonly same: (was: P, now: P) => boolean;
}

/**
 * How {@link Merging.weigh} weighed a press: its plan, from `facts`, the newest read; refused; the
 * tab closed; GitHub couldn't be read again; someone pushed `to`, past `from`, the head on screen;
 * or what GitHub says kept changing while Lo checked it.
 */
export type Weighed<P> =
  | { readonly kind: 'plan'; readonly plan: P; readonly facts: MergeFacts }
  | { readonly kind: 'refused'; readonly refusal: Refusal }
  | { readonly kind: 'closed' }
  | { readonly kind: 'unread'; readonly why: string }
  | { readonly kind: 'moved'; readonly from: string; readonly to: string }
  | { readonly kind: 'changing' };

/** Whether two logins name one account: GitHub's ignore case. */
function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A number of minutes or hours, as a clock writes it: "05". */
function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** A clock time as the interface writes it: "14:05". */
function clock(at: number): string {
  const time = new Date(at);
  return `${twoDigits(time.getHours())}:${twoDigits(time.getMinutes())}`;
}

/** Why Lo merges nothing now with `poller`, whatever GitHub says of the pull request. */
export function offOf(poller: Pick<Poller, 'status' | 'writesHeldUntil'>): Off | null {
  const status = poller.status();
  if (status.signedOut) return { kind: 'signedOut' };
  if (status.offline) return { kind: 'offline' };
  const until = poller.writesHeldUntil();
  return until === undefined ? null : { kind: 'paused', until: Math.max(0, Math.round(until)) };
}

/** What Lo says of `off`. */
export function offText(off: Off): string {
  switch (off.kind) {
    case 'offline':
      return 'Offline. Merging waits until you’re back.';
    case 'paused':
      return `GitHub asked Lo to hold off until ${clock(off.until)}. Merge then.`;
    case 'signedOut':
      return 'The account is signed out of GitHub. Sign in again, then merge.';
    default:
      off satisfies never;
      throw new Error(`a reason Lo doesn't know: ${JSON.stringify(off)}`);
  }
}

/** A refusal of Lo's own, with nothing more than its words. */
function own(kind: string, text: string, more: Partial<Refusal> = {}): Refusal {
  return { kind, text, rules: [], until: null, newer: null, ...more };
}

/** GitHub's refusal, or Lo's before asking it, in the core's sentences. */
export function refusalOf(refusal: MergeRefusal, head: string): Refusal {
  const text = `${describeMergeRefusal(refusal)}.`;
  if (refusal.refusal === 'rules') return own('rules', text, { rules: refusal.rules });
  if (refusal.refusal === 'paused') {
    return own('paused', `GitHub asked Lo to hold off until ${clock(refusal.until)}. Merge then.`, {
      until: Math.max(0, Math.round(refusal.until)),
    });
  }
  if (refusal.refusal === 'headMoved') {
    return own('headMoved', text, { newer: { from: head, to: null } });
  }
  return own(refusal.refusal, text);
}

/**
 * How a write to auto-merge whose answer Lo couldn't read ended, as a read since `shows`: as asked,
 * or, where GitHub shows otherwise, refused, for the reader to see what GitHub has.
 */
function settledOwn(
  plan: SentPlan,
  shows: 'merged' | 'enqueued' | 'autoMergeOn' | 'autoMergeOff',
): JobState {
  const on = plan.kind !== 'autoMergeOff';
  if (shows === 'merged') return { kind: 'merged' };
  if (on) {
    if (shows === 'autoMergeOff') {
      return {
        kind: 'refused',
        refusal: own('off', `GitHub shows auto-merge off for #${plan.number}.`),
      };
    }
    return { kind: shows };
  }
  if (shows === 'enqueued') {
    return {
      kind: 'refused',
      refusal: own(
        'queued',
        `#${plan.number} is in the merge queue for ${plan.base}, so it merges once the queue’s checks pass. Take it out of the queue on GitHub to stop it.`,
      ),
    };
  }
  if (shows === 'autoMergeOn') {
    return {
      kind: 'refused',
      refusal: own(
        'on',
        `GitHub still shows auto-merge on for #${plan.number}, so it merges once it’s ready.`,
      ),
    };
  }
  return { kind: 'autoMergeOff' };
}

/** GitHub's refusal to turn auto-merge on or off, or Lo's before asking it, in the core's sentences. */
function autoRefusalOf(refusal: MergeRefusal, head: string): Refusal {
  if (refusal.refusal === 'autoMergeNotAllowed') {
    return own(
      refusal.refusal,
      'This repository doesn’t allow auto-merge. A maintainer turns it on in its settings.',
    );
  }
  return refusalOf(refusal, head);
}

/**
 * What kept a merge from being sent, other than GitHub's refusal: such as a proxy that asks to sign
 * in, or an account signed out. Nothing was sent.
 */
function unsentOf(detail: GithubErrorDetail): Refusal {
  return own(detail.kind, `${new GithubError(detail).message} Nothing was sent.`);
}

/**
 * What Lo says of a merge whose end it can't tell, after "Lo can't tell whether #4821 merged.", and
 * whether GitHub can still be asked about it.
 */
function unsureOf(outcome: Extract<Outcome, { kind: 'unknown' }>) {
  const read =
    'Lo reads the pull request again, which shows whether it did, and sends nothing again.';
  const unknown = outcome.unknown;
  switch (unknown.kind) {
    case 'noAnswer':
      return {
        why: unknown.kind,
        text: `GitHub’s answer didn’t reach Lo: ${new GithubError(unknown.error).message} ${read}`,
        askAgain: false,
      };
    case 'lost':
      return {
        why: unknown.kind,
        text: `GitHub no longer answers about the merge: ${new GithubError(unknown.error).message} ${read}`,
        askAgain: false,
      };
    case 'stillPending':
      return {
        why: unknown.kind,
        text: `GitHub was still merging it when Lo stopped asking. ${read}`,
        askAgain: true,
      };
    case 'stopped':
      return { why: unknown.kind, text: `Lo stopped following it. ${read}`, askAgain: false };
    case 'status':
      return {
        why: unknown.kind,
        text: `GitHub said “${unknown.status}”, which Lo doesn’t know. ${read}`,
        askAgain: true,
      };
    default:
      unknown satisfies never;
      throw new Error(`a reason Lo doesn't know: ${JSON.stringify(unknown)}`);
  }
}

/** How a job's end shows, as the window takes it; `head` is the head it was sent with. */
function endOf(outcome: Outcome, head: string): JobState {
  switch (outcome.kind) {
    case 'merged':
      return { kind: 'merged' };
    case 'enqueued':
      return { kind: 'enqueued' };
    case 'failed':
      return { kind: 'refused', refusal: refusalOf(outcome.why, head) };
    case 'refused':
      return {
        kind: 'refused',
        refusal: isRefusal(outcome.why) ? refusalOf(outcome.why, head) : unsentOf(outcome.why),
      };
    case 'alreadyRunning':
      return endOf(outcome.ended, head);
    case 'unknown':
      return { kind: 'unknown', ...unsureOf(outcome), shows: null };
    default:
      outcome satisfies never;
      throw new Error(`an outcome Lo doesn't know: ${JSON.stringify(outcome)}`);
  }
}

/** Where a job stands, as the window takes it. */
function stateOf(job: Job): JobState {
  const { state } = job;
  switch (state.kind) {
    case 'sending':
      return { kind: 'sending' };
    case 'pending':
      return {
        kind: 'pending',
        trouble: state.trouble === undefined ? null : new GithubError(state.trouble).message,
      };
    case 'done':
      return endOf(state.outcome, job.request.sha);
    default:
      state satisfies never;
      throw new Error(`a job's state Lo doesn't know: ${JSON.stringify(state)}`);
  }
}

/** Where Lo doesn't merge a pull request from, for `why`, as the merge panel says it. */
function notPlaced(why: string): Placement {
  return { kind: 'refused', why, again: false };
}

/** The outcome a job ended with, as the merge GitHub was already running when it answered `409`. */
function endedWith(job: Job): Outcome | undefined {
  if (job.state.kind !== 'done') return undefined;
  const { outcome } = job.state;
  return outcome.kind === 'alreadyRunning' ? outcome.ended : outcome;
}

/** What decides a merge, as it stands: for a merge that moves onto no other branch first. */
function asTheyAre(facts: MergeFacts): MergeFacts {
  return facts;
}

/** Whether `kind` turns auto-merge on, straight in or into the queue once ready. */
function isAuto(kind: WriteKind): kind is 'autoMerge' | 'whenReady' {
  return kind === 'autoMerge' || kind === 'whenReady';
}

/**
 * Whether a plan of `kind` goes only alone or from a GitHub stack's bottom layer, taking nothing
 * with it: auto-merge and a merge past the rules, whose writes can't name a stack's layers below.
 */
function goesAlone(kind: PlanKind): boolean {
  return isAuto(kind) || kind === 'override';
}

/** What the reader asked of the panel for a plan of `kind`. */
function askedOf(kind: PlanKind): Asked {
  if (isAuto(kind)) return 'autoMerge';
  return kind === 'override' ? 'override' : 'merge';
}

/** What a plan names that the reader confirmed: what changed, in words, or nothing. */
function changed(was: MergePlan, now: MergePlan): string | undefined {
  if (was.kind !== now.kind) {
    // Asked to wait, and nothing is in the way now: the merge itself is planned in its place.
    if (isAuto(was.kind) && !isAuto(now.kind)) {
      return `Nothing blocks #${now.number} now, so it can merge as it is.`;
    }
    return now.kind === 'enqueue' || now.kind === 'whenReady'
      ? `${now.base} merges through a merge queue now.`
      : `${now.base} no longer merges through a merge queue.`;
  }
  if (was.base !== now.base) return `#${now.number} merges into ${now.base} now.`;
  if (was.method !== now.method) return 'The method it merges with changed.';
  if (was.head !== now.head) return 'The revision on screen changed.';
  // What the confirmation listed, as Lo read it then: anything new or gone asks again.
  if (JSON.stringify(was.named) !== JSON.stringify(now.named)) {
    return now.kind === 'override'
      ? `What merging #${now.number} past the rules skips changed.`
      : `What auto-merge waits for on #${now.number} changed.`;
  }
  return togetherChanged(was.together, now.together);
}

/**
 * Whether a read that landed while a press planned `planned` from `facts`, `latest`, calls for
 * another round: it's at another head than `head`, or plans what `same` doesn't take for the same
 * as the confirmation names it, or nothing. One that changes none of that, or none since, doesn't.
 */
export function anotherRound<P>(
  planned: Pick<PressPlan<P>, 'plan' | 'again'>,
  facts: MergeFacts,
  latest: MergeFacts,
  head: string,
  same: (was: P, now: P) => boolean,
): boolean {
  if (latest === facts) return false;
  if (latest.pullRequest.head !== head) return true;
  const newest = planned.again(latest);
  return newest === undefined || !same(planned.plan, newest);
}

export class Merging {
  readonly #options: MergingOptions;
  readonly #now: () => number;
  readonly #newKey: () => string;
  /** The plans kept for the reader to confirm, by key: a view's last one only. */
  readonly #kept = new Map<string, Kept>();
  /** The keys of plans confirmed, which never run again. */
  readonly #used = new Set<string>();
  /** The pull request each plan made is of, by its key. */
  readonly #planned = new Map<string, PullRef>();
  /** The merges Lo sent, by their pull request's key, until the reader forgets them. */
  readonly #sent = new Map<string, Sent>();
  /** The checks under way at a press, by their plan's key: cancelling one stops it. */
  readonly #checking = new Map<string, AbortController>();
  readonly #stopJobs: () => void;
  readonly #stopTurns: () => void;
  #stopped = false;

  constructor(options: MergingOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#newKey = options.newKey ?? (() => crypto.randomUUID());
    this.#stopJobs = options.jobs.onChange(({ pull, done }) => this.#heard(pull, done));
    this.#stopTurns = options.turns.onGiven(() => {
      if (this.#stopped) return;
      for (const sent of this.#sent.values()) {
        if (sent.lacking.length > 0) this.#holdLacking(sent);
      }
    });
  }

  /**
   * Plans the merge view `id`'s panel offers now, from what GitHub said last, and keeps it for the
   * reader to confirm, in place of the view's last plan; or says why there's none.
   */
  async plan(id: string, choice: Choice): Promise<Planned> {
    if (this.#stopped) return { kind: 'refused', why: 'Lo is quitting.' };
    const view = this.#options.view(id);
    const acting = actingOf(view);
    if (typeof acting === 'string') return { kind: 'refused', why: acting };
    if (!view) return { kind: 'refused', why: 'There’s no pull request in that tab.' };
    const { login } = acting;
    let poller: MergingPoller;
    try {
      poller = await this.#options.poller(login);
    } catch (error) {
      return { kind: 'refused', why: describe(error) };
    }
    const off = offOf(poller);
    if (off) return { kind: 'refused', why: offText(off) };
    const pull = new PullRef(view.repository.owner, view.repository.name, view.number);
    const cached = poller.cachedRead(pull, MERGE_FACTS) ?? (await poller.mergeFacts(pull));
    if (!cached) {
      return { kind: 'refused', why: `Lo hasn’t read whether #${view.number} can merge yet.` };
    }
    const first = this.#planOf(id, view, login, cached.value, choice);
    if (typeof first === 'string') return { kind: 'refused', why: first };
    // The panel's own `⏎` merges it, as it says.
    if (choice.asked === 'autoMerge' && !isAuto(first.kind)) {
      return {
        kind: 'refused',
        why: `Nothing blocks #${view.number} now, so it can merge as it is.`,
      };
    }
    const goes = await this.goesAs(first.kind, poller, login, pull, cached.value);
    if (goes.kind !== 'goes') return { kind: 'refused', why: goes.why };
    // Auto-merge and a merge past the rules take nothing with them.
    if (goesAlone(first.kind)) {
      this.#keep(first, pull);
      return { kind: 'plan', plan: first };
    }
    // A chain's bottom layer that moves onto the root first merges under the root's rules.
    const planned = this.#planOf(id, view, login, goes.onto(cached.value), choice, goes.together);
    if (typeof planned === 'string') return { kind: 'refused', why: planned };
    this.#keep(planned, pull);
    return { kind: 'plan', plan: planned };
  }

  /**
   * Where view `id`'s pull request sits, as the merge panel says it as it opens: what its merge
   * takes with it, from GitHub's Stacks API and the open pull requests from the branches it merges
   * into, read afresh; or why Lo doesn't merge it from there.
   */
  async place(id: string): Promise<Placement> {
    if (this.#stopped) return notPlaced('Lo is quitting.');
    const view = this.#options.view(id);
    const acting = actingOf(view);
    if (typeof acting === 'string') return notPlaced(acting);
    if (!view) return notPlaced('There’s no pull request in that tab.');
    let poller: MergingPoller;
    try {
      poller = await this.#options.poller(acting.login);
    } catch (error) {
      return notPlaced(describe(error));
    }
    const pull = new PullRef(view.repository.owner, view.repository.name, view.number);
    const cached = poller.cachedRead(pull, MERGE_FACTS) ?? (await poller.mergeFacts(pull));
    if (!cached) return notPlaced(`Lo hasn’t read whether #${view.number} can merge yet.`);
    return placementOf(await this.#takingNow(poller, acting.login, pull, cached.value));
  }

  /**
   * Sends the merge the plan named `key` holds, once, if it can still go as the plan says; else
   * asks again with a new plan, when something it named changed, or refuses. A merge past the rules
   * goes only with `typed`, the pull request's number as the reader typed it; without, the plan
   * stays to confirm.
   */
  async confirm(key: string, typed?: string): Promise<Confirmed> {
    const kept = this.#kept.get(key);
    if (!kept) {
      return refused(
        this.#used.has(key)
          ? own('used', 'That merge was confirmed already.')
          : own('gone', 'Lo no longer has that plan. Merge from the panel again.'),
      );
    }
    if (kept.plan.kind === 'override' && typed !== String(kept.plan.number)) {
      return refused(own('typed', `Type ${kept.plan.number} to merge it past the rules.`));
    }
    // A plan runs once, whatever comes of it.
    this.#kept.delete(key);
    this.#used.add(key);
    if (this.#stopped) return refused(own('stopped', 'Lo is quitting.'));
    const checking = new AbortController();
    this.#checking.set(key, checking);
    try {
      const { signal } = checking;
      let checked;
      try {
        checked = await this.#guard(kept, signal);
      } catch (error) {
        if (signal.aborted) return refused(cancelled());
        this.#options.log(`${kept.pull.toString()}: ${describe(error)}`);
        return refused(
          own('failed', `Lo couldn’t check the merge, so it didn’t send it: ${describe(error)}`),
        );
      }
      // Cancelled while it checked: nothing goes, and no plan is kept in its place.
      if (signal.aborted || this.#stopped) {
        if (checked.kind === 'again') this.#kept.delete(checked.plan.key);
        return refused(this.#stopped ? own('stopped', 'Lo is quitting.') : cancelled());
      }
      if (checked.kind !== 'send') return checked;
      // What the checks found at their start, once more, right before it goes.
      const still = this.#holds(kept, checked.poller);
      if (still) return refused(still);
      return isAuto(kept.plan.kind)
        ? this.#sendAuto(kept, checked.poller)
        : this.#send(kept, checked.poller);
    } finally {
      this.#checking.delete(key);
    }
  }

  /**
   * Forgets the plan named `key`. While its press is being checked, stops that: its reads are given
   * up, and nothing is sent. Once it was sent, it goes on.
   */
  cancel(key: string): void {
    this.#kept.delete(key);
    this.#checking.get(key)?.abort();
  }

  /**
   * Turns off auto-merge for view `id`'s pull request at once, in its turn among merge writes:
   * nothing merges, so the reader isn't asked first. It goes once the view acts as an account that's
   * signed in, GitHub can be reached and isn't holding writes, and no other merge write to the pull
   * request is under way; `jobs` then says how it went.
   */
  async autoMergeOff(id: string): Promise<Exclude<Confirmed, { kind: 'again' }>> {
    if (this.#stopped) return refused(own('stopped', 'Lo is quitting.'));
    const view = this.#options.view(id);
    if (!view) return refused(own('closed', 'There’s no pull request in that tab.'));
    const acting = actingOf(view);
    if (typeof acting === 'string') return refused(own('account', acting));
    const pull = new PullRef(view.repository.owner, view.repository.name, view.number);
    let poller: MergingPoller;
    try {
      poller = await this.#options.poller(acting.login);
    } catch (error) {
      return refused(own('account', describe(error)));
    }
    // From here to the send nothing waits, so nothing checked can change before it goes.
    if (this.#stopped) return refused(own('stopped', 'Lo is quitting.'));
    const now = this.#options.view(id);
    const still = actingOf(now);
    if (
      !now ||
      typeof still === 'string' ||
      !sameLogin(still.login, acting.login) ||
      !new PullRef(now.repository.owner, now.repository.name, now.number).equals(pull)
    ) {
      return refused(own('account', 'The tab changed. Turn off auto-merge from its panel again.'));
    }
    const off = offOf(poller);
    if (off) {
      return refused(
        own(off.kind, offText(off), { until: off.kind === 'paused' ? off.until : null }),
      );
    }
    const facts = poller.cachedRead(pull, MERGE_FACTS)?.value;
    if (!facts || !isFullSha(facts.pullRequest.head)) {
      return refused(own('unread', `Lo hasn’t read #${view.number} from GitHub yet.`));
    }
    const before = this.#sent.get(pull.key);
    if (before?.turn && this.#ended(before)) return refused(own('unsettled', unsure(before.plan)));
    const plan: SentPlan = {
      key: this.#newKey(),
      id,
      owner: view.repository.owner,
      repo: view.repository.name,
      number: view.number,
      login: acting.login,
      kind: 'autoMergeOff',
      method: null,
      base: rulesBase(facts),
      // GitHub's: turning it off takes no head.
      head: facts.pullRequest.head,
      title: '',
      message: '',
      named: null,
      together: null,
    };
    return this.#sendOwn(plan, pull, poller, (pullRequestId) =>
      poller.disableAutoMerge(pull, pullRequestId),
    );
  }

  /**
   * Turns off auto-merge for `pull`, as `login`, with `poller`, for the auto-merge watch: a push
   * came after your approval that would merge with it. It goes as `a` turns it off, in the pull
   * request's turn, asking nothing, once the account is signed in, GitHub can be reached and isn't
   * holding writes, and no other merge write to the pull request is under way or unsettled; `heard`
   * hears GitHub's answer, or nothing once it's lost, and `jobs` says how it went.
   */
  turnOffWatched(
    pull: PullRef,
    login: string,
    poller: MergingPoller,
    heard: (answer: AutoAnswer) => void,
  ): Exclude<Confirmed, { kind: 'again' }> {
    if (this.#stopped) return refused(own('stopped', 'Lo is quitting.'));
    const off = offOf(poller);
    if (off) {
      return refused(
        own(off.kind, offText(off), { until: off.kind === 'paused' ? off.until : null }),
      );
    }
    const facts = poller.cachedRead(pull, MERGE_FACTS)?.value;
    if (!facts || !isFullSha(facts.pullRequest.head)) {
      return refused(own('unread', `Lo hasn’t read #${pull.number} from GitHub yet.`));
    }
    const before = this.#sent.get(pull.key);
    if (before?.turn && this.#ended(before)) return refused(own('unsettled', unsure(before.plan)));
    const plan: SentPlan = {
      key: this.#newKey(),
      id: '',
      owner: pull.repo.owner,
      repo: pull.repo.name,
      number: pull.number,
      login,
      kind: 'autoMergeOff',
      method: null,
      base: rulesBase(facts),
      head: facts.pullRequest.head,
      title: '',
      message: '',
      named: null,
      together: null,
    };
    return this.#sendOwn(
      plan,
      pull,
      poller,
      (pullRequestId) => poller.disableAutoMerge(pull, pullRequestId),
      { heard, watch: true },
    );
  }

  /**
   * Sends `plan`, approve and ship's step after its approval, for `pull` with `poller`, in the pull
   * request's turn, `turn`, which approve and ship took at the press and hands on here, so no other
   * merge write goes between: a merge or a queue entry through the jobs, or auto-merge as its own
   * write, whose answer `heard` hears. Approve and ship made its own checks just before.
   */
  sendShipped(
    plan: MergePlan,
    pull: PullRef,
    poller: MergingPoller,
    turn: MergeTurn,
    heard?: (answer: AutoAnswer) => void,
  ): Exclude<Confirmed, { kind: 'again' }> {
    // Handed on: nothing waits between this and the send's own turn.
    turn.give();
    if (this.#stopped) return refused(own('stopped', 'Lo is quitting.'));
    const kept = { plan, pull };
    this.#planned.set(plan.key, pull);
    return isAuto(plan.kind) ? this.#sendAuto(kept, poller, heard) : this.#send(kept, poller);
  }

  /** Every merge Lo sent that it still has, as the window shows them. */
  list(): JobView[] {
    return [...this.#sent.values()].flatMap((sent) => {
      if (sent.dismissed) return [];
      const view = this.#viewOf(sent);
      return view ? [view] : [];
    });
  }

  /**
   * Asks GitHub again how the merge from the plan named `key` went, when Lo couldn't tell: about
   * the merge, while GitHub still answers about it, or else by reading the pull request again. A
   * read: nothing is sent again.
   */
  askAgain(key: string): void {
    // Or a plan refused while Lo couldn't tell how the last merge of its pull request ended.
    const sent = this.#byKey(key) ?? this.#sent.get(this.#planned.get(key)?.key ?? '');
    if (!sent) return;
    // Auto-merge's write is one request, which GitHub can't be asked about: the read settles it.
    if (sent.own) {
      if (sent.own.kind === 'unknown') this.#settle(sent);
      return;
    }
    const job = this.#options.jobs.job(sent.pull);
    if (!job || endedWith(job)?.kind !== 'unknown') return;
    if (this.#options.jobs.followAgain(sent.pull)) {
      // A read since the last end settles nothing of this ask: only its own end gives turns back.
      sent.unwatch?.();
      sent.unwatch = undefined;
      // Following it again holds the turns it held as it was sent, as the merge may still be
      // running: a stack's merge holds every layer's.
      if (!sent.turn) sent.lacking = sentNames(sent.plan);
      this.#holdLacking(sent);
      return;
    }
    this.#settle(sent);
  }

  /**
   * Takes the turn of each pull request `sent` lacks one of, each on its own: one another write
   * holds keeps none of the others from it, nor the pull request's own, and stays lacking.
   */
  #holdLacking(sent: Sent): void {
    const held: MergeTurn[] = sent.turn ? [sent.turn] : [];
    const lacking: number[] = [];
    for (const pr of sent.lacking) {
      const turn = this.#options.turns.take(sent.pull.repo, [pr]);
      if ('busy' in turn) lacking.push(pr);
      else held.push(turn);
    }
    sent.lacking = lacking;
    sent.turn =
      held.length === 0
        ? undefined
        : {
            give: () => {
              for (const turn of held) turn.give();
            },
          };
  }

  /**
   * Forgets the merge from the plan named `key` once it has ended. One Lo can't tell the end of yet
   * goes from the list, and is forgotten once a read settles it: until then it holds its turn.
   */
  dismiss(key: string): void {
    const sent = this.#byKey(key);
    if (!sent) return;
    if (sent.own?.kind === 'sending') return;
    const job = sent.own ? undefined : this.#options.jobs.job(sent.pull);
    if (job && job.state.kind !== 'done') return;
    // A chain's run goes on after its merge, until it has moved the layers on it.
    if (sent.chain && !sent.chain.run.over) return;
    if (sent.turn) {
      sent.dismissed = true;
      return;
    }
    this.#forget(sent);
  }

  #forget(sent: Sent): void {
    this.#options.jobs.forget(sent.pull);
    sent.unwatch?.();
    this.#sent.delete(sent.pull.key);
  }

  /** Plans no more and sends nothing more; the jobs stop on their own. */
  stop(): void {
    this.#stopped = true;
    this.#stopJobs();
    this.#stopTurns();
    this.#kept.clear();
    for (const checking of this.#checking.values()) checking.abort();
    for (const sent of this.#sent.values()) {
      sent.unwatch?.();
      sent.chain?.run.stop();
      sent.turn?.give();
    }
  }

  /**
   * The plan `facts` give for view `id`, as `login`, with the reader's `choice`, or why there's
   * none. Auto-merge asked for when nothing blocks the merge is the merge itself.
   */
  #planOf(
    id: string,
    view: PullTabInfo,
    login: string,
    facts: MergeFacts,
    choice: Choice,
    together: Together | null = null,
  ): MergePlan | string {
    const { number } = view;
    const head = this.#options.headOnScreen(id) ?? '';
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) {
      return `Lo hasn’t shown #${number}’s head yet.`;
    }
    const repo = new PullRef(view.repository.owner, view.repository.name, number).repo;
    const snapshot = mergeSnapshot(facts, {
      headOnScreen: head,
      preferredMethod: this.#options.method(repo),
      headContainsBase: this.#options.headContainsBase(id),
    });
    const action = mergeAction(snapshot);
    const base = rulesBase(facts);
    const way = otherWay(snapshot, choice, {
      number,
      login,
      base,
      aboveBottom: aboveStackBottom(facts),
    });
    if (typeof way === 'string') return way;
    let kind: PlanKind;
    let method: Method | null;
    if (way !== undefined) {
      ({ kind, method } = way);
    } else {
      switch (action.kind) {
        case 'merge':
          kind = 'merge';
          method =
            choice.method !== null && action.methods.includes(choice.method)
              ? choice.method
              : action.method;
          break;
        case 'enqueue':
          kind = 'enqueue';
          method = action.method ?? null;
          break;
        case 'notPossible':
          return notPossibleText(action.reason.kind, number, login, base);
        default:
          action satisfies never;
          throw new Error(`an action Lo doesn't know: ${JSON.stringify(action)}`);
      }
    }
    // Only what the reader typed goes, and only for a squash straight in: an empty field leaves
    // GitHub's own. Auto-merge keeps it for the merge Lo may offer in its place.
    const squash =
      (kind === 'merge' || kind === 'override' || kind === 'autoMerge') && method === 'SQUASH';
    const names = kind === 'autoMerge' || kind === 'whenReady' || kind === 'override';
    return {
      key: this.#newKey(),
      id,
      owner: view.repository.owner,
      repo: view.repository.name,
      number,
      login,
      kind,
      method,
      base,
      head,
      title: squash ? choice.title.trim() : '',
      message: squash ? choice.message.trim() : '',
      named: names
        ? namedOf(snapshot, facts, {
            owner: view.repository.owner,
            repo: view.repository.name,
            number,
          })
        : null,
      together,
    };
  }

  /** Keeps `plan`, in place of its view's last one. */
  #keep(plan: MergePlan, pull: PullRef): void {
    for (const [key, kept] of this.#kept) {
      if (kept.plan.id === plan.id) this.#kept.delete(key);
    }
    this.#kept.set(plan.key, { plan, pull });
    this.#planned.set(plan.key, pull);
  }

  /**
   * Checks `kept` as it's confirmed: sends it with `poller` when everything holds; asks again with
   * a new plan when something it named changed; else refuses.
   */
  async #guard(
    kept: Kept,
    signal: AbortSignal,
  ): Promise<Confirmed | { kind: 'send'; poller: MergingPoller }> {
    const { plan, pull } = kept;
    const tab = this.#tabHolds(kept);
    if (tab) return refused(tab);
    let poller: MergingPoller;
    try {
      poller = await untilAborted(this.#options.poller(plan.login), signal);
    } catch (error) {
      signal.throwIfAborted();
      return refused(own('account', describe(error)));
    }
    const held = this.#holds(kept, poller);
    if (held) return refused(held);
    const choice = { ...plan, asked: askedOf(plan.kind) };
    const weighed = await this.weigh<MergePlan>(
      {
        id: plan.id,
        pull,
        afresh: false,
        vet: (facts, head) => {
          if (checksCutShort(facts)) {
            return own('checks', 'GitHub has over 1,000 checks here. Merge it on GitHub.');
          }
          const snapshot: MergeSnapshot = mergeSnapshot(facts, {
            headOnScreen: head,
            preferredMethod: this.#options.method(pull.repo),
            headContainsBase: this.#options.headContainsBase(plan.id),
          });
          if (incomplete(snapshot) === undefined) return undefined;
          poller.readMergeFactsAgain(pull);
          return own(
            'incomplete',
            `GitHub left part of what decides #${plan.number}’s merge out of its answer, so Lo didn’t merge. Lo reads it again; merge once it has.`,
          );
        },
        plan: async (facts, view) => {
          const first = this.#planOf(plan.id, view, plan.login, facts, choice);
          if (typeof first === 'string') return refused(own('notPossible', first));
          // Where it sits, and what goes with it, read afresh: GitHub's stack holds what merges
          // with it.
          const goes = await this.goesAs(plan.kind, poller, plan.login, pull, facts, signal);
          if (goes.kind !== 'goes') return refused(own(goes.kind, goes.why));
          const planned = (read: MergeFacts) =>
            this.#planOf(plan.id, view, plan.login, goes.onto(read), choice, goes.together);
          const now = planned(facts);
          if (typeof now === 'string') return refused(own('notPossible', now));
          return {
            kind: 'plan',
            plan: now,
            again: (read) => {
              const newest = planned(read);
              return typeof newest === 'string' ? undefined : newest;
            },
          };
        },
        same: (was, now) => changed(was, now) === undefined,
      },
      poller,
      signal,
    );
    switch (weighed.kind) {
      case 'plan':
        break;
      case 'refused':
        return weighed;
      case 'closed':
        return refused(closed(plan));
      case 'unread':
        return refused(
          own(
            'unread',
            `Lo couldn’t read #${plan.number} again, so it didn’t merge: ${weighed.why}`,
          ),
        );
      case 'moved':
        return refused(newerPush(plan.number, weighed.from, weighed.to));
      case 'changing':
        return refused(
          own(
            'changing',
            `What GitHub says of #${plan.number} kept changing while Lo checked it, so Lo sent nothing. Start again from the merge panel.`,
          ),
        );
      default:
        weighed satisfies never;
        throw new Error(`a press Lo doesn't know: ${JSON.stringify(weighed)}`);
    }
    const now = weighed.plan;
    const why = changed(plan, now);
    if (why !== undefined) {
      this.#keep(now, pull);
      return { kind: 'again', plan: now, why: `${why} Check what it does now, then confirm.` };
    }
    const named = namesOf(plan.number, plan.together);
    const [busy] = this.#options.turns.busy(pull.repo, named);
    if (busy !== undefined) return refused(own('busy', `Lo is already merging #${busy}.`));
    const converting = this.#options.converting(pull.repo);
    if (converting?.prs.some((pr) => named.includes(pr))) {
      return refused(
        own(
          'converting',
          `Lo is making ${numbers(converting.prs)} a GitHub stack. Merge once that’s done.`,
        ),
      );
    }
    return { kind: 'send', poller };
  }

  /**
   * Weighs a press of `press`'s pull request, with `poller`, as a merge's press is weighed: a merge
   * of it Lo can't tell the end of yet holds it until a read settles that; what GitHub said is
   * whole, at the head on screen, which is still GitHub's head, confirmed in the last
   * {@link FRESH_FOR} and after the last merge of it ended, else it's read again, as it always is
   * with `afresh`; and a read that lands while Lo asks GitHub where the pull request sits, and what
   * goes with it, is weighed too, another round, when it changes what the confirmation named. Given
   * up on `signal`.
   */
  async weigh<P>(press: Press<P>, poller: MergingPoller, signal: AbortSignal): Promise<Weighed<P>> {
    const { pull } = press;
    // A merge of it that ended before: what Lo acts on now is read after that, and one Lo can't
    // tell the end of yet holds the pull request until a read settles it.
    const before = this.#sent.get(pull.key);
    if (before?.turn && this.#ended(before)) {
      return refused(own('unsettled', unsure(before.plan)));
    }
    let cached = press.afresh ? undefined : poller.cachedRead(pull, MERGE_FACTS);
    // What the press is weighed against is what Lo last read: a read that lands while Lo asks
    // GitHub where the pull request sits, and what goes with it, is weighed too, when it changes
    // what the confirmation named.
    for (let round = 1; ; round++) {
      const view = this.#options.view(press.id);
      if (!view) return { kind: 'closed' };
      const head = this.#options.headOnScreen(press.id) ?? '';
      if (!this.#current(cached, head, before?.endedAt)) {
        const read = await this.#readAgain(poller, pull, signal);
        if (typeof read === 'string') return { kind: 'unread', why: read };
        cached = read;
      }
      const facts = cached.value;
      const vetted = press.vet?.(facts, head);
      if (vetted) return refused(vetted);
      if (facts.pullRequest.head !== head) {
        return { kind: 'moved', from: head, to: facts.pullRequest.head };
      }
      const planned = await press.plan(facts, view, signal);
      signal.throwIfAborted();
      if (planned.kind === 'refused') return planned;
      // What a read that landed meanwhile plans: the same, or another round on it.
      const latest = poller.cachedRead(pull, MERGE_FACTS);
      if (!latest || !anotherRound(planned, facts, latest.value, head, press.same)) {
        return { kind: 'plan', plan: planned.plan, facts };
      }
      if (round === LOOKS) return { kind: 'changing' };
      cached = latest;
    }
  }

  /**
   * What `pull`'s merge of `kind` takes with it, as `login`, with where it sits read afresh, as a
   * press reads it, and GitHub's stacks holding it read where they decide that; and what decides
   * the merge once it goes so. Or why Lo doesn't merge it so: auto-merge and a merge past the rules
   * take nothing with them, so go only alone or as a GitHub stack's bottom layer.
   */
  async goesAs(
    kind: PlanKind,
    poller: MergingPoller,
    login: string,
    pull: PullRef,
    facts: MergeFacts,
    signal?: AbortSignal,
  ): Promise<Goes> {
    const placed = await this.#whereNow(poller, login, pull, facts, signal);
    signal?.throwIfAborted();
    const unknown = placed.kind === 'unknown';
    if (goesAlone(kind)) {
      const why = aloneOrBottom(placed, pull.number, kind === 'override');
      return why === undefined
        ? { kind: 'goes', onto: asTheyAre, together: null }
        : { kind: 'where', why, unknown };
    }
    const taking = await this.#takingNow(poller, login, pull, facts, signal, placed);
    signal?.throwIfAborted();
    const why = takingText(taking);
    if (why !== undefined) {
      return {
        kind: 'where',
        why,
        unknown: unknown || (taking.kind === 'refused' && taking.again === true),
      };
    }
    // A chain's bottom layer that moves onto the root first merges under the root's rules.
    const onto = await this.#rulesFor(poller, pull, taking, signal);
    signal?.throwIfAborted();
    if (typeof onto === 'string') return { kind: 'unread', why: onto };
    return { kind: 'goes', onto, together: togetherOf(taking) };
  }

  /** Why `kept` can't go from its tab now: it's closed, or acts as another account, or as none. */
  #tabHolds(kept: Kept): Refusal | undefined {
    const { plan, pull } = kept;
    const view = this.#options.view(plan.id);
    if (
      !view ||
      !new PullRef(view.repository.owner, view.repository.name, view.number).equals(pull)
    ) {
      return closed(plan);
    }
    const acting = actingOf(view);
    if (typeof acting === 'string' || !sameLogin(acting.login, plan.login)) {
      return own('account', `The tab no longer acts as ${plan.login}. Merge from the panel again.`);
    }
    return undefined;
  }

  /**
   * Why `kept` can't go now, as its tab, its account's `poller` and the head on screen say: what
   * the checks at the press start with, and what's checked again right before it goes.
   */
  #holds(kept: Kept, poller: MergingPoller): Refusal | undefined {
    const { plan } = kept;
    const tab = this.#tabHolds(kept);
    if (tab) return tab;
    const off = offOf(poller);
    if (off)
      return own(off.kind, offText(off), { until: off.kind === 'paused' ? off.until : null });
    const view = this.#options.view(plan.id);
    const head = this.#options.headOnScreen(plan.id) ?? '';
    // The tab knows of a newer push than the one on screen.
    if (head === plan.head && view?.latest !== undefined && view.latest !== head) {
      return newerPush(plan.number, head, view.latest);
    }
    return undefined;
  }

  /**
   * Whether `cached` can be acted on at the press: whole, confirmed in the last
   * {@link FRESH_FOR}, after a merge of it that ended at `endedAt`, and at `head`.
   */
  #current(
    cached: Cached<MergeFacts> | undefined,
    head: string,
    endedAt: number | undefined,
  ): cached is Cached<MergeFacts> {
    return (
      cached !== undefined &&
      this.#now() - cached.fetchedAt <= FRESH_FOR &&
      (endedAt === undefined || cached.fetchedAt > endedAt) &&
      cached.value.leftOut.length === 0 &&
      cached.value.pullRequest.head === head
    );
  }

  /** What decides `pull`'s merge, read again now, or why it couldn't be; given up on `signal`. */
  async #readAgain(
    poller: MergingPoller,
    pull: PullRef,
    signal: AbortSignal,
  ): Promise<Cached<MergeFacts> | string> {
    let mark = poller.readAfresh(pull, MERGE_FACTS);
    if (!mark) {
      await untilAborted(poller.mergeFacts(pull), signal);
      mark = poller.readAfresh(pull, MERGE_FACTS);
    }
    if (!mark) return 'the read isn’t kept.';
    const deadline = this.#now() + (this.#options.readWait ?? 20_000);
    for (;;) {
      if (this.#stopped) return 'Lo is quitting.';
      signal.throwIfAborted();
      const since = poller.readSince(pull, MERGE_FACTS, mark);
      if (since.kind === 'read') return since.read;
      if (since.kind === 'stale') return 'the read was let go of.';
      const heard = await nextRead(poller, pull, deadline - this.#now(), signal);
      signal.throwIfAborted();
      if (heard === 'failed') return 'GitHub didn’t answer it.';
      if (heard === 'late') return 'GitHub took too long to answer.';
    }
  }

  /**
   * Where `pull` sits, as `login`'s stacks list has it, with the open pull requests from each
   * branch its merge goes into read afresh. When the list doesn't hold it where GitHub says, Lo
   * lists the repository's open pull requests again, once, and waits for that.
   */
  async #whereNow(
    poller: MergingPoller,
    login: string,
    pull: PullRef,
    facts: MergeFacts,
    signal?: AbortSignal,
  ): Promise<Where> {
    const placed = placedBy(facts);
    const openFrom = new Map<string, OpenFromHead>();
    let listed = false;
    for (;;) {
      const forest = this.#options.forest(pull.repo, login);
      const list = poller.openPullRequests(pull.repo)?.value;
      const found = where({
        number: pull.number,
        facts: placed,
        forest,
        openFrom,
        unmerged: unmergedIn(list?.lookups ?? []),
        toLookUp: () => (list && forest ? leftToLookUp(list, forest.trunks) : undefined),
        now: this.#now(),
      });
      if (found.kind !== 'unknown') return found;
      const { why } = found;
      if (why.kind === 'unconfirmed' && !openFrom.has(why.branch)) {
        try {
          const read = await poller.readOnce(
            (client) => openPullsFromHead(client, pull.repo, why.branch),
            signal,
            'foreground',
          );
          openFrom.set(why.branch, read);
        } catch (error) {
          signal?.throwIfAborted();
          return {
            kind: 'unknown',
            why,
            text: `Lo couldn’t ask GitHub which open pull requests come from ${why.branch}: ${describe(error)}`,
            listAgain: false,
          };
        }
        continue;
      }
      if (!found.listAgain || listed) return found;
      listed = true;
      poller.listAgain(pull.repo);
      await this.#relisted(pull.repo, login, forest?.listedAt, signal);
      signal?.throwIfAborted();
    }
  }

  /**
   * What `pull`'s merge takes with it, where it sits as {@link Merging.#whereNow} says, or `known`
   * when that was asked already, with GitHub's stacks holding it read afresh where they decide
   * that; or why Lo doesn't merge it here.
   */
  async #takingNow(
    poller: MergingPoller,
    login: string,
    pull: PullRef,
    facts: MergeFacts,
    signal?: AbortSignal,
    known?: Where,
  ): Promise<Taking> {
    const placed = known ?? (await this.#whereNow(poller, login, pull, facts, signal));
    let github: Awaited<ReturnType<typeof stacksHolding>> | 'unread' = 'unread';
    if (needsStacks(placed)) {
      try {
        github = await poller.readOnce(
          (client) => stacksHolding(client, pull.repo, pull.number),
          signal,
          'foreground',
        );
      } catch (error) {
        signal?.throwIfAborted();
        return {
          kind: 'refused',
          why: `Lo couldn’t ask GitHub which stack #${pull.number} is in: ${describe(error)}`,
        };
      }
    }
    const list = poller.openPullRequests(pull.repo)?.value;
    const layers = poller.cachedRead(pull, STACK_LAYERS)?.value.layers ?? [];
    const taking = takingOf({
      number: pull.number,
      base: rulesBase(facts),
      where: placed,
      forest: this.#options.forest(pull.repo, login),
      github,
      title: (number) => (list && openPullRequest(list, number)?.title) ?? '',
      state: (number) => layerState(layers.find((layer) => layer.number === number)),
      queued: layers.flatMap((layer) => (layer.isInMergeQueue ? [layer.number] : [])),
    });
    if (taking.kind === 'refused' && taking.readAgain === true) poller.readMergeFactsAgain(pull);
    return taking;
  }

  /**
   * What decides `pull`'s merge once it goes as `taking` says, from what decides it as it stands:
   * that as it is, or, for a chain's bottom layer that moves onto the root first, under the root's
   * rules, read afresh. Why not, when they can't be read.
   */
  async #rulesFor(
    poller: MergingPoller,
    pull: PullRef,
    taking: Taking,
    signal?: AbortSignal,
  ): Promise<((facts: MergeFacts) => MergeFacts) | string> {
    const before = taking.kind === 'chain' ? taking.plan.retargetBefore : undefined;
    if (before === undefined) return asTheyAre;
    try {
      const onto = await poller.readOnce(
        (client) => rulesOnto(client, pull.repo, before.to),
        signal,
        'foreground',
      );
      return (facts) => factsOnto(facts, onto);
    } catch (error) {
      signal?.throwIfAborted();
      return `Lo couldn’t read ${before.to}’s rules, which #${pull.number} merges under once it’s moved there: ${describe(error)}`;
    }
  }

  /**
   * Waits for `login`'s list of `repo`'s open pull requests to be confirmed after `since`, looking
   * every quarter second, for {@link MergingOptions.listWait} at most.
   */
  async #relisted(
    repo: RepoRef,
    login: string,
    since: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const every = 250;
    for (let waited = 0; waited < (this.#options.listWait ?? 15_000); waited += every) {
      if (this.#stopped || signal?.aborted) return;
      const listedAt = this.#options.forest(repo, login)?.listedAt;
      if (listedAt !== undefined && listedAt !== since) return;
      await new Promise((resolve) => setTimeout(resolve, every));
    }
  }

  /** Sends `kept`'s merge, in its pull request's turn, through the app's jobs. */
  #send(kept: Kept, poller: MergingPoller): Exclude<Confirmed, { kind: 'again' }> {
    const { plan, pull } = kept;
    const request = requestOf(plan);
    if (isRefusal(request)) return refused(refusalOf(request, plan.head));
    const busy = own('busy', `Lo is already merging #${plan.number}.`);
    const running = this.#options.jobs.job(pull);
    if (running && running.state.kind !== 'done') return refused(busy);
    const { together } = plan;
    // A stack's layers take their turns with it. The layers on a chain's bottom one take theirs
    // apart, which the chain's run holds until it has moved them.
    const turn = this.#options.turns.take(pull.repo, sentNames(plan));
    if ('busy' in turn) return refused(own('busy', `Lo is already merging #${turn.busy}.`));
    let layersTurn: MergeTurn | undefined;
    if (together?.kind === 'chain') {
      const rest = namesOf(plan.number, together).slice(1);
      const taken = rest.length === 0 ? undefined : this.#options.turns.take(pull.repo, rest);
      if (taken && 'busy' in taken) {
        turn.give();
        return refused(own('busy', `Lo is already merging #${taken.busy}.`));
      }
      layersTurn = taken;
    }
    // The last merge of it ended: what the window has of it goes with this one.
    const previous = this.#sent.get(pull.key);
    if (previous) {
      previous.unwatch?.();
      this.#options.jobs.forget(pull);
    }
    const sent: Sent = {
      plan,
      pull,
      poller,
      turn,
      lacking: [],
      remembered: false,
      own: undefined,
      shows: undefined,
      unwatch: undefined,
      endedAt: undefined,
      dismissed: false,
      stack:
        together?.kind === 'stack'
          ? { states: new Map(), takenAt: undefined, reading: false, again: false }
          : undefined,
      chain: undefined,
    };
    if (together?.kind === 'chain') {
      sent.chain = { run: this.#chainRun(sent, together), turn: layersTurn };
    }
    this.#sent.set(pull.key, sent);
    const run = sent.chain?.run;
    if (run && together?.kind === 'chain' && together.before !== null) {
      // The bottom layer moves onto the root first, and merges once it's there.
      this.#publish(sent);
      void run.moveFirst().then((go) => {
        if (!go || this.#sent.get(pull.key) !== sent) return;
        if (!this.#stopped && !this.#options.jobs.merge(poller, pull, request)) return;
        // The jobs stopped, as Lo quits: the merge never went.
        sent.turn?.give();
        sent.turn = undefined;
        run.failed();
      });
      return { kind: 'sent' };
    }
    const refusal = this.#options.jobs.merge(poller, pull, request);
    if (refusal) {
      turn.give();
      sent.chain?.run.stop();
      this.#sent.delete(pull.key);
      return refused(refusal.refusal === 'stopped' ? own('stopped', 'Lo is quitting.') : busy);
    }
    return { kind: 'sent' };
  }

  /**
   * Turns on auto-merge as `kept` says, in its pull request's turn, with the head on screen, which
   * GitHub turns it on for only while it's the head. Sent at once: nothing waits before it goes.
   */
  #sendAuto(
    kept: Kept,
    poller: MergingPoller,
    heard?: (answer: AutoAnswer) => void,
  ): Exclude<Confirmed, { kind: 'again' }> {
    const { plan, pull } = kept;
    // A queue's settings choose its method, whatever is asked.
    const method = plan.method ?? 'MERGE';
    return this.#sendOwn(
      plan,
      pull,
      poller,
      (pullRequestId) =>
        poller.enableAutoMerge(pull, pullRequestId, { expectedHead: plan.head, method }),
      { heard },
    );
  }

  /**
   * Sends `write`, a merge write the jobs don't follow, for `plan`, in its pull request's turn, and
   * follows its answer itself: on, off, refused, or, when the answer may be lost, unknown until a
   * read settles it. Refused, as the turn's taken, nothing is sent.
   */
  #sendOwn(
    plan: SentPlan,
    pull: PullRef,
    poller: MergingPoller,
    write: (pullRequestId: string) => Promise<AutoMergeState | MergeRefusal>,
    options: OwnOptions = {},
  ): Exclude<Confirmed, { kind: 'again' }> {
    const pullRequestId = poller.pullRequest(pull)?.details.id;
    if (pullRequestId === undefined) {
      return refused(own('unread', `Lo hasn’t read #${plan.number} from GitHub yet.`));
    }
    const running = this.#options.jobs.job(pull);
    if (running && running.state.kind !== 'done') {
      return refused(own('busy', `Lo is already merging #${plan.number}.`));
    }
    const turn = this.#options.turns.take(pull.repo, [pull.number]);
    if ('busy' in turn) return refused(own('busy', `Lo is already merging #${turn.busy}.`));
    const previous = this.#sent.get(pull.key);
    if (previous) {
      previous.unwatch?.();
      this.#options.jobs.forget(pull);
    }
    const sent: Sent = {
      plan,
      pull,
      poller,
      turn,
      lacking: [],
      remembered: false,
      own: { kind: 'sending' },
      shows: undefined,
      unwatch: undefined,
      endedAt: undefined,
      dismissed: false,
      stack: undefined,
      chain: undefined,
      heard: options.heard,
      watch: options.watch === true,
    };
    this.#sent.set(pull.key, sent);
    this.#publish(sent);
    write(pullRequestId).then(
      (answer) => this.#answered(sent, answer),
      (error: unknown) => this.#unanswered(sent, error),
    );
    return { kind: 'sent' };
  }

  /** GitHub answered `sent`'s write: it ends as GitHub says, and its turn is given back. */
  #answered(sent: Sent, answer: AutoMergeState | MergeRefusal): void {
    if (this.#sent.get(sent.pull.key) !== sent) return;
    sent.endedAt = this.#now();
    this.#tell(sent, isRefusal(answer) ? { refused: answer } : answer);
    const on = sent.plan.kind !== 'autoMergeOff';
    if (isRefusal(answer)) {
      sent.turn?.give();
      sent.turn = undefined;
      // Approve and ship, which hears it, reads again and goes on itself.
      if (answer.refusal === 'canMergeNow' && on && !sent.heard) {
        void this.#offerMerge(sent);
        return;
      }
      sent.own = { kind: 'refused', refusal: autoRefusalOf(answer, sent.plan.head) };
      this.#publish(sent);
      return;
    }
    // What GitHub says it now has; where that isn't what was asked, a read settles it.
    let ended: JobState | undefined;
    if (on) {
      if (answer.inQueue) ended = { kind: 'enqueued' };
      else if (answer.autoMerge !== undefined) ended = { kind: 'autoMergeOn' };
    } else if (answer.inQueue) {
      // Auto-merge had added it to the queue already, which merges it once its checks pass.
      ended = {
        kind: 'refused',
        refusal: own(
          'queued',
          `#${sent.plan.number} joined the merge queue for ${sent.plan.base} before auto-merge went off, so it merges once the queue’s checks pass. Take it out of the queue on GitHub to stop it.`,
        ),
      };
    } else if (answer.autoMerge === undefined) {
      ended = { kind: 'autoMergeOff' };
    }
    if (ended === undefined) {
      sent.own = {
        kind: 'unknown',
        why: 'status',
        text: `GitHub answered, but not with auto-merge ${on ? 'on' : 'off'}. Lo reads the pull request again, which shows whether it is.`,
        askAgain: false,
        shows: null,
      };
      this.#publish(sent);
      this.#settle(sent);
      return;
    }
    sent.turn?.give();
    sent.turn = undefined;
    sent.own = ended;
    this.#publish(sent);
  }

  /**
   * `sent`'s write failed: unsent, as for a signed-out account, it's refused; else its answer may
   * be lost, and the pull request's turn stays taken until a read made since settles it.
   */
  #unanswered(sent: Sent, error: unknown): void {
    if (this.#sent.get(sent.pull.key) !== sent) return;
    sent.endedAt = this.#now();
    const unsent = error instanceof GithubError && !error.mayHavePosted();
    this.#tell(sent, unsent ? { refused: undefined } : 'lost');
    if (error instanceof GithubError && !error.mayHavePosted()) {
      sent.turn?.give();
      sent.turn = undefined;
      sent.own = { kind: 'refused', refusal: unsentOf(error.detail) };
      this.#publish(sent);
      return;
    }
    const why =
      error instanceof GithubError
        ? `GitHub’s answer didn’t reach Lo: ${error.message}`
        : `Lo couldn’t read GitHub’s answer: ${describe(error)}`;
    sent.own = {
      kind: 'unknown',
      why: 'noAnswer',
      text: `${why} Lo reads the pull request again, which shows whether it is, and sends nothing again.`,
      askAgain: false,
      shows: null,
    };
    this.#publish(sent);
    this.#settle(sent);
  }

  /**
   * GitHub won't turn on auto-merge for `sent` because nothing blocks the merge now: Lo reads the
   * pull request again, and offers the merge in its place, with the squash text typed, kept for the
   * reader to confirm, when the read agrees and the reader hasn't planned anything else for the view
   * since. The refusal says so either way.
   */
  async #offerMerge(sent: Sent): Promise<void> {
    const { plan, pull, poller } = sent;
    const text = `Nothing blocks #${plan.number} now, so GitHub didn’t turn on auto-merge.`;
    let offer: MergePlan | undefined;
    try {
      const read = await this.#readAgain(poller, pull, new AbortController().signal);
      const view = this.#options.view(plan.id);
      if (typeof read !== 'string' && view && !this.#stopped) {
        const planned = this.#planOf(plan.id, view, plan.login, read.value, {
          method: plan.method,
          title: plan.title,
          message: plan.message,
          asked: 'merge',
        });
        if (typeof planned !== 'string' && planned.head === plan.head) offer = planned;
      }
    } catch (error) {
      this.#options.log(`${pull.toString()}: ${describe(error)}`);
    }
    if (this.#sent.get(pull.key) !== sent) return;
    // A plan the reader made since stays: it isn't replaced unseen.
    if ([...this.#kept.values()].some((kept) => kept.plan.id === plan.id)) offer = undefined;
    if (offer) this.#keep(offer, pull);
    sent.own = {
      kind: 'refused',
      refusal: own(
        'canMergeNow',
        offer ? `${text} It can merge as it is.` : `${text} Merge it from the panel.`,
        {
          ...(offer && { offer }),
        },
      ),
    };
    this.#publish(sent);
  }

  /** Tells who sent `sent` how GitHub answered it, or that the answer is lost. */
  #tell(sent: Sent, answer: AutoAnswer): void {
    try {
      sent.heard?.(answer);
    } catch (error) {
      this.#options.log(`${sent.pull.toString()}: ${describe(error)}`);
    }
  }

  /** Whether `sent`'s write has ended, as far as Lo knows. */
  #ended(sent: Sent): boolean {
    if (sent.own) return sent.own.kind !== 'sending';
    return this.#options.jobs.job(sent.pull)?.state.kind === 'done';
  }

  /** The run of a chain's merge from its bottom layer, `sent`, as the plan's `together` says. */
  #chainRun(sent: Sent, together: Extract<Together, { kind: 'chain' }>): ChainRun {
    const { poller, pull } = sent;
    return new ChainRun({
      repo: pull.repo,
      number: pull.number,
      together,
      method: sent.plan.method,
      retarget: (repo, step, signal) => poller.runConversionStep(repo, step, signal),
      look: async (signal): Promise<Looked> => {
        const check = await poller.readOnce(
          (client) => pullRequestCheck(client, pull.repo.owner, pull.repo.name, pull.number),
          signal,
        );
        if (check.state === 'MERGED') return 'merged';
        if (check.state === 'CLOSED') return 'closed';
        return check.mergeQueueEntry ? 'queued' : 'open';
      },
      changed: () => {
        if (this.#sent.get(pull.key) === sent) this.#publish(sent);
      },
      ended: () => {
        sent.chain?.turn?.give();
        if (sent.chain) sent.chain.turn = undefined;
        // One that stopped before its merge went has no job to give the pull request's turn back.
        if (!this.#options.jobs.job(pull)) {
          sent.turn?.give();
          sent.turn = undefined;
        }
      },
      log: this.#options.log,
      every: this.#options.chainEvery,
    });
  }

  /** A job changed: says so to the window, remembers the method once GitHub took it, and ends it. */
  #heard(pull: PullRef, done: boolean): void {
    const sent = this.#sent.get(pull.key);
    // A write Lo follows itself isn't the jobs'.
    if (!sent || sent.own) return;
    const job = this.#options.jobs.job(pull);
    if (!job) return;
    this.#rememberIfTaken(sent, job);
    if (sent.stack) {
      if (sent.stack.takenAt === undefined && job.uuid !== undefined) {
        sent.stack.takenAt = this.#now();
      }
      this.#readStack(sent);
    }
    if (done && sent.chain) {
      const { run } = sent.chain;
      const ended = endedWith(job);
      switch (ended?.kind) {
        case 'merged':
          run.merged();
          break;
        case 'enqueued':
          run.enqueued();
          break;
        case 'unknown':
          run.unsure();
          break;
        case 'refused':
        case 'failed':
        case 'alreadyRunning':
        case undefined:
          run.failed();
          break;
        default:
          ended satisfies never;
          run.failed();
      }
    }
    if (done) {
      sent.endedAt = this.#now();
      sent.shows = undefined;
      if (endedWith(job)?.kind === 'unknown') {
        // It may have merged, or still be merging: the turn stays until a read settles it.
        this.#settle(sent);
      } else {
        sent.lacking = [];
        sent.turn?.give();
        sent.turn = undefined;
      }
    }
    this.#publish(sent);
  }

  /** Remembers the plan's method for the repository once GitHub took the merge with it. */
  #rememberIfTaken(sent: Sent, job: Job): void {
    const { plan } = sent;
    if (sent.remembered || plan.method === null) return;
    if (plan.kind !== 'merge' && plan.kind !== 'override') return;
    // Another merge GitHub was already running took its own method, not this one.
    if (job.running !== undefined) return;
    const taken =
      (job.state.kind === 'pending' && job.uuid !== undefined) ||
      (job.state.kind === 'done' && job.state.outcome.kind === 'merged');
    if (!taken) return;
    sent.remembered = true;
    this.#options.remember(sent.pull.repo, plan.method);
  }

  /**
   * Settles a merge Lo can't tell the end of by reading the pull request again: merged, or in the
   * queue, ends it so; still open, it says so, and stays unknown.
   */
  #settle(sent: Sent): void {
    const { poller, pull } = sent;
    sent.unwatch?.();
    let mark = poller.readAfresh(pull, MERGE_FACTS);
    const look = () => {
      if (this.#sent.get(pull.key) !== sent) return;
      const since = mark && poller.readSince(pull, MERGE_FACTS, mark);
      if (!since || since.kind === 'stale') {
        // Not kept, or let go, as when its tab closed: the read kept now, as when the tab opens
        // again, runs again from here, and that settles it.
        mark = poller.readAfresh(pull, MERGE_FACTS);
        return;
      }
      if (since.kind !== 'read') return;
      // A read made after the merge ended settles it: the pull request may be merged again.
      sent.lacking = [];
      sent.turn?.give();
      sent.turn = undefined;
      const shown = since.read.value.pullRequest;
      // What GitHub has of auto-merge settles a write to it, whichever way it went.
      const still = sent.own ? (shown.autoMerge ? 'autoMergeOn' : 'autoMergeOff') : 'open';
      const shows = shown.state === 'MERGED' ? 'merged' : shown.inQueue ? 'enqueued' : still;
      if (sent.dismissed) {
        this.#forget(sent);
        return;
      }
      if (shows === sent.shows) return;
      sent.shows = shows;
      if (shows !== 'open') {
        sent.unwatch?.();
        sent.unwatch = undefined;
      }
      this.#publish(sent);
    };
    const stop = poller.onEvent((event: PollEvent) => {
      if (event.kind !== 'read' && event.kind !== 'confirmed') return;
      if (event.pull.equals(pull) && event.name === MERGE_FACTS.name) look();
    });
    sent.unwatch = stop;
    if (!mark) {
      // Not kept, as for a pull request no view shows: kept from now, and read.
      poller
        .mergeFacts(pull)
        .then(() => {
          mark ??= poller.readAfresh(pull, MERGE_FACTS);
        })
        .catch((error: unknown) => this.#options.log(`${pull.toString()}: ${describe(error)}`));
    }
  }

  #byKey(key: string): Sent | undefined {
    return [...this.#sent.values()].find((sent) => sent.plan.key === key);
  }

  #viewOf(sent: Sent): JobView | undefined {
    const job = sent.own ? undefined : this.#options.jobs.job(sent.pull);
    const { plan } = sent;
    if (!sent.own && !job) {
      // A chain's bottom layer moving onto the root, before its merge is sent.
      const progress = sent.chain?.run.view();
      if (progress?.kind !== 'chain') return undefined;
      const stopped = progress.phase === 'stopped';
      return {
        ...jobOf(plan, false),
        state: stopped
          ? { kind: 'refused', refusal: own('notMoved', progress.text ?? 'Lo didn’t merge it.') }
          : { kind: 'sending' },
        together: progress,
      };
    }
    const was = sent.own ?? (job && stateOf(job));
    if (!was) return undefined;
    let state: JobState = was;
    if (state.kind === 'unknown' && sent.own && sent.shows !== undefined && sent.shows !== 'open') {
      state = settledOwn(plan, sent.shows);
    } else if (state.kind === 'unknown' && sent.shows !== undefined) {
      switch (sent.shows) {
        case 'merged':
        case 'enqueued':
        case 'autoMergeOn':
        case 'autoMergeOff':
          state = { kind: sent.shows };
          break;
        case 'open':
          state = { ...state, shows: 'open' };
          break;
        default:
          sent.shows satisfies never;
      }
    }
    return {
      ...jobOf(plan, job?.running !== undefined),
      state,
      together: job ? this.#progressOf(sent, job) : null,
      ...(sent.watch === true && { watch: true as const }),
    };
  }

  /** How what `sent`'s merge takes with it goes: its stack's layers, or its chain's moves. */
  #progressOf(sent: Sent, job: Job): Progress | null {
    if (sent.chain) return sent.chain.run.view();
    const { together } = sent.plan;
    if (!sent.stack || together?.kind !== 'stack') return null;
    const ended = endedWith(job);
    const { states } = sent.stack;
    return {
      kind: 'stack',
      layers: [
        ...together.below.map((layer) => ({
          number: layer.number,
          title: layer.title,
          state: states.get(layer.number) ?? null,
        })),
        { number: sent.plan.number, title: '', state: states.get(sent.plan.number) ?? null },
      ],
      above: [...together.above],
      takenAt: sent.stack.takenAt ?? null,
      landed: ended?.kind === 'failed' ? (ended.landed ?? null) : [],
    };
  }

  /**
   * Reads GitHub's stack holding `sent`'s pull request, for how far its merge got, and says so:
   * once at a time, and once more after, when the merge changed meanwhile.
   */
  #readStack(sent: Sent): void {
    const read = sent.stack;
    if (!read) return;
    if (read.reading) {
      read.again = true;
      return;
    }
    read.reading = true;
    read.again = false;
    const { poller, pull } = sent;
    poller
      .readOnce((client) => stackHolding(client, pull.repo, pull.number))
      .then((stack) => {
        for (const layer of stack?.pull_requests ?? []) {
          const state: LayerState =
            layer.merged_at !== undefined ? 'merged' : layer.state === 'open' ? 'open' : 'closed';
          read.states.set(layer.number, state);
        }
      })
      .catch((error: unknown) => this.#options.log(`${pull.toString()}: ${describe(error)}`))
      .finally(() => {
        read.reading = false;
        if (this.#sent.get(pull.key) !== sent) return;
        this.#publish(sent);
        if (read.again && !this.#stopped) this.#readStack(sent);
      });
  }

  #publish(sent: Sent): void {
    const view = this.#viewOf(sent);
    if (!view) return;
    try {
      this.#options.publish(view);
    } catch (error) {
      this.#options.log(`sending a merge: ${describe(error)}`);
    }
  }
}

/** The account `view` acts as, or why it can't merge. */
function actingOf(view: PullTabInfo | undefined): { login: string } | string {
  if (!view) return 'There’s no pull request in that tab.';
  if (view.run) return 'Show a layer to merge it.';
  if (view.acting === undefined) return 'Lo is still working out which account this tab acts as.';
  if (view.acting.kind === 'anonymous') return 'Sign in to merge.';
  return { login: view.acting.login };
}

function refused(refusal: Refusal): Extract<Confirmed, { kind: 'refused' }> {
  return { kind: 'refused', refusal };
}

function closed(plan: MergePlan): Refusal {
  return own('closed', `#${plan.number}’s tab is closed. Merge from its panel again.`);
}

function cancelled(): Refusal {
  return own('cancelled', 'Cancelled. Nothing was sent.');
}

/** A newer push than the one on screen: "See r5 → r6" compares them. */
function newerPush(number: number, from: string, to: string): Refusal {
  const valid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
  return own(
    'newerPush',
    `#${number} has a newer push than the one on screen, so Lo didn’t merge. See what it changed, then merge.`,
    { newer: valid.test(from) ? { from, to: valid.test(to) ? to : null } : null },
  );
}

/** What a job's view says of the merge `plan` asked for, whatever its state. */
function jobOf(plan: SentPlan, already: boolean): Omit<JobView, 'state' | 'together'> {
  return {
    key: plan.key,
    owner: plan.owner,
    repo: plan.repo,
    number: plan.number,
    login: plan.login,
    kind: plan.kind,
    method: plan.method,
    base: plan.base,
    head: plan.head,
    already,
  };
}

/**
 * What the merge GitHub is asked for: straight in with the method, or past the rules, or into the
 * merge queue; for a GitHub stack's layer, with the layers below, at the heads the confirmation
 * named.
 */
function requestOf(plan: MergePlan): MergeRequest | MergeRefusal {
  const request = mergeOf(plan);
  const { together } = plan;
  if (isRefusal(request) || together?.kind !== 'stack') return request;
  const layered = withLayersBelow(
    request,
    together.below.map((layer) => ({ pr: layer.number, head: layer.head })),
  );
  // An override can't have layers below, and Lo plans none with them.
  if (isRefusal(layered) && layered.refusal === 'adminOverrideLayers') {
    return {
      refusal: 'other',
      message: 'GitHub merges past the rules only a stack’s bottom layer',
    };
  }
  return layered;
}

/** The merge of `plan`'s pull request alone. */
function mergeOf(plan: MergePlan): MergeRequest | MergeRefusal {
  if (plan.kind === 'enqueue') return queueMerge(plan.head);
  const request =
    plan.kind === 'override'
      ? adminOverride(plan.head, plan.method ?? 'MERGE')
      : directMerge(plan.head, plan.method ?? 'MERGE');
  if (isRefusal(request)) return request;
  // Only what the reader typed: an empty field leaves GitHub's own.
  // A stack's layers keep their own commits' words.
  const stack = plan.together?.kind === 'stack';
  if (plan.method === 'SQUASH' && !stack && (plan.title !== '' || plan.message !== '')) {
    return withCommit(
      request,
      plan.title === '' ? undefined : plan.title,
      plan.message === '' ? undefined : plan.message,
    );
  }
  return request;
}

/** Why a pull request can't merge or join the queue, as `mergeAction` says. */
function notPossibleText(
  reason: 'merged' | 'closed' | 'queued' | 'blocked' | 'noPermission' | 'noMethod',
  number: number,
  login: string,
  base: string,
): string {
  switch (reason) {
    case 'merged':
      return `#${number} is merged.`;
    case 'closed':
      return `#${number} is closed.`;
    case 'queued':
      return `#${number} is in the merge queue already.`;
    case 'blocked':
      return `#${number} can’t merge now. The merge panel says why.`;
    case 'noPermission':
      return `GitHub doesn’t let ${login} merge into ${base}.`;
    case 'noMethod':
      return 'The repository allows no merge method.';
    default:
      reason satisfies never;
      throw new Error(`a reason Lo doesn't know: ${String(reason)}`);
  }
}

/**
 * The pull requests whose turns a merge from `plan` holds while GitHub runs it: a stack's layers
 * with it. The layers on a chain's bottom one take theirs apart, which its run holds until it has
 * moved them.
 */
function sentNames(plan: Pick<SentPlan, 'number' | 'together'>): number[] {
  return plan.together?.kind === 'stack' ? namesOf(plan.number, plan.together) : [plan.number];
}

/** Why Lo doesn't merge as `taking` says: nothing when it goes. */
function takingText(taking: Taking): string | undefined {
  switch (taking.kind) {
    case 'alone':
    case 'stack':
    case 'chain':
      return undefined;
    case 'convert':
      return convertFirst(taking.offer);
    case 'refused':
      return taking.why;
    default:
      taking satisfies never;
      throw new Error(`a merge Lo doesn't know: ${JSON.stringify(taking)}`);
  }
}

/** What Lo says when it can't tell how its last write of `plan`'s kind to the pull request ended. */
function unsure(plan: Pick<SentPlan, 'kind' | 'number'>): string {
  if (isAuto(plan.kind)) return `Lo can’t tell whether auto-merge is on for #${plan.number}.`;
  if (plan.kind === 'autoMergeOff') {
    return `Lo can’t tell whether auto-merge is off for #${plan.number}.`;
  }
  return `Lo can’t tell whether #${plan.number} merged.`;
}

/** Why `a` can't turn auto-merge on, as {@link autoActionOf} says. */
function autoText(
  action: Exclude<AutoAction, { kind: 'on' }>,
  number: number,
  login: string,
  base: string,
): string {
  if (action.kind === 'off') return `Auto-merge is on for #${number} already.`;
  switch (action.reason) {
    case 'merged':
    case 'closed':
    case 'queued':
    case 'noMethod':
      return notPossibleText(action.reason, number, login, base);
    case 'ready':
      return `Nothing blocks #${number} now, so it can merge as it is.`;
    case 'blocked':
      return `Something waiting won’t fix is in #${number}’s way, so auto-merge would wait for good. The merge panel says what.`;
    case 'noPermission':
      return `GitHub doesn’t let ${login} add to the merge queue for ${base}.`;
    case 'notAllowed':
      return `GitHub doesn’t let ${login} turn on auto-merge for #${number}. The repository may not allow it: a maintainer turns it on in its settings.`;
    case 'cantTurnOff':
      return `GitHub doesn’t let ${login} turn off auto-merge for #${number}.`;
    default:
      action.reason satisfies never;
      throw new Error(`a reason Lo doesn't know: ${String(action.reason)}`);
  }
}

/** Why `⌥⏎` can't merge past the rules, as {@link overrideActionOf} says. */
function overrideText(
  action: Extract<OverrideAction, { kind: 'notPossible' }>,
  number: number,
  login: string,
  base: string,
): string {
  switch (action.reason) {
    case 'merged':
    case 'closed':
    case 'queued':
    case 'noMethod':
      return notPossibleText(action.reason, number, login, base);
    case 'nothingToSkip':
      return `Nothing blocks #${number}, so there’s no rule to skip: it can merge as it is.`;
    case 'noPermission':
      return `GitHub doesn’t let ${login} merge past ${base}’s rules.`;
    case 'draft':
      return `#${number} is a draft, which GitHub doesn’t merge, past the rules or not.`;
    case 'conflicts':
      return `#${number} conflicts with ${base}, which no rule skips.`;
    case 'stackLayer':
      return `#${number} sits on another layer of its GitHub stack, and GitHub merges past the rules only a stack’s bottom layer.`;
    default:
      action.reason satisfies never;
      throw new Error(`a reason Lo doesn't know: ${String(action.reason)}`);
  }
}

/** The method chosen in the panel, if the repository allows it, else the one Lo picks. */
function chosenMethod(snapshot: MergeSnapshot, choice: Choice): Method | null {
  const methods = methodList(allowedMethods(snapshot));
  return choice.method !== null && methods.includes(choice.method)
    ? choice.method
    : (pickedMethod(snapshot) ?? null);
}

/**
 * What `a` or `⌥⏎` plans from `snapshot`, as `choice` asked: auto-merge on, straight in or into
 * the queue once ready, or a merge past the rules; or why neither; or nothing, to plan the merge
 * itself, for `⏎`, or for auto-merge asked when nothing blocks the merge.
 */
function otherWay(
  snapshot: MergeSnapshot,
  choice: Choice,
  {
    number,
    login,
    base,
    aboveBottom,
  }: { number: number; login: string; base: string; aboveBottom: boolean },
): { kind: PlanKind; method: Method | null } | string | undefined {
  const asked = choice.asked ?? 'merge';
  switch (asked) {
    case 'merge':
      return undefined;
    case 'autoMerge': {
      const auto = autoActionOf(snapshot);
      if (auto.kind === 'notPossible' && auto.reason === 'ready') return undefined;
      if (auto.kind !== 'on') return autoText(auto, number, login, base);
      // A queue's settings choose its method, which GitHub reports as a merge commit whatever was
      // asked.
      if (snapshot.queue.required)
        return { kind: 'whenReady', method: snapshot.queue.method ?? null };
      return { kind: 'autoMerge', method: chosenMethod(snapshot, choice) };
    }
    case 'override': {
      const override = overrideActionOf(snapshot, aboveBottom);
      if (override.kind === 'notPossible') return overrideText(override, number, login, base);
      return { kind: 'override', method: chosenMethod(snapshot, choice) };
    }
    default:
      asked satisfies never;
      throw new Error(`a way to merge Lo doesn't know: ${String(asked)}`);
  }
}

/** What `promise` gives, unless `signal` gives up first: then its reason, at once. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const given = () =>
      reject(signal.reason instanceof Error ? signal.reason : new Error('Given up.'));
    signal.addEventListener('abort', given, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', given);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', given);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** The next read of `pull`'s merge facts, or why there's none within `wait` milliseconds. */
function nextRead(
  poller: Pick<Poller, 'onEvent'>,
  pull: PullRef,
  wait: number,
  signal: AbortSignal,
): Promise<'read' | 'failed' | 'late'> {
  return new Promise((resolve) => {
    if (wait <= 0 || signal.aborted) {
      resolve('late');
      return;
    }
    const done = (how: 'read' | 'failed' | 'late') => {
      clearTimeout(timer);
      stop();
      signal.removeEventListener('abort', given);
      resolve(how);
    };
    const given = () => done('late');
    signal.addEventListener('abort', given);
    const timer = setTimeout(() => done('late'), wait);
    const stop = poller.onEvent((event: PollEvent) => {
      if (event.kind !== 'read' && event.kind !== 'confirmed' && event.kind !== 'readFailed') {
        return;
      }
      if (!event.pull.equals(pull) || event.name !== MERGE_FACTS.name) return;
      done(event.kind === 'readFailed' ? 'failed' : 'read');
    });
  });
}
