// Approve and ship, in main: `⌘⇧⏎` reads what decides the merge, and `@lo/review`'s
// `approveAndShip` plans it: whether to approve the revision on screen, and what Lo expects to
// follow, from where the pull request sits, as the merge panel asks it (`Merging.goesAs`). What
// planning asks GitHub takes 20 s at most: then Lo says it couldn't check. The plan is kept under a
// key for the reader to confirm in one confirmation; the window confirms the key and never sends
// anything itself. A plan runs once. As it's confirmed, main weighs it as a merge's press is
// weighed (`Merging.weigh`), reading GitHub again whatever it read before, and planning again from
// a read that lands meanwhile: someone pushed since the revision on screen, and it stops before
// approving; anything else the confirmation named changed, and it asks again with a new plan. From
// the press on it holds the pull request's turn among merge writes.
//
// It approves through the review feature, in its turn among the writes to the pull request,
// comments included. An answer that's lost is settled by reading your reviews, and nothing more is
// sent until it is: Lo waits for that a minute at most, while the tab is open, and then stops,
// saying it can't tell whether GitHub took the approval, and gives back the pull request's turn,
// while the review feature goes on settling it. Then it reads GitHub again until that shows your
// approval, and calls `afterApproving`; a read that lands while it asks where the pull request
// sits, and changes anything the confirmation named, the base among it, is another round, as at the
// press. It goes on only when that's what the confirmation asked (`asAsked`), into the branch it
// named, and only for a pull request alone or a GitHub stack's bottom layer: you approve only
// what's on screen, so it merges nothing with it. Anywhere else, and wherever the merge panel
// wouldn't merge from, the plan is to stop after approving, saying why, and leave the merge to the
// panel. An approval Lo can't tell GitHub took is settled by reading the pull request, and said so
// until it is. The merge, queue entry or auto-merge goes through the merge jobs, as the panel's
// does (`Merging.sendShipped`). Auto-merge it turns on after your approval is kept for the watch
// (`./watch.ts`), so a push before it merges doesn't merge with your approval. Nothing here calls
// Electron.

import {
  GithubError,
  isFullSha,
  MERGE_FACTS,
  PullRef,
  rulesBase,
  type Cached,
  type GithubErrorDetail,
  type MergeFacts,
  type PollEvent,
  type Poller,
  type RepoRef,
} from '@lo/github';
import {
  afterApproving,
  approveAndShip,
  approves,
  asAsked,
  mergeSnapshot,
  showsYourApproval,
  unwarnedAutoMerge,
  type MergeSnapshot,
  type Plan,
  type Ship,
  type Stop,
} from '@lo/review';

import type { Approved, SummaryKept } from '../../review/service.ts';
import type { Converting } from '../../stacks/service.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type {
  MergePlan,
  Method,
  PlanKind,
  Refusal,
  ShipApproval,
  ShipConfirmed,
  ShipPhase,
  ShipPlan,
  ShipPlanned,
  ShipStep,
  ShipStop,
  ShipView,
  Together,
} from '../contract.ts';
import type { MergeTurn, MergeWrites } from '../service.ts';
import { afterPushOf } from './auto.ts';
import { explained, rawOf, type Asker } from './causes.ts';
import {
  anotherRound,
  busyText,
  LOOKS,
  offOf,
  offRefusal,
  type AutoAnswer,
  type Goes,
  type Merging,
  type MergingPoller,
  type PressPlan,
  type Weighed,
} from './merging.ts';
import { blockersOf } from './status.ts';
import { numbers } from './together.ts';

/** What approve and ship keeps for the auto-merge it turns on: as `ShipWatch.keep` takes it. */
export interface Shipped {
  readonly login: string;
  readonly pull: PullRef;
  /** The head you approved, which auto-merge expects. */
  readonly head: string;
  /** The branch it merges into. */
  readonly base: string;
  /**
   * The method sent, or nothing on a branch with a merge queue, where GitHub reports a merge
   * commit whatever was asked, so the watch doesn't compare it.
   */
  readonly method: Method | null;
}

export interface ShippingOptions {
  /** An account's poller. Throws for an account Lo doesn't have. */
  readonly poller: (login: string) => Promise<MergingPoller>;
  /** What main has of a view now, or nothing once it's closed. */
  readonly view: (id: string) => PullTabInfo | undefined;
  /** The head on screen in view `id`: the newer side of what it compares. */
  readonly headOnScreen: (id: string) => string | undefined;
  /** Whether view `id`'s head holds its base branch's tip, as its merge status last had it. */
  readonly headContainsBase: (id: string) => boolean | undefined;
  /** The merge method last used in `repo`, if Lo remembers one. */
  readonly method: (repo: RepoRef) => Method | undefined;
  /** The conversion to a GitHub stack changing `repo`'s base branches, if one is. */
  readonly converting: (repo: RepoRef) => Converting | undefined;
  /** The turns of merge writes to pull requests, app-wide. */
  readonly turns: MergeWrites;
  /**
   * How a press is weighed, what a merge takes with it, and the step after the approval, sent
   * through the merge jobs.
   */
  readonly merging: Pick<Merging, 'weigh' | 'goesAs' | 'sendShipped'>;
  /** What would go with an approval from view `id` as its summary. */
  readonly summary: (id: string) => SummaryKept;
  /**
   * Approves `head` in view `id`, through the review feature; `lost` hears at once when GitHub's
   * answer is lost, before a read of your reviews settles it.
   */
  readonly approve: (id: string, head: string, lost: () => void) => Promise<Approved>;
  /**
   * Keeps auto-merge about to be turned on after your approval for the watch, and returns what
   * hears GitHub's answer to turning it on.
   */
  readonly keep: (shipped: Shipped) => (answer: AutoAnswer) => void;
  /** Sends approve and ship to the window, each time it moves on. */
  readonly publish: (view: ShipView) => void;
  readonly log: (line: string) => void;
  /** The time, in milliseconds since the Unix epoch. */
  readonly now?: () => number;
  /** A new plan's key. */
  readonly newKey?: () => string;
  /** How long a read of GitHub may take before Lo gives up on it, in milliseconds: 20 s. */
  readonly readWait?: number;
  /** How long what a plan asks GitHub may take before Lo gives up on it, in milliseconds: 20 s. */
  readonly planWait?: number;
  /** How long Lo reads GitHub again for it to show your approval, in milliseconds: 30 s. */
  readonly showWait?: number;
  /** How long between those reads, in milliseconds: 2 s. */
  readonly showEvery?: number;
  /**
   * How long Lo waits, once GitHub's answer to the approval is lost, for a read of your reviews to
   * settle it, in milliseconds: a minute.
   */
  readonly settleWait?: number;
}

