/**
 * `MergeJobs` on a fake clock, sending through a real `Poller` and replaying what `rozed-bot`
 * recorded merging its own pull request on `rozed-dev/e2e` (`merge_writes_e2e_merged`), with
 * GitHub's answers repeated or changed where a test needs more of them than one merge gave. Each
 * merge first looks up the GitHub stacks holding its pull request, answered from
 * `merge_writes_e2e_lookups` unless a test gives its own answer.
 *
 * Each test steps the clock a second at a time, so every request is logged at the second it was
 * sent.
 */

import { isObject, type Interaction } from '@lo/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { GithubError, type GithubErrorDetail } from '../src/errors.ts';
import type { JobChanged, JobState, Outcome, Unknown } from '../src/merge-jobs.ts';
import {
  directMerge,
  isRefusal,
  withLayersBelow,
  type MergeRefusal,
  type MergeRequest,
} from '../src/merge-writes.ts';
import {
  answered,
  Harness,
  layersBelow,
  list,
  LOOKUP,
  lookups,
  made,
  object,
  pullAnswer,
  pullOf,
  Recorded,
  recording,
  required,
  settle,
  START,
  stopPollers,
  text,
  type Pr,
} from './support/merge-jobs.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});

afterEach(() => {
  stopPollers();
  vi.useRealTimers();
});

/** Whether `value` is of `kind`. */
function is<T extends { kind: string }, K extends T['kind']>(
  value: T,
  kind: K,
): value is Extract<T, { kind: K }> {
  return value.kind === kind;
}

/** How a job ended, which must be as `kind`. */
function outcome<K extends Outcome['kind']>(
  state: JobState,
  kind: K,
): Extract<Outcome, { kind: K }> {
  if (state.kind === 'done' && is(state.outcome, kind)) return state.outcome;
  throw new Error(`not ${kind}: ${JSON.stringify(state)}`);
}

/** Why Lo doesn't know how a job ended, which must be `kind`. */
function unknown<K extends Unknown['kind']>(
  state: JobState,
  kind: K,
): Extract<Unknown, { kind: K }> {
  const { unknown: why } = outcome(state, 'unknown');
  if (is(why, kind)) return why;
  throw new Error(`not ${kind}: ${JSON.stringify(state)}`);
}

/** Why the last time Lo asked about a pending job got no answer. */
function trouble(state: JobState): GithubErrorDetail {
  if (state.kind === 'pending' && state.trouble) return state.trouble;
  throw new Error(`not pending with trouble: ${JSON.stringify(state)}`);
}

/** The error a job was refused for, rather than a refusal. */
function error(why: MergeRefusal | GithubErrorDetail): GithubError {
  if (isRefusal(why)) throw new Error(`a refusal: ${JSON.stringify(why)}`);
  return new GithubError(why);
}

/** A promise's result as it came, taken in at once so a rejection is never left unheard. */
function settled<T>(
  promise: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  return promise.then(
    (value) => ({ ok: true, value }),
    (thrown: unknown) => ({ ok: false, error: thrown }),
  );
}

test('a merge is asked about after 1 2 4 and 8 seconds then every 10', async () => {
  const recorded = new Recorded();
  const answers = [
    recorded.sent,
    ...Array.from({ length: 7 }, () => recorded.pending),
    recorded.merged,
  ];
  const harness = await Harness.create('merge_jobs_backoff', answers);
  const pull = recorded.pull();

  expect(await harness.merge(pull, recorded.request())).toBeUndefined();
  expect(harness.state(pull)).toEqual({ kind: 'pending', trouble: undefined });
  await harness.runUntil(60);

  const [put, get] = [recorded.put(), recorded.get()];
  expect(harness.requests()).toEqual([
    [0, LOOKUP],
    [0, put],
    [1, get],
    [3, get],
    [7, get],
    [15, get],
    [25, get],
    [35, get],
    [45, get],
    [55, get],
  ]);
  expect(outcome(harness.state(pull), 'merged')).toEqual({
    kind: 'merged',
    sha: recorded.sha(),
    githubSaid: undefined,
  });
  expect(harness.polls(pull)).toBe(8);
  // Started, taken, seven times pending, then done.
  const events = harness.events();
  expect(events).toHaveLength(10);
  expect(events.at(-1)).toEqual([pull.number, true]);
  expect(events.slice(0, 9).every(([, done]) => !done)).toBe(true);
});

