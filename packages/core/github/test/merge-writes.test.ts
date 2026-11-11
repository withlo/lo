/**
 * Async merges, the merge queue, auto-merge, GitHub stacks and base branches, replayed from what
 * `rozed-bot` did on `rozed-dev/e2e`, through the scenarios that recorded them
 * (`scenarios/merge-writes.ts`) and with the setup each cassette keeps. The replaying `fetch`
 * answers a request only when it's the one recorded, body and variables and all, so each test also
 * checks what Lo sends.
 */

import {
  cassette,
  Replay,
  replayFetch,
  utf8,
  type Interaction,
  type Json,
  type ReplayFetch,
} from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient } from '../src/client.ts';
import { GithubError } from '../src/errors.ts';
import { isRecord } from '../src/graphql.ts';
import {
  adminOverride,
  createStack,
  dequeueNamed,
  describeMergeRefusal,
  enableAutoMerge,
  enqueue,
  isRefusal,
  jump,
  mergeAsync,
  mergeRefusalFrom,
  queueMerge,
  runConversionStep,
  stackNumbers,
  stacks,
  unstack,
  withLayersBelow,
  type AsyncMerge,
  type AutoMergeRequest,
  type MergeRefusal,
  type MergeRequest,
  type Submitted,
  type Via,
} from '../src/merge-writes.ts';
import { pullMerged } from '../src/pulls.ts';
import { PullRef } from '../src/refs.ts';
import { Token } from '../src/token.ts';
import {
  attempt,
  autoMerge,
  BASE,
  direct,
  layerMoved,
  lookups,
  merged,
  moved,
  pullOf,
  queue,
  refused,
  repo,
  setupOf,
  stackMerge,
  stacks as stacksScenario,
  type Followed,
  type Pause,
  type Pr,
  type Result,
  type Setup,
} from './scenarios/merge-writes.ts';

/** Replays the scenario's `cassette`, with Lo's stack lookups before merges recorded since. */
function replay(name: string): { client: GithubClient; fetch: ReplayFetch; setup: Setup } {
  const recorded = cassette(name);
  const interactions = [
    ...recorded.interactions.map(({ interaction }) => interaction),
    ...lookups(),
  ];
  const fetch = replayFetch(new Replay(name, interactions));
  const client = new GithubClient({ fetch, token: new Token('gho_FAKE') });
  return { client, fetch, setup: setupOf(recorded.info) };
}

const noPause: Pause = () => Promise.resolve();

/** The JSON a request body holds, if it holds any. */
function jsonOf(body: Uint8Array): unknown {
  if (body.length === 0) return undefined;
  try {
    return JSON.parse(utf8(body));
  } catch {
    return undefined;
  }
}

/** What each request was: a GraphQL operation's name, or a REST method and path within e2e. */
function requests(fetch: ReplayFetch): string[] {
  return fetch.seen.map((seen) => {
    const body = jsonOf(seen.body);
    if (isRecord(body) && typeof body['operationName'] === 'string') return body['operationName'];
    const path = seen.url
      .replace('https://api.github.com', '')
      .replace(/^\/repos\/rozed-dev\/e2e/, '');
    return `${seen.method} ${path}`;
  });
}

/** The JSON bodies sent with `method`, in order. */
function bodies(fetch: ReplayFetch, method: string): unknown[] {
  return fetch.seen
    .filter((seen) => seen.method === method && seen.body.length > 0)
    .map((seen) => jsonOf(seen.body));
}

/** The variables of each GraphQL request that ran `operation`, or of every one, in order. */
function variablesOf(fetch: ReplayFetch, operation?: string): unknown[] {
  return fetch.seen.flatMap((seen) => {
    const body = jsonOf(seen.body);
    if (!isRecord(body)) return [];
    return operation === undefined || body['operationName'] === operation
      ? [body['variables']]
      : [];
  });
}

function isMergeRefusal(value: unknown): value is MergeRefusal {
  return isRefusal(value);
}

/** The refusal `result` is: a value Lo or GitHub refused with. */
function refusal(result: Result<unknown>): MergeRefusal {
  if (!result.ok) throw new Error(`not refused: ${result.error.message}`);
  if (!isMergeRefusal(result.value)) {
    throw new Error(`not refused: ${JSON.stringify(result.value)}`);
  }
  return result.value;
}

/** What `result` answered, which was no refusal and no error. */
function got<T>(result: Result<T | MergeRefusal>): T {
  if (!result.ok) throw result.error;
  if (isRefusal(result.value)) throw new Error(`refused: ${JSON.stringify(result.value)}`);
  return result.value;
}

/** The error `result` failed with. */
function failure(result: Result<unknown>): GithubError {
  if (result.ok) throw new Error(`answered: ${JSON.stringify(result.value)}`);
  return result.error;
}

function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`no ${what}`);
  return value;
}

/** The UUID GitHub gave a merge it took. */
function taken(followed: Followed): string {
  const submitted = got(followed.submitted);
  if (submitted.kind !== 'accepted') throw new Error(`not taken: ${JSON.stringify(submitted)}`);
  expect(submitted.answer.status).toBe('pending');
  expect(submitted.answer.details.uuid).toBe(submitted.uuid);
  expect(submitted.answer.details.message).toBe('Merge request enqueued.');
  return submitted.uuid;
}

/** The answers to asking how a merge goes: pending until the last. */
function ended(followed: Followed): AsyncMerge {
  const answers = followed.answers.map((answer) => got(answer));
  const last = answers.at(-1);
  if (last === undefined) throw new Error('asked at least once');
  for (const answer of answers.slice(0, -1)) {
    expect(answer.status).toBe('pending');
    expect(answer.details.message).toBe('Merge request is in progress.');
  }
  return last;
}

/** What a submitted merge answered, which was no refusal. */
function submittedOf(result: Result<Submitted | MergeRefusal>): Submitted {
  return got(result);
}

test('a merge github takes is followed until it merges', async () => {
  const { client, fetch, setup } = replay('merge_writes_e2e_merged');
  const seen = await merged(client, setup, noPause);
  const pr = defined(setup.merged, 'merged pull request');
  const { number } = pr;

  const uuid = taken(seen.merged);
  const poll = `GET /pulls/${number}/merge-async/${uuid}`;
  const put = `PUT /pulls/${number}/merge-async`;
  // Each merge first looks for a stack holding it, which would merge with it: none.
  const lookup = `GET /stacks?pull_request=${number}`;
  expect(requests(fetch)).toEqual([
    lookup,
    put,
    poll,
    poll,
    poll,
    lookup,
    put,
    poll,
    `GET /pulls/${number}`,
  ]);
  // What Lo sends: the head on screen, the method, a direct merge, and the squash's title.
  expect(bodies(fetch, 'PUT')[0]).toEqual({
    sha: pr.head,
    merge_method: 'squash',
    merge_action: 'direct_merge',
    commit_title: `Fixture 9b: merge run ${setup.run}`,
  });
  // GitHub's answer repeats what it took.
  const accepted = submittedOf(seen.merged.submitted);
  if (accepted.kind !== 'accepted') throw new Error('not taken');
  const { details } = accepted.answer;
  expect(details.merge_method).toBe('squash');
  expect(details.merge_action).toBe('direct_merge');
  expect(details.expected_head_sha).toBe(pr.head);
  expect(details.bypass_rules).toBe(false);

  const last = ended(seen.merged);
  expect(last.status).toBe('merged');
  expect(last.details.message).toBe('Pull request was merged.');
  const sha = defined(last.details.sha, 'commit it made');
  expect(last.details.uuid).toBeUndefined();

  // Sent again, it's done already: a 200 naming the same commit, and nothing new to follow.
  const again = submittedOf(seen.again);
  if (again.kind !== 'done') throw new Error(`not done: ${JSON.stringify(again)}`);
  expect(again.answer.status).toBe('merged');
  expect(again.answer.details.message).toBe('Pull request is already merged.');
  expect(again.answer.details.sha).toBe(sha);
  // The UUID still answers once it's merged.
  const askedAgain = got(defined(seen.askedAgain, 'second answer'));
  expect(askedAgain.status).toBe('merged');
  const after = got(seen.after);
  expect(pullMerged(after)).toBe(true);
  expect(after.base.ref).toBe(BASE);
});

