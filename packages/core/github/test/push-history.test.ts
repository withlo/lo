/**
 * Reading pull requests' push histories, from recorded answers and answers made up from them:
 *
 * - `rozed-dev/e2e#14`, closed after a full run of six revisions with GitHub's own rebase between
 *   r4 and r5; rozed-bot reviewed r2.
 * - `sharkdp/fd` #2212, open, from the fork `voidsipp/fd`; and #2202, merged with a merge commit
 *   from a fork since deleted. Read as rozed-bot, read only.
 *
 * Each cassette holds two reads, the second asking about each page of pushes with its ETag.
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

import {
  activityEntries,
  branchActivity,
  type ActivityDirection,
  type ActivityEntry,
  type BranchActivity,
} from '../src/activity.ts';
import { GithubClient } from '../src/client.ts';
import { unchecked } from '../src/json.ts';
import {
  pullRequestRevisionsPaged,
  PUSH_HISTORY_WATCHED,
  pushHistoryIsComplete,
  readPushHistory,
  unavailableHeads,
  type PushHistory,
} from '../src/push-history.ts';
import { pullRequestCheck } from '../src/queries.ts';
import { PullRef, RepoRef } from '../src/refs.ts';
import { Token } from '../src/token.ts';

const BOT = 'rozed-bot';

function client(fetch: ReplayFetch): GithubClient {
  return new GithubClient({ fetch, token: new Token('gho_FAKE') });
}

function e2e(number: number): PullRef {
  return new PullRef('rozed-dev', 'e2e', number);
}

/** A cassette's interactions, in order, to edit. */
function recorded(name: string): Interaction[] {
  return structuredClone(cassette(name).interactions.map(({ interaction }) => interaction));
}

/** A replaying `fetch` that answers with `interactions`. */
function answering(name: string, interactions: Interaction[]): ReplayFetch {
  return replayFetch(new Replay(name, interactions));
}

type JsonObject = { [key: string]: Json };

function object(value: Json | undefined): JsonObject {
  if (!isObject(value)) throw new Error(`expected an object, got ${JSON.stringify(value)}`);
  return value;
}

function list(value: Json | undefined): Json[] {
  if (!Array.isArray(value)) throw new Error(`expected a list, got ${JSON.stringify(value)}`);
  return value;
}

/** The pull request in a GraphQL answer, to edit. */
function pullOf(interaction: Interaction): JsonObject {
  return object(object(object(object(interaction.response.body).data).repository).pullRequest);
}

/** A time as GitHub writes it, from milliseconds since the Unix epoch. */
function iso(at: number): string {
  return new Date(at).toISOString().replace('.000Z', 'Z');
}

/** An activity entry for a push at `minute` past 10:00 on 2026-11-06. */
function entry(id: number, before: string, after: string, minute: number, kind: string): Json {
  return {
    id,
    node_id: `RA_${id}`,
    before,
    after,
    ref: 'refs/heads/branch',
    timestamp: iso(Date.parse('2026-11-06T10:00:00Z') + minute * 60_000),
    activity_type: kind,
    actor: { login: 'someone' },
  };
}

function sha(n: number): string {
  return n.toString(16).padStart(40, '0');
}

/** `count` normal pushes, one a minute, after the branch is created at `sha(1)`. */
function pushes(count: number): Json[] {
  const entries = [entry(1, '0'.repeat(40), sha(1), 0, 'branch_creation')];
  for (let n = 2; n <= count; n++) entries.push(entry(n, sha(n - 1), sha(n), n, 'push'));
  return entries;
}

function page(url: string, etag: string, next: string | undefined, entries: Json[]): Interaction {
  const headers: Record<string, string> = { etag };
  if (next !== undefined) headers['link'] = `<${next}>; rel="next"`;
  return {
    request: { method: 'GET', url },
    response: { status: 200, headers, body: entries },
  };
}

function notModified(url: string, etag: string): Interaction {
  return {
    request: { method: 'GET', url, if_none_match: etag },
    response: { status: 304, headers: { etag } },
  };
}

