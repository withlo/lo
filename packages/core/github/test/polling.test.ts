// The poller's schedule on a fake clock: what each poll asks, and what it fetches again, replaying
// `poll_playground` and edited copies of its answers.

import type { Interaction } from '@lo/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  answer,
  askedSince,
  at,
  answering,
  detailsTitled,
  etag,
  forPull,
  lastModified,
  log,
  NOON,
  object,
  PLAYGROUND,
  Polling,
  pr,
  QUIET,
  recorded,
  repoAnswers,
  updated,
  useFakeClock,
  wall,
  withBody,
  type Logged,
} from './support/polling.ts';
import { unresolvedThreads } from '../src/queries.ts';

beforeEach(useFakeClock);

afterEach(() => {
  vi.useRealTimers();
});

test('the first poll fetches everything and later ones only ask', async () => {
  const t = await Polling.start('first_poll', recorded());
  void t.poller.watch(pr(2));
  const cached = t.poller.setOpen(pr(1));
  await t.run();
  expect(await cached).toBeUndefined();
  expect(t.requests()).toEqual(
    log(
      [0, 'GET /pulls/1'],
      [0, 'PullRequestCheck'],
      [0, 'PullRequest'],
      [0, 'GET /pulls/2'],
      [0, 'GET /pulls?state=open&per_page=100'],
      [0, 'OpenPullRequests'],
      [0, 'TrunkRules'],
    ),
  );
  expect(t.events()).toEqual([
    'summary #1: feat: stack layer A',
    'check #1',
    'details #1: feat: stack layer A',
    'summary #2: feat: stack layer B',
    'rulesets of rozed-dev/playground',
    'open PRs of rozed-dev/playground: 2',
  ]);

  // The open PR every 20 s: a free conditional GET and the 1-point check. Everything else every
  // 2 minutes: free conditional GETs.
  await t.runUntil(120);
  const expected: Logged[] = [];
  for (const secs of [20, 40, 60, 80, 100, 120]) {
    expected.push([secs, 'GET /pulls/1 (since)'], [secs, 'PullRequestCheck']);
  }
  expected.push([120, 'GET /pulls/2 (since)'], [120, 'GET /pulls?state=open&per_page=100 (etag)']);
  expect(t.requests()).toEqual(expected);
  expect(t.events()).toEqual([]);

  // The open PR is asked about changes since GitHub last updated it.
  const since = lastModified(at(recorded(), 0));
  expect(t.http.seen[7]?.headers.get('if-modified-since')).toBe(since);
  expect(t.status()).toEqual(QUIET);

  const answered = t.poller.pullRequest(pr(1));
  expect(answered?.details.title).toBe('feat: stack layer A');
  expect(answered?.fetchedAt).toBe(wall(120));
  expect(answered?.offlineAge).toBeUndefined();
  expect(t.poller.summary(pr(2))?.head.ref).toBe('stack-b');
  const open = t.poller.openPullRequests(PLAYGROUND);
  expect(open?.value.pullRequests).toHaveLength(2);
  expect(open?.fetchedAt).toBe(wall(120));
});