test('a merge goes on once the tab that started it closes', async () => {
  const recorded = new Recorded();
  const answers = [recorded.sent, recorded.pending, recorded.merged];
  const harness = await Harness.create('merge_jobs_tab_closes', answers);
  const pull = recorded.pull();

  // A tab that starts a merge and follows its job.
  const seen: JobChanged[] = [];
  const close = harness.jobs.onChange((changed) => {
    seen.push(changed);
  });
  expect(harness.jobs.merge(harness.poller, pull, recorded.request())).toBeUndefined();
  await settle();
  expect(seen, 'started, then taken').toEqual([
    { pull, done: false },
    { pull, done: false },
  ]);
  // The tab closes, and stops following the job.
  close();

  await harness.runUntil(5);
  const [put, get] = [recorded.put(), recorded.get()];
  expect(harness.requests()).toEqual([
    [0, LOOKUP],
    [0, put],
    [1, get],
    [3, get],
  ]);
  expect(seen, 'the closed tab hears nothing more').toHaveLength(2);
  // A tab that opens the pull request again finds how its merge ended.
  expect(harness.jobs.job(pull)?.state).toMatchObject({
    kind: 'done',
    outcome: { kind: 'merged' },
  });
  expect(harness.events().at(-1)).toEqual([pull.number, true]);
  // Once it has ended, it can be forgotten, and the pull request merged again.
  expect(harness.jobs.forget(pull)).toBe(true);
  expect(harness.jobs.job(pull)).toBeUndefined();
});

test('a second merge waits for the first to end', async () => {
  const recorded = new Recorded();
  const answers = [recorded.sent, recorded.merged];
  const harness = await Harness.create('merge_jobs_one_at_a_time', answers);
  const pull = recorded.pull();

  expect(await harness.merge(pull, recorded.request())).toBeUndefined();
  expect(await harness.merge(pull, recorded.request())).toEqual({ refusal: 'alreadyMerging' });
  expect(harness.jobs.forget(pull), "a running job isn't forgotten").toBe(false);
  await harness.runUntil(2);
  expect(harness.requests()).toEqual([
    [0, LOOKUP],
    [0, recorded.put()],
    [1, recorded.get()],
  ]);
  expect(harness.state(pull)).toMatchObject({ kind: 'done', outcome: { kind: 'merged' } });
});

test('a merge whose answer was lost is never sent again', async () => {
  const recorded = new Recorded();
  let harness = await Harness.create('merge_jobs_lost_answer', [recorded.sent]);
  const pull = recorded.pull();

  // Sent, then the connection reset: GitHub may have taken it.
  harness.failNext('reset');
  expect(await harness.merge(pull, recorded.request())).toBeUndefined();
  await harness.runUntil(15 * 60);
  expect(harness.requests()).toEqual([
    [0, LOOKUP],
    [0, recorded.put()],
  ]);
  const lost = unknown(harness.state(pull), 'noAnswer');
  expect(new GithubError(lost.error).mayHavePosted()).toBe(true);
  // It can't be followed again: there's no UUID to ask about.
  expect(harness.jobs.followAgain(pull)).toBe(false);

  // A server error may have merged it too.
  harness = await Harness.create('merge_jobs_server_error', [
    answered(recorded.sent, 502, { message: 'Server Error' }),
  ]);
  await harness.merge(pull, recorded.request());
  await harness.runUntil(60);
  expect(harness.requests()).toEqual([
    [0, LOOKUP],
    [0, recorded.put()],
  ]);
  expect(harness.state(pull)).toMatchObject({
    kind: 'done',
    outcome: { kind: 'unknown', unknown: { kind: 'noAnswer' } },
  });

  // One that never left wasn't done, so it's refused, not unknown.
  harness = await Harness.create('merge_jobs_offline', [recorded.sent]);
  harness.failNext('unreachable');
  await harness.merge(pull, recorded.request());
  await harness.runUntil(60);
  expect(harness.requests()).toEqual([
    [0, LOOKUP],
    [0, recorded.put()],
  ]);
  const { why } = outcome(harness.state(pull), 'refused');
  expect(error(why).mayHavePosted()).toBe(false);
});

