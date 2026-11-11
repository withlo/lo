import { expect, test } from 'vitest';

import { Line, Lines, type Thread } from '../threads.ts';
import { place, Screen, type Placement } from './place.ts';

/** Revisions r1 to r3 have heads `a1` to `a3`; `a3` is the latest. */
const HEAD = 'a3';

/**
 * A thread on one line of the right side, written on `writtenOn` at `originalLine`, and on `line`
 * of the latest head while it isn't outdated. Like GitHub, it gives its `startLine` as its `line`,
 * and an outdated thread's first comment stays on the commit it was written on.
 */
function thread(writtenOn: string, originalLine: number, line: number | undefined): Thread {
  return {
    id: 'PRRT_1',
    path: 'src/parse.rs',
    subject: 'LINE',
    side: 'RIGHT',
    startSide: undefined,
    line,
    startLine: line,
    originalLine,
    originalStartLine: undefined,
    outdated: line === undefined,
    resolved: false,
    currentOn: line === undefined ? writtenOn : HEAD,
    writtenOn,
    comments: [
      {
        id: 'PRRC_1',
        author: 'octocat',
        body: 'Off by one?',
        state: 'SUBMITTED',
        createdAt: '1970-01-01T00:00:00Z',
        url: 'https://github.com/octo/repo/pull/1#discussion_r1',
        hidden: undefined,
        viewerCanUpdate: false,
        viewerCanDelete: false,
      },
    ],
    viewerCanReply: false,
    viewerCanResolve: false,
    viewerCanUnresolve: false,
  };
}

function on(lines: Lines): Placement {
  return { kind: 'lines', lines };
}

const FILE: Placement = { kind: 'file' };
const OUTDATED: Placement = { kind: 'outdated' };
const NOT_ON_SCREEN: Placement = { kind: 'notOnScreen' };

test('a thread shows under its line on the latest revision', () => {
  const current = thread('a3', 12, 12);

  expect(place(current, Screen.full('a3'))).toEqual(on(Lines.one(Line.right(12))));
});

test('a thread written on r1 whose line did not change shows where it is now on r3', () => {
  // r2 added four lines above it.
  const moved = thread('a1', 10, 14);

  expect(place(moved, Screen.full('a3'))).toEqual(on(Lines.one(Line.right(14))));
});

test('a thread written on r1 whose line changed is outdated on r3', () => {
  const outdated = thread('a1', 10, undefined);

  expect(place(outdated, Screen.full('a3'))).toEqual(OUTDATED);
});

test('an outdated thread shows where it was written when viewing that revision', () => {
  const outdated = thread('a1', 10, undefined);

  expect(place(outdated, Screen.full('a1'))).toEqual(on(Lines.one(Line.right(10))));
});

test('an outdated thread shows in the left column when it shows the revision it was written on', () => {
  const outdated = thread('a1', 10, undefined);

  expect(place(outdated, Screen.between('a1', 'a3'))).toEqual(on(Lines.one(Line.left(10))));
});

test('a thread that is still current shows in the right column between revisions', () => {
  const current = thread('a1', 10, 14);

  expect(place(current, Screen.between('a1', 'a3'))).toEqual(on(Lines.one(Line.right(14))));
});

test('a current thread is not on an older revision it was not written on', () => {
  // Its line on r2 is unknown: GitHub only says where it is on the latest.
  const current = thread('a1', 10, 14);

  expect(place(current, Screen.full('a2'))).toEqual(NOT_ON_SCREEN);
  expect(place(current, Screen.between('a2', 'a3'))).toEqual(on(Lines.one(Line.right(14))));
});

test('an outdated thread is only in the panel when its revision is not on screen', () => {
  const outdated = thread('a1', 10, undefined);

  expect(place(outdated, Screen.between('a2', 'a3'))).toEqual(OUTDATED);
  expect(place(outdated, Screen.full('a2'))).toEqual(OUTDATED);
});

test('an outdated thread does not show on a replayed revision', () => {
  const outdated = thread('a1', 10, undefined);

  expect(place(outdated, Screen.replayed('a1', 'a3'))).toEqual(OUTDATED);
});

test('a current thread shows in the right column with a replayed revision', () => {
  // The left column's lines are no commit's, but the right column is r3.
  const current = thread('a1', 10, 14);

  expect(place(current, Screen.replayed('a1', 'a3'))).toEqual(on(Lines.one(Line.right(14))));
  expect(place(current, Screen.replayed('a1', 'a2'))).toEqual(NOT_ON_SCREEN);
});

test('a thread on the base shows in the left column of the whole diff', () => {
  const base: Thread = { ...thread('a3', 5, 5), side: 'LEFT' };

  expect(place(base, Screen.full('a3'))).toEqual(on(Lines.one(Line.left(5))));
});

test('a thread on the base is not on screen between revisions', () => {
  const base: Thread = { ...thread('a1', 5, 5), side: 'LEFT' };

  expect(place(base, Screen.between('a1', 'a3'))).toEqual(NOT_ON_SCREEN);
});

