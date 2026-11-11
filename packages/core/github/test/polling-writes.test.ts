// The poller's writes on a fake clock: how they share the account's queue with polls, and what
// each reads again afterwards, replaying `poll_playground` with the writes' answers added.

import type { Interaction, Json } from '@lo/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  answer,
  at,
  comment,
  idOf,
  log,
  object,
  oneAtATime,
  outcome,
  PLAYGROUND,
  Polling,
  postComment,
  pr,
  QUIET,
  recorded,
  useFakeClock,
  wall,
  withBody,
} from './support/polling.ts';
import { GithubError } from '../src/errors.ts';
import { unchecked } from '../src/json.ts';
import { directMerge, isRefusal, type MergeRequest } from '../src/merge-writes.ts';
import { PENDING_REVIEW, REVIEW_THREADS, TIMELINE } from '../src/poll/reads.ts';
import type { CommentId, ReviewWrite } from '../src/review-writes.ts';
import type { ReviewThread, ReviewThreadList } from '../src/threads.ts';
import type { PullRequestTimeline } from '../src/timeline.ts';

beforeEach(useFakeClock);

afterEach(() => {
  vi.useRealTimers();
});

test('a write waits for the poll in flight and the previous write', async () => {
  const r = recorded();
  const t = await Polling.start('write', [...recorded(), comment(r)], { delay: 1000 });
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(1);
  const first = postComment(t.poller);
  await t.run();
  const second = postComment(t.poller);
  await t.run();
  await t.runUntil(20);
  expect(idOf(await t.finish(first))).toBe(1);
  expect(idOf(await t.finish(second))).toBe(1);

  const requests = t.requests();
  // Each request takes a second, and none overlaps another.
  expect(requests).toSatisfy(oneAtATime);
  const posts = requests
    .filter(([, what]) => what.startsWith('POST /issues'))
    .map(([secs]) => secs);
  // The first waits for the open PR's poll (0–3 s); the second starts a second after the first
  // finished.
  expect(posts).toHaveLength(2);
  expect(posts[0]).toBeGreaterThanOrEqual(3);
  expect(posts[1]).toBeGreaterThanOrEqual((posts[0] ?? 0) + 2);
});

test('a poll that comes due while a write holds the queue waits', async () => {
  const r = recorded();
  const t = await Polling.start('poll_waits_for_write', [...recorded(), comment(r)], {
    delay: 1000,
  });
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(21);
  t.requests();
  // The second write holds the queue through its second of spacing, while the open PR's next poll
  // comes due.
  const first = postComment(t.poller);
  await t.run();
  const second = postComment(t.poller);
  await t.run();
  await t.runUntil(30);
  await t.finish(first);
  await t.finish(second);
  const requests = t.requests();
  expect(requests).toSatisfy(oneAtATime);
  expect(requests.filter(([, what]) => what.startsWith('POST'))).toHaveLength(2);
});

test('a waiting write goes before the polls that come due', async () => {
  const r = recorded();
  const t = await Polling.start('write_before_polls', [...recorded(), comment(r)], {
    delay: 1000,
  });
  void t.poller.watch(pr(2));
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(1);
  // Sent while the open PR's poll is in flight, with the other PR and the repository due.
  const write = postComment(t.poller);
  await t.run();
  await t.runUntil(15);
  await t.finish(write);
  const requests = t.requests();
  expect(requests.map(([, what]) => what)).toEqual([
    'GET /pulls/1',
    'PullRequestCheck',
    'PullRequest',
    'POST /issues/1/comments',
    'GET /pulls/2',
    // The comment was on PR #1, so it's fetched again.
    'GET /pulls/1 (since)',
    'PullRequestCheck',
    'PullRequest',
    'GET /pulls?state=open&per_page=100',
    'OpenPullRequests',
    'TrunkRules',
  ]);
});

test('a write fetches what it changed again', async () => {
  const r = recorded();
  const t = await Polling.start('write_invalidates', [...recorded(), comment(r)]);
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(5);
  t.requests();
  let write = postComment(t.poller);
  await t.run();
  await t.finish(write);
  await t.run();
  // At once, and in full, although the check is the same.
  expect(t.requests()).toEqual(
    log(
      [5, 'POST /issues/1/comments'],
      [5, 'GET /pulls/1 (since)'],
      [5, 'PullRequestCheck'],
      [5, 'PullRequest'],
    ),
  );

  // Not watched, it's forgotten in the cache, so it's fetched in full when it's opened again.
  void t.poller.setOpen(undefined);
  t.poller.unwatch(pr(1));
  await t.run();
  write = postComment(t.poller);
  await t.run();
  await t.finish(write);
  await t.run();
  expect(t.requests()).toEqual(log([6, 'POST /issues/1/comments']));
  void t.poller.setOpen(pr(1));
  await t.run();
  expect(t.requests().filter(([, what]) => !what.includes('/pulls?'))).toEqual(
    log([6, 'GET /pulls/1 (since)'], [6, 'PullRequestCheck'], [6, 'PullRequest']),
  );
});

/** `request`, which can't be a refusal for a full SHA. */
function mergeOf(request: MergeRequest | { refusal: string }): MergeRequest {
  if (isRefusal(request)) throw new Error(`refused: ${JSON.stringify(request)}`);
  return request;
}

