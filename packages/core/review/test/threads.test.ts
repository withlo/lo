/**
 * Threads, commentable lines and the pending review for whole pull requests: threads mapped from
 * GraphQL's `PullRequestReviewThread`s, revisions keyed by their full head SHAs, and recorded
 * answers:
 *
 * - `sharkdp/fd#2212`, a maintainer's changes-requested review whose six threads a later push made
 *   outdated, read as rozed-bot, which can reply but not resolve.
 * - `rozed-dev/playground#4`, the review API checks' pull request: ranges, a thread on the base,
 *   outdated threads and a thread with replies, read two threads and two comments a page.
 * - `rozed-dev/e2e#20`: a thread on a moved line and one on a line only the old side has.
 */

import {
  GithubClient,
  PullRef,
  reviewThreads,
  reviewThreadsPaged,
  Token,
  unchecked,
  type ReviewThread,
} from '@lo/github';
import { cassette, Replay, replayFetch, type Json, type ReplayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

import {
  Drafts,
  type DraftKey,
  type DraftPlace,
  type DraftPullRequest,
  type ThreadDraftPlace,
} from '../src/drafts.ts';
import {
  sendsComment,
  YourReview,
  type Mutation,
  type NewComment,
  type NewThread,
  type ReviewRefusal,
} from '../src/pending.ts';
import {
  Line,
  Lines,
  Thread,
  threadFromGithub,
  threadsFromGithub,
  type CommentState,
} from '../src/threads.ts';
import { CommentableLines, PatchHunk } from '../src/threads/commentable.ts';
import { panel, type PanelFilter } from '../src/threads/panel.ts';
import { place, Screen, type Placement } from '../src/threads/place.ts';
import { suggestionBlock, takesSuggestion } from '../src/threads/suggestion.ts';

const R1 = '5b1e0c7a9d3f4e2b8c6a1d0f9e8b7c6a5d4e3f21';
const R2 = '9e4d2a6c8b0f1e3d5c7a9b2e4f6d8c0a1b3e5f74';
/** The latest head, `headRefOid`. */
const R3 = 'c7f30e9b1a5d7c3e9f1b5d7a3c9e1f5b7d3a9c62';

/** The pull request's node ID. */
const PULL = 'PR_kwDOshop42';

const BOT = 'rozed-bot';

function at(minute: number): string {
  return new Date((1_790_000_000 + minute * 60) * 1000).toISOString();
}

/** What sets a `PullRequestReviewThread` node apart, with GraphQL's names and values. */
interface Node {
  id: string;
  path: string;
  subjectType: ReviewThread['subjectType'];
  diffSide: ReviewThread['diffSide'];
  startDiffSide: ReviewThread['startDiffSide'];
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  isOutdated: boolean;
  isResolved: boolean;
  /** Each comment's `commit.oid`. */
  commit: string | null;
  /** Each comment's `originalCommit.oid`. */
  originalCommit: string | null;
  /** Each comment's `author.login` and `state`. */
  comments: [string, CommentState][];
}

/** The thread mapped from GitHub's `node`. */
function thread(node: Node): Thread {
  const github: ReviewThread = {
    id: node.id,
    path: node.path,
    subjectType: node.subjectType,
    diffSide: node.diffSide,
    startDiffSide: node.startDiffSide,
    line: node.line,
    startLine: node.startLine,
    originalLine: node.originalLine,
    originalStartLine: node.originalStartLine,
    isOutdated: node.isOutdated,
    isResolved: node.isResolved,
    viewerCanReply: true,
    viewerCanResolve: !node.isResolved,
    viewerCanUnresolve: node.isResolved,
    comments: {
      totalCount: node.comments.length,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: node.comments.map(([author, state], index) => ({
        id: `${node.id}_${index}`,
        author: { __typename: 'User', login: author },
        body: '…',
        state,
        createdAt: at(40 + index),
        url: `https://github.com/bob/parse/pull/7#discussion_r${index}`,
        isMinimized: false,
        minimizedReason: null,
        viewerCanUpdate: author === 'alice',
        viewerCanDelete: author === 'alice',
        commit: node.commit === null ? null : { oid: node.commit },
        originalCommit: node.originalCommit === null ? null : { oid: node.originalCommit },
      })),
    },
  };
  return threadFromGithub(github);
}

/**
 * Bob's pull request's threads, after three pushes, as GitHub gives them: a one-line thread that
 * GitHub has moved to the latest head has `startLine` equal to `line`, and no `startDiffSide`; a
 * one-line thread on an older commit, or outdated, has no `startLine`; an outdated thread's first
 * comment stays on the commit it was written on; and a file-level thread is on line 1.
 */
function threads(): Thread[] {
  const line: Node = {
    id: '',
    path: 'src/parse.rs',
    subjectType: 'LINE',
    diffSide: 'RIGHT',
    startDiffSide: null,
    line: null,
    startLine: null,
    originalLine: null,
    originalStartLine: null,
    isOutdated: false,
    isResolved: false,
    commit: null,
    originalCommit: null,
    comments: [['bob', 'SUBMITTED']],
  };
  return [
    // Written on r1 at line 10. r2 added four lines above it, and it hasn't changed since.
    thread({
      ...line,
      id: 'PRRT_current',
      line: 14,
      startLine: 14,
      originalLine: 10,
      commit: R3,
      originalCommit: R1,
    }),
    // Written on r1 at line 20, which r2 changed.
    thread({
      ...line,
      id: 'PRRT_outdated',
      line: null,
      originalLine: 20,
      isOutdated: true,
      commit: R1,
      originalCommit: R1,
      comments: [
        ['bob', 'SUBMITTED'],
        ['alice', 'SUBMITTED'],
      ],
    }),
    // Alice's pending comment on lines 30 to 33 of r3.
    thread({
      ...line,
      id: 'PRRT_range',
      startDiffSide: 'RIGHT',
      line: 33,
      startLine: 30,
      originalLine: 33,
      originalStartLine: 30,
      commit: R3,
      originalCommit: R3,
      comments: [['alice', 'PENDING']],
    }),
    // On line 5 of the base, a removed line, written on r2 and since resolved.
    thread({
      ...line,
      id: 'PRRT_base',
      diffSide: 'LEFT',
      line: 5,
      startLine: 5,
      originalLine: 5,
      isResolved: true,
      commit: R3,
      originalCommit: R2,
      comments: [['carol', 'SUBMITTED']],
    }),
    thread({
      ...line,
      id: 'PRRT_file',
      path: 'README.md',
      subjectType: 'FILE',
      line: 1,
      originalLine: 1,
      commit: R3,
      originalCommit: R2,
    }),
    // Dan's comment on line 40 of r2, written after r3 was pushed. GitHub keeps it on r2 until
    // the next push, so its `line` is r2's line 40, which is r3's line 44.
    thread({
      ...line,
      id: 'PRRT_older',
      line: 40,
      originalLine: 40,
      commit: R2,
      originalCommit: R2,
      comments: [['dan', 'SUBMITTED']],
    }),
  ];
}

function placements(screen: Screen): [string, Placement][] {
  return threads().map((each) => [each.id, place(each, screen)]);
}

function lines(on: Lines): Placement {
  return { kind: 'lines', lines: on };
}

const FILE: Placement = { kind: 'file' };
const OUTDATED: Placement = { kind: 'outdated' };
const NOT_ON_SCREEN: Placement = { kind: 'notOnScreen' };

test('threads on the latest revisions whole diff', () => {
  // Dan's thread isn't on r3 until GitHub moves it there.
  expect(placements(Screen.full(R3))).toEqual([
    ['PRRT_current', lines(Lines.one(Line.right(14)))],
    ['PRRT_outdated', OUTDATED],
    ['PRRT_range', lines(Lines.range(Line.right(30), Line.right(33)))],
    ['PRRT_base', lines(Lines.one(Line.left(5)))],
    ['PRRT_file', FILE],
    ['PRRT_older', NOT_ON_SCREEN],
  ]);
});

test('threads between r1 and r3', () => {
  // The left column shows r1: the outdated thread is where it was written, and the base isn't on
  // screen.
  expect(placements(Screen.between(R1, R3))).toEqual([
    ['PRRT_current', lines(Lines.one(Line.right(14)))],
    ['PRRT_outdated', lines(Lines.one(Line.left(20)))],
    ['PRRT_range', lines(Lines.range(Line.right(30), Line.right(33)))],
    ['PRRT_base', NOT_ON_SCREEN],
    ['PRRT_file', FILE],
    ['PRRT_older', NOT_ON_SCREEN],
  ]);
});

test('threads between r2 and r3', () => {
  expect(placements(Screen.between(R2, R3))).toEqual([
    ['PRRT_current', lines(Lines.one(Line.right(14)))],
    ['PRRT_outdated', OUTDATED],
    ['PRRT_range', lines(Lines.range(Line.right(30), Line.right(33)))],
    ['PRRT_base', NOT_ON_SCREEN],
    ['PRRT_file', FILE],
    ['PRRT_older', lines(Lines.one(Line.left(40)))],
  ]);
});

test('threads on r1s whole diff are where they were written', () => {
  expect(placements(Screen.full(R1))).toEqual([
    ['PRRT_current', lines(Lines.one(Line.right(10)))],
    ['PRRT_outdated', lines(Lines.one(Line.right(20)))],
    ['PRRT_range', NOT_ON_SCREEN],
    ['PRRT_base', NOT_ON_SCREEN],
    ['PRRT_file', FILE],
    ['PRRT_older', NOT_ON_SCREEN],
  ]);
});

test('threads on r2s whole diff', () => {
  expect(placements(Screen.full(R2))).toEqual([
    ['PRRT_current', NOT_ON_SCREEN],
    ['PRRT_outdated', OUTDATED],
    ['PRRT_range', NOT_ON_SCREEN],
    ['PRRT_base', lines(Lines.one(Line.left(5)))],
    ['PRRT_file', FILE],
    ['PRRT_older', lines(Lines.one(Line.right(40)))],
  ]);
});

test('threads with r1 replayed onto r3s base', () => {
  expect(placements(Screen.replayed(R1, R3))).toEqual([
    ['PRRT_current', lines(Lines.one(Line.right(14)))],
    ['PRRT_outdated', OUTDATED],
    ['PRRT_range', lines(Lines.range(Line.right(30), Line.right(33)))],
    ['PRRT_base', NOT_ON_SCREEN],
    ['PRRT_file', FILE],
    ['PRRT_older', NOT_ON_SCREEN],
  ]);
});

test('the threads panel and how threads start', () => {
  const all = threads();
  const listed = (filter: PanelFilter): string[] =>
    panel(all, filter, 'alice').map((shown) => shown.id);

  expect(listed('unresolved')).toEqual([
    'PRRT_current',
    'PRRT_outdated',
    'PRRT_range',
    'PRRT_file',
    'PRRT_older',
  ]);
  expect(listed('yours')).toEqual(['PRRT_outdated', 'PRRT_range']);
  expect(listed('all')).toHaveLength(6);

  expect(all.map(Thread.startsOpen)).toEqual([true, true, true, false, true, true]);
  expect(all.map(Thread.isPending)).toEqual([false, false, true, false, false, false]);
  expect(all[2]!.comments[0]!.state).toBe('PENDING');
});

/** GitHub's `patch` for `src/parse.rs` at r3: `build` now fails, and `validate` runs after it. */
const PATCH = [
  '@@ -8,8 +8,9 @@ use crate::token::Token;',
  ' ',
  ' pub fn parse(input: &str) -> Result<Ast, Error> {',
  '     let tokens = tokenize(input)?;',
  '-    let ast = build(tokens);',
  '-    Ok(ast)',
  '+    let ast = build(tokens)?;',
  '+    validate(&ast)?;',
  '+    Ok(ast)',
  ' }',
  ' ',
  ' fn tokenize(input: &str) -> Result<Vec<Token>, Error> {',
].join('\n');

/** The pull request, as drafts are kept by it. */
const PULL_REQUEST: DraftPullRequest = { owner: 'acme', repo: 'shop', number: 42 };

function newThread(on: Lines | undefined, body: string): NewThread {
  return { kind: 'thread', path: 'src/parse.rs', lines: on, body };
}

/** What `review` planned, failing the test on a refusal. */
function planned(review: Mutation | ReviewRefusal): Mutation {
  if ('refusal' in review) throw new Error(`refused: ${review.refusal}`);
  return review;
}

/** What `range` takes a comment on, failing the test when it takes none. */
function commentLines(range: ReturnType<CommentableLines['range']>): Lines {
  if (range.kind !== 'lines') throw new Error('no comment there');
  return range.lines;
}

test('alice reviews r3 and approves', () => {
  const screen = Screen.full(R3);
  const commentable = CommentableLines.inDiff(screen, PatchHunk.parse(PATCH));
  const review = new YourReview(PULL);
  const drafts = new Drafts();

  // `v` from line 12 up to line 11, then `c`: the text is kept until it's posted.
  const selection = commentLines(commentable.range(Line.right(12), Line.right(11)));
  expect(selection).toEqual(Lines.range(Line.right(11), Line.right(12)));
  const key: DraftKey = {
    account: 'alice',
    pullRequest: PULL_REQUEST,
    place: { kind: 'thread', commit: screen.right, path: 'src/parse.rs', lines: selection },
  };
  expect(drafts.set(key, 'Does validate need the tokens?')).toBe(true);
  const first = newThread(selection, drafts.get(key)!);
  const start = planned(review.add(screen.right, R3, first));
  expect(start).toEqual({
    kind: 'startReview',
    head: R3,
    variables: {
      pullRequestId: PULL,
      commitOID: R3,
      event: undefined,
      body: undefined,
      threads: [
        {
          path: 'src/parse.rs',
          body: 'Does validate need the tokens?',
          line: 12,
          side: 'RIGHT',
          startLine: 11,
          startSide: 'RIGHT',
        },
      ],
    },
  });
  review.accepted(start, 'PRR_kwDOAbc');
  expect(sendsComment(start)).toBe(true);
  expect(drafts.take(key)).toBe('Does validate need the tokens?');

  // `s` on line 13 suggests a change; the removed line 12 takes a comment but no suggestion.
  const added = commentable.line(Line.right(13))!;
  expect(takesSuggestion(added)).toBe(true);
  expect(takesSuggestion(commentable.line(Line.left(12))!)).toBe(false);
  const suggestion = suggestionBlock(['    Ok(validate(ast)?)']);
  expect(suggestion).toBe('```suggestion\n    Ok(validate(ast)?)\n```');
  const second = planned(review.add(R3, R3, newThread(added, suggestion)));
  expect(second.kind === 'addThread' && second.variables.pullRequestReviewId).toBe('PRR_kwDOAbc');
  review.accepted(second);

  // Line 20 is outside the diff, so the comment goes on the file.
  expect(commentable.line(Line.right(20))).toBeUndefined();
  const file = planned(review.add(R3, R3, newThread(undefined, 'Worth a test for empty input.')));
  review.accepted(file);

  // `C` on a reply joins the pending review: GitHub posts nothing else from her until it's
  // submitted.
  const posting = review.post(R3, R3, {
    kind: 'reply',
    thread: 'PRRT_current',
    body: 'Fixed in r3, thanks.',
  });
  if ('refusal' in posting) throw new Error(`refused: ${posting.refusal}`);
  // A reply posted at once with a pending review joins it.
  expect(posting.pending).toBe(true);
  review.accepted(posting.mutation);

  // `⌘⏎`.
  const dialog = review.submitDialog('alice', false, R3);
  expect(dialog.choices).toEqual(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']);
  expect(dialog.pendingComments).toBe(4);
  expect([dialog.on, dialog.onScreen]).toEqual([R3, true]);
  const submit = planned(review.submit('APPROVE', '', false, R3, R3));
  expect(submit).toEqual({
    kind: 'submitReview',
    head: R3,
    variables: { pullRequestReviewId: 'PRR_kwDOAbc', event: 'APPROVE', body: undefined },
  });
  review.accepted(submit);
  expect(review.pending).toBeUndefined();
});

test('bob can only comment on his own pull request', () => {
  const review = new YourReview(PULL);
  const dialog = review.submitDialog('bob', true, R3);

  expect(dialog.choices).toEqual(['COMMENT']);
  expect(review.submit('APPROVE', 'Ship it', true, R3, R3)).toEqual({ refusal: 'ownPullRequest' });
  expect(review.submit('COMMENT', 'Ready for another look.', true, R3, R3)).toEqual({
    kind: 'review',
    head: R3,
    variables: {
      pullRequestId: PULL,
      commitOID: R3,
      event: 'COMMENT',
      body: 'Ready for another look.',
      threads: undefined,
    },
  });
});

test('a pending review started before a push keeps its revision', () => {
  // Alice started a review on r2; Bob then pushed r3.
  const review = new YourReview(PULL, { id: 'PRR_kwDOAbc', commit: R2, comments: 2 });
  const screen = Screen.between(R2, R3);
  const commentable = CommentableLines.inDiff(screen, PatchHunk.parse(PATCH));

  // Between revisions, only the right column takes comments. It shows r3, the latest head, where
  // GitHub puts every thread added to a pending review, so they join the review on r2.
  expect(commentable.line(Line.left(11))).toBeUndefined();
  const line11 = commentable.line(Line.right(11));
  if (line11 === undefined) throw new Error('line 11 takes no comment');
  const comment = newThread(line11, 'Nit');
  expect(planned(review.add(screen.right, R3, comment)).kind).toBe('addThread');

  // On r2 itself, a new line comment would land on r3's line 11, so it's refused.
  expect(review.add(R2, R3, comment)).toEqual({ refusal: 'notLatest', head: R3 });

  // Replies have no lines, so they join it from any revision.
  const reply: NewComment = { kind: 'reply', thread: 'PRRT_current', body: 'Still applies.' };
  for (const on of [R1, R2, R3]) {
    expect(planned(review.add(on, R3, reply)).kind).toBe('addReply');
  }

  // The dialog says the review is recorded on r2, so it won't approve r3 with it: GitHub would
  // record approving r2. It still submits it as a comment.
  const dialog = review.submitDialog('alice', false, R3);
  expect([dialog.on, dialog.onScreen]).toEqual([R2, false]);
  expect(review.submit('APPROVE', '', false, R3, R3)).toEqual({
    refusal: 'otherRevision',
    reviewOn: R2,
  });
  expect(planned(review.submit('COMMENT', '', false, R3, R3)).kind).toBe('submitReview');
  // On r2, she can approve what she sees.
  expect(planned(review.submit('APPROVE', '', false, R2, R3)).kind).toBe('submitReview');
});

test('without a pending review c posts on the revision on screen', () => {
  const screen = Screen.between(R1, R2);
  const rename = newThread(Lines.one(Line.right(11)), 'Nit: rename.');

  expect(new YourReview(PULL).post(screen.right, R3, rename)).toEqual({
    mutation: {
      kind: 'postThread',
      head: R3,
      variables: {
        pullRequestId: PULL,
        commitOID: R2,
        event: 'COMMENT',
        body: undefined,
        threads: [
          {
            path: 'src/parse.rs',
            body: 'Nit: rename.',
            line: 11,
            side: 'RIGHT',
            startLine: undefined,
            startSide: undefined,
          },
        ],
      },
    },
    pending: false,
  });
});

function readme(body: string): NewComment {
  return { kind: 'thread', path: 'README.md', lines: undefined, body };
}

test('carol starts her review with a comment on a file', () => {
  // Carol is looking at r1 to r2, and comments on README.md's header.
  const screen = Screen.between(R1, R2);
  expect(CommentableLines.inDiff(screen, []).takesFileComment()).toBe(true);
  const review = new YourReview(PULL);
  const drafts = new Drafts();
  const key: DraftKey = {
    account: 'carol',
    pullRequest: PULL_REQUEST,
    place: { kind: 'thread', commit: screen.right, path: 'README.md', lines: undefined },
  };
  drafts.set(key, 'Mention the new flag.');
  const comment = readme(drafts.get(key)!);

  // GitHub can't start a review with a file-level thread, so the first call starts an empty one,
  // on the latest head. The comment isn't sent yet, so its draft stays.
  const start = planned(review.add(screen.right, R3, comment));
  expect(start).toEqual({
    kind: 'startReview',
    head: R3,
    variables: {
      pullRequestId: PULL,
      commitOID: R3,
      event: undefined,
      body: undefined,
      threads: undefined,
    },
  });
  review.accepted(start, 'PRR_carol');
  expect(sendsComment(start)).toBe(false);
  expect(review.pendingComments).toBe(0);
  expect(drafts.get(key)).toBeDefined();

  // The second adds the file-level thread.
  const add = planned(review.add(screen.right, R3, comment));
  expect(add).toEqual({
    kind: 'addThread',
    head: R3,
    variables: {
      pullRequestReviewId: 'PRR_carol',
      path: 'README.md',
      body: 'Mention the new flag.',
      subjectType: 'FILE',
      line: undefined,
      side: undefined,
      startLine: undefined,
      startSide: undefined,
    },
  });
  review.accepted(add);
  expect(sendsComment(add)).toBe(true);
  drafts.take(key);
  expect(review.pendingComments).toBe(1);
  expect(drafts.isEmpty()).toBe(true);
});

test('a comment github refuses keeps its draft and is not counted', () => {
  const review = new YourReview(PULL);
  const drafts = new Drafts();
  const key: DraftKey = {
    account: 'dan',
    pullRequest: PULL_REQUEST,
    place: { kind: 'reply', thread: 'PRRT_outdated' },
  };
  drafts.set(key, 'Still applies on r3.');
  const reply: NewComment = { kind: 'reply', thread: 'PRRT_outdated', body: drafts.get(key)! };

  // A reply as the first comment: the review starts, then GitHub refuses the reply.
  const start = planned(review.add(R3, R3, reply));
  review.accepted(start, 'PRR_dan');
  const answer = planned(review.add(R3, R3, reply));
  expect(answer.kind === 'addReply' && answer.variables.pullRequestReviewId).toBe('PRR_dan');
  // Refused, so not accepted: the review stays empty, and an empty Comment isn't sent.
  expect(review.pendingComments).toBe(0);
  expect(drafts.get(key)).toBe('Still applies on r3.');
  expect(review.submit('COMMENT', '', false, R3, R3)).toEqual({ refusal: 'nothingToSubmit' });
  // Sending it again plans the same reply.
  expect(review.add(R3, R3, reply)).toEqual(answer);

  // GitHub answers a thread it won't take, such as one whose line left the diff in a push it
  // hadn't seen, with `thread: null` and no error. That's a refusal too.
  const on = CommentableLines.inDiff(Screen.full(R3), PatchHunk.parse(PATCH)).line(Line.right(13));
  if (!on) throw new Error('line 13 takes no comment');
  expect(planned(review.add(R3, R3, newThread(on, 'Why?'))).kind).toBe('addThread');
  expect(review.pendingComments).toBe(0);
});

test('c on a file posts a file comment on the revision on screen', () => {
  const screen = Screen.between(R1, R2);

  expect(new YourReview(PULL).post(screen.right, R3, readme('Mention the new flag.'))).toEqual({
    mutation: {
      kind: 'postFileComment',
      head: R3,
      body: {
        commit_id: R2,
        path: 'README.md',
        body: 'Mention the new flag.',
        subject_type: 'file',
      },
    },
    pending: false,
  });
});

/** Erin's nit on line `line`. */
function nit(line: number): NewComment {
  return newThread(Lines.one(Line.right(line)), 'Nit');
}

test('erin comments on r2 after r3 was pushed', () => {
  // With no pending review, a line comment on r2 starts a review there, with its thread on r2's
  // lines.
  const review = new YourReview(PULL);
  const start = planned(review.add(R2, R3, nit(11)));
  expect(start).toEqual({
    kind: 'startReview',
    head: R3,
    variables: {
      pullRequestId: PULL,
      commitOID: R2,
      event: undefined,
      body: undefined,
      threads: [
        {
          path: 'src/parse.rs',
          body: 'Nit',
          line: 11,
          side: 'RIGHT',
          startLine: undefined,
          startSide: undefined,
        },
      ],
    },
  });
  review.accepted(start, 'PRR_erin');
  expect(review.pending?.commit).toBe(R2);

  // Another line comment on r2 would land on r3, so it's refused, and the UI offers to submit the
  // review or switch to r3, where it joins.
  expect(review.add(R2, R3, nit(12))).toEqual({ refusal: 'notLatest', head: R3 });
  expect(planned(review.add(R3, R3, nit(12))).kind).toBe('addThread');

  // The review is recorded on r2, so it approves r2 only while r2 is on screen.
  expect(review.submit('APPROVE', '', false, R3, R3)).toEqual({
    refusal: 'otherRevision',
    reviewOn: R2,
  });
  expect(planned(review.submit('APPROVE', '', false, R2, R3)).kind).toBe('submitReview');
});

/** Alice's draft on line `line` of r2. */
function aliceOn(line: number): DraftKey {
  return {
    account: 'alice',
    pullRequest: PULL_REQUEST,
    place: {
      kind: 'thread',
      commit: R2,
      path: 'src/parse.rs',
      lines: Lines.one(Line.right(line)),
    },
  };
}

test('alices drafts on r2 cross bobs push of r3', () => {
  // Alice drafted two comments on r2. Bob then pushed r3, which changed line 9 and added a line
  // above line 11.
  const drafts = new Drafts();
  drafts.set(aliceOn(9), 'Why public?');
  drafts.set(aliceOn(11), 'Does build need the tokens?');

  // On r3, the app follows each draft's lines from r2, and keeps them where they still take a
  // comment.
  const r3 = CommentableLines.inDiff(Screen.full(R3), PatchHunk.parse(PATCH));
  const moved = (from: ThreadDraftPlace): DraftPlace | undefined => {
    if (from.lines?.end.number !== 11) return undefined;
    const on = r3.line(Line.right(12));
    return on && { kind: 'thread', commit: R3, path: from.path, lines: on };
  };
  const older = drafts.onOlderRevisions('alice', PULL_REQUEST, R3, moved);
  const at12 = Lines.one(Line.right(12));
  expect(older.map((draft) => [draft.text, draft.onLatest])).toEqual([
    ['Why public?', undefined],
    [
      'Does build need the tokens?',
      { kind: 'thread', commit: R3, path: 'src/parse.rs', lines: at12 },
    ],
  ]);

  // Its comment box opens on line 12 of r3, and posting it takes the draft written on r2.
  const review = new YourReview(PULL);
  const start = planned(review.add(R3, R3, newThread(at12, older[1]!.text)));
  review.accepted(start, 'PRR_alice');
  expect(sendsComment(start)).toBe(true);
  expect(drafts.take(older[1]!.key)).toBeDefined();

  // The stranded draft is still there, for the threads panel to list.
  expect(drafts.on('alice', PULL_REQUEST)).toEqual([
    { place: aliceOn(9).place, text: 'Why public?' },
  ]);
});

function client(fetch: ReplayFetch): GithubClient {
  return new GithubClient({ fetch, token: new Token('gho_FAKE') });
}

/** The threads on `path` whose last line was `originalLine` when they were written. */
function writtenAt(all: Thread[], path: string, originalLine: number): Thread[] {
  return all.filter((each) => each.path === path && each.originalLine === originalLine);
}

/** The one commit all of `shas` are, checking that it starts with `short`. */
function oneCommit(shas: (string | undefined)[], short: string): string {
  const distinct = [...new Set(shas)];
  expect(distinct).toHaveLength(1);
  const [sha] = distinct;
  expect(sha?.startsWith(short)).toBe(true);
  return sha!;
}

/** Whether `a` and `b` are the same lines. */
function sameLines(a: Lines | undefined, b: Lines): boolean {
  return (
    a !== undefined &&
    Lines.isRange(a) === Lines.isRange(b) &&
    Line.equals(Lines.first(a), Lines.first(b)) &&
    Line.equals(a.end, b.end)
  );
}

test('fd 2212s threads are outdated by the second push', async () => {
  const fetch = replayFetch('review_threads_fd_2212');
  const all = threadsFromGithub(
    await reviewThreads(client(fetch), new PullRef('sharkdp', 'fd', 2212)),
  );

  expect(all).toHaveLength(6);
  expect(all.flatMap((each) => each.comments)).toHaveLength(7);
  // Every thread was written on the first push and is outdated since: GitHub leaves its first
  // comment on the commit it was written on, with no current lines.
  const firstPush = oneCommit(
    all.flatMap((each) => [each.currentOn, each.writtenOn]),
    '15635d6',
  );
  for (const each of all) {
    expect(each.outdated).toBe(true);
    expect(Thread.currentLines(each)).toBeUndefined();
    expect(each.subject).toBe('LINE');
    expect(each.side).toBe('RIGHT');
    expect(each.resolved).toBe(false);
    // rozed-bot can reply to a public pull request, but not resolve its threads or edit a
    // maintainer's comments.
    expect(each.viewerCanReply).toBe(true);
    expect(each.viewerCanResolve || each.viewerCanUnresolve).toBe(false);
    for (const comment of each.comments) {
      expect(comment.author).toBe('tmccombs');
      expect(comment.state).toBe('SUBMITTED');
      expect(comment.hidden).toBeUndefined();
      expect(comment.viewerCanUpdate || comment.viewerCanDelete).toBe(false);
      expect(comment.url).toMatch(/^https:\/\/github\.com\/sharkdp\/fd\/pull\/2212#discussion_r/);
    }
  }
  const makefile = writtenAt(all, 'Makefile', 17);
  expect(makefile).toHaveLength(1);
  const [first, second] = makefile[0]!.comments;
  expect(makefile[0]!.comments).toHaveLength(2);
  expect(Date.parse(first!.createdAt)).toBeLessThanOrEqual(Date.parse(second!.createdAt));

  // They show where they were written on the first push, and only in the panel on the second.
  const head = '22c70acc6992c0c51cb68527b87adf114d01acbc';
  const workflow = writtenAt(all, '.github/workflows/CICD.yml', 187)[0]!;
  expect(place(workflow, Screen.full(firstPush))).toEqual(lines(Lines.one(Line.right(187))));
  expect(place(workflow, Screen.between(firstPush, head))).toEqual(
    lines(Lines.one(Line.left(187))),
  );
  expect(place(workflow, Screen.full(head))).toEqual(OUTDATED);
});

test('the playgrounds review checks read two threads and two comments a page', async () => {
  const fetch = replayFetch('review_threads_playground_4_paged');
  const all = threadsFromGithub(
    await reviewThreadsPaged(client(fetch), new PullRef('rozed-dev', 'playground', 4), 2),
  );
  expect(all).toHaveLength(15);

  // The outdated threads were written on the review checks' second commit, and GitHub has moved
  // every other thread to the fourth.
  const c2 = oneCommit(
    all.filter((each) => each.outdated).map((each) => each.writtenOn),
    'fc0f4b4',
  );
  const c4 = oneCommit(
    all.filter((each) => !each.outdated).map((each) => each.currentOn),
    'b405bfc',
  );

  // Its first thread, on line 30, has a reply in a review of its own and one in the pending
  // review that was then submitted.
  const replied = all.find((each) => each.comments.length > 2)!;
  expect(replied.comments).toHaveLength(3);
  expect(Thread.currentLines(replied)).toEqual(Lines.one(Line.right(30)));
  for (const comment of replied.comments) {
    expect(comment.author).toBe(BOT);
    // rozed-bot's own comments, in its own repository.
    expect(comment.viewerCanUpdate && comment.viewerCanDelete).toBe(true);
  }
  expect(replied.viewerCanReply && replied.viewerCanResolve).toBe(true);
  expect(replied.viewerCanUnresolve).toBe(false);

  // The first check's thread, on line 10 of the second commit, outdated by the third: it shows on
  // the second commit only.
  const outdated = all.filter((each) => each.outdated);
  expect(outdated).toHaveLength(3);
  for (const each of outdated) {
    expect(each.currentOn).toBe(c2);
    expect(each.writtenOn).toBe(c2);
    expect(place(each, Screen.full(c2))).toEqual(lines(Lines.one(Line.right(10))));
    expect(place(each, Screen.full(c4))).toEqual(OUTDATED);
  }

  // The ranges check's ranges, all on the fourth commit now.
  const ranges = all
    .map(Thread.currentLines)
    .filter((each) => each !== undefined && Lines.isRange(each));
  expect(ranges).toContainEqual(Lines.range(Line.right(10), Line.right(11)));
  expect(ranges).toContainEqual(Lines.range(Line.right(10), Line.right(30)));
  expect(ranges).toContainEqual(Lines.range(Line.left(10), Line.left(11)));
  // From a removed line to the added line that replaced it.
  const acrossLines = Lines.range(Line.left(10), Line.right(10));
  expect(ranges).toContainEqual(acrossLines);
  const across = all.find((each) => sameLines(Thread.currentLines(each), acrossLines))!;
  expect(place(across, Screen.full(c4))).toEqual(lines(acrossLines));
  // Between revisions, only its added line is on screen.
  expect(place(across, Screen.between(c2, c4))).toEqual(lines(Lines.one(Line.right(10))));
});

function e2e20(): PullRef {
  return new PullRef('rozed-dev', 'e2e', 20);
}

test('e9s threads show on the moved line and the line only the old side has', async () => {
  const all = threadsFromGithub(
    await reviewThreads(client(replayFetch('review_threads_e2e_20')), e2e20()),
  );

  // The pull request's only revision.
  const head = oneCommit(
    all.flatMap((each) => [each.currentOn, each.writtenOn]),
    '243ff70',
  );
  const screen = Screen.full(head);
  const on = (path: string): [Thread, Placement] => {
    const found = all.find((each) => each.path === path)!;
    return [found, place(found, screen)];
  };

  // `const middle = …` in `Names`, where `fullName` moved to.
  const [moved, movedPlacement] = on('e9/api/names.ts');
  expect(movedPlacement).toEqual(lines(Lines.one(Line.right(10))));
  expect(moved.comments[0]!.body).toContain('moved line');
  // In `legacyName`, which the pull request deletes: on the left, the base's side.
  const [deleted, deletedPlacement] = on('e9/api/user.ts');
  expect(deletedPlacement).toEqual(lines(Lines.one(Line.left(26))));
  expect(deleted.side).toBe('LEFT');
  expect(deleted.comments[0]!.body).toContain('only the old side');

  for (const each of [moved, deleted]) {
    expect(each.outdated || each.resolved).toBe(false);
    expect(each.comments).toHaveLength(1);
    const comment = each.comments[0]!;
    expect(comment.author).toBe(BOT);
    expect(comment.viewerCanUpdate && comment.viewerCanDelete).toBe(true);
    expect(comment.url).toMatch(/^https:\/\/github\.com\/rozed-dev\/e2e\/pull\/20#discussion_r/);
    expect(each.viewerCanReply && each.viewerCanResolve).toBe(true);
  }
  // A line on the base shows only in the revision's whole diff.
  const parent = '0'.repeat(40);
  expect(place(deleted, Screen.between(parent, head))).toEqual(NOT_ON_SCREEN);
});

/** What an edit to a recorded `ReviewThreads` answer changes. */
interface ThreadsAnswer {
  data: {
    repository: {
      pullRequest: { reviewThreads: { nodes: ({ comments: { nodes: Json[] } } | null)[] } };
    };
  };
  errors?: Json;
}

/** `review_threads_e2e_20`'s answer to `ReviewThreads`, with `edit` made to its body. */
function edited(edit: (body: ThreadsAnswer) => void): ReplayFetch {
  const recorded = cassette('review_threads_e2e_20')
    .interactions.map(({ interaction }) => interaction)
    .find((interaction) => interaction.request.operation === 'ReviewThreads');
  if (!recorded) throw new Error('review_threads_e2e_20 has no ReviewThreads answer');
  const body = structuredClone(recorded.response.body);
  edit(unchecked<ThreadsAnswer>(body));
  return replayFetch(
    new Replay('review_threads_e2e_20', [
      { request: recorded.request, response: { ...recorded.response, body } },
    ]),
  );
}

test('threads github leaves out make the list incomplete', async () => {
  // An error nulls the first thread, and the second thread's comment.
  const fetch = edited((body) => {
    const nodes = body.data.repository.pullRequest.reviewThreads.nodes;
    nodes[0] = null;
    nodes[1]!.comments.nodes[0] = null;
    const path = ['repository', 'pullRequest', 'reviewThreads', 'nodes'];
    body.errors = [
      { message: 'Something went wrong', path: [...path, 0] },
      { message: 'Something went wrong', path: [...path, 1, 'comments', 'nodes', 0] },
    ];
  });
  const all = threadsFromGithub(await reviewThreads(client(fetch), e2e20()));

  expect(all).toHaveLength(1);
  expect(all[0]!.comments).toEqual([]);
});
