// Approve and ship, with a stand-in poller, approval and merge jobs: a plan names the revision it
// approves, what it expects to follow and what that takes with it, and runs once; the press reads
// GitHub again whatever it read before, weighed as a merge's press is, and a push since stops it
// before approving; something else the confirmation named, in that read or one that lands while Lo
// asks where the pull request sits, asks again; what its merge takes with it holds its turns too;
// approving and shipping are separate steps, and a stop after approving says so; the step after it
// goes only as confirmed, from where the panel would merge; and auto-merge it turns on after your
// approval is kept for the watch.

import {
  MERGE_FACTS,
  MergeJobs,
  PullRef,
  type Cached,
  type MergeFacts,
  type PollEvent,
  type PollStatus,
  type ReadKind,
  type SinceMark,
} from '@lo/github';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Approved, SummaryKept } from '../../review/service.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { MergePlan, ShipPlan, ShipView, Together } from '../contract.ts';
import { Merging, type AutoAnswer, type Goes, type MergingPoller } from './merging.ts';
import { Shipping, type Shipped } from './ship.ts';
import { factsOf, HEAD } from './test/facts.ts';
import { MergeTurns } from './turns.ts';

const NOW = 1_800_000_000_000;
const NEWER = 'c'.repeat(40);
const ID = 'tab-1';
const REPO = new PullRef('rozed-dev', 'e2e', 138).repo;

/** #138 goes alone. */
const ALONE: Goes = { kind: 'goes', onto: (facts) => facts, together: null };

/** #138 sits on #137 in GitHub stack #7, which merges with it. */
const STACK: Together = {
  kind: 'stack',
  stack: 7,
  below: [
    { number: 137, title: 'Below', head: 'd'.repeat(40), review: 'approved', checks: 'passing' },
  ],
  above: [],
};

/** #138, opened by mira-chen, which can merge as it is: your approval goes first. */
function waiting(more: Partial<MergeFacts['pullRequest']> = {}): MergeFacts {
  return factsOf({ author: 'mira-chen', viewerDidAuthor: false, ...more });
}

/** #138 once rozed-bot's approval of `head` shows. */
function approved(more: Partial<MergeFacts['pullRequest']> = {}, head = HEAD): MergeFacts {
  return factsOf({
    author: 'mira-chen',
    viewerDidAuthor: false,
    reviews: [
      { author: 'rozed-bot', state: 'APPROVED', commit: head, authorCanPush: true, onBehalfOf: [] },
    ],
    ...more,
  });
}

interface Setup {
  /** What GitHub said last, as the poller keeps it. */
  facts?: MergeFacts;
  /** What each read afresh gets, in turn; the last again. */
  reads?: MergeFacts[];
  approve?: (id: string, head: string) => Promise<Approved>;
  summary?: SummaryKept;
  /** Where #138 sits, and what its merge takes with it, at each ask: the first, the press's, … */
  goes?: Goes | ((asked: number) => Goes);
  /** What GitHub says in a read that lands while the press asks where #138 sits. */
  landing?: MergeFacts;
  /** What sending the step after the approval comes to. */
  send?: (plan: MergePlan, heard: ((answer: AutoAnswer) => void) | undefined) => void;
}

/** #138 waiting on `ci`, which is running. */
const RUNNING: Partial<MergeFacts['pullRequest']> = {
  mergeState: 'BLOCKED',
  checksPending: true,
  checks: [
    { kind: 'checkRun', name: 'ci', status: 'IN_PROGRESS', conclusion: undefined, url: undefined },
  ],
};

/** #138 sits above #137 in a chain that isn't a GitHub stack, which the panel merges from #137. */
const CHAIN_ABOVE: Goes = {
  kind: 'where',
  why: 'Merge #137 first: it’s this chain’s bottom layer.',
  unknown: false,
};

/** GitHub's answer to turning auto-merge on is lost. */
function lostAnswer(_plan: MergePlan, heard: ((answer: AutoAnswer) => void) | undefined): void {
  heard?.('lost');
}

