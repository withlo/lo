/**
 * Pull requests' push histories, read from recorded answers and mapped into revisions and their
 * bases:
 *
 * - `rozed-dev/e2e` #14 and #16, a pull request's revisions end to end: #14 is closed after the
 *   full run, r1-r6 with GitHub's own rebase between r4 and r5; #16 is open at r3. rozed-bot
 *   reviewed r2 of each.
 * - `sharkdp/fd` #2212, open, from the fork `voidsipp/fd`; and #2202, merged with a merge commit
 *   from a fork since deleted. Read as rozed-bot, read only.
 */

import {
  activityEntries,
  GithubClient,
  lastReview,
  PullRef,
  pushHistoryIsComplete,
  readPushHistory,
  Token,
  unavailableHeads,
  type PushHistory,
} from '@lo/github';
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

import { baseTipAt, type BaseTipSource } from '../src/revisions/base.ts';
import { buildRevisions } from '../src/revisions/build.ts';
import { defaultComparison } from '../src/revisions/compare.ts';
import { baseHistory, completeLog, pushRecords, type SeenHead } from '../src/revisions/history.ts';
import type { Revision, Revisions } from '../src/revisions.ts';

const BOT = 'rozed-bot';

function client(fetch: ReplayFetch): GithubClient {
  return new GithubClient({ fetch, token: new Token('gho_FAKE') });
}

function e2e(number: number): PullRef {
  return new PullRef('rozed-dev', 'e2e', number);
}

/** The cassette's first read, with the replaying `fetch`. */
async function read(
  name: string,
  pull: PullRef,
): Promise<{ history: PushHistory; fetch: ReplayFetch }> {
  const fetch = replayFetch(name);
  return { history: await readPushHistory(client(fetch), pull, BOT), fetch };
}

function time(text: string): number {
  return Date.parse(text);
}

/** The full SHA starting with `short` among `shas`. */
function full(shas: readonly string[], prefix: string): string {
  const found = shas.filter((commit) => commit.startsWith(prefix));
  expect(found).toHaveLength(1);
  return found[0] ?? '';
}

function short(revisions: Revisions): string[] {
  return [...revisions].map((revision) => revision.head.slice(0, 7));
}

function revisionsOf(history: PushHistory, seen: SeenHead[] = []): Revisions {
  return buildRevisions(pushRecords(history, seen), [], history.head, time(history.openedAt));
}

/** For `baseTipAt` without a local copy to ask: no base tip holds a revision's head. */
function noTipHolds(): boolean {
  return false;
}

/** Each revision's base tip, by its first seven characters, and how it's known. */
function basesOf(history: PushHistory, tip: string | undefined): [string, BaseTipSource][] {
  const base = baseHistory(history, tip);
  return [...revisionsOf(history)].map((revision) => {
    const found = baseTipAt(base, revision.pushedAt, revision.head, noTipHolds);
    return [found?.commit.slice(0, 7) ?? '', found?.source ?? 'uncertain'];
  });
}

/** The revision at `position`, failing the test when there's none. */
function nth(revisions: Revisions, position: number): Revision {
  const revision = revisions.list()[position];
  if (!revision) throw new Error(`no revision ${position + 1}`);
  return revision;
}

test('e1s full run has six revisions with githubs rebase as a force push', async () => {
  const { history } = await read('push_history_e2e_14', e2e(14));

  const revisions = revisionsOf(history);

  expect(short(revisions)).toEqual([
    '857b788',
    '2e2d4be',
    '864ede1',
    '28b21f2',
    '7513db3',
    'adb7208',
  ]);
  expect([...revisions].map((revision) => revision.forced)).toEqual([
    undefined,
    false,
    false,
    false,
    true,
    false,
  ]);
  const [r1, r2, r3, r4, r5, r6] = [0, 1, 2, 3, 4, 5].map((position) => nth(revisions, position));
  // r1 created the branch a second before the pull request opened.
  expect(r1?.pushedAt).toEqual({ kind: 'exact', at: time('2026-11-06T19:27:50Z') });
  expect(time(history.openedAt)).toBe(time('2026-11-06T19:27:51Z'));
  expect(r2?.sources).toEqual(['activity', 'review']);
  expect(r3?.sources).toEqual(['activity']);
  // The rebase shows in both the activity API and the timeline, which names r4 as the head it
  // replaced.
  expect(r4?.sources).toEqual(['activity', 'forcePush']);
  expect(r5?.sources).toEqual(['activity', 'forcePush']);
  expect(r5?.previous).toBe(r4?.head);
  expect(r5?.pushedAt).toEqual({ kind: 'exact', at: time('2026-11-06T19:28:47Z') });
  expect(r6?.sources).toEqual(['activity', 'head']);
  expect(time(history.headForcePushes[0]?.at ?? '')).toBe(time('2026-11-06T19:28:48Z'));
  expect(history.closedAt).toBeDefined();
  // rozed-bot's last review was on r2, so the pull request opens at r2 → r6.
  expect(lastReview(history)).toBe(r2?.head);
  expect(defaultComparison(revisions, lastReview(history), undefined)).toEqual({
    kind: 'between',
    from: r2?.head,
    to: r6?.head,
  });
});

