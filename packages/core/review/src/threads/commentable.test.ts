import { expect, test } from 'vitest';

import { Line, Lines } from '../threads.ts';
import { CommentableLines, PatchHunk, PatchError, type CommentRange } from './commentable.ts';
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

function hunks(): PatchHunk[] {
  return PatchHunk.parse(PATCH);
}

function full(): CommentableLines {
  return CommentableLines.inDiff(Screen.full('a2'), hunks());
}

function between(): CommentableLines {
  return CommentableLines.inDiff(Screen.between('a1', 'a2'), hunks());
}

/** Why `text` doesn't parse. */
function parseError(text: string): { line: number; reason: string } {
  try {
    PatchHunk.parse(text);
  } catch (error) {
    if (!(error instanceof PatchError)) throw error;
    return { line: error.line, reason: error.reason };
  }
  throw new Error('the patch parsed');
}

function ok(lines: Lines): CommentRange {
  return { kind: 'lines', lines };
}

function notCommentable(line: Line): CommentRange {
  return { kind: 'notCommentable', line };
}

test('a patch parses into its hunks', () => {
  expect(hunks()).toEqual([
    PatchHunk.of(1, 1, ['context', 'context', 'removed', 'added', 'context', 'context', 'context']),
    PatchHunk.of(18, 18, ['context', 'context', 'context', 'added', 'added', 'context', 'context']),
  ]);
});

test('git headers and missing newline markers are skipped', () => {
  const text = patch(
    'diff --git a/README.md b/README.md',
    'index 3b18e51..a7c3d2f 100644',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1 +1 @@',
    '-Lo',
    '\\ No newline at end of file',
    '+Lo reads pull requests.',
    '\\ No newline at end of file',
  );

  expect(PatchHunk.parse(text)).toEqual([PatchHunk.of(1, 1, ['removed', 'added'])]);
});

function secondFile(line: number): { line: number; reason: string } {
  return { line, reason: "a second file's diff starts here, and a patch is one file's" };
}

test('a second files diff is an error', () => {
  // `git diff` output for two files.
  const git = patch(
    'diff --git a/a.rs b/a.rs',
    '--- a/a.rs',
    '+++ b/a.rs',
    '@@ -1 +1 @@',
    '-a',
    '+b',
    'diff --git a/c.rs b/c.rs',
    '--- a/c.rs',
    '+++ b/c.rs',
    '@@ -40,3 +40,4 @@',
    ' x',
    '+y',
    ' z',
    ' w',
  );
  expect(parseError(git)).toEqual(secondFile(7));
  // A plain unified diff for two files: the next file's `---` and `+++` follow a hunk.
  const plain = '@@ -1 +1 @@\n-a\n+b\n--- a/c\n+++ b/c\n@@ -4,0 +5 @@\n+d\n';
  expect(parseError(plain)).toEqual(secondFile(4));
  // A pure rename has no hunks, so the next file follows its header.
  const rename = patch(
    'diff --git a/x.rs b/y.rs',
    'similarity index 100%',
    'rename from x.rs',
    'rename to y.rs',
    'diff --git a/c.rs b/c.rs',
    '--- a/c.rs',
    '+++ b/c.rs',
    '@@ -1 +1 @@',
    '-a',
    '+b',
  );
  expect(parseError(rename)).toEqual(secondFile(5));
});

test('a removed line that looks like a header is a removed line', () => {
  // `-- a` removed, and `++ b` added: inside a hunk's counted lines, they're lines.
  const text = '@@ -1,2 +1,2 @@\n--- a\n+++ b\n x\n';

  expect(PatchHunk.parse(text)).toEqual([PatchHunk.of(1, 1, ['removed', 'added', 'context'])]);
});

test('a new file is one hunk of added lines', () => {
  const text = '@@ -0,0 +1,2 @@\n+fn main() {}\n+\n';

  expect(PatchHunk.parse(text)).toEqual([PatchHunk.of(0, 1, ['added', 'added'])]);
});

test('an unchanged line whose space was trimmed is still context', () => {
  const text = '@@ -1,3 +1,3 @@\n a\n\n-b\n+c\n';

  expect(PatchHunk.parse(text)).toEqual([
    PatchHunk.of(1, 1, ['context', 'context', 'removed', 'added']),
  ]);
});

test('a last blank line whose space was trimmed is still context', () => {
  const hunk = PatchHunk.of(1, 1, ['removed', 'added', 'context']);

  // Trimmed, with the patch's last newline: as with any other trimmed blank line.
  expect(PatchHunk.parse('@@ -1,2 +1,2 @@\n-a\n+b\n\n')).toEqual([hunk]);
  // Trimmed, without it: the patch ends one unchanged line short.
  expect(PatchHunk.parse('@@ -1,2 +1,2 @@\n-a\n+b\n')).toEqual([hunk]);
  // GitHub's, untrimmed and without the last newline.
  expect(PatchHunk.parse('@@ -1,2 +1,2 @@\n-a\n+b\n ')).toEqual([hunk]);
});

test('a patch that is not a unified diff is an error', () => {
  expect(parseError('@@ -1,2 +1,2\n a\n')).toEqual({
    line: 1,
    reason: "the hunk header isn't `@@ -start,count +start,count @@`",
  });
  expect(parseError('@@ -1,3 +1,3 @@\n a\n')).toEqual({
    line: 2,
    reason: 'the patch ends inside a hunk',
  });
  expect(parseError('@@ -1,2 +1,1 @@\n+a\n+b\n')).toEqual({
    line: 3,
    reason: 'the hunk has more lines than its header says',
  });
  expect(parseError('@@ -1,2 +1,2 @@\n a\n*b\n')).toEqual({
    line: 3,
    reason: 'a hunk line starts with something other than ` `, `-`, `+` or `\\`',
  });
});

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
  const replaced = PatchHunk.parse('@@ -1,3 +1,3 @@\n a\n-b\n+c\n d\n');
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
    PatchHunk.parse('@@ -1,2 +0,0 @@\n-a\n-b\n'),
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