/**
 * How long Lo waits, once GitHub's answer to an approval is lost, for a read of your reviews to
 * settle it before it stops: a minute, which a read made 10 s after the approval and another tried
 * again 30 s on fit in.
 */
export const SETTLE_WAIT = 60_000;

/**
 * Why Lo stopped waiting to hear whether GitHub took an approval whose answer was lost: it waited
 * {@link ShippingOptions.settleWait}, or its tab closed.
 */
type Unsettled = { readonly kind: 'unsettled'; readonly why: 'late' | 'closed' };

/** A plan kept for the reader to confirm. */
interface Kept {
  readonly plan: ShipPlan;
  readonly core: Plan;
  readonly pull: PullRef;
}

/** What `approveAndShip` plans from what GitHub said, before where the pull request sits. */
interface Core {
  readonly kind: 'core';
  readonly core: Plan;
  readonly snapshot: MergeSnapshot;
  readonly summary: SummaryKept;
}

/** The step after the approval, as a read of what decides the merge plans it. */
interface After {
  readonly facts: MergeFacts;
  readonly snapshot: MergeSnapshot;
  /** What `afterApproving` says follows. */
  readonly now: Ship;
  readonly step: ShipStep;
  /** Where its merge goes, as Lo asked when it sends one. */
  readonly goes: Goes | undefined;
}

