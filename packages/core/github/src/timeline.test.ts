import { expect, test } from 'vitest';

import {
  base64Decode,
  cursorBefore,
  cursorTime,
  dueInFull,
  joinNewestPage,
  READ_IN_FULL_EVERY,
  type Actor,
  type ForcePushedBranch,
  type PullRequestTimeline,
  type TimelineDescription,
  type TimelineEntry,
  type TimelineEvent,
  type TimelineItem,
  type TimelineItemsPage,
} from './timeline.ts';

/** Two of cli/cli#13057's cursors that share a time (commits a rebase pushed), and one later. */
const SAME_TIME = [
  'Y3Vyc29yOnYyOpPPAAABnd7d-1gH2gAzMzQ2MzU4MjYzMDpjMDBiYzZhOWI0OTk5ZTRmZDM1ZTE0NTdiMzdiZTIwNzg4YjllOTRj',
  'Y3Vyc29yOnYyOpPPAAABnd7d-1gH2gAzMzQ2MzU4MjYzMDozZjFkZjUxM2M1MzBjMDMwNWZiMTBjZmMzZmIyYTIxNTMwY2ZlYTk2',
] as const;
const LATER = 'Y3Vyc29yOnYyOpPPAAABnd7eAygBqzI1MDM5MDQ0OTIx';

const bytes = (text: string) => new TextEncoder().encode(text);

test('a cursor holds its items time', () => {
  const [a, b] = SAME_TIME.map(cursorTime);
  expect(a).toBeDefined();
  expect(a).toBe(b);
  expect(cursorTime(LATER)).toBeDefined();
  expect(cursorTime(LATER)).not.toBe(a);
  expect(base64Decode(LATER)?.slice(-11)).toEqual(bytes('25039044921'));
  // sharkdp/fd#2212's, padded.
  expect(cursorTime('Y3Vyc29yOnYyOpPPAAABoaDfW7gAqjY2MDA3MzI5MjM=')).toBeDefined();
  const unknown = ['', 'not base64!', 'Y3Vyc29yOnYxOg==', 'Y3Vyc29yOnYyOg=='];
  expect(unknown.map(cursorTime)).toEqual(unknown.map(() => undefined));
  expect(base64Decode('Y3Vyc29yOnYyOg==')).toEqual(bytes('cursor:v2:'));
  expect(base64Decode('_-8')).toEqual(Uint8Array.from([0xff, 0xef]));
});

function other(): TimelineItem {
  return { kind: 'other', typename: 'SubscribedEvent' };
}

/** `minute` minutes after the Unix epoch. */
function at(minute: number): string {
  return new Date(minute * 60_000).toISOString();
}

/** A person's account. */
function user(login: string): Actor {
  return { login, type: 'User' };
}

function event(): TimelineEvent {
  return { actor: user('alice'), at: at(0) };
}

function comment(body: string): TimelineItem {
  return {
    kind: 'comment',
    comment: {
      id: 'IC_1',
      author: user('alice'),
      body,
      createdAt: at(0),
      lastEditedAt: undefined,
      url: '',
      hidden: undefined,
      viewerCanUpdate: true,
      viewerCanDelete: true,
    },
  };
}

function review(id: string): TimelineItem {
  return {
    kind: 'review',
    review: {
      id,
      author: user('bob'),
      body: '',
      state: 'APPROVED',
      createdAt: at(0),
      submittedAt: at(0),
      lastEditedAt: undefined,
      url: '',
      hidden: false,
      commit: undefined,
      comments: 0,
    },
  };
}

function commit(oid: string): TimelineItem {
  return {
    kind: 'commit',
    commit: {
      oid,
      headline: '',
      authorLogin: undefined,
      authorName: undefined,
      committedAt: at(0),
      checks: undefined,
    },
  };
}

function dismissed(id: string): TimelineItem {
  return {
    kind: 'reviewDismissed',
    event: event(),
    review: id,
    reviewer: user('bob'),
    message: undefined,
    previousState: 'APPROVED',
  };
}

function forcePushed(branch: ForcePushedBranch, after: string): TimelineItem {
  return { kind: 'forcePushed', event: event(), branch, before: undefined, after };
}

type Items = [cursor: string, item: TimelineItem][];

function entries(items: Items): TimelineEntry[] {
  return items.map(([cursor, item]) => ({ cursor, item }));
}

function plain(names: readonly string[]): Items {
  return names.map((cursor) => [cursor, other()]);
}

function description(): TimelineDescription {
  return { author: user('alice'), body: '', createdAt: at(0), lastEditedAt: undefined };
}

/**
 * A newest page holding `items`, read when GitHub counted `count` items and the items the
 * timeline shows last changed at minute `changed`.
 */
function page(items: Items, count: number, changed: number): TimelineItemsPage {
  return {
    description: description(),
    entries: entries(items),
    count,
    shownUpdatedAt: at(changed),
    hasPreviousPage: true,
    startCursor: items[0]?.[0],
  };
}

/**
 * A timeline holding `items` with `leftOut` older ones, read when GitHub counted `count` items
 * and the items it shows last changed at minute 0.
 */
function timeline(items: Items, leftOut: number, count: number): PullRequestTimeline {
  return {
    description: description(),
    items: entries(items),
    leftOut,
    count,
    shownUpdatedAt: at(0),
    readInFullAt: at(0),
  };
}