test('a head that moved is refused and a merge already running is followed', async () => {
  const { client, fetch, setup } = replay('merge_writes_e2e_moved');
  const seen = await moved(client, setup, noPause);
  const pr = defined(setup.moved, 'moved pull request');
  const { number } = pr;

  // Its first commit isn't its head: refused at once, with a 400.
  expect(refusal(seen.stale.submitted)).toEqual({ refusal: 'headMoved' });
  expect(seen.stale.answers).toEqual([]);
  expect(bodies(fetch, 'PUT')[0]).toMatchObject({ sha: setup.stale });

  // At its head, twice at once: the second gets the first's UUID, from a 409.
  const first = submittedOf(seen.first);
  if (first.kind !== 'accepted') throw new Error(`not taken: ${JSON.stringify(first)}`);
  const second = submittedOf(seen.second);
  if (second.kind !== 'alreadyRunning') {
    throw new Error(`not already running: ${JSON.stringify(second)}`);
  }
  expect(second.uuid).toBe(first.uuid);
  expect(second.answer.status).toBe('pending');
  expect(second.answer.details.message).toBe(
    'A merge request already exists for this pull request.',
  );
  expect(second.answer.details.expected_head_sha).toBe(pr.head);
  const last = got(defined(seen.answers.at(-1), 'answer'));
  expect(last.status).toBe('merged');
  expect(pullMerged(got(seen.after))).toBe(true);
  const put = `PUT /pulls/${number}/merge-async`;
  const lookup = `GET /stacks?pull_request=${number}`;
  expect(requests(fetch).slice(0, 6)).toEqual([lookup, put, lookup, put, lookup, put]);
});

test('github refuses some merges at once and others as they run', async () => {
  const { client, fetch, setup } = replay('merge_writes_e2e_refused');
  const seen = await refused(client, setup, noPause);

  // GitHub's state checks refuse at once, with a 400 that says why.
  expect(refusal(seen.draft.submitted)).toEqual({ refusal: 'draft' });
  expect(refusal(seen.closed.submitted)).toEqual({ refusal: 'closed' });
  // A pull request that doesn't exist, and a UUID GitHub never gave, are "not found".
  expect(failure(seen.missing.submitted).detail.kind).toBe('notFound');
  expect(failure(seen.unknownUuid).detail.kind).toBe('notFound');

  // The rest are taken, and fail as they run: a conflict, and the base branch's rules.
  taken(seen.conflict);
  const conflict = ended(seen.conflict);
  expect(conflict.status).toBe('failed');
  expect(conflict.details.message).toBe('Pull Request has merge conflicts');
  expect(mergeRefusalFrom(conflict.details.message)).toEqual({ refusal: 'conflict' });
  const approval = 'At least 1 approving review is required by reviewers with write access.';
  const failures: [Followed, string[]][] = [
    [seen.passing, [approval]],
    [seen.failing, [approval, 'Required status check "ci" is failing.']],
  ];
  for (const [followed, rules] of failures) {
    taken(followed);
    const failed = ended(followed);
    expect(failed.status).toBe('failed');
    expect(failed.details.message.startsWith('Repository rule violations found')).toBe(true);
    expect(mergeRefusalFrom(failed.details.message)).toEqual({ refusal: 'rules', rules });
  }
  // Into a queue on a branch without one: taken, then refused as it runs, never merged straight
  // in.
  taken(seen.noQueue);
  const noQueue = ended(seen.noQueue);
  expect(noQueue.status).toBe('failed');
  expect(mergeRefusalFrom(noQueue.details.message)).toEqual({ refusal: 'noMergeQueue' });
  expect(bodies(fetch, 'PUT').at(-1)).toEqual({
    sha: setup.open.head,
    merge_action: 'merge_queue',
  });
  const accepted = submittedOf(seen.noQueue.submitted);
  if (accepted.kind !== 'accepted') throw new Error('not taken');
  expect(accepted.answer.details.merge_method).toBe('default');
  expect(accepted.answer.details.merge_action).toBe('merge_queue');
});

test('auto merge is refused while the repository doesnt allow it', async () => {
  const { client, fetch, setup } = replay('merge_writes_e2e_auto_merge');
  const seen = await autoMerge(client, setup);

  for (const result of [seen.blocked, seen.clean, seen.wrongHead]) {
    expect(refusal(result)).toEqual({ refusal: 'autoMergeNotAllowed' });
  }
  // Turning it off where it isn't on isn't refused.
  const off = got(seen.off);
  expect(off.number).toBe(setup.passing.number);
  expect(off.autoMerge).toBeUndefined();
  expect(off.inQueue).toBe(false);
  // Turning it on first looks for a stack holding the pull request: the layers below would merge
  // with it. Turning it off can't merge anything.
  const [passing, open] = [setup.passing.number, setup.open.number];
  expect(requests(fetch)).toEqual([
    `GET /stacks?pull_request=${passing}`,
    'EnablePullRequestAutoMerge',
    `GET /stacks?pull_request=${open}`,
    'EnablePullRequestAutoMerge',
    'DisablePullRequestAutoMerge',
    `GET /stacks?pull_request=${passing}`,
    'EnablePullRequestAutoMerge',
  ]);
  // The method is always sent, and the head on screen expected.
  const sent = variablesOf(fetch);
  expect(sent[0]).toEqual({
    pullRequestId: setup.passing.nodeId,
    mergeMethod: 'SQUASH',
    expectedHeadOid: setup.passing.head,
  });
  expect(sent[3]).toMatchObject({ expectedHeadOid: setup.stale });
});