test('details are fetched again only when something changed', async () => {
  const r = recorded();
  const changedRest = updated(askedSince(at(r, 0), lastModified(at(r, 0))), (body) => {
    body['title'] = 'retitled again';
  });
  const movedTimeline = withBody(at(r, 1), (body) => {
    object(body, 'data', 'repository', 'pullRequest', 'timelineItems')['updatedAt'] =
      '2026-11-06T12:00:00Z';
  });
  const interactions = [
    // GET /pulls/1: 200, two 304s, a 200 for a retitle, then 304s since it.
    at(r, 0),
    at(r, 6),
    at(r, 6),
    changedRest,
    askedSince(at(r, 6), NOON[1]),
    // The check: the same twice, then the timeline moves.
    at(r, 1),
    at(r, 1),
    movedTimeline,
    // The details, as they change.
    at(r, 2),
    detailsTitled(r, 'retitled'),
    detailsTitled(r, 'retitled again'),
    ...repoAnswers(r),
  ];
  const t = await Polling.start('change_detection', interactions);
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(80);
  const pullOne = t
    .requests()
    .filter(
      ([, what]) =>
        !what.includes('/pulls?') && what !== 'OpenPullRequests' && what !== 'TrunkRules',
    );
  expect(pullOne).toEqual(
    log(
      [0, 'GET /pulls/1'],
      [0, 'PullRequestCheck'],
      [0, 'PullRequest'],
      // Nothing changed.
      [20, 'GET /pulls/1 (since)'],
      [20, 'PullRequestCheck'],
      // The check changed.
      [40, 'GET /pulls/1 (since)'],
      [40, 'PullRequestCheck'],
      [40, 'PullRequest'],
      // The REST answer changed.
      [60, 'GET /pulls/1 (since)'],
      [60, 'PullRequestCheck'],
      [60, 'PullRequest'],
      [80, 'GET /pulls/1 (since)'],
      [80, 'PullRequestCheck'],
    ),
  );
  expect(t.events()).toEqual([
    'summary #1: feat: stack layer A',
    'check #1',
    'details #1: feat: stack layer A',
    'rulesets of rozed-dev/playground',
    'open PRs of rozed-dev/playground: 2',
    'check #1',
    'details #1: retitled',
    'summary #1: retitled again',
    'details #1: retitled again',
  ]);
  // The next poll asks about changes since the retitle.
  const last = t.http.seen.at(-2);
  expect(last?.headers.get('if-modified-since')).toBe(NOON[1]);
});

test('a watched pr that changed is fetched in full when opened again', async () => {
  const r = recorded();
  const pushed = updated(askedSince(at(r, 3), lastModified(at(r, 3))), (body) => {
    object(body, 'head')['sha'] = '0123456789abcdef0123456789abcdef01234567';
  });
  const interactions = [
    at(r, 0),
    at(r, 1),
    at(r, 2),
    at(r, 6),
    // GET /pulls/2: 200, then a push, then 304s since it.
    at(r, 3),
    pushed,
    askedSince(at(r, 8), NOON[1]),
    // PR #2's check never changes; its details do.
    forPull(at(r, 1), 2),
    forPull(detailsTitled(r, 'layer B'), 2),
    forPull(detailsTitled(r, 'layer B, pushed'), 2),
    ...repoAnswers(r),
  ];
  const t = await Polling.start('watched_then_opened', interactions);
  void t.poller.setOpen(pr(2));
  await t.run();
  await t.runUntil(10);
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(120);
  t.events();
  t.requests();
  // At 120 s, #2 is watched: only its conditional GET, which shows the push.
  expect(t.poller.summary(pr(2))?.head.sha).toBe('0123456789abcdef0123456789abcdef01234567');

  await t.runUntil(130);
  t.requests();
  void t.poller.setOpen(pr(2));
  await t.run();
  expect(t.requests()).toEqual(
    log(
      [130, 'GET /pulls/2 (since)'],
      [130, 'PullRequestCheck'],
      // The check is the same, but the push means the details are stale.
      [130, 'PullRequest'],
    ),
  );
  // The check is the same, so no check event.
  expect(t.events()).toEqual(['details #2: layer B, pushed']);
});

/**
 * GitHub's REST view of a pull request, as it would answer after a push to another branch in the
 * repository: only the embedded repositories changed.
 */
function afterAPushElsewhere(interaction: Interaction): Interaction {
  return withBody(interaction, (body) => {
    const pushedAt = '2026-11-06T12:49:58Z';
    const pulls = Array.isArray(body) ? body : [body];
    for (const pull of pulls) {
      object(pull, 'base', 'repo')['pushed_at'] = pushedAt;
      object(pull, 'head', 'repo')['pushed_at'] = pushedAt;
    }
  });
}

