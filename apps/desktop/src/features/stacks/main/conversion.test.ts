// Converting a chain to a GitHub stack, planned from recorded answers (rozed-dev/e2e's tree: #2 a → main,
// #3 b → a, #4 c → b, #5 e → b and #6 d → main holding c; its GitHub stack #9 of #7 and #8; and #11
// alone) and run through a poller that answers each change as a test says.

import {
  GithubError,
  PullRef,
  type Cached,
  type ConversionStep,
  type GithubStack,
  type MergeRefusal,
  type OpenPullRequestList,
  type PullSummary,
  type RepoRef,
  type Retarget,
  type StepDone,
  type Target,
} from '@lo/github';
import { describe, expect, it } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import {
  conversion as conversionSchema,
  planned as plannedSchema,
  type ConversionView,
  type Plan,
  type Planned,
} from '../contract.ts';
import {
  Conversions,
  type ConversionPoller,
  type ConversionTab,
  type Found,
} from './conversion.ts';
import { Holds } from './holds.ts';
import {
  changePull,
  convertedAppStack,
  E2E,
  forestOf,
  recorded,
  type Recorded,
} from './test/support.ts';

const LOGIN = 'rozed-bot';
const LAYERS = [2, 3, 4, 6, 5, 7, 8, 11, 19];
const KEYS = Array.from({ length: 9 }, (_, index) => `0000000${index}-0000-0000-0000-000000000000`);

/** A promise and what settles it, for a change a test answers when it chooses. */
function later<T>() {
  return Promise.withResolvers<T>();
}

/** A pull request's REST summary, on `base`. */
function summary(number: number, base: string): PullSummary {
  return {
    number,
    title: `#${number}`,
    state: 'open',
    draft: false,
    updated_at: '2026-11-12T00:00:00Z',
    head: { ref: `h${number}`, sha: 'a'.repeat(40) },
    base: { ref: base, sha: 'b'.repeat(40) },
  };
}

/** A GitHub stack of `prs`, open. */
function githubStack(number: number, prs: readonly number[]): GithubStack {
  return {
    number,
    node_id: `S${number}`,
    base: { ref: 'main' },
    open: true,
    pull_requests: prs.map((pr) => ({
      number: pr,
      state: 'open',
      draft: false,
      merged_at: undefined,
      head: { ref: `h${pr}`, sha: 'a'.repeat(40) },
    })),
  };
}

/** GitHub's 502, which may have been done. */
const BAD_GATEWAY = new GithubError({
  kind: 'api',
  status: 502,
  message: 'Bad Gateway',
  errors: [],
});

type Answer<T> = T | Error | Promise<T>;

/** A poller that answers each change as the test says, and notes what was sent. */
class FakePoller implements ConversionPoller {
  readonly login = LOGIN;
  /** Each change sent, in order. */
  readonly sent: string[] = [];
  /** The stacks GitHub says hold a pull request: nothing without the Stacks API. */
  holding: GithubStack[] | undefined = [];
  holdingError: Error | undefined;
  /** What each step answers, by the order it's sent in; a step with none is done. */
  readonly steps: Answer<StepDone | MergeRefusal>[] = [];
  /** What each base branch change put back answers, in order; one with none is done. */
  readonly retargets: Answer<PullSummary | MergeRefusal>[] = [];
  unstacked: Answer<{ left: GithubStack | undefined } | MergeRefusal> = { left: undefined };
  heldUntil: number | undefined;
  list: Cached<OpenPullRequestList> | undefined;
  readonly listedAgain: string[] = [];
  readonly #listeners = new Set<() => void>();

  readOnce<T>(): Promise<T> {
    if (this.holdingError !== undefined) return Promise.reject(this.holdingError);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stacksHolding's answer.
    return Promise.resolve(this.holding as T);
  }

  runConversionStep(
    _repo: RepoRef,
    step: ConversionStep,
    signal?: AbortSignal,
  ): Promise<StepDone | MergeRefusal> {
    const answer = this.steps.shift();
    return this.#answer(named(step), answer ?? doneFor(step), signal);
  }