test('a merge whose stack cant be read ends as that read did', async () => {
  const recorded = new Recorded();
  const pull = recorded.pull();

  // Offline: the merge is never sent, and the job says GitHub couldn't be reached.
  let harness = await Harness.create('merge_jobs_lookup_offline', []);
  harness.failNextLookup('unreachable');
  await harness.merge(pull, recorded.request());
  await harness.runUntil(5);
  expect(harness.requests()).toEqual([[0, LOOKUP]]);
  const { why } = outcome(harness.state(pull), 'refused');
  // Lo refused it for want of the read, which it holds.
  if (!isRefusal(why) || why.refusal !== 'unchecked') {
    throw new Error(`not refused for the read: ${JSON.stringify(why)}`);
  }
  expect(new GithubError(why.read).isUnreachable()).toBe(true);
  expect(new GithubError(why.read).mayHavePosted()).toBe(false);

  // A rate limit on the lookup pauses polling, as any read's does.
  const lookup = lookups().find(({ request }) =>
    request.url.endsWith(`pull_request=${pull.number}`),
  );
  const limited = answered(required(lookup), 403, {
    message: 'You have exceeded a secondary rate limit.',
  });
  limited.response.headers['retry-after'] = '60';
  harness = await Harness.create('merge_jobs_lookup_limited', [limited]);
  await harness.merge(pull, recorded.request());
  await harness.runUntil(2);
  expect(harness.requests()).toEqual([[0, LOOKUP]]);
  expect(harness.state(pull)).toMatchObject({ kind: 'done', outcome: { kind: 'refused' } });
  expect(harness.poller.status().rateLimit.kind, "polling pauses for the lookup's rate limit").toBe(
    'paused',
  );
});

test('asking rides out the network and a forgotten uuid is unknown', async () => {
  const recorded = new Recorded();
  const notFound = {
    message: 'Not Found',
    documentation_url:
      'https://docs.github.com/rest/pulls/pulls#get-the-result-of-an-asynchronous-merge',
    status: '404',
  };
  const answers = [
    recorded.sent,
    recorded.pending,
    answered(recorded.pending, 502, { message: 'Server Error' }),
    answered(recorded.pending, 404, notFound),
  ];
  const harness = await Harness.create('merge_jobs_trouble', answers);
  const pull = recorded.pull();

  await harness.merge(pull, recorded.request());
  // Offline at 1 s: asked again at 3 s, still pending, then a server error at 7 s.
  harness.failNext('unreachable');
  await harness.runUntil(1);
  const offline = trouble(harness.state(pull));
  expect(new GithubError(offline).isUnreachable()).toBe(true);
  await harness.runUntil(7);
  const failing = trouble(harness.state(pull));
  expect(new GithubError(failing).isWaitable()).toBe(true);
  // Then GitHub forgets the UUID, which waiting won't fix.
  await harness.runUntil(30);
  const get = recorded.get();
  expect(harness.requests()).toEqual([
    [0, LOOKUP],
    [0, recorded.put()],
    [1, get],
    [3, get],
    [7, get],
    [15, get],
  ]);
  expect(unknown(harness.state(pull), 'lost').error.kind).toBe('notFound');
  expect(harness.polls(pull)).toBe(4);
});

test('a merge still pending after ten minutes is left unknown', async () => {
  const recorded = new Recorded();
  // Pending at every answer for ten minutes, then merged once asked again.
  const answers = [
    recorded.sent,
    ...Array.from({ length: 64 }, () => recorded.pending),
    recorded.merged,
  ];
  const harness = await Harness.create('merge_jobs_still_pending', answers);
  const pull = recorded.pull();

  await harness.merge(pull, recorded.request());
  await harness.runUntil(11 * 60);
  // 1, 3, 7, 15 s, then every 10 s: the last before ten minutes at 595 s.
  const requests = harness.requests();
  expect(requests).toHaveLength(2 + 4 + 58);
  expect(requests.at(-1)?.[0]).toBe(595);
  expect(harness.state(pull)).toMatchObject({
    kind: 'done',
    outcome: { kind: 'unknown', unknown: { kind: 'stillPending' } },
  });

  // Asked to, Lo asks again: a read, not the merge sent again.
  expect(harness.jobs.followAgain(pull)).toBe(true);
  await harness.runUntil(11 * 60 + 30);
  const get = recorded.get();
  expect(harness.requests()).toEqual([
    [661, get],
    [663, get],
    [667, get],
  ]);
  expect(harness.state(pull)).toMatchObject({ kind: 'done', outcome: { kind: 'merged' } });
});