test('the merge queue takes pull requests in and lets them go', async () => {
  const { client, fetch, setup } = replay('merge_writes_e2e_queue');
  const seen = await queue(client, setup, noPause);

  // Expecting a head it doesn't have: refused.
  expect(refusal(seen.wrongHead)).toEqual({ refusal: 'headMoved' });
  // "Merge when ready" needs the repository's auto-merge setting on a queue's branch too.
  expect(refusal(seen.autoMergeOn)).toEqual({ refusal: 'autoMergeNotAllowed' });
  expect(got(seen.autoMergeOff).autoMerge).toBeUndefined();

  const slow = got(seen.slow);
  expect(slow.number).toBe(setup.queueSlow.number);
  expect([slow.position, slow.state]).toEqual([1, 'QUEUED']);
  expect(slow.jump).toBe(false);
  expect(slow.id).toMatch(/^MQE_/);
  // Jumping put it ahead of everything waiting, which was nothing: the slow one was already being
  // built.
  const jumped = got(seen.jumped);
  expect(jumped.number).toBe(setup.queueFail.number);
  expect(jumped.jump).toBe(true);
  expect([jumped.position, jumped.state]).toEqual([2, 'QUEUED']);
  // Taken out: GitHub answers with the entry it had. Taken out again: refused, naming it by its
  // title.
  expect(got(seen.dequeued).entry).toEqual(jumped);
  const again = refusal(seen.dequeuedAgain);
  if (again.refusal !== 'other') throw new Error(JSON.stringify(again));
  expect(again.message.startsWith(`Failed to remove PR #${setup.queueFail.number}`)).toBe(true);

  // Into the queue as an async merge: taken, then enqueued, which is where it ends. Sent again,
  // it's done already.
  const uuid = taken(seen.pass);
  const enqueued = ended(seen.pass);
  expect(enqueued.status).toBe('enqueued');
  expect(enqueued.details.message).toBe('Pull request was added to the merge queue.');
  const done = submittedOf(seen.passAgain);
  if (done.kind !== 'done') throw new Error(`not done: ${JSON.stringify(done)}`);
  expect(done.answer.status).toBe('enqueued');
  expect(done.answer.details.message).toBe('Pull request is already in the merge queue.');
  // A branch with no queue.
  expect(refusal(seen.noQueue)).toEqual({ refusal: 'noMergeQueue' });
  expect(refusal(seen.notQueued)).toEqual({ refusal: 'noMergeQueue' });

  const pass = setup.queuePass.number;
  const [slowPr, fail, open] = [setup.queueSlow, setup.queueFail, setup.open];
  expect(requests(fetch)).toEqual([
    lookupRequest(fail.number),
    'EnqueuePullRequest',
    lookupRequest(slowPr.number),
    'EnablePullRequestAutoMerge',
    'DisablePullRequestAutoMerge',
    lookupRequest(slowPr.number),
    'EnqueuePullRequest',
    lookupRequest(fail.number),
    'EnqueuePullRequest',
    'DequeuePullRequest',
    'DequeuePullRequest',
    `GET /stacks?pull_request=${pass}`,
    `PUT /pulls/${pass}/merge-async`,
    `GET /pulls/${pass}/merge-async/${uuid}`,
    `GET /stacks?pull_request=${pass}`,
    `PUT /pulls/${pass}/merge-async`,
    lookupRequest(open.number),
    'EnqueuePullRequest',
    'DequeuePullRequest',
  ]);
  expect(variablesOf(fetch, 'EnqueuePullRequest')[2]).toEqual({
    pullRequestId: setup.queueFail.nodeId,
    expectedHeadOid: setup.queueFail.head,
    jump: true,
  });
});

test('stacks are made added to and unstacked and layers moved onto the one below', async () => {
  const { client, fetch, setup } = replay('merge_writes_e2e_stacks');
  const seen = await stacksScenario(client, setup, noPause);
  const [bottom, middle, top] = setup.stack;
  if (bottom === undefined || middle === undefined || top === undefined) {
    throw new Error('the stack has three pull requests');
  }

  // "Not found" means the Stacks API isn't there.
  expect(got(seen.unavailable)).toBeUndefined();
  const listed = defined(got(seen.listed), 'listed stacks');
  expect(listed.stacks.every((found) => found.open)).toBe(true);
  expect(listed.cutShort).toBe(false);

  const created = got(seen.created);
  expect(stackNumbers(created)).toEqual(numbersOf([bottom, middle]));
  expect(created.base.ref).toBe(BASE);
  expect(created.node_id.startsWith('PRS_')).toBe(true);
  const createdAgain = refusal(seen.createdAgain);
  if (createdAgain.refusal !== 'alreadyStacked') throw new Error(JSON.stringify(createdAgain));
  expect(createdAgain.message).toContain('already part of a stack');
  expect(refusal(seen.notAChain)).toEqual({ refusal: 'notAChain' });
  // The third can't join while it's based on the base branch.
  expect(refusal(seen.addUnchained)).toEqual({ refusal: 'notAChain' });

  // Moved onto the second's branch; then again, which changes nothing; then expected on a branch
  // it isn't on, which leaves it where it is.
  const retargeted = got(seen.retargeted);
  if (retargeted.kind !== 'retargeted') throw new Error(JSON.stringify(retargeted));
  expect(retargeted.pull.base.ref).toBe(middle.branch);
  expect(got(seen.retargetedAgain).base.ref).toBe(middle.branch);
  expect(refusal(seen.retargetChanged)).toEqual({ refusal: 'baseChanged', now: middle.branch });
  expect(refusal(seen.missingBase)).toEqual({
    refusal: 'other',
    message: "Proposed base branch 'e9b/does-not-exist' was not found",
  });

  const added = got(seen.added);
  if (added.kind !== 'stacked') throw new Error(JSON.stringify(added));
  expect(added.stack.number).toBe(created.number);
  expect(stackNumbers(added.stack)).toEqual(numbersOf([bottom, middle, top]));
  const ofThird = defined(got(seen.ofThird), 'stacks of the third');
  expect(ofThird.stacks).toEqual([added.stack]);
  // Unstacked, GitHub dissolves it (a 204), and the three make a new one.
  expect(got(seen.unstacked).left).toBeUndefined();
  const remade = got(seen.remade);
  if (remade.kind !== 'stacked') throw new Error(JSON.stringify(remade));
  expect(remade.stack.number).not.toBe(created.number);
  expect(stackNumbers(remade.stack)).toEqual(numbersOf([bottom, middle, top]));

  const [stackNumber, third, open] = [created.number, top.number, setup.open.number];
  expect(requests(fetch)).toEqual([
    'GET /repos/rozed-dev/does-not-exist/stacks?per_page=100',
    'GET /stacks?per_page=100',
    'POST /stacks',
    'POST /stacks',
    'POST /stacks',
    `POST /stacks/${stackNumber}/add`,
    // A base branch change reads the pull request first, and changes it only from the branch
    // expected.
    `GET /pulls/${third}`,
    `PATCH /pulls/${third}`,
    `GET /pulls/${third}`,
    `GET /pulls/${third}`,
    `PATCH /pulls/${open}`,
    `POST /stacks/${stackNumber}/add`,
    `GET /stacks?pull_request=${third}`,
    `POST /stacks/${stackNumber}/unstack`,
    'POST /stacks',
  ]);
  expect(bodies(fetch, 'POST')[0]).toEqual({ pull_requests: numbersOf([bottom, middle]) });
  expect(bodies(fetch, 'PATCH')[0]).toEqual({ base: middle.branch });
});

test('merging a stacks top layer reads the stack then merges every layer', async () => {
  const { client, fetch, setup } = replay('merge_writes_e2e_stack_merge');
  const seen = await stackMerge(client, setup, noPause);
  const top = defined(setup.stack.at(-1), 'top layer').number;

  // Lo reads the stack first, in the same turn, and its layers are as shown.
  const uuid = taken(seen.merged);
  const last = ended(seen.merged);
  expect(last.status).toBe('merged');
  // It took a while: GitHub was asked more than twice.
  expect(seen.merged.answers.length).toBeGreaterThan(2);
  for (const layer of seen.layers) {
    expect(pullMerged(got(layer))).toBe(true);
  }
  // Once every layer merged, the stack is closed, so it isn't listed.
  const after = defined(got(seen.stack), 'stack list');
  expect(after.stacks).toEqual([]);
  expect(after.cutShort).toBe(false);
  expect(requests(fetch).slice(0, 3)).toEqual([
    `GET /stacks?pull_request=${top}`,
    `PUT /pulls/${top}/merge-async`,
    `GET /pulls/${top}/merge-async/${uuid}`,
  ]);
});