  retarget(
    _repo: RepoRef,
    move: Retarget,
    signal?: AbortSignal,
  ): Promise<PullSummary | MergeRefusal> {
    const answer = this.retargets.shift();
    return this.#answer(
      named({ kind: 'retarget', retarget: move }),
      answer ?? summary(move.pr, move.to),
      signal,
    );
  }

  unstack(
    _repo: RepoRef,
    stack: number,
    prs: readonly number[],
    signal?: AbortSignal,
  ): Promise<{ left: GithubStack | undefined } | MergeRefusal> {
    return this.#answer(`unstack #${stack} (${prs.join(' ')})`, this.unstacked, signal);
  }

  /** Sends nothing given up on before it's answered: a test's promise stands for the wait. */
  async #answer<T>(what: string, answer: Answer<T>, signal: AbortSignal | undefined): Promise<T> {
    if (signal?.aborted) throw signal.reason;
    if (answer instanceof Promise) {
      const value = await answer;
      this.sent.push(what);
      return value;
    }
    this.sent.push(what);
    if (answer instanceof Error) throw answer;
    return answer;
  }

  writesHeldUntil(): number | undefined {
    return this.heldUntil;
  }

  openPullRequests(): Cached<OpenPullRequestList> | undefined {
    return this.list;
  }

  changed(target: Target): Promise<void> {
    this.listedAgain.push(target.toString());
    return Promise.resolve();
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Lists the open pull requests again at `at`. */
  listAgain(at: number): void {
    if (this.list) this.list = { ...this.list, fetchedAt: at };
    for (const listener of this.#listeners) listener();
  }
}

function named(step: ConversionStep): string {
  switch (step.kind) {
    case 'retarget':
      return `#${step.retarget.pr} ${step.retarget.from} -> ${step.retarget.to}`;
    case 'createStack':
      return `create ${step.prs.join(' ')}`;
    case 'addToStack':
      return `add ${step.prs.join(' ')} to #${step.stack}`;
    default:
      throw new Error(`a step: ${JSON.stringify(step satisfies never)}`);
  }
}

/** What GitHub answers a step that's done. */
function doneFor(step: ConversionStep): StepDone {
  if (step.kind === 'retarget') {
    return { kind: 'retargeted', pull: summary(step.retarget.pr, step.retarget.to) };
  }
  return { kind: 'stacked', stack: githubStack(99, step.prs) };
}

/**
 * Conversions on `poller`, over what `found` recorded, with what they publish checked, held back
 * by the checks registered with `holds`.
 */
function started(
  poller: FakePoller,
  found: Recorded | undefined,
  more: { list?: OpenPullRequestList } = {},
) {
  const views: ConversionView[] = [];
  const holds = new Holds();
  const keys = [...KEYS];
  let now = 1000;
  const list = more.list ?? found?.list;
  if (list) poller.list = { value: list, fetchedAt: now };
  const conversions = new Conversions({
    poller: (login) =>
      login === LOGIN ? Promise.resolve(poller) : Promise.reject(new Error(`no ${login}`)),
    found: (): Found | undefined =>
      found && list
        ? { login: LOGIN, forest: forestOf({ ...found, list }), list, layers: found.layers }
        : undefined,
    publish: (view) => views.push(conversionSchema.parse(view)),
    held: (repo, prs) => holds.held(repo, prs),
    log: () => {},
    now: () => (now += 1),
    newKey: () => keys.shift() ?? 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    freshWait: 50,
    tick: 5,
  });
  return { conversions, views, holds, last: () => views.at(-1) };
}

/** The tab of pull request `number` in rozed-dev/e2e, acting as rozed-bot. */
function tab(number: number, more: Partial<ConversionTab> = {}): ConversionTab {
  return {
    id: `t${number}`,
    pull: PullRef.of(E2E, number),
    repository: 'e2e',
    acting: { kind: 'account', login: LOGIN },
    ...more,
  };
}

/** Runs what's waiting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Waits until `check` holds, as a conversion goes on by itself. */
async function until(check: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !check(); tries++) await settle();
  expect(check()).toBe(true);
}

function planOf(planned: Planned): Plan {
  plannedSchema.parse(planned);
  if (planned.kind === 'notOffered') throw new Error(planned.reasons.join(' '));
  if (planned.kind === 'unchecked') throw new Error(`unchecked: ${planned.reason ?? ''}`);
  return planned;
}

function reasonsOf(planned: Planned): string[] {
  plannedSchema.parse(planned);
  if (planned.kind !== 'notOffered') throw new Error(`not refused: ${planned.kind}`);
  return planned.reasons;
}

