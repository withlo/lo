// Changing a merge queue from its tab: `x` and `J` are planned from a read of the queue no older than
// 40 s, and checked again as they're confirmed, each in the turns of the pull requests it changes,
// sent once; a stack's layer goes out from its bottom and doesn't move alone; `J` is an admin's; and
// `a` turns auto-merge off at once for one waiting to join. An answer that may be lost holds the
// turns until a read after it, and nothing is sent again.

import {
  GithubError,
  type AutoMergeState,
  type Dequeued,
  type GithubClient,
  type Jumped,
  type MergeRefusal,
  type QueueEntryFacts,
  type QueueView,
  type QueueWaiting,
  RepoRef,
} from '@lo/github';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MergeTurn, MergeWrites } from '../../merge/service.ts';
import type { Converting } from '../../stacks/service.ts';
import type { QueueTab } from '../../tab/contract.ts';
import type { ActPlan } from '../contract.ts';
import { ACT_WITHIN, QueueActs, type ActPoller, type ActWatch } from './acts.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

const TAB: QueueTab = {
  id: 'q',
  kind: 'queue',
  owner: 'rozed-dev',
  repo: 'e2e',
  branch: 'e4/queued',
  login: 'rozed-bot',
};

const HEAD = 'a'.repeat(40);

const REPO = new RepoRef('rozed-dev', 'e2e');

function entry(position: number, number: number, head = HEAD): QueueEntryFacts {
  return {
    id: `entry-${number}`,
    position,
    state: 'AWAITING_CHECKS',
    enqueuedAt: '2026-11-19T12:00:00Z',
    estimate: undefined,
    jump: false,
    solo: false,
    enqueuer: 'rozed-bot',
    base: undefined,
    tested: undefined,
    checks: [],
    pullRequest: {
      id: `PR_${number}`,
      number,
      title: `Fixture M9: ${number}`,
      url: `https://github.com/rozed-dev/e2e/pull/${number}`,
      head,
      author: 'rozed-bot',
      viewerDidAuthor: true,
    },
  };
}

function viewOf(
  entries: readonly QueueEntryFacts[],
  extra: { permission?: string; total?: number; branch?: string } = {},
): QueueView {
  return {
    branch: extra.branch ?? 'e4/queued',
    viewerPermission: extra.permission ?? 'ADMIN',
    queue: {
      url: 'https://github.com/rozed-dev/e2e/queue/e4/queued',
      nextEstimate: undefined,
      settings: undefined,
      entries: [...entries],
      total: extra.total ?? entries.length,
    },
    leftOut: [],
  };
}

function waitingOf(
  pulls: { number: number; inQueue?: boolean; autoMerge?: boolean }[],
): QueueWaiting {
  return {
    branch: 'e4/queued',
    pullRequests: pulls.map(({ number, inQueue = false, autoMerge = true }) => ({
      id: `PR_${number}`,
      number,
      title: `Fixture M9: ${number}`,
      url: `https://github.com/rozed-dev/e2e/pull/${number}`,
      head: HEAD,
      inQueue,
      author: 'rozed-bot',
      viewerDidAuthor: true,
      reviewDecision: undefined,
      checks: 'PENDING',
      autoMerge: autoMerge
        ? { method: 'MERGE', enabledBy: 'rozed-bot', enabledAt: undefined }
        : undefined,
    })),
    total: pulls.length,
    leftOut: [],
  };
}

/** A GitHub stack holding `numbers`, bottom up, every one open, as the Stacks API lists it. */
function stackOf(number: number, numbers: readonly number[]): unknown {
  return {
    number,
    node_id: `S_${number}`,
    base: { ref: 'e4/queued' },
    open: true,
    pull_requests: numbers.map((each) => ({
      number: each,
      state: 'open',
      draft: false,
      merged_at: null,
      head: { ref: `merge/9/${each}`, sha: HEAD },
    })),
  };
}

/** What a merge queue's tab reads, as a test sets it. */
class FakeWatch implements ActWatch {
  branch = 'e4/queued';
  away: string | undefined;
  view: QueueView | string = viewOf([entry(1, 259), entry(2, 260)]);
  waiting: QueueWaiting | string = waitingOf([{ number: 258 }]);
  readonly asked: { kind: 'queue' | 'waiting'; within: number; since: number | undefined }[] = [];
  /** Runs as the queue is read, before it answers. */
  onFresh: (() => void) | undefined;
  /** Runs as those waiting to join are read, before they answer. */
  onWaiting: (() => void) | undefined;

