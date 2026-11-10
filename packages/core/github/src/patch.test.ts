import { expect, test } from 'vitest';

import { parsePatch, PatchError, type Hunk, type HunkLine, type Patch } from './patch.ts';

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

/** Lines joined into a patch, each ending with a newline. */
function joined(...lines: string[]): string {
  return lines.map((line) => `${line}\n`).join('');
}

/** The rows `start,count` covers in a hunk header. */
function headerRows(start: number, count: number) {
  return count === 0 ? { start, end: start } : { start: start - 1, end: start - 1 + count };
}

/** A hunk's rows on each side, from `@@ -oldStart +newStart @@`, and its lines' kinds. */
function expected(oldStart: number, newStart: number, kinds: HunkLine['kind'][]) {
  const count = (side: HunkLine['kind']) => kinds.filter((kind) => kind !== side).length;
  return {
    old: headerRows(oldStart, count('added')),
    new: headerRows(newStart, count('deleted')),
    kinds,
  };
}

/** The hunks `text` reads into, as {@link expected} gives them. */
function hunks(text: string) {
  return parsePatch(text).hunks.map((read: Hunk) => ({
    old: read.old,
    new: read.new,
    kinds: read.lines.map((line) => line.kind),
  }));
}

/** Where `text` fails to read, and why. */
function readError(text: string): { line: number; problem: string } {
  const { line, problem } = failure(text);
  return { line, problem };
}

test('a patch parses into its hunks', () => {
  // GitHub's patch for a file with two hunks: line 3 edited, and two lines added after line 20.
  const text = joined(
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
  const u = 'unchanged';
  expect(hunks(text)).toEqual([
    expected(1, 1, [u, u, 'deleted', 'added', u, u, u]),
    expected(18, 18, [u, u, u, 'added', 'added', u, u]),
  ]);
});

test('git headers and missing newline markers are skipped', () => {
  const text = joined(
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

  expect(hunks(text)).toEqual([expected(1, 1, ['deleted', 'added'])]);
  // A binary file's diff has a header and no hunks.
  const binary = joined(
    'diff --git a/logo.png b/logo.png',
    'Binary files a/logo.png and b/logo.png differ',
  );
  expect(hunks(binary)).toEqual([]);
});

function secondFile(line: number): { line: number; problem: string } {
  return { line, problem: "a second file's diff starts here, and a patch is one file's" };
}

test('a second files diff is an error', () => {
  // `git diff` output for two files.
  const git = joined(
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
  expect(readError(git)).toEqual(secondFile(7));
  // A plain unified diff for two files: the next file's `---` and `+++` follow a hunk.
  const plain = '@@ -1 +1 @@\n-a\n+b\n--- a/c\n+++ b/c\n@@ -4,0 +5 @@\n+d\n';
  expect(readError(plain)).toEqual(secondFile(4));
  // A pure rename has no hunks, so the next file follows its header.
  const rename = joined(
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
  expect(readError(rename)).toEqual(secondFile(5));
});

test('a removed line that looks like a header is a removed line', () => {
  // `-- a` removed, and `++ b` added: inside a hunk's counted lines, they're lines.
  const text = '@@ -1,2 +1,2 @@\n--- a\n+++ b\n x\n';

  expect(hunks(text)).toEqual([expected(1, 1, ['deleted', 'added', 'unchanged'])]);
  expect(parsePatch(text).hunks[0]?.lines.map((line) => line.text)).toEqual(['-- a', '++ b', 'x']);
});

test('a new file is one hunk of added lines', () => {
  const text = '@@ -0,0 +1,2 @@\n+fn main() {}\n+\n';

  expect(hunks(text)).toEqual([expected(0, 1, ['added', 'added'])]);
});

test('an unchanged line whose space was trimmed is still context', () => {
  const text = '@@ -1,3 +1,3 @@\n a\n\n-b\n+c\n';

  expect(hunks(text)).toEqual([expected(1, 1, ['unchanged', 'unchanged', 'deleted', 'added'])]);
});

test('a last blank line whose space was trimmed is still context', () => {
  const trimmed = [expected(1, 1, ['deleted', 'added', 'unchanged'])];

  // Trimmed, with the patch's last newline: as with any other trimmed blank line.
  expect(hunks('@@ -1,2 +1,2 @@\n-a\n+b\n\n')).toEqual(trimmed);
  // Trimmed, without it: the patch ends one unchanged line short.
  expect(hunks('@@ -1,2 +1,2 @@\n-a\n+b\n')).toEqual(trimmed);
  // GitHub's, untrimmed and without the last newline.
  expect(hunks('@@ -1,2 +1,2 @@\n-a\n+b\n ')).toEqual(trimmed);
});

test('a patch that is not a unified diff is an error', () => {
  expect(readError('@@ -1,2 +1,2\n a\n')).toEqual({
    line: 1,
    problem: '"@@ -1,2 +1,2" isn\'t a hunk header',
  });
  expect(readError('@@ -1,3 +1,3 @@\n a\n')).toEqual({
    line: 2,
    problem: 'the patch ends 1 line of the base and 1 of the head short of its last hunk',
  });
  expect(readError('@@ -1,2 +1,1 @@\n+a\n+b\n')).toEqual({
    line: 3,
    problem: 'the hunk has more lines than its header says',
  });
  expect(readError('@@ -1,2 +1,2 @@\n a\n*b\n')).toEqual({
    line: 3,
    problem: 'a hunk line starts with "*b"',
  });
});
