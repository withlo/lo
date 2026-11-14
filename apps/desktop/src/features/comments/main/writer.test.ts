import {
  GithubError,
  type PendingReviewRead,
  type PollEvent,
  PullRef,
  type ReadMark,
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
import type { DraftPlaceRow, DraftsView } from '../contract.ts';
import { DraftStore } from './drafts.ts';
import { threadRows as threadRowsOf } from './threads.ts';
import { holdsComment, Writer, type WriterPoller } from './writer.ts';

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
const OLDER = 'b'.repeat(40);
const PULL = new PullRef('rozed-dev', 'e2e', 94);

/** A line comment on new line 5 of `src/backoff.ts`, written at `commit`. */
function onLine(commit = HEAD): DraftPlaceRow {
  return {
    kind: 'thread',
    commit,
    path: 'src/backoff.ts',
    lines: { start: null, end: { side: 'RIGHT', number: 5 } },
  };
}

const ON_FILE: DraftPlaceRow = { kind: 'thread', commit: HEAD, path: 'docs/usage.md', lines: null };

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

/**
 * A thread on `path`'s new line 5, or on the file, with rozed-bot's comment `body`, made at
 * `createdAt`: now, unless it's given.
 */
function node(
  path: string,
  body: string,
  file = false,
  createdAt = new Date().toISOString(),
): ReviewThread {
  return {
    id: `T_${path}`,
    path,
    subjectType: file ? 'FILE' : 'LINE',
    diffSide: 'RIGHT',
    startDiffSide: null,
    line: file ? null : 5,
    startLine: null,
    originalLine: file ? null : 5,
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
          id: `C_${path}`,
          author: { __typename: 'User', login: 'rozed-bot' },
          body,
          state: 'PENDING',
          createdAt,
          url: 'https://github.com/rozed-dev/e2e/pull/94#discussion_r1',
          isMinimized: false,
          minimizedReason: null,
          viewerCanUpdate: true,
          viewerCanDelete: true,
          commit: { oid: HEAD },
          originalCommit: { oid: HEAD },
        },
      ],
    },
  };
}

type Answer = Sent | ReviewWriteRefusal | Error | Promise<Sent | ReviewWriteRefusal>;

/**
 * An account's poller that answers each write with the next of `answers`, with `pending` as your
 * pending review it last read.
 */
