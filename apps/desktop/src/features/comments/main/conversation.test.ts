// Writing on a pull request itself, from main: a comment there posts at once, in its turn, joining
// no review, and one whose answer was lost is looked for in the timeline read afresh; your comments
// there are edited only over the text the edit started from, and deleted only as the question
// showed them, each read afresh from the timeline first, and settled the same way when GitHub's
// answer is lost. Nothing is ever sent again by itself.

import {
  type CommentId,
  GithubError,
  type PendingReviewRead,
  type PullRef,
  type PullRequestTimeline,
  type ReviewWriteRefusal,
} from '@lo/github';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { openDatabase } from '../../../main/database.ts';
import { migrate } from '../../../main/migrations.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { ActsView, DraftPlaceRow, DraftsView, EditPlaceRow } from '../contract.ts';
import { pullCommentIn } from './conversation.ts';
import { DraftStore } from './drafts.ts';
import { Writer, type WriterPoller } from './writer.ts';

// The feature's migrations, named by their paths in the app, as main finds them.
const migrations = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../migrations/*.sql', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([path, sql]) => [path.replace(/^\.\.\//, '/src/features/comments/'), sql]),
);

const HEAD = 'a'.repeat(40);
const MINE = 'IC_1';
const ON_PULL: DraftPlaceRow = { kind: 'conversation' };
const EDIT: EditPlaceRow = { kind: 'edit', thread: null, comment: MINE };

/** #94's view `t1`, on screen at `HEAD` as rozed-bot. */
function info(): PullTabInfo {
  return {
    id: 't1',
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number: 94,
    acting: { kind: 'account', login: 'rozed-bot' },
    head: { fork: null },
    shown: HEAD,
    latest: HEAD,
    provisional: false,
    local: { kind: 'waiting' },
    compareFrom: undefined,
    drawn: true,
    run: undefined,
  };
}

/** A comment on the pull request itself, as the timeline holds it. */
interface Said {
  id: string;
  author?: string | null;
  body: string;
  createdAt?: string;
  canUpdate?: boolean;
  canDelete?: boolean;
}

/** The timeline's items, as GitHub's query answers them, holding `comments`, oldest first. */
function edges(comments: readonly Said[]) {
  return comments.map((each, at) => {
    const author = each.author === undefined ? 'rozed-bot' : each.author;
    return {
      cursor: `c${at}`,
      node: {
        __typename: 'IssueComment',
        id: each.id,
        author: author === null ? null : { __typename: 'User', login: author },
        body: each.body,
        createdAt: each.createdAt ?? new Date().toISOString(),
        lastEditedAt: null,
        url: `https://github.com/rozed-dev/e2e/pull/94#issuecomment-${at}`,
        isMinimized: false,
        minimizedReason: null,
        viewerCanUpdate: each.canUpdate ?? author === 'rozed-bot',
        viewerCanDelete: each.canDelete ?? author === 'rozed-bot',
      },
    };
  });
}

/** The timeline as a read of it holds `comments`, with `leftOut` older items it left out. */
function timelineOf(comments: readonly Said[], leftOut = 0): PullRequestTimeline {
  return {
    description: {
      author: undefined,
      body: '',
      createdAt: '2026-11-13T10:00:00Z',
      lastEditedAt: undefined,
    },
    items: edges(comments).map(({ cursor, node }) => ({
      cursor,
      item: {
        kind: 'comment' as const,
        comment: {
          id: node.id,
          author: node.author ? { login: node.author.login, type: 'User' as const } : undefined,
          body: node.body,
          createdAt: node.createdAt,
          lastEditedAt: undefined,
          url: node.url,
          hidden: undefined,
          viewerCanUpdate: node.viewerCanUpdate,
          viewerCanDelete: node.viewerCanDelete,
        },
      },
    })),
    leftOut,
    count: comments.length + leftOut,
    shownUpdatedAt: '2026-11-13T11:00:00Z',
    readInFullAt: '2026-11-13T11:00:00Z',
  };
}

type Answer = undefined | string | ReviewWriteRefusal | Error;

/** What a write the fake poller was asked to send was. */
type Asked =
  | { kind: 'post'; pull: string; body: string }
  | { kind: 'edit'; comment: CommentId; body: string }
  | { kind: 'delete'; comment: CommentId };

/**
 * An account's poller whose writes take the next of `answers`, whose timeline as last read holds
 * `timeline.held`, and whose fresh reads of it find `timeline.now`, with `leftOut` older items.
 */
