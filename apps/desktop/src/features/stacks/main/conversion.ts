// Making a chain of pull requests a GitHub stack, in main. A plan is made from what GitHub says now
// and kept under a key for the reader to confirm; the window confirms the key and never sends the
// changes. Each plan runs once, its changes sent in order through the account's poller, stopping at
// the first GitHub refuses or that fails, or before the next one once the reader stops it. Nothing
// is ever sent again by itself. A conversion that failed or stopped can put back the base branches
// it changed, last first, once the reader asks. A repository has one conversion at a time, and none
// outlives Lo. Nothing here calls Electron.

import {
  describeMergeRefusal,
  GithubError,
  isRefusal,
  openLayers,
  openPullRequest,
  stackNumbers,
  stacksHolding,
  type GithubStack,
  type OpenPullRequestList,
  type Poller,
  type PullRef,
  type RepoRef,
  type Retarget,
  type StackLayerList,
} from '@lo/github';
import { layerOf, planConversion, type Plan, type Stacks, type Step } from '@lo/stacks';

import { IpcError } from '../../../ipc/contract.ts';
import type { Acting } from '../../tab/contract.ts';
import type {
  Change,
  ChangeRow,
  ChangeStatus,
  ConversionNote,
  ConversionView,
  Phase,
  Planned,
  PlanRow,
} from '../contract.ts';
import { errorText, madeText, numbers, OWN, planWords, reasonsText, stackedBy } from './words.ts';

/** What a conversion uses of an account's poller. */
export type ConversionPoller = Pick<
  Poller,
  | 'login'
  | 'readOnce'
  | 'runConversionStep'
  | 'retarget'
  | 'unstack'
  | 'writesHeldUntil'
  | 'openPullRequests'
  | 'changed'
  | 'onChange'
>;

/** A pull request's tab, as making its chain a GitHub stack sees it. */
export interface ConversionTab {
  readonly id: string;
  /** Its pull request, as its account's poller watches it. */
  readonly pull: PullRef;
  /** Its repository's name, as GitHub gives it now. */
  readonly repository: string;
  /** Who it acts as, once that's worked out. */
  readonly acting: Acting | undefined;
}

/** What a tab's stack is worked out from now, as the finder has it. */
export interface Found {
  /** The account whose poller listed the pull requests. */
  readonly login: string;
  /** The repository's stacks. */
  readonly forest: Stacks;
  /** The open pull requests they were found among. */
  readonly list: OpenPullRequestList;
  /** The state of the stack's layers, as last read for the tab, if it was. */
  readonly layers: StackLayerList | undefined;
}

export interface ConversionOptions {
  /** An account's poller. Throws for an account Lo doesn't have. */
  poller(login: string): Promise<ConversionPoller>;
  /** What tab `id`'s stack is worked out from now, or nothing while it isn't known. */
  found(id: string): Found | undefined;
  /** Sends a conversion to the window, each time it changes. */
  publish(view: ConversionView): void;
  log(line: string): void;
  /** The time, in milliseconds since the Unix epoch. */
  now?: () => number;
  /** A new plan's key. */
  newKey?: () => string;
  /**
   * How long planning in a repository just changed waits for its pull requests to be listed again,
   * in milliseconds.
   */
  freshWait?: number;
  /** How often a change being sent looks for a pause GitHub asked for, in milliseconds. */
  tick?: number;
}

/** A plan kept for the reader to confirm. */
interface Kept {
  readonly key: string;
  readonly tab: string;
  readonly poller: ConversionPoller;
  readonly repo: RepoRef;
  readonly repository: string;
  readonly plan: Plan;
}

/** A conversion: a plan confirmed, as it goes. */
interface Run extends Kept {
  /** How many times the window has been told of it. */
  version: number;
  phase: Phase;
  changes: ChangeRow[];
  putBack: ChangeRow[];
  notes: ConversionNote[];
  waitingUntil: number | undefined;
  /** What stops the changes being sent now, while some are. */
  controller: AbortController | undefined;
  stopping: boolean;
  /** Whether putting back may be asked for again: it stopped before it was over. */
  again: boolean;
}

/** What sending a change came to. */
type Sent<T> =
  | { readonly kind: 'answered'; readonly value: T }
  /** It was given up on before it was sent. */
  | { readonly kind: 'givenUp' }
  | { readonly kind: 'failed'; readonly error: unknown; readonly mayHaveBeenDone: boolean };