function poller(
  answers: Answer[],
  pending: PendingReviewRead = { kind: 'read', review: undefined },
) {
  const listeners = new Set<(event: PollEvent) => void>();
  const sent: ReviewWrite[] = [];
  /** What each read holds against the last mark, by its name. */
  const since = new Map<string, ReturnType<WriterPoller['readSince']>>();
  /** The reads asked for afresh, by name, in order. */
  const afresh: string[] = [];
  const told = (name: string) => {
    for (const listener of listeners) listener({ kind: 'read', pull: PULL, name });
  };
  /** What a read of the threads made now gets, and how far GitHub's clock is ahead. */
  const threads: { now: ReviewThreadList | Error; ahead: number | undefined } = {
    now: { nodes: [], missing: 0 },
    ahead: undefined,
  };
  /** When each read of the threads was made. */
  const readAt: number[] = [];
  /** A client that answers the threads' query from `threads.now`. */
  const client = {
    githubAhead: () => threads.ahead,
    graphqlWithErrors() {
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
  const fake = {
    pullRequest: () => ({ details: { id: 'PR_94', headRefOid: HEAD } }),
    cachedRead: () => ({ value: pending, fetchedAt: 0 }),
    pendingReview: () => Promise.resolve({ value: pending, fetchedAt: 0 }),
    sendReview(_pull: PullRef, write: ReviewWrite) {
      sent.push(write);
      const answer = answers.shift();
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer === undefined) throw new Error('No answer left.');
      return Promise.resolve(answer);
    },
    readAfresh(_pull: PullRef, kind: { name: string }): ReadMark {
      afresh.push(kind.name);
      since.set(kind.name, { kind: 'waiting' });
      return { read: 1, generation: afresh.length };
    },
    readSince: (_pull: PullRef, kind: { name: string }) =>
      since.get(kind.name) ?? { kind: 'stale' },
    readOnce<T>(request: (made: typeof client) => Promise<T>): Promise<T> {
      readAt.push(Date.now());
      return request(client);
    },
    onEvent(listener: (event: PollEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only these are read.
    poller: fake as unknown as WriterPoller,
    sent,
    afresh,
    threads,
    readAt,
    /** Your pending review read again after the mark, as the poller tells it. */
    reviewReads(read: PendingReviewRead): void {
      since.set('PendingReview', { kind: 'read', read: { value: read, fetchedAt: Date.now() } });
      told('PendingReview');
    },
  };
}

/** A database with the feature's tables. */
function fresh() {
  const database = openDatabase(':memory:');
  migrate(database, migrations);
  return database;
}

function writer(fake: ReturnType<typeof poller>, view = info(), database = fresh()) {
  const published: DraftsView[] = [];
  const drafts = new DraftStore(database);
  const made = new Writer({
    poller: () => Promise.resolve(fake.poller),
    view: (id) => (id === view.id ? view : undefined),
    drafts,
    publish: (each) => published.push(each),
    log: () => {},
    settleAfter: 10_000,
    readWait: 60_000,
  });
  made.follow(view.id);
  const last = () => published.at(-1)?.drafts ?? [];
  return { made, drafts, published, last, database };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('sending', () => {
  test('⌘⏎ with no pending review starts one with the thread, and the draft goes', async () => {
    const fake = poller([{ review: 'PRR_1', comment: 'C_1' }]);
    const { made, last } = writer(fake);
    made.save('t1', onLine(), 'Start a little higher?');
    expect(last().map((draft) => draft.text)).toEqual(['Start a little higher?']);
    const outcome = await made.send('t1', onLine(), 'Start a little higher?', 'review');
    expect(outcome).toEqual({
      kind: 'sent',
      pending: true,
      joined: false,
      thread: null,
      landedOn: null,
    });
    expect(fake.sent.map((write) => write.kind)).toEqual(['startReview']);
    expect(last()).toEqual([]);
  });

  test('a comment on the file starts an empty review first, then adds the thread to it', async () => {
    const fake = poller([{ review: 'PRR_1' }, { review: 'PRR_1', thread: 'T_1', comment: 'C_1' }]);
    const { made, last } = writer(fake);
    const outcome = await made.send('t1', ON_FILE, 'On the file.', 'review');
    expect(outcome).toMatchObject({ kind: 'sent', pending: true });
    expect(fake.sent.map((write) => write.kind)).toEqual(['startReview', 'addThread']);
    expect(fake.sent[1]).toMatchObject({
      variables: { subjectType: 'FILE', pullRequestReviewId: 'PRR_1' },
    });
    expect(last()).toEqual([]);
  });

  test('⌥⏎ posts at once, or with a pending review adds to it and says so', async () => {
    const now = poller([{ review: 'PRR_2', comment: 'C_2' }]);
    expect(await writer(now).made.send('t1', onLine(), 'Now.', 'now')).toMatchObject({
      kind: 'sent',
      pending: false,
      joined: false,
    });
    expect(now.sent.map((write) => write.kind)).toEqual(['postThread']);
    const pending = {
      kind: 'read',
      review: { id: 'PRR_1', commit: { oid: HEAD }, comments: { totalCount: 2 } },
    } as PendingReviewRead;
    const joining = poller(
      [{ review: 'PRR_1', thread: 'T_3', comment: 'C_3', commit: HEAD }],
      pending,
    );
    expect(await writer(joining).made.send('t1', onLine(), 'Now.', 'now')).toMatchObject({
      kind: 'sent',
      pending: true,
      joined: true,
      thread: 'T_3',
    });
    expect(joining.sent.map((write) => write.kind)).toEqual(['addThread']);
  });

  test('one write to a pull request goes at a time, the next planned from your pending review as read after', async () => {
    let answer!: (sent: Sent) => void;
    const first = new Promise<Sent>((resolve) => {
      answer = resolve;
    });
    const fake = poller([first, { review: 'PRR_1', thread: 'T_2', comment: 'C_2', commit: HEAD }]);
    const { made, last } = writer(fake);
    const one = made.send('t1', onLine(), 'One.', 'review');
    const other = {
      ...onLine(),
      lines: { start: null, end: { side: 'RIGHT' as const, number: 9 } },
    };
    const two = made.send('t1', other, 'Two.', 'review');
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    expect(last().map((draft) => draft.sending)).toEqual(['sending', 'waiting']);
    // The same draft isn't sent twice meanwhile.
    expect(await made.send('t1', other, 'Two.', 'review')).toMatchObject({ kind: 'refused' });
    answer({ review: 'PRR_1', comment: 'C_1' });
    expect(await one).toMatchObject({ kind: 'sent' });
    // The first started your pending review, which the poller hasn't read since: the next waits
    // for a read made after, rather than starting a second review GitHub would refuse.
    await vi.waitFor(() => expect(fake.afresh).toEqual(['PendingReview']));
    expect(fake.sent).toHaveLength(1);
    fake.reviewReads({
      kind: 'read',
      review: { id: 'PRR_1', commit: { oid: HEAD }, comments: { totalCount: 1 } },
    });
    expect(await two).toMatchObject({ kind: 'sent', pending: true });
    expect(fake.sent.map((write) => write.kind)).toEqual(['startReview', 'addThread']);
    expect(fake.sent[1]).toMatchObject({ variables: { pullRequestReviewId: 'PRR_1' } });
    expect(last()).toEqual([]);
  });

  test('text that changed while it was sent stays as the draft', async () => {
    let answer!: (sent: Sent) => void;
    const fake = poller([
      new Promise<Sent>((resolve) => {
        answer = resolve;
      }),
    ]);
    const { made, last } = writer(fake);
    const sending = made.send('t1', onLine(), 'Sent.', 'review');
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    // Typed meanwhile, as in another tab on the pull request.
    made.save('t1', onLine(), 'Sent. And more.');
    answer({ review: 'PRR_1', comment: 'C_1' });
    expect(await sending).toMatchObject({ kind: 'sent' });
    expect(last()).toMatchObject([{ text: 'Sent. And more.', sending: null, sent: null }]);
  });

  test('a refusal keeps the draft, in the box’s words', async () => {
    const pending = {
      kind: 'read',
      review: { id: 'PRR_1', commit: { oid: HEAD }, comments: { totalCount: 1 } },
    } as PendingReviewRead;
    const cases: [Answer[], DraftPlaceRow, unknown][] = [
      [[{ refusal: 'notInDiff' }], onLine(), { kind: 'notInDiff' }],
      [[{ refusal: 'headMoved', head: OLDER }], onLine(), { kind: 'headMoved', head: OLDER }],
      [[{ refusal: 'paused', until: 1234 }], onLine(), { kind: 'paused', until: 1234 }],
      [[], onLine(OLDER), { kind: 'notLatest', head: HEAD }],
    ];
    for (const [answers, place, refusal] of cases) {
      const { made, last } = writer(poller(answers, pending));
      expect(await made.send('t1', place, 'Kept.', 'review')).toEqual({ kind: 'refused', refusal });
      expect(last()).toMatchObject([{ text: 'Kept.', sending: null, sent: null }]);
    }
  });

  test('nobody, and a run of layers, are refused before anything is sent', async () => {
    const fake = poller([]);
    const nobody = writer(fake, info({ acting: { kind: 'anonymous' } }));
    expect(await nobody.made.send('t1', onLine(), 'x', 'review')).toEqual({
      kind: 'refused',
      refusal: { kind: 'signIn' },
    });
    expect(() => nobody.made.save('t1', onLine(), 'x')).toThrow('Sign in to comment.');
    const run = writer(fake, info({ run: [82, 83] }));
    expect(await run.made.send('t1', onLine(), 'x', 'review')).toEqual({
      kind: 'refused',
      refusal: { kind: 'run' },
    });
    expect(fake.sent).toEqual([]);
  });
});

/** An error whose answer was lost: the write may have posted. */
function lost(): GithubError {
  return new GithubError({ kind: 'network', failure: 'lost', message: 'reset' });
}

describe('a lost answer', () => {
  test('is looked for with a read made the wait after it was sent, which finds what came late', async () => {
    vi.useFakeTimers();
    const fake = poller([lost()]);
    const { made, last } = writer(fake);
    const sentAt = Date.now();
    expect(await made.send('t1', onLine(), 'Lost?', 'review')).toEqual({ kind: 'lost' });
    expect(last()).toMatchObject([{ sending: 'checking', sent: 'Lost?' }]);
    // GitHub stores it a while after; nothing is read before the wait.
    await vi.advanceTimersByTimeAsync(5_000);
    fake.threads.now = { nodes: [node('src/backoff.ts', 'Lost?\n')], missing: 0 };
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fake.readAt).toEqual([]);
    expect(last()).toMatchObject([{ sending: 'checking' }]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fake.readAt).toEqual([sentAt + 10_000]);
    expect(last()).toEqual([]);
    expect(fake.sent).toHaveLength(1);
  });

  test('says it didn’t post when it isn’t there; offline, keeps checking; refused, says Lo can’t tell', async () => {
    vi.useFakeTimers();
    const missing = poller([lost()]);
    const notThere = writer(missing);
    await notThere.made.send('t1', onLine(), 'Lost?', 'review');
    missing.threads.now = { nodes: [node('src/backoff.ts', 'Something else')], missing: 0 };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(notThere.last()).toMatchObject([{ sending: 'notPosted', sent: null, text: 'Lost?' }]);
    // Offline, the read can't be made: it's still being checked, and Lo looks again in a while.
    const away = poller([lost()]);
    const offline = writer(away);
    await offline.made.send('t1', onLine(), 'Lost?', 'review');
    away.threads.now = new GithubError({ kind: 'network', failure: 'offline', message: 'down' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(away.readAt).toHaveLength(1);
    expect(offline.last()).toMatchObject([{ sending: 'checking', sent: 'Lost?' }]);
    away.threads.now = { nodes: [node('src/backoff.ts', 'Lost?')], missing: 0 };
    await vi.advanceTimersByTimeAsync(30_000);
    expect(away.readAt).toHaveLength(2);
    expect(offline.last()).toEqual([]);
    // Refused, as when the pull request can't be read, Lo can't tell, and says so.
    const refusing = poller([lost()]);
    const unknown = writer(refusing);
    await unknown.made.send('t1', onLine(), 'Lost?', 'review');
    refusing.threads.now = new GithubError({ kind: 'notFound', message: 'gone' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(unknown.last()).toMatchObject([{ sending: 'unknown', sent: 'Lost?' }]);
    // Nothing was sent again; the reader may send it anyway.
    expect([...missing.sent, ...away.sent, ...refusing.sent]).toHaveLength(3);
  });

  test('is judged by GitHub’s clock, whatever this computer’s says', async () => {
    vi.useFakeTimers();
    const fake = poller([lost()]);
    const { made, last } = writer(fake);
    // This computer's clock is five minutes fast.
    fake.threads.ahead = -5 * 60_000;
    const sentAt = Date.now();
    await made.send('t1', onLine(), 'Lost?', 'review');
    const madeThere = new Date(sentAt - 5 * 60_000 + 1_000).toISOString();
    fake.threads.now = { nodes: [node('src/backoff.ts', 'Lost?', false, madeThere)], missing: 0 };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(last()).toEqual([]);
  });

  test('one lost before a restart is checked, and can’t be sent, until Lo’s own read settles it', async () => {
    vi.useFakeTimers();
    const database = fresh();
    const before = writer(poller([lost()]), info(), database);
    const sentAt = Date.now();
    expect(await before.made.send('t1', onLine(), 'Lost?', 'review')).toEqual({ kind: 'lost' });
    before.made.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    const fake = poller([]);
    fake.threads.now = { nodes: [node('src/backoff.ts', 'Something else')], missing: 0 };
    // Its view isn't on screen, nor its threads read: Lo looks for it anyway.
    const { last, drafts } = writer(fake, info({ id: 'other' }), database);
    const shown = writer(poller([]), info(), database);
    expect(shown.last()).toMatchObject([{ restored: true, sending: 'checking', sent: 'Lost?' }]);
    expect(await shown.made.send('t1', onLine(), 'Lost?', 'review')).toEqual({
      kind: 'refused',
      refusal: { kind: 'github', message: 'Lo is still looking whether it posted.' },
    });
    shown.made.stop();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(fake.readAt).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fake.readAt).toEqual([sentAt + 10_000]);
    expect(drafts.get('rozed-bot', PULL, onLine())).toMatchObject({ text: 'Lost?', sent: null });
    expect(last()).toMatchObject([{ sending: 'notPosted' }]);
  });

  test('discarded while Lo checks, it’s gone, and what Lo finds brings nothing back', async () => {
    vi.useFakeTimers();
    const fake = poller([lost()]);
    const { made, last, database } = writer(fake);
    await made.send('t1', onLine(), 'Lost?', 'review');
    expect(last()).toMatchObject([{ sending: 'checking' }]);
    made.discard('t1', onLine());
    expect(last()).toEqual([]);
    fake.threads.now = { nodes: [node('src/backoff.ts', 'Something else')], missing: 0 };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake.readAt).toEqual([]);
    expect(last()).toEqual([]);
    expect(new DraftStore(database).of('rozed-bot', PULL)).toEqual([]);
  });
});

test('a comment is found by its file, lines, author and text, made since it was sent', () => {
  const sentAt = Date.parse('2026-11-13T12:00:00Z');
  const made = '2026-11-13T12:00:01Z';
  const rows = threadRowsOf({
    nodes: [node('src/backoff.ts', 'Text\r\n', false, made)],
    missing: 0,
  });
  expect(holdsComment(rows, 'Rozed-Bot', onLine(), 'Text', sentAt)).toBe(true);
  expect(holdsComment(rows, 'someone', onLine(), 'Text', sentAt)).toBe(false);
  expect(
    holdsComment(rows, 'rozed-bot', { ...onLine(), path: 'src/other.ts' }, 'Text', sentAt),
  ).toBe(false);
  const nine = { ...onLine(), lines: { start: null, end: { side: 'RIGHT' as const, number: 9 } } };
  expect(holdsComment(rows, 'rozed-bot', nine, 'Text', sentAt)).toBe(false);
  const range = {
    ...onLine(),
    lines: {
      start: { side: 'RIGHT' as const, number: 3 },
      end: { side: 'RIGHT' as const, number: 5 },
    },
  };
  expect(holdsComment(rows, 'rozed-bot', range, 'Text', sentAt)).toBe(false);
  // The same text, written well before it was sent, is another comment.
  expect(holdsComment(rows, 'rozed-bot', onLine(), 'Text', sentAt + 10 * 60_000)).toBe(false);
});