function poller(answers: Answer[]) {
  const sent: Asked[] = [];
  const afresh: string[] = [];
  const timeline: { held: Said[]; now: Said[] | Error; leftOut: number } = {
    held: [{ id: MINE, body: 'Looks right.' }],
    now: [],
    leftOut: 0,
  };
  const client = {
    githubAhead: () => undefined,
    graphqlWithErrors() {
      const { now, leftOut } = timeline;
      if (now instanceof Error) return Promise.reject(now);
      const pullRequest = {
        author: { __typename: 'User', login: 'mona' },
        body: 'Adds the cache.',
        createdAt: '2026-11-13T10:00:00Z',
        lastEditedAt: null,
        timelineEvents: { updatedAt: '2026-11-13T11:00:00Z' },
        timelineItems: {
          edges: edges(now),
          filteredCount: now.length + leftOut,
          pageInfo: { hasPreviousPage: leftOut > 0, startCursor: 'c0' },
        },
      };
      return Promise.resolve({ data: { repository: { pullRequest } }, errors: [] });
    },
  };
  const answer = <T>(asked: Asked): Promise<T> => {
    sent.push(asked);
    const next = answers.shift();
    if (next instanceof Error) return Promise.reject(next);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each test answers in kind.
    return Promise.resolve(next as T);
  };
  const pending: PendingReviewRead = { kind: 'read', review: undefined };
  const fake = {
    pullRequest: () => ({ details: { id: 'PR_94', headRefOid: HEAD } }),
    cachedRead: (_pull: PullRef, kind: { name: string }) =>
      kind.name === 'Timeline'
        ? { value: timelineOf(timeline.held), fetchedAt: 0 }
        : { value: pending, fetchedAt: 0 },
    pendingReview: () => Promise.resolve({ value: pending, fetchedAt: 0 }),
    addConversationComment: (_pull: PullRef, pull: string, body: string) =>
      answer({ kind: 'post', pull, body }),
    editComment: (_pull: PullRef, comment: CommentId, body: string) =>
      answer({ kind: 'edit', comment, body }),
    deleteComment: (_pull: PullRef, comment: CommentId) => answer({ kind: 'delete', comment }),
    readAfresh(_pull: PullRef, kind: { name: string }) {
      afresh.push(kind.name);
      return { read: 1, generation: afresh.length };
    },
    readSince: () => ({ kind: 'stale' }),
    readOnce: <T>(request: (made: typeof client) => Promise<T>): Promise<T> => request(client),
    onEvent: () => () => {},
  };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only these are read.
    poller: fake as unknown as WriterPoller,
    sent,
    afresh,
    timeline,
  };
}

function writer(fake: ReturnType<typeof poller>, database = fresh()) {
  const view = info();
  const published: DraftsView[] = [];
  const acts: ActsView[] = [];
  const drafts = new DraftStore(database);
  const made = new Writer({
    poller: () => Promise.resolve(fake.poller),
    view: (id) => (id === view.id ? view : undefined),
    drafts,
    publish: (each) => published.push(each),
    publishActs: (each) => acts.push(each),
    log: () => {},
    settleAfter: 10_000,
    readWait: 60_000,
  });
  made.follow(view.id);
  const last = () => published.at(-1)?.drafts ?? [];
  const stands = () => acts.at(-1)?.acts ?? [];
  return { made, last, stands, database };
}

/** A database with the feature's tables. */
function fresh() {
  const database = openDatabase(':memory:');
  migrate(database, migrations);
  return database;
}

