// A chain's merge a layer at a time, with stand-ins for GitHub: #5 merges into main, and #6 and #7,
// which sit on it, move onto main once GitHub says it merged, in order, and not before. After a
// queue entry it waits for the merge, and for a lost answer a while; a base someone else moved stops
// it, and so does a merge that didn't go, leaving what moved where it is.

import {
  GithubError,
  RepoRef,
  type ConversionStep,
  type MergeRefusal,
  type PullSummary,
  type StepDone,
} from '@lo/github';
import { describe, expect, it, vi } from 'vitest';

import type { Method, Progress, Together } from '../contract.ts';
import { ChainRun, type ChainOptions, type Looked } from './chains.ts';

const REPO = new RepoRef('rozed-dev', 'e2e');

const CHAIN: Extract<Together, { kind: 'chain' }> = {
  kind: 'chain',
  before: null,
  after: [
    { pr: 6, from: 't5', to: 'main' },
    { pr: 7, from: 't5', to: 'main' },
  ],
  needsRebase: [6, 7],
};

/** A base branch change GitHub made. */
function moved(): Promise<StepDone | MergeRefusal> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the run reads only its kind.
  return Promise.resolve({ kind: 'retargeted', pull: {} as PullSummary });
}

function run(
  together: Extract<Together, { kind: 'chain' }> = CHAIN,
  options: {
    answer?: (pr: number) => Promise<StepDone | MergeRefusal>;
    looks?: Looked[];
    /** How long each read takes, in milliseconds: a minute. */
    lookTakes?: number;
    /** How long each read takes to answer, in real milliseconds: none. */
    lookWait?: number;
    /** Called as each read is made, with how many there have been. */
    onLook?: (read: number) => void;
    /** The method it merges with: a squash. */
    method?: Method | null;
  } = {},
) {
  const sent: number[] = [];
  const looks = [...(options.looks ?? [])];
  let clock = 0;
  let ended = 0;
  let read = 0;
  /** The reads under way now, and the most there were at once. */
  let reading = 0;
  let mostReading = 0;
  const views: Progress[] = [];
  const config: ChainOptions = {
    repo: REPO,
    login: 'ravi-k',
    number: 5,
    together,
    method: options.method === undefined ? 'SQUASH' : options.method,
    retarget: (_repo, step: ConversionStep) => {
      if (step.kind !== 'retarget') throw new Error('only base branches move');
      sent.push(step.retarget.pr);
      return options.answer?.(step.retarget.pr) ?? moved();
    },
    look: async () => {
      // Each read takes a minute, unless the test says.
      clock += options.lookTakes ?? 60_000;
      read += 1;
      options.onLook?.(read);
      reading += 1;
      mostReading = Math.max(mostReading, reading);
      const looked = looks.length > 1 ? looks.shift()! : (looks[0] ?? 'open');
      if (options.lookWait !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, options.lookWait));
      }
      reading -= 1;
      return looked;
    },
    changed: () => views.push(chain.view()),
    ended: () => {
      ended += 1;
    },
    log: () => undefined,
    every: 1,
    monotonic: () => clock,
  };
  const chain = new ChainRun(config);
  return {
    chain,
    sent,
    views,
    ended: () => ended,
    /** How many times it read the pull request. */
    reads: () => read,
    /** The most reads of the pull request under way at once. */
    mostReading: () => mostReading,
    async over(): Promise<Extract<Progress, { kind: 'chain' }>> {
      await vi.waitFor(() => expect(chain.over).toBe(true));
      const view = chain.view();
      if (view.kind !== 'chain') throw new Error('not a chain');
      return view;
    },
  };
}

