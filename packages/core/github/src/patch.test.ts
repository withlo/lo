import { expect, test } from 'vitest';

import { parsePatch, PatchError, type HunkLine, type Patch } from './patch.ts';

const unchanged = (text: string): HunkLine => ({ kind: 'unchanged', text });
const deleted = (text: string): HunkLine => ({ kind: 'deleted', text });
const added = (text: string): HunkLine => ({ kind: 'added', text });

/** The error `patch` fails to read with. */
function failure(patch: string): PatchError {
  try {
    parsePatch(patch);
  } catch (error) {
    if (error instanceof PatchError) return error;
    throw error;
  }
  throw new Error(`${JSON.stringify(patch)} read without an error`);
}

test('hunks give the rows each side covers', () => {
  const patch =
    '@@ -2,4 +2,5 @@ fn main() {\n     let a = 1;\n-    let b = 2;\n+    let b = 3;\n+    let c = 4;\n     println!();\n }\n@@ -40,3 +41,2 @@ fn other() {\n     one();\n-    two();\n     three();';
  expect(parsePatch(patch)).toEqual({
    hunks: [
      {
        old: { start: 1, end: 5 },
        new: { start: 1, end: 6 },
        lines: [
          unchanged('    let a = 1;'),
          deleted('    let b = 2;'),
          added('    let b = 3;'),
          added('    let c = 4;'),
          unchanged('    println!();'),
          unchanged('}'),
        ],
      },
      {
        old: { start: 39, end: 42 },
        new: { start: 40, end: 42 },
        lines: [unchanged('    one();'), deleted('    two();'), unchanged('    three();')],
      },
    ],
    oldMissingNewline: false,
    newMissingNewline: false,
  } satisfies Patch);
});

test('an added file covers no rows of the base', () => {
  const [hunk] = parsePatch('@@ -0,0 +1,2 @@\n+one\n+two').hunks;
  expect(hunk?.old).toEqual({ start: 0, end: 0 });
  expect(hunk?.new).toEqual({ start: 0, end: 2 });
});

test('a deleted file covers no rows of the head', () => {
  const [hunk] = parsePatch('@@ -1,2 +0,0 @@\n-one\n-two').hunks;
  expect(hunk?.old).toEqual({ start: 0, end: 2 });
  expect(hunk?.new).toEqual({ start: 0, end: 0 });
});

test('a missing count means one line', () => {
  const [addition] = parsePatch('@@ -0,0 +1 @@\n+Layer A of the stack fixture.').hunks;
  expect(addition?.new).toEqual({ start: 0, end: 1 });
  const [changed] = parsePatch('@@ -3 +3 @@\n-old\n+new').hunks;
  expect([changed?.old, changed?.new]).toEqual([
    { start: 2, end: 3 },
    { start: 2, end: 3 },
  ]);
});

test('lines inserted after a line sit after it', () => {
  // Two lines added after line 5 of the base, with no lines around them.
  const [hunk] = parsePatch('@@ -5,0 +6,2 @@\n+one\n+two').hunks;
  expect(hunk?.old).toEqual({ start: 5, end: 5 });
  expect(hunk?.new).toEqual({ start: 5, end: 7 });
});

test('a missing newline at the end is noted for its side', () => {
  const deletedLast = parsePatch('@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new');
  expect(deletedLast.oldMissingNewline).toBe(true);
  expect(deletedLast.newMissingNewline).toBe(false);
  expect(deletedLast.hunks[0]?.lines).toEqual([deleted('old'), added('new')]);

  const unchangedLast = parsePatch('@@ -1,2 +1,2 @@\n-a\n+b\n same\n\\ No newline at end of file');
  expect(unchangedLast.oldMissingNewline && unchangedLast.newMissingNewline).toBe(true);
});

test('carriage returns and empty unchanged lines read as los buffers have them', () => {
  const parsed = parsePatch('@@ -1,3 +1,3 @@\r\n a\r\n\n-b\r\n+c\r\n');
  expect(parsed.hunks[0]?.lines).toEqual([unchanged('a'), unchanged(''), deleted('b'), added('c')]);
});

test('a patch that doesnt add up is an error', () => {
  const short = failure('@@ -1,3 +1,3 @@\n a\n-b');
  expect(short.problem).toContain('short of its last hunk');
  expect(short.line).toBe(3);
  // The error names the last line, not the empty one after a final newline.
  expect(failure('@@ -1,4 +1,4 @@\n a\n-b\n').line).toBe(3);

  const long = failure('@@ -1 +1 @@\n-a\n+b\n+c');
  expect(long.line).toBe(4);
  expect(long.problem).toContain('more lines');

  expect(failure('Binary files differ').problem).toContain('hunk header');

  for (const header of ['@@ -a +1 @@', '@@ -1 1 @@', '@@ -1 +1', '@@ -0,1 +1 @@']) {
    expect(failure(`${header}\n x`).problem).toContain('hunk header');
  }

  expect(failure('@@ -1,2 +1,2 @@\n a\n b\n@@ -2 +2 @@\n b').problem).toContain('overlaps');

  expect(failure('@@ -1 +1 @@\n*a').problem).toContain('starts with');
});

test('an empty patch has no hunks', () => {
  expect(parsePatch('')).toEqual({
    hunks: [],
    oldMissingNewline: false,
    newMissingNewline: false,
  } satisfies Patch);
});
