// Merging, with a stand-in poller and the app's real `MergeJobs`: a plan names the method chosen
// and only what the reader typed, runs once, and goes with the head on screen; each check at the
// press refuses, reads again or asks again; a merge write to a pull request waits for the one
// under way, whatever its account; a `409` is followed, never sent again; a lost answer is settled
// by a read; and the method is remembered once GitHub takes it. Auto-merge, on and off, and a merge
// past the rules take the same turns, and a lost answer about either is settled by a read too.

import {
  GithubError,
  MERGE_FACTS,
  MergeJobs,
  PullRef,
  type AsyncMerge,
  type AutoMergeRequest,
  type AutoMergeState,
  type Cached,
  type GithubClient,
  type MergeFacts,
  type MergeRefusal,
  type MergeRequest,
  type PollEvent,
  type PollStatus,
  type PullRequestAnswer,
  type ReadKind,
  type RepoRef,
  type SinceMark,
  type Submitted,
} from '@lo/github';
import { findStacks, type PullRequest } from '@lo/stacks';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Forest } from '../../stacks/service.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { JobView, Method, MergePlan, Planned } from '../contract.ts';
import { FRESH_FOR, Merging, type MergingPoller } from './merging.ts';
import { factsOf, HEAD } from './test/facts.ts';
import { MergeTurns } from './turns.ts';

const NOW = 1_800_000_000_000;
const NEWER = 'c'.repeat(40);
const ID = 'tab-1';
const PULL = new PullRef('rozed-dev', 'e2e', 138);
const UUID = '11111111-2222-3333-4444-555555555555';

/** An answer about an async merge. */
function answer(status: AsyncMerge['status'], details: Partial<AsyncMerge['details']> = {}) {
  return { status, details: { message: '', ...details } };
}

/** The list a forest is found from: #138 alone on `base`, and anything `more` adds. */
function forestOf(base: string, more: PullRequest[] = []): Forest {
  const pulls: PullRequest[] = [
    {
      number: 138,
      state: { kind: 'open' },
      baseRef: base,
      baseTip: undefined,
      headRef: 'merge/5/squash',
      headInBaseRepo: true,
      headOid: HEAD,
      commits: [],
      createdAt: 1,
      nativeStack: undefined,
    },
    ...more,
  ];
  const trunks = ['main', 'e4/queued'];
  return {
    stacks: { ...findStacks(pulls, trunks), gaps: [] },
    trunks,
    listedAt: NOW,
    listEvery: 120_000,
    whole: true,
    conversion: () => ({ kind: 'notOffered', reasons: [], words: [] }),
  };
}

interface Setup {
  facts?: MergeFacts;
  fetchedAt?: number;
  /** What GitHub answers to the merge, as the poller hands it on. */
  submitted?: () => Promise<Submitted | MergeRefusal>;
  /** What GitHub answers each time it's asked how the merge goes, the last again. */
  results?: AsyncMerge[];
  /** The facts a read at the press gives. */
  reread?: MergeFacts;
  forest?: Forest | undefined;
  /** The open pull requests from a branch, as GitHub answers at the press. */
  fromHead?: unknown[];
  latest?: string;
  acting?: PullTabInfo['acting'];
  method?: Method;
  /** How long a read at the press, and a list again, may take: 50 ms and 1 ms. */
  readWait?: number;
  listWait?: number;
  /** What GitHub answers to turning auto-merge on, and off. */
  autoOn?: () => Promise<AutoMergeState | MergeRefusal>;
  autoOff?: () => Promise<AutoMergeState | MergeRefusal>;
}

/** Auto-merge as GitHub answers a write of it: on, with `method`, or off. */
function autoState(on: AutoMergeRequest['method'] | undefined, inQueue = false): AutoMergeState {
  return {
    number: 138,
    head: HEAD,
    autoMerge: on === undefined ? undefined : { method: on, enabledBy: 'rozed-bot' },
    inQueue,
  };
}

const merges: Merging[] = [];
const jobsMade: MergeJobs[] = [];

afterEach(() => {
  for (const merging of merges.splice(0)) merging.stop();
  for (const jobs of jobsMade.splice(0)) jobs.stop();
});