const FIRST =
  'https://api.github.com/repos/o/r/activity?ref=refs%2Fheads%2Fbranch&direction=asc&per_page=100';
const SECOND =
  'https://api.github.com/repositories/1/activity?ref=refs%2Fheads%2Fbranch&direction=asc&per_page=100&after=CURSOR';

function readBranch(
  github: GithubClient,
  direction: ActivityDirection,
  known: BranchActivity | undefined,
  enough: (entry: ActivityEntry) => boolean,
): Promise<BranchActivity> {
  return branchActivity(github, new RepoRef('o', 'r'), 'branch', {
    direction,
    known,
    maxPages: 10,
    enough,
  });
}

/** Each request's URL, and whether it asked with an ETag. */
function requests(fetch: ReplayFetch): [string, boolean][] {
  return fetch.seen.map((seen) => [seen.url, seen.headers.has('if-none-match')]);
}

test('reading again asks about each page with its etag', async () => {
  const reads: [string, PullRef][] = [
    ['push_history_e2e_14', e2e(14)],
    ['push_history_fd_2212', new PullRef('sharkdp', 'fd', 2212)],
    ['push_history_fd_2202', new PullRef('sharkdp', 'fd', 2202)],
  ];
  for (const [name, pull] of reads) {
    const fetch = replayFetch(name);
    const github = client(fetch);
    const first = await readPushHistory(github, pull, BOT);
    const before = fetch.seen.length;

    const again = await readPushHistory(github, pull, BOT, first);

    expect(again).toEqual(first);
    const activity = fetch.seen.slice(before).filter((seen) => seen.url.includes('/activity'));
    expect(activity.length).toBeGreaterThan(0);
    // Every page asked about with its ETag.
    const withoutEtag = activity.filter((seen) => !seen.headers.has('if-none-match'));
    expect(withoutEtag.map((seen) => seen.url)).toEqual([]);
  }
});

// Paging, on answers made up from the recorded ones.

test('reads every page of pushes and asks about each again with its etag', async () => {
  const entries = pushes(150);
  const fetch = answering('paged_activity', [
    page(FIRST, '"p1"', SECOND, entries.slice(0, 100)),
    page(SECOND, '"p2"', undefined, entries.slice(100)),
    notModified(FIRST, '"p1"'),
    notModified(SECOND, '"p2"'),
  ]);
  const github = client(fetch);

  const first = await readBranch(github, 'asc', undefined, () => false);
  expect(activityEntries(first)).toHaveLength(150);
  expect(activityEntries(first)[149]?.after).toBe(sha(150));
  expect(first.pages[0]?.next).toBe(SECOND);
  const again = await readBranch(github, 'asc', first, () => false);

  expect(again).toEqual(first);
  expect(requests(fetch)).toEqual([
    [FIRST, false],
    [SECOND, false],
    [FIRST, true],
    [SECOND, true],
  ]);
});

test('a full last page is read in full again for a page after it', async () => {
  const entries = pushes(101);
  const fetch = answering('full_last_page', [
    page(FIRST, '"p1"', undefined, entries.slice(0, 100)),
    // GitHub's answer to the same URL, now with a next page.
    page(FIRST, '"p1"', SECOND, entries.slice(0, 100)),
    page(SECOND, '"p2"', undefined, entries.slice(100)),
  ]);
  const github = client(fetch);
  const first = await readBranch(github, 'asc', undefined, () => false);
  expect(activityEntries(first)).toHaveLength(100);

  const again = await readBranch(github, 'asc', first, () => false);

  expect(activityEntries(again)).toHaveLength(101);
  // Asked without its ETag, which would have answered 304 without the new Link.
  expect(requests(fetch)[1]).toEqual([FIRST, false]);
});