/** Approve and ship, as it runs. */
interface Run {
  readonly plan: ShipPlan;
  readonly core: Plan;
  readonly pull: PullRef;
  readonly poller: MergingPoller;
  /** What GitHub said at the press, or since, once read again. */
  facts: MergeFacts;
  /** The pull request's turn among merge writes, from the press until it's handed on or given. */
  turn: MergeTurn | undefined;
  approved: boolean;
  /** Why Lo can't tell yet whether GitHub took the approval, until a read shows it. */
  unsure: string | undefined;
  phase: ShipPhase | undefined;
  /** Whether GitHub refused auto-merge since the pull request can merge as it is, once. */
  again: boolean;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether two logins name one account: GitHub's ignore case. */
function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** A refusal of Lo's own, with nothing more than its words. */
function own(kind: string, text: string, more: Partial<Refusal> = {}): Refusal {
  return { kind, text, rules: [], until: null, newer: null, ...more };
}

function refused(refusal: Refusal): { kind: 'refused'; refusal: Refusal } {
  return { kind: 'refused', refusal };
}

/** A full commit ID, as the contract takes it. */
const FULL = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** A push after `from`, to `to` when Lo knows it: "Show r3" shows it. */
function moved(from: string, to: string | undefined): Refusal {
  return own('headMoved', 'This revision is out of date.', {
    newer: FULL.test(from) ? { from, to: to !== undefined && FULL.test(to) ? to : null } : null,
  });
}

/** Who approves and merges for `plan`, as the causes of a failure name them. */
function askerOf(plan: Pick<ShipPlan, 'login' | 'owner'>): Asker {
  return { login: plan.login, owner: plan.owner };
}

/**
 * The account `view` acts as, or why approve and ship can't run from it: nothing to say where the
 * command isn't offered, for no pull request, or where the control is busy while the tab works out
 * its account.
 */
function actingOf(view: PullTabInfo | undefined): { login: string } | string {
  if (!view) return '';
  if (view.run) return 'Show a single layer first';
  if (view.acting === undefined) return '';
  if (view.acting.kind === 'anonymous') return 'Sign in to approve and ship';
  return { login: view.acting.login };
}

/** What `approveAndShip` refused, before anything was sent, in Lo's words. */
function planRefusal(
  planned: Exclude<ReturnType<typeof approveAndShip>, { kind: 'plan' }>,
  number: number,
  login: string,
): Refusal {
  switch (planned.kind) {
    case 'incomplete':
      return planned.incomplete === 'checksCutShort'
        ? own('checks', `#${number} has over 1,000 checks`)
        : own('incomplete', 'GitHub returned an error.');
    case 'headMoved':
      return moved(planned.onScreen, planned.head);
    case 'headUnknown':
      return own('headUnknown', 'GitHub returned an error.');
    case 'merged':
      return own('merged', `#${number} is already merged`);
    case 'closed':
      return own('closed', `#${number} is closed`);
    case 'draft':
      return own('draft', 'Draft pull requests can’t merge');
    case 'cannotApprove':
      return own('cannotApprove', `${login} can’t approve #${number}`);
    case 'pendingReviewElsewhere':
      return own('pendingReviewElsewhere', 'Submit your pending review first');
    // Why isn't known: "Try again".
    default:
      planned satisfies never;
      return own('unknown', '');
  }
}

/** The contract's step for `ship`, from the snapshot it came of. */
function stepOf(ship: Ship, snapshot: MergeSnapshot, facts: MergeFacts, pull: PullRef): ShipStep {
  const where = { owner: pull.repo.owner, repo: pull.repo.name, number: pull.number };
  const queueMethod = snapshot.queue.method ?? null;
  switch (ship.kind) {
    case 'merge':
      return { kind: 'merge', method: ship.method };
    case 'enqueue':
      return { kind: 'enqueue', method: queueMethod };
    case 'autoMerge':
      return {
        kind: 'autoMerge',
        method: ship.method,
        waitingOn: blockersOf(ship.waitingOn, snapshot, facts, where),
      };
    case 'enqueueWhenReady':
      return {
        kind: 'enqueueWhenReady',
        method: queueMethod,
        waitingOn: blockersOf(ship.waitingOn, snapshot, facts, where),
      };
    case 'autoMergeAlreadyOn':
      return {
        kind: 'autoMergeAlreadyOn',
        waitingOn: blockersOf(ship.waitingOn, snapshot, facts, where),
      };
    case 'alreadyQueued':
      return { kind: 'alreadyQueued' };
    case 'stop':
      return { kind: 'stop', stop: stopOf(ship.stop, snapshot, facts, pull) };
    default:
      ship satisfies never;
      throw new Error(`a step Lo doesn't know: ${JSON.stringify(ship)}`);
  }
}

/** The contract's reason to stop, for `stop`. */
function stopOf(stop: Stop, snapshot: MergeSnapshot, facts: MergeFacts, pull: PullRef): ShipStop {
  const where = { owner: pull.repo.owner, repo: pull.repo.name, number: pull.number };
  switch (stop.kind) {
    case 'headMoved':
      return FULL.test(stop.head)
        ? { kind: 'headMoved', head: stop.head }
        : { kind: 'headUnknown' };
    case 'headUnknown':
      return { kind: 'headUnknown' };
    case 'noPermission':
      return { kind: 'noPermission' };
    case 'noMethod':
      return { kind: 'noMethod' };
    case 'blocked':
      return {
        kind: 'blocked',
        blockers: blockersOf(stop.blockers, snapshot, facts, where),
        autoMerge: stop.autoMerge,
      };
    case 'noAutoMerge':
      return { kind: 'noAutoMerge', blockers: blockersOf(stop.blockers, snapshot, facts, where) };
    case 'incomplete':
      return { kind: 'incomplete', incomplete: stop.incomplete };
    default:
      stop satisfies never;
      throw new Error(`a stop Lo doesn't know: ${JSON.stringify(stop)}`);
  }
}

/** The merge write a step sends, if it sends one. */
function kindOf(step: Ship | ShipStep): PlanKind | undefined {
  switch (step.kind) {
    case 'merge':
    case 'enqueue':
    case 'autoMerge':
      return step.kind;
    case 'enqueueWhenReady':
      return 'whenReady';
    case 'autoMergeAlreadyOn':
    case 'alreadyQueued':
    case 'stop':
      return undefined;
    default:
      step satisfies never;
      return undefined;
  }
}

/** What a plan's step is, to tell whether the confirmation would say another. */
function shape(step: ShipStep): string {
  const method = 'method' in step ? step.method : null;
  if (step.kind !== 'stop') return `${step.kind} ${method ?? ''}`;
  const { stop } = step;
  return `stop ${stop.kind} ${stop.kind === 'where' ? stop.text : ''}`;
}

/**
 * Whether two plans of the step after the approval are the same as the confirmation names it: into
 * the same branch, and the same step.
 */
function sameAfter(was: After, now: After): boolean {
  return rulesBase(was.facts) === rulesBase(now.facts) && shape(was.step) === shape(now.step);
}

/** What an approval is, to tell whether the confirmation would say another. */
function approvalShape(approval: ShipApproval): string {
  return approval.kind === 'submitPending'
    ? `${approval.kind} ${approval.comments}`
    : approval.kind;
}

/**
 * Why approve and ship stops after approving pull request `number`, whose merge takes `together`
 * with it, and leaves the merge to the panel: you approve only what's on screen, so it merges a
 * pull request alone or a GitHub stack's bottom layer, and nothing with it. Nothing for one alone.
 */
function notAlone(together: Together | null): string | undefined {
  switch (together?.kind) {
    case undefined:
      return undefined;
    case 'stack':
      return `${numbers(together.below.map((layer) => layer.number))} would merge too, below it in the GitHub stack.`;
    case 'chain':
      return 'The layers above it move once it merges.';
    // The button is "Merge panel".
    default:
      together satisfies never;
      return '';
  }
}

/** What changed between two plans the confirmation would name, in words, or nothing. */
function changed(was: ShipPlan, now: ShipPlan): string | undefined {
  if (was.head !== now.head) return 'The revision has changed.';
  if (approvalShape(was.approval) !== approvalShape(now.approval)) {
    switch (now.approval.kind) {
      case 'alreadyApproved':
        return 'Your latest review already approves it.';
      case 'reapproveDismissed':
        return 'Your approval was dismissed.';
      case 'submitPending':
        return 'Your pending review has changed.';
      case 'approve':
      case 'ownPullRequest':
        return 'What’s approved has changed.';
      default:
        now.approval satisfies never;
        return 'What’s approved has changed.';
    }
  }
  if (was.summary !== now.summary) return 'Your summary has changed.';
  if (was.base !== now.base) return `#${now.number}’s base branch is now ${now.base}.`;
  if (shape(was.likely) !== shape(now.likely)) return 'What follows the approval has changed.';
  if (was.warning !== now.warning) return 'What a pushed commit would do has changed.';
  return undefined;
}

export class Shipping {
  readonly #options: ShippingOptions;
  readonly #now: () => number;
  readonly #newKey: () => string;
  /** The plans kept for the reader to confirm, by key: a view's last one only. */
  readonly #kept = new Map<string, Kept>();
  /** The keys of plans confirmed, which never run again. */
  readonly #used = new Set<string>();
  /** The checks under way at a press, by their plan's key: cancelling one stops it. */
  readonly #checking = new Map<string, AbortController>();
  /** What runs now, holding its pull request's turn until it hands it on or stops. */
  readonly #runs = new Set<Run>();
  /** The runs whose approval's answer was lost, each with what stops waiting for it to settle. */
  readonly #settling = new Map<Run, (why: Unsettled['why']) => void>();
  #stopped = false;

  constructor(options: ShippingOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#newKey = options.newKey ?? (() => crypto.randomUUID());
  }