const made: { stop(): void }[] = [];

afterEach(() => {
  for (const each of made.splice(0)) each.stop();
  vi.useRealTimers();
});

function setup(options: Setup = {}) {
  const pull = new PullRef('rozed-dev', 'e2e', 138);
  let cached: Cached<MergeFacts> = { value: options.facts ?? waiting(), fetchedAt: NOW };
  const reads = [...(options.reads ?? [cached.value])];
  let marks = 0;
  const listeners = new Set<(event: PollEvent) => void>();
  let status: PollStatus = { rateLimit: { kind: 'normal' }, offline: undefined, signedOut: false };
  const poller = {
    login: 'rozed-bot',
    mergeFacts: () => Promise.resolve(cached),
    cachedRead<T>(_pull: PullRef, kind: ReadKind<T>): Cached<T> | undefined {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what MERGE_FACTS reads.
      return kind.name === MERGE_FACTS.name ? (cached as Cached<T>) : undefined;
    },
    readAfresh() {
      marks += 1;
      const next = reads.length > 1 ? reads.shift()! : reads[0]!;
      cached = { value: next, fetchedAt: NOW };
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({ kind: 'read', pull, name: MERGE_FACTS.name });
        }
      });
      return { read: 1, generation: marks };
    },
    readSince<T>(): SinceMark<Cached<T>> {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what MERGE_FACTS reads.
      return { kind: 'read', read: cached as Cached<T> };
    },
    readMergeFactsAgain: () => undefined,
    onEvent(listener: (event: PollEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status: () => status,
    writesHeldUntil: () => undefined,
  };
  let view: PullTabInfo = {
    id: ID,
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number: 138,
    acting: { kind: 'account', login: 'rozed-bot' },
    head: { fork: null },
    shown: HEAD,
    latest: HEAD,
    provisional: false,
    local: { kind: 'waiting' },
    compareFrom: undefined,
    drawn: true,
    run: undefined,
  };
  let onScreen = HEAD;
  let converting: number[] = [];
  const turns = new MergeTurns();
  const approvals: [string, string][] = [];
  const sent: MergePlan[] = [];
  const kept: Shipped[] = [];
  const heardKept: AutoAnswer[] = [];
  const published: ShipView[] = [];
  let keys = 0;
  let asked = 0;
  const jobs = new MergeJobs({ firstWait: 1, maxWait: 1 });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only these are used.
  const given = poller as unknown as MergingPoller;
  const merging = new Merging({
    poller: () => Promise.resolve(given),
    view: (id) => (id === ID ? view : undefined),
    headOnScreen: () => onScreen,
    headContainsBase: () => undefined,
    method: () => 'SQUASH',
    remember: () => undefined,
    forest: () => undefined,
    converting: () => undefined,
    turns,
    jobs,
    publish: () => undefined,
    log: () => undefined,
    now: () => Date.now(),
    readWait: 50,
  });
  made.push(jobs, merging);
  const shipping = new Shipping({
    poller: () => Promise.resolve(given),
    view: (id) => (id === ID ? view : undefined),
    headOnScreen: () => onScreen,
    headContainsBase: () => undefined,
    method: () => 'SQUASH',
    converting: () => (converting.length > 0 ? { kind: 'running', prs: converting } : undefined),
    turns,
    merging: {
      weigh: merging.weigh.bind(merging),
      goesAs() {
        asked += 1;
        // The press asks second.
        if (asked === 2 && options.landing) cached = { value: options.landing, fetchedAt: NOW };
        const goes = options.goes ?? ALONE;
        return Promise.resolve(typeof goes === 'function' ? goes(asked) : goes);
      },
      sendShipped(merge, _pull, _poller, turn, heard) {
        turn.give();
        sent.push(merge);
        options.send?.(merge, heard);
        return { kind: 'sent' };
      },
    },
    summary: () => options.summary ?? 'none',
    approve(id, head) {
      approvals.push([id, head]);
      return options.approve?.(id, head) ?? Promise.resolve({ kind: 'approved' });
    },
    keep(shipped) {
      kept.push(shipped);
      return (answer) => heardKept.push(answer);
    },
    publish: (each) => published.push(each),
    log: () => undefined,
    now: () => Date.now(),
    newKey: () => `key-${++keys}`,
    readWait: 50,
    showWait: 30,
    showEvery: 1,
  });
  made.push(shipping);
  /** Plans for #138, as `⌘⇧⏎` asks. */
  async function plan(): Promise<ShipPlan> {
    const planned = await shipping.plan(ID);
    if (planned.kind !== 'plan') throw new Error(planned.refusal.text);
    return planned.plan;
  }
  /** How the last run stands, once it's done what it does now. */
  async function settled(): Promise<ShipView | undefined> {
    await vi.waitFor(() => {
      const phase = published.at(-1)?.phase.kind;
      if (phase !== 'sending' && phase !== 'done' && phase !== 'stopped') {
        throw new Error('still running');
      }
    });
    return published.at(-1);
  }
  return {
    shipping,
    turns,
    approvals,
    sent,
    kept,
    heardKept,
    published,
    plan,
    settled,
    marks: () => marks,
    set: {
      onScreen: (head: string) => {
        onScreen = head;
      },
      latest: (head: string) => {
        view = { ...view, latest: head };
      },
      offline: () => {
        status = { ...status, offline: { error: 'down', since: NOW, retryAt: NOW } };
      },
      converting: (prs: number[]) => {
        converting = prs;
      },
    },
  };
}

