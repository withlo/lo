/**
 * Pull requests' timelines, read from recorded answers and mapped into Lo's timeline items:
 *
 * - `sharkdp/fd#2212`, read as rozed-bot three items a page: in full, then its newest page again.
 * - `cli/cli#13057`, merged, read as rozed-bot: two pages, the second holding again items pushed
 *   at the same time as the first page's oldest, then its newest page again.
 * - `rozed-dev/playground#4`, the review API checks' pull request; `rozed-dev/e2e` #14
 *   (force-pushed by GitHub's rebase) and #19 (retargeted).
 */

import { replayFetch, type ReplayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient } from '../src/client.ts';
import { unchecked } from '../src/json.ts';
import { PullRef } from '../src/refs.ts';
import {
  READ_IN_FULL_EVERY,
  readTimeline,
  type Actor,
  type AutoMergeChange,
  type PullRequestTimeline,
  type TimelineCommit,
  type TimelineEvent,
  type TimelineItem,
  type TimelineReview,
} from '../src/timeline.ts';
import { Token } from '../src/token.ts';

function client(fetch: ReplayFetch): GithubClient {
  return new GithubClient({ fetch, token: new Token('gho_FAKE') });
}

interface TimelineRequest {
  operationName: string;
  variables: { before: string | null };
}

/** The `before` each request of a replaying `fetch` asked for: `undefined` for a newest page. */
function asked(fetch: ReplayFetch): (string | undefined)[] {
  return fetch.seen.map((seen) => {
    const body = unchecked<TimelineRequest>(JSON.parse(new TextDecoder().decode(seen.body)));
    expect(body.operationName).toBe('Timeline');
    return body.variables.before ?? undefined;
  });
}

/** Any time: the recordings' reads don't depend on it, only on how far apart they are. */
function noon(): Date {
  return new Date(1_794_000_000 * 1000);
}

function items(timeline: PullRequestTimeline): TimelineItem[] {
  return timeline.items.map((entry) => entry.item);
}

function other(typename: string): TimelineItem {
  return { kind: 'other', typename };
}

/** A person's account. */
function user(login: string): Actor {
  return { login, type: 'User' };
}

function event(login: string, at: string): TimelineEvent {
  return { actor: user(login), at };
}

function commits(all: TimelineItem[]): TimelineCommit[] {
  return all.flatMap((item) => (item.kind === 'commit' ? [item.commit] : []));
}

function reviews(all: TimelineItem[]): TimelineReview[] {
  return all.flatMap((item) => (item.kind === 'review' ? [item.review] : []));
}

/** A commit of sharkdp/fd#2212's, by its author, whose checks passed. */
function fdCommit(oid: string, headline: string, at: string): TimelineItem {
  return {
    kind: 'commit',
    commit: {
      oid,
      headline,
      authorLogin: 'voidsipp',
      authorName: 'voidsip',
      committedAt: at,
      checks: 'SUCCESS',
    },
  };
}

test('fd 2212s timeline is read in full then by its newest page', async () => {
  const fetch = replayFetch('timeline_fd_2212_paged');
  const github = client(fetch);
  const pull = new PullRef('sharkdp', 'fd', 2212);
  const first = await readTimeline(github, pull, { now: noon(), pageSize: 3 });
  // Newest first, three a page. Each page is asked for before the second item of the page
  // after it, which has a later time than the first, so it holds that first item again.
  const pages = asked(fetch);
  expect(pages).toHaveLength(4);
  expect(pages[0]).toBeUndefined();
  expect(pages.slice(1).every((before) => before !== undefined)).toBe(true);
  expect([first.leftOut, first.count]).toEqual([0, 8]);
  // The cross-reference from rozed-dev/playground#13, the latest item the timeline shows.
  expect(first.shownUpdatedAt).toBe('2026-11-06T14:25:39Z');
  expect(first.readInFullAt).toBe(noon().toISOString());
  expect(first.description.author).toEqual(user('voidsipp'));
  expect(first.description.body).not.toBe('');

  const firstPush = '15635d66ba7ff3d2da0e50392fbcd37c90d83de5';
  const secondPush = '22c70acc6992c0c51cb68527b87adf114d01acbc';
  expect(items(first)).toEqual([
    fdCommit(firstPush, 'Honor explicit use-jemalloc requests', '2026-11-03T07:06:46Z'),
    {
      kind: 'review',
      review: {
        id: 'PRR_kwDOBWllys8AAAABVqux2w',
        author: user('tmccombs'),
        // The body as it is: what it says isn't the point.
        body: expect.any(String),
        state: 'CHANGES_REQUESTED',
        createdAt: '2026-11-03T08:26:10Z',
        submittedAt: '2026-11-03T09:01:32Z',
        lastEditedAt: undefined,
        url: 'https://github.com/sharkdp/fd/pull/2212#pullrequestreview-5749060059',
        hidden: false,
        commit: firstPush,
        comments: 7,
      },
    },
    fdCommit(secondPush, 'Address release feature selection review', '2026-11-03T10:05:53Z'),
    {
      kind: 'comment',
      comment: {
        id: 'IC_kwDOBWllys8AAAABiW8w-w',
        author: user('voidsipp'),
        body: expect.any(String),
        createdAt: '2026-11-03T10:05:55Z',
        lastEditedAt: undefined,
        url: 'https://github.com/sharkdp/fd/pull/2212#issuecomment-6600732923',
        hidden: undefined,
        viewerCanUpdate: false,
        viewerCanDelete: false,
      },
    },
    other('ReferencedEvent'),
    {
      kind: 'crossReference',
      event: event('scornz', '2026-11-06T14:25:39Z'),
      source: {
        kind: 'pullRequest',
        repository: 'rozed-dev/playground',
        number: 13,
        title: 'Link to sharkdp/fd#2212',
        url: 'https://github.com/rozed-dev/playground/pull/13',
      },
      willClose: false,
    },
    other('ReferencedEvent'),
    other('ReferencedEvent'),
  ] satisfies TimelineItem[]);

  // Read again within the hour, it asks for its newest page alone, which joins what it has.
  const later = new Date(noon().getTime() + 60_000);
  const again = await readTimeline(github, pull, { known: first, now: later, pageSize: 3 });
  expect(asked(fetch)).toHaveLength(5);
  expect(asked(fetch)[4]).toBeUndefined();
  expect(again).toEqual(first);

  // An hour after it was last read in full, it's read in full again.
  const hourLater = new Date(noon().getTime() + READ_IN_FULL_EVERY);
  const full = await readTimeline(github, pull, { known: again, now: hourLater, pageSize: 3 });
  expect(asked(fetch)).toHaveLength(9);
  expect(full.items).toEqual(first.items);
  expect(full.readInFullAt).toBe(hourLater.toISOString());
});