function setup(options: Setup = {}) {
  let cached: Cached<MergeFacts> = {
    value: options.facts ?? factsOf(),
    fetchedAt: options.fetchedAt ?? NOW,
  };
  const listeners = new Set<(event: PollEvent) => void>();
  const sent: MergeRequest[] = [];
  /** Each auto-merge write, with the pull request's node ID and what it asked. */
  const auto: [string, string, AutoMergeRequest | undefined][] = [];
  const reads: string[] = [];
  const published: JobView[] = [];
  const remembered: [string, Method][] = [];
  let status: PollStatus = { rateLimit: { kind: 'normal' }, offline: undefined, signedOut: false };
  let held: number | undefined;
  let marks = 0;
  /** What a wait holds back, once a test holds it: the poller, the reads, or GitHub's answer. */
  const gates = { poller: false, reads: false, fromHead: false };
  let pollerGiven: (() => void) | undefined;
  let fromHeadGiven: (() => void) | undefined;
  /** The signals the reads at the press were given, to give them up. */
  const signals: (AbortSignal | undefined)[] = [];
  /** Whether the list of open pull requests is older than it's read every, so Lo lists it again. */
  let stale = false;
  /** The read of the merge facts the poller keeps, which goes when its tab closes. */
  let readId = 1;
  let readKept = true;
  let closed = false;
  const results = options.results ?? [answer('merged', { sha: 'd'.repeat(40) })];
  const stand = {
    send: async (_method: string, path: string) => {
      reads.push(path);
      if (gates.fromHead) await new Promise<void>((resolve) => (fromHeadGiven = resolve));
      return {
        header: () => undefined,
        json: (parse: (json: unknown) => unknown) => parse(options.fromHead ?? []),
      };
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what `openPullsFromHead` uses.
  const client = stand as unknown as GithubClient;
  const poller: MergingPoller = {
    login: 'rozed-bot',
    mergeFacts: () => Promise.resolve(cached),
    cachedRead<T>(_pull: PullRef, kind: ReadKind<T>): Cached<T> | undefined {
      if (kind.name !== MERGE_FACTS.name) return undefined;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what MERGE_FACTS reads.
      return cached as Cached<T>;
    },
    // Read afresh, GitHub answers with `reread`, or as before.
    readAfresh: () => {
      if (!readKept) return undefined;
      marks += 1;
      if (!gates.reads) {
        cached = { value: options.reread ?? cached.value, fetchedAt: NOW };
        queueMicrotask(() => emit({ kind: 'read', pull: PULL, name: MERGE_FACTS.name }));
      }
      return { read: readId, generation: marks };
    },
    readSince<T>(_pull: PullRef, _kind: ReadKind<T>, mark: SinceMarkFor): SinceMark<Cached<T>> {
      if (!readKept || mark.read !== readId) return { kind: 'stale' };
      if (gates.reads) return { kind: 'waiting' };
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what MERGE_FACTS reads.
      return { kind: 'read', read: cached as Cached<T> };
    },
    readMergeFactsAgain: () => undefined,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status: () => status,
    writesHeldUntil: () => held,
    listAgain: () => undefined,
    readOnce: (request, signal) => {
      signals.push(signal);
      return new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('given up')));
        request(client).then(resolve, reject);
      });
    },
    mergeAsync(_pull, request) {
      sent.push(request);
      return (
        options.submitted?.() ??
        Promise.resolve({ kind: 'accepted', uuid: UUID, answer: answer('pending', { uuid: UUID }) })
      );
    },
    mergeAsyncResult: () => Promise.resolve(results.length > 1 ? results.shift()! : results[0]!),
    pullRequest: () =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only its node ID is read.
      ({
        details: { id: 'PR_138' },
        fetchedAt: NOW,
        offlineAge: undefined,
      }) as unknown as PullRequestAnswer,
    enableAutoMerge(_pull, id, request) {
      auto.push(['on', id, request]);
      return options.autoOn?.() ?? Promise.resolve(autoState(request.method));
    },
    disableAutoMerge(_pull, id) {
      auto.push(['off', id, undefined]);
      return options.autoOff?.() ?? Promise.resolve(autoState(undefined));
    },
    changed: () => Promise.resolve(),
  };
  function emit(event: PollEvent) {
    for (const listener of listeners) listener(event);
  }
  let view: PullTabInfo = {
    id: ID,
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number: 138,
    acting: options.acting ?? { kind: 'account', login: 'rozed-bot' },
    head: { fork: null },
    shown: HEAD,
    latest: options.latest ?? HEAD,
    provisional: false,
    local: { kind: 'waiting' },
    compareFrom: undefined,
    drawn: true,
    run: undefined,
  };
  const turns = new MergeTurns();
  const jobs = new MergeJobs({ firstWait: 1, maxWait: 1, now: () => NOW });
  jobsMade.push(jobs);
  let converting: string[] = [];
  const merging = new Merging({
    poller: async () => {
      if (gates.poller) await new Promise<void>((resolve) => (pollerGiven = resolve));
      return poller;
    },
    view: (id) => (id === ID && !closed ? view : undefined),
    headOnScreen: () => HEAD,
    headContainsBase: () => undefined,
    method: () => options.method,
    remember: (repo: RepoRef, method) => remembered.push([repo.toString(), method]),
    forest: () =>
      stale
        ? { ...forestOf(cached.value.pullRequest.base), listedAt: 0 }
        : 'forest' in options
          ? options.forest
          : forestOf(cached.value.pullRequest.base),
    converting: () => (converting.length > 0 ? { kind: 'running', prs: [138] } : undefined),
    turns,
    jobs,
    publish: (job) => published.push(job),
    log: () => undefined,
    now: () => NOW,
    readWait: options.readWait ?? 50,
    listWait: options.listWait ?? 1,
  });
  merges.push(merging);
  return {
    merging,
    poller,
    turns,
    sent,
    auto,
    reads,
    published,
    remembered,
    emit,
    signals,
    /** Holds back each wait at the press until it's let go: the account's poller, a read again, or GitHub's list of open pull requests from a branch. */
    hold: {
      poller: () => {
        gates.poller = true;
      },
      reads: () => {
        gates.reads = true;
      },
      fromHead: () => {
        gates.fromHead = true;
      },
    },
    /** Lets every held wait go on. */
    release() {
      gates.poller = false;
      gates.fromHead = false;
      pollerGiven?.();
      fromHeadGiven?.();
      if (gates.reads) {
        gates.reads = false;
        cached = { value: options.reread ?? cached.value, fetchedAt: NOW };
        emit({ kind: 'read', pull: PULL, name: MERGE_FACTS.name });
      }
    },
    set: {
      stale: () => {
        stale = true;
      },
      closed: () => {
        closed = true;
      },
      /** The tab closes, and the poller lets its read go; or it opens again and reads. */
      tabRead: (kept: boolean) => {
        readKept = kept;
        if (!kept) return;
        readId += 1;
        emit({ kind: 'read', pull: PULL, name: MERGE_FACTS.name });
      },
      acting: (acting: PullTabInfo['acting']) => {
        view = { ...view, acting };
      },
      offline: () => {
        status = { ...status, offline: { error: 'down', since: NOW, retryAt: NOW } };
      },
      signedOut: () => {
        status = { ...status, signedOut: true };
      },
      paused: (until: number) => {
        held = until;
      },
      converting: () => {
        converting = ['running'];
      },
    },
    /** The last state published of the merge, once it's `kind`. */
    async ended(kind: JobView['state']['kind']): Promise<JobView> {
      await vi.waitFor(() => expect(published.at(-1)?.state.kind).toBe(kind));
      return published.at(-1)!;
    },
  };
}