describe('the plan', () => {
  it('names the revision it approves, the summary that goes with it, and what follows', async () => {
    const { plan } = setup({ summary: 'text' });
    await expect(plan()).resolves.toMatchObject({
      number: 138,
      login: 'rozed-bot',
      head: HEAD,
      approval: { kind: 'approve' },
      summary: true,
      likely: { kind: 'merge', method: 'SQUASH' },
      base: 'main',
    });
  });

  it('approves nothing on your own pull request', async () => {
    const { plan } = setup({ facts: factsOf() });
    await expect(plan()).resolves.toMatchObject({
      approval: { kind: 'ownPullRequest' },
      summary: false,
      likely: { kind: 'merge' },
    });
  });

  it('refuses a newer push than the one on screen, naming both, before anything is sent', async () => {
    const { shipping, approvals } = setup({ facts: waiting({ head: NEWER }) });
    await expect(shipping.plan(ID)).resolves.toMatchObject({
      kind: 'refused',
      refusal: { kind: 'headMoved', newer: { from: HEAD, to: NEWER } },
    });
    expect(approvals).toEqual([]);
  });

  it('refuses a draft, and a summary with a file that may not be in yet', async () => {
    await expect(
      setup({ facts: waiting({ draft: true }) }).shipping.plan(ID),
    ).resolves.toMatchObject({
      refusal: { kind: 'draft' },
    });
    await expect(setup({ summary: 'uploading' }).shipping.plan(ID)).resolves.toMatchObject({
      refusal: { kind: 'uploading' },
    });
  });

  it('refuses, approving nothing, while Lo can’t tell where the pull request sits', async () => {
    const { shipping } = setup({ goes: { kind: 'where', why: 'Lo can’t tell.', unknown: true } });
    await expect(shipping.plan(ID)).resolves.toMatchObject({
      kind: 'refused',
      refusal: { kind: 'where', text: 'Lo can’t tell.' },
    });
  });

  it('stops after approving where the merge panel wouldn’t merge from, and warns of nothing', async () => {
    const { plan } = setup({ goes: CHAIN_ABOVE });
    await expect(plan()).resolves.toMatchObject({
      likely: { kind: 'stop', stop: { kind: 'where', text: expect.stringContaining('#137') } },
      together: null,
      warning: false,
    });
  });

  it('names what its merge takes with it: a GitHub stack’s layers below', async () => {
    const { plan } = setup({ goes: { ...ALONE, together: STACK } });
    await expect(plan()).resolves.toMatchObject({ likely: { kind: 'merge' }, together: STACK });
  });

  it('leaves a chain’s bottom layer that moves onto the root before it merges to the panel', async () => {
    const { plan } = setup({
      goes: {
        ...ALONE,
        together: {
          kind: 'chain',
          before: { pr: 138, from: 'e1/base', to: 'main' },
          after: [],
          needsRebase: [],
        },
      },
    });
    await expect(plan()).resolves.toMatchObject({
      likely: { kind: 'stop', stop: { kind: 'where', text: expect.stringContaining('onto main') } },
      together: null,
    });
  });
});