  /**
   * Plans approve and ship for view `id`, from what GitHub said last, or with `afresh`, from what
   * it says now, read again, and keeps it for the reader to confirm, in place of the view's last
   * plan; or says why there's none. What it asks GitHub takes {@link ShippingOptions.planWait} at
   * most, as a read does: then Lo says it couldn't check.
   */
  async plan(id: string, afresh = false): Promise<ShipPlanned> {
    // Never read: the window is closing.
    if (this.#stopped) return refused(own('stopped', ''));
    const view = this.#options.view(id);
    const acting = actingOf(view);
    if (typeof acting === 'string' || !view) {
      return refused(own('account', typeof acting === 'string' ? acting : ''));
    }
    const pull = new PullRef(view.repository.owner, view.repository.name, view.number);
    const checking = new AbortController();
    const timer = setTimeout(() => checking.abort(), this.#options.planWait ?? 20_000);
    let planned: PressPlan<Kept> | { kind: 'refused'; refusal: Refusal };
    try {
      planned = await untilAborted(
        this.#planFor(id, acting.login, pull, afresh, checking.signal),
        checking.signal,
      );
    } catch (error) {
      if (!checking.signal.aborted) throw error;
      return refused(own('late', 'GitHub didn’t respond.'));
    } finally {
      clearTimeout(timer);
    }
    if (planned.kind === 'refused') return planned;
    this.#keep(planned.plan);
    return { kind: 'plan', plan: planned.plan.plan };
  }

  /**
   * What `plan` plans for view `id`'s pull request `pull`, as `login`, read again with `afresh`;
   * given up on `signal`.
   */
  async #planFor(
    id: string,
    login: string,
    pull: PullRef,
    afresh: boolean,
    signal: AbortSignal,
  ): Promise<PressPlan<Kept> | { kind: 'refused'; refusal: Refusal }> {
    let poller: MergingPoller;
    try {
      poller = await this.#options.poller(login);
    } catch (error) {
      return refused(own('account', describe(error)));
    }
    const off = offOf(poller);
    if (off) return refused(offRefusal(off, login));
    // The control is busy until the head is on screen, and its merge status read.
    const head = this.#options.headOnScreen(id) ?? '';
    if (!FULL.test(head)) return refused(own('unread', ''));
    const cached = afresh
      ? await readAfresh(poller, pull, this.#options.readWait ?? 20_000, signal, () => this.#now())
      : (poller.cachedRead(pull, MERGE_FACTS) ?? (await poller.mergeFacts(pull)));
    if (cached && 'why' in cached) {
      // Not read: Lo is still finding out, as it is with nothing read yet.
      if (cached.why === '') return refused(own('unread', ''));
      return refused(own('failed', cached.why, { details: cached.details }));
    }
    if (!cached) return refused(own('unread', ''));
    return this.#planOf(id, login, pull, poller, cached.value, signal);
  }

  /**
   * Runs approve and ship from the plan named `key`, once, if it holds as GitHub says now, read
   * again: else asks again with a new plan, when something it named changed, or refuses, sending
   * nothing. Once it starts, `ships` says how it goes.
   */
  async confirm(key: string): Promise<ShipConfirmed> {
    const kept = this.#kept.get(key);
    if (!kept) {
      // Confirmed already, the primary is busy; a plan Lo no longer has has no known cause.
      return refused(this.#used.has(key) ? own('used', '') : own('gone', ''));
    }
    // A plan runs once, whatever comes of it.
    this.#kept.delete(key);
    this.#used.add(key);
    if (this.#stopped) return refused(own('stopped', ''));
    const checking = new AbortController();
    this.#checking.set(key, checking);
    try {
      let checked;
      try {
        checked = await this.#guard(kept, checking.signal);
      } catch (error) {
        // Cancelled, the dialog closes.
        if (checking.signal.aborted) return refused(own('cancelled', ''));
        this.#options.log(`${kept.pull.toString()}: ${describe(error)}`);
        return refused(
          own('failed', explained(error, askerOf(kept.plan)), { details: rawOf(error) }),
        );
      }
      if (checked.kind !== 'run') return checked;
      const { run } = checked;
      if (checking.signal.aborted || this.#stopped) {
        run.turn?.give();
        return refused(this.#stopped ? own('stopped', '') : own('cancelled', ''));
      }
      this.#runs.add(run);
      void this.#run(run);
      return { kind: 'started' };
    } finally {
      this.#checking.delete(key);
    }
  }

  /**
   * Forgets the plan named `key`. While its press is being checked, stops that, and nothing is
   * sent. Once it runs, it goes on.
   */
  cancel(key: string): void {
    this.#kept.delete(key);
    this.#checking.get(key)?.abort();
  }

  /**
   * View `id` changed, or closed: approve and ship from it that waits to hear whether GitHub took
   * an approval whose answer was lost stops once its tab is closed, merging nothing.
   */
  viewChanged(id: string): void {
    if (this.#options.view(id)) return;
    for (const [run, stop] of this.#settling) if (run.plan.id === id) stop('closed');
  }

  /** Plans no more, and sends nothing more. */
  stop(): void {
    this.#stopped = true;
    this.#kept.clear();
    for (const checking of this.#checking.values()) checking.abort();
    for (const stop of this.#settling.values()) stop('late');
    for (const run of this.#runs) {
      run.turn?.give();
      run.turn = undefined;
    }
  }

  /**
   * The plan `facts` give for view `id`, as `login`, or why there's none: what to approve, and what
   * Lo expects to follow, with what its merge takes with it, from where the pull request sits, read
   * afresh; which is to stop after approving where approve and ship doesn't merge from. With it,
   * how a read that lands meanwhile plans, with the pull request sitting so.
   */
  async #planOf(
    id: string,
    login: string,
    pull: PullRef,
    poller: MergingPoller,
    facts: MergeFacts,
    signal?: AbortSignal,
  ): Promise<PressPlan<Kept> | { kind: 'refused'; refusal: Refusal }> {
    const first = this.#coreOf(id, login, pull, poller, facts);
    if (first.kind === 'refused') return first;
    const kind = kindOf(first.core.likely);
    const goes =
      kind === undefined
        ? undefined
        : await this.#options.merging.goesAs(kind, poller, login, pull, facts, signal);
    // Where Lo can't tell yet, it approves nothing: a read again may settle it.
    if (goes?.kind === 'unread' || (goes?.kind === 'where' && goes.unknown)) {
      return refused(own(goes.kind, goes.why, { details: goes.details }));
    }
    return {
      kind: 'plan',
      plan: this.#keptOf(id, login, pull, facts, first, goes),
      again: (read) => {
        const now = this.#coreOf(id, login, pull, poller, read);
        return now.kind === 'refused' ? undefined : this.#keptOf(id, login, pull, read, now, goes);
      },
    };
  }

  /** What `approveAndShip` plans from `facts` for view `id`, as `login`, or why it plans nothing. */
  #coreOf(
    id: string,
    login: string,
    pull: PullRef,
    poller: MergingPoller,
    facts: MergeFacts,
  ): Core | { kind: 'refused'; refusal: Refusal } {
    const head = this.#options.headOnScreen(id) ?? '';
    const snapshot = this.#snapshotOf(id, pull, facts, head);
    const planned = approveAndShip(snapshot);
    if (planned.kind !== 'plan') {
      if (planned.kind === 'incomplete' && planned.incomplete === 'readAgain') {
        poller.readMergeFactsAgain(pull);
      }
      return refused(planRefusal(planned, pull.number, login));
    }
    const summary = this.#options.summary(id);
    if (summary === 'uploading' && approves(planned.plan.approval)) {
      return refused(own('uploading', 'A file in your summary is still uploading.'));
    }
    return { kind: 'core', core: planned.plan, snapshot, summary };
  }

  /** The plan to confirm from `made`, with the merge after the approval going as `goes` says. */
  #keptOf(
    id: string,
    login: string,
    pull: PullRef,
    facts: MergeFacts,
    made: Core,
    goes: Goes | undefined,
  ): Kept {
    const { core, snapshot, summary } = made;
    let likely = stepOf(core.likely, snapshot, facts, pull);
    // Approved, and then left to the merge panel.
    const where =
      goes?.kind === 'where'
        ? goes.why
        : goes?.kind === 'goes'
          ? notAlone(goes.together)
          : undefined;
    if (where !== undefined) likely = { kind: 'stop', stop: { kind: 'where', text: where } };
    const plan: ShipPlan = {
      key: this.#newKey(),
      id,
      owner: pull.repo.owner,
      repo: pull.repo.name,
      number: pull.number,
      login,
      base: rulesBase(facts),
      head: core.head.toLowerCase(),
      approval: approvalOf(core.approval),
      summary: approves(core.approval) && summary === 'text',
      likely,
      warning: likely.kind !== 'stop' && core.staleApprovalWarning,
      afterPush: afterPushOf(snapshot),
    };
    return { plan, core, pull };
  }

  /** What GitHub said, with what Lo has of view `id`, the revision on screen `head` among it. */
  #snapshotOf(id: string, pull: PullRef, facts: MergeFacts, head: string): MergeSnapshot {
    return mergeSnapshot(facts, {
      headOnScreen: head,
      preferredMethod: this.#options.method(pull.repo),
      headContainsBase: this.#options.headContainsBase(id),
    });
  }

  /** Keeps `kept`, in place of its view's last plan. */
  #keep(kept: Kept): void {
    for (const [key, each] of this.#kept) {
      if (each.plan.id === kept.plan.id) this.#kept.delete(key);
    }
    this.#kept.set(kept.plan.key, kept);
  }

  /**
   * Checks `kept` as it's confirmed, reading GitHub again: the run, holding its pull request's
   * turn, when everything holds; a new plan to confirm when something it named changed; else why
   * it doesn't go.
   */
  async #guard(
    kept: Kept,
    signal: AbortSignal,
  ): Promise<{ kind: 'run'; run: Run } | Exclude<ShipConfirmed, { kind: 'started' }>> {
    const { plan, pull } = kept;
    const tab = this.#tabHolds(plan, pull);
    if (tab) return refused(tab);
    let poller: MergingPoller;
    try {
      poller = await untilAborted(this.#options.poller(plan.login), signal);
    } catch (error) {
      signal.throwIfAborted();
      return refused(own('account', describe(error)));
    }
    const held = this.#holds(plan, pull, poller);
    if (held) return refused(held);
    // Read again whatever was read before, so a push since shows, and weighed as a merge's press
    // is: a read that lands while Lo asks where the pull request sits is planned from too.
    const weighed = await this.#options.merging.weigh<Kept>(
      {
        id: plan.id,
        pull,
        afresh: true,
        plan: (facts, _view, given) =>
          this.#planOf(plan.id, plan.login, pull, poller, facts, given),
        same: (was, now) => changed(was.plan, now.plan) === undefined,
      },
      poller,
      signal,
    );
    signal.throwIfAborted();
    if (weighed.kind !== 'plan') return refused(unweighed(plan, weighed));
    const now = weighed.plan;
    const why = changed(plan, now.plan);
    if (why !== undefined) {
      this.#keep(now);
      return { kind: 'again', plan: now.plan, why };
    }
    // Its button reads "Merging…".
    if (this.#options.turns.busy(pull.repo, [pull.number]).length > 0) {
      return refused(own('busy', ''));
    }
    const converting = this.#converting(pull);
    if (converting) return refused(converting);
    const turn = this.#options.turns.take(pull.repo, [pull.number]);
    if ('busy' in turn) return refused(own('busy', busyText(turn.busy, plan.number)));
    // What the checks found at their start, once more, right before it runs.
    const still = this.#holds(plan, pull, poller);
    if (still) {
      turn.give();
      return refused(still);
    }
    return {
      kind: 'run',
      run: {
        plan,
        // As planned now, from what GitHub says now: nothing it names changed.
        core: now.core,
        pull,
        poller,
        facts: weighed.facts,
        turn,
        approved: false,
        unsure: undefined,
        phase: undefined,
        again: false,
      },
    };
  }

  /** Why the plan can't go from its tab now: it's closed, or acts as another account, or as none. */
  #tabHolds(plan: ShipPlan, pull: PullRef): Refusal | undefined {
    const view = this.#options.view(plan.id);
    // Its tab is closed: nothing is left to show why on.
    if (
      !view ||
      !new PullRef(view.repository.owner, view.repository.name, view.number).equals(pull)
    ) {
      return own('closed', '');
    }
    const acting = actingOf(view);
    if (typeof acting === 'string' || !sameLogin(acting.login, plan.login)) {
      return own('account', 'This tab’s account has changed.');
    }
    return undefined;
  }

  /**
   * Why the plan can't go now, as its tab, its account's `poller` and the revision on screen say:
   * what the checks at the press start with, and what's checked again right before it runs.
   */
  #holds(plan: ShipPlan, pull: PullRef, poller: MergingPoller): Refusal | undefined {
    const tab = this.#tabHolds(plan, pull);
    if (tab) return tab;
    const off = offOf(poller);
    if (off) return offRefusal(off, plan.login);
    const head = this.#options.headOnScreen(plan.id) ?? '';
    if (!sameCommit(head, plan.head)) return own('screen', 'The revision has changed.');
    // The tab knows of a newer push than the one on screen.
    const latest = this.#options.view(plan.id)?.latest;
    if (latest !== undefined && !sameCommit(latest, plan.head)) {
      return moved(plan.head, latest.toLowerCase());
    }
    return undefined;
  }

  /** Why nothing merges `pull` while a conversion to a GitHub stack runs on it. */
  #converting(pull: PullRef): Refusal | undefined {
    const converting = this.#options.converting(pull.repo);
    if (!converting?.prs.includes(pull.number)) return undefined;
    return own('converting', 'GitHub is still changing this stack');
  }