/** A squash merge of `pr` at its head. */
function squash(pr: Pr): MergeRequest {
  return made(directMerge(pr.head, 'SQUASH'));
}

test('a merge github refuses or fails ends its job saying why', async () => {
  const { setup, interactions } = recording('merge_writes_e2e_refused');
  interactions.push(pullAnswer(setup.passing.number, false));
  const harness = await Harness.create('merge_jobs_refused', interactions);
  const [draft, passing] = [pullOf(setup.draft), pullOf(setup.passing)];

  // A draft is refused at once.
  await harness.merge(draft, squash(setup.draft));
  expect(outcome(harness.state(draft), 'refused').why).toEqual({ refusal: 'draft' });
  // One waiting on an approval is taken, a second after the draft's write, and fails as it
  // runs, naming the rule. Lo reads the pull request then, which isn't merged.
  await harness.merge(passing, squash(setup.passing));
  await harness.runUntil(10);
  const requests = harness.requests();
  const at = requests.map(([secs]) => secs);
  // Each merge looks up its stack in the same turn as it's sent.
  expect(at).toEqual([0, 0, 1, 1, 2, 4, 4]);
  expect(requests.slice(2, 4)).toEqual([
    [1, LOOKUP],
    [1, `PUT /pulls/${passing.number}/merge-async`],
  ]);
  expect(requests[6]?.[1]).toBe(`GET /pulls/${passing.number}`);
  const failed = outcome(harness.state(passing), 'failed');
  expect(failed.message).toMatch(/^Repository rule violations found/);
  expect(failed.why.refusal).toBe('rules');
  expect(failed.why.refusal === 'rules' && failed.why.rules).toHaveLength(1);
  expect(failed.landed).toEqual([]);
});

test('a failed answer for a merge that landed reads as merged', async () => {
  // GitHub has answered `failed` after landing every layer of a stack. Here, the recorded
  // merge's last answer says `failed`, and the pull request reads merged.
  const recorded = new Recorded();
  const failed = answered(recorded.merged, 200, {
    status: 'failed',
    details: { message: 'Merge failed.' },
  });
  const pull = recorded.pull();
  const answers = [recorded.sent, recorded.pending, failed, pullAnswer(pull.number, true)];
  const harness = await Harness.create('merge_jobs_failed_but_merged', answers);

  await harness.merge(pull, recorded.request());
  await harness.runUntil(10);
  const [put, get] = [recorded.put(), recorded.get()];
  expect(harness.requests()).toEqual([
    [0, LOOKUP],
    [0, put],
    [1, get],
    [3, get],
    [3, `GET /pulls/${pull.number}`],
  ]);
  const landed = text(object(pullAnswer(pull.number, true).response.body)['merge_commit_sha']);
  expect(outcome(harness.state(pull), 'merged')).toEqual({
    kind: 'merged',
    sha: landed,
    githubSaid: 'Merge failed.',
  });
});

test('a merge already running elsewhere is followed and reported as that merge', async () => {
  const { setup, interactions } = recording('merge_writes_e2e_moved');
  const moved = required(setup.moved);
  // Without the answer that took the merge: the only one left for it says one is running.
  const left = interactions.filter(
    ({ request, response }) => !(request.method === 'PUT' && response.status === 202),
  );
  const harness = await Harness.create('merge_jobs_running', left);
  const pull = pullOf(moved);

  await harness.merge(pull, made(directMerge(moved.head, 'MERGE')));
  await harness.runUntil(10);
  const { uuid, running, state } = harness.job(pull);
  // What the 409 said is kept once the merge has ended, though answers since don't say it.
  expect(running?.expected_head_sha, 'the merge GitHub was running').toBe(moved.head);
  expect(uuid).toBeDefined();
  const get = `GET /pulls/${pull.number}/merge-async/${uuid}`;
  expect(harness.requests()).toEqual([
    [0, LOOKUP],
    [0, `PUT /pulls/${pull.number}/merge-async`],
    [1, get],
    [3, get],
    [7, get],
  ]);
  const elsewhere = outcome(state, 'alreadyRunning');
  expect(elsewhere.running.uuid).toBe(uuid);
  expect(elsewhere.ended.kind).toBe('merged');
});