describe('the press', () => {
  it('reads GitHub again whatever it read before, and a push since approves nothing', async () => {
    const { shipping, plan, marks, approvals, turns } = setup({
      reads: [waiting({ head: NEWER })],
    });
    const { key } = await plan();
    const before = marks();
    await expect(shipping.confirm(key)).resolves.toMatchObject({
      kind: 'refused',
      refusal: { kind: 'headMoved', newer: { from: HEAD, to: NEWER } },
    });
    expect(marks()).toBe(before + 1);
    expect(approvals).toEqual([]);
    expect(turns.busy(new PullRef('rozed-dev', 'e2e', 138).repo, [138])).toEqual([]);
  });

  it('asks again when something the confirmation named changed, and the new plan runs', async () => {
    const { shipping, plan, approvals } = setup({
      reads: [approved(), approved()],
      facts: waiting(),
    });
    const first = await plan();
    const again = await shipping.confirm(first.key);
    expect(again).toMatchObject({ kind: 'again', plan: { approval: { kind: 'alreadyApproved' } } });
    expect(approvals).toEqual([]);
    if (again.kind !== 'again') return;
    await expect(shipping.confirm(again.plan.key)).resolves.toEqual({ kind: 'started' });
  });

  it('plans from a read that lands while it asks where the pull request sits', async () => {
    const { shipping, plan, approvals } = setup({ landing: approved() });
    const first = await plan();
    await expect(shipping.confirm(first.key)).resolves.toMatchObject({
      kind: 'again',
      plan: { approval: { kind: 'alreadyApproved' } },
    });
    expect(approvals).toEqual([]);
  });

  it('asks again when what its merge takes with it changed', async () => {
    const { shipping, plan, approvals } = setup({
      goes: (asked) => (asked === 1 ? ALONE : { ...ALONE, together: STACK }),
    });
    await expect(shipping.confirm((await plan()).key)).resolves.toMatchObject({
      kind: 'again',
      plan: { together: STACK },
      why: expect.stringContaining('The layers that merge with it changed.'),
    });
    expect(approvals).toEqual([]);
  });

  it('holds the turns of a stack’s layers that merge with it, and refuses while one is busy or converting', async () => {
    const busy = setup({ goes: { ...ALONE, together: STACK } });
    const held = busy.turns.take(REPO, [137]);
    await expect(busy.shipping.confirm((await busy.plan()).key)).resolves.toMatchObject({
      refusal: { kind: 'busy', text: 'Lo is already merging #137.' },
    });
    if (!('busy' in held)) held.give();
    const converting = setup({ goes: { ...ALONE, together: STACK } });
    converting.set.converting([137]);
    await expect(converting.shipping.confirm((await converting.plan()).key)).resolves.toMatchObject(
      { refusal: { kind: 'converting' } },
    );
    let answer: ((approved: Approved) => void) | undefined;
    const running = setup({
      goes: { ...ALONE, together: STACK },
      approve: () => new Promise((resolve) => (answer = resolve)),
    });
    await expect(running.shipping.confirm((await running.plan()).key)).resolves.toEqual({
      kind: 'started',
    });
    expect(running.turns.busy(REPO, [137, 138])).toEqual([137, 138]);
    answer?.({ kind: 'refused', why: 'No.' });
    await running.settled();
    expect(running.turns.busy(REPO, [137, 138])).toEqual([]);
    for (const each of [busy, converting]) expect(each.approvals).toEqual([]);
  });

  it('runs a plan once', async () => {
    const { shipping, plan, settled } = setup({ reads: [waiting(), approved()] });
    const { key } = await plan();
    await expect(shipping.confirm(key)).resolves.toEqual({ kind: 'started' });
    await settled();
    await expect(shipping.confirm(key)).resolves.toMatchObject({ refusal: { kind: 'used' } });
  });

  it('refuses while another merge write runs on the pull request, offline, or with another revision on screen', async () => {
    const busy = setup();
    const held = busy.turns.take(new PullRef('rozed-dev', 'e2e', 138).repo, [138]);
    await expect(busy.shipping.confirm((await busy.plan()).key)).resolves.toMatchObject({
      refusal: { kind: 'busy' },
    });
    if (!('busy' in held)) held.give();
    const offline = setup();
    const offlineKey = (await offline.plan()).key;
    offline.set.offline();
    await expect(offline.shipping.confirm(offlineKey)).resolves.toMatchObject({
      refusal: { kind: 'offline' },
    });
    const screen = setup();
    const screenKey = (await screen.plan()).key;
    screen.set.onScreen(NEWER);
    await expect(screen.shipping.confirm(screenKey)).resolves.toMatchObject({
      refusal: { kind: 'screen' },
    });
    const newer = setup();
    const newerKey = (await newer.plan()).key;
    newer.set.latest(NEWER);
    await expect(newer.shipping.confirm(newerKey)).resolves.toMatchObject({
      refusal: { kind: 'headMoved', newer: { from: HEAD, to: NEWER } },
    });
    for (const each of [busy, offline, screen, newer]) expect(each.approvals).toEqual([]);
  });
});