function bagtoad(at: string): TimelineEvent {
  return event('BagToad', at);
}

test('cli 13057s timeline reads each item once where items share a time', async () => {
  const fetch = replayFetch('timeline_cli_13057');
  const github = client(fetch);
  const pull = new PullRef('cli', 'cli', 13057);
  const first = await readTimeline(github, pull, { now: noon() });
  const pages = asked(fetch);
  expect(pages).toHaveLength(2);

  // Every item once, as many as GitHub counts.
  expect(first.items).toHaveLength(113);
  expect(first.leftOut).toBe(0);
  expect(new Set(first.items.map((entry) => entry.cursor)).size).toBe(113);

  // The 14 commits of a rebase share a time. The newest page held 6 of them, so the page before
  // it was read before the first item after them, which holds all 14 again. Reading before the
  // newest page's first commit would have skipped the 8 GitHub lists before it but compares
  // after it.
  const rebased = first.items.findIndex(
    ({ item }) => item.kind === 'commit' && item.commit.oid.startsWith('c0025738'),
  );
  expect(rebased).toBeGreaterThanOrEqual(0);
  const afterRebase = first.items.slice(rebased).findIndex(({ item }) => item.kind !== 'commit');
  expect(afterRebase).toBe(14);
  expect(pages[1]).toBe(first.items[rebased + afterRebase]?.cursor);
  const newestFirst = first.items[first.items.length - 100];
  expect(newestFirst?.item).toMatchObject({
    kind: 'commit',
    commit: { oid: expect.stringMatching(/^3f1df513/) },
  });

  // What the items say.
  const { description } = first;
  expect(description.author).toEqual(user('BagToad'));
  expect(description.createdAt).toBe('2026-03-30T00:42:33Z');
  expect(description.lastEditedAt).toBe('2026-05-06T21:08:32Z');
  const all = items(first);
  const expected: TimelineItem[] = [
    {
      kind: 'forcePushed',
      event: bagtoad('2026-04-30T14:49:45Z'),
      branch: 'head',
      before: 'cea0e576f674d817a024e3bbe3b7233f44ac57af',
      after: '6e76f11dec6067b7cb26b70875caf796145c3640',
    },
    { kind: 'draft', event: bagtoad('2026-04-30T14:49:47Z'), draft: false },
    // A reviewer GitHub doesn't show, and a person.
    {
      kind: 'reviewRequest',
      event: bagtoad('2026-04-30T14:49:48Z'),
      reviewer: undefined,
      added: true,
    },
    {
      kind: 'reviewRequest',
      event: bagtoad('2026-04-30T14:49:49Z'),
      reviewer: { kind: 'account', login: 'williammartin', type: 'User' },
      added: true,
    },
    {
      kind: 'merged',
      event: bagtoad('2026-06-04T00:27:11Z'),
      commit: '20147bf81fed534faf1b5c9be12638983b8e5e82',
      into: 'trunk',
    },
    { kind: 'closed', event: bagtoad('2026-06-04T00:27:12Z') },
    other('HeadRefDeletedEvent'),
  ];
  for (const item of expected) expect(all).toContainEqual(item);
  const autoMerge = all.flatMap((item) => (item.kind === 'autoMerge' ? [item.change] : []));
  const disabled: AutoMergeChange = { kind: 'disabled', reason: 'Manually disabled by user' };
  expect(autoMerge).toEqual([
    { kind: 'enabledMerge' },
    disabled,
    { kind: 'enabledSquash' },
    disabled,
    { kind: 'enabledSquash' },
  ] satisfies AutoMergeChange[]);
  // A bot's login, as GraphQL gives it, is told apart by its type.
  const authors = reviews(all).map((review) => [
    review.author?.login,
    review.author?.type,
    review.state,
    review.comments,
  ]);
  expect(authors).toEqual([
    ['copilot-pull-request-reviewer', 'Bot', 'COMMENTED', 6],
    ['BagToad', 'User', 'COMMENTED', 1],
    ['camchenry', 'User', 'COMMENTED', 1],
    ['babakks', 'User', 'CHANGES_REQUESTED', 20],
    ['babakks', 'User', 'CHANGES_REQUESTED', 3],
    ['babakks', 'User', 'APPROVED', 0],
  ]);
  expect(all.filter((item) => item.kind === 'crossReference')).toHaveLength(37);

  // Its newest page again joins what it has.
  const again = await readTimeline(github, pull, { known: first, now: noon() });
  expect(asked(fetch)).toEqual([pages[0], pages[1], undefined]);
  expect(again).toEqual(first);
});

