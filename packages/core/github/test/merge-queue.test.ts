/**
 * The merge queue's reads, and the open pull requests from a branch, replayed from recordings on
 * `rozed-dev/e2e` as rozed-bot, its admin, on one generation of the merge fixture
 * (`testing/fixtures/merge.sh`): its four pull requests into `e4/queued`, whose ruleset merges
 * through a queue (`./scenarios/merge-queue.ts`), and its chain (`./scenarios/pulls-from-head.ts`).
 */

import { cassette, replayFetch, type ReplayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient } from '../src/client.ts';
import { Fields } from '../src/json.ts';
import { openPullsFromHead } from '../src/merge.ts';
import {
  queueRemoval,
  queueView,
  queueViewCutShort,
  queueWaiting,
  type QueueView,
} from '../src/merge-queue.ts';
import { PullRef, RepoRef } from '../src/refs.ts';
import { Token } from '../src/token.ts';
import { BRANCH, NAMES, setupOf } from './scenarios/merge-queue.ts';
import { branches, FORK_BRANCH } from './scenarios/pulls-from-head.ts';

const E2E = new RepoRef('rozed-dev', 'e2e');

function client(fetch: ReplayFetch): GithubClient {
  return new GithubClient({ fetch, token: new Token('gho_FAKE') });
}

/** Every read of `e4/queued`'s queue `queue_view_e2e` recorded, in order. */
async function views(): Promise<QueueView[]> {
  const recorded = cassette('queue_view_e2e');
  const reads = recorded.interactions.filter(
    ({ interaction }) => interaction.request.operation === 'QueueView',
  );
  const github = client(replayFetch('queue_view_e2e'));
  const read: QueueView[] = [];
  for (const _ of reads) read.push(await queueView(github, E2E, BRANCH));
  return read;
}

