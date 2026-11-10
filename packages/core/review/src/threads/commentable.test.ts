import { parsePatch, type Hunk } from '@lo/github';
import { expect, test } from 'vitest';

import { Line, Lines } from '../threads.ts';
import { CommentableLines, type CommentRange } from './commentable.ts';
import { Screen } from './place.ts';
import { takesSuggestion } from './suggestion.ts';

/** Lines joined into a patch, each ending with a newline. */
function patch(...lines: string[]): string {
  return lines.map((line) => `${line}\n`).join('');
}

/**
 * GitHub's `patch` for a file with two hunks: line 3 edited, and two lines added after line 20.
 * Its unchanged blank lines keep their space.
 */
const PATCH = patch(
  '@@ -1,6 +1,6 @@',
  ' use std::fmt;',
  ' ',
  '-fn parse(input: &str) -> u32 {',
  '+fn parse(input: &str) -> Option<u32> {',
  '     let trimmed = input.trim();',
  '     trimmed.len()',
  ' }',
  '@@ -18,5 +18,7 @@ impl Parser {',
  '     fn next(&mut self) {',
  '         self.at += 1;',
  '     }',
  '+',
  '+    fn peek(&self) {}',
  ' }',
  ' ',
);

function hunks(): Hunk[] {
  return parsePatch(PATCH).hunks;
}

function full(): CommentableLines {
  return CommentableLines.inDiff(Screen.full('a2'), hunks());
}

function between(): CommentableLines {
  return CommentableLines.inDiff(Screen.between('a1', 'a2'), hunks());
}

function ok(lines: Lines): CommentRange {
  return { kind: 'lines', lines };
}

function notCommentable(line: Line): CommentRange {
  return { kind: 'notCommentable', line };
}

test('an added line takes a comment on the right', () => {
  expect(full().line(Line.right(3))).toEqual(Lines.one(Line.right(3)));
  expect(full().line(Line.right(21))).toEqual(Lines.one(Line.right(21)));
});

test('a removed line takes a comment on the left', () => {
  expect(full().line(Line.left(3))).toEqual(Lines.one(Line.left(3)));
});

test('an unchanged line in a hunk takes a comment in either column on the right', () => {
  // On the right, GitHub's side for unchanged lines: the thread then shows between revisions,
  // and takes a suggestion.
  expect(full().line(Line.left(1))).toEqual(Lines.one(Line.right(1)));
  expect(full().line(Line.right(1))).toEqual(Lines.one(Line.right(1)));
  // Line 20 on the left is line 20 on the right, and line 21 is 23: the hunk adds two lines
  // between them.
  expect(full().line(Line.left(20))).toEqual(Lines.one(Line.right(20)));
  expect(full().line(Line.left(21))).toEqual(Lines.one(Line.right(23)));
  expect(full().line(Line.right(24))).toEqual(Lines.one(Line.right(24)));
  expect(takesSuggestion(full().line(Line.left(22))!)).toBe(true);
});

test('a range picked in the left column puts its unchanged ends on the right', () => {
  // Unchanged lines 4 to 6, picked on the left.
  expect(full().range(Line.left(4), Line.left(6))).toEqual(
    ok(Lines.range(Line.right(4), Line.right(6))),
  );
  // The same unchanged line picked in both columns is one line.
  expect(full().range(Line.left(1), Line.right(1))).toEqual(ok(Lines.one(Line.right(1))));
  // A removed line keeps the left side.
  expect(full().range(Line.left(1), Line.left(3))).toEqual(
    ok(Lines.range(Line.right(1), Line.left(3))),
  );
});

test('ranges over a replaced line between unchanged ones', () => {
  const replaced = parsePatch('@@ -1,3 +1,3 @@\n a\n-b\n+c\n d\n').hunks;
  const lines = CommentableLines.inDiff(Screen.full('a2'), replaced);

  expect(lines.range(Line.left(1), Line.right(1))).toEqual(ok(Lines.one(Line.right(1))));
  expect(lines.range(Line.right(1), Line.left(2))).toEqual(
    ok(Lines.range(Line.right(1), Line.left(2))),
  );
  expect(lines.range(Line.right(3), Line.left(1))).toEqual(
    ok(Lines.range(Line.right(1), Line.right(3))),
  );
  expect(lines.range(Line.left(3), Line.left(2))).toEqual(
    ok(Lines.range(Line.left(2), Line.right(3))),
  );
});