test('a stack whose lower layer moved isnt merged', async () => {
  const { client, fetch, setup } = replay('merge_writes_e2e_layer_moved');
  const seen = await layerMoved(client, setup, noPause);
  const [bottom, top] = setup.layered;
  const { pushed } = setup;
  if (bottom === undefined || top === undefined || setup.layered.length !== 2 || !pushed) {
    throw new Error('the run made a stack of two, and pushed to its bottom');
  }

  // Lo read the stack, saw the bottom's new head, and sent nothing.
  expect(refusal(seen.refused)).toEqual({ refusal: 'layerMoved', pr: bottom.number, now: pushed });
  // Lo's merge naming no layer below: the bottom would merge with it, so Lo sent nothing.
  expect(refusal(seen.unnamed)).toEqual({
    refusal: 'unnamedLayers',
    below: [bottom.number],
    via: 'merge',
  });
  const lookup = `GET /stacks?pull_request=${top.number}`;
  const sent = requests(fetch);
  expect(sent.slice(0, 2)).toEqual([lookup, lookup]);
  // The PUT that follows is that merge sent past Lo, naming only the top's head, which GitHub
  // takes, then fails because the top isn't based on the bottom's new head. Neither layer merged.
  expect(sent[2]).toBe(`PUT /pulls/${top.number}/merge-async`);
  expect(bodies(fetch, 'PUT')).toEqual([
    { sha: top.head, merge_method: 'squash', merge_action: 'direct_merge' },
  ]);
  taken(seen.unchecked);
  const failed = ended(seen.unchecked);
  expect(failed.status).toBe('failed');
  expect(mergeRefusalFrom(failed.details.message).refusal).toBe('stackNeedsRebase');
  for (const layer of seen.layers) {
    expect(pullMerged(got(layer))).toBe(false);
  }
  expect(got(defined(seen.layers[0], 'bottom layer')).head.sha).toBe(pushed);
});

/** `n` as a 40-digit commit SHA. */
function head(n: number): string {
  return String(n).padStart(40, '0');
}

type PullJson = {
  number: number;
  state: string;
  draft: boolean;
  merged_at: string | null;
  head: { ref: string; sha: string };
};
type StackJson = {
  id: number;
  number: number;
  node_id: string;
  base: { ref: string };
  open: boolean;
  pull_requests: PullJson[];
};

/** A stack as the Stacks API lists it. */
function stack(number: number, open: boolean, prs: readonly [number, boolean][]): StackJson {
  return {
    id: number,
    number,
    node_id: `PRS_${number}`,
    base: { ref: BASE },
    open,
    pull_requests: prs.map(([pr, isMerged]) => ({
      number: pr,
      state: isMerged || !open ? 'closed' : 'open',
      draft: false,
      merged_at: isMerged ? '2026-11-08T11:00:00Z' : null,
      head: { ref: `e9b/${pr}`, sha: head(pr) },
    })),
  };
}

/**
 * A REST interaction: `method` on `path` within e2e, with `requestBody` if any, answered with
 * `status`, `body` and `headers`.
 */
function rest(
  method: string,
  path: string,
  requestBody: string | undefined,
  status: number,
  body: Json,
  headers: Record<string, string> = {},
): Interaction {
  return {
    request: {
      method,
      url: `https://api.github.com/repos/rozed-dev/e2e${path}`,
      ...(requestBody === undefined ? {} : { body: requestBody }),
    },
    response: { status, headers, body },
  };
}

/** The Stacks API's answer that pull request `number` is in no stack. */
function noStack(number: number): Interaction {
  return rest('GET', `/stacks?pull_request=${number}`, undefined, 200, []);
}

/** GitHub's answer to the GraphQL `operation` with `variables`, as its schema documents it. */
function documentedGraphql(operation: string, variables: Json, data: Json): Interaction {
  return {
    request: { method: 'POST', url: 'https://api.github.com/graphql', operation, variables },
    response: { status: 200, headers: {}, body: { data } },
  };
}

function replaying(interactions: Interaction[]): { client: GithubClient; fetch: ReplayFetch } {
  const fetch = replayFetch(new Replay('made', interactions));
  return { client: new GithubClient({ fetch, token: new Token('gho_FAKE') }), fetch };
}

const SERVER_ERROR: Json = { message: 'Server Error' };

/** The Stacks API's answer to looking up pull request `number`'s stacks. */
function stackLookup(
  number: number,
  body: Json,
  status = 200,
  headers: Record<string, string> = {},
): Interaction {
  return rest('GET', `/stacks?pull_request=${number}`, undefined, status, body, headers);
}

/** The request that looks up pull request `number`'s stacks. */
function lookupRequest(number: number): string {
  return `GET /stacks?pull_request=${number}`;
}

/** The numbers of `prs`. */
function numbersOf(prs: readonly Pr[]): number[] {
  return prs.map((pr) => pr.number);
}

/** What taking pull request `number` out of the merge queue answers with `data`. */
function dequeueAnswer(number: number, data: Json): Interaction {
  return documentedGraphql(
    'DequeuePullRequest',
    { id: `PR_${number}` },
    { dequeuePullRequest: data },
  );
}

/** What adding #47 to the front of the merge queue answers with `data`. */
function jumpAnswer(data: Json): Interaction {
  return documentedGraphql(
    'EnqueuePullRequest',
    { pullRequestId: 'PR_47', expectedHeadOid: head(47), jump: true },
    data,
  );
}

/** The merge queue's entry for #`number` at `position`, as `QueueView` lists it. */
function queueSlot(number: number, position: number): Json {
  return {
    id: `MQE_${number}`,
    position,
    state: 'QUEUED',
    enqueuedAt: '2026-11-08T12:00:00Z',
    estimatedTimeToMerge: null,
    jump: false,
    solo: false,
    enqueuer: { __typename: 'User', login: 'rozed-bot' },
    baseCommit: null,
    headCommit: null,
    pullRequest: {
      id: `PR_${number}`,
      number,
      title: `#${number}`,
      url: `https://github.com/rozed-dev/e2e/pull/${number}`,
      headRefOid: head(number),
      viewerDidAuthor: true,
      author: { __typename: 'User', login: 'rozed-bot' },
    },
  };
}

/** Takes pull request `number` out of the queue naming `above`, the layers above it that go with it. */
function takeOut(client: GithubClient, number: number, above: number[]) {
  const pull = new PullRef('rozed-dev', 'e2e', number);
  return attempt(dequeueNamed(client, pull, `PR_${number}`, BASE, above));
}

/** The address of page `n` of the repository's stacks. */
function stacksPage(n: number): string {
  return `https://api.github.com/repositories/1/stacks?per_page=100&page=${n}`;
}

/** What a merge refusal for unnamed layers says when `via` would take #45 and #46 with it. */
function unnamedSentence(via: Via): string {
  return describeMergeRefusal({ refusal: 'unnamedLayers', below: [45, 46], via });
}

/** `request` as a GitHub stack's merge naming `layers`, which are full SHAs. */
function withLayers(request: MergeRequest, layers: { pr: number; head: string }[]): MergeRequest {
  const stackMerged = withLayersBelow(request, layers);
  if (isRefusal(stackMerged)) throw new Error(`refused: ${JSON.stringify(stackMerged)}`);
  return stackMerged;
}

/** A request `made` without a refusal. */
function requested(made: MergeRequest | { refusal: string }): MergeRequest {
  if (isRefusal(made)) throw new Error(`refused: ${JSON.stringify(made)}`);
  return made;
}

