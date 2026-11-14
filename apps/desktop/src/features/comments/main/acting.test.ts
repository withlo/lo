// Acting on review threads from main: replying, resolving and unresolving, editing and deleting
// your comment. One write to a pull request goes at a time; an edit or a delete reads the comment
// afresh first; and a write whose answer was lost is never sent again by itself, but settled from a
// read made after it.

import {
  type CommentId,
  GithubError,
  type PendingReviewRead,
  PullRef,
  type ReviewThread,
  type ReviewThreadList,
  type ReviewWrite,
  type ReviewWriteRefusal,
  type Sent,
} from '@lo/github';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { openDatabase } from '../../../main/database.ts';
import { migrate } from '../../../main/migrations.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { ActsView, DraftsView, EditPlaceRow } from '../contract.ts';
import { asAsked, changeRefused } from './acting.ts';
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
const PULL = new PullRef('rozed-dev', 'e2e', 94);
const THREAD = 'PRRT_1';
const MINE = 'PRRC_1';

/** #94's view `t1`, on screen at `HEAD` as rozed-bot. */
function info(overrides: Partial<PullTabInfo> = {}): PullTabInfo {
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
    ...overrides,
  };
}

/** A comment as GitHub has it now, which a fresh read of it finds. */
interface Now {
  body: string;
  author?: string | null;
  state?: 'PENDING' | 'SUBMITTED';
  canUpdate?: boolean;
  canDelete?: boolean;
  /** How many comments its thread holds. */
  count?: number;
  resolved?: boolean;
}

/** Thread `THREAD` on src/backoff.ts line 2, with `comments`, oldest first. */
function thread(
  comments: { id: string; author: string; body: string; state?: 'PENDING' | 'SUBMITTED' }[],
  overrides: Partial<ReviewThread> = {},
): ReviewThread {
  return {
    id: THREAD,
    path: 'src/backoff.ts',
    subjectType: 'LINE',
    diffSide: 'RIGHT',
    startDiffSide: null,
    line: 2,
    startLine: null,
    originalLine: 2,
    originalStartLine: null,
    isOutdated: false,
    isResolved: false,
    viewerCanReply: true,
    viewerCanResolve: true,
    viewerCanUnresolve: false,
    comments: {
      totalCount: comments.length,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: comments.map((each) => ({
        id: each.id,
        author: { __typename: 'User', login: each.author },
        body: each.body,
        state: each.state ?? 'SUBMITTED',
        createdAt: '2026-11-13T11:00:00Z',
        url: 'https://github.com/rozed-dev/e2e/pull/94#discussion_r1',
        isMinimized: false,
        minimizedReason: null,
        viewerCanUpdate: each.author === 'rozed-bot',
        viewerCanDelete: each.author === 'rozed-bot',
        commit: { oid: HEAD },
        originalCommit: { oid: HEAD },
      })),
    },
    ...overrides,
  };
}

type Answer = undefined | Sent | ReviewWriteRefusal | Error | Promise<undefined>;

/** What a write the fake poller was asked to send was. */
type Asked =
  | { kind: 'resolve'; thread: string; resolved: boolean }
  | { kind: 'edit'; comment: CommentId; body: string }
  | { kind: 'delete'; comment: CommentId }
  | { kind: 'review'; write: ReviewWrite };

/**
 * An account's poller whose writes take the next of `answers`, whose threads as last read are
 * `threads.held`, and whose fresh reads of a comment find `comments`, or nothing.
 */