function cursors(read: PullRequestTimeline | undefined): string[] | undefined {
  return read?.items.map((entry) => entry.cursor);
}

test('a newest page joins the items before it', () => {
  const known = timeline(plain(['a', 'b', 'c', 'd']), 1, 5);
  // One item added after d.
  const newest = page(plain(['c', 'd', 'e']), 6, 1);
  let joined = joinNewestPage(known, newest, 100);
  expect(cursors(joined)).toEqual(['a', 'b', 'c', 'd', 'e']);
  expect([joined?.leftOut, joined?.count]).toEqual([1, 6]);
  expect(joined?.shownUpdatedAt).toBe(at(1));
  // Past the most it keeps, the oldest are left out.
  joined = joinNewestPage(known, newest, 4);
  expect(cursors(joined)).toEqual(['b', 'c', 'd', 'e']);
  expect(joined?.leftOut).toBe(2);
  // An item on the page edited: the page holds it as it is now.
  const items = plain(['a', 'b', 'c', 'd']);
  items[2] = ['c', comment('Before')];
  const edited: Items = [
    ['c', comment('After')],
    ['d', other()],
  ];
  joined = joinNewestPage(timeline(items, 0, 4), page(edited, 4, 1), 100);
  expect(joined?.items[2]?.item).toEqual(comment('After'));
});

test('a newest page that doesnt add up is read in full', () => {
  const known = timeline(plain(['a', 'b', 'c', 'd']), 0, 4);
  // An older item deleted while one was added, or one added before the page.
  expect(joinNewestPage(known, page(plain(['c', 'd', 'e']), 4, 1), 100)).toBeUndefined();
  expect(joinNewestPage(known, page(plain(['c', 'd', 'e']), 6, 1), 100)).toBeUndefined();
  // More items were added than a page holds.
  expect(joinNewestPage(known, page(plain(['x', 'y', 'z']), 7, 1), 100)).toBeUndefined();
});

test('a change to the shown items the page doesnt hold is read in full', () => {
  const items = plain(['a', 'b', 'c', 'd']);
  items[0] = ['a', comment('Old')];
  const known = timeline(items, 0, 4);
  // The newest item's time moved, but the page is as it was: an item came and an older one
  // went.
  expect(joinNewestPage(known, page(plain(['c', 'd']), 4, 1), 100)).toBeUndefined();
  // Nothing the timeline shows changed, such as a mention.
  expect(joinNewestPage(known, page(plain(['c', 'd']), 4, 0), 100)).toBeDefined();
});

test('a new dismissal or force push of what the page doesnt hold is read in full', () => {
  const items = plain(['a', 'b', 'c']);
  items[0] = ['a', review('PRR_old')];
  items[1] = ['b', commit('c1')];
  const known = timeline(items, 0, 3);

  // The approval it dismisses is older than the page.
  const late: Items = [
    ['c', other()],
    ['d', dismissed('PRR_old')],
  ];
  expect(joinNewestPage(known, page(late, 4, 1), 100)).toBeUndefined();
  // A force-push whose commits were committed before the page, as a rebase keeping its
  // committer dates leaves them; and one of the base branch.
  const pushed: Items = [
    ['c', other()],
    ['d', forcePushed('head', 'c9')],
  ];
  expect(joinNewestPage(known, page(pushed, 4, 1), 100)).toBeUndefined();
  const base: Items = [
    ['c', other()],
    ['d', forcePushed('base', 'b9')],
  ];
  expect(joinNewestPage(known, page(base, 4, 1), 100)).toBeUndefined();

  // The page holds what they change.
  const held: Items = [
    ['c', other()],
    ['d', review('PRR_new')],
    ['e', dismissed('PRR_new')],
    ['f', commit('c9')],
    ['g', forcePushed('head', 'c9')],
  ];
  expect(joinNewestPage(known, page(held, 7, 1), 100)).toBeDefined();
  // A dismissal it has already joined changes nothing more.
  const joined = timeline(late, 2, 4);
  expect(joinNewestPage(joined, page(late, 4, 0), 100)).toBeDefined();
});

test('a page is read before its first item with a later time', () => {
  const tied = page(
    [
      [SAME_TIME[0], other()],
      [SAME_TIME[1], other()],
      [LATER, other()],
    ],
    3,
    0,
  );
  expect(cursorBefore(tied)).toBe(LATER);
  // All of one time, or cursors Lo can't read: before its start.
  tied.entries.pop();
  expect(cursorBefore(tied)).toBe(SAME_TIME[0]);
  expect(cursorBefore(page(plain(['x', 'y']), 2, 0))).toBe('x');
  // The first page has none before it.
  tied.hasPreviousPage = false;
  expect(cursorBefore(tied)).toBeUndefined();
});

test('a timeline is read in full hourly', () => {
  const known = timeline(plain(['a']), 0, 1);
  const read = Date.parse(known.readInFullAt);
  expect(dueInFull(known, new Date(read + READ_IN_FULL_EVERY - 1000))).toBe(false);
  expect(dueInFull(known, new Date(read + READ_IN_FULL_EVERY))).toBe(true);
  // A clock that went back.
  expect(dueInFull(known, new Date(read - 1000))).toBe(true);
});