/** An error whose answer was lost: the write may have gone. */
function lost(): GithubError {
  return new GithubError({ kind: 'network', failure: 'lost', message: 'reset' });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('commenting on the pull request', () => {
  test('posts at once, however it was sent, joining no review, and the draft goes', async () => {
    const fake = poller(['IC_2']);
    const { made, last } = writer(fake);
    made.save('t1', ON_PULL, 'Ship it.');
    expect(last()).toMatchObject([{ place: ON_PULL, text: 'Ship it.' }]);
    expect(await made.send('t1', ON_PULL, 'Ship it.', 'review')).toEqual({
      kind: 'sent',
      pending: false,
      joined: false,
      thread: null,
      landedOn: null,
    });
    expect(fake.sent).toEqual([{ kind: 'post', pull: 'PR_94', body: 'Ship it.' }]);
    expect(last()).toEqual([]);
  });

  test('an answer that was lost is settled from the timeline read afresh, kept through a restart', async () => {
    vi.useFakeTimers();
    for (const posted of [true, false]) {
      const fake = poller([lost()]);
      const database = fresh();
      const { made, last } = writer(fake, database);
      expect(await made.send('t1', ON_PULL, 'Ship it.', 'now')).toEqual({ kind: 'lost' });
      expect(last()).toMatchObject([{ sending: 'checking', sent: 'Ship it.' }]);
      // Lo starts again before it knows: the draft still says it was sent.
      made.stop();
      const again = writer(fake, database);
      fake.timeline.now = posted ? [{ id: 'IC_2', body: 'Ship it.\r\n' }] : [];
      await vi.advanceTimersByTimeAsync(10_000);
      expect(again.last()).toMatchObject(posted ? [] : [{ sending: 'notPosted', sent: null }]);
      expect(fake.afresh).toEqual(posted ? ['Timeline'] : []);
      // Never sent again by itself.
      expect(fake.sent).toHaveLength(1);
    }
  });
});

describe('editing your comment on the pull request', () => {
  test('starts from GitHub’s text and saves only over it, read afresh from the timeline', async () => {
    const fake = poller([undefined]);
    const { made, last } = writer(fake);
    expect(await made.editing('t1', EDIT, 'Looks right.')).toEqual({ kind: 'done' });
    made.save('t1', EDIT, 'Looks right to me.');
    fake.timeline.now = [{ id: MINE, body: 'Looks right.' }];
    expect(await made.edit('t1', EDIT, 'Looks right to me.')).toEqual({ kind: 'done' });
    expect(fake.sent).toEqual([
      { kind: 'edit', comment: { kind: 'conversation', id: MINE }, body: 'Looks right to me.' },
    ]);
    expect(last()).toEqual([]);
  });

  test('someone else’s comment isn’t started, and one changed or gone since keeps the text', async () => {
    const fake = poller([]);
    fake.timeline.held = [{ id: 'IC_0', author: 'ravi-k', body: 'Theirs.' }];
    const { made, last } = writer(fake);
    expect(await made.editing('t1', { ...EDIT, comment: 'IC_0' }, 'Theirs.')).toEqual({
      kind: 'refused',
      refusal: { kind: 'theirs', author: 'ravi-k' },
    });
    await made.editing('t1', EDIT, 'Looks right.');
    made.save('t1', EDIT, 'Mine.');
    fake.timeline.now = [{ id: MINE, body: 'Edited elsewhere.' }];
    expect(await made.edit('t1', EDIT, 'Mine.')).toEqual({
      kind: 'refused',
      refusal: { kind: 'changed' },
    });
    fake.timeline.now = [];
    expect(await made.edit('t1', EDIT, 'Mine.')).toEqual({
      kind: 'refused',
      refusal: { kind: 'gone' },
    });
    expect(fake.sent).toEqual([]);
    expect(last()).toMatchObject([{ text: 'Mine.', base: 'Looks right.', sending: null }]);
    expect(fake.afresh).toEqual(['Timeline', 'Timeline']);
  });

  test('an answer that was lost is settled by the comment’s text in the timeline read after', async () => {
    vi.useFakeTimers();
    for (const [found, drafts] of [
      ['Mine.', []],
      ['Looks right.', [{ sending: 'notPosted', sent: null }]],
    ] as const) {
      const fake = poller([lost()]);
      const { made, last } = writer(fake);
      await made.editing('t1', EDIT, 'Looks right.');
      fake.timeline.now = [{ id: MINE, body: 'Looks right.' }];
      expect(await made.edit('t1', EDIT, 'Mine.')).toEqual({ kind: 'lost' });
      fake.timeline.now = [{ id: MINE, body: found }];
      await vi.advanceTimersByTimeAsync(10_000);
      expect(last()).toMatchObject(drafts);
      expect(fake.sent).toHaveLength(1);
    }
  });
});

describe('deleting your comment on the pull request', () => {
  const asked = { body: 'Looks right.', pending: false, onlyComment: false };

  test('goes only while the timeline read afresh has it as the question showed it', async () => {
    const fake = poller([undefined]);
    const { made } = writer(fake);
    fake.timeline.now = [{ id: MINE, body: 'Edited elsewhere.' }];
    expect(await made.remove('t1', null, MINE, asked)).toEqual({
      kind: 'refused',
      refusal: { kind: 'changed' },
    });
    fake.timeline.now = [];
    expect(await made.remove('t1', null, MINE, asked)).toEqual({
      kind: 'refused',
      refusal: { kind: 'gone' },
    });
    expect(fake.sent).toEqual([]);
    fake.timeline.now = [{ id: MINE, body: 'Looks right.\r\n' }];
    expect(await made.remove('t1', null, MINE, asked)).toEqual({ kind: 'done' });
    expect(fake.sent).toEqual([{ kind: 'delete', comment: { kind: 'conversation', id: MINE } }]);
  });

  test('an answer that was lost is settled by whether the timeline read after holds it', async () => {
    vi.useFakeTimers();
    const fake = poller([lost()]);
    const { made, stands } = writer(fake);
    fake.timeline.now = [{ id: MINE, body: 'Looks right.' }];
    expect(await made.remove('t1', null, MINE, asked)).toEqual({ kind: 'lost' });
    expect(stands()).toMatchObject([
      { thread: null, comment: MINE, change: 'delete', stands: 'checking' },
    ]);
    fake.timeline.now = [];
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stands()).toEqual([]);
    expect(fake.afresh).toEqual(['Timeline']);
    expect(fake.sent).toHaveLength(1);
  });
});

test('a comment the timeline may have left out among its older events settles nothing', () => {
  const read = timelineOf([{ id: 'IC_9', body: 'Newer.' }], 3);
  expect(pullCommentIn(read, 'IC_9', 'Rozed-Bot')).toMatchObject({
    body: 'Newer.',
    viewerDidAuthor: true,
  });
  expect(() => pullCommentIn(read, MINE, 'rozed-bot')).toThrow(GithubError);
  // With nothing left out, it's gone.
  expect(pullCommentIn({ ...read, leftOut: 0 }, MINE, 'rozed-bot')).toBeUndefined();
});