/** GitHub's answer to making #1 and #2 a stack. */
function stacked(r: readonly Interaction[]): Interaction {
  return {
    request: {
      method: 'POST',
      url: 'https://api.github.com/repos/rozed-dev/playground/stacks',
      body: '{"pull_requests":[1,2]}',
    },
    response: answer(
      at(r, 0),
      201,
      [],
      `{"number":3,"node_id":"PRS_x","base":{"ref":"main"},"open":true,
        "pull_requests":[
          {"number":1,"state":"open","draft":false,"merged_at":null,
           "head":{"ref":"stack-a","sha":"a"}},
          {"number":2,"state":"open","draft":false,"merged_at":null,
           "head":{"ref":"stack-b","sha":"b"}}]}`,
    ).response,
  };
}

test('a stack write reads each pull request and their repository again', async () => {
  const r = recorded();
  const t = await Polling.start('stack_write_invalidates', [...recorded(), stacked(r)]);
  void t.poller.watch(pr(2));
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(5);
  t.requests();
  const write = t.poller.createStack(PLAYGROUND, [1, 2]);
  await t.run();
  const made = await t.finish(write);
  expect('number' in made ? made.number : made).toBe(3);
  await t.run();
  // At once, each pull request and the repository's open pull requests, the open one in full.
  expect(t.requests()).toEqual(
    log(
      [5, 'POST /stacks'],
      [5, 'GET /pulls/1 (since)'],
      [5, 'PullRequestCheck'],
      [5, 'PullRequest'],
      [5, 'GET /pulls/2 (since)'],
      [5, 'GET /pulls?state=open&per_page=100'],
      [5, 'OpenPullRequests'],
    ),
  );
});

test('a repository poll that read its list before a stack write doesnt keep it', async () => {
  const r = recorded();
  // The open pull requests as GitHub lists them once #1 and #2 are a stack, which leaves the REST
  // pages, and so their ETags, as they were.
  const after = withBody(at(r, 5), (body) => {
    object(body, 'data', 'repository', 'pullRequests', 'nodes', 0)['title'] = 'Stacked';
  });
  const t = await Polling.start(
    'stack_write_mid_poll',
    [at(r, 3), at(r, 8), at(r, 4), at(r, 9), at(r, 5), after, at(r, 10), stacked(r)],
    { delay: 1000 },
  );
  void t.poller.watch(pr(2));
  await t.run();
  // The repository's poll reads its open pull requests (1–3 s); the write is asked for while it
  // does, and goes before the poll's rulesets.
  await t.runUntil(2);
  const write = t.poller.createStack(PLAYGROUND, [1, 2]);
  await t.run();
  await t.finish(write);
  await t.runUntil(15);
  expect(t.requests()).toEqual(
    log(
      [0, 'GET /pulls/2'],
      [1, 'GET /pulls?state=open&per_page=100'],
      [2, 'OpenPullRequests'],
      [3, 'POST /stacks'],
      [4, 'TrunkRules'],
      [5, 'GET /pulls/2 (since)'],
      // Not asked with the ETags the poll read before the write, which GitHub would answer `304`.
      [6, 'GET /pulls?state=open&per_page=100'],
      [7, 'OpenPullRequests'],
    ),
  );
  // Only the list read after the write is kept and sent.
  expect(t.poller.openPullRequests(PLAYGROUND)?.value.pullRequests[0]?.title).toBe('Stacked');
  expect(t.events().filter((event) => event.startsWith('open PRs'))).toEqual([
    'open PRs of rozed-dev/playground: 2',
  ]);
});

test('a repository poll chosen before a stack write doesnt keep what it reads', async () => {
  const r = recorded();
  const after = withBody(at(r, 5), (body) => {
    object(body, 'data', 'repository', 'pullRequests', 'nodes', 0)['title'] = 'Stacked';
  });
  const t = await Polling.start(
    'stack_write_before_poll',
    [at(r, 3), at(r, 8), at(r, 4), at(r, 9), at(r, 5), after, at(r, 10), stacked(r)],
    { delay: 1000 },
  );
  void t.poller.watch(pr(2));
  await t.run();
  await t.runUntil(120);
  t.requests();
  const before = t.poller.openPullRequests(PLAYGROUND)?.value;
  // At the next round, while #2's poll is in flight (121–122 s), the repository's list is asked for
  // again, and the write is asked for. The write takes the queue once #2's poll is done; the
  // repository's poll is chosen then, with the ETags it read before, and waits for the write.
  await t.runUntil(121.5);
  t.poller.listAgain(PLAYGROUND);
  const write = t.poller.createStack(PLAYGROUND, [1, 2]);
  await t.run();
  await t.finish(write);
  await t.runUntil(130);
  expect(t.requests()).toEqual(
    log(
      [121, 'GET /pulls/2 (since)'],
      [122, 'POST /stacks'],
      // GitHub's REST pages are the same, so its `304` says nothing about the stack.
      [123, 'GET /pulls?state=open&per_page=100 (etag)'],
      [124, 'GET /pulls/2 (since)'],
      [125, 'GET /pulls?state=open&per_page=100'],
      [126, 'OpenPullRequests'],
    ),
  );
  expect(before?.pullRequests[0]?.title).not.toBe('Stacked');
  expect(t.poller.openPullRequests(PLAYGROUND)?.value.pullRequests[0]?.title).toBe('Stacked');
});

