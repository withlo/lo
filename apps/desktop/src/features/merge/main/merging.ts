// Merging, in main: `⏎` in the merge panel plans the merge from what GitHub said last, and the plan
// is kept under a key for the reader to confirm; the window confirms the key and never sends the
// merge itself. A plan runs once. As it's confirmed, main checks it again: the view still acts as
// the plan's account, signed in; what GitHub said is whole, at the head on screen, which is still
// GitHub's head, and confirmed in the last 7 minutes, else it's read again; where the pull request
// sits is known, from the stacks' list and the open pull requests read afresh from each branch the
// merge goes into, and it's alone or a GitHub stack's bottom layer; nothing else merges it; no
// conversion to a GitHub stack runs on its path; and GitHub can be reached and isn't holding writes.
// When something the confirmation named changed, it asks again with a new plan.
//
// The merge goes through the app's one `MergeJobs`, in the pull request's turn among merge writes,
// with the head on screen as its `sha`, so GitHub merges only that head. A job outlives its view.
// The method is remembered for the repository once GitHub takes a merge with it. A merge whose end
// Lo can't tell is settled by reading the pull request, never by sending it again. Nothing here
// calls Electron.

import {
  describeMergeRefusal,
  directMerge,
  GithubError,
  isRefusal,
  MERGE_FACTS,
  openPullsFromHead,
  PullRef,
  queueMerge,
  rulesBase,
  withCommit,
  type Cached,
  type GithubClient,
  type GithubErrorDetail,
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
  checksCutShort,
  incomplete,
  mergeAction,
  mergeSnapshot,
  type MergeSnapshot,
} from '@lo/review';

import type { Converting, Forest } from '../../stacks/service.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type {
  Confirmed,
  JobState,
  JobView,
  MergePlan,
  Method,
  Off,
  PlanKind,
  Planned,
  Refusal,
} from '../contract.ts';
import type { MergeTurn, MergeWrites } from '../service.ts';
import { placedBy, where, type OpenFromHead, type Where } from './where.ts';

/** How long what GitHub said of a merge is taken as current at the press: 7 minutes. */
export const FRESH_FOR = 7 * 60_000;

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
  /** The turns of merge writes to pull requests, app-wide. */
  readonly turns: MergeWrites;
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
}

/** What the reader chose in the panel: the method, and a squash's title and message as typed. */
export interface Choice {
  readonly method: Method | null;
  readonly title: string;
  readonly message: string;
}

/** A plan kept for the reader to confirm. */
interface Kept {
  readonly plan: MergePlan;
  readonly pull: PullRef;
}

/** A merge Lo sent, as it follows it. */
interface Sent {
  readonly plan: MergePlan;
  readonly pull: PullRef;
  readonly poller: MergingPoller;
  turn: MergeTurn | undefined;
  /** Whether the method was remembered for the repository. */
  remembered: boolean;
  /** For a merge Lo can't tell the end of: what GitHub has shown of the pull request since. */
  shows: 'merged' | 'enqueued' | 'open' | undefined;
  /** Stops listening for the reads that settle it. */
  unwatch: (() => void) | undefined;
}