  /** Runs `run` from its approval on, then gives back its turn, unless it handed it on. */
  async #run(run: Run): Promise<void> {
    try {
      const approval = await this.#approving(run);
      if (approval === 'stopped') return;
      if (!(await this.#approvalShown(run))) return;
      await this.#ship(run);
    } catch (error) {
      this.#options.log(`${run.pull.toString()}: ${describe(error)}`);
      this.#stopAt(
        run,
        own('failed', explained(error, askerOf(run.plan)), { details: rawOf(error) }),
      );
    } finally {
      run.turn?.give();
      run.turn = undefined;
      this.#runs.delete(run);
    }
  }

  /**
   * Approves, unless the plan skips it, waiting as long as the approval waits its turn and, when
   * its answer is lost, for a read of your reviews to settle it, for
   * {@link ShippingOptions.settleWait} while its tab is open: whether to go on, or that Lo can't
   * tell yet whether GitHub took it, which a read of the pull request may settle. Once Lo stops
   * waiting, it stops there, and the review feature goes on settling the approval alone.
   */
  async #approving(run: Run): Promise<'go' | 'stopped'> {
    if (!approves(run.core.approval)) return 'go';
    this.#phase(run, { kind: 'approving' });
    const answer = await this.#approval(run);
    if (this.#stopped) return 'stopped';
    switch (answer.kind) {
      case 'unsettled':
        // Under "Approval not confirmed", whether its tab closed or a minute went by.
        run.unsure = '';
        this.#stopAt(run, own('unknown', 'GitHub didn’t respond.'));
        return 'stopped';
      case 'approved':
        run.approved = true;
        this.#publish(run);
        return 'go';
      case 'moved':
        this.#stopAt(run, moved(run.plan.head, answer.head));
        return 'stopped';
      // The review refusal's reason, alone.
      case 'refused':
        this.#stopAt(run, own('notApproved', answer.why));
        return 'stopped';
      case 'unknown':
        // It may be on GitHub: what the pull request shows settles it.
        run.unsure = answer.why;
        return 'go';
      default:
        answer satisfies never;
        return 'stopped';
    }
  }