function uncheckedOf(planned: Planned) {
  plannedSchema.parse(planned);
  if (planned.kind !== 'unchecked') throw new Error(`checked: ${planned.kind}`);
  return { reason: planned.reason, details: planned.details };
}

/** Each change in `view`, briefly, with how it stands. */
function changes(view: ConversionView | undefined, which: 'changes' | 'putBack' = 'changes') {
  return (view?.[which] ?? []).map(({ change, status, detail }) => {
    const what =
      change.kind === 'retarget'
        ? `#${change.pr} ${change.from} -> ${change.to}`
        : change.kind === 'create'
          ? `create ${change.prs.join(' ')}`
          : change.kind === 'add'
            ? `add ${change.prs.join(' ')} to #${change.stack}`
            : `unstack #${change.stack}`;
    return detail === null ? `${what}: ${status}` : `${what}: ${status} (${detail})`;
  });
}

describe('planning', () => {
  it('plans the path through a layer, and words what it will do', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    const { conversions } = started(poller, found);
    const plan = planOf(await conversions.plan(tab(6)));
    expect(plan).toMatchObject({ key: KEYS[0], description: 'e2e · 4 layers', login: LOGIN });
    expect(plan.changes).toEqual([
      { kind: 'retarget', pr: 6, from: 'main', to: 'e2/c' },
      { kind: 'create', prs: [2, 3, 4, 6] },
    ]);
    expect(plan.warning).toBe(
      'On GitHub, each moved pull request’s diff shows only its own commits.',
    );
    // Nothing is sent while the reader looks at it.
    expect(poller.sent).toEqual([]);
  });

  it('says every reason it can’t, in words', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    const { conversions } = started(poller, found);
    poller.holding = [githubStack(9, [7, 8])];
    expect(reasonsOf(await conversions.plan(tab(8)))).toEqual(['Already a GitHub stack']);
    poller.holding = [];
    expect(reasonsOf(await conversions.plan(tab(11)))).toEqual([
      'A GitHub stack needs 2 pull requests',
    ]);
    expect(reasonsOf(await conversions.plan(tab(99)))).toEqual(['#99 isn’t open']);
    poller.holding = undefined;
    expect(reasonsOf(await conversions.plan(tab(11)))).toEqual([
      'GitHub stacks aren’t available for e2e',
      'A GitHub stack needs 2 pull requests',
    ]);
  });

  it('refuses a GitHub stack’s path, and a layer off its bottom, which GitHub would refuse', async () => {
    const found = await recorded('app_stack', E2E, [82, 83, 84, 85]);
    const poller = new FakePoller();
    // #82, #83 and #84 are GitHub stack #92, and #85 sits on #82 by its base branch.
    const { conversions } = started(poller, found, { list: convertedAppStack(found.list) });
    poller.holding = [githubStack(92, [82, 83, 84])];
    expect(reasonsOf(await conversions.plan(tab(84)))).toEqual(['Already a GitHub stack']);
    poller.holding = [];
    expect(reasonsOf(await conversions.plan(tab(85)))).toEqual([
      'The GitHub stack has other layers above #82',
    ]);
    expect(poller.sent).toEqual([]);
  });

  it('names the layers on a bottom layer with two', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    // #3 on main: #4 and #5 sit on it.
    const list = changePull(found.list, 3, (pr) => ({ ...pr, baseRefName: 'main' }));
    const { conversions } = started(new FakePoller(), found, { list });
    expect(reasonsOf(await conversions.plan(tab(3)))).toEqual([
      'Show one of the layers above #3 first',
    ]);
  });

  it('refuses a pull request in a merge queue, a fork and a busy repository', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const layers = found.layers && {
      ...found.layers,
      layers: found.layers.layers.map((layer) =>
        layer.number === 3 ? { ...layer, isInMergeQueue: true } : layer,
      ),
    };
    const list = changePull(found.list, 4, (pr) => ({ ...pr, isCrossRepository: true }));
    const { conversions } = started(new FakePoller(), { ...found, layers }, { list });
    expect(reasonsOf(await conversions.plan(tab(6)))).toEqual([
      '#3 is in the merge queue',
      '#4 is from a fork',
    ]);
  });

  it('refuses a tab that acts as nobody, or as nobody yet, before asking GitHub', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    poller.holdingError = new Error('asked GitHub');
    const { conversions } = started(poller, found);
    expect(reasonsOf(await conversions.plan(tab(6, { acting: { kind: 'anonymous' } })))).toEqual([
      'Sign in to convert to GitHub stack',
    ]);
    expect(reasonsOf(await conversions.plan(tab(6, { acting: undefined })))).toEqual(['Checking…']);
  });

  it('refuses until the stack is known, and while its layers’ state isn’t read', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    expect(reasonsOf(await started(new FakePoller(), undefined).conversions.plan(tab(6)))).toEqual([
      'Checking…',
    ]);
    const unread = started(new FakePoller(), { ...found, layers: undefined });
    expect(reasonsOf(await unread.conversions.plan(tab(6)))).toEqual(['Checking…']);
  });

  it('lists again when GitHub’s stacks aren’t what the list says', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    poller.holding = [githubStack(50, [2, 3, 4, 6])];
    const { conversions } = started(poller, found);
    expect(uncheckedOf(await conversions.plan(tab(6)))).toEqual({
      reason: 'The stack has changed.',
      details: null,
    });
    expect(poller.listedAgain).toEqual([E2E.toString()]);
  });

  it('keeps one plan a tab, forgets a closed tab’s, and runs each plan once', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    const { conversions } = started(poller, found);
    const first = planOf(await conversions.plan(tab(6)));
    const second = planOf(await conversions.plan(tab(6)));
    expect(() => conversions.convert(first.key)).toThrow(IpcError);
    const third = planOf(await conversions.plan(tab(2)));
    conversions.follow(new Set(['t6']));
    expect(() => conversions.convert(third.key)).toThrow(IpcError);
    conversions.convert(second.key);
    // A second confirmation finds nothing to run.
    expect(() => conversions.convert(second.key)).toThrow('The stack has changed.');
    await settle();
    expect(poller.sent).toEqual(['#6 main -> e2/c', 'create 2 3 4 6']);
  });
});