test('a stack write while the cache loads leaves out the etags it held', async () => {
  const r = recorded();
  const after = withBody(at(r, 5), (body) => {
    object(body, 'data', 'repository', 'pullRequests', 'nodes', 0)['title'] = 'Stacked';
  });
  const t = await Polling.start('stack_write_while_loading', [
    at(r, 3),
    at(r, 8),
    at(r, 4),
    at(r, 9),
    at(r, 5),
    after,
    at(r, 10),
    stacked(r),
  ]);
  void t.poller.watch(pr(2));
  await t.run();
  await t.runUntil(5);
  // Lo starts again, and the cache takes three seconds to answer with what it read at once.
  const get = t.cache.get.bind(t.cache);
  t.cache.get = async (login, target, name) => {
    const entry = await get(login, target, name);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return entry;
  };
  await t.restart();
  t.requests();
  void t.poller.watch(pr(2));
  await t.run();
  const write = t.poller.createStack(PLAYGROUND, [1, 2]);
  await t.run();
  await t.finish(write);
  await t.runUntil(15);
  expect(t.requests()).toEqual(
    log(
      [5, 'POST /stacks'],
      [8, 'GET /pulls/2 (since)'],
      // Not with the ETags the cache held from before the write.
      [8, 'GET /pulls?state=open&per_page=100'],
      [8, 'OpenPullRequests'],
    ),
  );
  expect(t.poller.openPullRequests(PLAYGROUND)?.value.pullRequests[0]?.title).toBe('Stacked');
});

test('a retarget reads the base first in its own turn', async () => {
  const r = recorded();
  // GitHub's answer to #2, `stack-b` on `stack-a`, then to moving it onto `main`.
  const read = at(r, 3);
  const moved: Interaction = {
    request: {
      method: 'PATCH',
      url: 'https://api.github.com/repos/rozed-dev/playground/pulls/2',
      body: '{"base":"main"}',
    },
    response: withBody(read, (body) => {
      object(body, 'base')['ref'] = 'main';
    }).response,
  };
  const t = await Polling.start('retarget', [read, moved]);

  let write = t.poller.retarget(PLAYGROUND, { pr: 2, from: 'stack-a', to: 'main' });
  await t.run();
  let moving = await t.finish(write);
  expect('base' in moving ? moving.base.ref : moving).toBe('main');
  expect(t.requests()).toEqual(log([0, 'GET /pulls/2'], [0, 'PATCH /pulls/2']));

  // Already on the branch it wants: read, and left as it is.
  write = t.poller.retarget(PLAYGROUND, { pr: 2, from: 'main', to: 'stack-a' });
  await t.run();
  await t.runUntil(2);
  moving = await t.finish(write);
  expect('base' in moving ? moving.base.ref : moving).toBe('stack-a');
  expect(t.requests()).toEqual(log([1, 'GET /pulls/2']));
});

test('a write finishes when its caller stops waiting', async () => {
  const r = recorded();
  const t = await Polling.start('write_dropped', [...recorded(), comment(r)], { delay: 1000 });
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(6);
  t.requests();
  // The tab that asked for it closes while it's in flight, and nothing waits for it any more.
  const write = outcome(postComment(t.poller));
  await t.run();
  expect(t.requests()).toEqual(log([6, 'POST /issues/1/comments']));
  await t.runUntil(11);
  // It finished: what it changed is fetched again.
  expect(t.requests()).toEqual(
    log([7, 'GET /pulls/1 (since)'], [8, 'PullRequestCheck'], [9, 'PullRequest']),
  );
  expect((await write).ok).toBe(true);
});

test('a write that hits a rate limit pauses polling', async () => {
  const r = recorded();
  const limited = comment(r);
  limited.response = answer(
    at(r, 0),
    403,
    [['retry-after', '60']],
    '{"message":"You have exceeded a secondary rate limit."}',
  ).response;
  const t = await Polling.start('write_rate_limited', [...recorded(), limited]);
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(5);
  const write = outcome(postComment(t.poller));
  await t.run();
  const written = await t.finish(write);
  const error = written.ok ? undefined : written.error;
  expect(error instanceof GithubError ? error.detail : error).toMatchObject({
    kind: 'rateLimited',
    secondary: true,
  });
  expect(t.status().rateLimit).toEqual({
    kind: 'paused',
    until: wall(65),
    reason: { kind: 'secondary' },
  });
});

/** `POST /issues/1/comments`, answered with GitHub's secondary rate limit, asking for a minute. */
function limitedComment(r: readonly Interaction[]): Interaction {
  const limited = comment(r);
  limited.response = answer(
    at(r, 0),
    403,
    [['retry-after', '60']],
    '{"message":"You have exceeded a secondary rate limit."}',
  ).response;
  return limited;
}

/** GitHub's answer to #2, `stack-b` on `stack-a`, then to moving it onto `main`. */
function retargeted(r: readonly Interaction[]): Interaction[] {
  const read = at(r, 3);
  const moved: Interaction = {
    request: {
      method: 'PATCH',
      url: 'https://api.github.com/repos/rozed-dev/playground/pulls/2',
      body: '{"base":"main"}',
    },
    response: withBody(read, (body) => {
      object(body, 'base')['ref'] = 'main';
    }).response,
  };
  return [read, moved];
}

const FULL_SHA = 'a'.repeat(40);