  /**
   * How `run`'s approval went, once the review feature says; or, once its answer was lost, why Lo
   * stopped waiting first for a read of your reviews to settle it.
   */
  #approval(run: Run): Promise<Approved | Unsettled> {
    const { id, head } = run.plan;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        clearTimeout(timer);
        this.#settling.delete(run);
      };
      const unsettled = (why: Unsettled['why']) => {
        done();
        resolve({ kind: 'unsettled', why });
      };
      const lost = () => {
        if (this.#settling.has(run)) return;
        this.#settling.set(run, unsettled);
        timer = setTimeout(() => unsettled('late'), this.#options.settleWait ?? SETTLE_WAIT);
        if (this.#stopped) unsettled('late');
        else if (!this.#options.view(id)) unsettled('closed');
      };
      this.#options.approve(id, head, lost).then(
        (answer) => {
          done();
          resolve(answer);
        },
        (error: unknown) => {
          done();
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  /**
   * Whether to go on: once GitHub shows the approval Lo sent, or one Lo can't tell it took, read
   * again until it does, or a push since; at once when nothing was approved. `run.facts` holds what
   * it read.
   */
  async #approvalShown(run: Run): Promise<boolean> {
    const { plan, pull, poller } = run;
    if (!run.approved && run.unsure === undefined) return true;
    this.#phase(run, { kind: 'reading' });
    const until = this.#now() + (this.#options.showWait ?? 30_000);
    for (;;) {
      const read = await readAfresh(
        poller,
        pull,
        this.#options.readWait ?? 20_000,
        new AbortController().signal,
        () => this.#now(),
      );
      if (this.#stopped) return false;
      if ('why' in read) {
        this.#stopAt(run, own('unread', read.why, { details: read.details }));
        return false;
      }
      const snapshot = this.#snapshotOf(plan.id, pull, read.value, plan.head);
      if (showsYourApproval(snapshot, plan.head)) {
        run.facts = read.value;
        if (run.unsure !== undefined) {
          run.unsure = undefined;
          run.approved = true;
          this.#publish(run);
        }
        return true;
      }
      // A push since stops it, as `afterApproving` says.
      if (!sameCommit(snapshot.head, plan.head)) {
        run.facts = read.value;
        return true;
      }
      if (this.#now() >= until) {
        this.#stopAt(
          run,
          run.unsure === undefined
            ? own('notShown', 'GitHub doesn’t show your approval yet.')
            : own('unknown', 'GitHub didn’t respond.'),
        );
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, this.#options.showEvery ?? 2_000));
    }
  }

  /** The step after the approval that `facts` give, with where its merge goes asked afresh. */
  async #afterOf(run: Run, facts: MergeFacts): Promise<After> {
    const after = this.#afterWith(run, facts, undefined);
    const kind = kindOf(after.now);
    if (kind === undefined) return after;
    const { poller, plan, pull } = run;
    const goes = await this.#options.merging.goesAs(kind, poller, plan.login, pull, facts);
    return { ...after, goes };
  }

  /** The step after the approval that `facts` give, its merge going as `goes` says. */
  #afterWith(run: Run, facts: MergeFacts, goes: Goes | undefined): After {
    const snapshot = this.#snapshotOf(run.plan.id, run.pull, facts, run.plan.head);
    const now = afterApproving(snapshot, run.core);
    return { facts, snapshot, now, step: stepOf(now, snapshot, facts, run.pull), goes };
  }

  /**
   * The step after the approval, from what GitHub says now, as a merge's press weighs it: a read
   * that lands while Lo asks where the pull request sits is planned from too, and when it changes
   * what the confirmation named, the branch it merges into or the step, or the head, that's another
   * round on it. Nothing once it stopped.
   */
  async #weighAfter(run: Run): Promise<After | undefined> {
    for (let round = 1; ; round++) {
      const after = await this.#afterOf(run, run.facts);
      if (this.#stopped) return undefined;
      const latest = run.poller.cachedRead(run.pull, MERGE_FACTS)?.value;
      const planned = {
        plan: after,
        again: (read: MergeFacts) => this.#afterWith(run, read, after.goes),
      };
      if (
        latest === undefined ||
        !anotherRound(planned, after.facts, latest, after.facts.pullRequest.head, sameAfter)
      ) {
        return after;
      }
      if (round === LOOKS) {
        this.#stopAt(run, own('changing', `#${run.plan.number} changed while it was checked.`));
        return undefined;
      }
      run.facts = latest;
    }
  }

  /** The step after the approval, as GitHub now allows it, if it's what was confirmed. */
  async #ship(run: Run): Promise<void> {
    const after = await this.#weighAfter(run);
    if (!after) return;
    run.facts = after.facts;
    const { plan, core } = run;
    const { now, step } = after;
    // What the confirmation said follows: a pull request where approve and ship doesn't merge
    // from stops after approving.
    if (plan.likely.kind === 'stop' && plan.likely.stop.kind === 'where' && kindOf(now)) {
      this.#stopAt(run, own('where', plan.likely.stop.text), plan.likely.stop);
      return;
    }
    if (!asAsked(core, now)) {
      const text = unwarnedAutoMerge(core, now)
        ? `#${plan.number} can’t merge yet.`
        : 'What follows the approval has changed.';
      this.#stopAt(run, own('notAsked', text));
      return;
    }
    switch (step.kind) {
      // The stop's kind says why, which the window words.
      case 'stop':
        this.#stopAt(run, own(step.stop.kind, ''), step.stop);
        return;
      case 'alreadyQueued':
      case 'autoMergeAlreadyOn':
        this.#phase(run, { kind: 'done', step });
        return;
      case 'merge':
      case 'enqueue':
      case 'autoMerge':
      case 'enqueueWhenReady':
        this.#send(run, step, after);
        return;
      default:
        step satisfies never;
    }
  }

  /**
   * Sends `step` through the merge jobs, in the turn the run holds, once its merge goes from where
   * the pull request sits, alone or as a GitHub stack's bottom layer, as `after` asked, and nothing
   * keeps a merge from going now.
   */
  #send(
    run: Run,
    step: Extract<ShipStep, { kind: 'merge' | 'enqueue' | 'autoMerge' | 'enqueueWhenReady' }>,
    after: After,
  ): void {
    const { plan, pull, poller, facts } = run;
    const kind = kindOf(step);
    const { goes, snapshot } = after;
    if (kind === undefined || goes === undefined) return;
    // GitHub merges into the base it has when the merge goes, which has to be the one confirmed,
    // whichever way the write comes to be sent.
    const base = rulesBase(facts);
    if (base !== plan.base) {
      this.#stopAt(run, own('base', `#${plan.number}’s base branch is now ${base}.`));
      return;
    }
    if (goes.kind === 'unread') {
      this.#stopAt(run, own('unread', goes.why, { details: goes.details }));
      return;
    }
    const where = goes.kind === 'where' ? goes.why : notAlone(goes.together);
    if (where !== undefined) {
      this.#stopAt(run, own('where', where), { kind: 'where', text: where });
      return;
    }
    const off = offOf(poller);
    if (off) {
      this.#stopAt(run, offRefusal(off, plan.login));
      return;
    }
    const converting = this.#converting(pull);
    if (converting) {
      this.#stopAt(run, converting);
      return;
    }
    const turn = run.turn;
    if (!turn || this.#stopped) {
      this.#stopAt(run, own('stopped', ''));
      return;
    }
    const merge: MergePlan = {
      key: this.#newKey(),
      id: plan.id,
      owner: plan.owner,
      repo: plan.repo,
      number: plan.number,
      login: plan.login,
      kind,
      method: step.method,
      base,
      head: run.core.head.toLowerCase(),
      title: '',
      message: '',
      named: null,
      together: null,
    };
    let heard: ((answer: AutoAnswer) => void) | undefined;
    if (kind === 'autoMerge' || kind === 'whenReady') {
      // Your approval outlives a push unless the rules say otherwise: the watch keeps an eye out.
      const kept =
        run.core.approval.kind === 'ownPullRequest'
          ? undefined
          : this.#options.keep({
              login: plan.login,
              pull,
              head: merge.head,
              base: merge.base,
              method: snapshot.queue.required ? null : (merge.method ?? 'MERGE'),
            });
      heard = (answer) => {
        kept?.(answer);
        // Once the write that was refused has given back its turn.
        if (typeof answer === 'object' && 'refused' in answer) {
          if (answer.refused?.refusal === 'canMergeNow') {
            queueMicrotask(() => void this.#mergeInstead(run));
          }
        }
      };
    }
    run.turn = undefined;
    const sent = this.#options.merging.sendShipped(merge, pull, poller, turn, heard);
    if (sent.kind === 'refused') {
      if (heard) heard({ refused: undefined });
      this.#stopAt(run, sent.refusal);
      return;
    }
    this.#phase(run, { kind: 'sending', step, job: merge.key });
  }