test('another merges head and method are kept and its failure isnt ours', async () => {
  // A merge from elsewhere is running at another head, with another method, and fails.
  const { setup, interactions } = recording('merge_writes_e2e_moved');
  const moved = required(setup.moved);
  const find = (matches: (interaction: Interaction) => boolean): Interaction =>
    structuredClone(required(interactions.find(matches)));
  const running = find(
    ({ request, response }) => request.method === 'PUT' && response.status === 409,
  );
  const details = object(object(running.response.body)['details']);
  details['expected_head_sha'] = setup.stale;
  details['merge_method'] = 'merge';
  // The answer to a squash at the head on screen.
  delete running.request.body_sha256;
  running.request.body = `{"sha":"${moved.head}","merge_method":"squash","merge_action":"direct_merge"}`;
  const pending = find(
    ({ request, response }) =>
      request.method === 'GET' && isObject(response.body) && response.body['status'] === 'pending',
  );
  const failed = answered(pending, 200, {
    status: 'failed',
    details: { message: 'Pull request head branch was modified.' },
  });
  const answers = [running, pending, failed, pullAnswer(moved.number, false)];
  const harness = await Harness.create('merge_jobs_another_merge', answers);
  const pull = pullOf(moved);

  await harness.merge(pull, made(directMerge(moved.head, 'SQUASH')));
  await harness.runUntil(10);
  const job = harness.job(pull);
  const kept = required(job.running);
  expect(kept.expected_head_sha).toBe(setup.stale);
  expect(kept.merge_method).toBe('merge');
  const elsewhere = outcome(job.state, 'alreadyRunning');
  expect(elsewhere.running.expected_head_sha).toBe(setup.stale);
  // The other merge's head moved, not the one on screen.
  expect(elsewhere.ended).toMatchObject({
    kind: 'failed',
    why: { refusal: 'headMoved' },
  });
});

test('a status lo doesnt know keeps the uuid to ask again', async () => {
  const recorded = new Recorded();
  const uuid = recorded.uuid();
  const scheduled = answered(recorded.sent, 202, { status: 'scheduled', details: { uuid } });
  const answers = [scheduled, recorded.pending, recorded.merged];
  const harness = await Harness.create('merge_jobs_unknown_status', answers);
  const pull = recorded.pull();

  await harness.merge(pull, recorded.request());
  expect(unknown(harness.state(pull), 'status').status).toBe('scheduled');
  expect(harness.job(pull).uuid).toBe(uuid);
  // Asked to, Lo asks about it again, a read: pending, then merged.
  expect(harness.jobs.followAgain(pull)).toBe(true);
  await harness.runUntil(10);
  const get = recorded.get();
  expect(harness.requests()).toEqual([
    [0, LOOKUP],
    [0, recorded.put()],
    [1, get],
    [3, get],
  ]);
  expect(harness.state(pull)).toMatchObject({ kind: 'done', outcome: { kind: 'merged' } });
});

test('a rate limit while following is waited out', async () => {
  const recorded = new Recorded();
  const limited = answered(recorded.pending, 429, {
    message: 'You have exceeded a secondary rate limit.',
  });
  limited.response.headers['retry-after'] = '60';
  const answers = [recorded.sent, limited, recorded.merged];
  const harness = await Harness.create('merge_jobs_rate_limited', answers);
  const pull = recorded.pull();

  await harness.merge(pull, recorded.request());
  await harness.runUntil(2);
  const waiting = trouble(harness.state(pull));
  expect(waiting.kind).toBe('rateLimited');
  await harness.runUntil(90);
  const get = recorded.get();
  // Asked at 1 s, told to wait a minute: asked again at 61 s, not at 3 s.
  expect(harness.requests()).toEqual([
    [0, LOOKUP],
    [0, recorded.put()],
    [1, get],
    [61, get],
  ]);
  expect(harness.state(pull)).toMatchObject({ kind: 'done', outcome: { kind: 'merged' } });
});