test('while github asks lo to hold off comments and merges are refused', async () => {
  const r = recorded();
  const t = await Polling.start('writes_refused_while_paused', [limitedComment(r)]);
  // The second waits for the first's turn, in which GitHub asks Lo to hold off.
  const first = outcome(postComment(t.poller));
  const second = t.poller.addConversationComment(pr(1), 'PR_1', 'hi');
  await t.run();
  expect((await first).ok).toBe(false);
  expect(await t.finish(second)).toEqual({ refusal: 'paused', until: wall(60) });
  expect(t.poller.writesHeldUntil()).toBe(wall(60));
  // Asked for during the pause, none is sent.
  await t.runUntil(30);
  const paused = { refusal: 'paused', until: wall(60) };
  expect(await t.poller.addConversationComment(pr(1), 'PR_1', 'hi')).toEqual(paused);
  expect(await t.poller.resolveThread(pr(1), 'PRRT_1', true)).toEqual(paused);
  expect(await t.poller.enqueue(pr(1), 'PR_1', FULL_SHA, false)).toEqual(paused);
  const merge = mergeOf(directMerge(FULL_SHA, 'SQUASH'));
  expect(await t.poller.mergeAsync(pr(1), merge)).toEqual(paused);
  expect(await t.poller.disableAutoMerge(pr(1), 'PR_1')).toEqual(paused);
  expect(t.requests()).toEqual(log([0, 'POST /issues/1/comments']));
  expect(t.poller.hasUnfinishedWrites()).toBe(false);
});

test('while github asks lo to hold off a base branch change waits then goes', async () => {
  const r = recorded();
  const t = await Polling.start('retarget_waits_while_paused', [
    limitedComment(r),
    ...retargeted(r),
  ]);
  const first = outcome(postComment(t.poller));
  await t.run();
  expect((await first).ok).toBe(false);
  await t.runUntil(10);
  const write = t.poller.retarget(PLAYGROUND, { pr: 2, from: 'stack-a', to: 'main' });
  await t.runUntil(59);
  expect(t.poller.hasUnfinishedWrites()).toBe(true);
  const moving = await t.finish(write);
  expect('base' in moving ? moving.base.ref : moving).toBe('main');
  expect(t.requests()).toEqual(
    log([0, 'POST /issues/1/comments'], [60, 'GET /pulls/2'], [60, 'PATCH /pulls/2']),
  );
});

test('a write waiting out a pause is never sent once polling stops', async () => {
  const r = recorded();
  const t = await Polling.start('write_waiting_stopped', [limitedComment(r), ...retargeted(r)]);
  const first = outcome(postComment(t.poller));
  await t.run();
  await first;
  const write = outcome(t.poller.retarget(PLAYGROUND, { pr: 2, from: 'stack-a', to: 'main' }));
  await t.runUntil(10);
  t.poller.stop();
  const stopped = await write;
  expect(stopped.ok).toBe(false);
  await t.runUntil(120);
  expect(t.requests()).toEqual(log([0, 'POST /issues/1/comments']));
  expect(t.poller.hasUnfinishedWrites()).toBe(false);
});

/** REST's file-level comment on #1, as `sendReview` sends it. */
const FILE_COMMENT = {
  commit_id: FULL_SHA,
  path: 'a.rs',
  body: 'Hm.',
  subject_type: 'file' as const,
};

/** GitHub's answers to {@link FILE_COMMENT}, in order: each `tooFast` or `posted`. */
function fileComments(r: readonly Interaction[], answers: readonly ('tooFast' | 'posted')[]) {
  return answers.map((answered): Interaction => ({
    request: {
      method: 'POST',
      url: 'https://api.github.com/repos/rozed-dev/playground/pulls/1/comments',
      body: JSON.stringify(FILE_COMMENT),
    },
    response:
      answered === 'tooFast'
        ? answer(
            at(r, 0),
            422,
            [],
            `{"message":"Validation Failed","errors":[{"resource":"PullRequestReviewComment",
                "code":"unprocessable","field":"data","message":"was submitted too quickly"}]}`,
          ).response
        : answer(at(r, 0), 201, [], '{"node_id":"PRRC_1"}').response,
  }));
}

test('content github finds too fast holds every write a minute doubling with each in a row', async () => {
  const r = recorded();
  const t = await Polling.start('too_fast_holds_writes', [
    ...fileComments(r, ['tooFast', 'tooFast', 'posted', 'tooFast']),
    ...retargeted(r),
  ]);
  const write: ReviewWrite = { kind: 'postFileComment', body: FILE_COMMENT, head: FULL_SHA };
  const send = () => t.finish(t.poller.sendReview(pr(1), write));
  const refused = { refusal: 'tooFast', message: 'was submitted too quickly' };

  expect(await send()).toEqual(refused);
  // Every write waits a minute: a comment is refused, a base branch change waits for it.
  expect(t.poller.writesHeldUntil()).toBe(wall(60));
  expect(await send()).toEqual({ refusal: 'paused', until: wall(60) });
  // Polls aren't held: reads aren't content.
  expect(t.status()).toEqual(QUIET);
  const moved = await t.finish(
    t.poller.retarget(PLAYGROUND, { pr: 2, from: 'stack-a', to: 'main' }),
  );
  expect('base' in moved ? moved.base.ref : moved).toBe('main');

  // A base branch change says nothing about GitHub's limit on content, so the next refusal is the
  // second in a row: two minutes.
  const second = t.now();
  expect(await send()).toEqual(refused);
  expect(t.poller.writesHeldUntil()).toBe(wall(second + 120));
  // A comment GitHub takes ends the run: the next refusal, a second later, holds writes a minute.
  await t.runUntil(second + 120);
  expect(await send()).toEqual({ comment: 'PRRC_1' });
  expect(await send()).toEqual(refused);
  expect(t.poller.writesHeldUntil()).toBe(wall(second + 121 + 60));
  expect(t.requests()).toEqual(
    log(
      [0, 'POST /pulls/1/comments'],
      [60, 'GET /pulls/2'],
      [60, 'PATCH /pulls/2'],
      [second, 'POST /pulls/1/comments'],
      [second + 120, 'POST /pulls/1/comments'],
      [second + 121, 'POST /pulls/1/comments'],
    ),
  );

  // Timed by the monotonic clock: the wall clock set back an hour, or the Mac asleep for one, holds
  // writes for the minute left, no more and no less.
  const left = (t.poller.writesHeldUntil() ?? 0) - Date.now();
  t.sleep(-3600);
  expect((t.poller.writesHeldUntil() ?? 0) - Date.now()).toBe(left);
  t.sleep(7200);
  expect((t.poller.writesHeldUntil() ?? 0) - Date.now()).toBe(left);
  expect(await t.poller.sendReview(pr(1), write)).toMatchObject({ refusal: 'paused' });
});