  /**
   * GitHub refused auto-merge, since the pull request can merge as it is: as `@lo/review` says,
   * Lo reads it again and goes on with what `afterApproving` says then, once, if that's what was
   * confirmed, a merge with the method asked, in a turn of its own. Never on any other refusal.
   */
  async #mergeInstead(run: Run): Promise<void> {
    if (run.again || this.#stopped) return;
    run.again = true;
    const { number } = run.plan;
    // GitHub wouldn't turn on auto-merge, as it can merge now; where merging then didn't go either,
    // the reason is why that didn't. The button is "Merge panel".
    const instead = (at: Run, why: string, details?: string) =>
      this.#stopAt(
        at,
        own('canMergeNow', why === '' ? `#${number} can merge now.` : why, { details }),
      );
    const turn = this.#options.turns.take(run.pull.repo, [run.pull.number]);
    if ('busy' in turn) {
      instead(run, busyText(turn.busy, number));
      return;
    }
    // A run of its own, holding its own turn: the first may not have given back its own yet.
    const next: Run = { ...run, turn };
    this.#runs.add(next);
    try {
      const read = await readAfresh(
        next.poller,
        next.pull,
        this.#options.readWait ?? 20_000,
        new AbortController().signal,
        () => this.#now(),
      );
      if (this.#stopped) return;
      if ('why' in read) {
        instead(next, read.why, read.details);
        return;
      }
      next.facts = read.value;
      const after = await this.#weighAfter(next);
      if (!after) return;
      next.facts = after.facts;
      // Only the merge itself, as it was confirmed.
      const { step } = after;
      if (!asAsked(next.core, after.now) || (step.kind !== 'merge' && step.kind !== 'enqueue')) {
        instead(next, `#${number} changed while it was checked.`);
        return;
      }
      this.#send(next, step, after);
    } catch (error) {
      this.#options.log(`${next.pull.toString()}: ${describe(error)}`);
      instead(next, explained(error, askerOf(next.plan)));
    } finally {
      next.turn?.give();
      next.turn = undefined;
      this.#runs.delete(next);
    }
  }