test('a pull request that answers 200 unchanged isnt fetched again', async () => {
  const r = recorded();
  const since = lastModified(at(r, 0));
  const interactions = [
    at(r, 0),
    // GitHub answers 200 although the pull request is the same.
    afterAPushElsewhere(askedSince(at(r, 0), since)),
    askedSince(at(r, 6), since),
    at(r, 1),
    at(r, 2),
    // PR #2, watched: the same.
    at(r, 3),
    afterAPushElsewhere(askedSince(at(r, 3), lastModified(at(r, 3)))),
    askedSince(at(r, 8), lastModified(at(r, 3))),
    forPull(at(r, 1), 2),
    forPull(detailsTitled(r, 'layer B'), 2),
    ...repoAnswers(r),
  ];
  const t = await Polling.start('unchanged_200', interactions);
  void t.poller.watch(pr(2));
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(5);
  t.requests();
  t.events();
  await t.runUntil(130);
  const pulls = t
    .requests()
    .filter(([, what]) => !what.includes('/pulls?'))
    .slice(0, 4);
  expect(pulls).toEqual(
    log(
      // A 200, but the same pull request: no details.
      [20, 'GET /pulls/1 (since)'],
      [20, 'PullRequestCheck'],
      [40, 'GET /pulls/1 (since)'],
      [40, 'PullRequestCheck'],
    ),
  );
  expect(t.events()).toEqual([]);

  // PR #2 answered 200 unchanged at 120 s: its check stands, so opening it fetches its details
  // only because they were never fetched, and sends no summary.
  void t.poller.setOpen(pr(2));
  await t.run();
  expect(t.events()).toEqual(['check #2', 'details #2: layer B']);
});

test('a check that changes is sent', async () => {
  const r = recorded();
  // Checks start running and a review thread is opened; nothing else moves.
  const moved = withBody(at(r, 1), (body) => {
    const pull = object(body, 'data', 'repository', 'pullRequest');
    pull['statusCheckRollup'] = { state: 'PENDING' };
    pull['reviewThreads'] = {
      totalCount: 1,
      nodes: [{ isResolved: false, comments: { totalCount: 1 } }],
    };
  });
  const interactions = [at(r, 0), at(r, 6), at(r, 1), moved, at(r, 2), ...repoAnswers(r)];
  const t = await Polling.start('check_changes', interactions);
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(5);
  t.events();
  await t.runUntil(20);
  expect(t.events()).toEqual(['check #1']);
  const check = t.poller.check(pr(1));
  expect(check && unresolvedThreads(check)).toBe(1);
  expect(check?.statusCheckRollup?.state).toBe('PENDING');
});

test('a list that answers 200 unchanged isnt fetched again', async () => {
  const r = recorded();
  const moved = afterAPushElsewhere(answering(at(r, 4), etag(at(r, 4)), '"moved"'));
  moved.response.status = 200;
  const interactions = [
    at(r, 4),
    at(r, 5),
    moved,
    answering(at(r, 9), '"moved"', '"moved"'),
    at(r, 3),
    at(r, 8),
    at(r, 10),
  ];
  const t = await Polling.start('unchanged_list', interactions);
  void t.poller.watch(pr(2));
  await t.run();
  await t.runUntil(5);
  t.requests();
  t.events();
  await t.runUntil(250);
  expect(t.requests().filter(([, what]) => !what.includes('/pulls/2'))).toEqual(
    log(
      // A new ETag, but the same open PRs: no OpenPullRequests.
      [120, 'GET /pulls?state=open&per_page=100 (etag)'],
      [240, 'GET /pulls?state=open&per_page=100 (etag)'],
    ),
  );
  expect(t.events()).toEqual([]);
  // The new ETag is the one sent next.
  const last = t.http.seen.findLast((seen) => seen.url.includes('/pulls?'));
  expect(last?.headers.get('if-none-match')).toBe('"moved"');
});

