// Making a chain of pull requests a GitHub stack, in main. A plan is made from what GitHub says now
// and kept under a key for the reader to confirm; the window confirms the key and never sends the
// changes. Each plan runs once, its changes sent in order through the account's poller, stopping at
// the first GitHub refuses or that fails, or before the next one once the reader stops it. Nothing
// is ever sent again by itself. A conversion that failed or stopped can put back the base branches
// it changed, last first, once the reader asks. A repository has one conversion at a time, none
// changes the base branches of pull requests Lo is merging, and none outlives Lo. Nothing here calls
// Electron.

import {
  describeMergeRefusal,
  GithubError,
  isRefusal,
  openLayers,
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
import type { Converting } from '../service.ts';
import type {
  Change,
  ChangeRow,
  ChangeStatus,
  ConversionProblem,
  ConversionView,
  Phase,
  Planned,
} from '../contract.ts';
import {
  causeOf,
  errorText,
  NO_ANSWER,
  numbers,
  OWN,
  planWords,
  reasonsText,
  refusalCause,
  STACK_CHANGED,
  type Cause,
} from './words.ts';

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
  /**
   * Which of `prs`, pull requests in `repo`, Lo is merging now: a conversion whose path holds any
   * is refused. None without it.
   */
  held?: (repo: RepoRef, prs: readonly number[]) => readonly number[];
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
  /** What went wrong, once something did. */
  problem: ConversionProblem | undefined;
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
      return unchecked(causeOf(error, acting.login));
    }
    // After Lo's own changes here, a plan waits for the pull requests listed since.
    const changedAt = this.#changedAt.get(repo.key);
    if (changedAt !== undefined && !(await this.#listedSince(poller, repo, changedAt))) {
      return unchecked({ reason: null, details: null });
    }
    const found = this.#options.found(tab.id);
    if (!found || found.login.toLowerCase() !== poller.login.toLowerCase()) {
      return refused([OWN.unread]);
    }
    const { forest, list, layers } = found;

    // GitHub's stacks as they are now: none without the Stacks API, which answers 404.
    let holding: GithubStack[] | undefined;
    try {
      holding = await poller.readOnce((client) => stacksHolding(client, repo, pull.number));
    } catch (error) {
      return unchecked(causeOf(error, poller.login));
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
        return unchecked({ reason: STACK_CHANGED, details: null });
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
    const merging = this.#held(repo, plan.path);
    if (merging.length > 0) return refused([OWN.merging(merging)]);

    for (const [key, kept] of this.#kept) if (kept.tab === tab.id) this.#kept.delete(key);
    const key = this.#newKey();
    this.#kept.set(key, { key, tab: tab.id, poller, repo, repository, plan });
    const words = planWords(plan, repository);
    return {
      kind: 'plan',
      key,
      description: words.description,
      changes: plan.steps.map(changeOf),
      warning: words.warning ?? null,
      login: poller.login,
    };
  }

  /**
   * Runs the plan named `key`, once: it's taken from the plans kept before anything is sent, so a
   * second confirmation finds nothing. Refused while its repository has a conversion running.
   */
  convert(key: string): ConversionView {
    if (this.#stopped) throw new IpcError('stopped', 'Lo is quitting.');
    const kept = this.#kept.get(key);
    if (!kept) throw new IpcError('gone', STACK_CHANGED);
    if (this.#busy.has(kept.repo.key)) {
      throw new IpcError('busy', OWN.running(kept.repository));
    }
    // A merge that started since the plan was made: the plan waits for it to finish.
    const merging = this.#held(kept.repo, kept.plan.path);
    if (merging.length > 0) throw new IpcError('busy', OWN.merging(merging));
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
      problem: undefined,
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
   * Undoes what the conversion named `key` changed, once it failed or stopped: the stack it may
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
    if (!run || !settled || run.controller) throw new IpcError('gone', STACK_CHANGED);
    if (this.#busy.has(run.repo.key)) throw new IpcError('busy', OWN.running(run.repository));
    const merging = this.#held(run.repo, run.plan.path);
    if (merging.length > 0) throw new IpcError('busy', OWN.merging(merging));
    if (!putBackOf(run).some(toDo)) throw new IpcError('gone', STACK_CHANGED);
    run.phase = 'puttingBack';
    run.controller = new AbortController();
    run.stopping = false;
    run.again = false;
    run.problem = undefined;
    this.#busy.set(run.repo.key, run);
    this.#publish(run);
    void this.#putBack(run).catch((error: unknown) => this.#crashed(run, error));
    return this.#view(run);
  }

  /**
   * The conversion in `repo` sending its changes, or putting base branches back, waiting out a pause
   * GitHub asked for included. Nothing once it has settled, though its dialog may still offer to put
   * base branches back: the reader may never ask.
   */
  converting(repo: RepoRef): Converting | undefined {
    const busy = this.#busy.get(repo.key);
    if (!busy) return undefined;
    return {
      kind: busy.phase === 'puttingBack' ? 'rollback' : 'running',
      prs: [...busy.plan.path],
    };
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
        if (status === 'unknown') {
          const [first = 0] = step.kind === 'retarget' ? [step.retarget.pr] : step.prs;
          run.problem = {
            title: 'Conversion not confirmed',
            reason: NO_ANSWER,
            details: errorText(sent.error),
            link: pullLink(repo, first),
          };
        } else {
          run.problem = failure(CONVERT_FAILED, causeOf(sent.error, poller.login));
        }
        run.phase = 'failed';
        break;
      }
      if (isRefusal(sent.value)) {
        this.#mark(run.changes, index, 'failed', `${describeMergeRefusal(sent.value)}.`);
        run.problem = failure(CONVERT_FAILED, refusalCause(sent.value, poller.login));
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
        run.problem = failure(UNDO_FAILED, causeOf(error, poller.login));
        return this.#putBackOver(run, 'again');
      }
      const open = holding?.filter((stack) => stack.open) ?? [];
      if (unsure.kind === 'add') {
        const joined = open.find((stack) => stackNumbers(stack).includes(first ?? 0));
        if (joined) {
          const one = unsure.prs.length === 1;
          run.problem = failure(UNDO_FAILED, {
            reason: `${numbers(unsure.prs)} ${one ? 'is' : 'are'} already in the GitHub stack.`,
            details: null,
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
          run.problem = failure(UNDO_FAILED, { reason: OTHER_LAYERS, details: null });
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
        run.problem = failure(UNDO_FAILED, causeOf(error, poller.login));
        return this.#putBackOver(run, 'again');
      }
      const still = holding?.find((stack) => stack.number === change.stack && stack.open);
      if (!still) this.#mark(rows, index, 'done', null);
      else if (sameNumbers(stackNumbers(still), change.prs)) this.#mark(rows, index, 'todo', null);
      else this.#mark(rows, index, 'left', OTHER_LAYERS);
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
        run.problem = failure(
          UNDO_INCOMPLETE,
          sent.mayHaveBeenDone
            ? { reason: NO_ANSWER, details: errorText(sent.error) }
            : causeOf(sent.error, poller.login),
        );
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
          this.#mark(
            rows,
            index,
            'left',
            change.kind === 'unstack'
              ? 'The GitHub stack has changed.'
              : 'Its base branch has changed.',
          );
          continue;
        }
        this.#mark(rows, index, 'failed', `${describeMergeRefusal(answer)}.`);
        run.problem = failure(UNDO_INCOMPLETE, refusalCause(answer, poller.login));
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

  /** Which of `prs`, pull requests in `repo`, Lo is merging now. */
  #held(repo: RepoRef, prs: readonly number[]): readonly number[] {
    return this.#options.held?.(repo, prs) ?? [];
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
    const { phase } = run;
    const left = putBackOf(run).filter(toDo);
    const canPutBack =
      (phase === 'failed' || phase === 'stopped' || (phase === 'putBack' && run.again)) &&
      left.length > 0;
    const said = saidOf(run);
    return {
      key: run.key,
      tab: run.tab,
      version: run.version,
      phase,
      waitingUntil: run.waitingUntil ?? null,
      stopping: run.stopping,
      changes: run.changes,
      putBack: run.putBack,
      line: said.line,
      problem: said.problem,
      undo: canPutBack,
    };
  }
}

/** The answer when converting to a GitHub stack isn't offered. */
function refused(reasons: readonly string[]): Planned {
  return { kind: 'notOffered', reasons: [...reasons] };
}

/** The answer when the stack couldn't be checked, for `cause`. */
function unchecked(cause: Cause): Planned {
  return { kind: 'unchecked', reason: cause.reason, details: cause.details };
}

/** What a conversion that failed says above its buttons. */
const CONVERT_FAILED = 'Couldn’t convert to GitHub stack';

/** What undoing a conversion says when it couldn't read what to undo, or left it. */
const UNDO_FAILED = 'Couldn’t undo the changes';

/** What undoing a conversion says when some of its changes weren't undone. */
const UNDO_INCOMPLETE = 'Couldn’t undo every change';

/** Why a GitHub stack wasn't unstacked: it holds more than the conversion put in it. */
const OTHER_LAYERS = 'The GitHub stack now has other layers.';

/** A problem titled `title`, for `cause`. */
function failure(title: string, cause: Cause): ConversionProblem {
  return { title, reason: cause.reason, details: cause.details, link: null };
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

/** What the dialog says of `run` above its buttons: a line, or what went wrong. */
function saidOf(run: Run): {
  line: string | null;
  problem: ConversionProblem | null;
} {
  const { plan, phase } = run;
  switch (phase) {
    case 'running':
    case 'puttingBack':
      return { line: null, problem: null };
    case 'done':
      return { line: 'Converted to GitHub stack', problem: null };
    case 'failed':
      return {
        line: null,
        problem: run.problem ?? failure(CONVERT_FAILED, { reason: null, details: null }),
      };
    case 'stopped': {
      const last = plan.steps.at(-1);
      if (last?.kind !== 'addToStack') {
        return { line: 'Stopped before the GitHub stack was created.', problem: null };
      }
      const one = last.prs.length === 1;
      return {
        line: `Stopped before ${numbers(last.prs)} ${one ? 'was' : 'were'} added.`,
        problem: null,
      };
    }
    case 'putBack': {
      if (run.problem) return { line: null, problem: run.problem };
      const rows = run.putBack;
      if (rows.length > 0 && rows.every((row) => row.status === 'done')) {
        return { line: 'Changes undone', problem: null };
      }
      const stack = rows.some((row) => row.status === 'left' && row.change.kind === 'unstack');
      const left = rows.filter(
        (row) => row.status === 'left' && row.change.kind === 'retarget',
      ).length;
      const reasons = [
        stack && 'The GitHub stack has changed.',
        left > 0 &&
          `${left} ${left === 1 ? 'base branch was' : 'base branches were'} changed elsewhere.`,
      ].filter((text) => typeof text === 'string');
      if (reasons.length === 0) {
        return { line: 'Stopped before every change was undone.', problem: null };
      }
      return {
        line: null,
        problem: failure(UNDO_INCOMPLETE, { reason: reasons.join(' '), details: null }),
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