describe('running', () => {
  it('sends the changes in order, and says it’s done', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    const { conversions, last } = started(poller, found);
    const { key } = planOf(await conversions.plan(tab(6)));
    expect(conversions.convert(key).phase).toBe('running');
    await until(() => last()?.phase === 'done');
    expect(poller.sent).toEqual(['#6 main -> e2/c', 'create 2 3 4 6']);
    expect(changes(last())).toEqual(['#6 main -> e2/c: done', 'create 2 3 4 6: done']);
    expect(last()).toMatchObject({ line: 'Converted to GitHub stack', problem: null, undo: false });
  });

  it('stops at the first change GitHub refuses, and sends nothing after it', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    poller.steps.push({ refusal: 'baseChanged', now: 'elsewhere' });
    const { conversions, last } = started(poller, found);
    conversions.convert(planOf(await conversions.plan(tab(6))).key);
    await until(() => last()?.phase === 'failed');
    expect(poller.sent).toEqual(['#6 main -> e2/c']);
    expect(changes(last())).toEqual([
      "#6 main -> e2/c: failed (The pull request's base branch is now elsewhere, changed since Lo read it.)",
      'create 2 3 4 6: skipped',
    ]);
    expect(last()).toMatchObject({
      line: null,
      problem: {
        title: 'Couldn’t convert to GitHub stack',
        reason: 'Its base branch is now elsewhere.',
        details: "The pull request's base branch is now elsewhere, changed since Lo read it.",
        link: null,
      },
      undo: false,
    });
  });

  it('says a stack GitHub may have made isn’t confirmed, with its page', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    poller.steps.push(
      doneFor({ kind: 'retarget', retarget: { pr: 6, from: 'main', to: 'e2/c' } }),
      BAD_GATEWAY,
    );
    const { conversions, last } = started(poller, found);
    conversions.convert(planOf(await conversions.plan(tab(6))).key);
    await until(() => last()?.phase === 'failed');
    expect(changes(last())).toEqual([
      '#6 main -> e2/c: done',
      'create 2 3 4 6: unknown (GitHub answered 502: Bad Gateway.)',
    ]);
    expect(last()).toMatchObject({
      problem: {
        title: 'Conversion not confirmed',
        reason: 'GitHub didn’t respond.',
        details: 'GitHub answered 502: Bad Gateway.',
        link: 'https://github.com/rozed-dev/e2e/pull/2',
      },
      undo: true,
    });
  });

  it('says a base branch GitHub may have changed apart from one it did', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    poller.steps.push(BAD_GATEWAY);
    const { conversions, last } = started(poller, found);
    conversions.convert(planOf(await conversions.plan(tab(6))).key);
    await until(() => last()?.phase === 'failed');
    expect(changes(last())).toEqual([
      '#6 main -> e2/c: unknown (GitHub answered 502: Bad Gateway.)',
      'create 2 3 4 6: skipped',
    ]);
    expect(last()).toMatchObject({
      problem: {
        title: 'Conversion not confirmed',
        link: 'https://github.com/rozed-dev/e2e/pull/6',
      },
      undo: true,
    });
  });

  it('stops before the next change once the reader stops it', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    const first = later<StepDone>();
    poller.steps.push(first.promise);
    const { conversions, last } = started(poller, found);
    const { key } = planOf(await conversions.plan(tab(6)));
    conversions.convert(key);
    await settle();
    conversions.stop(key);
    expect(last()?.stopping).toBe(true);
    // The change being sent finishes; the next is never sent.
    first.resolve(doneFor({ kind: 'retarget', retarget: { pr: 6, from: 'main', to: 'e2/c' } }));
    await until(() => last()?.phase === 'stopped');
    expect(poller.sent).toEqual(['#6 main -> e2/c']);
    expect(changes(last())).toEqual(['#6 main -> e2/c: done', 'create 2 3 4 6: skipped']);
    expect(last()).toMatchObject({
      line: 'Stopped before the GitHub stack was created.',
      problem: null,
      undo: true,
    });
  });

  it('never sends a change given up on while it waits for GitHub', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    poller.heldUntil = 5_000_000;
    const waiting = later<StepDone>();
    poller.steps.push(waiting.promise);
    const { conversions, last } = started(poller, found);
    const { key } = planOf(await conversions.plan(tab(6)));
    conversions.convert(key);
    await until(() => last()?.waitingUntil === 5_000_000);
    conversions.stop(key);
    waiting.reject(new Error('given up'));
    await until(() => last()?.phase !== 'running');
    // What the poller's write does when it's given up on: the signal's reason, unsent.
    expect(poller.sent).toEqual([]);
  });

  it('runs one conversion a repository at a time', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    const first = later<StepDone>();
    poller.steps.push(first.promise);
    const { conversions, last } = started(poller, found);
    const other = planOf(await conversions.plan(tab(3)));
    conversions.convert(planOf(await conversions.plan(tab(6))).key);
    expect(reasonsOf(await conversions.plan(tab(2)))).toEqual([
      'Another stack in e2e is still converting',
    ]);
    expect(() => conversions.convert(other.key)).toThrow(IpcError);
    first.resolve(doneFor({ kind: 'retarget', retarget: { pr: 6, from: 'main', to: 'e2/c' } }));
    await until(() => last()?.phase === 'done');
    // Planning again here waits for the pull requests listed since.
    const again = conversions.plan(tab(3));
    await settle();
    poller.listAgain(1_000_000);
    expect((await again).kind).toBe('plan');
  });

  it('stops everything as Lo quits', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    const first = later<StepDone>();
    poller.steps.push(first.promise);
    const { conversions } = started(poller, found);
    const waiting = planOf(await conversions.plan(tab(3)));
    conversions.convert(planOf(await conversions.plan(tab(6))).key);
    conversions.quit();
    first.resolve(doneFor({ kind: 'retarget', retarget: { pr: 6, from: 'main', to: 'e2/c' } }));
    await settle();
    await settle();
    expect(poller.sent).toEqual(['#6 main -> e2/c']);
    expect(() => conversions.convert(waiting.key)).toThrow(IpcError);
  });
});