  fresh(within: number, since?: number): Promise<QueueView | string> {
    this.asked.push({ kind: 'queue', within, since });
    this.onFresh?.();
    return Promise.resolve(this.view);
  }

  freshWaiting(within: number, since?: number): Promise<QueueWaiting | string> {
    this.asked.push({ kind: 'waiting', within, since });
    this.onWaiting?.();
    return Promise.resolve(this.waiting);
  }
}

/** An answer a test makes as it's asked for, such as one it holds back. */
class Later<T> {
  readonly run: () => Promise<T>;

  constructor(run: () => Promise<T>) {
    this.run = run;
  }
}

type Answer<T> = T | Error | Later<T>;

function answered<T>(answer: Answer<T>): Promise<T> {
  if (answer instanceof Error) return Promise.reject(answer);
  if (answer instanceof Later) return answer.run();
  return Promise.resolve(answer);
}

/** An account's poller, as a test sets it, saying what it was asked to send. */
class FakePoller implements ActPoller {
  offline = false;
  signedOut = false;
  heldUntil: number | undefined;
  /** The Stacks API's answer for the pull request asked about: none holds it, unless set. */
  stacks: unknown[] | Error = [];
  /** Runs as the Stacks API is asked. */
  onRead: (() => void) | undefined;
  dequeued: Answer<Dequeued | MergeRefusal> = { entry: undefined };
  jumped: Answer<Jumped | MergeRefusal> = {
    kind: 'moved',
    entry: {
      id: 'e',
      number: 260,
      position: 1,
      state: 'QUEUED',
      jump: true,
      solo: false,
      head: HEAD,
      estimatedTimeToMerge: undefined,
    },
  };
  turnedOff: Answer<AutoMergeState | MergeRefusal> = {
    number: 258,
    head: HEAD,
    autoMerge: undefined,
    inQueue: false,
  };
  readonly sent: unknown[][] = [];

  status() {
    return {
      offline: this.offline
        ? { since: 0, retryAt: 0, error: 'GitHub can’t be reached.' }
        : undefined,
      signedOut: this.signedOut,
    };
  }

  writesHeldUntil(): number | undefined {
    return this.heldUntil;
  }

  readOnce<T>(request: (client: GithubClient) => Promise<T>): Promise<T> {
    this.onRead?.();
    const { stacks } = this;
    const client = {
      get: (_path: string, read: (json: unknown) => unknown) =>
        stacks instanceof Error ? Promise.reject(stacks) : Promise.resolve(read(stacks)),
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only `get` is used.
    return request(client as unknown as GithubClient);
  }

  dequeue(
    pull: { number: number },
    pullRequestId: string,
    branch: string,
    above: readonly number[],
  ): Promise<Dequeued | MergeRefusal> {
    this.sent.push(['dequeue', pull.number, pullRequestId, branch, [...above]]);
    return answered(this.dequeued);
  }

  jump(
    pull: { number: number },
    pullRequestId: string,
    expectedHead: string,
  ): Promise<Jumped | MergeRefusal> {
    this.sent.push(['jump', pull.number, pullRequestId, expectedHead]);
    return answered(this.jumped);
  }

  disableAutoMerge(
    pull: { number: number },
    pullRequestId: string,
  ): Promise<AutoMergeState | MergeRefusal> {
    this.sent.push(['disableAutoMerge', pull.number, pullRequestId]);
    return answered(this.turnedOff);
  }
}

/** The turns of merge writes, as `merge.writes` hands them out. */
class FakeWrites implements MergeWrites {
  readonly taken = new Set<number>();

  take(_repo: RepoRef, prs: readonly number[]): MergeTurn | { readonly busy: number } {
    const busy = prs.find((pr) => this.taken.has(pr));
    if (busy !== undefined) return { busy };
    for (const pr of prs) this.taken.add(pr);
    return {
      give: () => {
        for (const pr of prs) this.taken.delete(pr);
      },
    };
  }