test('writes waiting behind a poll github answers with a secondary limit are held', async () => {
  const r = recorded();
  const limited = answer(
    at(r, 0),
    403,
    [['retry-after', '60']],
    '{"message":"You have exceeded a secondary rate limit."}',
  );
  const t = await Polling.start(
    'writes_behind_limited_poll',
    [limited, ...recorded(), comment(r)],
    {
      delay: 1000,
    },
  );
  void t.poller.setOpen(pr(1));
  await t.run();
  // While the open PR's poll is in flight (0–1 s), a comment Lo refuses while paused and a write
  // that waits out a pause are asked for. GitHub's answer asks for a minute from 1 s.
  await t.runUntil(0.5);
  const conversation = t.poller.addConversationComment(pr(1), 'PR_1', 'hi');
  const plain = postComment(t.poller);
  await t.run();
  expect(await t.finish(conversation)).toEqual({ refusal: 'paused', until: wall(61) });
  expect(t.poller.writesHeldUntil()).toBe(wall(61));
  await t.runUntil(60);
  expect(t.requests()).toEqual(log([0, 'GET /pulls/1']));
  expect(idOf(await t.finish(plain))).toBe(1);
  // It waited for the pause to end, then went once, between the polls that came due with it.
  const posted = t.requests().filter(([, what]) => what.startsWith('POST'));
  expect(posted).toHaveLength(1);
  expect(posted[0]?.[0]).toBeGreaterThanOrEqual(61);
});

test('an unstack reads its stack first and refuses when it holds other layers', async () => {
  const r = recorded();
  /** GitHub's stacks holding #1: stack 3, of `layers`. */
  const holding = (layers: readonly number[]): Interaction => ({
    request: {
      method: 'GET',
      url: 'https://api.github.com/repos/rozed-dev/playground/stacks?pull_request=1',
    },
    response: answer(
      at(r, 3),
      200,
      [],
      JSON.stringify([
        {
          number: 3,
          node_id: 'PRS_x',
          base: { ref: 'main' },
          open: true,
          pull_requests: layers.map((number) => ({
            number,
            state: 'open',
            draft: false,
            merged_at: null,
            head: { ref: `stack-${number}`, sha: 'a' },
          })),
        },
      ]),
    ).response,
  });
  const unstacked: Interaction = {
    request: {
      method: 'POST',
      url: 'https://api.github.com/repos/rozed-dev/playground/stacks/3/unstack',
    },
    response: { status: 204, headers: {} },
  };
  const t = await Polling.start('unstack_reads_first', [
    holding([1, 2, 4]),
    holding([1, 2]),
    unstacked,
  ]);
  // #4 was added on top since Lo made the stack of #1 and #2: unstacking would take it out too.
  expect(await t.finish(t.poller.unstack(PLAYGROUND, 3, [1, 2]))).toEqual({
    refusal: 'stackChanged',
  });
  expect(await t.finish(t.poller.unstack(PLAYGROUND, 3, [1, 2]))).toEqual({ left: undefined });
  expect(t.requests().map(([, what]) => what)).toEqual([
    'GET /stacks?pull_request=1',
    'GET /stacks?pull_request=1',
    'POST /stacks/3/unstack',
  ]);
});

test('a stack write given up on is never sent, waiting out a pause or in its turn', async () => {
  const r = recorded();
  const t = await Polling.start('stack_write_given_up', [
    limitedComment(r),
    ...retargeted(r),
    comment(r),
  ]);
  const first = outcome(postComment(t.poller));
  await t.run();
  await first;
  // Waiting out the pause.
  const waiting = new AbortController();
  const held = outcome(
    t.poller.retarget(PLAYGROUND, { pr: 2, from: 'stack-a', to: 'main' }, waiting.signal),
  );
  await t.runUntil(10);
  waiting.abort();
  expect((await held).ok).toBe(false);
  // In its turn, through the second it waits after the write before it: it ends at once.
  await t.runUntil(60);
  const before = postComment(t.poller);
  const turn = new AbortController();
  let ended = false;
  const spaced = outcome(
    t.poller.retarget(PLAYGROUND, { pr: 2, from: 'stack-a', to: 'main' }, turn.signal),
  ).finally(() => {
    ended = true;
  });
  await t.run();
  await t.finish(before);
  await t.run();
  expect(ended).toBe(false);
  turn.abort();
  await t.run();
  expect(ended).toBe(true);
  expect((await spaced).ok).toBe(false);
  await t.runUntil(120);
  expect(t.requests()).toEqual(
    log([0, 'POST /issues/1/comments'], [60, 'POST /issues/1/comments']),
  );
  expect(t.poller.hasUnfinishedWrites()).toBe(false);
});