/** The `merge-async` GitHub takes for a squash of `pr` at its head. */
function takenMerge(pr: number): Interaction {
  return rest(
    'PUT',
    `/pulls/${pr}/merge-async`,
    `{"sha":"${head(pr)}","merge_method":"squash","merge_action":"direct_merge"}`,
    202,
    {
      status: 'pending',
      details: { message: 'Merge request enqueued.', uuid: 'f309b798-334d-4a61-a591-8b4155dbdf94' },
    },
  );
}

test('a stack that changed or cant be read isnt merged', async () => {
  const request = withLayers(direct(head(47), 'SQUASH'), [
    { pr: 45, head: head(45) },
    { pr: 46, head: head(46) },
  ]);
  const pull = new PullRef('rozed-dev', 'e2e', 47);
  // The bottom merged since Lo showed the stack.
  const mergedBelow = stackLookup(47, [
    stack(48, true, [
      [45, true],
      [46, false],
      [47, false],
    ]),
  ]);
  // The top isn't in a stack any more.
  const unstacked = stackLookup(47, []);
  for (const answer of [mergedBelow, unstacked]) {
    const { client, fetch } = replaying([answer]);
    const stopped = await attempt(mergeAsync(client, pull, request));
    expect(refusal(stopped)).toEqual({ refusal: 'stackChanged' });
    // Nothing was sent after the lookup.
    expect(fetch.seen).toHaveLength(1);
  }
  // As shown: the top's own head moved.
  const movedTop = stack(48, true, [
    [45, false],
    [46, false],
    [47, false],
  ]);
  defined(movedTop.pull_requests[2], 'top layer').head.sha = head(99);
  const movedStack = replaying([stackLookup(47, [movedTop])]);
  const movedRefusal = await attempt(mergeAsync(movedStack.client, pull, request));
  expect(refusal(movedRefusal)).toEqual({ refusal: 'headMoved' });
  // The stack can't be read: nothing sent, and nothing that may have been.
  const unread = replaying([stackLookup(47, SERVER_ERROR, 502)]);
  const unreadRefusal = await attempt(mergeAsync(unread.client, pull, request));
  expect(refusal(unreadRefusal).refusal).toBe('unchecked');
  expect(unread.fetch.seen).toHaveLength(1);
});

test('a merge that would take layers below with it must name them', async () => {
  const three = [
    stack(48, true, [
      [45, false],
      [46, false],
      [47, false],
    ]),
  ];
  const top = new PullRef('rozed-dev', 'e2e', 47);
  // GitHub would merge #45 and #46 with #47: a merge, a queue's or an admin's, that doesn't name
  // them is refused before it's sent, so no confirmation can leave them out.
  const unnamed: [MergeRequest, 'merge' | 'queue' | 'adminOverride'][] = [
    [direct(head(47), 'SQUASH'), 'merge'],
    [requested(queueMerge(head(47))), 'queue'],
    [requested(adminOverride(head(47), 'SQUASH')), 'adminOverride'],
  ];
  for (const [request, via] of unnamed) {
    const { client, fetch } = replaying([stackLookup(47, three)]);
    const stopped = await attempt(mergeAsync(client, top, request));
    expect(refusal(stopped)).toEqual({ refusal: 'unnamedLayers', below: [45, 46], via });
    // Nothing was sent after the lookup.
    expect(requests(fetch)).toEqual(['GET /stacks?pull_request=47']);
  }
  // Each says what would happen to them.
  expect(unnamedSentence('merge')).toBe(
    "#45 and #46, below it in its GitHub stack, would merge with it, so Lo didn't merge",
  );
  expect(unnamedSentence('queue')).toBe(
    "#45 and #46, below it in its GitHub stack, would join the merge queue with it, so Lo didn't add it",
  );
  expect(unnamedSentence('autoMerge')).toBe(
    "#45 and #46, below it in its GitHub stack, would merge with it when auto-merge merges it, so Lo didn't turn auto-merge on",
  );
  expect(unnamedSentence('adminOverride')).toBe(
    "GitHub merges past the rules only a stack's bottom layer, and #45 and #46 is below it, so Lo didn't merge",
  );

  // Named, it's sent.
  const named = withLayers(direct(head(47), 'SQUASH'), [
    { pr: 45, head: head(45) },
    { pr: 46, head: head(46) },
  ]);
  const { client, fetch } = replaying([stackLookup(47, three), takenMerge(47)]);
  const sent = await attempt(mergeAsync(client, top, named));
  expect(submittedOf(sent).kind).toBe('accepted');
  expect(requests(fetch)).toEqual(['GET /stacks?pull_request=47', 'PUT /pulls/47/merge-async']);
  // The bottom layer has nothing below it to name.
  const bottom = new PullRef('rozed-dev', 'e2e', 45);
  const sentBottom = replaying([stackLookup(45, three), takenMerge(45)]);
  const request = direct(head(45), 'SQUASH');
  const bottomSent = await attempt(mergeAsync(sentBottom.client, bottom, request));
  expect(submittedOf(bottomSent).kind).toBe('accepted');
});

test('an enqueue or auto merge that would take layers below is refused', async () => {
  const top = new PullRef('rozed-dev', 'e2e', 47);
  const three = [
    stack(48, true, [
      [45, false],
      [46, false],
      [47, false],
    ]),
  ];
  const autoMergeRequest: AutoMergeRequest = { expectedHead: head(47), method: 'SQUASH' };
  // Neither write can name the layers below, which GitHub would take with it: refused, with
  // nothing sent but the lookup.
  const first = replaying([stackLookup(47, three)]);
  const enqueued = await attempt(enqueue(first.client, top, 'PR_47', head(47), false));
  expect(refusal(enqueued)).toEqual({ refusal: 'unnamedLayers', below: [45, 46], via: 'queue' });
  expect(requests(first.fetch)).toEqual(['GET /stacks?pull_request=47']);
  const second = replaying([stackLookup(47, three)]);
  const auto = await attempt(enableAutoMerge(second.client, top, 'PR_47', autoMergeRequest));
  expect(refusal(auto)).toEqual({ refusal: 'unnamedLayers', below: [45, 46], via: 'autoMerge' });
  expect(requests(second.fetch)).toEqual(['GET /stacks?pull_request=47']);

  // In no stack, each is sent after the lookup.
  const enqueueAnswer = documentedGraphql(
    'EnqueuePullRequest',
    { pullRequestId: 'PR_47', expectedHeadOid: head(47), jump: false },
    {
      enqueuePullRequest: {
        mergeQueueEntry: {
          id: 'MQE_1',
          position: 1,
          state: 'QUEUED',
          jump: false,
          solo: false,
          enqueuedAt: '2026-11-08T12:00:00Z',
          estimatedTimeToMerge: null,
          headCommit: null,
          pullRequest: { number: 47 },
        },
      },
    },
  );
  const third = replaying([stackLookup(47, []), enqueueAnswer]);
  const entry = got(await attempt(enqueue(third.client, top, 'PR_47', head(47), false)));
  expect(entry.number).toBe(47);
  expect(requests(third.fetch)).toEqual(['GET /stacks?pull_request=47', 'EnqueuePullRequest']);
  const on = documentedGraphql(
    'EnablePullRequestAutoMerge',
    { pullRequestId: 'PR_47', mergeMethod: 'SQUASH', expectedHeadOid: head(47) },
    {
      enablePullRequestAutoMerge: {
        pullRequest: {
          number: 47,
          headRefOid: head(47),
          state: 'OPEN',
          isInMergeQueue: false,
          autoMergeRequest: {
            mergeMethod: 'SQUASH',
            enabledAt: '2026-11-08T12:00:00Z',
            enabledBy: { __typename: 'User', login: 'rozed-bot' },
            commitHeadline: null,
            commitBody: null,
          },
        },
      },
    },
  );
  const fourth = replaying([stackLookup(47, []), on]);
  const state = got(await attempt(enableAutoMerge(fourth.client, top, 'PR_47', autoMergeRequest)));
  expect(state.autoMerge).toBeDefined();
  expect(requests(fourth.fetch)).toEqual([
    'GET /stacks?pull_request=47',
    'EnablePullRequestAutoMerge',
  ]);
});