  busy(_repo: RepoRef, prs: readonly number[]): readonly number[] {
    return prs.filter((pr) => this.taken.has(pr));
  }
}

function setup() {
  const watch = new FakeWatch();
  const poller = new FakePoller();
  const writes = new FakeWrites();
  const state = {
    open: true,
    converting: undefined as Converting | undefined,
    /** Whether Lo has the tab's account. */
    account: true,
    /** How a read apart from the tab answers: it does, unless set. */
    readBranch: undefined as Error | undefined,
    /** The reads apart from the tab, in order. */
    reads: [] as { branch: string; kind: string }[],
  };
  let keys = 0;
  const acts = new QueueActs({
    tab: (id) => (state.open && id === TAB.id ? { tab: TAB, watch } : undefined),
    poller: () =>
      state.account
        ? Promise.resolve(poller)
        : Promise.reject(new Error('Lo has no account rozed-bot.')),
    writes,
    converting: () => state.converting,
    readBranch: (_on, branch, kind) => {
      state.reads.push({ branch, kind });
      return state.readBranch ? Promise.reject(state.readBranch) : Promise.resolve();
    },
    log: () => undefined,
    newKey: () => `00000000-0000-0000-0000-${String(++keys).padStart(12, '0')}`,
  });
  return { acts, watch, poller, writes, state };
}

/** The plan `kind` gives for `number`, which the test expects there to be. */
async function planned(
  acts: QueueActs,
  number: number,
  kind: ActPlan['kind'] = 'remove',
): Promise<ActPlan> {
  const answer = await acts.plan(TAB.id, number, kind);
  if (answer.kind !== 'plan') throw new Error(`expected a plan, got ${JSON.stringify(answer)}`);
  return answer.plan;
}

/** A lost answer, as GitHub's client says it: GitHub may have done it. */
const LOST_DETAIL = {
  kind: 'network',
  failure: 'lost',
  message: 'The connection closed.',
} as const;

/** A lost answer: GitHub may have done it. */
const LOST = new GithubError(LOST_DETAIL);

describe('planning a change to the queue', () => {
  it('plans taking an entry out from a read no older than 40 s, naming who, where and what', async () => {
    const { acts, watch } = setup();
    expect(await acts.plan(TAB.id, 260, 'remove')).toEqual({
      kind: 'plan',
      plan: {
        key: '00000000-0000-0000-0000-000000000001',
        id: 'q',
        owner: 'rozed-dev',
        repo: 'e2e',
        branch: 'e4/queued',
        login: 'rozed-bot',
        kind: 'remove',
        number: 260,
        title: 'Fixture M9: 260',
        position: 2,
        head: HEAD,
        stack: null,
        above: [],
      },
    });
    expect(watch.asked).toEqual([{ kind: 'queue', within: ACT_WITHIN, since: undefined }]);
  });

  it('asks nothing while the account is away, offline, signed out or held off', async () => {
    const { acts, watch, poller } = setup();
    watch.away = 'rozed-bot is signed out.';
    expect(await acts.plan(TAB.id, 260, 'remove')).toEqual({
      kind: 'refused',
      why: watch.away,
      next: 'signIn',
    });
    watch.away = undefined;
    poller.offline = true;
    expect(await acts.plan(TAB.id, 260, 'remove')).toMatchObject({
      kind: 'refused',
      why: 'Offline.',
    });
    poller.offline = false;
    poller.signedOut = true;
    expect(await acts.plan(TAB.id, 260, 'remove')).toMatchObject({
      why: expect.stringContaining('signed out') as unknown,
    });
    poller.signedOut = false;
    poller.heldUntil = new Date(2026, 10, 19, 14, 5).getTime();
    expect(await acts.plan(TAB.id, 260, 'jump')).toMatchObject({
      why: 'GitHub’s rate limit resets at 14:05.',
      next: 'none',
    });
    expect(watch.asked).toEqual([]);
  });

  it('asks nothing on a read of the queue that failed, with what failed behind Details', async () => {
    const { acts, watch } = setup();
    watch.view = 'GitHub couldn’t be reached';
    expect(await acts.plan(TAB.id, 260, 'remove')).toEqual({
      kind: 'refused',
      why: '',
      details: 'GitHub couldn’t be reached',
      checking: true,
    });
  });

  it('refuses an entry the queue no longer lists, or may not list', async () => {
    const { acts, watch } = setup();
    expect(await acts.plan(TAB.id, 261, 'remove')).toEqual({
      kind: 'refused',
      why: '#261 left the merge queue.',
      next: 'gone',
    });
    watch.view = viewOf([entry(1, 259)], { total: 150 });
    expect(await acts.plan(TAB.id, 261, 'remove')).toMatchObject({
      why: 'GitHub left part of the queue out.',
    });
  });

  it('moves to the front only for the repository’s admins', async () => {
    const { acts, watch } = setup();
    watch.view = viewOf([entry(1, 259), entry(2, 260)], { permission: 'WRITE' });
    expect(await acts.plan(TAB.id, 260, 'jump')).toEqual({
      kind: 'refused',
      why: 'rozed-bot doesn’t have permission.',
      next: 'none',
    });
    expect((await planned(acts, 260, 'remove')).kind).toBe('remove');
  });

  it('doesn’t move the entry at the front to the front', async () => {
    const { acts } = setup();
    expect(await acts.plan(TAB.id, 259, 'jump')).toEqual({
      kind: 'refused',
      why: '#259 is already at the front.',
      next: 'none',
    });
    expect((await planned(acts, 259, 'remove')).kind).toBe('remove');
  });

  it('takes a GitHub stack out from its bottom layer, naming the layers above that leave with it', async () => {
    const { acts, watch, poller } = setup();
    watch.view = viewOf([entry(1, 251), entry(2, 252)]);
    poller.stacks = [stackOf(263, [251, 252, 253])];
    expect(await acts.plan(TAB.id, 252, 'remove')).toEqual({
      kind: 'refused',
      why: 'Remove the bottom layer, #251, instead',
      next: 'none',
    });
    // #253, open but not in the queue, stays.
    expect(await planned(acts, 251)).toMatchObject({ stack: 263, above: [252] });
    // A read that may not list every entry may leave out one that's queued.
    watch.view = viewOf([entry(1, 251), entry(2, 252)], { total: 120 });
    expect(await planned(acts, 251)).toMatchObject({ above: [252, 253] });
  });

  it('moves no layer of a GitHub stack with other open layers to the front', async () => {
    const { acts, poller } = setup();
    poller.stacks = [stackOf(263, [259, 260])];
    expect(await acts.plan(TAB.id, 260, 'jump')).toEqual({
      kind: 'refused',
      why: 'GitHub queues a stack’s layers in order',
      next: 'none',
    });
    // A stack with no other open layer holds nothing back.
    poller.stacks = [stackOf(263, [260])];
    expect(await planned(acts, 260, 'jump')).toMatchObject({ stack: null });
  });

  it('asks nothing of an entry whose head Lo hasn’t read whole, or of a tab that moved on as it read', async () => {
    const { acts, watch, poller } = setup();
    watch.view = viewOf([entry(1, 259), entry(2, 260, 'abc')]);
    expect(await acts.plan(TAB.id, 260, 'remove')).toMatchObject({
      kind: 'refused',
      why: '',
      checking: true,
    });
    watch.view = viewOf([entry(1, 259), entry(2, 260)]);
    poller.onRead = () => {
      watch.branch = 'main';
    };
    expect(await acts.plan(TAB.id, 260, 'remove')).toMatchObject({
      why: 'The queue has changed.',
    });
  });

  it('asks nothing when it can’t read the pull request’s GitHub stack', async () => {
    const { acts, poller } = setup();
    poller.stacks = new GithubError({
      kind: 'api',
      status: 502,
      message: 'Bad gateway',
      errors: [],
    });
    expect(await acts.plan(TAB.id, 260, 'remove')).toMatchObject({
      kind: 'refused',
      why: 'GitHub returned an error.',
      details: expect.any(String) as unknown,
      checking: true,
    });
  });

  it('asks nothing while another merge write to it, or to a layer that leaves with it, is under way', async () => {
    const { acts, watch, poller, writes } = setup();
    writes.taken.add(260);
    expect(await acts.plan(TAB.id, 260, 'jump')).toEqual({
      kind: 'refused',
      why: '#260 is still merging.',
    });
    watch.view = viewOf([entry(1, 251), entry(2, 252)]);
    poller.stacks = [stackOf(263, [251, 252])];
    writes.taken.add(252);
    expect(await acts.plan(TAB.id, 251, 'remove')).toMatchObject({
      why: '#252 is still merging.',
    });
  });
});

describe('confirming a change to the queue', () => {
  it('sends it once, in the turns of what it changes, given back once GitHub answered', async () => {
    const { acts, poller, writes } = setup();
    const plan = await planned(acts, 260);
    let release: (() => void) | undefined;
    poller.dequeued = new Later(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ entry: undefined });
        }),
    );
    const confirming = acts.confirm(plan.key);
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.busy(REPO, [260])).toEqual([260]);
    release?.();
    expect(await confirming).toEqual({ kind: 'removed', numbers: [260] });
    expect(poller.sent).toEqual([['dequeue', 260, 'PR_260', 'e4/queued', []]]);
    expect(writes.taken.size).toBe(0);
    // Confirmed again, it was asked by a press the dialog no longer shows: it closes.
    expect(await acts.confirm(plan.key)).toEqual({ kind: 'refused', why: '', next: 'gone' });
    expect(poller.sent).toHaveLength(1);
  });

  it('keeps a tab’s last question only', async () => {
    const { acts, poller } = setup();
    const first = await planned(acts, 259);
    const second = await planned(acts, 260, 'jump');
    expect(await acts.confirm(first.key)).toMatchObject({
      kind: 'refused',
      why: 'The queue has changed.',
    });
    expect(await acts.confirm(second.key)).toEqual({ kind: 'moved', position: 1 });
    expect(poller.sent).toEqual([['jump', 260, 'PR_260', HEAD]]);
  });

  it('acts on a read of the queue no older than 40 s, or made since its last change ended', async () => {
    const { acts, watch } = setup();
    await acts.confirm((await planned(acts, 260)).key);
    watch.asked.length = 0;
    await planned(acts, 259);
    // The read after the change, and the plan's own.
    expect(watch.asked).toContainEqual({ kind: 'queue', within: ACT_WITHIN, since: 1_000_000 });
  });

  it('sends nothing when the entry left, was pushed to, or the tab moved on since it asked', async () => {
    const left = setup();
    const plan = await planned(left.acts, 260);
    left.watch.view = viewOf([entry(1, 259)]);
    expect(await left.acts.confirm(plan.key)).toEqual({
      kind: 'refused',
      why: '#260 left the merge queue.',
      next: 'gone',
    });

    const pushed = setup();
    const again = await planned(pushed.acts, 260);
    pushed.watch.view = viewOf([entry(1, 259), entry(2, 260, 'b'.repeat(40))]);
    expect(await pushed.acts.confirm(again.key)).toMatchObject({
      why: '#260’s revision is out of date.',
      next: 'ask',
    });

    const moved = setup();
    const other = await planned(moved.acts, 260);
    moved.watch.branch = 'main';
    // The dialog closes as its tab shows another branch.
    expect(await moved.acts.confirm(other.key)).toMatchObject({ why: '', next: 'gone' });

    const away = setup();
    const signedOut = await planned(away.acts, 260);
    away.watch.away = 'rozed-bot is signed out.';
    expect(await away.acts.confirm(signedOut.key)).toMatchObject({
      why: 'rozed-bot is signed out.',
      next: 'signIn',
    });

    const closed = setup();
    const gone = await planned(closed.acts, 260);
    closed.state.open = false;
    expect(await closed.acts.confirm(gone.key)).toMatchObject({ why: '', next: 'gone' });

    for (const { poller } of [left, pushed, moved, away, closed]) expect(poller.sent).toEqual([]);
  });

  it('sends nothing when the queue can’t be read again, or Lo goes offline', async () => {
    const unread = setup();
    const plan = await planned(unread.acts, 260);
    unread.watch.view = 'GitHub couldn’t be reached';
    expect(await unread.acts.confirm(plan.key)).toEqual({
      kind: 'refused',
      why: '',
      details: 'GitHub couldn’t be reached',
    });
    const offline = setup();
    const other = await planned(offline.acts, 260);
    offline.poller.offline = true;
    expect(await offline.acts.confirm(other.key)).toMatchObject({ why: 'Offline.' });
    expect([...unread.poller.sent, ...offline.poller.sent]).toEqual([]);
  });

  it('moves no entry to the front for an account no longer an admin', async () => {
    const { acts, watch, poller } = setup();
    const plan = await planned(acts, 260, 'jump');
    watch.view = viewOf([entry(1, 259), entry(2, 260)], { permission: 'WRITE' });
    expect(await acts.confirm(plan.key)).toMatchObject({
      why: 'rozed-bot doesn’t have permission.',
      next: 'none',
    });
    expect(poller.sent).toEqual([]);
  });

  it('doesn’t move an entry that reached the front since it asked', async () => {
    const { acts, watch, poller, writes } = setup();
    const plan = await planned(acts, 260, 'jump');
    watch.view = viewOf([entry(1, 260)]);
    expect(await acts.confirm(plan.key)).toEqual({
      kind: 'refused',
      why: '#260 is already at the front.',
      next: 'none',
    });
    expect(poller.sent).toEqual([]);
    expect(writes.taken.size).toBe(0);
  });

  it('checks the tab and the connection once more, right before it sends', async () => {
    const { acts, watch, poller, state } = setup();
    let plan = await planned(acts, 260);
    // Each goes as the queue is read again for the press.
    watch.onFresh = () => {
      poller.offline = true;
    };
    expect(await acts.confirm(plan.key)).toEqual({ kind: 'refused', why: 'Offline.' });
    watch.onFresh = undefined;
    poller.offline = false;
    plan = await planned(acts, 260);
    watch.onFresh = () => {
      state.open = false;
    };
    expect(await acts.confirm(plan.key)).toEqual({ kind: 'refused', why: '', next: 'gone' });
    expect(poller.sent).toEqual([]);
  });

  it('asks again when the layers that leave with it changed', async () => {
    const { acts, watch, poller } = setup();
    watch.view = viewOf([entry(1, 251), entry(2, 252), entry(3, 253)]);
    poller.stacks = [stackOf(263, [251, 252, 253])];
    const plan = await planned(acts, 251);
    expect(plan.above).toEqual([252, 253]);
    watch.view = viewOf([entry(1, 251), entry(2, 252)]);
    const answer = await acts.confirm(plan.key);
    expect(answer).toMatchObject({
      kind: 'again',
      plan: { kind: 'remove', number: 251, above: [252] },
      why: 'The layers removed with it have changed.',
    });
    expect(poller.sent).toEqual([]);
    if (answer.kind !== 'again') throw new Error('expected to ask again');
    expect(await acts.confirm(answer.plan.key)).toEqual({ kind: 'removed', numbers: [251, 252] });
    expect(poller.sent).toEqual([['dequeue', 251, 'PR_251', 'e4/queued', [252]]]);
  });

  it('sends nothing while a conversion to a GitHub stack runs on it, or another merge write does', async () => {
    const { acts, poller, state, writes } = setup();
    const plan = await planned(acts, 260);
    state.converting = { kind: 'running', prs: [259, 260] };
    expect(await acts.confirm(plan.key)).toMatchObject({
      why: 'GitHub is still changing this stack.',
    });
    state.converting = undefined;
    const again = await planned(acts, 260);
    writes.taken.add(260);
    expect(await acts.confirm(again.key)).toMatchObject({ why: '#260 is still merging.' });
    expect(poller.sent).toEqual([]);
  });

  it('sends nothing once cancelled while it checks', async () => {
    const { acts, watch, poller } = setup();
    const plan = await planned(acts, 260);
    let read: (() => void) | undefined;
    const view = watch.view;
    watch.fresh = () =>
      new Promise((resolve) => {
        read = () => resolve(view);
      });
    const confirming = acts.confirm(plan.key);
    await vi.advanceTimersByTimeAsync(0);
    acts.cancel(plan.key);
    read?.();
    expect(await confirming).toEqual({ kind: 'refused', why: '', next: 'gone' });
    expect(poller.sent).toEqual([]);
  });

  it('says GitHub’s refusal, and that a refused or unsent change changed nothing', async () => {
    const { acts, poller, writes } = setup();
    poller.jumped = { refusal: 'stacked', others: [259] };
    expect(await acts.confirm((await planned(acts, 260, 'jump')).key)).toEqual({
      kind: 'refused',
      why: 'GitHub queues a stack’s layers in order',
      next: 'none',
      details:
        "#259 is in its GitHub stack, which GitHub queues in order, so Lo didn't move it to the front",
    });
    poller.dequeued = new GithubError({
      kind: 'unauthorized',
      message: 'GitHub refused the token.',
    });
    expect(await acts.confirm((await planned(acts, 260)).key)).toMatchObject({
      kind: 'refused',
      why: 'rozed-bot is signed out.',
      next: 'signIn',
    });
    expect(writes.taken.size).toBe(0);
  });

  it('says an entry GitHub took out to move and didn’t add back is out of the queue', async () => {
    const { acts, poller } = setup();
    poller.jumped = { kind: 'notBack', failure: { refusal: 'headMoved' } };
    expect(await acts.confirm((await planned(acts, 260, 'jump')).key)).toEqual({
      kind: 'partly',
      why: 'It left the merge queue and wasn’t added back.',
      next: 'open',
      details: 'Someone pushed to the pull request since Lo showed it',
    });
  });

  it('holds the turns of a change whose answer was lost until a read of the queue since answers', async () => {
    const { acts, watch, poller, writes } = setup();
    // The read after it fails at first.
    poller.dequeued = new Later(() => {
      watch.view = 'GitHub couldn’t be reached';
      return Promise.reject(LOST);
    });
    const plan = await planned(acts, 260);
    expect(await acts.confirm(plan.key)).toEqual({
      kind: 'unknown',
      why: 'GitHub didn’t respond.',
      details: "couldn't reach GitHub: The connection closed.",
    });
    await vi.advanceTimersByTimeAsync(0);
    // The read after it failed: the turn holds, and it's read again later.
    expect(writes.busy(REPO, [260])).toEqual([260]);
    expect(await acts.plan(TAB.id, 260, 'remove')).toMatchObject({ kind: 'refused' });
    watch.view = viewOf([entry(1, 259)]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(writes.taken.size).toBe(0);
    expect(watch.asked.filter(({ since }) => since === 1_000_000).length).toBeGreaterThan(1);
    // Never sent again by itself.
    expect(poller.sent).toHaveLength(1);
  });

  it('says it can’t tell whether GitHub added back an entry it took out to move', async () => {
    const { acts, poller, writes } = setup();
    poller.jumped = {
      kind: 'notBack',
      failure: { kind: 'api', status: 502, message: 'Bad gateway', errors: [] },
    };
    expect(await acts.confirm((await planned(acts, 260, 'jump')).key)).toMatchObject({
      kind: 'unknown',
      why: 'GitHub didn’t respond.',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.taken.size).toBe(0);
  });

  it('holds the turn of an entry GitHub took out to move while its answer to adding it back was lost', async () => {
    const { acts, watch, poller, writes } = setup();
    poller.jumped = new Later(() => {
      watch.view = 'GitHub couldn’t be reached';
      return Promise.resolve({ kind: 'notBack' as const, failure: LOST_DETAIL });
    });
    expect(await acts.confirm((await planned(acts, 260, 'jump')).key)).toMatchObject({
      kind: 'unknown',
      why: 'GitHub didn’t respond.',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.busy(REPO, [260])).toEqual([260]);
    watch.view = viewOf([entry(1, 260)]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(writes.taken.size).toBe(0);
    expect(poller.sent).toHaveLength(1);
  });

  it('settles a lost change by a read of the branch it changed, not of the one the tab shows since', async () => {
    const { acts, watch, poller, writes, state } = setup();
    poller.dequeued = new Later(() => {
      watch.view = 'GitHub couldn’t be reached';
      return Promise.reject(LOST);
    });
    await acts.confirm((await planned(acts, 260)).key);
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.busy(REPO, [260])).toEqual([260]);
    // The tab moves on to main, whose queue it reads; e4/queued's can't be read yet.
    watch.branch = 'main';
    watch.view = viewOf([], { branch: 'main' });
    state.readBranch = new Error('GitHub couldn’t be reached.');
    acts.drop(TAB.id);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(writes.busy(REPO, [260])).toEqual([260]);
    expect(state.reads.length).toBeGreaterThan(1);
    expect(new Set(state.reads.map(({ branch, kind }) => `${kind} ${branch}`))).toEqual(
      new Set(['queue e4/queued']),
    );
    state.readBranch = undefined;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(writes.taken.size).toBe(0);
  });

  it('settles a lost change at once when its tab closes, by a read of its own', async () => {
    const { acts, watch, poller, writes, state } = setup();
    poller.dequeued = new Later(() => {
      watch.view = 'GitHub couldn’t be reached';
      return Promise.reject(LOST);
    });
    await acts.confirm((await planned(acts, 260)).key);
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.busy(REPO, [260])).toEqual([260]);
    state.open = false;
    acts.drop(TAB.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.reads).toEqual([{ branch: 'e4/queued', kind: 'queue' }]);
    expect(writes.taken.size).toBe(0);
  });

  it('gives a lost change’s turn back once its account is gone', async () => {
    const { acts, watch, poller, writes, state } = setup();
    poller.dequeued = new Later(() => {
      watch.view = 'GitHub couldn’t be reached';
      return Promise.reject(LOST);
    });
    await acts.confirm((await planned(acts, 260)).key);
    await vi.advanceTimersByTimeAsync(0);
    state.open = false;
    state.account = false;
    acts.drop(TAB.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.reads).toEqual([]);
    expect(writes.taken.size).toBe(0);
  });

  it('gives the turns back once Lo stops', async () => {
    const { acts, watch, poller, writes } = setup();
    poller.jumped = new Later(() => {
      watch.view = 'GitHub couldn’t be reached';
      return Promise.reject(LOST);
    });
    const plan = await planned(acts, 260, 'jump');
    await acts.confirm(plan.key);
    expect(writes.taken.size).toBe(1);
    acts.stop();
    expect(writes.taken.size).toBe(0);
  });
});