type Run = ReturnType<typeof setup>;

/** A mark the poller gave for a read. */
type SinceMarkFor = Parameters<MergingPoller['readSince']>[2];

/** A merge whose answer never reached Lo. */
function lost(): Promise<never> {
  return Promise.reject(
    new GithubError({ kind: 'network', failure: 'lost', message: 'read ECONNRESET' }),
  );
}

/** A moment, for what's under way to reach the wait it's held at. */
function moment(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

/** The plan `planned` holds, or a failure naming why there's none. */
function planOf(planned: Planned): MergePlan {
  if (planned.kind !== 'plan') throw new Error(planned.why);
  return planned.plan;
}

const SQUASH = { method: 'SQUASH', title: '', message: '' } as const;

describe('a merge', () => {
  it('goes once, as planned, with the head on screen, the method chosen and only what was typed, and the method is remembered once GitHub takes it', async () => {
    const run = setup();
    const plan = planOf(
      await run.merging.plan(ID, { method: 'SQUASH', title: '  Rate limit by cost ', message: '' }),
    );
    expect(plan).toMatchObject({
      kind: 'merge',
      method: 'SQUASH',
      base: 'main',
      head: HEAD,
      login: 'rozed-bot',
      title: 'Rate limit by cost',
      message: '',
    });
    expect(await run.merging.confirm(plan.key)).toEqual({ kind: 'sent' });
    expect(run.sent).toEqual([
      expect.objectContaining({
        sha: HEAD,
        method: 'SQUASH',
        action: 'direct_merge',
        commitTitle: 'Rate limit by cost',
        commitMessage: undefined,
        bypassRules: false,
      }),
    ]);
    const done = await run.ended('merged');
    expect(done).toMatchObject({ key: plan.key, number: 138, already: false });
    expect(run.remembered).toEqual([['rozed-dev/e2e', 'SQUASH']]);

    // A plan runs once.
    expect(await run.merging.confirm(plan.key)).toMatchObject({
      kind: 'refused',
      refusal: { kind: 'used' },
    });
    expect(run.sent).toHaveLength(1);
  });

  it('leaves GitHub its own commit text when nothing was typed, or for any method but a squash', async () => {
    const run = setup();
    const plan = planOf(
      await run.merging.plan(ID, { method: 'MERGE', title: 'Typed', message: 'Typed too' }),
    );
    expect(plan).toMatchObject({ method: 'MERGE', title: '', message: '' });
    await run.merging.confirm(plan.key);
    expect(run.sent[0]).toMatchObject({ commitTitle: undefined, commitMessage: undefined });
  });

  it('takes the method last used, or GitHub’s default when that’s no longer allowed', async () => {
    const remembered = setup({ method: 'REBASE' });
    expect(planOf(await remembered.merging.plan(ID, { ...SQUASH, method: null })).method).toBe(
      'REBASE',
    );
    // The repository no longer allows rebasing: GitHub's default for the account, a merge commit.
    const facts = factsOf();
    const noRebase = setup({
      method: 'REBASE',
      facts: { ...facts, repository: { ...facts.repository, rebaseMergeAllowed: false } },
    });
    expect(planOf(await noRebase.merging.plan(ID, { ...SQUASH, method: null })).method).toBe(
      'MERGE',
    );
  });

  it('into a branch with a merge queue joins the queue, whose settings choose the method', async () => {
    const run = setup({
      facts: factsOf({ base: 'e4/queued', queueRequired: true, queueMethod: 'SQUASH' }),
      results: [answer('enqueued')],
    });
    const plan = planOf(await run.merging.plan(ID, SQUASH));
    expect(plan).toMatchObject({ kind: 'enqueue', method: 'SQUASH', base: 'e4/queued' });
    await run.merging.confirm(plan.key);
    expect(run.sent[0]).toMatchObject({ action: 'merge_queue', method: undefined });
    await run.ended('enqueued');
    // The queue's method isn't the reader's to remember.
    expect(run.remembered).toEqual([]);
  });

  it('asks GitHub which open pull requests come from a base that isn’t a trunk, and refuses one that sits on another', async () => {
    const alone = setup({ facts: factsOf({ base: 'merge/5/base' }) });
    planOf(await alone.merging.plan(ID, SQUASH));
    expect(alone.reads).toEqual([
      '/repos/rozed-dev/e2e/pulls?head=rozed-dev%3Amerge%2F5%2Fbase&state=open&per_page=100',
    ]);

    // #137 comes from the base, so #138 sits on it, though Lo's list doesn't say so.
    const below = setup({
      facts: factsOf({ base: 'merge/5/base' }),
      fromHead: [
        {
          number: 137,
          base: { ref: 'main', repo: { full_name: 'rozed-dev/e2e' } },
          head: { ref: 'merge/5/base', repo: { full_name: 'rozed-dev/e2e' } },
        },
      ],
    });
    expect(await below.merging.plan(ID, SQUASH)).toEqual({
      kind: 'refused',
      why: expect.stringContaining('#137 comes from merge/5/base'),
    });
  });
});

describe('at the press', () => {
  it('refuses what keeps a merge from going, sending nothing', async () => {
    const cases: [string, (run: Run) => void, Setup?][] = [
      ['offline', (run) => run.set.offline()],
      ['signedOut', (run) => run.set.signedOut()],
      ['paused', (run) => run.set.paused(NOW + 60_000)],
      ['converting', (run) => run.set.converting()],
      [
        'busy',
        // Another account's write to the same pull request, such as a queue's.
        (run) => run.turns.take(PULL.repo, [138]),
      ],
      ['newerPush', () => undefined, { latest: NEWER }],
      ['checks', () => undefined, { facts: factsOf({}, { cutShort: ['checks'] }) }],
    ];
    for (const [kind, change, options] of cases) {
      const run = setup(options);
      const plan = planOf(await run.merging.plan(ID, SQUASH));
      change(run);
      const confirmed = await run.merging.confirm(plan.key);
      expect({ kind, confirmed, sent: run.sent }).toMatchObject({
        kind,
        confirmed: { kind: 'refused', refusal: { kind } },
        sent: [],
      });
    }
  });

  it('offers the newer push the tab knows of, from the head on screen', async () => {
    const run = setup({ latest: NEWER });
    const plan = planOf(await run.merging.plan(ID, SQUASH));
    expect(await run.merging.confirm(plan.key)).toMatchObject({
      refusal: { kind: 'newerPush', newer: { from: HEAD, to: NEWER } },
    });
  });

  it('reads again what’s older than 7 minutes, and sends once that holds', async () => {
    const run = setup({ fetchedAt: NOW - FRESH_FOR - 1, reread: factsOf() });
    const plan = planOf(await run.merging.plan(ID, SQUASH));
    expect(await run.merging.confirm(plan.key)).toEqual({ kind: 'sent' });
    expect(run.sent).toHaveLength(1);
  });

  it('refuses when the read again shows a newer push, or GitHub left part of it out', async () => {
    const moved = setup({ fetchedAt: 0, reread: factsOf({ head: NEWER }) });
    const plan = planOf(await moved.merging.plan(ID, SQUASH));
    expect(await moved.merging.confirm(plan.key)).toMatchObject({
      refusal: { kind: 'newerPush', newer: { from: HEAD, to: NEWER } },
    });

    const partly = setup({
      fetchedAt: 0,
      reread: factsOf({}, { leftOut: ['pullRequest.reviews'] }),
    });
    const again = planOf(await partly.merging.plan(ID, SQUASH));
    expect(await partly.merging.confirm(again.key)).toMatchObject({
      refusal: { kind: 'incomplete' },
    });
    expect([...moved.sent, ...partly.sent]).toEqual([]);
  });

  it('asks again with a new plan when what it named changed', async () => {
    const facts = factsOf();
    const run = setup({
      fetchedAt: 0,
      reread: { ...facts, repository: { ...facts.repository, squashMergeAllowed: false } },
    });
    const plan = planOf(await run.merging.plan(ID, SQUASH));
    const confirmed = await run.merging.confirm(plan.key);
    if (confirmed.kind !== 'again') throw new Error(JSON.stringify(confirmed));
    expect(confirmed.plan.key).not.toBe(plan.key);
    expect(confirmed.plan.method).toBe('MERGE');
    expect(confirmed.why).toContain('The method it merges with changed.');
    expect(run.sent).toEqual([]);
    expect(await run.merging.confirm(confirmed.plan.key)).toEqual({ kind: 'sent' });
  });

  it('sends nothing once cancelled during any wait at the press, and gives up its reads', async () => {
    const waits: [string, (run: Run) => void, Setup?][] = [
      ['the account’s poller', (run) => run.hold.poller()],
      ['a read again', (run) => run.hold.reads(), { fetchedAt: 0, readWait: 60_000 }],
      [
        'the open pull requests from its base',
        (run) => run.hold.fromHead(),
        { facts: factsOf({ base: 'merge/5/base' }) },
      ],
      ['the list again', (run) => run.set.stale(), { listWait: 60_000 }],
    ];
    for (const [wait, hold, options] of waits) {
      const run = setup(options);
      const plan = planOf(await run.merging.plan(ID, SQUASH));
      hold(run);
      const confirming = run.merging.confirm(plan.key);
      await moment();
      run.merging.cancel(plan.key);
      const confirmed = await confirming;
      // What it waited for comes after all.
      run.release();
      await moment();
      const given = run.signals.filter((signal) => signal !== undefined);
      expect({
        wait,
        confirmed,
        sent: run.sent,
        given: given.every(({ aborted }) => aborted),
      }).toEqual({
        wait,
        confirmed: { kind: 'refused', refusal: expect.objectContaining({ kind: 'cancelled' }) },
        sent: [],
        given: true,
      });
      // Nor does the plan go later.
      expect(await run.merging.confirm(plan.key)).toMatchObject({ refusal: { kind: 'used' } });
    }
  });

  it('checks the tab, the account and the connection again right before it sends', async () => {
    const changes: [string, (run: Run) => void][] = [
      ['closed', (run) => run.set.closed()],
      ['account', (run) => run.set.acting({ kind: 'anonymous' })],
      ['offline', (run) => run.set.offline()],
      ['signedOut', (run) => run.set.signedOut()],
      ['paused', (run) => run.set.paused(NOW + 60_000)],
    ];
    for (const [kind, change] of changes) {
      const run = setup({ fetchedAt: 0, readWait: 60_000 });
      const plan = planOf(await run.merging.plan(ID, SQUASH));
      // It changes while GitHub answers the read at the press.
      run.hold.reads();
      const confirming = run.merging.confirm(plan.key);
      await moment();
      change(run);
      run.release();
      expect({ kind, confirmed: await confirming, sent: run.sent }).toMatchObject({
        kind,
        confirmed: { kind: 'refused', refusal: { kind } },
        sent: [],
      });
    }
  });

  it('refuses until Lo knows where the pull request sits, and above a chain’s bottom layer', async () => {
    const unread = setup({ forest: undefined });
    expect(await unread.merging.plan(ID, SQUASH)).toEqual({
      kind: 'refused',
      why: "Lo is still listing this repository's open pull requests.",
    });
    const above = setup({
      facts: factsOf({ base: 'merge/5/chain-1' }),
      forest: forestOf('merge/5/chain-1', [
        {
          number: 137,
          state: { kind: 'open' },
          baseRef: 'main',
          baseTip: undefined,
          headRef: 'merge/5/chain-1',
          headInBaseRepo: true,
          headOid: 'e'.repeat(40),
          commits: [],
          createdAt: 0,
          nativeStack: undefined,
        },
      ]),
      fromHead: [
        {
          number: 137,
          base: { ref: 'main', repo: { full_name: 'rozed-dev/e2e' } },
          head: { ref: 'merge/5/chain-1', repo: { full_name: 'rozed-dev/e2e' } },
        },
      ],
    });
    expect(await above.merging.plan(ID, SQUASH)).toEqual({
      kind: 'refused',
      why: 'Merge #137 first: it’s this chain’s bottom layer.',
    });
  });

  it('takes a merge write to a pull request one at a time, whatever the account or the write', async () => {
    const run = setup({ submitted: () => new Promise(() => undefined) });
    const plan = planOf(await run.merging.plan(ID, SQUASH));
    expect(await run.merging.confirm(plan.key)).toEqual({ kind: 'sent' });
    // A queue's write, as another account, waits for this one.
    expect(run.turns.take(PULL.repo, [138])).toEqual({ busy: 138 });
    const second = planOf(await run.merging.plan(ID, SQUASH));
    expect(await run.merging.confirm(second.key)).toMatchObject({
      refusal: { kind: 'busy', text: 'Lo is already merging #138.' },
    });
    expect(run.sent).toHaveLength(1);
  });
});

describe('how it ends', () => {
  it('follows a merge GitHub was already running, and never sends it again', async () => {
    const run = setup({
      submitted: () =>
        Promise.resolve({
          kind: 'alreadyRunning',
          uuid: UUID,
          answer: answer('pending', { uuid: UUID, merge_method: 'merge' }),
        }),
    });
    const plan = planOf(await run.merging.plan(ID, SQUASH));
    await run.merging.confirm(plan.key);
    const done = await run.ended('merged');
    expect(done.already).toBe(true);
    expect(run.sent).toHaveLength(1);
    // GitHub merged with its own method, not the one asked for.
    expect(run.remembered).toEqual([]);
    // The turn is given back once it ended.
    expect(run.turns.busy(PULL.repo, [138])).toEqual([]);
  });

  it('can’t tell after a lost answer, sends nothing again, and settles by reading the pull request', async () => {
    const run = setup({
      submitted: () =>
        Promise.reject(
          new GithubError({ kind: 'network', failure: 'lost', message: 'read ECONNRESET' }),
        ),
    });
    const plan = planOf(await run.merging.plan(ID, SQUASH));
    await run.merging.confirm(plan.key);
    const unknown = await run.ended('unknown');
    expect(unknown.state).toMatchObject({
      why: 'noAnswer',
      askAgain: false,
      text: expect.stringContaining('GitHub’s answer didn’t reach Lo: '),
    });

    // Asked again, the pull request is read again; it's open, which settles nothing.
    run.merging.askAgain(plan.key);
    await vi.waitFor(() =>
      expect(run.published.at(-1)?.state).toMatchObject({ kind: 'unknown', shows: 'open' }),
    );
    expect(run.sent).toHaveLength(1);
  });

  it('holds the pull request after a lost answer until a read made after it ended settles it', async () => {
    const run = setup({
      submitted: () =>
        Promise.reject(
          new GithubError({ kind: 'network', failure: 'lost', message: 'read ECONNRESET' }),
        ),
    });
    const plan = planOf(await run.merging.plan(ID, SQUASH));
    // The reads made after it ended wait.
    run.hold.reads();
    await run.merging.confirm(plan.key);
    await run.ended('unknown');
    expect(run.turns.busy(PULL.repo, [138])).toEqual([138]);
    const second = planOf(await run.merging.plan(ID, SQUASH));
    expect(await run.merging.confirm(second.key)).toMatchObject({
      refusal: { kind: 'unsettled', text: 'Lo can’t tell whether #138 merged.' },
    });

    // "Ask GitHub again", which the refusal offers, is that read: once it's answered, the pull
    // request may merge again.
    run.release();
    run.merging.askAgain(second.key);
    await vi.waitFor(() => expect(run.turns.busy(PULL.repo, [138])).toEqual([]));
    expect(run.published.at(-1)?.state).toMatchObject({ kind: 'unknown', shows: 'open' });
    const third = planOf(await run.merging.plan(ID, SQUASH));
    expect(await run.merging.confirm(third.key)).toEqual({ kind: 'sent' });
    expect(run.sent).toHaveLength(2);
  });

  it('lets the pull request go once its tab, closed meanwhile, opens again and reads it', async () => {
    const run = setup({ submitted: lost });
    const plan = planOf(await run.merging.plan(ID, SQUASH));
    run.hold.reads();
    await run.merging.confirm(plan.key);
    await run.ended('unknown');
    // The tab closes, and its read goes with it, unanswered.
    run.set.tabRead(false);
    run.release();
    await moment();
    expect(run.turns.busy(PULL.repo, [138])).toEqual([138]);

    // It opens again: the read it keeps is made after the merge ended.
    run.set.tabRead(true);
    await vi.waitFor(() => expect(run.turns.busy(PULL.repo, [138])).toEqual([]));
    const again = planOf(await run.merging.plan(ID, SQUASH));
    expect(await run.merging.confirm(again.key)).toEqual({ kind: 'sent' });
    expect(run.sent).toHaveLength(2);
  });

  it('sends nothing again after a lost answer, however long Lo goes on', async () => {
    vi.useFakeTimers();
    try {
      const run = setup({ submitted: lost });
      const plan = planOf(await run.merging.plan(ID, SQUASH));
      await run.merging.confirm(plan.key);
      await run.ended('unknown');
      run.merging.askAgain(plan.key);
      // Past every wait the merge and its reads have, and the polls'.
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(run.sent).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles a lost answer as merged once a read shows it merged', async () => {
    const run = setup({
      submitted: () =>
        Promise.reject(
          new GithubError({ kind: 'api', status: 502, message: 'Bad gateway', errors: [] }),
        ),
      reread: factsOf({ state: 'MERGED' }),
    });
    const plan = planOf(await run.merging.plan(ID, SQUASH));
    // The read the plan was made from: it's that one Lo acts on.
    await run.merging.confirm(plan.key);
    await run.ended('merged');
    expect(run.sent).toHaveLength(1);
  });

  it('says a proxy that asks to sign in sent nothing', async () => {
    const run = setup({
      submitted: () =>
        Promise.reject(
          new GithubError({
            kind: 'network',
            failure: 'refused',
            message: 'Your proxy asks Lo to sign in (ERR_PROXY_AUTH_REQUESTED).',
          }),
        ),
    });
    const plan = planOf(await run.merging.plan(ID, SQUASH));
    await run.merging.confirm(plan.key);
    const done = await run.ended('refused');
    expect(done.state).toMatchObject({
      refusal: { text: expect.stringContaining('Nothing was sent.') },
    });
  });

  it('says why GitHub refused it, in the core’s words, and offers the newer push for a moved head', async () => {
    const run = setup({
      // As the poller answers GitHub's 400.
      submitted: () => Promise.resolve({ refusal: 'headMoved' }),
    });
    const plan = planOf(await run.merging.plan(ID, SQUASH));
    await run.merging.confirm(plan.key);
    const done = await run.ended('refused');
    expect(done.state).toEqual({
      kind: 'refused',
      refusal: {
        kind: 'headMoved',
        text: 'Someone pushed to the pull request since Lo showed it.',
        rules: [],
        until: null,
        newer: { from: HEAD, to: null },
      },
    });
  });
});

/** #138 waiting on `ci`, still running: what auto-merge waits for. */
const WAITING: Partial<MergeFacts['pullRequest']> = {
  mergeState: 'BLOCKED',
  checksPending: true,
  checks: [
    { kind: 'checkRun', name: 'ci', status: 'IN_PROGRESS', conclusion: undefined, url: undefined },
  ],
};

/** #138 with auto-merge on, waiting on `ci`, which the account may turn off. */
const AUTO_ON: Partial<MergeFacts['pullRequest']> = {
  ...WAITING,
  autoMerge: { method: 'SQUASH', enabledBy: 'rozed-bot' },
  viewerCanDisableAutoMerge: true,
};

describe('auto-merge', () => {
  it('goes once, as one request in the pull request’s turn, with the head on screen and the method chosen', async () => {
    const run = setup({ facts: factsOf(WAITING) });
    const plan = planOf(await run.merging.plan(ID, { ...SQUASH, asked: 'autoMerge' }));
    expect(plan).toMatchObject({ kind: 'autoMerge', method: 'SQUASH', head: HEAD, base: 'main' });
    expect(await run.merging.confirm(plan.key)).toEqual({ kind: 'sent' });
    expect(run.auto).toEqual([['on', 'PR_138', { expectedHead: HEAD, method: 'SQUASH' }]]);
    expect(await run.ended('autoMergeOn')).toMatchObject({ key: plan.key, number: 138 });
    expect(run.sent).toEqual([]);
    // Its turn is given back once GitHub answered.
    expect(run.turns.busy(PULL.repo, [138])).toEqual([]);
    expect(await run.merging.confirm(plan.key)).toMatchObject({ refusal: { kind: 'used' } });
  });

  it('on a branch with a merge queue is "Merge when ready", by the queue’s method, and may join it at once', async () => {
    const run = setup({
      facts: factsOf({ ...WAITING, base: 'e4/queued', queueRequired: true, queueMethod: 'SQUASH' }),
      // GitHub answers a queue's auto-merge with a merge commit, whatever the queue does.
      autoOn: () => Promise.resolve(autoState('MERGE', true)),
    });
    const plan = planOf(await run.merging.plan(ID, { ...SQUASH, asked: 'autoMerge' }));
    expect(plan).toMatchObject({ kind: 'whenReady', method: 'SQUASH', base: 'e4/queued' });
    await run.merging.confirm(plan.key);
    await run.ended('enqueued');
  });

  it('isn’t planned for a pull request nothing blocks: that merges as it is', async () => {
    const run = setup();
    expect(await run.merging.plan(ID, { ...SQUASH, asked: 'autoMerge' })).toEqual({
      kind: 'refused',
      why: 'Nothing blocks #138 now, so it can merge as it is.',
    });
  });

  it('that GitHub won’t turn on because it can merge now offers the merge, read again, to confirm', async () => {
    const run = setup({
      facts: factsOf(WAITING),
      reread: factsOf(),
      autoOn: () => Promise.resolve({ refusal: 'canMergeNow' }),
    });
    const plan = planOf(await run.merging.plan(ID, { ...SQUASH, asked: 'autoMerge' }));
    await run.merging.confirm(plan.key);
    const done = await run.ended('refused');
    expect(done.state).toMatchObject({
      refusal: {
        kind: 'canMergeNow',
        text: 'Nothing blocks #138 now, so GitHub didn’t turn on auto-merge. It can merge as it is.',
        offer: { kind: 'merge', method: 'SQUASH', head: HEAD },
      },
    });
    const offer = done.state.kind === 'refused' ? done.state.refusal.offer : undefined;
    expect(await run.merging.confirm(offer!.key)).toEqual({ kind: 'sent' });
    await run.ended('merged');
    expect(run.sent).toHaveLength(1);
  });

  it('refused as not allowed says so in GitHub’s words, and gives the turn back', async () => {
    const run = setup({
      facts: factsOf(WAITING),
      autoOn: () => Promise.resolve({ refusal: 'autoMergeNotAllowed' }),
    });
    await run.merging.confirm(
      planOf(await run.merging.plan(ID, { ...SQUASH, asked: 'autoMerge' })).key,
    );
    expect((await run.ended('refused')).state).toMatchObject({
      refusal: {
        kind: 'autoMergeNotAllowed',
        text: 'This repository doesn’t allow auto-merge. A maintainer turns it on in its settings.',
      },
    });
    expect(run.turns.busy(PULL.repo, [138])).toEqual([]);
  });

  it('turns off at once, asking nothing, in the pull request’s turn', async () => {
    const run = setup({ facts: factsOf(AUTO_ON) });
    expect(await run.merging.autoMergeOff(ID)).toEqual({ kind: 'sent' });
    expect(run.auto).toEqual([['off', 'PR_138', undefined]]);
    expect(await run.ended('autoMergeOff')).toMatchObject({ number: 138 });
    expect(run.turns.busy(PULL.repo, [138])).toEqual([]);
  });

  it('turned off after it joined the queue says it merges once the queue’s checks pass', async () => {
    const run = setup({
      facts: factsOf(AUTO_ON),
      autoOff: () => Promise.resolve(autoState(undefined, true)),
    });
    await run.merging.autoMergeOff(ID);
    expect((await run.ended('refused')).state).toMatchObject({
      refusal: {
        kind: 'queued',
        text: expect.stringContaining('Take it out of the queue on GitHub to stop it.'),
      },
    });
  });

  it('waits for a merge under way, and a merge waits for it', async () => {
    const run = setup({ facts: factsOf(AUTO_ON), autoOff: () => new Promise(() => undefined) });
    expect(await run.merging.autoMergeOff(ID)).toEqual({ kind: 'sent' });
    expect(run.turns.take(PULL.repo, [138])).toEqual({ busy: 138 });
    expect(await run.merging.autoMergeOff(ID)).toMatchObject({ refusal: { kind: 'busy' } });
    expect(run.auto).toHaveLength(1);
  });

  it('can’t tell after a lost answer, sends nothing again, and settles by reading the pull request', async () => {
    const run = setup({ facts: factsOf(WAITING), reread: factsOf(AUTO_ON), autoOn: lost });
    run.hold.reads();
    await run.merging.confirm(
      planOf(await run.merging.plan(ID, { ...SQUASH, asked: 'autoMerge' })).key,
    );
    expect((await run.ended('unknown')).state).toMatchObject({ why: 'noAnswer' });
    expect(run.turns.busy(PULL.repo, [138])).toEqual([138]);
    run.release();
    await run.ended('autoMergeOn');
    expect(run.turns.busy(PULL.repo, [138])).toEqual([]);
    expect(run.auto).toHaveLength(1);
  });
});

/** #138 waiting on a review GitHub requires, which the account may merge past. */
const REVIEW_OWED: Partial<MergeFacts['pullRequest']> = {
  mergeState: 'BLOCKED',
  reviewDecision: 'REVIEW_REQUIRED',
  viewerCanMergeAsAdmin: true,
};

describe('a merge past the rules', () => {
  it('goes only with the number typed, bypassing the rules, with the method chosen', async () => {
    const run = setup({ facts: factsOf(REVIEW_OWED) });
    const plan = planOf(
      await run.merging.plan(ID, {
        method: 'SQUASH',
        title: 'Typed',
        message: '',
        asked: 'override',
      }),
    );
    expect(plan).toMatchObject({ kind: 'override', method: 'SQUASH', title: 'Typed' });
    expect(await run.merging.confirm(plan.key)).toMatchObject({
      refusal: { kind: 'typed', text: 'Type 138 to merge it past the rules.' },
    });
    expect(await run.merging.confirm(plan.key, '13')).toMatchObject({ refusal: { kind: 'typed' } });
    // Not typed right, the plan stays.
    expect(await run.merging.confirm(plan.key, '138')).toEqual({ kind: 'sent' });
    expect(run.sent).toEqual([
      expect.objectContaining({
        sha: HEAD,
        method: 'SQUASH',
        commitTitle: 'Typed',
        bypassRules: true,
      }),
    ]);
    await run.ended('merged');
  });

  it('isn’t planned for an account GitHub doesn’t let bypass them', async () => {
    const run = setup({ facts: factsOf({ ...REVIEW_OWED, viewerCanMergeAsAdmin: false }) });
    expect(await run.merging.plan(ID, { ...SQUASH, asked: 'override' })).toMatchObject({
      kind: 'refused',
    });
  });
});