test('e1s bases follow main as it moved', async () => {
  const { history } = await read('push_history_e2e_14', e2e(14));
  const main = history.baseActivity[0];
  expect([main?.branch, main?.direction]).toEqual(['main', 'desc']);
  const tips = main ? activityEntries(main).map((pushed) => pushed.after) : [];
  const mainNow = full(tips, 'a45754b');

  // r1-r4 were pushed onto 99a9e80; #15 then moved main to a45754b, and GitHub rebased r4 onto
  // it as r5.
  expect(basesOf(history, mainNow)).toEqual([
    ['99a9e80', 'activity'],
    ['99a9e80', 'activity'],
    ['99a9e80', 'activity'],
    ['99a9e80', 'activity'],
    ['a45754b', 'activity'],
    ['a45754b', 'activity'],
  ]);
});

test('e1 open at r3 opens from your review on r2', async () => {
  const { history } = await read('push_history_e2e_16', e2e(16));

  const revisions = revisionsOf(history);

  expect(short(revisions)).toEqual(['60005cf', 'b88cc8b', '34427a8']);
  expect(history.closedAt).toBeUndefined();
  expect(history.headForcePushes).toEqual([]);
  const r2 = nth(revisions, 1);
  expect(lastReview(history)).toBe(r2.head);
  expect(defaultComparison(revisions, lastReview(history), undefined)).toEqual({
    kind: 'between',
    from: r2.head,
    to: history.head,
  });
  // Seen here at r3 too: nothing's new.
  expect(defaultComparison(revisions, lastReview(history), history.head)).toEqual({
    kind: 'full',
    nothingNewSince: history.head,
  });
});

test('a pull request from a fork reads the forks branch', async () => {
  const { history, fetch } = await read('push_history_fd_2212', new PullRef('sharkdp', 'fd', 2212));

  expect(history.headRepo).toEqual({ owner: 'voidsipp', name: 'fd' });
  expect(fetch.seen[1]?.url).toMatch(
    /^https:\/\/api\.github\.com\/repos\/voidsipp\/fd\/activity\?ref=refs%2Fheads%2Ffix%2F1822/,
  );
  const revisions = revisionsOf(history);
  expect(short(revisions)).toEqual(['15635d6', '22c70ac']);
  // The maintainer reviewed r1. The base repository's check suites for a fork's pull request
  // weren't started by a push, so they name no heads.
  expect(nth(revisions, 0).sources).toEqual(['activity', 'review']);
  expect(history.checkSuites.every((suite) => suite.next === undefined)).toBe(true);
  // rozed-bot never reviewed it.
  expect(lastReview(history)).toBeUndefined();
  expect(defaultComparison(revisions, undefined, undefined)).toEqual({
    kind: 'full',
    nothingNewSince: undefined,
  });

  // master's activity, newest first, stopped at the push before the pull request's first
  // revision.
  const master = history.baseActivity[0];
  if (!master) throw new Error("master's pushes weren't read");
  expect(master.pages).toHaveLength(1);
  expect(master.pages[0]?.next !== undefined && !master.truncated).toBe(true);
  const base = baseHistory(history, activityEntries(master).at(-1)?.after);
  const r1 = nth(revisions, 0);
  const tip = baseTipAt(base, r1.pushedAt, r1.head, noTipHolds);
  expect([tip?.commit.slice(0, 7), tip?.source]).toEqual(['cc4e40f', 'activity']);
});

