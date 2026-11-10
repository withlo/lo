import { expect, test } from 'vitest';

import { githubEnum } from './enums.ts';
import {
  COMMENT_STATES,
  DIFF_SIDES,
  Line,
  Lines,
  SUBJECTS,
  Thread,
  type CommentState,
  type ThreadComment,
} from './threads.ts';

/** A thread on nothing in particular, with `fields` set. */
function thread(fields: Partial<Thread>): Thread {
  return {
    id: '',
    path: '',
    subject: 'LINE',
    side: 'RIGHT',
    startSide: undefined,
    line: undefined,
    startLine: undefined,
    originalLine: undefined,
    originalStartLine: undefined,
    outdated: false,
    resolved: false,
    currentOn: undefined,
    writtenOn: undefined,
    comments: [],
    viewerCanReply: false,
    viewerCanResolve: false,
    viewerCanUnresolve: false,
    ...fields,
  };
}

test('a thread on one line is on that line', () => {
  const one = thread({ line: 14, originalLine: 10 });

  expect(Thread.currentLines(one)).toEqual(Lines.one(Line.right(14)));
  expect(Thread.writtenLines(one)).toEqual(Lines.one(Line.right(10)));
});

test('a range starts on its start side', () => {
  const range = thread({
    side: 'RIGHT',
    startSide: 'LEFT',
    line: 9,
    startLine: 7,
    originalLine: 9,
    originalStartLine: 6,
  });

  expect(Thread.currentLines(range)).toEqual(Lines.range(Line.left(7), Line.right(9)));
  expect(Thread.writtenLines(range)).toEqual(Lines.range(Line.left(6), Line.right(9)));
});

test('a one line thread whose start line github gives as its line is one line', () => {
  // GitHub's shape: `startLine` equal to `line`, with no `startDiffSide`.
  for (const side of ['RIGHT', 'LEFT'] as const) {
    const one = thread({ side, line: 9, startLine: 9, originalLine: 9 });

    expect(Thread.currentLines(one)).toEqual(Lines.one(Line.of(side, 9)));
    expect(Lines.isRange(Thread.currentLines(one)!)).toBe(false);
  }
});

test('a range from a removed line to the line that replaced it keeps both sides', () => {
  // `startLine` equals `line`, but `startDiffSide` differs from `diffSide`.
  const range = thread({ side: 'RIGHT', startSide: 'LEFT', line: 10, startLine: 10 });

  expect(Thread.currentLines(range)).toEqual(Lines.range(Line.left(10), Line.right(10)));
});

test('an outdated thread has no current lines', () => {
  // GitHub's shape: `line` and `startLine` null.
  const outdated = thread({
    line: undefined,
    startLine: undefined,
    originalLine: 9,
    outdated: true,
  });

  expect(Thread.currentLines(outdated)).toBeUndefined();
  expect(Thread.writtenLines(outdated)).toEqual(Lines.one(Line.right(9)));
});

test('a file thread has no lines', () => {
  // GitHub gives a file-level thread `line: 1` and `originalLine: 1`.
  const file = thread({ subject: 'FILE', line: 1, originalLine: 1 });

  expect(Thread.currentLines(file)).toBeUndefined();
  expect(Thread.writtenLines(file)).toBeUndefined();
});

test('unresolved threads start open and resolved ones collapsed', () => {
  const unresolved = thread({});
  const resolved = thread({ resolved: true });

  expect(Thread.startsOpen(unresolved)).toBe(true);
  expect(Thread.startsOpen(resolved)).toBe(false);
});

test('a range of one line is that line', () => {
  expect(Lines.range(Line.right(4), Line.right(4))).toEqual(Lines.one(Line.right(4)));
  expect(Lines.isRange(Lines.range(Line.left(4), Line.right(4)))).toBe(true);
  expect(Lines.first(Lines.range(Line.left(2), Line.right(4)))).toEqual(Line.left(2));
});

function comment(state: CommentState): ThreadComment {
  return {
    id: 'PRRC_1',
    author: 'alice',
    body: 'Typo',
    state,
    createdAt: '1970-01-01T00:00:00Z',
    url: 'https://github.com/octo/repo/pull/1#discussion_r1',
    hidden: undefined,
    viewerCanUpdate: true,
    viewerCanDelete: true,
  };
}

test('a thread whose first comment is pending is in your pending review', () => {
  const pending = thread({ comments: [comment('PENDING')] });
  const repliedTo = thread({ comments: [comment('SUBMITTED'), comment('PENDING')] });

  expect(Thread.isPending(pending)).toBe(true);
  expect(Thread.isPending(repliedTo)).toBe(false);
  expect(Thread.isPending(thread({}))).toBe(false);
});

test('graphql values parse', () => {
  // The values are GraphQL's names, so they're their own names for a mutation's input.
  expect(githubEnum(DIFF_SIDES, 'LEFT')).toBe('LEFT');
  expect(githubEnum(SUBJECTS, 'FILE')).toBe('FILE');
  expect(githubEnum(COMMENT_STATES, 'PENDING')).toBe('PENDING');
  expect(githubEnum(DIFF_SIDES, 'right')).toBe('RIGHT');
});
