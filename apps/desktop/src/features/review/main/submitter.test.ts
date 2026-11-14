import {
  GithubError,
  PullRef,
  type PendingReviewRead,
  type ReviewWrite,
  type ReviewWriteRefusal,
  type Sent,
} from '@lo/github';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { ThreadRow } from '../../comments/contract.ts';
import type { DraftsService, ReviewsService, SummaryDraft } from '../../comments/service.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { Submission } from '../contract.ts';
import {
  pendingComments,
  type ReviewNode,
  type ReviewsRead,
  submittedAmong,
  Submitter,
  type SubmitPoller,
} from './submitter.ts';

const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);
const PULL = new PullRef('rozed-dev', 'e2e', 94);

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

/** Your pending review, with `comments` on `commit`. */
function pendingOn(commit: string, comments = 2): PendingReviewRead {
  return {
    kind: 'read',
    review: { id: 'PRR_1', commit: { oid: commit }, comments: { totalCount: comments } },
  };
}

const NONE: PendingReviewRead = { kind: 'read', review: undefined };

type Answer = Sent | ReviewWriteRefusal | Error;

/** A lost answer: GitHub may have done it. */
function lost(): GithubError {
  return new GithubError({ kind: 'network', failure: 'lost', message: 'reset' });
}

interface Setup {
  /** Who opened the pull request: someone else, unless it says. */
  author?: string;
  pending?: PendingReviewRead;
  answers?: Answer[];
  /** What each read of your reviews gets, in turn; the last repeats. */
  reads?: (ReviewsRead | Error)[];
  view?: PullTabInfo;
  threads?: ThreadRow[];
  /** The summaries kept on this computer, as the database keeps them through a restart. */
  kept?: Map<string, SummaryDraft>;
}

function setup({
  author = 'mira-chen',
  pending = NONE,
  answers = [],
  reads = [{ reviews: [], ahead: 0 }],
  view = info(),
  threads = [],
  kept = new Map(),
}: Setup = {}) {
  const sent: ReviewWrite[] = [];
  const published: Submission[] = [];
  /** When each read of your reviews was made, by this computer's clock. */
  const readAt: number[] = [];
  const fake = {
    pullRequest: () => ({
      details: { id: 'PR_94', headRefOid: HEAD, author: { login: author } },
    }),
    cachedRead: () => ({ value: pending, fetchedAt: 0 }),
    pendingReview: () => Promise.resolve({ value: pending, fetchedAt: 0 }),
    writesHeldUntil: () => undefined,
  };
  const reviews: ReviewsService = {
    current: () => ({
      threads: {
        id: 't1',
        status: 'ready',
        threads,
        missing: 0,
        compared: null,
        problem: null,
      },
      review: undefined,
    }),
    inTurn: (_id, write) =>
      write({
        login: 'rozed-bot',
        pull: PULL,
        review: pending,
        send(each) {
          sent.push(each);
          const answer = answers.shift();
          if (answer === undefined) return Promise.reject(new Error('No answer left.'));
          return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
        },
      }),
  };
  const drafts = summaryDrafts(kept);
  const made = new Submitter({
    view: (id) => (id === view.id ? view : undefined),
    onScreen: () => view.shown,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only these are read.
    poller: () => Promise.resolve(fake as unknown as SubmitPoller),
    reviews,
    drafts,
    readReviews() {
      readAt.push(Date.now());
      const next = reads.length > 1 ? reads.shift() : reads[0];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next!);
    },
    publish: (each) => published.push(each),
    log: () => {},
    settleAfter: 10_000,
    retryAfter: 30_000,
  });
  made.follow(view.id);
  const summary = () => drafts.summary('rozed-bot', PULL);
  const state = () => published.at(-1)?.state ?? null;
  return { made, sent, published, readAt, summary, state };
}

/** What a summary is kept by. */
function key(login: string, pull: PullRef): string {
  return `${login}|${pull.key}`;
}

/**
 * The comments feature's summaries, kept in `kept` as its drafts keep them: blank text removes
 * one unless it's marked sent, and one kept before is restored.
 */