test('a merged pull request whose fork is gone has no pushes but its reviews and check suites', async () => {
  const { history, fetch } = await read('push_history_fd_2202', new PullRef('sharkdp', 'fd', 2202));

  expect(history.headRepo).toBeUndefined();
  expect(history.headActivity.unavailable).toBeDefined();
  expect(fetch.seen.some((seen) => seen.url.includes('windows-arm64'))).toBe(false);
  const revisions = revisionsOf(history);
  expect(short(revisions)).toEqual(['4feccf0', '31f36c8']);
  // Without the fork's pushes, the base repository's check suites, which no push started, still
  // say each was the head by the time they were made: a day before the first review.
  expect(completeLog(history)).toBe(false);
  const r1 = nth(revisions, 0);
  expect(r1.pushedAt).toEqual({ kind: 'by', at: time('2026-10-28T03:56:10Z') });
  expect(r1.sources).toEqual(['review', 'checkSuite']);

  // Merged with a merge commit: every revision's base is its first parent.
  const merge = history.mergeCommit;
  expect(history.merged).toBe(true);
  expect(merge?.parents).toHaveLength(2);
  const base = baseHistory(history, undefined);
  for (const revision of revisions) {
    expect(baseTipAt(base, revision.pushedAt, revision.head, noTipHolds)).toEqual({
      commit: merge?.parents[0],
      source: 'mergeParent',
    });
  }
});

test('heads the poller saw are revisions too', async () => {
  const { history } = await read('push_history_fd_2202', new PullRef('sharkdp', 'fd', 2202));
  // A push between the two reviewed heads that only Lo saw.
  const seen = [
    { head: '5eed000000000000000000000000000000000000', firstSeen: time('2026-10-29T06:20:00Z') },
  ];

  const revisions = revisionsOf(history, seen);

  expect(short(revisions)).toEqual(['4feccf0', '5eed000', '31f36c8']);
  expect(nth(revisions, 1).sources).toEqual(['poller']);
});

// Answers made up from the recorded ones.

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

/** Runs `edit` on the pull request of a GraphQL answer. */
function onPull(edit: (pull: JsonObject) => void): (interaction: Interaction) => void {
  return (interaction) => {
    if (interaction.request.operation !== undefined) edit(pullOf(interaction));
  };
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
    timestamp: iso(pushedAt(minute)),
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
  return { request: { method: 'GET', url }, response: { status: 200, headers, body: entries } };
}

// A long-lived head branch, on answers made up from e2e#14's.

/** The activity API's first page of e2e#14's head branch, newest first. */
const HEAD_PUSHES =
  'https://api.github.com/repos/rozed-dev/e2e/activity?ref=refs%2Fheads%2Fe1%2Frevisions-3&direction=desc&per_page=100';

/** The URL of page `index`, from 0, of e2e#14's head branch's pushes, newest first. */
function headPushesPage(index: number): string {
  return index === 0 ? HEAD_PUSHES : `${HEAD_PUSHES}&after=C${index}`;
}

/** When push `n` of {@link pushes} was made. */
function pushedAt(n: number): number {
  return time('2026-11-06T10:00:00Z') + n * 60_000;
}

/** The first recorded read of `main`'s pushes in e2e#14's cassette. */
function mainPushes(): Interaction {
  const main = recorded('push_history_e2e_14').find((interaction) =>
    interaction.request.url.includes('heads%2Fmain'),
  );
  if (!main) throw new Error("no read of main's pushes");
  return main;
}

/**
 * e2e#14 as an open pull request whose head branch had `before` pushes when it opened, half a
 * minute after the last of them, and `after` pushes since, each a minute apart: GraphQL's answer,
 * the head branch's pushes newest first, a page at a time, and `main`'s as recorded.
 */
function longLived(before: number, after: number): { interactions: Interaction[]; opened: number } {
  const opened = pushedAt(before) + 30_000;
  const [graphql] = recorded('push_history_e2e_14');
  if (!graphql) throw new Error('no answers');
  const pull = pullOf(graphql);
  pull['createdAt'] = iso(opened);
  pull['closed'] = false;
  pull['closedAt'] = null;
  pull['headRefOid'] = sha(before + after);
  object(pull['timelineItems'])['filteredCount'] = 0;
  object(pull['timelineItems'])['nodes'] = [];
  object(pull['reviews'])['totalCount'] = 0;
  object(pull['reviews'])['nodes'] = [];
  object(pull['viewerLastReview'])['nodes'] = [];
  object(pull['commits'])['nodes'] = [];

  const newestFirst = pushes(before + after).toReversed();
  const pages = Math.ceil(newestFirst.length / 100);
  const interactions = [graphql];
  for (let index = 0; index < pages; index++) {
    const next = index + 1 < pages ? headPushesPage(index + 1) : undefined;
    const entries = newestFirst.slice(index * 100, index * 100 + 100);
    interactions.push(page(headPushesPage(index), `"h${index}"`, next, entries));
  }
  interactions.push(mainPushes());
  return { interactions, opened };
}