/** A conversion of #2 → #6 whose stack step `answer` ends, with two base branches changed. */
async function failed(answer: Answer<StepDone | MergeRefusal>) {
  const found = await recorded('stacks_e2e', E2E, LAYERS);
  // #3 on main too, sharing #2's commits: two base branches change.
  const list = changePull(found.list, 3, (pr) => ({
    ...pr,
    baseRefName: 'main',
    commits: {
      ...pr.commits,
      nodes: [...(openPull(found.list, 2).commits.nodes ?? []), ...(pr.commits.nodes ?? [])],
    },
  }));
  const poller = new FakePoller();
  const { conversions, last } = started(poller, found, { list });
  const plan = planOf(await conversions.plan(tab(6)));
  const moves = plan.changes.flatMap((change) => (change.kind === 'retarget' ? [change] : []));
  for (const move of moves) {
    poller.steps.push({ kind: 'retargeted', pull: summary(move.pr, move.to) });
  }
  poller.steps.push(answer);
  conversions.convert(plan.key);
  await until(() => last()?.phase === 'failed');
  poller.sent.length = 0;
  return { conversions, last, poller, key: plan.key, moves };
}

describe('undoing', () => {
  it('moves back the base branches it changed, last first', async () => {
    const { conversions, last, poller, key, moves } = await failed({ refusal: 'notAChain' });
    expect(moves.map((move) => move.pr)).toEqual([3, 6]);
    expect(last()?.problem?.reason).toBe('Each pull request must be based on the one below it.');
    expect(last()?.undo).toBe(true);
    conversions.putBack(key);
    await until(() => last()?.phase === 'putBack');
    expect(poller.sent).toEqual(['#6 e2/c -> main', '#3 e2/a -> main']);
    expect(last()).toMatchObject({ line: 'Changes undone', problem: null, undo: false });
    expect(() => conversions.putBack(key)).toThrow(IpcError);
  });

  it('leaves a base branch changed elsewhere since, and says so', async () => {
    const { conversions, last, poller, key } = await failed({ refusal: 'notAChain' });
    poller.retargets.push({ refusal: 'baseChanged', now: 'elsewhere' });
    conversions.putBack(key);
    await until(() => last()?.phase === 'putBack');
    expect(poller.sent).toEqual(['#6 e2/c -> main', '#3 e2/a -> main']);
    expect(changes(last(), 'putBack')).toEqual([
      '#6 e2/c -> main: left (elsewhere)',
      '#3 e2/a -> main: done',
    ]);
    expect(last()?.problem).toMatchObject({
      title: 'Couldn’t undo every change',
      reason: '1 base branch was changed elsewhere.',
    });
  });

  it('unstacks a stack it may have made only while it holds exactly the plan’s PRs', async () => {
    const exact = await failed(BAD_GATEWAY);
    exact.poller.holding = [githubStack(70, [2, 3, 4, 6])];
    exact.conversions.putBack(exact.key);
    await until(() => exact.last()?.phase === 'putBack');
    expect(exact.poller.sent).toEqual([
      'unstack #70 (2 3 4 6)',
      '#6 e2/c -> main',
      '#3 e2/a -> main',
    ]);

    const other = await failed(BAD_GATEWAY);
    other.poller.holding = [githubStack(70, [2, 3, 4, 6, 5])];
    other.conversions.putBack(other.key);
    await until(() => other.last()?.phase === 'putBack');
    expect(other.poller.sent).toEqual([]);
    expect(other.last()?.problem).toMatchObject({
      title: 'Couldn’t undo the changes',
      reason: 'The GitHub stack now has other layers.',
    });

    const none = await failed(BAD_GATEWAY);
    none.poller.holding = [];
    none.conversions.putBack(none.key);
    await until(() => none.last()?.phase === 'putBack');
    expect(none.poller.sent).toEqual(['#6 e2/c -> main', '#3 e2/a -> main']);
  });

  it('reads a stack again when its unstack’s answer was lost, before sending it again', async () => {
    const lost = async () => {
      const run = await failed(BAD_GATEWAY);
      run.poller.holding = [githubStack(70, [2, 3, 4, 6])];
      run.poller.unstacked = BAD_GATEWAY;
      run.conversions.putBack(run.key);
      await until(() => run.last()?.phase === 'putBack');
      expect(changes(run.last(), 'putBack')).toEqual([
        'unstack #70: unknown (GitHub answered 502: Bad Gateway.)',
        '#6 e2/c -> main: todo',
        '#3 e2/a -> main: todo',
      ]);
      expect(run.last()?.undo).toBe(true);
      run.poller.sent.length = 0;
      return run;
    };

    // GitHub took it: the stack is gone, so only the base branches go back.
    const gone = await lost();
    gone.poller.holding = [];
    gone.conversions.putBack(gone.key);
    await until(() => gone.last()?.phase === 'putBack' && !gone.last()?.undo);
    expect(gone.poller.sent).toEqual(['#6 e2/c -> main', '#3 e2/a -> main']);
    expect(changes(gone.last(), 'putBack')).toEqual([
      'unstack #70: done',
      '#6 e2/c -> main: done',
      '#3 e2/a -> main: done',
    ]);
    expect(gone.last()?.line).toBe('Changes undone');

    // It didn't: the stack still holds just what Lo made, so the unstack is sent again.
    const there = await lost();
    there.poller.unstacked = { left: undefined };
    there.conversions.putBack(there.key);
    await until(() => there.last()?.phase === 'putBack' && !there.last()?.undo);
    expect(there.poller.sent).toEqual([
      'unstack #70 (2 3 4 6)',
      '#6 e2/c -> main',
      '#3 e2/a -> main',
    ]);

    // The stack holds other PRs now: Lo leaves it, says so, and still puts the base branches back.
    const grown = await lost();
    grown.poller.holding = [githubStack(70, [2, 3, 4, 6, 5])];
    grown.conversions.putBack(grown.key);
    await until(() => grown.last()?.phase === 'putBack' && !grown.last()?.undo);
    expect(grown.poller.sent).toEqual(['#6 e2/c -> main', '#3 e2/a -> main']);
    expect(changes(grown.last(), 'putBack')[0]).toBe(
      'unstack #70: left (The GitHub stack now has other layers.)',
    );
    expect(grown.last()?.problem).toMatchObject({
      title: 'Couldn’t undo every change',
      reason: 'The GitHub stack has changed.',
    });
  });

  it('leaves a stack that changed before Lo could unstack it, and goes on', async () => {
    const { conversions, last, poller, key } = await failed(BAD_GATEWAY);
    poller.holding = [githubStack(70, [2, 3, 4, 6])];
    poller.unstacked = { refusal: 'stackChanged' };
    conversions.putBack(key);
    await until(() => last()?.phase === 'putBack');
    expect(changes(last(), 'putBack')).toEqual([
      'unstack #70: left (The GitHub stack has changed.)',
      '#6 e2/c -> main: done',
      '#3 e2/a -> main: done',
    ]);
    expect(last()?.undo).toBe(false);
  });

  it('goes on from where it stopped when a change fails, once asked again', async () => {
    const { conversions, last, poller, key } = await failed({ refusal: 'notAChain' });
    poller.retargets.push(summary(6, 'main'), BAD_GATEWAY);
    conversions.putBack(key);
    await until(() => last()?.phase === 'putBack');
    expect(changes(last(), 'putBack')).toEqual([
      '#6 e2/c -> main: done',
      '#3 e2/a -> main: unknown (GitHub answered 502: Bad Gateway.)',
    ]);
    expect(last()?.problem).toMatchObject({
      title: 'Couldn’t undo every change',
      reason: 'GitHub didn’t respond.',
    });
    expect(last()?.undo).toBe(true);
    poller.sent.length = 0;
    conversions.putBack(key);
    await until(() => last()?.phase === 'putBack' && !last()?.undo);
    expect(poller.sent).toEqual(['#3 e2/a -> main']);
  });
});