// Comments and reviews: what each write reads again, with the review threads, your pending review
// and the timeline kept by made-up reads that count their runs.

/**
 * How often each of PR #1's review reads ran, and, for the timeline, whether each run was given
 * what Lo had.
 */
class ReviewRuns {
  threads = 0;
  pending = 0;
  readonly #timeline: boolean[] = [];

  /** Notes a run of the timeline's read, and whether it was given what Lo had. */
  ranTimeline(given: boolean): void {
    this.#timeline.push(given);
  }

  /** Whether each timeline run since the last call was given what Lo had. */
  timeline(): boolean[] {
    return this.#timeline.splice(0);
  }
}

/** PR #1's review threads: `count` of them, `PRRT_0` onwards, each with one posted comment, `PRRC_0` onwards. */
function reviewThreads(count: number): ReviewThreadList {
  return pendingReviewThreads(count, 0);
}

/** {@link reviewThreads}, the first `pending` of them in your pending review. */
function pendingReviewThreads(count: number, pending: number): ReviewThreadList {
  const nodes: Json[] = [];
  for (let n = 0; n < count; n++) {
    nodes.push({
      id: `PRRT_${n}`,
      path: 'a.rs',
      subjectType: 'LINE',
      diffSide: 'RIGHT',
      startDiffSide: null,
      line: 1,
      startLine: null,
      originalLine: 1,
      originalStartLine: null,
      isOutdated: false,
      isResolved: false,
      viewerCanReply: true,
      viewerCanResolve: true,
      viewerCanUnresolve: false,
      comments: {
        totalCount: 1,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            id: `PRRC_${n}`,
            author: { __typename: 'User', login: 'rozed-bot' },
            body: 'Hm.',
            state: n < pending ? 'PENDING' : 'SUBMITTED',
            createdAt: '2026-11-06T12:00:00Z',
            url: 'https://github.com/rozed-dev/playground/pull/1',
            isMinimized: false,
            minimizedReason: null,
            viewerCanUpdate: true,
            viewerCanDelete: true,
            commit: { oid: 'a' },
            originalCommit: { oid: 'a' },
          },
        ],
      },
    });
  }
  return { nodes: unchecked<ReviewThread[]>(nodes), missing: 0 };
}

/** An empty timeline. */
const EMPTY_TIMELINE: PullRequestTimeline = {
  description: {
    author: undefined,
    body: '',
    createdAt: '1970-01-01T00:00:00Z',
    lastEditedAt: undefined,
  },
  items: [],
  leftOut: 0,
  count: 0,
  shownUpdatedAt: '1970-01-01T00:00:00Z',
  readInFullAt: '1970-01-01T00:00:00Z',
};

/**
 * Keeps PR #1's review threads, holding `threads`, your pending review and its timeline, with
 * made-up requests that count their runs in `runs`.
 */
function keepReviewReads(t: Polling, runs: ReviewRuns, threads: ReviewThreadList): void {
  void t.poller.readCached(pr(1), REVIEW_THREADS, () => {
    runs.threads += 1;
    return Promise.resolve(structuredClone(threads));
  });
  void t.poller.readCached(pr(1), PENDING_REVIEW, () => {
    runs.pending += 1;
    return Promise.resolve({ kind: 'read', review: undefined });
  });
  void t.poller.readCached(pr(1), TIMELINE, (_client, known) => {
    runs.ranTimeline(known !== undefined);
    return Promise.resolve(structuredClone(EMPTY_TIMELINE));
  });
}

/**
 * A mutation `operation` with `variables`, answered with `answered`, or the errors in it, for the
 * GraphQL request `like` made.
 */
function mutation(
  like: Interaction,
  operation: string,
  variables: Json,
  answered: Json,
): Interaction {
  const interaction = structuredClone(like);
  interaction.request.operation = operation;
  interaction.request.variables = variables;
  delete interaction.request.query_sha256;
  interaction.response = { status: 200, headers: {}, body: answered };
  return interaction;
}

/** The recorded poll of PR #1 with its review reads kept, run until they've each run once. */
async function reviewing(
  name: string,
  answers: readonly Interaction[],
  threads: ReviewThreadList,
): Promise<{ t: Polling; runs: ReviewRuns }> {
  const t = await Polling.start(name, [...recorded(), ...answers]);
  const runs = new ReviewRuns();
  void t.poller.setOpen(pr(1));
  keepReviewReads(t, runs, threads);
  await t.run();
  await t.runUntil(10);
  expect([runs.threads, runs.pending]).toEqual([1, 1]);
  expect(runs.timeline()).toEqual([false]);
  return { t, runs };
}

/** What each write is planned on: the head the pull request is at. */
const HEAD = 'a3';