function headPages(fetch: ReplayFetch): number {
  return fetch.seen.filter((seen) => seen.url.includes('revisions-3')).length;
}

test('a long lived head branch is read back to when the pull request opened', async () => {
  const { interactions, opened } = longLived(1500, 5);
  const fetch = answering('long_lived', interactions);

  const history = await readPushHistory(client(fetch), e2e(14), BOT);

  // One page holds the five pushes since it opened, and the one it opened with.
  expect(headPages(fetch)).toBe(1);
  expect(history.headActivity.truncated).toBe(false);
  const revisions = revisionsOf(history);
  expect([...revisions].map((revision) => revision.head)).toEqual(
    [1500, 1501, 1502, 1503, 1504, 1505].map(sha),
  );
  expect(nth(revisions, 0).pushedAt).toEqual({ kind: 'exact', at: pushedAt(1500) });
  expect(pushedAt(1500)).toBeLessThan(opened);
});

test('a head branch with more pushes since it opened than lo reads is truncated', async () => {
  const { interactions, opened } = longLived(3, 1100);
  const fetch = answering('truncated', interactions);

  const history = await readPushHistory(client(fetch), e2e(14), BOT);

  expect(history.headActivity.truncated).toBe(true);
  expect(headPages(fetch)).toBe(10);
  // Only the latest thousand pushes, all since it opened: nothing from before stands in for its
  // first revision.
  const revisions = revisionsOf(history);
  expect(revisions.length).toBe(1000);
  expect(nth(revisions, 0).head).toBe(sha(104));
  expect(
    [...revisions].every(
      (revision) => revision.pushedAt.kind === 'exact' && revision.pushedAt.at > opened,
    ),
  ).toBe(true);
});

/** fd#2202's answers, merged as `edit` says instead of with a merge commit. */
async function mergedOtherwise(edit: (mergeCommit: JsonObject) => void): Promise<PushHistory> {
  const interactions = recorded('push_history_fd_2202');
  interactions.forEach(onPull((pull) => edit(object(pull['mergeCommit']))));
  const fetch = answering('merged', interactions);
  return readPushHistory(client(fetch), new PullRef('sharkdp', 'fd', 2202), BOT);
}

test('merges without a merge commit take master as it was', async () => {
  // `master`'s push that merged it went from 5e10274 to the merge commit, 8b14e8d.
  const squashed = await mergedOtherwise((commit) => {
    object(commit['parents'])['nodes'] = [{ oid: '5e10274e350b5c20407dcfa6d42be6971242b377' }];
  });
  expect(basesOf(squashed, sha(9))).toEqual([
    ['5e10274', 'beforeMerge'],
    ['5e10274', 'beforeMerge'],
  ]);

  // Fast-forwarded: its merge commit is its head, and `master` now holds every revision.
  // `master`'s pushes read reach back to when they were pushed, so each base is exact.
  const fastForwarded = await mergedOtherwise((commit) => {
    commit['oid'] = '31f36c873e1065755830f947c05db158348d586d';
    object(commit['parents'])['nodes'] = [{ oid: '4feccf0ae8840cad866647eaf76127bab756ccfd' }];
  });
  expect(basesOf(fastForwarded, sha(9))).toEqual([
    ['d76b4e3', 'activity'],
    ['5e10274', 'activity'],
  ]);
  // Without them, today's tip would make every revision's diff empty: it's uncertain.
  fastForwarded.baseActivity = [];
  const uncertain = [sha(9).slice(0, 7), 'uncertain'];
  expect(basesOf(fastForwarded, sha(9))).toEqual([uncertain, uncertain]);
});

/** e2e#14's recorded answers, with `main`'s pushes answered by `first`, then by `again` if any. */
function withMainAnswers(first: Interaction, again?: Interaction): Interaction[] {
  return recorded('push_history_e2e_14').flatMap((interaction) => {
    if (!interaction.request.url.includes('heads%2Fmain')) return [interaction];
    if (interaction.request.if_none_match === undefined) return [first];
    return again ? [again] : [];
  });
}