test('a queue write is sent once whatever its answer', async () => {
  const { setup, interactions } = recording('merge_writes_e2e_queue');
  const fail = setup.queue_fail;
  // The first enqueue, expecting a head the pull request doesn't have, then a server error.
  const refused = required(interactions[0]);
  const lost = answered(refused, 502, { message: 'Server Error' });
  const harness = await Harness.create('merge_jobs_queue_writes', [refused, lost]);

  const enqueue = async () => {
    const sent = settled(harness.poller.enqueue(pullOf(fail), fail.node_id, setup.stale, false));
    await harness.runUntil(harness.now() + 2);
    return sent;
  };
  expect(await enqueue()).toEqual({ ok: true, value: { refusal: 'headMoved' } });
  const second = await enqueue();
  if (second.ok) throw new Error(`not lost: ${JSON.stringify(second.value)}`);
  expect(second.error).toBeInstanceOf(GithubError);
  expect(second.error instanceof GithubError && second.error.mayHavePosted()).toBe(true);
  // Each looks for a stack holding the pull request first, then is sent once.
  const requests = harness.requests().map(([, request]) => request);
  expect(requests, 'each sent once').toEqual([LOOKUP, 'POST /graphql', LOOKUP, 'POST /graphql']);
});

test('a failed stack merge says what landed', async () => {
  const { setup, interactions } = recording('merge_writes_e2e_stack_merge');
  const [bottom, middle, top] = setup.stack;
  if (!bottom || !middle || !top || setup.stack.length !== 3) {
    throw new Error('the stack has three layers');
  }
  const pull = pullOf(top);
  const merge = made(
    withLayersBelow(made(directMerge(top.head, 'SQUASH')), layersBelow(setup.stack)),
  );
  const find = (matches: (interaction: Interaction) => boolean): Interaction =>
    structuredClone(required(interactions.find(matches)));
  const lookup = find(({ request }) => request.url.endsWith(`pull_request=${top.number}`));
  const put = find(({ request }) => request.method === 'PUT');
  const pending = find(({ request }) => request.url.includes('merge-async/'));
  const message = 'Repository rule violations found\n\nRequired status check "ci" is failing.';
  const failed = answered(pending, 200, { status: 'failed', details: { message } });
  const topRead = find(({ request }) => request.url.endsWith(`/pulls/${top.number}`));

  // Every layer landed, and GitHub said it failed.
  let harness = await Harness.create('merge_jobs_stack_failed_landed', [
    lookup,
    put,
    pending,
    failed,
    topRead,
  ]);
  await harness.merge(pull, merge);
  await harness.runUntil(10);
  const readTop = `GET /pulls/${top.number}`;
  const polls = harness.requests();
  expect(polls.filter(([, sent]) => sent.startsWith('PUT'))).toHaveLength(1);
  expect(polls.at(-1)?.[1]).toBe(readTop);
  expect(outcome(harness.state(pull), 'merged').githubSaid).toBe(message);

  // Only the bottom landed: the top reads open, and the stack says which.
  const openTop = structuredClone(topRead);
  const body = object(openTop.response.body);
  body['merged'] = false;
  body['merged_at'] = null;
  body['state'] = 'open';
  const after = structuredClone(lookup);
  const layers = list(object(list(after.response.body)[0])['pull_requests']);
  const first = object(layers[0]);
  first['state'] = 'closed';
  first['merged_at'] = '2026-11-08T12:12:49Z';
  harness = await Harness.create('merge_jobs_stack_failed_partly', [
    lookup,
    put,
    pending,
    failed,
    openTop,
    after,
  ]);
  await harness.merge(pull, merge);
  await harness.runUntil(10);
  const requests = harness.requests().map(([, sent]) => sent);
  // The log leaves out queries: these read the stack holding the top.
  expect(requests[0]).toBe(LOOKUP);
  expect(requests.slice(-2)).toEqual([readTop, LOOKUP]);
  const partly = outcome(harness.state(pull), 'failed');
  expect(partly.why.refusal).toBe('rules');
  expect(partly.landed).toEqual([bottom.number]);
  expect(partly.landed).not.toContain(middle.number);
});