test('an edit reads the threads again or the whole timeline', async () => {
  const r = recorded();
  const edited = (operation: string, id: string, field: string) => {
    const root = `${operation.slice(0, 1).toLowerCase()}${operation.slice(1)}`;
    return mutation(
      at(r, 1),
      operation,
      { id, body: 'Edited.' },
      { data: { [root]: { [field]: { id } } } },
    );
  };
  const answers = [
    edited('UpdatePullRequestReviewComment', 'PRRC_0', 'pullRequestReviewComment'),
    edited('UpdateIssueComment', 'IC_1', 'issueComment'),
  ];
  const { t, runs } = await reviewing('edits_read_again', answers, reviewThreads(1));

  // The check sees no edit of a comment, so an edit in a thread reads the threads again.
  const thread: CommentId = { kind: 'thread', id: 'PRRC_0' };
  let edit = t.poller.editComment(pr(1), thread, 'Edited.');
  await t.run();
  await t.runUntil(20);
  await t.finish(edit);
  expect([runs.threads, runs.pending]).toEqual([2, 1]);
  expect(runs.timeline()).toEqual([]);

  // One on the pull request itself reads the timeline again, in full: not given what Lo has, since
  // the comment may be older than its newest page.
  const conversation: CommentId = { kind: 'conversation', id: 'IC_1' };
  edit = t.poller.editComment(pr(1), conversation, 'Edited.');
  await t.run();
  await t.runUntil(30);
  await t.finish(edit);
  expect(runs.threads).toBe(2);
  expect(runs.timeline()).toEqual([false]);
  // Its next refresh reads only what's new again.
  await t.runUntil(340);
  expect(runs.timeline()).toEqual([true]);
});

test('a write to a thread the check doesnt read reads the threads again', async () => {
  const r = recorded();
  const resolved = (thread: string) =>
    mutation(
      at(r, 1),
      'ResolveReviewThread',
      { threadId: thread },
      { data: { resolveReviewThread: { thread: { id: thread, isResolved: true } } } },
    );
  const answers = [
    resolved('PRRT_0'),
    resolved('PRRT_100'),
    mutation(
      at(r, 1),
      'DeletePullRequestReviewComment',
      { id: 'PRRC_100' },
      { data: { deletePullRequestReviewComment: { pullRequestReview: { id: 'PRR_1' } } } },
    ),
    mutation(
      at(r, 1),
      'AddPullRequestReviewThreadReply',
      { pullRequestReviewThreadId: 'PRRT_100', body: 'Agreed.' },
      {
        data: {
          addPullRequestReviewThreadReply: {
            comment: {
              id: 'PRRC_200',
              state: 'SUBMITTED',
              pullRequestReview: { id: 'PRR_2', state: 'COMMENTED' },
            },
          },
        },
      },
    ),
  ];
  const { t, runs } = await reviewing('threads_past_the_check', answers, reviewThreads(101));

  // The check reads the first 100 threads' state, so resolving one of them is left to it, which
  // this replay doesn't change.
  let resolve = t.poller.resolveThread(pr(1), 'PRRT_0', true);
  await t.run();
  await t.runUntil(20);
  await t.finish(resolve);
  expect(runs.threads).toBe(1);
  // Past them, the threads are read again.
  resolve = t.poller.resolveThread(pr(1), 'PRRT_100', true);
  await t.run();
  await t.runUntil(30);
  await t.finish(resolve);
  expect(runs.threads).toBe(2);
  // So are they after deleting a comment there, with the timeline in full: it counts the comments
  // of the comment's review.
  const deleted = t.poller.deleteComment(pr(1), { kind: 'thread', id: 'PRRC_100' });
  await t.run();
  await t.runUntil(40);
  await t.finish(deleted);
  expect(runs.threads).toBe(3);
  expect(runs.timeline()).toEqual([false]);
  // And after a reply posted there at once.
  const reply: ReviewWrite = {
    kind: 'postReply',
    head: HEAD,
    variables: {
      pullRequestReviewThreadId: 'PRRT_100',
      body: 'Agreed.',
      pullRequestReviewId: undefined,
    },
  };
  const sent = t.poller.sendReview(pr(1), reply);
  await t.run();
  await t.runUntil(50);
  const answered = await t.finish(sent);
  expect('comment' in answered ? answered.comment : answered).toBe('PRRC_200');
  expect(runs.threads).toBe(4);
  expect(runs.pending).toBe(1);
});

test('a refused second pending review reads your pending review again', async () => {
  const r = recorded();
  const refused = mutation(
    at(r, 1),
    'AddPullRequestReview',
    { pullRequestId: 'PR_1', commitOID: 'a3' },
    {
      data: { addPullRequestReview: null },
      errors: [
        {
          type: 'UNPROCESSABLE',
          path: ['addPullRequestReview'],
          message: 'User can only have one pending review per pull request',
        },
      ],
    },
  );
  const { t, runs } = await reviewing('pending_elsewhere', [refused], reviewThreads(1));

  // Lo planned a new review: one was started elsewhere since it last read yours.
  const start: ReviewWrite = {
    kind: 'startReview',
    head: HEAD,
    variables: {
      pullRequestId: 'PR_1',
      commitOID: 'a3',
      event: undefined,
      body: undefined,
      threads: undefined,
    },
  };
  const sent = t.poller.sendReview(pr(1), start);
  await t.run();
  await t.runUntil(20);
  expect(await t.finish(sent)).toEqual({ refusal: 'pendingReviewExists' });
  expect([runs.threads, runs.pending]).toEqual([2, 2]);
  expect(runs.timeline()).toEqual([]);
});