test('a line outside the hunks takes no comment', () => {
  expect(full().line(Line.right(7))).toBeUndefined();
  expect(full().line(Line.right(17))).toBeUndefined();
  expect(full().line(Line.right(25))).toBeUndefined();
  expect(full().line(Line.left(23))).toBeUndefined();
  expect(full().line(Line.right(0))).toBeUndefined();
});

test('between revisions only the right column takes comments', () => {
  expect(between().line(Line.left(3))).toBeUndefined();
  expect(between().line(Line.left(1))).toBeUndefined();
  expect(between().line(Line.right(3))).toEqual(Lines.one(Line.right(3)));

  const replayed = CommentableLines.inDiff(Screen.replayed('a1', 'a2'), hunks());
  expect(replayed.line(Line.left(3))).toBeUndefined();
  expect(replayed.line(Line.right(3))).toEqual(Lines.one(Line.right(3)));
});

test('a file with no hunks takes only file comments', () => {
  // A binary file, or a pure rename.
  const binary = CommentableLines.inDiff(Screen.full('a2'), []);

  expect(binary.takesFileComment()).toBe(true);
  expect(binary.takesLineComment()).toBe(false);
  expect(binary.line(Line.right(1))).toBeUndefined();
  expect(full().takesFileComment()).toBe(true);
  expect(full().takesLineComment()).toBe(true);
  // Between revisions, a deleted file has no right column.
  const deleted = CommentableLines.inDiff(
    Screen.between('a1', 'a2'),
    parsePatch('@@ -1,2 +0,0 @@\n-a\n-b\n').hunks,
  );
  expect(deleted.takesFileComment()).toBe(true);
  expect(deleted.takesLineComment()).toBe(false);
});

test('a file outside the pull requests diff takes no comment', () => {
  // r1 edited it and r2 put it back, so it's between r1 and r2 but not in r2's diff.
  const reverted = CommentableLines.notInDiff();

  expect(reverted.takesFileComment()).toBe(false);
  expect(reverted.takesLineComment()).toBe(false);
  expect(reverted.line(Line.right(1))).toBeUndefined();
  expect(reverted.range(Line.right(1), Line.right(2))).toEqual(notCommentable(Line.right(1)));
});

test('a range within a hunk takes a comment', () => {
  expect(full().range(Line.right(19), Line.right(22))).toEqual(
    ok(Lines.range(Line.right(19), Line.right(22))),
  );
});

test('a range selected upwards starts at its top', () => {
  expect(full().range(Line.right(22), Line.right(19))).toEqual(
    ok(Lines.range(Line.right(19), Line.right(22))),
  );
});

test('a range can run from a removed line to the added line after it', () => {
  expect(full().range(Line.left(3), Line.right(3))).toEqual(
    ok(Lines.range(Line.left(3), Line.right(3))),
  );
  // Selected upwards in the inline view: the added line comes after the removed one.
  expect(full().range(Line.right(4), Line.left(3))).toEqual(
    ok(Lines.range(Line.left(3), Line.right(4))),
  );
  // The unchanged line before them is above both, and on the right.
  expect(full().range(Line.right(3), Line.left(2))).toEqual(
    ok(Lines.range(Line.right(2), Line.right(3))),
  );
});

test('a range of one line is that line', () => {
  expect(full().range(Line.right(21), Line.right(21))).toEqual(ok(Lines.one(Line.right(21))));
});

test('a range can span hunks', () => {
  expect(full().range(Line.right(5), Line.right(19))).toEqual(
    ok(Lines.range(Line.right(5), Line.right(19))),
  );
  // Selected upwards: the later hunk's line is the range's end.
  expect(full().range(Line.right(22), Line.right(4))).toEqual(
    ok(Lines.range(Line.right(4), Line.right(22))),
  );
  // From a removed line in the first hunk to an added line in the second.
  expect(full().range(Line.right(21), Line.left(3))).toEqual(
    ok(Lines.range(Line.left(3), Line.right(21))),
  );
});

test('a range spanning hunks needs both ends in one', () => {
  // Line 10 is between the hunks.
  expect(full().range(Line.right(5), Line.right(10))).toEqual(notCommentable(Line.right(10)));
  expect(full().range(Line.right(10), Line.right(19))).toEqual(notCommentable(Line.right(10)));
});

test('a range ending outside the hunks takes no comment', () => {
  expect(full().range(Line.right(5), Line.right(8))).toEqual(notCommentable(Line.right(8)));
  expect(between().range(Line.left(1), Line.right(3))).toEqual(notCommentable(Line.left(1)));
});