test('newest first reading stops at enough and an unchanged first page ends it', async () => {
  const firstUrl =
    'https://api.github.com/repos/o/r/activity?ref=refs%2Fheads%2Fbranch&direction=desc&per_page=100';
  const newestFirst = pushes(250).toReversed();
  const next = (n: number) => `${firstUrl}&after=C${n}`;
  const fetch = answering('desc_activity', [
    page(firstUrl, '"d1"', next(2), newestFirst.slice(0, 100)),
    page(next(2), '"d2"', next(3), newestFirst.slice(100, 200)),
    notModified(firstUrl, '"d1"'),
  ]);
  const github = client(fetch);
  // Enough once a push at or before minute 120 is read: the second page has it.
  const since = Date.parse('2026-11-06T12:00:00Z');
  const enough = (read: ActivityEntry) => Date.parse(read.timestamp) <= since;

  const first = await readBranch(github, 'desc', undefined, enough);

  expect(first.pages).toHaveLength(2);
  expect(first.truncated).toBe(false);
  const entries = activityEntries(first);
  // Oldest first, whichever way it was read.
  expect(entries[0]?.after).toBe(sha(51));
  expect(entries.at(-1)?.after).toBe(sha(250));
  const again = await readBranch(github, 'desc', first, enough);
  expect(again).toEqual(first);
  expect(requests(fetch)).toHaveLength(3);
});

test('reading stops at the most pages', async () => {
  const entries = pushes(250);
  const url = (n: number) => `${FIRST}&after=C${n}`;
  const fetch = answering('capped_activity', [
    page(FIRST, '"p1"', url(2), entries.slice(0, 100)),
    page(url(2), '"p2"', url(3), entries.slice(100, 200)),
  ]);

  const activity = await branchActivity(client(fetch), new RepoRef('o', 'r'), 'branch', {
    direction: 'asc',
    maxPages: 2,
  });

  expect(activity.truncated).toBe(true);
  expect(activityEntries(activity)).toHaveLength(200);
});

test('a repository that is gone has no pushes to show', async () => {
  const fetch = answering('gone', [
    {
      request: { method: 'GET', url: FIRST },
      response: {
        status: 404,
        headers: {},
        body: {
          message: 'Not Found',
          documentation_url: 'https://docs.github.com/rest/repos/repos#list-repository-activities',
          status: '404',
        },
      },
    },
  ]);

  const activity = await readBranch(client(fetch), 'asc', undefined, () => false);

  expect(activity.unavailable).toBe('Not Found');
  expect(activityEntries(activity)).toEqual([]);
});

/**
 * e2e#14's answer, read one a page, with the force-push event and the review on separate pages:
 * the timeline's second page brings a made-up force-push.
 */
function pagedRevisions(): Interaction[] {
  const [first] = recorded('push_history_e2e_14');
  if (!first) throw new Error('no answers');
  object(first.request.variables)['first'] = 1;
  const firstPull = pullOf(first);
  object(firstPull['timelineItems'])['filteredCount'] = 2;
  object(firstPull['timelineItems'])['pageInfo'] = { hasNextPage: true, endCursor: 'T1' };
  object(firstPull['reviews'])['pageInfo'] = { hasNextPage: false, endCursor: 'R1' };

  const second = structuredClone(first);
  const variables = object(second.request.variables);
  variables['timelineAfter'] = 'T1';
  variables['reviewsAfter'] = 'R1';
  const secondPull = pullOf(second);
  const timeline = object(secondPull['timelineItems']);
  timeline['pageInfo'] = { hasNextPage: false, endCursor: 'T2' };
  timeline['nodes'] = [
    {
      __typename: 'HeadRefForcePushedEvent',
      createdAt: '2026-11-06T19:30:00Z',
      beforeCommit: { oid: sha(1) },
      afterCommit: { oid: sha(2) },
    },
  ];
  // The reviews were all read on the first page: what comes back for them now is ignored.
  const reviews = object(secondPull['reviews']);
  reviews['nodes'] = [
    {
      submittedAt: '2026-11-06T19:31:00Z',
      commit: { oid: sha(2) },
      author: { __typename: 'User', login: 'someone' },
    },
  ];
  reviews['pageInfo'] = { hasNextPage: false, endCursor: null };
  return [first, second];
}

test('reads every page of force pushes and reviews', async () => {
  const fetch = answering('paged_revisions', pagedRevisions());

  const pull = await pullRequestRevisionsPaged(client(fetch), 'rozed-dev', 'e2e', 14, BOT, 1);

  expect(pull.timelineItems.nodes).toHaveLength(2);
  expect(pull.reviews?.nodes).toHaveLength(1);
  expect(fetch.seen).toHaveLength(2);
});