/** A place in GitHub stack #9, of two pull requests on main. */
function inStack9(position: number) {
  return { position, stack: { number: 9, size: 2, baseRefName: 'main' } };
}

/** The tree, with #2 and #3 GitHub stack #9 and #7 and #8 on a branch of their own. */
async function onStack() {
  const found = await recorded('stacks_e2e', E2E, LAYERS);
  let list = changePull(found.list, 2, (pr) => ({ ...pr, stackEntry: inStack9(1) }));
  list = changePull(list, 3, (pr) => ({ ...pr, stackEntry: inStack9(2) }));
  for (const number of [7, 8]) {
    list = changePull(list, number, (pr) => ({ ...pr, stackEntry: null, baseRefName: 'z' }));
  }
  return { found, list };
}

/**
 * A check like the one the feature that merges registers: it names those of `numbers` it's asked
 * about, and notes what it's asked.
 */
function merging(...numbers: number[]) {
  const asked: [string, number[]][] = [];
  const check = (repo: RepoRef, prs: readonly number[]) => {
    asked.push([repo.toString(), [...prs]]);
    return prs.filter((pr) => numbers.includes(pr));
  };
  return { check, asked };
}

describe('while Lo merges', () => {
  it('refuses to plan a conversion while a pull request on its path merges', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const { conversions, holds } = started(new FakePoller(), found);
    const merge = merging(3);
    const stop = holds.add(merge.check);
    expect(reasonsOf(await conversions.plan(tab(6)))).toEqual(['#3 is still merging']);
    expect(merge.asked).toEqual([[E2E.toString(), [2, 3, 4, 6]]]);
    // A merge off the path holds nothing back, nor one that's over.
    const other = holds.add(merging(11).check);
    stop();
    planOf(await conversions.plan(tab(6)));
    other();
  });

  it('refuses to confirm a plan while one merges, and keeps the plan for when it’s done', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    const { conversions, holds } = started(poller, found);
    const { key } = planOf(await conversions.plan(tab(6)));
    const stop = holds.add(merging(2, 6).check);
    expect(() => conversions.convert(key)).toThrow(
      new IpcError('busy', '#2 and #6 are still merging'),
    );
    await settle();
    expect(poller.sent).toEqual([]);
    stop();
    expect(conversions.convert(key).phase).toBe('running');
  });

  it('refuses to put base branches back while one merges', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    poller.steps.push(
      doneFor({ kind: 'retarget', retarget: { pr: 6, from: 'main', to: 'e2/c' } }),
      { refusal: 'baseChanged', now: 'elsewhere' },
    );
    const { conversions, holds, last } = started(poller, found);
    const { key } = planOf(await conversions.plan(tab(6)));
    conversions.convert(key);
    await until(() => last()?.phase === 'failed');
    const stop = holds.add(merging(6).check);
    expect(() => conversions.putBack(key)).toThrow('#6 is still merging');
    stop();
    expect(conversions.putBack(key).phase).toBe('puttingBack');
  });

  it('says whether a conversion sends its changes or puts base branches back', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    const first = later<StepDone>();
    poller.steps.push(first.promise, { refusal: 'baseChanged', now: 'elsewhere' });
    const back = later<PullSummary>();
    poller.retargets.push(back.promise);
    const { conversions, last } = started(poller, found);
    expect(conversions.converting(E2E)).toBeUndefined();
    const { key } = planOf(await conversions.plan(tab(6)));
    // A plan waiting to be confirmed changes nothing yet.
    expect(conversions.converting(E2E)).toBeUndefined();
    conversions.convert(key);
    expect(conversions.converting(E2E)).toEqual({ kind: 'running', prs: [2, 3, 4, 6] });
    first.resolve(doneFor({ kind: 'retarget', retarget: { pr: 6, from: 'main', to: 'e2/c' } }));
    await until(() => last()?.phase === 'failed');
    // The dialog offers to undo #6's move, but the reader may never ask.
    expect(last()?.undo).toBe(true);
    expect(conversions.converting(E2E)).toBeUndefined();
    conversions.putBack(key);
    expect(conversions.converting(E2E)).toEqual({ kind: 'rollback', prs: [2, 3, 4, 6] });
    back.resolve(summary(6, 'main'));
    await until(() => last()?.phase === 'putBack');
    expect(conversions.converting(E2E)).toBeUndefined();
  });
});