describe('a question that no longer stands', () => {
  it('is dropped once a read no longer lists its entry, or lists it at another head', async () => {
    const { acts } = setup();
    const left = await planned(acts, 260);
    acts.heard(TAB.id, viewOf([entry(1, 259)]));
    expect(await acts.confirm(left.key)).toMatchObject({ why: 'The queue has changed.' });
    const pushed = await planned(acts, 260);
    acts.heard(TAB.id, viewOf([entry(1, 259), entry(2, 260, 'c'.repeat(40))]));
    expect(await acts.confirm(pushed.key)).toMatchObject({ why: 'The queue has changed.' });
    // A read that may not list every entry drops nothing.
    const kept = await planned(acts, 260);
    acts.heard(TAB.id, viewOf([entry(1, 259)], { total: 150 }));
    expect(await acts.confirm(kept.key)).toMatchObject({ kind: 'removed' });
  });

  it('is dropped once its tab closes, shows another branch or its account goes', async () => {
    const { acts } = setup();
    const plan = await planned(acts, 260);
    acts.drop(TAB.id);
    expect(await acts.confirm(plan.key)).toMatchObject({ why: 'The queue has changed.' });
  });
});

describe('`a` on a pull request waiting to join', () => {
  it('turns its auto-merge off at once, in its turn, from a read no older than 40 s', async () => {
    const { acts, watch, poller, writes } = setup();
    expect(await acts.autoMergeOff(TAB.id, 258)).toEqual({ kind: 'autoMergeOff' });
    expect(poller.sent).toEqual([['disableAutoMerge', 258, 'PR_258']]);
    expect(watch.asked[0]).toEqual({ kind: 'waiting', within: ACT_WITHIN, since: undefined });
    expect(writes.taken.size).toBe(0);
  });

  it('turns nothing off for one in the queue, one with auto-merge off, or one no longer open', async () => {
    const { acts, watch, poller } = setup();
    watch.waiting = waitingOf([
      { number: 258, inQueue: true },
      { number: 259, autoMerge: false },
    ]);
    expect(await acts.autoMergeOff(TAB.id, 258)).toEqual({
      kind: 'refused',
      why: '#258 is already in the merge queue.',
      next: 'none',
    });
    expect(await acts.autoMergeOff(TAB.id, 259)).toMatchObject({
      why: 'Auto-merge is already off.',
    });
    expect(await acts.autoMergeOff(TAB.id, 260)).toMatchObject({
      why: '#260 is no longer open into e4/queued.',
      next: 'gone',
    });
    watch.waiting = 'GitHub couldn’t be reached';
    expect(await acts.autoMergeOff(TAB.id, 258)).toMatchObject({
      why: '',
      details: 'GitHub couldn’t be reached',
    });
    expect(poller.sent).toEqual([]);
  });

  it('turns nothing off while another merge write to it is under way, or Lo is offline', async () => {
    const { acts, poller, writes } = setup();
    writes.taken.add(258);
    expect(await acts.autoMergeOff(TAB.id, 258)).toMatchObject({
      why: '#258 is still merging.',
    });
    writes.taken.clear();
    poller.offline = true;
    expect(await acts.autoMergeOff(TAB.id, 258)).toMatchObject({ why: 'Offline.' });
    expect(poller.sent).toEqual([]);
  });

  it('turns nothing off when the tab shows another branch by the time those waiting are read', async () => {
    const { acts, watch, poller } = setup();
    watch.onWaiting = () => {
      watch.branch = 'main';
    };
    expect(await acts.autoMergeOff(TAB.id, 258)).toEqual({
      kind: 'refused',
      why: 'The queue has changed.',
    });
    expect(poller.sent).toEqual([]);
  });

  it('says so when it joined the queue before auto-merge went off', async () => {
    const { acts, poller } = setup();
    poller.turnedOff = {
      number: 258,
      head: HEAD,
      autoMerge: undefined,
      inQueue: true,
    };
    expect(await acts.autoMergeOff(TAB.id, 258)).toMatchObject({
      kind: 'partly',
      why: '#258 had already joined the merge queue.',
      next: 'remove',
    });
  });

  it('holds its turn when its answer was lost, until those waiting to join are read again', async () => {
    const { acts, watch, poller, writes } = setup();
    poller.turnedOff = LOST;
    watch.waiting = waitingOf([{ number: 258 }]);
    const answer = acts.autoMergeOff(TAB.id, 258);
    expect(await answer).toMatchObject({
      kind: 'unknown',
      why: 'GitHub didn’t respond.',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.taken.size).toBe(0);
    expect(watch.asked.at(-2)).toEqual({ kind: 'waiting', within: 0, since: 1_000_000 });
  });
});
