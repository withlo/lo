/**
 * The merge queue's reads, and the open pull requests from a branch, replayed from recordings on
 * `rozed-dev/e2e` as rozed-bot, its admin, on one generation of the merge fixture
 * (`testing/fixtures/merge.sh`): its four pull requests into `e4/queued`, whose ruleset merges
 * through a queue (`./scenarios/merge-queue.ts`), and its chain (`./scenarios/pulls-from-head.ts`).
 * What GitHub gives only now and then, such as a part left out with an error, is the recorded
 * answers edited here.
 */

import {
  cassette,
  isObject,
  Replay,
  replayFetch,
  type Interaction,
  type Json,
  type ReplayFetch,
} from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient } from '../src/client.ts';
import { Fields } from '../src/json.ts';
import { openPullsFromHead } from '../src/merge.ts';
import {
  queueLeftOut,
  queueRemoval,
  queueView,
  queueViewCutShort,
  queueWaiting,
  queueWaitingCutShort,
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

type JsonObject = { [key: string]: Json };

function object(value: Json | undefined): JsonObject {
  if (!isObject(value)) throw new Error(`expected an object, got ${JSON.stringify(value)}`);
  return value;
}

/** `name`'s recordings, with the first answer `pick` picks edited by `edit`. */
function edited(
  name: string,
  pick: (interaction: Interaction) => boolean,
  edit: (interaction: Interaction) => void,
): ReplayFetch {
  let done = false;
  const interactions = cassette(name).interactions.map(({ interaction }) => {
    const copy = structuredClone(interaction);
    if (!done && pick(copy)) {
      edit(copy);
      done = true;
    }
    return copy;
  });
  if (!done) throw new Error(`${name} has no answer to edit`);
  return replayFetch(new Replay(name, interactions));
}

/** Whether `interaction` is GraphQL's `operation`. */
function isOperation(operation: string): (interaction: Interaction) => boolean {
  return (interaction) => interaction.request.operation === operation;
}

/**
 * Leaves the field at `path` out of a recorded GraphQL answer, as GitHub does when it can't give
 * it: an error naming it, of GitHub's type `type`, or of none, as for a timeout, and null in its
 * place, or in the place of its nearest parent that can be null, `nulled` steps along `path`.
 */
function leaveOut(
  interaction: Interaction,
  path: readonly (string | number)[],
  { nulled = path.length, type }: { nulled?: number; type?: string } = {},
): void {
  const body = object(interaction.response.body);
  let parent: Json | undefined = body['data'];
  for (const step of path.slice(0, nulled - 1)) {
    parent = Array.isArray(parent) ? parent[Number(step)] : object(parent)[step];
  }
  const last = path[nulled - 1] ?? '';
  if (Array.isArray(parent)) parent[Number(last)] = null;
  else object(parent)[last] = null;
  const error: Json = {
    type: type ?? null,
    path: [...path],
    message:
      'Something went wrong while executing your query. This may be the result of a timeout.',
  };
  const errors = body['errors'];
  if (Array.isArray(errors)) errors.push(error);
  else body['errors'] = [error];
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

/** `e4/queued`'s queue, as `queue_view_e2e` first read it, edited by `edit`. */
function viewEdited(edit: (interaction: Interaction) => void): Promise<QueueView> {
  return queueView(client(edited('queue_view_e2e', isOperation('QueueView'), edit)), E2E, BRANCH);
}

/** `e4/queued`'s queue, with its settings left out with an error of GitHub's type `type`. */
function settingsLeftOut(type: string | undefined): Promise<QueueView> {
  return viewEdited((answer) => {
    leaveOut(answer, ['repository', 'mergeQueue', 'configuration'], { type });
  });
}

test('a queue github left part of out is never read as empty, or as none', async () => {
  // The entries left out: none read, and none counted, but cut short.
  const noEntries = await viewEdited((answer) => {
    leaveOut(answer, ['repository', 'mergeQueue', 'entries']);
  });
  expect(noEntries.leftOut).toEqual(['mergeQueue.entries']);
  expect(noEntries.queue).toMatchObject({ entries: [], total: 0 });
  expect(queueLeftOut(noEntries)).toBe(true);
  expect(queueViewCutShort(noEntries)).toBe(true);

  // A part of the queue that can't be null nulls it: the branch may have one.
  const noQueue = await viewEdited((answer) => {
    leaveOut(answer, ['repository', 'mergeQueue', 'url'], { nulled: 2 });
  });
  expect(noQueue).toMatchObject({ queue: undefined, leftOut: ['mergeQueue.url'] });
  expect(queueViewCutShort(noQueue)).toBe(true);

  // An entry left out is counted, but not read.
  const noEntry = await viewEdited((answer) => {
    leaveOut(answer, ['repository', 'mergeQueue', 'entries', 'nodes', 1, 'position'], {
      nulled: 5,
    });
  });
  expect(noEntry.queue?.entries).toHaveLength(3);
  expect(noEntry.queue?.total).toBe(4);
  expect(queueViewCutShort(noEntry)).toBe(true);
});

test('settings hidden from those who cant write are githubs answer, not a part left out', async () => {
  const hidden = await settingsLeftOut('FORBIDDEN');
  expect(hidden.queue?.settings).toBeUndefined();
  expect(hidden.leftOut).toEqual([]);
  expect(queueViewCutShort(hidden)).toBe(false);

  // Any other error is a part left out, though not one of the queue's entries.
  const failed = await settingsLeftOut(undefined);
  expect(failed.leftOut).toEqual(['mergeQueue.configuration']);
  expect(queueLeftOut(failed)).toBe(false);
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

/** Whether `interaction` reads the generation's `queued-fail` removal. */
function isFailingRemoval(interaction: Interaction): boolean {
  const { pulls } = setupOf(cassette('queue_removal_e2e').info.setup);
  const variables = interaction.request.variables;
  return (
    interaction.request.operation === 'QueueRemoval' &&
    isObject(variables) &&
    variables['number'] === pulls['queued-fail'].number
  );
}

test('a removal github left out is noted, and a timeline left out fails the read', async () => {
  const { pulls } = setupOf(cassette('queue_removal_e2e').info.setup);
  const failing = new PullRef('rozed-dev', 'e2e', pulls['queued-fail'].number);
  const timeline = ['repository', 'pullRequest', 'timelineItems'];

  // createdAt can't be null: its error leaves out the whole event.
  const noEvent = await queueRemoval(
    client(
      edited('queue_removal_e2e', isFailingRemoval, (answer) => {
        leaveOut(answer, [...timeline, 'nodes', 0, 'createdAt'], { nulled: 5 });
      }),
    ),
    failing,
  );
  expect(noEvent).toMatchObject({
    removal: undefined,
    leftOut: ['pullRequest.timelineItems.nodes.0.createdAt'],
  });

  // The timeline can't be null: its error nulls the pull request, which isn't then not found.
  const read = queueRemoval(
    client(
      edited('queue_removal_e2e', isFailingRemoval, (answer) => {
        leaveOut(answer, timeline, { nulled: 2 });
      }),
    ),
    failing,
  );
  await expect(read).rejects.toMatchObject({ detail: { kind: 'graphql' } });
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

test('a pull request github left out of those waiting may be one waiting to join', async () => {
  const waiting = await queueWaiting(
    client(
      edited('queue_waiting_e2e', isOperation('QueueWaiting'), (answer) => {
        leaveOut(answer, ['repository', 'pullRequests', 'nodes', 0, 'title'], { nulled: 4 });
      }),
    ),
    E2E,
    BRANCH,
  );
  expect(waiting.leftOut).toEqual(['pullRequests.nodes.0.title']);
  expect(waiting.pullRequests).toHaveLength(waiting.total - 1);
  expect(queueWaitingCutShort(waiting)).toBe(true);

  const whole = await queueWaiting(client(replayFetch('queue_waiting_e2e')), E2E, BRANCH);
  expect(queueWaitingCutShort(whole)).toBe(false);
});

test('the open pull requests from a branch are the repositorys own, never a forks', async () => {
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
  // A fork's branch of the same name is never listed, so forks can't push the repository's out.
  expect(fork).toBe(FORK_BRANCH);
  expect(await openPullsFromHead(github, E2E, FORK_BRANCH)).toEqual({
    branch: FORK_BRANCH,
    pullRequests: [],
    cutShort: false,
  });
});

/** The repository a pull request in REST's list comes from. */
function headRepo(pull: JsonObject): JsonObject {
  return object(object(pull['head'])['repo']);
}

/** `pulls_from_head_e2e`'s chain-1 answer, edited by `edit`, its one pull request as `pull`. */
function chainEdited(edit: (pull: JsonObject, interaction: Interaction) => void): ReplayFetch {
  return edited(
    'pulls_from_head_e2e',
    (interaction) => interaction.request.url.includes('chain-1'),
    (interaction) => {
      const body = interaction.response.body;
      const pull = Array.isArray(body) ? body[0] : undefined;
      edit(object(pull), interaction);
    },
  );
}

test('a pull request from another repository of the owner isnt from the repositorys branch', async () => {
  const generation = new Fields(cassette('pulls_from_head_e2e').info.setup, 'setup').integer(
    'generation',
  );
  const [chain = ''] = branches(generation);
  const read = async (edit: (pull: JsonObject, interaction: Interaction) => void) =>
    openPullsFromHead(client(chainEdited(edit)), E2E, chain);

  const other = await read((pull) => {
    headRepo(pull)['full_name'] = 'rozed-dev/e2e-fork';
  });
  expect(other.pullRequests.map((pull) => pull.sameRepository)).toEqual([false]);
  // A fork that's gone has no head repository.
  const gone = await read((pull) => {
    object(pull['head'])['repo'] = null;
  });
  expect(gone.pullRequests.map((pull) => pull.sameRepository)).toEqual([false]);
  // GitHub's names don't tell case apart.
  const cased = await read((pull) => {
    headRepo(pull)['full_name'] = 'Rozed-Dev/E2E';
  });
  expect(cased.pullRequests.map((pull) => pull.sameRepository)).toEqual([true]);
  // A next page means the list was cut short.
  const longer = await read((_, interaction) => {
    interaction.response.headers['link'] =
      '<https://api.github.com/repositories/1/pulls?head=x&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/pulls?head=x&page=3>; rel="last"';
  });
  expect(longer.cutShort).toBe(true);
});