/**
 * A merge queue entry for #`number` at `position`, as `enqueuePullRequest` and
 * `dequeuePullRequest` answer.
 */
function queueEntry(number: number, position: number, jumping: boolean): Json {
  return {
    id: `MQE_${number}`,
    position,
    state: 'QUEUED',
    jump: jumping,
    solo: false,
    enqueuedAt: '2026-11-08T12:00:00Z',
    estimatedTimeToMerge: null,
    headCommit: null,
    pullRequest: { number },
  };
}

test('a jump checks the stack takes the entry out and adds it back at the front in one go', async () => {
  const pull = new PullRef('rozed-dev', 'e2e', 47);
  const jumpWith = (client: GithubClient, pause: () => Promise<void> = () => Promise.resolve()) =>
    attempt(jump(client, pull, 'PR_47', head(47), pause));

  // A layer of a GitHub stack with other open layers, below it or above: GitHub queues them in
  // order, and takes the ones above out with it. Refused, with only the lookup sent.
  const crowded: [[number, boolean][], number[]][] = [
    [
      [
        [45, false],
        [46, false],
        [47, false],
      ],
      [45, 46],
    ],
    [
      [
        [47, false],
        [48, false],
      ],
      [48],
    ],
  ];
  for (const [layers, others] of crowded) {
    const { client, fetch } = replaying([stackLookup(47, [stack(49, true, layers)])]);
    const stopped = await jumpWith(client);
    expect(refusal(stopped)).toEqual({ refusal: 'stacked', others });
    expect(requests(fetch)).toEqual(['GET /stacks?pull_request=47']);
  }
  expect(describeMergeRefusal({ refusal: 'stacked', others: [45, 46] })).toBe(
    "#45 and #46 are in its GitHub stack, which GitHub queues in order, so Lo didn't move it to the front",
  );
  // Its stack's other layers merged: it's alone, and goes ahead.
  const mergedBelow = stack(49, true, [
    [45, true],
    [47, false],
  ]);
  const alone = replaying([
    stackLookup(47, [mergedBelow]),
    dequeueAnswer(47, { mergeQueueEntry: queueEntry(47, 3, false) }),
    jumpAnswer({ enqueuePullRequest: { mergeQueueEntry: queueEntry(47, 1, true) } }),
  ]);
  expect(got(await jumpWith(alone.client)).kind).toBe('moved');
  expect(requests(alone.fetch)).toEqual([
    'GET /stacks?pull_request=47',
    'DequeuePullRequest',
    'EnqueuePullRequest',
  ]);
  // The stack can't be read: nothing is sent, and the read's error is kept.
  const unread = replaying([stackLookup(47, SERVER_ERROR, 502)]);
  const unchecked = refusal(await jumpWith(unread.client));
  if (unchecked.refusal !== 'queueUnchecked') throw new Error(JSON.stringify(unchecked));
  expect(unchecked.read).toMatchObject({ kind: 'api', status: 502 });
  expect(unread.fetch.seen).toHaveLength(1);

  // In no stack: taken out, then, after the pause, added again at the front.
  let paused = false;
  const free = replaying([
    stackLookup(47, []),
    dequeueAnswer(47, { mergeQueueEntry: queueEntry(47, 3, false) }),
    jumpAnswer({ enqueuePullRequest: { mergeQueueEntry: queueEntry(47, 1, true) } }),
  ]);
  const movedBack = got(
    await jumpWith(free.client, () => {
      paused = true;
      return Promise.resolve();
    }),
  );
  if (movedBack.kind !== 'moved') throw new Error(JSON.stringify(movedBack));
  expect([movedBack.entry.position, movedBack.entry.jump]).toEqual([1, true]);
  expect(paused).toBe(true);
  expect(requests(free.fetch)).toEqual([
    'GET /stacks?pull_request=47',
    'DequeuePullRequest',
    'EnqueuePullRequest',
  ]);

  // Added back refused: it's out, and the outcome says so with GitHub's reason.
  const refusedAgain: Interaction = {
    ...jumpAnswer(null),
    response: {
      status: 200,
      headers: {},
      body: {
        data: { enqueuePullRequest: null },
        errors: [
          {
            type: 'UNPROCESSABLE',
            path: ['enqueuePullRequest'],
            message: 'Failed to add PR #47: expected head oid does not match the current head oid',
          },
        ],
      },
    },
  };
  const out = replaying([
    stackLookup(47, []),
    dequeueAnswer(47, { mergeQueueEntry: queueEntry(47, 3, false) }),
    refusedAgain,
  ]);
  const notBack = got(await jumpWith(out.client));
  if (notBack.kind !== 'notBack') throw new Error('not taken out and refused');
  expect(notBack.failure).toEqual({ refusal: 'headMoved' });

  // Taken out with no entry in the answer: Lo can't tell what GitHub did, so it adds nothing
  // back, and says the dequeue may have been done.
  const lost = replaying([stackLookup(47, []), dequeueAnswer(47, { mergeQueueEntry: null })]);
  const lostError = failure(await jumpWith(lost.client));
  expect(lostError.mayHavePosted()).toBe(true);
  expect(requests(lost.fetch)).toEqual(['GET /stacks?pull_request=47', 'DequeuePullRequest']);
});

test('a dequeue names the layers above that leave the queue with it', async () => {
  // #47, #48 and #49 are a GitHub stack; #47 and #48 are in the queue.
  const layers = [
    stack(50, true, [
      [47, false],
      [48, false],
      [49, false],
    ]),
  ];
  const queueView = documentedGraphql(
    'QueueView',
    { owner: 'rozed-dev', name: 'e2e', branch: BASE },
    {
      rateLimit: null,
      repository: {
        viewerPermission: 'ADMIN',
        mergeQueue: {
          url: 'https://github.com/rozed-dev/e2e/queue/main',
          nextEntryEstimatedTimeToMerge: null,
          configuration: null,
          entries: { totalCount: 2, nodes: [queueSlot(47, 1), queueSlot(48, 2)] },
        },
      },
    },
  );
  const dequeue = dequeueAnswer(47, { mergeQueueEntry: queueEntry(47, 1, false) });
  // Named, the bottom goes, and GitHub takes #48 with it (seen on e2e).
  const named = replaying([stackLookup(47, layers), queueView, dequeue]);
  const taken47 = await takeOut(named.client, 47, [48]);
  expect(got(taken47).entry).toBeDefined();
  expect(requests(named.fetch)).toEqual([
    'GET /stacks?pull_request=47',
    'QueueView',
    'DequeuePullRequest',
  ]);
  // Unnamed, or named otherwise: refused once the stack and the queue are read.
  const unnamed = replaying([stackLookup(47, layers), queueView]);
  const unnamedRefusal = refusal(await takeOut(unnamed.client, 47, []));
  expect(unnamedRefusal).toEqual({ refusal: 'unnamedAbove', above: [48] });
  expect(describeMergeRefusal(unnamedRefusal)).toBe(
    "#48, above it in its GitHub stack, would leave the merge queue with it, so Lo didn't take it out",
  );
  expect(requests(unnamed.fetch)).toEqual(['GET /stacks?pull_request=47', 'QueueView']);
  const otherwise = replaying([stackLookup(47, layers), queueView]);
  expect(refusal(await takeOut(otherwise.client, 47, [48, 49]))).toEqual({
    refusal: 'stackChanged',
  });
  // A layer above the bottom: GitHub takes them out only from the bottom.
  const above = replaying([stackLookup(48, layers)]);
  expect(refusal(await takeOut(above.client, 48, []))).toEqual({ refusal: 'stackChanged' });
  expect(requests(above.fetch)).toEqual(['GET /stacks?pull_request=48']);
  // In no stack, it goes after the lookup alone.
  const alone = replaying([noStack(47), dequeue]);
  got(await takeOut(alone.client, 47, []));
  expect(requests(alone.fetch)).toEqual(['GET /stacks?pull_request=47', 'DequeuePullRequest']);
});