/** The value at the JSON pointer `pointer` in `value`. */
function atPointer(value: unknown, pointer: string): unknown {
  return pointer
    .split('/')
    .slice(1)
    .reduce<unknown>(
      (inside, key) =>
        typeof inside === 'object' && inside !== null
          ? unchecked<Record<string, unknown>>(inside)[key]
          : undefined,
      value,
    );
}

test('the fields a push history watches are in the check', async () => {
  const check = await pullRequestCheck(
    client(replayFetch('graphql_pull_request_check_1')),
    'rozed-dev',
    'playground',
    1,
  );

  const missing = PUSH_HISTORY_WATCHED.filter(
    (pointer) => (atPointer(check, pointer) ?? null) === null,
  );
  expect(missing).toEqual([]);
});

/** e2e#14's recorded answers, with `main`'s pushes answered by `first`, then by `again` if any. */
function withMainAnswers(first: Interaction, again?: Interaction): Interaction[] {
  return recorded('push_history_e2e_14').flatMap((interaction) => {
    if (!interaction.request.url.includes('heads%2Fmain')) return [interaction];
    if (interaction.request.if_none_match === undefined) return [first];
    return again ? [again] : [];
  });
}

/** The recorded first read of `main`'s pushes, answered `status` with `body` instead. */
function mainAnswered(status: number, headers: Record<string, string>, body: Json): Interaction {
  const main = recorded('push_history_e2e_14').find((interaction) =>
    interaction.request.url.includes('heads%2Fmain'),
  );
  if (!main) throw new Error("no read of main's pushes");
  return { request: main.request, response: { status, headers, body } };
}

test('a base branch behind single sign on is unavailable with its link', async () => {
  const sso = mainAnswered(
    403,
    {
      'x-github-sso':
        'required; url=https://github.com/orgs/acme/sso?authorization_request=REDACTED',
    },
    { message: 'Resource protected by organization SAML enforcement.' },
  );
  const fetch = answering('sso', withMainAnswers(sso));

  const history = await readPushHistory(client(fetch), e2e(14), BOT);

  const main = history.baseActivity[0];
  expect(main?.unavailable).toBe('Resource protected by organization SAML enforcement.');
  expect(main?.helpUrl).toBe('https://github.com/orgs/acme/sso?authorization_request=REDACTED');
  expect(main?.failed).toBeUndefined();
});

// Edits of e2e#14's answers.

/** e2e#14's first read, each answer as `edit` leaves it, with `extra` answers added. */
async function e2e14With(
  edit: (interaction: Interaction) => void,
  extra: Interaction[],
): Promise<{ history: PushHistory; fetch: ReplayFetch }> {
  const interactions = recorded('push_history_e2e_14')
    .filter((interaction) => interaction.request.if_none_match === undefined)
    .slice(0, 3);
  interactions.forEach(edit);
  const fetch = answering('e2e_14_edited', [...interactions, ...extra]);
  return { history: await readPushHistory(client(fetch), e2e(14), BOT), fetch };
}

/** Runs `edit` on the pull request of a GraphQL answer. */
function onPull(edit: (pull: JsonObject) => void): (interaction: Interaction) => void {
  return (interaction) => {
    if (interaction.request.operation !== undefined) edit(pullOf(interaction));
  };
}

/** Runs `edit` on the newest push the head branch's activity lists, a normal push. */
function onNewestHeadPush(edit: (push: JsonObject) => void): (interaction: Interaction) => void {
  return (interaction) => {
    if (!interaction.request.url.includes('heads%2Fe1%2F')) return;
    const push = object(list(interaction.response.body)[0]);
    expect(push['activity_type']).toBe('push');
    edit(push);
  };
}

test('a push without its head before fails the branch rather than reading as its creation', async () => {
  const { history } = await e2e14With(
    onNewestHeadPush((push) => {
      delete push['before'];
    }),
    [],
  );

  expect(history.headActivity.failed).toContain('without its head before');
  expect(history.headActivity.pages).toEqual([]);
  expect(pushHistoryIsComplete(history)).toBe(false);
});