/** Whether two logins name one account: GitHub's ignore case. */
function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Pull requests' numbers as a sentence names them: "#45", "#45 and #46", "#45, #46 and #47". */
function numbers(prs: readonly number[]): string {
  const named = prs.map((pr) => `#${pr}`);
  const last = named.pop() ?? '';
  return named.length === 0 ? last : `${named.join(', ')} and ${last}`;
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

/** The outcome a job ended with, as the merge GitHub was already running when it answered `409`. */
function endedWith(job: Job): Outcome | undefined {
  if (job.state.kind !== 'done') return undefined;
  const { outcome } = job.state;
  return outcome.kind === 'alreadyRunning' ? outcome.ended : outcome;
}

/** What a plan names that the reader confirmed: what changed, in words, or nothing. */
function changed(was: MergePlan, now: MergePlan): string | undefined {
  if (was.kind !== now.kind) {
    return now.kind === 'enqueue'
      ? `${now.base} merges through a merge queue now.`
      : `${now.base} no longer merges through a merge queue.`;
  }
  if (was.base !== now.base) return `#${now.number} merges into ${now.base} now.`;
  if (was.method !== now.method) return 'The method it merges with changed.';
  if (was.head !== now.head) return 'The revision on screen changed.';
  return undefined;
}

export class Merging {
  readonly #options: MergingOptions;
  readonly #now: () => number;
  readonly #newKey: () => string;
  /** The plans kept for the reader to confirm, by key: a view's last one only. */
  readonly #kept = new Map<string, Kept>();
  /** The keys of plans confirmed, which never run again. */
  readonly #used = new Set<string>();
  /** The merges Lo sent, by their pull request's key, until the reader forgets them. */
  readonly #sent = new Map<string, Sent>();
  readonly #stopJobs: () => void;
  #stopped = false;

  constructor(options: MergingOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#newKey = options.newKey ?? (() => crypto.randomUUID());
    this.#stopJobs = options.jobs.onChange(({ pull, done }) => this.#heard(pull, done));
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
    const planned = this.#planOf(id, view, login, cached.value, choice);
    if (typeof planned === 'string') return { kind: 'refused', why: planned };
    const placed = await this.#whereNow(poller, login, pull, cached.value);
    const why = whereText(placed, view.number);
    if (why !== undefined) return { kind: 'refused', why };
    this.#keep(planned, pull);
    return { kind: 'plan', plan: planned };
  }

  /**
   * Sends the merge the plan named `key` holds, once, if it can still go as the plan says; else
   * asks again with a new plan, when something it named changed, or refuses.
   */
  async confirm(key: string): Promise<Confirmed> {
    const kept = this.#kept.get(key);
    if (!kept) {
      return refused(
        this.#used.has(key)
          ? own('used', 'That merge was confirmed already.')
          : own('gone', 'Lo no longer has that plan. Merge from the panel again.'),
      );
    }
    // A plan runs once, whatever comes of it.
    this.#kept.delete(key);
    this.#used.add(key);
    if (this.#stopped) return refused(own('stopped', 'Lo is quitting.'));
    let checked;
    try {
      checked = await this.#guard(kept);
    } catch (error) {
      this.#options.log(`${kept.pull.toString()}: ${describe(error)}`);
      return refused(
        own('failed', `Lo couldn’t check the merge, so it didn’t send it: ${describe(error)}`),
      );
    }
    if (checked.kind !== 'send') return checked;
    return this.#send(kept, checked.poller);
  }

  /** Forgets the plan named `key`, unless it was confirmed. */
  cancel(key: string): void {
    this.#kept.delete(key);
  }

  /** Every merge Lo sent that it still has, as the window shows them. */
  list(): JobView[] {
    return [...this.#sent.values()].flatMap((sent) => {
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
    const sent = this.#byKey(key);
    if (!sent) return;
    const job = this.#options.jobs.job(sent.pull);
    if (!job || endedWith(job)?.kind !== 'unknown') return;
    if (this.#options.jobs.followAgain(sent.pull)) {
      // Following it again holds the pull request's turn, as the merge may still be running.
      const turn = this.#options.turns.take(sent.pull.repo, [sent.pull.number]);
      if (!('busy' in turn)) sent.turn = turn;
      return;
    }
    this.#settle(sent);
  }

  /** Forgets the merge from the plan named `key` once it has ended. */
  dismiss(key: string): void {
    const sent = this.#byKey(key);
    if (!sent) return;
    const job = this.#options.jobs.job(sent.pull);
    if (job && job.state.kind !== 'done') return;
    this.#options.jobs.forget(sent.pull);
    sent.unwatch?.();
    this.#sent.delete(sent.pull.key);
  }

  /** Plans no more and sends nothing more; the jobs stop on their own. */
  stop(): void {
    this.#stopped = true;
    this.#stopJobs();
    this.#kept.clear();
    for (const sent of this.#sent.values()) {
      sent.unwatch?.();
      sent.turn?.give();
    }
  }

  /** The plan `facts` give for view `id`, as `login`, with the reader's `choice`, or why there's none. */
  #planOf(
    id: string,
    view: PullTabInfo,
    login: string,
    facts: MergeFacts,
    choice: Choice,
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
    let kind: PlanKind;
    let method: Method | null;
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
    // Only what the reader typed goes, and only for a squash: an empty field leaves GitHub's own.
    const squash = kind === 'merge' && method === 'SQUASH';
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
    };
  }

  /** Keeps `plan`, in place of its view's last one. */
  #keep(plan: MergePlan, pull: PullRef): void {
    for (const [key, kept] of this.#kept) {
      if (kept.plan.id === plan.id) this.#kept.delete(key);
    }
    this.#kept.set(plan.key, { plan, pull });
  }

  /**
   * Checks `kept` as it's confirmed: sends it with `poller` when everything holds; asks again with
   * a new plan when something it named changed; else refuses.
   */
  async #guard(kept: Kept): Promise<Confirmed | { kind: 'send'; poller: MergingPoller }> {
    const { plan, pull } = kept;
    const view = this.#options.view(plan.id);
    if (
      !view ||
      !new PullRef(view.repository.owner, view.repository.name, view.number).equals(pull)
    ) {
      return refused(own('closed', `#${plan.number}’s tab is closed. Merge from its panel again.`));
    }
    const acting = actingOf(view);
    if (typeof acting === 'string' || !sameLogin(acting.login, plan.login)) {
      return refused(
        own('account', `The tab no longer acts as ${plan.login}. Merge from the panel again.`),
      );
    }
    let poller: MergingPoller;
    try {
      poller = await this.#options.poller(plan.login);
    } catch (error) {
      return refused(own('account', describe(error)));
    }
    const off = offOf(poller);
    if (off) {
      return refused(
        own(off.kind, offText(off), { until: off.kind === 'paused' ? off.until : null }),
      );
    }
    const head = this.#options.headOnScreen(plan.id) ?? '';
    // The tab knows of a newer push than the one on screen.
    if (head === plan.head && view.latest !== undefined && view.latest !== head) {
      return refused(newerPush(plan.number, head, view.latest));
    }
    let cached = poller.cachedRead(pull, MERGE_FACTS);
    if (!this.#current(cached, head)) {
      const read = await this.#readAgain(poller, pull);
      if (typeof read === 'string') {
        return refused(
          own('unread', `Lo couldn’t read #${plan.number} again, so it didn’t merge: ${read}`),
        );
      }
      cached = read;
    }
    const facts = cached.value;
    if (checksCutShort(facts)) {
      return refused(own('checks', 'GitHub has over 1,000 checks here. Merge it on GitHub.'));
    }
    const snapshot: MergeSnapshot = mergeSnapshot(facts, {
      headOnScreen: head,
      preferredMethod: this.#options.method(pull.repo),
      headContainsBase: this.#options.headContainsBase(plan.id),
    });
    if (incomplete(snapshot) !== undefined) {
      poller.readMergeFactsAgain(pull);
      return refused(
        own(
          'incomplete',
          `GitHub left part of what decides #${plan.number}’s merge out of its answer, so Lo didn’t merge. Lo reads it again; merge once it has.`,
        ),
      );
    }
    if (facts.pullRequest.head !== head) {
      return refused(newerPush(plan.number, head, facts.pullRequest.head));
    }
    const now = this.#planOf(plan.id, view, plan.login, facts, plan);
    if (typeof now === 'string') return refused(own('notPossible', now));
    const why = changed(plan, now);
    if (why !== undefined) {
      this.#keep(now, pull);
      return { kind: 'again', plan: now, why: `${why} Check what it does now, then confirm.` };
    }
    const placed = await this.#whereNow(poller, plan.login, pull, facts);
    const unplaced = whereText(placed, plan.number);
    if (unplaced !== undefined) return refused(own('where', unplaced));
    if (this.#options.turns.busy(pull.repo, [pull.number]).length > 0) {
      return refused(own('busy', `Lo is already merging #${plan.number}.`));
    }
    const converting = this.#options.converting(pull.repo);
    if (converting?.prs.includes(pull.number)) {
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
   * Whether `cached` can be acted on at the press: whole, confirmed in the last
   * {@link FRESH_FOR}, and at `head`.
   */
  #current(cached: Cached<MergeFacts> | undefined, head: string): cached is Cached<MergeFacts> {
    return (
      cached !== undefined &&
      this.#now() - cached.fetchedAt <= FRESH_FOR &&
      cached.value.leftOut.length === 0 &&
      cached.value.pullRequest.head === head
    );
  }

  /** What decides `pull`'s merge, read again now, or why it couldn't be. */
  async #readAgain(poller: MergingPoller, pull: PullRef): Promise<Cached<MergeFacts> | string> {
    let mark = poller.readAfresh(pull, MERGE_FACTS);
    if (!mark) {
      await poller.mergeFacts(pull);
      mark = poller.readAfresh(pull, MERGE_FACTS);
    }
    if (!mark) return 'the read isn’t kept.';
    const deadline = this.#now() + (this.#options.readWait ?? 20_000);
    for (;;) {
      if (this.#stopped) return 'Lo is quitting.';
      const since = poller.readSince(pull, MERGE_FACTS, mark);
      if (since.kind === 'read') return since.read;
      if (since.kind === 'stale') return 'the read was let go of.';
      const heard = await nextRead(poller, pull, deadline - this.#now());
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
  ): Promise<Where> {
    const placed = placedBy(facts);
    const openFrom = new Map<string, OpenFromHead>();
    let listed = false;
    for (;;) {
      const forest = this.#options.forest(pull.repo, login);
      const found = where({
        number: pull.number,
        facts: placed,
        forest,
        openFrom,
        now: this.#now(),
      });
      if (found.kind !== 'unknown') return found;
      const { why } = found;
      if (why.kind === 'unconfirmed' && !openFrom.has(why.branch)) {
        try {
          const read = await poller.readOnce(
            (client) => openPullsFromHead(client, pull.repo, why.branch),
            undefined,
            'foreground',
          );
          openFrom.set(why.branch, read);
        } catch (error) {
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
      await this.#relisted(pull.repo, login, forest?.listedAt);
    }
  }

  /**
   * Waits for `login`'s list of `repo`'s open pull requests to be confirmed after `since`, looking
   * every quarter second, for {@link MergingOptions.listWait} at most.
   */
  async #relisted(repo: RepoRef, login: string, since: number | undefined): Promise<void> {
    const every = 250;
    for (let waited = 0; waited < (this.#options.listWait ?? 15_000); waited += every) {
      if (this.#stopped) return;
      const listedAt = this.#options.forest(repo, login)?.listedAt;
      if (listedAt !== undefined && listedAt !== since) return;
      await new Promise((resolve) => setTimeout(resolve, every));
    }
  }

  /** Sends `kept`'s merge, in its pull request's turn, through the app's jobs. */
  #send(kept: Kept, poller: MergingPoller): Confirmed {
    const { plan, pull } = kept;
    const request = requestOf(plan);
    if (isRefusal(request)) return refused(refusalOf(request, plan.head));
    const busy = own('busy', `Lo is already merging #${plan.number}.`);
    const running = this.#options.jobs.job(pull);
    if (running && running.state.kind !== 'done') return refused(busy);
    const turn = this.#options.turns.take(pull.repo, [pull.number]);
    if ('busy' in turn) return refused(own('busy', `Lo is already merging #${turn.busy}.`));
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
      remembered: false,
      shows: undefined,
      unwatch: undefined,
    };
    this.#sent.set(pull.key, sent);
    const refusal = this.#options.jobs.merge(poller, pull, request);
    if (refusal) {
      turn.give();
      this.#sent.delete(pull.key);
      return refused(refusal.refusal === 'stopped' ? own('stopped', 'Lo is quitting.') : busy);
    }
    return { kind: 'sent' };
  }

  /** A job changed: says so to the window, remembers the method once GitHub took it, and ends it. */
  #heard(pull: PullRef, done: boolean): void {
    const sent = this.#sent.get(pull.key);
    if (!sent) return;
    const job = this.#options.jobs.job(pull);
    if (!job) return;
    this.#rememberIfTaken(sent, job);
    if (done) {
      sent.turn?.give();
      sent.turn = undefined;
      sent.shows = undefined;
      if (endedWith(job)?.kind === 'unknown') this.#settle(sent);
    }
    this.#publish(sent);
  }

  /** Remembers the plan's method for the repository once GitHub took the merge with it. */
  #rememberIfTaken(sent: Sent, job: Job): void {
    const { plan } = sent;
    if (sent.remembered || plan.kind !== 'merge' || plan.method === null) return;
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
      if (!mark) mark = poller.readAfresh(pull, MERGE_FACTS);
      if (!mark) return;
      const since = poller.readSince(pull, MERGE_FACTS, mark);
      if (since.kind !== 'read') return;
      const shown = since.read.value.pullRequest;
      const shows = shown.state === 'MERGED' ? 'merged' : shown.inQueue ? 'enqueued' : 'open';
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
    const job = this.#options.jobs.job(sent.pull);
    if (!job) return undefined;
    const { plan } = sent;
    let state = stateOf(job);
    if (state.kind === 'unknown' && sent.shows !== undefined) {
      state =
        sent.shows === 'merged'
          ? { kind: 'merged' }
          : sent.shows === 'enqueued'
            ? { kind: 'enqueued' }
            : { ...state, shows: 'open' };
    }
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
      already: job.running !== undefined,
      state,
    };
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

function refused(refusal: Refusal): Confirmed {
  return { kind: 'refused', refusal };
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

/** What the merge GitHub is asked for: straight in with the method, or into the merge queue. */
function requestOf(plan: MergePlan): MergeRequest | MergeRefusal {
  if (plan.kind === 'enqueue') return queueMerge(plan.head);
  const request = directMerge(plan.head, plan.method ?? 'MERGE');
  if (isRefusal(request)) return request;
  // Only what the reader typed: an empty field leaves GitHub's own.
  if (plan.method === 'SQUASH' && (plan.title !== '' || plan.message !== '')) {
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
 * Why Lo doesn't merge where `placed` says the pull request sits: anywhere but alone or a GitHub
 * stack's bottom layer. Nothing where it does.
 */
function whereText(placed: Where, number: number): string | undefined {
  switch (placed.kind) {
    case 'alone':
      return undefined;
    case 'githubStack':
      return placed.below.length === 0
        ? undefined
        : `${numbers(placed.below)}, below #${number} in GitHub stack #${placed.stack}, would merge with it. Merge it on GitHub.`;
    case 'chainBottom':
      return `#${number} is the bottom layer of a chain that isn’t a GitHub stack. Merge it on GitHub.`;
    case 'chainAbove':
      return `Merge #${placed.bottom} first: it’s this chain’s bottom layer.`;
    case 'unknown':
      return placed.text;
    default:
      placed satisfies never;
      throw new Error(`a place Lo doesn't know: ${JSON.stringify(placed)}`);
  }
}

/** The next read of `pull`'s merge facts, or why there's none within `wait` milliseconds. */
function nextRead(
  poller: Pick<Poller, 'onEvent'>,
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
      if (!event.pull.equals(pull) || event.name !== MERGE_FACTS.name) return;
      done(event.kind === 'readFailed' ? 'failed' : 'read');
    });
  });
}