/** A page of the playground's open PRs: copies of the recorded first one, numbered `from` to `to`, newest first. */
function pageOf(
  r: readonly Interaction[],
  page: number,
  [from, to]: [number, number],
  tag: string,
): Interaction {
  const interaction = at(r, 4);
  if (page > 1) interaction.request.url = `${interaction.request.url}&page=${page}`;
  const first = object(interaction.response.body, 0);
  const pulls = [];
  for (let number = to - 1; number >= from; number--) {
    pulls.push({ ...structuredClone(first), number });
  }
  interaction.response.body = pulls;
  interaction.response.headers['etag'] = tag;
  return interaction;
}

test('every page of open prs is watched', async () => {
  const r = recorded();
  const pageTwo = pageOf(r, 2, [1, 3], '"two"');
  const closed = pageOf(r, 2, [1, 2], '"two, one closed"');
  closed.request.if_none_match = '"two"';
  const unchangedOne = at(r, 9);
  unchangedOne.request.if_none_match = '"one"';
  const interactions = [
    pageOf(r, 1, [3, 103], '"one"'),
    pageTwo,
    at(r, 5),
    unchangedOne,
    closed,
    at(r, 3),
    at(r, 8),
    at(r, 10),
  ];
  const t = await Polling.start('pages', interactions);
  void t.poller.watch(pr(2));
  await t.run();
  await t.runUntil(130);
  const repo = t.requests().filter(([, what]) => !what.includes('/pulls/2'));
  expect(repo).toEqual(
    log(
      [0, 'GET /pulls?state=open&per_page=100'],
      [0, 'GET /pulls?state=open&per_page=100&page=2'],
      [0, 'OpenPullRequests'],
      [0, 'TrunkRules'],
      // The first page is the same, but an older PR on the second closed.
      [120, 'GET /pulls?state=open&per_page=100 (etag)'],
      [120, 'GET /pulls?state=open&per_page=100&page=2 (etag)'],
      [120, 'OpenPullRequests'],
    ),
  );
});

test('opening a pr while its watched poll is in flight polls it at once', async () => {
  const r = recorded();
  const interactions = [
    at(r, 0),
    at(r, 1),
    at(r, 2),
    at(r, 6),
    at(r, 3),
    at(r, 8),
    forPull(at(r, 1), 2),
    forPull(detailsTitled(r, 'layer B'), 2),
    ...repoAnswers(r),
  ];
  const t = await Polling.start('open_in_flight', interactions, { delay: 1000 });
  void t.poller.watch(pr(2));
  void t.poller.setOpen(pr(1));
  await t.run();
  // Step until PR #2's second watched GET is in flight, then open it.
  while (!t.http.log.some(([, what]) => what === 'GET /pulls/2 (since)')) {
    await t.runUntil(t.now() + 1);
  }
  const openedAt = t.now();
  t.requests();
  t.events();
  void t.poller.setOpen(pr(2));
  await t.run();
  await t.runUntil(openedAt + 5);
  // As soon as the watched GET is back: the open PR's poll, with its details.
  expect(t.requests().filter(([, what]) => !what.includes('/pulls?'))).toEqual(
    log(
      [openedAt + 1, 'GET /pulls/2 (since)'],
      [openedAt + 2, 'PullRequestCheck'],
      [openedAt + 3, 'PullRequest'],
    ),
  );
  expect(t.events()).toEqual(['check #2', 'details #2: layer B']);
});

/** One poll of everything at `secs`: the open PR, the other PR and the repository. */
function everything(secs: number): Logged[] {
  return [
    [secs, 'GET /pulls/1 (since)'],
    [secs, 'PullRequestCheck'],
    [secs, 'GET /pulls/2 (since)'],
    [secs, 'GET /pulls?state=open&per_page=100 (etag)'],
  ];
}