  /**
   * Stops `run` where it is, saying why: after approving once it has, before when it hasn't, or
   * where Lo can't tell yet whether GitHub took the approval.
   */
  #stopAt(run: Run, refusal: Refusal, stop: ShipStop | null = null): void {
    let at: 'approve' | 'unsure' | 'ship' = 'approve';
    if (run.approved || !approves(run.core.approval)) at = 'ship';
    else if (run.unsure !== undefined) at = 'unsure';
    this.#phase(run, {
      kind: 'stopped',
      at,
      refusal,
      stop,
    });
  }

  #phase(run: Run, phase: ShipPhase): void {
    run.phase = phase;
    this.#publish(run);
  }

  #publish(run: Run): void {
    const { plan, phase } = run;
    if (!phase) return;
    try {
      this.#options.publish({
        key: plan.key,
        owner: plan.owner,
        repo: plan.repo,
        number: plan.number,
        login: plan.login,
        base: plan.base,
        head: plan.head,
        approval: plan.approval,
        approved: run.approved,
        phase,
      });
    } catch (error) {
      this.#options.log(`approve and ship: ${describe(error)}`);
    }
  }
}

/** Why a press weighed as `weighed` says doesn't go, in approve and ship's words. */
function unweighed(plan: ShipPlan, weighed: Exclude<Weighed<Kept>, { kind: 'plan' }>): Refusal {
  const { number } = plan;
  switch (weighed.kind) {
    case 'refused':
      return weighed.refusal;
    // Its tab is closed: nothing is left to show why on.
    case 'closed':
      return own('closed', '');
    case 'unread':
      return own('unread', weighed.why);
    case 'moved':
      return moved(weighed.from, weighed.to.toLowerCase());
    case 'changing':
      return own('changing', `#${number} changed while it was checked.`);
    // Why isn't known: "Try again".
    default:
      weighed satisfies never;
      return own('unknown', '');
  }
}

/** The contract's approval, for `@lo/review`'s. */
function approvalOf(approval: Plan['approval']): ShipApproval {
  return approval.kind === 'submitPending'
    ? { kind: 'submitPending', comments: approval.comments }
    : { kind: approval.kind };
}

/** Whether two full commit SHAs name the same commit. */
function sameCommit(a: string, b: string): boolean {
  return isFullSha(a) && a.toLowerCase() === b.toLowerCase();
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

/** Why a read afresh didn't come: no cause to give for `why` of `''`; what GitHub said for Details. */
export interface Unread {
  readonly why: string;
  readonly details?: string | undefined;
}

/**
 * What decides `pull`'s merge, read afresh now, whatever was read before, or why it couldn't be,
 * within `wait` milliseconds; given up on `signal`.
 */
export async function readAfresh(
  poller: Pick<Poller, 'readAfresh' | 'readSince' | 'onEvent' | 'mergeFacts'>,
  pull: PullRef,
  wait: number,
  signal: AbortSignal,
  now: () => number,
): Promise<Cached<MergeFacts> | Unread> {
  let mark = poller.readAfresh(pull, MERGE_FACTS);
  if (!mark) {
    // Not kept, as for a pull request no view shows: kept from now, and read.
    await untilAborted(poller.mergeFacts(pull), signal);
    mark = poller.readAfresh(pull, MERGE_FACTS);
  }
  // Not kept, or let go of: no cause to give.
  if (!mark) return { why: '' };
  const deadline = now() + wait;
  for (;;) {
    signal.throwIfAborted();
    const since = poller.readSince(pull, MERGE_FACTS, mark);
    if (since.kind === 'read') return since.read;
    if (since.kind === 'stale') return { why: '' };
    const heard = await nextRead(poller, pull, deadline - now(), signal);
    signal.throwIfAborted();
    if (heard === 'late') return { why: 'GitHub didn’t respond.' };
    if (heard !== 'read') {
      return { why: 'GitHub returned an error.', details: rawOf(new GithubError(heard.failed)) };
    }
  }
}

/**
 * The next read of `pull`'s merge facts, or why there's none within `wait` milliseconds: what the
 * read that failed said, or that none came.
 */
function nextRead(
  poller: Pick<Poller, 'onEvent'>,
  pull: PullRef,
  wait: number,
  signal: AbortSignal,
): Promise<'read' | 'late' | { readonly failed: GithubErrorDetail }> {
  return new Promise((resolve) => {
    if (wait <= 0 || signal.aborted) {
      resolve('late');
      return;
    }
    const done = (how: 'read' | 'late' | { readonly failed: GithubErrorDetail }) => {
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
      done(event.kind === 'readFailed' ? { failed: event.error } : 'read');
    });
  });
}