/** The recorded first read of `main`'s pushes, answered 502. */
function badGateway(): Interaction {
  return {
    request: mainPushes().request,
    response: { status: 502, headers: {}, body: { message: 'Bad Gateway' } },
  };
}

test('a branch whose pushes fail is read again and the rest is kept', async () => {
  const main = mainPushes();
  // Read again, `main` answers.
  const fetch = answering('failed', [...withMainAnswers(badGateway()), main]);
  const github = client(fetch);

  const failed = await readPushHistory(github, e2e(14), BOT);

  // GraphQL's answer and the head branch's pushes are all there, so are the revisions.
  expect(pushHistoryIsComplete(failed)).toBe(false);
  const mainActivity = failed.baseActivity[0];
  expect(mainActivity?.failed).toBe('GitHub answered 502: Bad Gateway');
  expect(mainActivity?.pages).toEqual([]);
  expect(mainActivity?.unavailable).toBeUndefined();
  expect(revisionsOf(failed).length).toBe(6);
  expect(lastReview(failed)).toBeDefined();

  const again = await readPushHistory(github, e2e(14), BOT, failed);
  expect(pushHistoryIsComplete(again)).toBe(true);
  const reread = again.baseActivity[0];
  expect(reread ? activityEntries(reread) : []).toHaveLength(5);

  // A read that fails after one that worked keeps the pushes it read.
  const etag = reread?.pages[0]?.etag;
  const conditional = badGateway();
  conditional.request = { ...conditional.request, if_none_match: etag };
  const later = answering('failed_later', withMainAnswers(main, conditional));
  const laterClient = client(later);
  const first = await readPushHistory(laterClient, e2e(14), BOT);
  const then = await readPushHistory(laterClient, e2e(14), BOT, first);
  expect(pushHistoryIsComplete(then)).toBe(false);
  const kept = then.baseActivity[0];
  expect(kept ? activityEntries(kept) : []).toHaveLength(5);
  expect(kept?.failed).toBeDefined();
});

// Edits of e2e#14's answers.

/** e2e#14's first read, each answer as `edit` leaves it, with `extra` answers added. */
async function e2e14With(
  edit: (interaction: Interaction) => void,
  extra: Interaction[] = [],
): Promise<{ history: PushHistory; fetch: ReplayFetch }> {
  const interactions = recorded('push_history_e2e_14')
    .filter((interaction) => interaction.request.if_none_match === undefined)
    .slice(0, 3);
  interactions.forEach(edit);
  const fetch = answering('e2e_14_edited', [...interactions, ...extra]);
  return { history: await readPushHistory(client(fetch), e2e(14), BOT), fetch };
}

/** e2e#14's head branch's pushes, to edit. */
function onHeadPushes(edit: (pushes: Json[]) => void): (interaction: Interaction) => void {
  return (interaction) => {
    if (interaction.request.url.includes('revisions-3')) edit(list(interaction.response.body));
  };
}

const R4 = '28b21f232a7ed2ac8682a792045dcbb49a80183f';
const R5 = '7513db38608b5bdda9fb488daf00b31c846c1dc1';

test('e1s full run has a complete log', async () => {
  const { history } = await read('push_history_e2e_14', e2e(14));

  expect(completeLog(history)).toBe(true);
  expect(unavailableHeads(history)).toEqual([]);
});

test('a force push whose head github lost is named by the issue timeline', async () => {
  // The fork is gone and GitHub lost r5: only the issue timeline names it.
  const timeline: Interaction = {
    request: {
      method: 'GET',
      url: 'https://api.github.com/repos/rozed-dev/e2e/issues/14/timeline?per_page=100',
    },
    response: {
      status: 200,
      headers: {},
      body: [
        { event: 'commented', created_at: '2026-11-06T19:28:00Z' },
        { event: 'head_ref_force_pushed', commit_id: R5, created_at: '2026-11-06T19:28:48Z' },
      ],
    },
  };
  const { history } = await e2e14With(
    onPull((pull) => {
      pull['headRepository'] = null;
      object(list(object(pull['timelineItems'])['nodes'])[0])['afterCommit'] = null;
    }),
    [timeline],
  );

  expect(unavailableHeads(history)).toEqual([R5]);
  const revisions = revisionsOf(history);
  expect(short(revisions)).toEqual(['2e2d4be', '28b21f2', '7513db3', 'adb7208']);
  expect(revisions.get(R5)?.forced).toBe(true);
  // The caller shows it as no longer available.
  for (const head of unavailableHeads(history)) revisions.markUnavailable(head);
  expect(revisions.get(R5)?.available).toBe(false);
});