test('a reply that joined a pending review lo didnt know reads it again', async () => {
  const r = recorded();
  const joined = mutation(
    at(r, 1),
    'AddPullRequestReviewThreadReply',
    { pullRequestReviewThreadId: 'PRRT_0', body: 'Agreed.' },
    {
      data: {
        addPullRequestReviewThreadReply: {
          comment: {
            id: 'PRRC_9',
            state: 'PENDING',
            pullRequestReview: { id: 'PRR_elsewhere', state: 'PENDING' },
          },
        },
      },
    },
  );
  const { t, runs } = await reviewing('joined_pending', [joined], reviewThreads(1));

  // Sent to be posted at once, it went into a pending review started elsewhere.
  const reply: ReviewWrite = {
    kind: 'postReply',
    head: HEAD,
    variables: {
      pullRequestReviewThreadId: 'PRRT_0',
      body: 'Agreed.',
      pullRequestReviewId: undefined,
    },
  };
  const sent = t.poller.sendReview(pr(1), reply);
  await t.run();
  await t.runUntil(20);
  const answered = await t.finish(sent);
  expect('joinedPending' in answered ? answered.joinedPending : answered).toBe('PRR_elsewhere');
  expect([runs.threads, runs.pending]).toEqual([2, 2]);
  expect(runs.timeline()).toEqual([]);
});

/** What adding a thread on line `line` of `a.rs` to your pending review `PRR_1` sends. */
function added(line: number): Json {
  return {
    pullRequestReviewId: 'PRR_1',
    path: 'a.rs',
    body: 'Hm.',
    subjectType: 'LINE',
    line,
    side: 'RIGHT',
  };
}

/** A thread on line `line` of `a.rs`, added to your pending review `PRR_1`. */
function addThread(line: number): ReviewWrite {
  return {
    kind: 'addThread',
    head: HEAD,
    variables: {
      pullRequestReviewId: 'PRR_1',
      path: 'a.rs',
      body: 'Hm.',
      subjectType: 'LINE',
      line,
      side: 'RIGHT',
      startLine: undefined,
      startSide: undefined,
    },
  };
}

test('a write refused because its review changed elsewhere reads it again', async () => {
  const r = recorded();
  const answers = [
    // Deleted elsewhere: "not found".
    mutation(at(r, 1), 'AddPullRequestReviewThread', added(1), {
      data: { addPullRequestReviewThread: null },
      errors: [
        {
          type: 'NOT_FOUND',
          path: ['addPullRequestReviewThread'],
          message: "Could not resolve to a node with the global id of 'PRR_1'.",
        },
      ],
    }),
    // A line outside the diff, in a review still pending.
    mutation(at(r, 1), 'AddPullRequestReviewThread', added(9), {
      data: { addPullRequestReviewThread: { thread: null } },
    }),
    mutation(
      at(r, 1),
      'ReviewState',
      { id: 'PRR_1' },
      { data: { node: { __typename: 'PullRequestReview', state: 'PENDING' } } },
    ),
  ];
  const { t, runs } = await reviewing('review_changed', answers, reviewThreads(1));

  let sent = t.poller.sendReview(pr(1), addThread(1));
  await t.run();
  await t.runUntil(20);
  expect(await t.finish(sent)).toEqual({ refusal: 'gone' });
  expect([runs.threads, runs.pending]).toEqual([2, 2]);
  // Refused as outside the diff, it may still have started a review elsewhere: read again.
  sent = t.poller.sendReview(pr(1), addThread(9));
  await t.run();
  await t.runUntil(30);
  expect(await t.finish(sent)).toEqual({ refusal: 'notInDiff' });
  expect([runs.threads, runs.pending]).toEqual([3, 3]);
  expect(runs.timeline()).toEqual([]);
});

/**
 * A comment whose answer was lost may have posted, into your pending review or not: the threads
 * and your pending review are read again, so the UI can look for it there.
 */
test('a comment whose answer was lost reads the threads and your pending review again', async () => {
  const r = recorded();
  const lost = mutation(at(r, 1), 'AddPullRequestReviewThread', added(1), {
    message: 'Server Error',
  });
  lost.response.status = 502;
  const { t, runs } = await reviewing('lost_answer', [lost], reviewThreads(1));

  const sent = outcome(t.poller.sendReview(pr(1), addThread(1)));
  await t.run();
  await t.runUntil(20);
  const answered = await t.finish(sent);
  const error = answered.ok ? undefined : answered.error;
  expect(error instanceof GithubError && error.mayHavePosted()).toBe(true);
  expect([runs.threads, runs.pending]).toEqual([2, 2]);
  expect(runs.timeline()).toEqual([]);
});

test('deleting a pending comment leaves the timeline alone', async () => {
  const r = recorded();
  const deleted = (id: string) =>
    mutation(
      at(r, 1),
      'DeletePullRequestReviewComment',
      { id },
      { data: { deletePullRequestReviewComment: { pullRequestReview: { id: 'PRR_1' } } } },
    );
  const answers = [deleted('PRRC_0'), deleted('PRRC_1')];
  const { t, runs } = await reviewing('delete_pending', answers, pendingReviewThreads(2, 1));

  // Your pending review isn't in the timeline: the check's count of its comments reads it again.
  let deleting = t.poller.deleteComment(pr(1), { kind: 'thread', id: 'PRRC_0' });
  await t.run();
  await t.runUntil(20);
  await t.finish(deleting);
  expect(runs.timeline()).toEqual([]);
  expect(runs.threads).toBe(1);
  // A posted one's review is, and may be past the newest page.
  deleting = t.poller.deleteComment(pr(1), { kind: 'thread', id: 'PRRC_1' });
  await t.run();
  await t.runUntil(30);
  await t.finish(deleting);
  expect(runs.timeline()).toEqual([false]);
});