test('the playgrounds review checks timeline has its reviews and close', async () => {
  const github = client(replayFetch('timeline_playground_4'));
  const pull = new PullRef('rozed-dev', 'playground', 4);
  const all = items(await readTimeline(github, pull, { now: noon() }));
  expect(all).toHaveLength(12);
  expect(commits(all).map((commit) => commit.oid.slice(0, 7))).toEqual([
    'fc0f4b4',
    '2104a3c',
    'b405bfc',
  ]);
  const held = reviews(all);
  expect(held).toHaveLength(8);
  for (const review of held) {
    expect(review.author).toEqual(user('rozed-bot'));
    expect(review.state).toBe('COMMENTED');
    expect(review.submittedAt).toBeDefined();
  }
  expect(all[11]).toMatchObject({ kind: 'closed', event: { actor: user('rozed-bot') } });
});

test('e2es timelines have their force push and base change', async () => {
  const github = client(replayFetch('timeline_e2e'));
  const e1 = items(
    await readTimeline(github, new PullRef('rozed-dev', 'e2e', 14), { now: noon() }),
  );
  const pushed = e1.find((item) => item.kind === 'forcePushed');
  expect(pushed).toMatchObject({
    kind: 'forcePushed',
    event: { actor: user('rozed-bot') },
    branch: 'head',
    after: expect.any(String),
  });
  expect(e1.at(-1)).toEqual(other('ReferencedEvent'));

  const e8 = items(
    await readTimeline(github, new PullRef('rozed-dev', 'e2e', 19), { now: noon() }),
  );
  const changed = e8.find((item) => item.kind === 'baseChanged');
  expect(
    changed?.kind === 'baseChanged'
      ? [changed.event.actor?.login, changed.from, changed.to, changed.how]
      : undefined,
  ).toEqual(['rozed-bot', 'main', 'e8/base', 'changed']);
});

/** A newest page of a timeline holding only `nodes`, as GitHub answers it. */
function page(nodes: unknown[]): Response {
  return Response.json({
    data: {
      rateLimit: null,
      repository: {
        pullRequest: {
          author: { __typename: 'User', login: 'rozed-bot' },
          body: '',
          createdAt: '2026-11-06T12:00:00Z',
          lastEditedAt: null,
          timelineEvents: { updatedAt: '2026-11-06T12:00:00Z' },
          timelineItems: {
            filteredCount: nodes.length,
            pageInfo: { hasPreviousPage: false, startCursor: null },
            edges: nodes.map((node, at) => ({ cursor: `c${at}`, node })),
          },
        },
      },
    },
  });
}

/** A label added, as GitHub answers it, in `color`. */
function labeled(color: string): unknown {
  return {
    __typename: 'LabeledEvent',
    actor: { __typename: 'User', login: 'rozed-bot' },
    createdAt: '2026-11-06T12:00:00Z',
    label: { name: 'api', color },
  };
}

test('a labels color reaches the timeline only as six hex digits', async () => {
  const github = new GithubClient({
    fetch: () => Promise.resolve(page([labeled('2700AF'), labeled('fff;background:url(x)')])),
    token: new Token('gho_FAKE'),
  });
  const all = items(
    await readTimeline(github, new PullRef('rozed-dev', 'e2e', 23), { now: noon() }),
  );
  expect(all.map((item) => (item.kind === 'label' ? item.color : item.kind))).toEqual([
    '2700af',
    undefined,
  ]);
});