test('an outdated thread on the base shows in the whole diff of its revision', () => {
  const base: Thread = { ...thread('a1', 5, undefined), side: 'LEFT' };

  expect(place(base, Screen.full('a1'))).toEqual(on(Lines.one(Line.left(5))));
  expect(place(base, Screen.between('a1', 'a3'))).toEqual(OUTDATED);
});

test('a multi line thread covers its range', () => {
  const range: Thread = { ...thread('a3', 14, 14), startLine: 10, originalStartLine: 10 };

  expect(place(range, Screen.full('a3'))).toEqual(on(Lines.range(Line.right(10), Line.right(14))));
});

test('a multi line thread shows its written range on its revision', () => {
  const range: Thread = { ...thread('a1', 6, undefined), originalStartLine: 3 };

  expect(place(range, Screen.full('a1'))).toEqual(on(Lines.range(Line.right(3), Line.right(6))));
  expect(place(range, Screen.between('a1', 'a3'))).toEqual(
    on(Lines.range(Line.left(3), Line.left(6))),
  );
});

test('a range from a removed line to an added line covers both columns', () => {
  const range: Thread = {
    ...thread('a3', 9, 9),
    startSide: 'LEFT',
    startLine: 7,
    originalStartLine: 7,
  };

  expect(place(range, Screen.full('a3'))).toEqual(on(Lines.range(Line.left(7), Line.right(9))));
});

test('a range starting on the base shows under its last line between revisions', () => {
  const range: Thread = {
    ...thread('a1', 9, 9),
    startSide: 'LEFT',
    startLine: 7,
    originalStartLine: 7,
  };

  expect(place(range, Screen.between('a1', 'a3'))).toEqual(on(Lines.one(Line.right(9))));
});

test('a range ending on the base shows under its first line when only that is on screen', () => {
  // From an unchanged line to the removed line after it.
  const range: Thread = {
    ...thread('a1', 11, 11),
    side: 'LEFT',
    startSide: 'RIGHT',
    startLine: 10,
    originalStartLine: 10,
  };

  expect(place(range, Screen.between('a1', 'a3'))).toEqual(on(Lines.one(Line.right(10))));
});

/** A file-level thread written on `writtenOn`, as GitHub gives it: on line 1. */
function fileThread(writtenOn: string, outdated: boolean): Thread {
  return { ...thread(writtenOn, 1, 1), subject: 'FILE', outdated };
}

test('a file thread shows on the files header', () => {
  const file = fileThread('a1', false);

  expect(place(file, Screen.full('a2'))).toEqual(FILE);
  expect(place(file, Screen.between('a1', 'a3'))).toEqual(FILE);
});

test('an outdated file thread shows on the header only where its revision is on screen', () => {
  const file = fileThread('a1', true);

  expect(place(file, Screen.full('a1'))).toEqual(FILE);
  expect(place(file, Screen.between('a1', 'a3'))).toEqual(FILE);
  expect(place(file, Screen.full('a3'))).toEqual(OUTDATED);
});

test('a thread whose commit github lost shows only where it is now', () => {
  const current: Thread = { ...thread('a1', 10, 14), writtenOn: undefined };
  const outdated: Thread = { ...thread('a1', 10, undefined), writtenOn: undefined };

  expect(place(current, Screen.full('a3'))).toEqual(on(Lines.one(Line.right(14))));
  expect(place(current, Screen.full('a1'))).toEqual(NOT_ON_SCREEN);
  expect(place(outdated, Screen.full('a1'))).toEqual(OUTDATED);
});

test('a thread github has on an older commit shows on that commit only', () => {
  // Written on r2 at line 20 after r3 was pushed: GitHub keeps its `line` on r2, its first
  // comment's `commit`, until the next push, and gives it no `startLine`. r3 added four lines
  // above it, so r3's line 20 is other code.
  const older: Thread = { ...thread('a2', 20, 20), currentOn: 'a2', startLine: undefined };

  expect(place(older, Screen.full('a3'))).toEqual(NOT_ON_SCREEN);
  expect(place(older, Screen.full('a2'))).toEqual(on(Lines.one(Line.right(20))));
  expect(place(older, Screen.between('a2', 'a3'))).toEqual(on(Lines.one(Line.left(20))));
});

test('a thread is placed on its commit not on a newer head', () => {
  // Read while r3 was the latest; r4 has since been pushed, and GitHub hasn't moved it yet.
  const current = thread('a1', 10, 14);

  expect(place(current, Screen.full('a4'))).toEqual(NOT_ON_SCREEN);
  expect(place(current, Screen.between('a3', 'a4'))).toEqual(on(Lines.one(Line.left(14))));
});

test('a current thread whose commit github lost shows only where it was written', () => {
  const current: Thread = { ...thread('a1', 10, 14), currentOn: undefined };

  expect(place(current, Screen.full('a3'))).toEqual(NOT_ON_SCREEN);
  expect(place(current, Screen.full('a1'))).toEqual(on(Lines.one(Line.right(10))));
});