describe('running', () => {
  it('approves the revision on screen, then merges it as confirmed once GitHub shows the approval', async () => {
    const { shipping, plan, settled, approvals, sent, published, kept } = setup({
      reads: [waiting(), waiting(), approved()],
    });
    const { key } = await plan();
    await shipping.confirm(key);
    await expect(settled()).resolves.toMatchObject({
      approved: true,
      phase: { kind: 'sending', step: { kind: 'merge', method: 'SQUASH' } },
    });
    expect(approvals).toEqual([[ID, HEAD]]);
    expect(sent).toEqual([
      expect.objectContaining({ kind: 'merge', method: 'SQUASH', head: HEAD, number: 138 }),
    ]);
    expect(published.map((each) => each.phase.kind)).toEqual([
      'approving',
      'approving',
      'reading',
      'sending',
    ]);
    expect(kept).toEqual([]);
  });

  it('stops before approving when the approval finds a newer push, and sends nothing more', async () => {
    const { shipping, plan, settled, sent } = setup({
      approve: () => Promise.resolve({ kind: 'moved', head: NEWER }),
    });
    await shipping.confirm((await plan()).key);
    await expect(settled()).resolves.toMatchObject({
      approved: false,
      phase: { kind: 'stopped', at: 'approve', refusal: { newer: { from: HEAD, to: NEWER } } },
    });
    expect(sent).toEqual([]);
  });

  it('stops before approving when the approval is refused, or Lo can’t tell whether it went', async () => {
    for (const answer of [
      { kind: 'refused', why: 'No.' },
      { kind: 'unknown', why: 'Lost.' },
    ] as const) {
      const { shipping, plan, settled, sent } = setup({ approve: () => Promise.resolve(answer) });
      await shipping.confirm((await plan()).key);
      await expect(settled()).resolves.toMatchObject({
        approved: false,
        phase: { kind: 'stopped', at: 'approve' },
      });
      expect(sent).toEqual([]);
    }
  });

  it('stops after approving, saying so, when GitHub then allows other than what was confirmed', async () => {
    // A check started after the approval: merging now would be auto-merge, which wasn't confirmed.
    const pending = approved(RUNNING);
    const { shipping, plan, settled, sent } = setup({ reads: [waiting(), pending] });
    await shipping.confirm((await plan()).key);
    await expect(settled()).resolves.toMatchObject({
      approved: true,
      phase: { kind: 'stopped', at: 'ship', refusal: { kind: 'notAsked' } },
    });
    expect(sent).toEqual([]);
  });

  it('stops after approving where the merge panel wouldn’t merge from', async () => {
    const { shipping, plan, settled, sent, approvals } = setup({
      reads: [waiting(), approved()],
      goes: CHAIN_ABOVE,
    });
    await shipping.confirm((await plan()).key);
    await expect(settled()).resolves.toMatchObject({
      approved: true,
      phase: { kind: 'stopped', at: 'ship', stop: { kind: 'where' } },
    });
    expect(approvals).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  it('merges a stack’s layers below with it, as confirmed', async () => {
    const { shipping, plan, settled, sent } = setup({
      reads: [waiting(), approved()],
      goes: { ...ALONE, together: STACK },
    });
    await shipping.confirm((await plan()).key);
    await expect(settled()).resolves.toMatchObject({ phase: { kind: 'sending' } });
    expect(sent).toEqual([expect.objectContaining({ kind: 'merge', together: STACK })]);
  });

  it('stops after approving when what its merge takes with it changed since', async () => {
    const { shipping, plan, settled, sent } = setup({
      reads: [waiting(), approved()],
      goes: (asked) => (asked <= 2 ? ALONE : { ...ALONE, together: STACK }),
    });
    await shipping.confirm((await plan()).key);
    await expect(settled()).resolves.toMatchObject({
      approved: true,
      phase: { kind: 'stopped', at: 'ship', refusal: { kind: 'together' } },
    });
    expect(sent).toEqual([]);
  });

  it('stops after approving when GitHub doesn’t show the approval in time', async () => {
    const { shipping, plan, settled, sent } = setup({ reads: [waiting()] });
    await shipping.confirm((await plan()).key);
    await expect(settled()).resolves.toMatchObject({
      approved: true,
      phase: { kind: 'stopped', at: 'ship', refusal: { kind: 'notShown' } },
    });
    expect(sent).toEqual([]);
  });
});

describe('auto-merge', () => {
  const running = RUNNING;

  it('turned on after your approval is kept for the watch, with the head approved and the method', async () => {
    const facts = waiting(running);
    const { shipping, plan, settled, sent, kept, heardKept } = setup({
      facts,
      reads: [facts, approved(running)],
      send: lostAnswer,
    });
    const confirmed = await plan();
    expect(confirmed).toMatchObject({ likely: { kind: 'autoMerge' }, warning: true });
    await shipping.confirm(confirmed.key);
    await expect(settled()).resolves.toMatchObject({ phase: { kind: 'sending' } });
    expect(sent).toEqual([expect.objectContaining({ kind: 'autoMerge', method: 'SQUASH' })]);
    expect(kept).toEqual([
      expect.objectContaining({ login: 'rozed-bot', head: HEAD, base: 'main', method: 'SQUASH' }),
    ]);
    expect(heardKept).toEqual(['lost']);
  });

  it('on your own pull request isn’t kept: no approval of yours can merge a push', async () => {
    const facts = factsOf(running);
    const { shipping, plan, settled, sent, kept } = setup({ facts, reads: [facts] });
    await shipping.confirm((await plan()).key);
    await settled();
    expect(sent).toEqual([expect.objectContaining({ kind: 'autoMerge' })]);
    expect(kept).toEqual([]);
  });

  it('refused since it can merge now, merges instead, once, as confirmed', async () => {
    const facts = factsOf(running);
    let first = true;
    const { shipping, plan, sent, published } = setup({
      facts,
      reads: [facts, factsOf()],
      send(_plan, heard) {
        if (!first) return;
        first = false;
        heard?.({ refused: { refusal: 'canMergeNow' } });
      },
    });
    await shipping.confirm((await plan()).key);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((each) => each.kind)).toEqual(['autoMerge', 'merge']);
    await vi.waitFor(() =>
      expect(published.at(-1)?.phase).toMatchObject({ kind: 'sending', step: { kind: 'merge' } }),
    );
  });
});