test('without the stacks api a merge goes ahead unless it names layers', async () => {
  // GitHub's "not found" for the lookup: a server without the Stacks API.
  const pull = new PullRef('rozed-dev', 'e2e', 47);
  const notFound = stackLookup(47, { message: 'Not Found' }, 404);
  const plain = direct(head(47), 'SQUASH');
  const free = replaying([notFound, takenMerge(47)]);
  const sent = await attempt(mergeAsync(free.client, pull, plain));
  expect(submittedOf(sent).kind).toBe('accepted');
  expect(requests(free.fetch)).toEqual([
    'GET /stacks?pull_request=47',
    'PUT /pulls/47/merge-async',
  ]);
  // One that names layers can't be checked against a stack that isn't there.
  const bare = replaying([notFound]);
  const named = withLayers(plain, [{ pr: 46, head: head(46) }]);
  const stopped = await attempt(mergeAsync(bare.client, pull, named));
  expect(refusal(stopped)).toEqual({ refusal: 'stackChanged' });
  expect(bare.fetch.seen).toHaveLength(1);
});

test('a stack read that fails keeps what kind of failure it was', async () => {
  const sha = '1c320a8fdea55a1322333aa89b2fe7a52bd49e20';
  const request = direct(sha, 'SQUASH');
  const pull = new PullRef('rozed-dev', 'e2e', 42);
  const failed = async (answer: Interaction) => {
    const { client, fetch } = replaying([answer]);
    const stopped = await attempt(mergeAsync(client, pull, request));
    // Nothing was sent after the lookup.
    expect(fetch.seen).toHaveLength(1);
    const unchecked = refusal(stopped);
    if (unchecked.refusal !== 'unchecked') throw new Error(JSON.stringify(unchecked));
    return new GithubError(unchecked.read);
  };
  // A rate limit: the poller pauses for it as for any read's.
  const limited = await failed(
    stackLookup(42, { message: 'You have exceeded a secondary rate limit.' }, 403, {
      'retry-after': '60',
    }),
  );
  expect(limited.detail).toMatchObject({ kind: 'rateLimited', secondary: true });
  // Single sign-on keeps GitHub's link to authorize the token.
  const ssoUrl = 'https://github.com/orgs/rozed-dev/sso?authorization_request=A1B2';
  const sso = await failed(
    stackLookup(42, { message: 'Resource protected by organization SAML enforcement.' }, 403, {
      'x-github-sso': `required; url=${ssoUrl}`,
    }),
  );
  expect(sso.helpLink()).toEqual({ label: 'Authorize on GitHub', url: ssoUrl });
  // A refused token signs the account out.
  const refusedToken = await failed(stackLookup(42, { message: 'Bad credentials' }, 401));
  expect(refusedToken.isUnauthorized()).toBe(true);
});

// From GitHub's documented answers, for what e2e can't do yet. Re-record each on e2e once it can.

test('turning auto merge on answers how it is now', async () => {
  // Written from GitHub's schema: "Allow auto-merge" is off on e2e, which refuses it
  // (`merge_writes_e2e_auto_merge`). Re-record once it's on, with E5's `e5/auto`.
  const { passing } = setupOf(cassette('merge_writes_e2e_auto_merge').info);
  const variables = {
    pullRequestId: passing.nodeId,
    mergeMethod: 'SQUASH',
    expectedHeadOid: passing.head,
    commitHeadline: 'Squash it',
  };
  const on = {
    enablePullRequestAutoMerge: {
      pullRequest: {
        number: passing.number,
        headRefOid: passing.head,
        state: 'OPEN',
        isInMergeQueue: false,
        autoMergeRequest: {
          mergeMethod: 'SQUASH',
          enabledAt: '2026-11-08T12:00:00Z',
          enabledBy: { __typename: 'User', login: 'rozed-bot' },
          commitHeadline: 'Squash it',
          commitBody: null,
        },
      },
    },
  };
  const { client } = replaying([
    noStack(passing.number),
    documentedGraphql('EnablePullRequestAutoMerge', variables, on),
  ]);
  const request: AutoMergeRequest = {
    expectedHead: passing.head,
    method: 'SQUASH',
    commitHeadline: 'Squash it',
  };
  const state = got(
    await attempt(enableAutoMerge(client, pullOf(passing), passing.nodeId, request)),
  );
  expect(state.autoMerge).toEqual({ method: 'SQUASH', enabledBy: 'rozed-bot' });
  expect(state.head).toBe(passing.head);
  expect(state.inQueue).toBe(false);
});

test('unstacking leaves the layers github cant take out', async () => {
  // From the Stacks API's documentation: a queued or merged layer stays, and GitHub answers with
  // what's left (200) rather than dissolving the stack (204, `merge_writes_e2e_stacks`).
  // Re-record with a layer in e4/queued's queue.
  const remaining: Json = {
    id: 1,
    number: 48,
    node_id: 'PRS_x',
    base: { ref: 'e9b/base' },
    open: true,
    pull_requests: [
      {
        number: 45,
        state: 'open',
        draft: false,
        merged_at: null,
        head: { ref: 'e9b/s1-1', sha: '3169220d288a3f6c59b5968f711e7f58126fa4db' },
      },
    ],
  };
  const answer = rest('POST', '/stacks/48/unstack', undefined, 200, remaining);
  const { client } = replaying([answer]);
  const { left } = got(await attempt(unstack(client, repo(), 48)));
  expect(left && stackNumbers(left)).toEqual([45]);
});

// Answers made from recordings or GitHub's documentation, for what a recording can't produce at
// will: a lost answer, an error below a mutation, pages of stacks.

/**
 * The `stacks` recording's third pull request, and the recorded answer to looking up its stack,
 * once it was added: the stack the bottom two made, now of all three, open.
 */
function recordedLookup(): { third: number; lookup: Interaction } {
  const recorded = cassette('merge_writes_e2e_stacks');
  const third = defined(setupOf(recorded.info).stack[2], 'third pull request').number;
  const found = recorded.interactions.find(({ interaction }) =>
    interaction.request.url.endsWith(`/stacks?pull_request=${third}`),
  );
  return { third, lookup: defined(found, 'recorded lookup').interaction };
}

