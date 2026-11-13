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

/** A thread on `path`'s new line 5, or on the file, with rozed-bot's comment `body`. */
function node(path: string, body: string, file = false): ReviewThread {
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
          createdAt: '2026-11-13T12:00:00Z',
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

/** An account's poller that answers each write with the next of `answers`. */
function poller(
  answers: Answer[],
  pending: PendingReviewRead = { kind: 'read', review: undefined },
) {
  const listeners = new Set<(event: PollEvent) => void>();
  const sent: ReviewWrite[] = [];
  let since: ReturnType<WriterPoller['readSince']> = { kind: 'waiting' };
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
    readAfresh: (): ReadMark => ({ read: 1, generation: 2 }),
    readSince: () => since,
    onEvent(listener: (event: PollEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only these are read.
    poller: fake as unknown as WriterPoller,
    sent,
    /** The threads read again after the mark, as the poller tells it. */
    reads(threads: ReviewThreadList): void {
      since = { kind: 'read', read: { value: threads, fetchedAt: Date.now() } };
      for (const listener of listeners) {
        listener({ kind: 'read', pull: PULL, name: 'ReviewThreads' });
      }
    },
    failsToRead(): void {
      for (const listener of listeners) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- its error isn't read.
        listener({ kind: 'readFailed', pull: PULL, name: 'ReviewThreads' } as unknown as PollEvent);
      }
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

  test('one write to a pull request goes at a time: the next waits for its answer', async () => {
    let answer!: (sent: Sent) => void;
    const first = new Promise<Sent>((resolve) => {
      answer = resolve;
    });
    const fake = poller([first, { review: 'PRR_1', comment: 'C_2' }]);
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
    await Promise.all([one, two]);
    expect(fake.sent).toHaveLength(2);
    expect(last()).toEqual([]);
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
  test('marks the draft sent, and once the threads are read again, finds it and lets it go', async () => {
    vi.useFakeTimers();
    const fake = poller([lost()]);
    const { made, last } = writer(fake);
    expect(await made.send('t1', onLine(), 'Lost?', 'review')).toEqual({ kind: 'lost' });
    expect(last()).toMatchObject([{ sending: 'checking', sent: 'Lost?' }]);
    // Not before the wait, whatever's read.
    await vi.advanceTimersByTimeAsync(9_000);
    expect(last()).toMatchObject([{ sending: 'checking' }]);
    await vi.advanceTimersByTimeAsync(1_000);
    fake.reads({ nodes: [node('src/backoff.ts', 'Lost?\n')], missing: 0 });
    await vi.waitFor(() => expect(last()).toEqual([]));
    expect(fake.sent).toHaveLength(1);
  });

  test('says it didn’t post when it isn’t there, and that Lo can’t tell when the read fails', async () => {
    vi.useFakeTimers();
    const missing = poller([lost()]);
    const notThere = writer(missing);
    await notThere.made.send('t1', onLine(), 'Lost?', 'review');
    await vi.advanceTimersByTimeAsync(10_000);
    missing.reads({ nodes: [node('src/backoff.ts', 'Something else')], missing: 0 });
    await vi.waitFor(() =>
      expect(notThere.last()).toMatchObject([{ sending: 'notPosted', sent: null, text: 'Lost?' }]),
    );
    const failing = poller([lost()]);
    const unknown = writer(failing);
    await unknown.made.send('t1', onLine(), 'Lost?', 'review');
    await vi.advanceTimersByTimeAsync(10_000);
    failing.failsToRead();
    await vi.waitFor(() =>
      expect(unknown.last()).toMatchObject([{ sending: 'unknown', sent: 'Lost?' }]),
    );
    // Nothing was sent again; the reader may send it anyway.
    expect([...missing.sent, ...failing.sent]).toHaveLength(2);
  });

  test('one lost before Lo started settles against a read made after it', () => {
    const database = fresh();
    new DraftStore(database, () => 1_000).save('rozed-bot', PULL, ON_FILE, 'Lost before.');
    const before = new DraftStore(database);
    before.markSent('rozed-bot', PULL, ON_FILE, 'Lost before.');
    const { made, last } = writer(poller([]), info(), database);
    expect(last()).toMatchObject([{ restored: true, sent: 'Lost before.' }]);
    const thread = { nodes: [node('docs/usage.md', 'Lost before.', true)], missing: 0 };
    const rows = threadRowsOf(thread);
    // A read older than the send, as from the poll cache, says nothing.
    made.threadsRead('t1', rows, 5_000);
    expect(last()).toHaveLength(1);
    made.threadsRead('t1', rows, 20_000);
    expect(last()).toEqual([]);
  });
});

test('a comment is found by its file, lines, author and text', () => {
  const rows = threadRowsOf({ nodes: [node('src/backoff.ts', 'Text\r\n')], missing: 0 });
  expect(holdsComment(rows, 'Rozed-Bot', onLine(), 'Text')).toBe(true);
  expect(holdsComment(rows, 'someone', onLine(), 'Text')).toBe(false);
  expect(holdsComment(rows, 'rozed-bot', { ...onLine(), path: 'src/other.ts' }, 'Text')).toBe(
    false,
  );
  const nine = { ...onLine(), lines: { start: null, end: { side: 'RIGHT' as const, number: 9 } } };
  expect(holdsComment(rows, 'rozed-bot', nine, 'Text')).toBe(false);
});