test('in the background everything polls every five minutes', async () => {
  const t = await Polling.start('background', recorded());
  void t.poller.watch(pr(2));
  await t.run();
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(5);
  t.requests();
  t.poller.setForeground(false);
  await t.run();
  await t.runUntil(610);
  expect(t.requests()).toEqual([...everything(300), ...everything(600)]);

  // Coming back polls the open PR at once, with its details, older than 5 minutes, then every
  // 20 s.
  t.poller.setForeground(true);
  await t.run();
  await t.runUntil(630);
  expect(t.requests()).toEqual(
    log(
      [610, 'GET /pulls/1 (since)'],
      [610, 'PullRequestCheck'],
      [610, 'PullRequest'],
      [630, 'GET /pulls/1 (since)'],
      [630, 'PullRequestCheck'],
    ),
  );
});

test('reopening shows the cache at once and its first poll is free', async () => {
  const t = await Polling.start('reopen', recorded());
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(5);
  t.requests();
  t.events();

  await t.restart();
  const opened = t.poller.setOpen(pr(1));
  const answered = await opened;
  // Before any request, the cached copy and the repository's open PRs are there.
  expect(t.poller.openPullRequests(PLAYGROUND)).toBeDefined();
  await t.run();
  expect(answered?.details.title).toBe('feat: stack layer A');
  expect(answered?.fetchedAt).toBe(wall(0));
  // Its first poll sends the cached ETags, so it costs one GraphQL point and no details.
  expect(t.requests()).toEqual(
    log(
      [5, 'GET /pulls/1 (since)'],
      [5, 'PullRequestCheck'],
      [5, 'GET /pulls?state=open&per_page=100 (etag)'],
    ),
  );
  expect(t.events()).toEqual([]);
  const recent = t.cache.recent.slice(0, 10);
  expect(recent).toHaveLength(1);
  expect([recent[0]?.pull, recent[0]?.title]).toEqual([pr(1), 'feat: stack layer A']);
  expect(recent[0]?.openedAt).toBe(wall(5));
});

test('the open prs details are fetched in full every five minutes', async () => {
  const t = await Polling.start('details_refresh', recorded());
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(5);
  t.requests();
  await t.runUntil(620);
  const details = t
    .requests()
    .filter(([, what]) => what === 'PullRequest')
    .map(([secs]) => secs);
  // Viewed marks set on github.com move nothing the check sees.
  expect(details).toEqual([300, 600]);

  // Not in the background.
  t.poller.setForeground(false);
  await t.run();
  await t.runUntil(1300);
  expect(t.requests().some(([, what]) => what === 'PullRequest')).toBe(false);
  // Back in the foreground, details older than 5 minutes are fetched at once.
  t.poller.setForeground(true);
  await t.run();
  expect(t.requests()).toEqual(
    log([1300, 'GET /pulls/1 (since)'], [1300, 'PullRequestCheck'], [1300, 'PullRequest']),
  );
});

test('a failed poll is reported and tried again at its interval', async () => {
  const r = recorded();
  const missing = answer(
    at(r, 3),
    404,
    [],
    '{"message":"Not Found","documentation_url":"https://docs.github.com/rest","status":"404"}',
  );
  missing.request.url = 'https://api.github.com/repos/rozed-dev/playground/pulls/99';
  const t = await Polling.start('failed', [...repoAnswers(r), missing]);
  void t.poller.watch(pr(99));
  await t.run();
  await t.runUntil(120);
  expect(t.requests()).toEqual(
    log(
      [0, 'GET /pulls/99'],
      [0, 'GET /pulls?state=open&per_page=100'],
      [0, 'OpenPullRequests'],
      [0, 'TrunkRules'],
      [120, 'GET /pulls/99'],
      [120, 'GET /pulls?state=open&per_page=100 (etag)'],
    ),
  );
  const failed = t.events().filter((event) => event.startsWith('failed'));
  expect(failed).toHaveLength(2);
  expect(t.status()).toEqual(QUIET);
});