function poller(answers: Answer[]) {
  const sent: Asked[] = [];
  const afresh: string[] = [];
  const readAt: number[] = [];
  const threads: { held: ReviewThreadList; now: ReviewThreadList | Error } = {
    held: {
      nodes: [thread([{ id: MINE, author: 'rozed-bot', body: 'Start higher?' }])],
      missing: 0,
    },
    now: { nodes: [], missing: 0 },
  };
  /** What a fresh read of each comment finds: an error to throw, or nothing for a comment gone. */
  const comments = new Map<string, Now | Error>();
  const client = {
    githubAhead: () => undefined,
    graphql(_document: unknown, variables: { comment: string; thread: string }) {
      readAt.push(Date.now());
      const found = comments.get(variables.comment);
      if (found instanceof Error) return Promise.reject(found);
      if (!found) return Promise.reject(new GithubError({ kind: 'notFound', message: 'gone' }));
      const author = found.author === undefined ? 'rozed-bot' : found.author;
      return Promise.resolve({
        comment: {
          __typename: 'PullRequestReviewComment',
          id: variables.comment,
          author: author === null ? null : { __typename: 'User', login: author },
          body: found.body,
          state: found.state ?? 'SUBMITTED',
          lastEditedAt: null,
          editor: null,
          viewerDidAuthor: author === 'rozed-bot',
          viewerCanUpdate: found.canUpdate ?? author === 'rozed-bot',
          viewerCanDelete: found.canDelete ?? author === 'rozed-bot',
          viewerCannotUpdateReasons: found.canUpdate === false ? ['LOCKED'] : [],
          pullRequestReview: { state: found.state ?? 'SUBMITTED', comments: { totalCount: 1 } },
        },
        thread: {
          __typename: 'PullRequestReviewThread',
          isResolved: found.resolved ?? false,
          comments: { totalCount: found.count ?? 1 },
        },
      });
    },
    graphqlWithErrors() {
      readAt.push(Date.now());
      const { now } = threads;
      if (now instanceof Error) return Promise.reject(now);
      const reviewThreads = {
        totalCount: now.nodes.length,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: now.nodes,
      };
      return Promise.resolve({
        data: { repository: { pullRequest: { reviewThreads } } },
        errors: [],
      });
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
      kind.name === 'ReviewThreads'
        ? { value: threads.held, fetchedAt: 0 }
        : { value: pending, fetchedAt: 0 },
    pendingReview: () => Promise.resolve({ value: pending, fetchedAt: 0 }),
    sendReview: (_pull: PullRef, write: ReviewWrite) => answer({ kind: 'review', write }),
    resolveThread: (_pull: PullRef, id: string, resolved: boolean) =>
      answer({ kind: 'resolve', thread: id, resolved }),
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
    readAt,
    threads,
    comments,
  };
}

function writer(fake: ReturnType<typeof poller>, view = info()) {
  const database = openDatabase(':memory:');
  migrate(database, migrations);
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
  return { made, drafts, last, stands, database };
}

/** An error whose answer was lost: the write may have gone. */
function lost(): GithubError {
  return new GithubError({ kind: 'network', failure: 'lost', message: 'reset' });
}

const EDIT: EditPlaceRow = { kind: 'edit', thread: THREAD, comment: MINE };

afterEach(() => {
  vi.useRealTimers();
});

describe('replying', () => {
  test('⌘⏎ adds the reply to a new pending review, and ⌥⏎ posts it at once', async () => {
    // GitHub starts a review with new threads only: a reply goes into it once it's started.
    const review = poller([{ review: 'PRR_1' }, { review: 'PRR_1', comment: 'C_2' }]);
    const reply = { kind: 'reply' as const, thread: THREAD };
    expect(await writer(review).made.send('t1', reply, 'Agreed.', 'review')).toMatchObject({
      kind: 'sent',
      pending: true,
    });
    expect(review.sent.map((each) => each.kind === 'review' && each.write.kind)).toEqual([
      'startReview',
      'addReply',
    ]);
    const now = poller([{ review: 'PRR_2', comment: 'C_3' }]);
    expect(await writer(now).made.send('t1', reply, 'Agreed.', 'now')).toMatchObject({
      kind: 'sent',
      pending: false,
    });
    expect(now.sent).toMatchObject([{ kind: 'review', write: { kind: 'postReply' } }]);
  });

  test('a thread GitHub takes no reply on is refused, and the draft stays', async () => {
    const fake = poller([]);
    fake.threads.held = {
      nodes: [thread([{ id: MINE, author: 'ravi-k', body: 'Hm.' }], { viewerCanReply: false })],
      missing: 0,
    };
    const { made, last } = writer(fake);
    const reply = { kind: 'reply' as const, thread: THREAD };
    expect(await made.send('t1', reply, 'Agreed.', 'review')).toEqual({
      kind: 'refused',
      refusal: { kind: 'github', message: 'GitHub doesn’t let you reply to this thread.' },
    });
    expect(fake.sent).toEqual([]);
    expect(last()).toMatchObject([{ place: reply, text: 'Agreed.', sending: null }]);
  });
});

describe('resolving', () => {
  test('resolves and unresolves, and sends nothing for a thread already so', async () => {
    const fake = poller([undefined]);
    const { made } = writer(fake);
    expect(await made.resolve('t1', THREAD, true)).toEqual({ kind: 'done' });
    expect(fake.sent).toEqual([{ kind: 'resolve', thread: THREAD, resolved: true }]);
    expect(await made.resolve('t1', THREAD, false)).toEqual({ kind: 'done' });
    expect(fake.sent).toHaveLength(1);
  });

  test('a thread GitHub doesn’t let you resolve, and GitHub’s refusals, say why', async () => {
    const fake = poller([{ refusal: 'paused', until: 1234 }]);
    fake.threads.held = {
      nodes: [thread([{ id: MINE, author: 'rozed-bot', body: 'x' }], { viewerCanResolve: false })],
      missing: 0,
    };
    const { made } = writer(fake);
    expect(await made.resolve('t1', THREAD, true)).toEqual({
      kind: 'refused',
      refusal: { kind: 'cantResolve', resolved: true },
    });
    fake.threads.held = {
      nodes: [thread([{ id: MINE, author: 'rozed-bot', body: 'x' }])],
      missing: 0,
    };
    expect(await made.resolve('t1', THREAD, true)).toEqual({
      kind: 'refused',
      refusal: { kind: 'paused', until: 1234 },
    });
  });

  test('nobody, and a run of layers, are refused before anything is sent', async () => {
    const fake = poller([]);
    expect(
      await writer(fake, info({ acting: { kind: 'anonymous' } })).made.resolve('t1', THREAD, true),
    ).toEqual({ kind: 'refused', refusal: { kind: 'signIn' } });
    expect(await writer(fake, info({ run: [82, 83] })).made.resolve('t1', THREAD, true)).toEqual({
      kind: 'refused',
      refusal: { kind: 'run' },
    });
    expect(fake.sent).toEqual([]);
  });

  test('one write to a pull request goes at a time, and the same change isn’t asked twice meanwhile', async () => {
    let answer!: () => void;
    const first = new Promise<undefined>((resolve) => {
      answer = () => resolve(undefined);
    });
    const fake = poller([first, undefined]);
    const { made, stands } = writer(fake);
    const sending = made.send('t1', { kind: 'reply', thread: 'PRRT_2' }, 'One.', 'now');
    const resolving = made.resolve('t1', THREAD, true);
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    expect(stands()).toMatchObject([{ thread: THREAD, change: 'resolve', stands: 'waiting' }]);
    expect(await made.resolve('t1', THREAD, true)).toEqual({
      kind: 'refused',
      refusal: { kind: 'busy' },
    });
    answer();
    await sending;
    expect(await resolving).toEqual({ kind: 'done' });
    expect(fake.sent.map((each) => each.kind)).toEqual(['review', 'resolve']);
    expect(stands()).toEqual([]);
  });

  test('an answer that was lost is settled from a read of the threads made after, never sent again', async () => {
    vi.useFakeTimers();
    const fake = poller([lost()]);
    const { made, stands } = writer(fake);
    expect(await made.resolve('t1', THREAD, true)).toEqual({ kind: 'lost' });
    expect(stands()).toMatchObject([{ change: 'resolve', stands: 'checking' }]);
    fake.threads.now = {
      nodes: [thread([{ id: MINE, author: 'rozed-bot', body: 'x' }], { isResolved: true })],
      missing: 0,
    };
    await vi.advanceTimersByTimeAsync(9_000);
    expect(fake.readAt).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(stands()).toEqual([]);
    expect(fake.afresh).toEqual(['ReviewThreads']);
    // Not resolved, it says so; refused, it can't tell.
    const notDone = poller([lost()]);
    const twice = writer(notDone);
    await twice.made.resolve('t1', THREAD, true);
    notDone.threads.now = { nodes: [thread([])], missing: 0 };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(twice.stands()).toMatchObject([{ stands: 'notDone' }]);
    const refusing = poller([lost()]);
    const unknown = writer(refusing);
    await unknown.made.resolve('t1', THREAD, true);
    refusing.threads.now = new GithubError({ kind: 'notFound', message: 'gone' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(unknown.stands()).toMatchObject([{ stands: 'unknown' }]);
    expect([...fake.sent, ...notDone.sent, ...refusing.sent]).toHaveLength(3);
    // Asked again, it goes, and how it stands is the new answer's.
    expect(await unknown.made.resolve('t1', THREAD, true)).toEqual({ kind: 'done' });
    expect(refusing.sent).toHaveLength(2);
    expect(unknown.stands()).toEqual([]);
  });
});

describe('editing', () => {
  test('starts from GitHub’s text, kept with the draft, and saves only over that text', async () => {
    const fake = poller([undefined]);
    const { made, last } = writer(fake);
    expect(await made.editing('t1', EDIT, 'Start higher?')).toEqual({ kind: 'done' });
    expect(last()).toMatchObject([{ place: EDIT, text: 'Start higher?', base: 'Start higher?' }]);
    // Started again, the draft there stays.
    made.save('t1', EDIT, 'Start at 2?');
    await made.editing('t1', EDIT, 'Something newer');
    expect(last()).toMatchObject([{ text: 'Start at 2?', base: 'Start higher?' }]);
    fake.comments.set(MINE, { body: 'Start higher?\r\n' });
    expect(await made.edit('t1', EDIT, 'Start at 2?')).toEqual({ kind: 'done' });
    expect(fake.sent).toEqual([
      { kind: 'edit', comment: { kind: 'thread', id: MINE }, body: 'Start at 2?' },
    ]);
    expect(last()).toEqual([]);
  });

  test('someone else’s comment, or one GitHub doesn’t let you edit, isn’t started', async () => {
    const fake = poller([]);
    fake.threads.held = {
      nodes: [
        thread([
          { id: 'PRRC_0', author: 'ravi-k', body: 'Theirs.' },
          { id: MINE, author: 'rozed-bot', body: 'Mine.' },
        ]),
      ],
      missing: 0,
    };
    const { made, last } = writer(fake);
    expect(await made.editing('t1', { ...EDIT, comment: 'PRRC_0' }, 'Theirs.')).toEqual({
      kind: 'refused',
      refusal: { kind: 'theirs', author: 'ravi-k' },
    });
    expect(last()).toEqual([]);
  });

  test('a comment edited on GitHub since, or gone, keeps the text, and nothing is sent', async () => {
    const fake = poller([]);
    const { made, last } = writer(fake);
    await made.editing('t1', EDIT, 'Start higher?');
    made.save('t1', EDIT, 'Mine.');
    fake.comments.set(MINE, { body: 'Edited elsewhere.' });
    expect(await made.edit('t1', EDIT, 'Mine.')).toEqual({
      kind: 'refused',
      refusal: { kind: 'changed' },
    });
    expect(last()).toMatchObject([{ text: 'Mine.', base: 'Start higher?', sending: null }]);
    expect(fake.afresh).toEqual(['ReviewThreads']);
    fake.comments.delete(MINE);
    expect(await made.edit('t1', EDIT, 'Mine.')).toEqual({
      kind: 'refused',
      refusal: { kind: 'gone' },
    });
    fake.comments.set(MINE, { body: 'Start higher?', canUpdate: false });
    expect(await made.edit('t1', EDIT, 'Mine.')).toEqual({
      kind: 'refused',
      refusal: { kind: 'notAllowed', reasons: ['LOCKED'] },
    });
    // GitHub's text is the edit already: nothing to send, and it's done.
    fake.comments.set(MINE, { body: 'Mine.' });
    expect(await made.edit('t1', EDIT, 'Mine.')).toEqual({ kind: 'done' });
    expect(fake.sent).toEqual([]);
    expect(last()).toEqual([]);
  });

  test('an answer that was lost is settled by the comment’s text in a read made after', async () => {
    vi.useFakeTimers();
    const cases: [Now | undefined, string, unknown][] = [
      [{ body: 'Mine.' }, 'gone', []],
      [{ body: 'Start higher?' }, 'not taken', [{ sending: 'notPosted', sent: null }]],
      [{ body: 'Elsewhere.' }, 'changed', [{ sending: 'changed', sent: null }]],
      [undefined, 'deleted', [{ sending: 'gone', sent: null }]],
    ];
    for (const [now, , drafts] of cases) {
      const fake = poller([lost()]);
      const { made, last } = writer(fake);
      await made.editing('t1', EDIT, 'Start higher?');
      fake.comments.set(MINE, { body: 'Start higher?' });
      expect(await made.edit('t1', EDIT, 'Mine.')).toEqual({ kind: 'lost' });
      expect(last()).toMatchObject([{ sending: 'checking', sent: 'Mine.' }]);
      if (now) fake.comments.set(MINE, now);
      else fake.comments.delete(MINE);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(last()).toMatchObject(drafts as object[]);
      expect(fake.sent).toHaveLength(1);
    }
  });

  test('an edit with nothing it started from is refused', async () => {
    const { made } = writer(poller([]));
    made.save('t1', EDIT, 'Typed');
    expect(await made.edit('t1', EDIT, 'Typed')).toMatchObject({
      kind: 'refused',
      refusal: { kind: 'github' },
    });
  });
});

describe('deleting', () => {
  const asked = { body: 'Start higher?', pending: false, onlyComment: true };

  test('goes when GitHub has the comment as the question showed it', async () => {
    const fake = poller([undefined]);
    const { made } = writer(fake);
    fake.comments.set(MINE, { body: 'Start higher?' });
    expect(await made.remove('t1', THREAD, MINE, asked)).toEqual({ kind: 'done' });
    expect(fake.sent).toEqual([{ kind: 'delete', comment: { kind: 'thread', id: MINE } }]);
  });

  test('is refused, with nothing sent, for a comment changed, gone, or someone else’s', async () => {
    const fake = poller([]);
    const { made } = writer(fake);
    fake.comments.set(MINE, { body: 'Edited elsewhere.' });
    expect(await made.remove('t1', THREAD, MINE, asked)).toEqual({
      kind: 'refused',
      refusal: { kind: 'changed' },
    });
    // A reply came meanwhile, so the thread no longer goes with it.
    fake.comments.set(MINE, { body: 'Start higher?', count: 2 });
    expect(await made.remove('t1', THREAD, MINE, asked)).toMatchObject({
      refusal: { kind: 'changed' },
    });
    fake.comments.delete(MINE);
    expect(await made.remove('t1', THREAD, MINE, asked)).toEqual({
      kind: 'refused',
      refusal: { kind: 'gone' },
    });
    fake.threads.held = {
      nodes: [thread([{ id: MINE, author: 'ravi-k', body: 'Start higher?' }])],
      missing: 0,
    };
    expect(await made.remove('t1', THREAD, MINE, asked)).toEqual({
      kind: 'refused',
      refusal: { kind: 'theirs', author: 'ravi-k' },
    });
    expect(fake.sent).toEqual([]);
    expect(fake.afresh).toEqual(['ReviewThreads', 'ReviewThreads', 'ReviewThreads']);
  });

  test('an answer that was lost is settled by whether a read made after finds the comment', async () => {
    vi.useFakeTimers();
    const fake = poller([lost()]);
    const { made, stands } = writer(fake);
    fake.comments.set(MINE, { body: 'Start higher?' });
    expect(await made.remove('t1', THREAD, MINE, asked)).toEqual({ kind: 'lost' });
    expect(stands()).toMatchObject([{ change: 'delete', comment: MINE, stands: 'checking' }]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stands()).toMatchObject([{ stands: 'notDone' }]);
    // Asked again, it's gone by the time the read is made.
    fake.sent.length = 0;
    const again = poller([lost()]);
    const second = writer(again);
    again.comments.set(MINE, { body: 'Start higher?' });
    await second.made.remove('t1', THREAD, MINE, asked);
    again.comments.delete(MINE);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(second.stands()).toEqual([]);
    expect(again.sent).toHaveLength(1);
  });
});

test('Lo changes only your own comments, and checks a delete against what the question showed', () => {
  const row = {
    id: MINE,
    author: 'Rozed-Bot',
    authorType: 'User',
    body: 'x',
    state: 'SUBMITTED' as const,
    createdAt: '2026-11-13T11:00:00Z',
    url: 'https://github.com/rozed-dev/e2e/pull/94#discussion_r1',
    hidden: null,
    viewerCanUpdate: true,
    viewerCanDelete: false,
  };
  expect(changeRefused(row, 'rozed-bot', 'edit')).toBeUndefined();
  expect(changeRefused(row, 'rozed-bot', 'delete')).toEqual({ kind: 'notAllowed', reasons: [] });
  expect(changeRefused({ ...row, author: null }, 'rozed-bot', 'edit')).toEqual({
    kind: 'theirs',
    author: null,
  });
  const now = {
    body: 'Text\r\n',
    author: 'rozed-bot',
    state: 'PENDING' as const,
    lastEditedAt: undefined,
    editor: undefined,
    viewerDidAuthor: true,
    viewerCanUpdate: true,
    viewerCanDelete: true,
    cannotUpdate: [],
    threadComments: 1,
    resolved: false,
    reviewComments: 2,
  };
  expect(asAsked({ body: 'Text', pending: true, onlyComment: true }, now)).toBe(true);
  expect(asAsked({ body: 'Text', pending: false, onlyComment: true }, now)).toBe(false);
  expect(asAsked({ body: 'Text', pending: true, onlyComment: false }, now)).toBe(false);
});