/** How a change that may have changed something on GitHub stands: undoing it puts it back. */
const UNDONE: readonly ChangeStatus[] = ['done', 'unknown'];

/** How a change that was sent stands: GitHub's answer makes what it changed read again. */
const SENT: readonly ChangeStatus[] = ['done', 'unchanged', 'failed', 'unknown', 'left'];

export class Conversions {
  readonly #options: ConversionOptions;
  readonly #now: () => number;
  readonly #newKey: () => string;
  readonly #freshWait: number;
  readonly #tick: number;
  /** The plans kept for the reader to confirm, by key: a tab's last one only. */
  readonly #kept = new Map<string, Kept>();
  /** The conversions, by key, until the window forgets them. */
  readonly #runs = new Map<string, Run>();
  /** The conversion sending changes in each repository, by the repository's key. */
  readonly #busy = new Map<string, Run>();
  /** When each repository's last conversion stopped sending changes, by its key. */
  readonly #changedAt = new Map<string, number>();
  #stopped = false;

  constructor(options: ConversionOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#newKey = options.newKey ?? (() => crypto.randomUUID());
    this.#freshWait = options.freshWait ?? 15_000;
    this.#tick = options.tick ?? 1000;
  }

  /**
   * Plans making the chain `tab`'s pull request is in a GitHub stack, and keeps the plan for the
   * reader to confirm, in place of the tab's last one; or says every reason it can't: Lo's own
   * first, then GitHub's Stacks API, then the core's.
   */
  async plan(tab: ConversionTab): Promise<Planned> {
    if (this.#stopped) throw new IpcError('stopped', 'Lo is quitting.');
    const { pull, repository, acting } = tab;
    const repo = pull.repo;
    const own: string[] = [];
    if (acting === undefined) own.push(OWN.noAccountYet);
    else if (acting.kind === 'anonymous') own.push(OWN.nobody);
    if (this.#busy.has(repo.key)) own.push(OWN.running(repository));
    if (own.length > 0 || acting?.kind !== 'account') return refused(own);

    let poller: ConversionPoller;
    try {
      poller = await this.#options.poller(acting.login);
    } catch (error) {
      return refused([OWN.noPoller(acting.login, error)]);
    }
    // After Lo's own changes here, a plan waits for the pull requests listed since.
    const changedAt = this.#changedAt.get(repo.key);
    if (changedAt !== undefined && !(await this.#listedSince(poller, repo, changedAt))) {
      return refused([OWN.stale(repository)]);
    }
    const found = this.#options.found(tab.id);
    if (!found || found.login.toLowerCase() !== poller.login.toLowerCase()) {
      return refused([OWN.unread(repository)]);
    }
    const { forest, list, layers } = found;

    // GitHub's stacks as they are now: none without the Stacks API, which answers 404.
    let holding: GithubStack[] | undefined;
    try {
      holding = await poller.readOnce((client) => stacksHolding(client, repo, pull.number));
    } catch (error) {
      return refused([OWN.stacksUnread(pull.number, error)]);
    }
    const layer = layerOf(forest, pull.number);
    if (holding && layer) {
      const now = holding.find(
        (stack) => stack.open && openLayers(stack).some((open) => open.number === pull.number),
      )?.number;
      if (now !== layer.nativeStack?.stack) {
        void poller.changed(repo).catch((error: unknown) => {
          this.#options.log(`listing ${repo.key} again: ${String(error)}`);
        });
        return refused([OWN.stacksChanged(repository)]);
      }
    }

    const queued = layers?.layers.flatMap((read) => (read.isInMergeQueue ? [read.number] : []));
    const conversion = planConversion(forest, pull.number, {
      stacksApi: holding !== undefined,
      queued: queued ?? [],
    });
    // Another conversion may have started here while GitHub answered.
    if (this.#busy.has(repo.key)) return refused([OWN.running(repository)]);
    if (conversion.kind === 'notOffered') {
      return refused(
        reasonsText(conversion.reasons, { number: pull.number, repository, forest, list }),
      );
    }
    const { plan } = conversion;
    // Whether each pull request it changes is in a merge queue must be known.
    const read = new Set(layers?.layers.map((each) => each.number));
    if (!plan.path.every((number) => read.has(number))) return refused([OWN.layersUnread]);

    for (const [key, kept] of this.#kept) if (kept.tab === tab.id) this.#kept.delete(key);
    const key = this.#newKey();
    this.#kept.set(key, { key, tab: tab.id, poller, repo, repository, plan });
    const words = planWords(plan, { repository, forest, list });
    return {
      kind: 'plan',
      key,
      title: words.title,
      description: words.description,
      heading: words.heading,
      rows: planRows(plan, list),
      stack: words.stack,
      warning: words.warning ?? null,
      login: poller.login,
      confirm: words.confirm,
    };
  }

  /**
   * Runs the plan named `key`, once: it's taken from the plans kept before anything is sent, so a
   * second confirmation finds nothing. Refused while its repository has a conversion running.
   */
  convert(key: string): ConversionView {
    if (this.#stopped) throw new IpcError('stopped', 'Lo is quitting.');
    const kept = this.#kept.get(key);
    if (!kept) {
      throw new IpcError('gone', 'This plan is gone. Ask to make the GitHub stack again.');
    }
    if (this.#busy.has(kept.repo.key)) {
      throw new IpcError('busy', OWN.running(kept.repository));
    }
    this.#kept.delete(key);
    const run: Run = {
      ...kept,
      version: 0,
      phase: 'running',
      changes: kept.plan.steps.map((step) => ({
        change: changeOf(step),
        status: 'todo',
        detail: null,
      })),
      putBack: [],
      notes: [],
      waitingUntil: undefined,
      controller: new AbortController(),
      stopping: false,
      again: false,
    };
    this.#runs.set(key, run);
    this.#busy.set(run.repo.key, run);
    this.#publish(run);
    void this.#run(run).catch((error: unknown) => this.#crashed(run, error));
    return this.#view(run);
  }

  /**
   * Ends what `key` names: a plan not run is forgotten; a conversion, or putting it back, stops
   * before its next change is sent; one that's over is forgotten.
   */
  stop(key: string): void {
    if (this.#kept.delete(key)) return;
    const run = this.#runs.get(key);
    if (!run) return;
    if (run.controller) {
      if (run.stopping) return;
      run.stopping = true;
      run.controller.abort(new Error('The reader stopped it.'));
      this.#publish(run);
      return;
    }
    this.#runs.delete(key);
  }

  /**
   * Puts back what the conversion named `key` changed, once it failed or stopped: the stack it may
   * have made, only while it holds exactly the plan's pull requests, then the base branches, last
   * first. Each is read first, and one changed elsewhere since is left.
   */
  putBack(key: string): ConversionView {
    if (this.#stopped) throw new IpcError('stopped', 'Lo is quitting.');
    const run = this.#runs.get(key);
    const settled =
      run?.phase === 'failed' ||
      run?.phase === 'stopped' ||
      (run?.phase === 'putBack' && run.again);
    if (!run || !settled || run.controller) {
      throw new IpcError('gone', "There's nothing to put back.");
    }
    if (this.#busy.has(run.repo.key)) throw new IpcError('busy', OWN.running(run.repository));
    if (!putBackOf(run).some(toDo)) {
      throw new IpcError('gone', "There's nothing to put back.");
    }
    run.phase = 'puttingBack';
    run.controller = new AbortController();
    run.stopping = false;
    run.again = false;
    run.notes = [];
    this.#busy.set(run.repo.key, run);
    this.#publish(run);
    void this.#putBack(run).catch((error: unknown) => this.#crashed(run, error));
    return this.#view(run);
  }

  /** Forgets the plans of tabs that closed: the window can't confirm them any more. */
  follow(open: ReadonlySet<string>): void {
    for (const [key, kept] of this.#kept) if (!open.has(kept.tab)) this.#kept.delete(key);
  }

  /** Stops every conversion before its next change is sent, and forgets every plan, as Lo quits. */
  quit(): void {
    this.#stopped = true;
    this.#kept.clear();
    for (const run of this.#runs.values()) {
      run.stopping = true;
      run.controller?.abort(new Error('Lo is quitting.'));
    }
  }

  /** Sends the plan's changes in order, until one fails or the reader stops it. */
  async #run(run: Run): Promise<void> {
    const { plan, poller, repo } = run;
    const signal = run.controller?.signal;
    for (const [index, step] of plan.steps.entries()) {
      if (signal?.aborted) break;
      this.#mark(run.changes, index, 'now', null);
      this.#publish(run);
      const sent = await this.#send(run, () => poller.runConversionStep(repo, step, signal));
      if (sent.kind === 'givenUp') {
        this.#mark(run.changes, index, 'skipped', null);
        break;
      }
      if (sent.kind === 'failed') {
        const status = sent.mayHaveBeenDone ? 'unknown' : 'failed';
        this.#mark(run.changes, index, status, errorText(sent.error));
        if (status === 'unknown' && step.kind !== 'retarget') {
          const [bottom = 0] = step.prs;
          run.notes.push({
            text: `GitHub may have ${step.kind === 'createStack' ? 'made the stack' : 'added them'} before its answer was lost. Check on GitHub.`,
            link: pullLink(repo, bottom),
          });
        }
        run.phase = 'failed';
        break;
      }
      if (isRefusal(sent.value)) {
        this.#mark(run.changes, index, 'failed', `${describeMergeRefusal(sent.value)}.`);
        run.phase = 'failed';
        break;
      }
      this.#mark(
        run.changes,
        index,
        sent.value.kind === 'alreadyThere' ? 'unchanged' : 'done',
        null,
      );
    }
    for (const row of run.changes) if (row.status === 'todo') row.status = 'skipped';
    if (run.phase === 'running') {
      run.phase = run.changes.every((row) => row.status === 'done' || row.status === 'unchanged')
        ? 'done'
        : 'stopped';
    }
    this.#settle(run);
  }

  /**
   * Puts back what `run` changed: when its stack step may have gone through, the stack, if GitHub
   * has one holding exactly what the plan made; then the base branches it changed, last first. A
   * base branch changed elsewhere since is left; anything else that fails stops it.
   */
  async #putBack(run: Run): Promise<void> {
    const { poller, repo } = run;
    const signal = run.controller?.signal;
    const rows = putBackOf(run);
    run.putBack = rows;
    this.#publish(run);
    const unsure = run.changes.find(
      (row) => row.change.kind !== 'retarget' && row.status === 'unknown',
    )?.change;
    // Asked again, it goes on from where it stopped, with what it found then.
    const decided = rows.some((row) => row.change.kind === 'unstack');
    if (unsure && (unsure.kind === 'create' || unsure.kind === 'add') && !decided) {
      // Whether GitHub made the stack, or added to it, though its answer was lost.
      const first = unsure.prs[0];
      let holding: GithubStack[] | undefined;
      try {
        holding =
          first === undefined
            ? undefined
            : await poller.readOnce((client) => stacksHolding(client, repo, first), signal);
      } catch (error) {
        if (signal?.aborted) return this.#putBackOver(run, 'stopped');
        run.notes.push({
          text: `Lo couldn't read whether GitHub ${unsure.kind === 'create' ? 'made the stack' : 'added the PRs'}: ${errorText(error)} Nothing was put back.`,
          link: null,
        });
        return this.#putBackOver(run, 'again');
      }
      const open = holding?.filter((stack) => stack.open) ?? [];
      if (unsure.kind === 'add') {
        const joined = open.find((stack) => stackNumbers(stack).includes(first ?? 0));
        if (joined) {
          run.notes.push({
            text: `${numbers(unsure.prs)} may be in GitHub stack #${joined.number} now, so Lo left ${unsure.prs.length === 1 ? 'it' : 'them'} as ${unsure.prs.length === 1 ? 'it is' : 'they are'}.`,
            link: pullLink(repo, first ?? 0),
          });
          return this.#putBackOver(run, 'left');
        }
      } else {
        const exact = open.find((stack) => sameNumbers(stackNumbers(stack), unsure.prs));
        const other = open.find((stack) => stack !== exact);
        if (exact) {
          rows.unshift({
            change: { kind: 'unstack', stack: exact.number, prs: [...unsure.prs] },
            status: 'todo',
            detail: null,
          });
        } else if (other) {
          run.notes.push({
            text: `GitHub stack #${other.number} holds #${first} with other PRs, so Lo left it, and the base branches as they are.`,
            link: pullLink(repo, first ?? 0),
          });
          return this.#putBackOver(run, 'left');
        }
      }
    }
    // An unstack whose answer was lost: whether GitHub took it decides whether it's sent again.
    for (const [index, row] of rows.entries()) {
      const { change } = row;
      if (change.kind !== 'unstack' || row.status !== 'unknown') continue;
      const first = change.prs[0];
      let holding: GithubStack[] | undefined;
      try {
        holding =
          first === undefined
            ? undefined
            : await poller.readOnce((client) => stacksHolding(client, repo, first), signal);
      } catch (error) {
        if (signal?.aborted) return this.#putBackOver(run, 'stopped');
        run.notes.push({
          text: `Lo couldn't read whether GitHub unstacked GitHub stack #${change.stack}: ${errorText(error)} Nothing was put back.`,
          link: null,
        });
        return this.#putBackOver(run, 'again');
      }
      const still = holding?.find((stack) => stack.number === change.stack && stack.open);
      if (!still) this.#mark(rows, index, 'done', null);
      else if (sameNumbers(stackNumbers(still), change.prs)) this.#mark(rows, index, 'todo', null);
      else this.#mark(rows, index, 'left', 'It holds other PRs now, so Lo left it.');
      this.#publish(run);
    }
    for (const [index, row] of rows.entries()) {
      if (row.status !== 'todo') continue;
      if (signal?.aborted) break;
      this.#mark(rows, index, 'now', null);
      this.#publish(run);
      const { change } = row;
      const sent =
        change.kind === 'unstack'
          ? await this.#send(run, () => poller.unstack(repo, change.stack, change.prs, signal))
          : change.kind === 'retarget'
            ? await this.#send(run, () => poller.retarget(repo, change, signal))
            : undefined;
      if (!sent) throw new Error(`putting back can't send a ${change.kind}`);
      if (sent.kind === 'givenUp') {
        this.#mark(rows, index, 'todo', null);
        break;
      }
      if (sent.kind === 'failed') {
        this.#mark(rows, index, sent.mayHaveBeenDone ? 'unknown' : 'failed', errorText(sent.error));
        return this.#putBackOver(run, 'again');
      }
      const answer = sent.value;
      if (isRefusal(answer)) {
        if (answer.refusal === 'baseChanged') {
          // Changed elsewhere since: someone meant it.
          this.#mark(rows, index, 'left', answer.now);
          continue;
        }
        if (answer.refusal === 'stackChanged') {
          // The stack holds other PRs now, or it's gone: unstacking would take out more than Lo
          // put in, or there's nothing to take out.
          this.#mark(rows, index, 'left', 'It changed since Lo read it, so Lo left it.');
          continue;
        }
        this.#mark(rows, index, 'failed', `${describeMergeRefusal(answer)}.`);
        return this.#putBackOver(run, 'again');
      }
      this.#mark(rows, index, 'done', null);
    }
    return this.#putBackOver(run, signal?.aborted ? 'stopped' : 'over');
  }

  /**
   * Ends putting back: `over` once every change was sent or left, `again` when one failed or a read
   * did, so the reader may ask again, `left` when Lo left everything, and `stopped` when the reader
   * stopped it, which may be asked again too.
   */
  #putBackOver(run: Run, how: 'over' | 'again' | 'left' | 'stopped'): void {
    run.phase = 'putBack';
    run.again = how === 'again' || how === 'stopped';
    this.#settle(run);
  }

  /** `run` sends nothing more: its repository is free, and what it changed is to be listed again. */
  #settle(run: Run): void {
    run.controller = undefined;
    run.stopping = false;
    run.waitingUntil = undefined;
    if (this.#busy.get(run.repo.key) === run) this.#busy.delete(run.repo.key);
    if ([...run.changes, ...run.putBack].some((row) => SENT.includes(row.status))) {
      this.#changedAt.set(run.repo.key, this.#now());
    }
    this.#publish(run);
  }

  /** Something that should never throw did: nothing more is sent, and the window hears why. */
  #crashed(run: Run, error: unknown): void {
    this.#options.log(`making a GitHub stack in ${run.repo.key}: ${String(error)}`);
    for (const row of [...run.changes, ...run.putBack]) {
      if (row.status === 'now') row.status = 'unknown';
      if (row.status === 'todo') row.status = 'skipped';
    }
    run.phase = run.phase === 'puttingBack' ? 'putBack' : 'failed';
    run.again = false;
    this.#settle(run);
  }

  /**
   * Sends one change through `request`, saying meanwhile whether it waits for a pause GitHub asked
   * for, and what came of it. A change given up on before it was sent is never sent.
   */
  async #send<T>(run: Run, request: () => Promise<T>): Promise<Sent<T>> {
    const watch = () => {
      const until = run.poller.writesHeldUntil();
      if (until === run.waitingUntil) return;
      run.waitingUntil = until;
      this.#publish(run);
    };
    watch();
    const timer = setInterval(watch, this.#tick);
    try {
      return { kind: 'answered', value: await request() };
    } catch (error) {
      const reason: unknown = run.controller?.signal.reason;
      if (run.controller?.signal.aborted && error === reason) return { kind: 'givenUp' };
      return {
        kind: 'failed',
        error,
        mayHaveBeenDone: error instanceof GithubError && error.mayHavePosted(),
      };
    } finally {
      clearInterval(timer);
      if (run.waitingUntil !== undefined) {
        run.waitingUntil = undefined;
        this.#publish(run);
      }
    }
  }

  #mark(rows: ChangeRow[], index: number, status: ChangeStatus, detail: string | null): void {
    const row = rows[index];
    if (row) rows[index] = { ...row, status, detail };
  }

  /**
   * Whether `repo`'s open pull requests are listed after `since`, waiting for that up to
   * {@link ConversionOptions.freshWait}.
   */
  #listedSince(poller: ConversionPoller, repo: RepoRef, since: number): Promise<boolean> {
    const fresh = () => (poller.openPullRequests(repo)?.fetchedAt ?? -1) > since;
    if (fresh()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        unsubscribe();
        resolve(fresh());
      };
      const unsubscribe = poller.onChange(() => {
        if (fresh()) done();
      });
      const timer = setTimeout(done, this.#freshWait);
    });
  }

  #publish(run: Run): void {
    if (this.#stopped || this.#runs.get(run.key) !== run) return;
    run.version += 1;
    this.#options.publish(this.#view(run));
  }

  /** What the window shows of `run`. */
  #view(run: Run): ConversionView {
    const { phase, plan } = run;
    const left = putBackOf(run).filter(toDo);
    const canPutBack =
      (phase === 'failed' || phase === 'stopped' || (phase === 'putBack' && run.again)) &&
      left.length > 0;
    const moves = left.filter((row) => row.change.kind === 'retarget').length;
    return {
      key: run.key,
      tab: run.tab,
      version: run.version,
      phase,
      ...titled(run),
      waitingUntil: run.waitingUntil ?? null,
      stopping: run.stopping,
      changes: run.changes,
      putBack: run.putBack,
      putBackLabel: canPutBack
        ? moves === 1
          ? 'Put the base branch back'
          : 'Put the base branches back'
        : null,
      notes: run.notes,
      made: phase === 'done' ? madeText(plan) : null,
    };
  }
}

/** The answer when making a GitHub stack isn't offered. */
function refused(reasons: readonly string[]): Planned {
  return { kind: 'notOffered', reasons: [...reasons] };
}

/** A plan's step as the window lists it. */
function changeOf(step: Step): Change {
  switch (step.kind) {
    case 'retarget':
      return { kind: 'retarget', ...step.retarget };
    case 'createStack':
      return { kind: 'create', prs: [...step.prs] };
    case 'addToStack':
      return { kind: 'add', stack: step.stack, prs: [...step.prs] };
    default:
      throw new Error(`a step Lo doesn't know: ${JSON.stringify(step satisfies never)}`);
  }
}

/**
 * What putting back `run` sends: each base branch change it made, or may have made, undone, last
 * first; one it found already made sent nothing, so it's left alone. Rows put back already stay as
 * they went, when it's asked for again.
 */
function putBackOf(run: Run): ChangeRow[] {
  if (run.putBack.length > 0) {
    return run.putBack.map((row) =>
      row.status === 'done' || row.status === 'left' || unsureUnstack(row)
        ? row
        : { ...row, status: 'todo' as const, detail: null },
    );
  }
  return run.changes
    .flatMap((row): ChangeRow[] => {
      const { change } = row;
      if (change.kind !== 'retarget' || !UNDONE.includes(row.status)) return [];
      const back: Retarget = { pr: change.pr, from: change.to, to: change.from };
      return [{ change: { kind: 'retarget', ...back }, status: 'todo', detail: null }];
    })
    .toReversed();
}

/**
 * Whether `row` is an unstack whose answer was lost. It's read again before anything is sent: sent
 * again, it would find the stack gone and be refused, and the base branches would never go back.
 */
function unsureUnstack(row: ChangeRow): boolean {
  return row.change.kind === 'unstack' && row.status === 'unknown';
}

/** Whether putting back has `row` still to do: to send, or to read again first. */
function toDo(row: ChangeRow): boolean {
  return row.status === 'todo' || unsureUnstack(row);
}

/** What a plan shows of each pull request it changes: every one in the path, or those added. */
function planRows(plan: Plan, list: OpenPullRequestList): PlanRow[] {
  const moves = new Map(
    plan.steps.flatMap((step) =>
      step.kind === 'retarget' ? [[step.retarget.pr, step.retarget]] : [],
    ),
  );
  return stackedBy(plan).map((number) => {
    const pr = openPullRequest(list, number);
    const move = moves.get(number);
    return {
      number,
      title: pr?.title ?? '',
      base: move?.from ?? pr?.baseRefName ?? '',
      to: move?.to ?? null,
    };
  });
}

/** "One base branch", or "2 base branches", as a sentence starts. */
function branches(count: number): string {
  return count === 1 ? 'One base branch' : `${count} base branches`;
}

/** How many base branches `changes` changed, and how many it may have: GitHub's answer was lost. */
function changedText(changes: readonly ChangeRow[]): string {
  const count = (status: ChangeStatus) =>
    changes.filter((row) => row.change.kind === 'retarget' && row.status === status).length;
  const done = count('done');
  const unsure = count('unknown');
  if (done === 0 && unsure === 0) return 'No base branch had changed.';
  if (unsure === 0) return `${branches(done)} had already changed.`;
  if (done === 0) return `${branches(unsure)} may have changed.`;
  return `${branches(done)} had already changed, and ${unsure === 1 ? 'one more' : `${unsure} more`} may have.`;
}

/** The title and the line under it, for where `run` is. */
function titled(run: Run): { title: string; description: string } {
  const { plan, phase } = run;
  const last = plan.steps.at(-1);
  const adding = last?.kind === 'addToStack';
  const prs = stackedBy(plan);
  const changed = run.changes.filter(
    (row) => row.change.kind === 'retarget' && UNDONE.includes(row.status),
  ).length;
  const already = changedText(run.changes);
  const unsure = run.changes.some(
    (row) => row.change.kind !== 'retarget' && row.status === 'unknown',
  );
  switch (phase) {
    case 'running':
      return {
        title: adding
          ? `Adding ${numbers(prs)} to GitHub stack #${last.stack}`
          : `Making ${numbers(prs)} a GitHub stack`,
        description: `As ${run.poller.login}. Lo sends each change in order, and stops at the first that fails.`,
      };
    case 'done':
      return { title: madeText(plan), description: '' };
    case 'failed':
      return {
        title: adding ? "The PRs weren't added" : "The stack wasn't created",
        description: unsure
          ? `GitHub's answer was lost, so ${adding ? 'they may have been added' : 'it may have been created'}. ${already}`
          : already,
      };
    case 'stopped':
      return {
        title: adding
          ? 'Stopped before the PRs were added'
          : 'Stopped before the stack was created',
        description: already,
      };
    case 'puttingBack':
      return {
        title: changed === 1 ? 'Putting the base branch back' : 'Putting the base branches back',
        description: 'Lo puts back the last change first.',
      };
    case 'putBack': {
      const rows = run.putBack;
      const back = rows.length > 0 && rows.every((row) => row.status === 'done');
      const left = rows.filter(
        (row) => row.status === 'left' && row.change.kind === 'retarget',
      ).length;
      const stack = rows.find((row) => row.status === 'left' && row.change.kind === 'unstack');
      return {
        title: back
          ? rows.some((row) => row.change.kind === 'unstack')
            ? 'The stack is gone, and the base branches are back'
            : changed === 1
              ? 'The base branch is back'
              : 'The base branches are back'
          : 'Not everything was put back',
        description:
          [
            stack?.change.kind === 'unstack' &&
              `GitHub stack #${stack.change.stack} changed since, so Lo left it.`,
            left > 0 &&
              `${left === 1 ? 'One base branch was' : `${left} base branches were`} changed elsewhere since, so Lo left ${left === 1 ? 'it' : 'them'}.`,
          ]
            .filter((text) => typeof text === 'string')
            .join(' ') || (run.again ? 'You can try putting the rest back again.' : ''),
      };
    }
    default:
      throw new Error(`a phase Lo doesn't know: ${JSON.stringify(phase satisfies never)}`);
  }
}

/** A pull request's page on GitHub. */
function pullLink(repo: RepoRef, number: number): string {
  return `https://github.com/${repo.owner}/${repo.name}/pull/${number}`;
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((number, index) => number === b[index]);
}
