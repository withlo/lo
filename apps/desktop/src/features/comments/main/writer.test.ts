import {
  GithubError,
  type PendingReviewRead,
  type PollEvent,
  type PullRequestTimeline,
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
import type {
  DraftHomeRow,
  DraftPlaceRow,
  DraftsView,
  JoinedView,
  ThreadPlaceRow,
} from '../contract.ts';
import { holdsPullComment } from './conversation.ts';
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
function onLine(commit = HEAD): ThreadPlaceRow {
  return {
    kind: 'thread',
    commit,
    path: 'src/backoff.ts',
    lines: { start: null, end: { side: 'RIGHT', number: 5 } },
  };
}

const ON_FILE: ThreadPlaceRow = {
  kind: 'thread',
  commit: HEAD,
  path: 'docs/usage.md',
  lines: null,
};

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

type Answer = Sent | ReviewWriteRefusal | Error | Promise<Sent | ReviewWriteRefusal> | string;

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
  /** What was posted on the pull request itself, in order. */
  const posted: string[] = [];
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
  /**
   * The pull request's timeline, as a read of it made now gets it; what the poller has of it from
   * before, as an earlier run of Lo kept, which it answers at once; whether it keeps it, as for a
   * view that shows it; and how many times it was asked for outright.
   */
  const timeline = {
    items: [] as PullRequestTimeline['items'],
    cached: [] as PullRequestTimeline['items'],
    kept: false,
    reads: 0,
  };
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
    addConversationComment(_pull: PullRef, pullRequestId: string, body: string) {
      posted.push(`${pullRequestId}: ${body}`);
      const answer = answers.shift();
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer === undefined) throw new Error('No answer left.');
      return Promise.resolve(answer);
    },
    timeline() {
      // What it had, from before; kept from now, and read again as the poller reads.
      timeline.reads += 1;
      timeline.kept = true;
      return Promise.resolve({ value: { items: timeline.cached }, fetchedAt: 0 });
    },
    readAfresh(_pull: PullRef, kind: { name: string }): ReadMark | undefined {
      // A read the poller doesn't keep has nothing to mark.
      if (kind.name === 'Timeline' && !timeline.kept) return undefined;
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
    posted,
    afresh,
    threads,
    readAt,
    timeline,
    /** The timeline the poller keeps read again after the mark, as the poller tells it. */
    timelineRead(): void {
      const value = { items: timeline.items };
      since.set('Timeline', { kind: 'read', read: { value, fetchedAt: Date.now() } });
      told('Timeline');
    },
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
  /** The comments said to have joined your pending review, with how many drafts were left then. */
  const joined: { view: JoinedView; drafts: number }[] = [];
  const drafts = new DraftStore(database);
  const made = new Writer({
    poller: () => Promise.resolve(fake.poller),
    view: (id) => (id === view.id ? view : undefined),
    drafts,
    publish: (each) => published.push(each),
    publishJoined: (each) =>
      joined.push({ view: each, drafts: published.at(-1)?.drafts.length ?? 0 }),
    log: () => {},
    settleAfter: 10_000,
    readWait: 60_000,
  });
  made.follow(view.id);
  const last = () => published.at(-1)?.drafts ?? [];
  return { made, drafts, published, last, database, joined };
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

  test('⌥⏎ on a reply, with a pending review Lo hadn’t read, says GitHub added it to the review', async () => {
    const unread: PendingReviewRead = { kind: 'unknown', why: 'not read since' };
    /** A poller that has read no threads, and cannot say whether you have a pending review. */
    const reading = (answers: Answer[]) => {
      const fake = poller(answers, unread);
      Reflect.set(fake.poller, 'cachedRead', (_pull: PullRef, kind: { name: string }) =>
        kind.name === 'PendingReview' ? { value: unread, fetchedAt: 0 } : undefined,
      );
      return fake;
    };
    const quietly = reading([{ review: 'PRR_1', comment: 'C_4', joinedPending: 'PRR_1' }]);
    const place: DraftPlaceRow = { kind: 'reply', thread: 'T_1' };
    expect(await writer(quietly).made.send('t1', place, 'Now.', 'now')).toMatchObject({
      kind: 'sent',
      pending: true,
      joined: true,
    });
    expect(quietly.sent.map((write) => write.kind)).toEqual(['postReply']);
    // Posted at once, as GitHub says, it's no word about a review.
    const alone = reading([{ review: 'PRR_5', comment: 'C_5' }]);
    expect(await writer(alone).made.send('t1', place, 'Now.', 'now')).toMatchObject({
      kind: 'sent',
      pending: false,
      joined: false,
    });
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

  test('a comment on the pull request posts at once, in its conversation, joining no review', async () => {
    const pending = {
      kind: 'read',
      review: { id: 'PRR_1', commit: { oid: HEAD }, comments: { totalCount: 1 } },
    } as PendingReviewRead;
    const fake = poller(['IC_1'], pending);
    const { made, last } = writer(fake);
    const onPull: DraftPlaceRow = { kind: 'conversation' };
    made.save('t1', onPull, 'Looks right to me.');
    expect(last()).toMatchObject([{ place: onPull, text: 'Looks right to me.' }]);
    expect(await made.send('t1', onPull, 'Looks right to me.', 'now')).toEqual({
      kind: 'sent',
      pending: false,
      joined: false,
      thread: null,
      landedOn: null,
    });
    expect(fake.posted).toEqual(['PR_94: Looks right to me.']);
    expect(fake.sent).toEqual([]);
    expect(last()).toEqual([]);
    // Refused, it keeps the draft, in the box's words.
    const refused = poller([{ refusal: 'paused', until: 1234 }]);
    const kept = writer(refused);
    expect(await kept.made.send('t1', onPull, 'Kept.', 'now')).toEqual({
      kind: 'refused',
      refusal: { kind: 'paused', until: 1234 },
    });
    expect(kept.last()).toMatchObject([{ text: 'Kept.', sending: null, sent: null }]);
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

/** A code block of the overview at `OLDER`, on `src/backoff.ts`'s lines 3 to 9, written from its line 5. */
const BLOCK: DraftHomeRow = {
  commit: OLDER,
  path: 'src/backoff.ts',
  block: { start: 3, end: 9 },
  at: { side: 'new', from: 5, to: 5 },
  why: 'changed',
  head: HEAD,
};

describe('a draft written from a code block', () => {
  test('keeps the block as its home, whatever its place, after a restart', () => {
    const database = fresh();
    const before = writer(poller([]), info(), database);
    const onPull: DraftPlaceRow = { kind: 'conversation' };
    before.made.save('t1', onLine(), 'On the line.', BLOCK);
    before.made.save('t1', ON_FILE, 'On the file.', BLOCK);
    before.made.save('t1', onPull, 'On the pull request.', BLOCK);
    before.made.save('t1', onLine(OLDER), 'In the diff.', null);
    before.made.stop();
    const after = writer(poller([]), info(), database);
    expect(after.last()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ place: onLine(), home: BLOCK, restored: true }),
        expect.objectContaining({ place: ON_FILE, home: BLOCK, restored: true }),
        expect.objectContaining({ place: onPull, home: BLOCK, restored: true }),
        expect.objectContaining({ place: onLine(OLDER), home: null, restored: true }),
      ]),
    );
    expect(after.last()).toHaveLength(4);
    // Saved with no home given, it keeps the one it has; moved to the diff, it has none.
    after.made.save('t1', onLine(), 'On the line, still.');
    expect(after.drafts.get('rozed-bot', PULL, onLine())).toMatchObject({ home: BLOCK });
    after.made.save('t1', onLine(), 'On the line, still.', null);
    expect(after.drafts.get('rozed-bot', PULL, onLine())).toMatchObject({ home: null });
  });
});

/** A second from now, as GitHub says when something was made. */
function aMomentOn(): string {
  return new Date(Date.now() + 1_000).toISOString();
}

/** An error whose answer was lost: the write may have posted. */
function lost(): GithubError {
  return new GithubError({ kind: 'network', failure: 'lost', message: 'reset' });
}

/** A reply in the thread `node` makes for src/backoff.ts. */
const REPLY: DraftPlaceRow = { kind: 'reply', thread: 'T_src/backoff.ts' };

/** A poller that has read no threads, so a reply is sent on GitHub's word that it may be. */
function replying(answers: Answer[]) {
  const fake = poller(answers);
  const none: PendingReviewRead = { kind: 'read', review: undefined };
  Reflect.set(fake.poller, 'cachedRead', (_pull: PullRef, kind: { name: string }) =>
    kind.name === 'PendingReview' ? { value: none, fetchedAt: 0 } : undefined,
  );
  return fake;
}

/** The thread with the comment `body`, as GitHub holds it once it's submitted, not pending. */
function submitted(body: string) {
  const thread = node('src/backoff.ts', body);
  for (const comment of thread.comments.nodes ?? []) {
    if (comment) comment.state = 'SUBMITTED';
  }
  return thread;
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

  describe('found in your pending review', () => {
    test('says a REPLY sent to post at once joined it, as its answer would have, before its draft goes', async () => {
      vi.useFakeTimers();
      const fake = replying([lost()]);
      const { made, last, joined } = writer(fake);
      expect(await made.send('t1', REPLY, 'Lost?', 'now')).toEqual({ kind: 'lost' });
      // GitHub added it to the review, quietly, and the read finds it pending.
      fake.threads.now = { nodes: [node('src/backoff.ts', 'Lost?')], missing: 0 };
      await vi.advanceTimersByTimeAsync(10_000);
      expect(joined).toEqual([{ view: { id: 't1', place: REPLY }, drafts: 1 }]);
      expect(last()).toEqual([]);
    });

    test('says nothing of a comment added to the review as asked, or one that posted alone', async () => {
      vi.useFakeTimers();
      const asked = replying([lost()]);
      const adding = writer(asked);
      await adding.made.send('t1', REPLY, 'Lost?', 'review');
      asked.threads.now = { nodes: [node('src/backoff.ts', 'Lost?')], missing: 0 };
      await vi.advanceTimersByTimeAsync(10_000);
      expect(adding.last()).toEqual([]);
      expect(adding.joined).toEqual([]);
      const alone = replying([lost()]);
      const posting = writer(alone);
      await posting.made.send('t1', REPLY, 'Lost?', 'now');
      alone.threads.now = { nodes: [submitted('Lost?')], missing: 0 };
      await vi.advanceTimersByTimeAsync(10_000);
      expect(posting.last()).toEqual([]);
      expect(posting.joined).toEqual([]);
    });

    test('says nothing of one that never posted, nor, with no word of how it was sent, one lost before a restart', async () => {
      vi.useFakeTimers();
      const missing = replying([lost()]);
      const none = writer(missing);
      await none.made.send('t1', REPLY, 'Lost?', 'now');
      missing.threads.now = { nodes: [node('src/backoff.ts', 'Something else')], missing: 0 };
      await vi.advanceTimersByTimeAsync(10_000);
      expect(none.joined).toEqual([]);
      const database = fresh();
      await writer(replying([lost()]), info(), database).made.send('t1', REPLY, 'Lost?', 'now');
      const after = replying([]);
      after.threads.now = { nodes: [node('src/backoff.ts', 'Lost?')], missing: 0 };
      const restarted = writer(after, info(), database);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(restarted.last()).toEqual([]);
      expect(restarted.joined).toEqual([]);
    });
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

  test('on the pull request, is looked for in a read of its timeline made after the wait, never one kept from before', async () => {
    vi.useFakeTimers();
    const onPull: DraftPlaceRow = { kind: 'conversation' };
    // Where the poller doesn't keep the timeline, what it had from before says nothing: it keeps it
    // from now, and what it reads next settles it.
    const found = poller([lost()]);
    const posted = writer(found);
    expect(await posted.made.send('t1', onPull, 'Lost?', 'now')).toEqual({ kind: 'lost' });
    found.timeline.items = [pullComment('rozed-bot', 'Lost?', aMomentOn())];
    await vi.advanceTimersByTimeAsync(10_000);
    expect(found.timeline.reads).toBe(1);
    expect(posted.last()).toMatchObject([{ sending: 'checking', sent: 'Lost?' }]);
    found.timelineRead();
    await vi.advanceTimersByTimeAsync(0);
    expect(posted.last()).toEqual([]);
    // Where it keeps it, it's read again from then, only its newest page, and nothing more.
    const missing = poller([lost()]);
    missing.timeline.kept = true;
    const notPosted = writer(missing);
    await notPosted.made.send('t1', onPull, 'Lost?', 'now');
    missing.timeline.items = [pullComment('rozed-bot', 'Something else', aMomentOn())];
    await vi.advanceTimersByTimeAsync(10_000);
    expect(missing.afresh).toContain('Timeline');
    expect(notPosted.last()).toMatchObject([{ sending: 'checking' }]);
    missing.timelineRead();
    await vi.advanceTimersByTimeAsync(0);
    expect(missing.timeline.reads).toBe(0);
    expect(notPosted.last()).toMatchObject([{ sending: 'notPosted', sent: null, text: 'Lost?' }]);
    expect([...found.posted, ...missing.posted]).toHaveLength(2);
  });

  test.each([
    ['found, the draft goes', 'Lost?', []],
    [
      'not found, it stays, kept with its block',
      'Something else',
      [expect.objectContaining({ sending: 'notPosted', text: 'Lost?', sent: null, home: BLOCK })],
    ],
  ])(
    'on the pull request, lost before a restart, is looked for after it: %s',
    async (_, body, after) => {
      vi.useFakeTimers();
      const onPull: DraftPlaceRow = { kind: 'conversation' };
      const database = fresh();
      const before = writer(poller([lost()]), info(), database);
      before.made.save('t1', onPull, 'Lost?', BLOCK);
      expect(await before.made.send('t1', onPull, 'Lost?', 'now')).toEqual({ kind: 'lost' });
      before.made.stop();
      // The poller has the timeline an earlier run kept, from before the write.
      const fake = poller([]);
      fake.timeline.cached = [pullComment('rozed-bot', 'Older', '2026-01-01T00:00:00Z')];
      fake.timeline.items = [pullComment('rozed-bot', body, aMomentOn())];
      const { last } = writer(fake, info(), database);
      expect(last()).toMatchObject([{ restored: true, sending: 'checking', home: BLOCK }]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(last()).toMatchObject([{ sending: 'checking' }]);
      fake.timelineRead();
      await vi.advanceTimersByTimeAsync(0);
      expect(last()).toEqual(after);
    },
  );

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

/** `login`'s comment `body` on the pull request itself, made at `createdAt`, as the timeline has it. */
function pullComment(login: string, body: string, createdAt = '2026-11-13T12:00:01Z') {
  return {
    cursor: createdAt,
    item: {
      kind: 'comment' as const,
      comment: {
        id: 'IC_1',
        author: { login, type: 'User' as const },
        body,
        createdAt,
        lastEditedAt: undefined,
        url: 'https://github.com/rozed-dev/e2e/pull/94#issuecomment-1',
        hidden: undefined,
        viewerCanUpdate: true,
        viewerCanDelete: true,
      },
    },
  };
}

test('a comment on the pull request is found by its author and text, made since it was sent', () => {
  const sentAt = Date.parse('2026-11-13T12:00:00Z');
  const timeline = { items: [pullComment('rozed-bot', 'Looks right.\r\n')] };
  expect(holdsPullComment(timeline, 'Rozed-Bot', 'Looks right.', sentAt, 5_000)).toBe(true);
  expect(holdsPullComment(timeline, 'someone', 'Looks right.', sentAt, 5_000)).toBe(false);
  expect(holdsPullComment(timeline, 'rozed-bot', 'Other.', sentAt, 5_000)).toBe(false);
  // Made well before it was sent, beyond the clocks' slack: another comment.
  expect(holdsPullComment(timeline, 'rozed-bot', 'Looks right.', sentAt + 60_000, 5_000)).toBe(
    false,
  );
});