describe('a chain’s merge a layer at a time', () => {
  it('moves the layers on it only once GitHub says it merged, in order', async () => {
    const chain = run();
    expect(await chain.chain.moveFirst()).toBe(true);
    expect(chain.sent).toEqual([]);
    chain.chain.merged();
    const view = await chain.over();
    expect(chain.sent).toEqual([6, 7]);
    expect(view).toMatchObject({
      phase: 'done',
      moves: [{ status: 'done' }, { status: 'done' }],
      text: null,
    });
    expect(chain.ended()).toBe(1);
  });

  it('says nothing once the layers moved, whatever the method: the stack shows a needed rebase', async () => {
    const merged = run(CHAIN, { method: 'MERGE' });
    merged.chain.merged();
    expect((await merged.over()).text).toBeNull();
    const queued = run(CHAIN, { method: null });
    queued.chain.merged();
    expect((await queued.over()).text).toBeNull();
  });

  it('after a queue entry, waits for the merge, and moves nothing when it leaves the queue', async () => {
    const merges = run(CHAIN, { looks: ['queued', 'queued', 'merged'] });
    merges.chain.enqueued();
    expect(merges.chain.view()).toMatchObject({ phase: 'waiting' });
    expect((await merges.over()).phase).toBe('done');
    expect(merges.sent).toEqual([6, 7]);

    const leaves = run(CHAIN, { looks: ['queued', 'open'] });
    leaves.chain.enqueued();
    expect(await leaves.over()).toMatchObject({
      phase: 'stopped',
      moves: [{ status: 'skipped' }, { status: 'skipped' }],
      text: 'It left the merge queue.',
    });
    expect(leaves.sent).toEqual([]);
  });

  it('waits 6 hours at most for a queue entry to merge, and moves nothing once it’s closed', async () => {
    // Each read takes 20 minutes here: 15 minutes, as after a lost answer, isn't the limit.
    const waits = run(CHAIN, { looks: ['queued'], lookTakes: 20 * 60_000 });
    waits.chain.enqueued();
    expect(await waits.over()).toMatchObject({
      phase: 'stopped',
      text: '#5 was still in the merge queue after 6 h.',
    });
    expect(waits.reads()).toBe(18);
    expect(waits.sent).toEqual([]);

    const closes = run(CHAIN, { looks: ['queued', 'closed'] });
    closes.chain.enqueued();
    expect(await closes.over()).toMatchObject({
      phase: 'stopped',
      text: 'It was closed.',
    });
    expect(closes.sent).toEqual([]);
  });

  it('after a lost answer, reads for 15 minutes at most, then moves nothing', async () => {
    const found = run(CHAIN, { looks: ['open', 'merged'] });
    found.chain.unsure();
    expect((await found.over()).phase).toBe('done');

    // A read a minute.
    const never = run(CHAIN, { looks: ['open'] });
    never.chain.unsure();
    expect(await never.over()).toMatchObject({
      phase: 'stopped',
      text: 'GitHub didn’t respond.',
    });
    expect(never.reads()).toBe(15);
    expect(never.sent).toEqual([]);
  });

  it('after another lost answer, as GitHub was asked again, reads for 15 minutes from then', async () => {
    const chain = run(CHAIN, {
      looks: ['open'],
      onLook(read) {
        // Ten minutes on, GitHub's answer is lost again.
        if (read === 10) chain.chain.unsure();
      },
    });
    chain.chain.unsure();
    expect(await chain.over()).toMatchObject({
      phase: 'stopped',
      text: 'GitHub didn’t respond.',
    });
    expect(chain.reads()).toBe(25);
    expect(chain.sent).toEqual([]);
  });

  it('stops at a base someone else moved, saying what moved, and sends nothing after it', async () => {
    const chain = run(CHAIN, {
      answer: (pr) =>
        pr === 6 ? moved() : Promise.resolve({ refusal: 'baseChanged', now: 'feature' }),
    });
    chain.chain.merged();
    expect(await chain.over()).toMatchObject({
      phase: 'stopped',
      moves: [{ status: 'done' }, { status: 'failed', detail: 'Already on feature.' }],
      text: null,
    });
  });

  it('says it can’t tell when a move’s answer was lost, and goes no further', async () => {
    const chain = run(CHAIN, {
      answer: () =>
        Promise.reject(new GithubError({ kind: 'network', failure: 'lost', message: 'reset' })),
    });
    chain.chain.merged();
    expect(await chain.over()).toMatchObject({
      moves: [{ status: 'unknown', detail: 'Not confirmed' }, { status: 'skipped' }],
      text: 'GitHub didn’t respond.',
    });
    expect(chain.sent).toEqual([6]);
  });

  it('moves its bottom layer onto the root first, and keeps it there when the merge fails', async () => {
    const before = { ...CHAIN, before: { pr: 5, from: 'm4', to: 'main' } };
    const chain = run(before);
    expect(chain.chain.view()).toMatchObject({ phase: 'before' });
    expect(await chain.chain.moveFirst()).toBe(true);
    expect(chain.sent).toEqual([5]);
    chain.chain.failed();
    expect(await chain.over()).toMatchObject({
      phase: 'stopped',
      moves: [{ before: true, status: 'done' }, { status: 'skipped' }, { status: 'skipped' }],
      text: '#5’s base branch is now main.',
    });
    expect(chain.sent).toEqual([5]);

    // A first move refused merges nothing.
    const refused = run(before, {
      answer: () => Promise.resolve({ refusal: 'baseChanged', now: 'other' }),
    });
    expect(await refused.chain.moveFirst()).toBe(false);
    expect(refused.chain.view()).toMatchObject({
      phase: 'stopped',
      text: 'Its base branch didn’t move.',
    });
  });

  it('moves the layers once, however many times and ways it hears the merge', async () => {
    // GitHub's answer, asked again, and a read of the pull request both say it merged, while #6's
    // move is refused: #7 stays where it is.
    let refuse: (() => void) | undefined;
    const twice = run(CHAIN, {
      looks: ['merged'],
      answer: (pr) =>
        pr === 6
          ? new Promise((resolve) => {
              refuse = () => resolve({ refusal: 'baseChanged', now: 'feature' });
            })
          : moved(),
    });
    twice.chain.unsure();
    await vi.waitFor(() => expect(twice.sent).toEqual([6]));
    twice.chain.merged();
    twice.chain.merged();
    refuse?.();
    expect(await twice.over()).toMatchObject({
      phase: 'stopped',
      moves: [{ status: 'failed' }, { status: 'skipped' }],
    });
    expect(twice.sent).toEqual([6]);
    expect(twice.ended()).toBe(1);

    // Once a read showed it merged, GitHub's answer that it failed stops nothing.
    let move: (() => void) | undefined;
    const late = run(CHAIN, {
      looks: ['merged'],
      answer: (pr) =>
        pr === 6
          ? new Promise((resolve) => {
              move = () => void moved().then(resolve);
            })
          : moved(),
    });
    late.chain.unsure();
    await vi.waitFor(() => expect(late.sent).toEqual([6]));
    late.chain.failed();
    move?.();
    expect((await late.over()).phase).toBe('done');
    expect(late.sent).toEqual([6, 7]);
  });

  it('reads the pull request in one wait at a time, which a queue entry makes longer', async () => {
    const chain = run(CHAIN, { looks: ['queued', 'queued', 'merged'], lookWait: 5 });
    chain.chain.unsure();
    chain.chain.unsure();
    chain.chain.enqueued();
    expect(chain.chain.view()).toMatchObject({
      phase: 'waiting',
      text: 'The layers above move once it has merged, while Lo is open.',
    });
    expect((await chain.over()).phase).toBe('done');
    expect(chain.mostReading()).toBe(1);
    expect(chain.sent).toEqual([6, 7]);
  });

  it('sends nothing more once Lo stops it', async () => {
    const chain = run(CHAIN, { looks: ['queued'] });
    chain.chain.enqueued();
    chain.chain.stop();
    expect(chain.chain.view()).toMatchObject({ phase: 'stopped' });
    chain.chain.merged();
    expect(chain.sent).toEqual([]);
    expect(chain.ended()).toBe(1);
  });
});