function summaryDrafts(kept: Map<string, SummaryDraft>): DraftsService {
  for (const [each, draft] of kept) kept.set(each, { ...draft, restored: true });
  return {
    summary: (login, pull) => kept.get(key(login, pull)),
    saveSummary(login, pull, text) {
      const was = kept.get(key(login, pull));
      if (text.trim() === '' && (was?.sent ?? null) === null) {
        kept.delete(key(login, pull));
        return;
      }
      kept.set(key(login, pull), {
        text,
        savedAt: Date.now(),
        restored: false,
        sent: was?.sent ?? null,
        sentAt: was?.sentAt ?? null,
      });
    },
    markSummarySent(login, pull, sent, at) {
      const was = kept.get(key(login, pull));
      const draft = was ?? { text: sent ?? '', savedAt: at, restored: false };
      if (!was && sent === null) return;
      kept.set(key(login, pull), {
        ...draft,
        sent,
        sentAt: sent === null ? null : at,
      });
    },
    takeSummary(login, pull) {
      kept.delete(key(login, pull));
    },
    markedSummaries: () =>
      [...kept.values()].flatMap((summary) =>
        summary.sent === null ? [] : [{ login: 'rozed-bot', pull: PULL, summary }],
      ),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

/** A comment in a thread, by rozed-bot unless it says. */
function comment(body: string, state: 'PENDING' | 'SUBMITTED', author = 'rozed-bot') {
  return {
    id: `C_${body}`,
    author,
    authorType: 'User',
    body,
    state,
    createdAt: '2026-11-13T10:00:00Z',
    url: 'https://github.com/rozed-dev/e2e/pull/94#discussion_r1',
    hidden: null,
    viewerCanUpdate: true,
    viewerCanDelete: true,
  };
}

/** A thread on the old side of `path`, at `line`, or on the file. */
function thread(path: string, line: number | null, comments: ThreadRow['comments']): ThreadRow {
  return {
    id: `T_${path}`,
    path,
    subject: line === null ? 'FILE' : 'LINE',
    side: 'LEFT',
    startSide: null,
    line,
    startLine: null,
    originalLine: line,
    originalStartLine: null,
    outdated: false,
    resolved: false,
    currentOn: null,
    writtenOn: null,
    comments,
    viewerCanReply: true,
    viewerCanResolve: true,
    viewerCanUnresolve: false,
  };
}

describe('the dialog', () => {
  test('says what it reviews, and lists your pending comments with where and their opening', async () => {
    const threads = [
      thread('src/rate-limit.ts', 30, [
        comment('Why not a retry?', 'SUBMITTED', 'mira-chen'),
        comment('Thanks, linked is fine.', 'PENDING'),
      ]),
      thread('config/limits.yaml', null, [
        comment('\n```suggestion\nlimit: 2000\n```\nOr 2,000?', 'PENDING'),
      ]),
    ];
    const { made } = setup({ pending: pendingOn(HEAD), threads, author: 'Rozed-Bot' });
    await expect(made.dialog('t1')).resolves.toMatchObject({
      login: 'rozed-bot',
      repo: 'e2e',
      number: 94,
      own: true,
      on: HEAD,
      head: HEAD,
      pending: { kind: 'pending', id: 'PRR_1', commit: HEAD, comments: 2 },
      comments: [
        { file: 'rate-limit.ts', line: 'old 30', reply: true, opening: 'Thanks, linked is fine.' },
        { file: 'limits.yaml', line: null, reply: false, opening: 'limit: 2000' },
      ],
      summary: null,
      submitting: null,
    });
    expect(pendingComments(threads, 'mira-chen')).toEqual([]);
  });

  test('a view acting as nobody, or a run of layers, can’t open it', async () => {
    await expect(
      setup({ view: info({ acting: { kind: 'anonymous' } }) }).made.dialog('t1'),
    ).rejects.toThrow('Sign in to submit a review');
    await expect(setup({ view: info({ run: [82, 83] }) }).made.dialog('t1')).rejects.toThrow(
      'Submit a review in a layer',
    );
  });
});

describe('submitting', () => {
  test('your pending review goes with the verdict and summary, and the summary goes', async () => {
    const { made, sent, summary, published } = setup({
      pending: pendingOn(HEAD),
      answers: [{ review: 'PRR_1' }],
    });
    made.draft('t1', 'Two small things inline.');
    expect(summary()?.text).toBe('Two small things inline.');
    const outcome = await made.submit('t1', 'APPROVE', 'Two small things inline.', false);
    expect(outcome).toEqual({ kind: 'submitted', event: 'APPROVE' });
    expect(sent).toEqual([
      {
        kind: 'submitReview',
        head: HEAD,
        variables: {
          pullRequestReviewId: 'PRR_1',
          event: 'APPROVE',
          body: 'Two small things inline.',
        },
      },
    ]);
    expect(summary()).toBeUndefined();
    expect(published.at(-1)).toEqual({
      id: 't1',
      number: 94,
      state: null,
      submitted: { event: 'APPROVE' },
    });
  });

  test('with no pending review, a review of the revision on screen goes, with no comments', async () => {
    const { made, sent } = setup({ answers: [{ review: 'PRR_2' }] });
    await made.submit('t1', 'COMMENT', 'Reads well.', false);
    expect(sent).toEqual([
      {
        kind: 'review',
        head: HEAD,
        variables: {
          pullRequestId: 'PR_94',
          commitOID: HEAD,
          event: 'COMMENT',
          body: 'Reads well.',
          threads: undefined,
        },
      },
    ]);
  });

  test('what can’t go is refused before anything is sent, and the summary stays', async () => {
    const other = setup({ pending: pendingOn(OLDER) });
    await expect(other.made.submit('t1', 'APPROVE', 'Fine', false)).resolves.toEqual({
      kind: 'refused',
      refusal: { kind: 'otherRevision', reviewOn: OLDER },
    });
    expect(other.sent).toEqual([]);
    expect(other.summary()).toMatchObject({ text: 'Fine', sent: null });
    const nothing = setup();
    await expect(nothing.made.submit('t1', 'COMMENT', ' ', false)).resolves.toEqual({
      kind: 'refused',
      refusal: { kind: 'nothingToSubmit' },
    });
    const own = setup({ author: 'rozed-bot' });
    await expect(own.made.submit('t1', 'APPROVE', 'Mine', false)).resolves.toEqual({
      kind: 'refused',
      refusal: { kind: 'ownPullRequest' },
    });
    const unknown = setup({ pending: { kind: 'unknown', why: 'left out' } });
    await expect(unknown.made.submit('t1', 'COMMENT', 'Hm', false)).resolves.toEqual({
      kind: 'refused',
      refusal: { kind: 'pendingUnknown' },
    });
    const run = setup({ view: info({ run: [82, 83] }) });
    await expect(run.made.submit('t1', 'COMMENT', 'Hm', false)).resolves.toEqual({
      kind: 'refused',
      refusal: { kind: 'run' },
    });
    const nobody = setup({ view: info({ acting: { kind: 'anonymous' } }) });
    await expect(nobody.made.submit('t1', 'COMMENT', 'Hm', false)).resolves.toEqual({
      kind: 'refused',
      refusal: { kind: 'signIn' },
    });
  });

  test('GitHub’s refusals are in the core’s words, a pause with its time, and the summary stays', async () => {
    const { made, summary } = setup({
      pending: pendingOn(HEAD),
      answers: [{ refusal: 'gone' }, { refusal: 'paused', until: 1_000 }],
    });
    await expect(made.submit('t1', 'COMMENT', 'Kept', false)).resolves.toEqual({
      kind: 'refused',
      refusal: {
        kind: 'github',
        message: 'It was submitted or deleted elsewhere since Lo last looked.',
      },
    });
    await expect(made.submit('t1', 'COMMENT', 'Kept', false)).resolves.toEqual({
      kind: 'refused',
      refusal: { kind: 'paused', until: 1_000 },
    });
    expect(summary()).toMatchObject({ text: 'Kept', sent: null });
  });
});

/** A submitted review of yours, by GitHub's clock. */
function review(overrides: Partial<ReviewNode> = {}): ReviewNode {
  return {
    id: 'PRR_9',
    state: 'COMMENTED',
    body: 'Reads well.',
    submittedAt: new Date(Date.now()).toISOString(),
    ...overrides,
  };
}

describe('a lost answer', () => {
  test('is looked for once the wait is over, never sent again meanwhile, and found, it’s done', async () => {
    vi.useFakeTimers();
    const sentAt = Date.now();
    const { made, sent, summary, published, readAt, state } = setup({
      pending: pendingOn(HEAD),
      answers: [lost()],
      reads: [
        {
          reviews: [review({ id: 'PRR_1', state: 'CHANGES_REQUESTED', body: 'Fix it.' })],
          ahead: 0,
        },
      ],
    });
    await expect(made.submit('t1', 'REQUEST_CHANGES', 'Fix it.', false)).resolves.toEqual({
      kind: 'lost',
    });
    expect(state()).toBe('checking');
    expect(summary()).toMatchObject({ sent: 'Fix it.', sentAt });
    // Until Lo knows, nothing more goes, "anyway" or not.
    await expect(made.submit('t1', 'REQUEST_CHANGES', 'Fix it.', true)).resolves.toEqual({
      kind: 'refused',
      refusal: { kind: 'busy', why: 'checking' },
    });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(readAt).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(readAt).toEqual([sentAt + 10_000]);
    expect(sent).toHaveLength(1);
    expect(summary()).toBeUndefined();
    expect(published.at(-1)).toMatchObject({
      state: null,
      submitted: { event: 'REQUEST_CHANGES' },
    });
  });

  test('not found, by GitHub’s clock, it wasn’t submitted, and can be submitted again', async () => {
    vi.useFakeTimers();
    // GitHub's clock is a minute ahead: a review it says was submitted 50 s after this computer's
    // send time is from before the send.
    const before = review({ submittedAt: new Date(Date.now() + 50_000).toISOString() });
    const { made, summary, state, sent } = setup({
      answers: [lost(), { review: 'PRR_9' }],
      reads: [{ reviews: [before], ahead: 60_000 }],
    });
    await made.submit('t1', 'COMMENT', 'Reads well.', false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state()).toBe('notSubmitted');
    expect(summary()).toMatchObject({ text: 'Reads well.', sent: null });
    await expect(made.submit('t1', 'COMMENT', 'Reads well.', false)).resolves.toEqual({
      kind: 'submitted',
      event: 'COMMENT',
    });
    expect(sent).toHaveLength(2);
  });

  test('your pending review, still pending, wasn’t submitted; a read that can’t be made is tried again', async () => {
    vi.useFakeTimers();
    const offline = new GithubError({ kind: 'network', failure: 'offline', message: 'offline' });
    const { made, state, readAt } = setup({
      pending: pendingOn(HEAD),
      answers: [lost()],
      reads: [
        offline,
        { reviews: [review({ id: 'PRR_1', state: 'PENDING', submittedAt: null })], ahead: 0 },
      ],
    });
    await made.submit('t1', 'COMMENT', 'Reads well.', false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state()).toBe('checking');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(readAt).toHaveLength(2);
    expect(state()).toBe('notSubmitted');
  });

  test('when Lo can’t tell, only “Submit anyway” sends it', async () => {
    vi.useFakeTimers();
    const refused = new GithubError({ kind: 'notFound', message: 'gone' });
    const { made, state, sent } = setup({
      answers: [lost(), { review: 'PRR_9' }],
      reads: [refused],
    });
    await made.submit('t1', 'COMMENT', 'Reads well.', false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state()).toBe('unknown');
    await expect(made.submit('t1', 'COMMENT', 'Reads well.', false)).resolves.toEqual({
      kind: 'refused',
      refusal: { kind: 'busy', why: 'unknown' },
    });
    await expect(made.submit('t1', 'COMMENT', 'Reads well.', true)).resolves.toMatchObject({
      kind: 'submitted',
    });
    expect(sent).toHaveLength(2);
  });

  test('one sent before Lo quit is looked for as Lo starts again, and found by its summary', async () => {
    vi.useFakeTimers();
    const kept = new Map<string, SummaryDraft>();
    const first = setup({ answers: [lost()], kept });
    await first.made.submit('t1', 'APPROVE', 'Ship it.', false);
    first.made.stop();
    const again = setup({
      kept,
      reads: [{ reviews: [review({ state: 'APPROVED', body: 'Ship it.' })], ahead: 0 }],
    });
    // Until the read settles it, it's being checked, and nothing goes.
    await expect(again.made.dialog('t1')).resolves.toMatchObject({ submitting: 'checking' });
    again.made.resume();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(again.summary()).toBeUndefined();
    expect(again.published.at(-1)).toMatchObject({ submitted: { event: 'APPROVE' } });
  });
});

test('a review is found by its pending review, or else by when it was submitted, its summary and verdict', () => {
  const at = Date.parse('2026-11-13T10:00:10Z');
  const asked = { event: 'COMMENT' as const, pending: undefined };
  const one = review({ submittedAt: '2026-11-13T10:00:06Z' });
  expect(submittedAmong([one], 'Reads well.', at, asked)).toEqual({ event: 'COMMENT' });
  expect(submittedAmong([one], 'Reads well.', at + 5_000, asked)).toBeUndefined();
  expect(submittedAmong([one], 'Other words', at, asked)).toBeUndefined();
  expect(
    submittedAmong([one], 'Reads well.', at, { event: 'APPROVE', pending: undefined }),
  ).toBeUndefined();
  // A blank summary leaves a summary written on GitHub's page.
  expect(submittedAmong([one], ' ', at, asked)).toEqual({ event: 'COMMENT' });
  const pending = { event: 'COMMENT' as const, pending: 'PRR_1' };
  expect(submittedAmong([one], 'Reads well.', at, pending)).toBeUndefined();
  expect(
    submittedAmong([review({ id: 'PRR_1', state: 'DISMISSED', body: '' })], 'x', at, pending),
  ).toEqual({ event: null });
});