test('a push without a time github writes fails the branch', async () => {
  for (const timestamp of ['yesterday', '2026-13-40T00:00:00Z', null]) {
    const { history } = await e2e14With(
      onNewestHeadPush((push) => {
        push['timestamp'] = timestamp;
      }),
      [],
    );

    expect(history.headActivity.failed).toContain('without a time');
    expect(history.headActivity.pages).toEqual([]);
  }
});

/** e2e#14 with its fork gone and r5's head lost from its force-push event. */
function lost(pull: JsonObject): void {
  pull['headRepository'] = null;
  object(list(object(pull['timelineItems'])['nodes'])[0])['afterCommit'] = null;
}

const R5 = '7513db38608b5bdda9fb488daf00b31c846c1dc1';

const TIMELINE = 'https://api.github.com/repos/rozed-dev/e2e/issues/14/timeline?per_page=100';

/** A page of e2e#14's issue timeline at `url`, holding `events`. */
function timelinePage(
  url: string,
  etag: string,
  next: string | undefined,
  events: Json,
): Interaction {
  const answer = page(url, etag, next, []);
  answer.response.body = events;
  return answer;
}

function forcePushed(commit: string, at: string): Json {
  return { event: 'head_ref_force_pushed', commit_id: commit, created_at: at };
}

test('a lost head is never given the head of a force push github kept', async () => {
  // Both force-pushes happened in the same second, and the timeline lists the kept one first.
  const timeline = timelinePage(TIMELINE, '"t1"', undefined, [
    forcePushed(sha(8), '2026-11-06T19:28:48Z'),
    forcePushed(R5, '2026-11-06T19:28:48Z'),
  ]);
  const { history } = await e2e14With(
    onPull((pull) => {
      lost(pull);
      // A second force-push in the same second as r5's, whose head GitHub kept.
      list(object(pull['timelineItems'])['nodes']).push({
        __typename: 'HeadRefForcePushedEvent',
        createdAt: '2026-11-06T19:28:48Z',
        beforeCommit: { oid: R5 },
        afterCommit: { oid: sha(8) },
      });
    }),
    [timeline],
  );

  expect(unavailableHeads(history)).toEqual([R5]);
  expect(history.headForcePushes.map((push) => push.after)).toEqual([R5, sha(8)]);
});

test('a timeline page that fails keeps the pages before it and is read again', async () => {
  const second = `${TIMELINE}&page=2`;
  const first = timelinePage(TIMELINE, '"t1"', second, [forcePushed(R5, '2026-11-06T19:28:48Z')]);
  const badGateway = timelinePage(second, '', undefined, { message: 'Bad Gateway' });
  badGateway.response.status = 502;
  const notAList = timelinePage(second, '', undefined, { message: 'not a list' });
  for (const failure of [badGateway, notAList]) {
    const { history } = await e2e14With(onPull(lost), [first, failure]);

    expect(unavailableHeads(history)).toEqual([R5]);
    expect(history.lostHeadTimeline?.failed).toBeDefined();
    expect(pushHistoryIsComplete(history)).toBe(false);
  }
});

test('reading the timeline again asks with its etag', async () => {
  const interactions = recorded('push_history_e2e_14').filter(
    (interaction) => !interaction.request.url.includes('revisions-3'),
  );
  interactions.forEach(onPull(lost));
  interactions.push(
    timelinePage(TIMELINE, '"t1"', undefined, [forcePushed(R5, '2026-11-06T19:28:48Z')]),
    notModified(TIMELINE, '"t1"'),
  );
  const fetch = answering('timeline_etag', interactions);
  const github = client(fetch);

  const first = await readPushHistory(github, e2e(14), BOT);
  const again = await readPushHistory(github, e2e(14), BOT, first);

  expect(again).toEqual(first);
  const timeline = fetch.seen
    .filter((seen) => seen.url.includes('/timeline'))
    .map((seen) => seen.headers.has('if-none-match'));
  expect(timeline).toEqual([false, true]);
});