test('the queue view lists the entries in order, each with the commits github tests it on', async () => {
  const { pulls } = setupOf(cassette('queue_view_e2e').info.setup);
  const read = await views();
  expect(read).toHaveLength(4);
  const [joined, built, checked, failing] = read;
  if (!joined || !built || !checked || !failing) throw new Error('the queue was read less often');

  // An admin sees the settings; GitHub gave no estimate.
  expect(joined.viewerPermission).toBe('ADMIN');
  expect(joined.leftOut).toEqual([]);
  expect(joined.queue).toMatchObject({
    url: 'https://github.com/rozed-dev/e2e/queue/e4/queued',
    nextEstimate: undefined,
    settings: { method: 'SQUASH', strategy: 'ALLGREEN', building: 5 },
    total: 4,
  });
  expect(queueViewCutShort(joined)).toBe(false);
  // In the order they joined, by rozed-bot, at the heads they joined with.
  const entries = joined.queue?.entries ?? [];
  expect(entries.map((entry) => [entry.position, entry.pullRequest?.number])).toEqual(
    NAMES.map((name, index) => [index + 1, pulls[name].number]),
  );
  for (const [index, entry] of entries.entries()) {
    const pr = pulls[NAMES[index]!];
    expect(entry).toMatchObject({
      state: 'QUEUED',
      estimate: undefined,
      enqueuer: 'rozed-bot',
      jump: false,
      solo: false,
      // Not built yet.
      base: undefined,
      tested: undefined,
      checks: [],
    });
    expect(entry.pullRequest).toMatchObject({
      id: pr.id,
      head: pr.head,
      author: 'rozed-bot',
      viewerDidAuthor: true,
    });
  }

  // Then each is built on the commit the one ahead is tested on, and ci runs on it.
  const chain = built.queue?.entries ?? [];
  expect(chain.every((entry) => entry.state === 'AWAITING_CHECKS')).toBe(true);
  expect(chain.every((entry) => entry.tested?.length === 40)).toBe(true);
  expect(chain.slice(1).map((entry) => entry.base)).toEqual(
    chain.slice(0, -1).map((entry) => entry.tested),
  );
  for (const entry of chain) {
    expect(entry.checks).toMatchObject([{ kind: 'checkRun', name: 'ci', status: 'IN_PROGRESS' }]);
  }

  // queued-pass passes behind the slow ones, and queued-fail fails in the queue.
  const at = (view: QueueView, name: (typeof NAMES)[number]) =>
    view.queue?.entries.find((entry) => entry.pullRequest?.number === pulls[name].number);
  expect(at(checked, 'queued-fail')?.state).toBe('AWAITING_CHECKS');
  expect(at(checked, 'queued-fail')?.checks).toMatchObject([
    { kind: 'checkRun', name: 'ci', status: 'COMPLETED', conclusion: 'FAILURE' },
  ]);
  expect(at(failing, 'queued-pass')?.state).toBe('MERGEABLE');
  const failed = at(failing, 'queued-fail');
  expect(failed?.state).toBe('UNMERGEABLE');
  expect(failed?.checks[0]?.url).toMatch(/^https:\/\/github\.com\/rozed-dev\/e2e\/actions\/runs\//);
});

test('why a pull request left the queue: by hand, failed checks, or merged', async () => {
  const { pulls } = setupOf(cassette('queue_removal_e2e').info.setup);
  const github = client(replayFetch('queue_removal_e2e'));
  const read = (name: (typeof NAMES)[number]) =>
    queueRemoval(github, new PullRef('rozed-dev', 'e2e', pulls[name].number));

  // rozed-bot took it out while ci ran on the commit the queue tested it on.
  const byHand = await read('queued-slow-2');
  expect(byHand).toMatchObject({ state: 'OPEN', inQueue: false, leftOut: [] });
  expect(byHand.removal).toMatchObject({ reason: 'manual', by: 'rozed-bot' });
  expect(byHand.removal?.at).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(byHand.removal?.checks).toMatchObject([{ name: 'ci', status: 'IN_PROGRESS' }]);

  // GitHub's queue took it out when ci failed on the commit it tested.
  const failed = await read('queued-fail');
  expect(failed).toMatchObject({ state: 'OPEN', inQueue: false });
  expect(failed.removal).toMatchObject({ reason: 'failed_checks', by: 'github-merge-queue' });
  expect(failed.removal?.tested).toMatch(/^[0-9a-f]{40}$/);
  expect(failed.removal?.tested).not.toBe(pulls['queued-fail'].head);
  expect(failed.removal?.checks).toMatchObject([
    { kind: 'checkRun', name: 'ci', status: 'COMPLETED', conclusion: 'FAILURE' },
  ]);

  // Merged, it left too.
  const merged = await read('queued-pass');
  expect(merged).toMatchObject({ state: 'MERGED', inQueue: false });
  expect(merged.removal).toMatchObject({ reason: 'merged', by: 'github-merge-queue' });
});

test('the open pull requests into a queue branch say whether auto-merge is on', async () => {
  const { pulls } = setupOf(cassette('queue_waiting_e2e').info.setup);
  const waiting = await queueWaiting(client(replayFetch('queue_waiting_e2e')), E2E, BRANCH);

  expect(waiting.branch).toBe(BRANCH);
  expect(waiting.leftOut).toEqual([]);
  expect(waiting.total).toBe(waiting.pullRequests.length);
  const numbers = waiting.pullRequests.map((pull) => pull.number);
  for (const pr of Object.values(pulls)) expect(numbers).toContain(pr.number);
  // rozed-dev/e2e doesn't allow auto-merge, so none has it on, and none is queued yet.
  expect(waiting.pullRequests.every((pull) => pull.autoMerge === undefined && !pull.inQueue)).toBe(
    true,
  );
  // e4/queued requires no review, and the slow ones' ci was running.
  const slow = waiting.pullRequests.find((pull) => pull.number === pulls['queued-slow-2'].number);
  expect(slow).toMatchObject({
    head: pulls['queued-slow-2'].head,
    author: 'rozed-bot',
    viewerDidAuthor: true,
    reviewDecision: undefined,
    checks: 'PENDING',
  });
  const passing = waiting.pullRequests.find((pull) => pull.number === pulls['queued-pass'].number);
  expect(passing?.checks).toBe('SUCCESS');

  const derived = await queueWaiting(
    client(replayFetch('queue_waiting_e2e_auto_merge')),
    E2E,
    BRANCH,
  );
  const on = derived.pullRequests.filter((pull) => pull.autoMerge !== undefined);
  expect(on.map((pull) => pull.number)).toEqual([pulls['queued-slow-2'].number]);
  expect(on[0]?.autoMerge).toEqual({
    method: 'SQUASH',
    enabledBy: 'rozed-bot',
    enabledAt: '2026-11-16T19:05:00Z',
  });
});

test('the open pull requests from a branch are the repositorys own or a forks', async () => {
  const generation = new Fields(cassette('pulls_from_head_e2e').info.setup, 'setup').integer(
    'generation',
  );
  const github = client(replayFetch('pulls_from_head_e2e'));
  const [chain = '', base = '', fork] = branches(generation);

  // The chain's lower layer comes from merge/<generation>/chain-1, which the upper is based on.
  expect(await openPullsFromHead(github, E2E, chain)).toEqual({
    branch: chain,
    pullRequests: [
      { number: 126, base: `merge/${generation}/base`, head: chain, sameRepository: true },
    ],
    cutShort: false,
  });
  // Nothing comes from the generation's base.
  expect(await openPullsFromHead(github, E2E, base)).toEqual({
    branch: base,
    pullRequests: [],
    cutShort: false,
  });
  // A fork's branch of the same name isn't the repository's.
  expect(fork).toBe(FORK_BRANCH);
  expect(await openPullsFromHead(github, E2E, FORK_BRANCH)).toEqual({
    branch: FORK_BRANCH,
    pullRequests: [{ number: 99, base: 'code/base', head: FORK_BRANCH, sameRepository: false }],
    cutShort: false,
  });
});