test('a stack write whose answer was lost is found by a read', async () => {
  // Adding the third pull request to the stack: the answer is lost, and a read finds it there.
  const { third, lookup } = recordedLookup();
  const recorded = lookup.response.body;
  if (!Array.isArray(recorded)) throw new Error('the lookup lists stacks');
  const recordedStack = recorded[0];
  if (!isRecord(recordedStack) || !Array.isArray(recordedStack['pull_requests'])) {
    throw new Error('the lookup lists a stack');
  }
  const stackNumber = recordedStack['number'];
  if (typeof stackNumber !== 'number') throw new Error('the stack has a number');
  const below = recordedStack['pull_requests'].map((pull) =>
    isRecord(pull) ? pull['number'] : undefined,
  );
  const add = rest(
    'POST',
    `/stacks/${stackNumber}/add`,
    `{"pull_requests":[${third}]}`,
    502,
    SERVER_ERROR,
  );
  const added = replaying([add, lookup]);
  const step = { kind: 'addToStack', stack: stackNumber, prs: [third] } as const;
  const done = got(await attempt(runConversionStep(added.client, repo(), step)));
  if (done.kind !== 'stacked') throw new Error(JSON.stringify(done));
  expect(done.stack.number).toBe(stackNumber);
  expect(stackNumbers(done.stack)).toEqual(below);
  expect(requests(added.fetch)).toEqual([
    `POST /stacks/${stackNumber}/add`,
    `GET /stacks?pull_request=${third}`,
  ]);

  // Making #45 and #46 a stack: the answer is lost, and a read finds #48 made of them.
  const create = rest('POST', '/stacks', '{"pull_requests":[45,46]}', 502, SERVER_ERROR);
  const found = rest('GET', '/stacks?pull_request=45', undefined, 200, [
    stack(48, true, [
      [45, false],
      [46, false],
    ]),
  ]);
  const made = replaying([create, found]);
  const madeStack = got(await attempt(createStack(made.client, repo(), [45, 46])));
  expect(madeStack.number).toBe(48);
  expect(requests(made.fetch)).toEqual(['POST /stacks', 'GET /stacks?pull_request=45']);

  // Nothing found: the write's own error, which may have posted. Nothing is sent again.
  const nothing = rest('GET', '/stacks?pull_request=45', undefined, 200, []);
  const missing = replaying([create, nothing]);
  const error = failure(await attempt(createStack(missing.client, repo(), [45, 46])));
  expect(error.mayHavePosted()).toBe(true);
  const posts = requests(missing.fetch).filter((request) => request.startsWith('POST'));
  expect(posts).toHaveLength(1);
});

test('an error below the mutation leaves its change made', async () => {
  // Auto-merge turned on, but GitHub withheld who turned it on, as it does with FORBIDDEN for some
  // tokens: the change was made.
  const { passing } = setupOf(cassette('merge_writes_e2e_auto_merge').info);
  const variables = {
    pullRequestId: passing.nodeId,
    mergeMethod: 'SQUASH',
    expectedHeadOid: passing.head,
  };
  const withheld = [
    {
      type: 'FORBIDDEN',
      path: ['enablePullRequestAutoMerge', 'pullRequest', 'autoMergeRequest', 'enabledBy'],
      message: 'Resource not accessible by integration',
    },
  ];
  const answer = documentedGraphql('EnablePullRequestAutoMerge', variables, {
    enablePullRequestAutoMerge: {
      pullRequest: {
        number: passing.number,
        headRefOid: passing.head,
        state: 'OPEN',
        isInMergeQueue: false,
        autoMergeRequest: {
          mergeMethod: 'SQUASH',
          enabledAt: '2026-11-08T12:00:00Z',
          enabledBy: null,
          commitHeadline: null,
          commitBody: null,
        },
      },
    },
  });
  answer.response.body = { ...asRecord(answer.response.body), errors: withheld };
  const request: AutoMergeRequest = { expectedHead: passing.head, method: 'SQUASH' };
  const kept = replaying([noStack(passing.number), answer]);
  const state = got(
    await attempt(enableAutoMerge(kept.client, pullOf(passing), passing.nodeId, request)),
  );
  const turnedOn = defined(state.autoMerge, 'auto-merge');
  expect(turnedOn.method).toBe('SQUASH');
  expect(turnedOn.enabledBy).toBeUndefined();

  // An answer with an error below the mutation and no data may have made the change.
  const lost = documentedGraphql('EnablePullRequestAutoMerge', variables, null);
  lost.response.body = { data: null, errors: withheld };
  const unknown = replaying([noStack(passing.number), lost]);
  const result = await attempt(
    enableAutoMerge(unknown.client, pullOf(passing), passing.nodeId, request),
  );
  const error = failure(result);
  expect(error.mayHavePosted()).toBe(true);
});

/** `json` as an object. */
function asRecord(json: Json | undefined): Record<string, Json> {
  if (!isRecord(json)) throw new Error(`not an object: ${JSON.stringify(json)}`);
  return json;
}

test('only open stacks are listed from every page', async () => {
  const next = `<${stacksPage(2)}>; rel="next"`;
  const first = rest(
    'GET',
    '/stacks?per_page=100',
    undefined,
    200,
    [
      stack(9, true, [
        [7, false],
        [8, false],
      ]),
      stack(49, false, [
        [45, true],
        [46, true],
        [47, true],
      ]),
    ],
    { link: next },
  );
  const second = rest('GET', '', undefined, 200, [
    stack(50, true, [
      [48, false],
      [49, false],
    ]),
  ]);
  second.request.url = stacksPage(2);
  const pages = replaying([first, second]);
  const listed = defined(got(await attempt(stacks(pages.client, repo()))), 'stack list');
  expect(listed.stacks.map((found) => found.number)).toEqual([9, 50]);
  expect(listed.cutShort).toBe(false);
  expect(pages.fetch.seen).toHaveLength(2);

  // A pull request's closed stack isn't its stack.
  const closed = rest('GET', '/stacks?pull_request=45', undefined, 200, [
    stack(49, false, [
      [45, true],
      [46, true],
      [47, true],
    ]),
  ]);
  const closedPages = replaying([closed]);
  const of = await attempt(stacks(closedPages.client, repo(), 45));
  expect(got(of)).toEqual({ stacks: [], cutShort: false });
});

test('a listing that stops at a thousand stacks says so', async () => {
  // Ten full pages, each pointing at the next: Lo reads ten, and says there were more.
  const pages = Array.from({ length: 10 }, (_, index) => {
    const n = index + 1;
    const answer = rest(
      'GET',
      '/stacks?per_page=100',
      undefined,
      200,
      [stack(n * 2, n % 2 === 0, [[n, false]])],
      { link: `<${stacksPage(n + 1)}>; rel="next"` },
    );
    if (n > 1) answer.request.url = stacksPage(n);
    return answer;
  });
  const { client, fetch } = replaying(pages);
  const listed = defined(got(await attempt(stacks(client, repo()))), 'stack list');
  expect(listed.cutShort).toBe(true);
  // The open ones: every other stack.
  expect(listed.stacks).toHaveLength(5);
  // The eleventh page is not asked for.
  expect(fetch.seen).toHaveLength(10);
});

test('a 409 lo cant read isnt a busy stack', async () => {
  const sha = '1c320a8fdea55a1322333aa89b2fe7a52bd49e20';
  const put = rest(
    'PUT',
    '/pulls/42/merge-async',
    `{"sha":"${sha}","merge_method":"squash","merge_action":"direct_merge"}`,
    409,
    { message: 'Something else' },
  );
  const none = rest('GET', '/stacks?pull_request=42', undefined, 200, []);
  const { client } = replaying([none, put]);
  const request = direct(sha, 'SQUASH');
  const pull = new PullRef('rozed-dev', 'e2e', 42);
  const stopped = await attempt(mergeAsync(client, pull, request));
  expect(refusal(stopped)).toEqual({ refusal: 'other', message: 'Something else' });
});