test('a poll that fails after its pr is unwatched isnt reported', async () => {
  const r = recorded();
  const missing = answer(at(r, 3), 404, [], '{"message":"Not Found"}');
  missing.request.url = 'https://api.github.com/repos/rozed-dev/playground/pulls/99';
  const t = await Polling.start('failed_unwatched', [missing], { delay: 1000 });
  void t.poller.watch(pr(99));
  // Its repository isn't polled in this test.
  void t.poller.setOpen(undefined);
  await t.run();
  expect(t.requests()).toEqual(log([0, 'GET /pulls/99']));
  t.poller.unwatch(pr(99));
  await t.run();
  await t.runUntil(5);
  expect(t.events()).toEqual([]);
});

test('unwatching stops polling', async () => {
  const t = await Polling.start('unwatching', recorded());
  void t.poller.watch(pr(2));
  await t.run();
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(5);
  t.poller.unwatch(pr(2));
  await t.run();
  t.requests();
  await t.runUntil(120);
  // #1 and the repository are still watched.
  expect(t.requests().filter(([, what]) => what.includes('/pulls/2'))).toHaveLength(0);
  void t.poller.setOpen(undefined);
  t.poller.unwatch(pr(1));
  await t.run();
  await t.runUntil(1000);
  expect(t.requests()).toEqual([]);
  expect(t.poller.openPullRequests(PLAYGROUND)).toBeUndefined();
});

test('the poller notes every head it sees', async () => {
  const r = recorded();
  const pushed = '1111111111111111111111111111111111111111';
  const moved = updated(askedSince(at(r, 3), lastModified(at(r, 3))), (body) => {
    object(body, 'head')['sha'] = pushed;
  });
  const interactions = recorded();
  // Ahead of the recorded 304, so it's the answer to the second poll.
  interactions.splice(8, 0, moved);
  const t = await Polling.start('seen_heads', interactions);
  void t.poller.watch(pr(2));
  void t.poller.setOpen(pr(1));
  await t.run();
  const seen = (number: number) => t.heads.get(pr(number).key);
  // The open PR's head from its summary, check and details, which agree; the other PR's from its
  // summary.
  const head1 = t.poller.summary(pr(1))?.head.sha;
  expect(seen(1)).toEqual([[head1, wall(0)]]);
  const head2 = t.poller.summary(pr(2))?.head.sha;
  expect(seen(2)).toEqual([[head2, wall(0)]]);

  // A push to PR #2, seen at its next poll.
  await t.runUntil(120);
  expect(t.poller.summary(pr(2))?.head.sha).toBe(pushed);
  expect(seen(2)).toEqual([
    [head2, wall(0)],
    [pushed, wall(120)],
  ]);
  expect(seen(1)).toEqual([[head1, wall(0)]]);
});

test('rulesets are read with the repository and again every half hour', async () => {
  const t = await Polling.start('trunk_rules', recorded());
  expect(t.poller.trunkRules(PLAYGROUND)).toBeUndefined();
  void t.poller.setOpen(pr(1));
  await t.run();
  const reads = () =>
    t
      .requests()
      .filter(([, what]) => what === 'TrunkRules')
      .map(([secs]) => secs);
  expect(reads()).toEqual([0]);
  expect(t.events()).toContain('rulesets of rozed-dev/playground');
  const rules = t.poller.trunkRules(PLAYGROUND);
  expect(rules?.value.unavailable).toBeUndefined();
  // Every PR in the repository has them, not only the open one.
  void t.poller.watch(pr(2));
  await t.run();
  expect(t.poller.trunkRules(PLAYGROUND)).toBeDefined();
  await t.runUntil(1799);
  expect(reads()).toEqual([]);
  await t.runUntil(1920);
  expect(reads()).toEqual([1800]);

  // After a restart, they're there at once.
  await t.restart();
  const watched = t.poller.watch(pr(1));
  await t.run();
  await watched;
  expect(t.poller.trunkRules(PLAYGROUND)).toBeDefined();
});