test('a review on a commit the complete log never had as its head is marked', async () => {
  // r5's first commit, which came in r5's push, was never the head.
  const { history } = await e2e14With(
    onPull((pull) => {
      const commit = object(object(list(object(pull['commits'])['nodes'])[0])['commit'])['oid'];
      object(object(list(object(pull['reviews'])['nodes'])[0])['commit'])['oid'] = commit ?? null;
    }),
  );

  expect(completeLog(history)).toBe(true);
  const revisions = revisionsOf(history);
  const reviewed = history.reviews[0]?.commit ?? '';
  expect(revisions.get(reviewed)?.sources).toEqual(['reviewedCommit']);
  expect(revisions.get(R4)?.sources).not.toContain('review');
});

test('pushes after the pull request closed belong to whatever reused the branch', async () => {
  const { history } = await e2e14With(
    onHeadPushes((entries) => {
      const latest = object(entries[0]);
      entries.unshift({
        ...latest,
        id: 1,
        before: latest['after'] ?? null,
        after: sha(7),
        timestamp: '2026-11-07T09:00:00Z',
      });
    }),
  );

  const revisions = revisionsOf(history);
  expect(revisions.get(sha(7))).toBeUndefined();
  expect(revisions.length).toBe(6);
});

test('check suites on another branch name no heads', async () => {
  const { history } = await e2e14With(
    onPull((pull) => {
      pull['headRepository'] = null;
      const commit = object(object(list(object(pull['commits'])['nodes'])[0])['commit']);
      commit['checkSuites'] = {
        nodes: [
          {
            createdAt: '2026-11-06T19:28:50Z',
            branch: { name: 'backport' },
            push: { previousSha: sha(3), nextSha: commit['oid'] ?? null },
          },
          { createdAt: '2026-11-06T19:28:51Z', branch: { name: 'backport' }, push: null },
        ],
      };
    }),
  );

  const commit = history.checkSuites[0]?.commit;
  expect(history.checkSuites).toHaveLength(2);
  const records = pushRecords(history, []);
  expect(records.some((record) => record.kind === 'checkSuite' && record.next === commit)).toBe(
    false,
  );
});

test('every branch the pull request targeted is read back to its first revision', async () => {
  const oldBase =
    'https://api.github.com/repos/rozed-dev/e2e/activity?ref=refs%2Fheads%2Fe1%2Fold-base&direction=desc&per_page=100';
  const second = `${oldBase}&after=C1`;
  // r1 was pushed at 19:27:50. The old base's first page is all later pushes, so its second page
  // is read too, which reaches back far enough; a third would never be asked for.
  const oldPages = [
    page(oldBase, '"o1"', second, [
      {
        id: 3,
        before: sha(2),
        after: sha(3),
        activity_type: 'push',
        timestamp: '2026-11-06T19:28:00Z',
        actor: null,
      },
    ]),
    page(second, '"o2"', `${oldBase}&after=C2`, [
      {
        id: 2,
        before: sha(1),
        after: sha(2),
        activity_type: 'push',
        timestamp: '2026-11-06T19:20:00Z',
        actor: null,
      },
    ]),
  ];
  const { history, fetch } = await e2e14With(
    onPull((pull) => {
      list(object(pull['timelineItems'])['nodes']).push({
        __typename: 'BaseRefChangedEvent',
        createdAt: '2026-11-06T19:28:30Z',
        previousRefName: 'e1/old-base',
        currentRefName: 'main',
      });
    }),
    oldPages,
  );

  expect(history.baseActivity.map((activity) => activity.branch)).toEqual(['main', 'e1/old-base']);
  expect(history.baseActivity[1]?.pages).toHaveLength(2);
  expect(fetch.seen.some((seen) => seen.url.includes('after=C2'))).toBe(false);
  // r1 targeted the old base, at its tip then.
  const r1 = nth(revisionsOf(history), 0);
  expect(baseTipAt(baseHistory(history, undefined), r1.pushedAt, r1.head, noTipHolds)?.commit).toBe(
    sha(2),
  );
});