describe('adding to a GitHub stack', () => {
  it('plans only the PRs added, and leaves an add that may have gone through', async () => {
    const { found, list } = await onStack();
    const poller = new FakePoller();
    poller.holding = [githubStack(9, [2, 3])];
    const { conversions, last } = started(poller, found, { list });
    const plan = planOf(await conversions.plan(tab(6)));
    expect(plan.description).toBe('e2e · 2 layers');
    expect(plan.changes).toEqual([
      { kind: 'retarget', pr: 6, from: 'main', to: 'e2/c' },
      { kind: 'add', stack: 9, prs: [4, 6] },
    ]);
    poller.steps.push(
      doneFor({ kind: 'retarget', retarget: { pr: 6, from: 'main', to: 'e2/c' } }),
      BAD_GATEWAY,
    );
    conversions.convert(plan.key);
    await until(() => last()?.phase === 'failed');
    expect(last()?.problem?.title).toBe('Conversion not confirmed');
    poller.holding = [githubStack(9, [2, 3, 4, 6])];
    poller.sent.length = 0;
    conversions.putBack(plan.key);
    await until(() => last()?.phase === 'putBack');
    expect(poller.sent).toEqual([]);
    expect(last()?.problem).toEqual({
      title: 'Couldn’t undo the changes',
      reason: '#4 and #6 are already in the GitHub stack.',
      details: null,
      link: null,
    });
  });
});

/** The open pull request numbered `number` in `list`. */
function openPull(list: OpenPullRequestList, number: number) {
  const pr = list.pullRequests.find((each) => each.number === number);
  if (!pr) throw new Error(`#${number} isn't open`);
  return pr;
}
