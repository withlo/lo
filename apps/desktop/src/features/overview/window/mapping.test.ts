// Mapping an overview's lines, at the commit it describes, onto the head on screen: lines that
// moved as lines above them came and went, renamed files, deleted lines, a file deleted at the
// head, and one that isn't text there; which lines of a block changed, from a real diff of the
// two texts, as the diff's background job makes it; and where a comment on a block's lines goes.

import { diffText } from '@lo/diff';
import { describe, expect, it } from 'vitest';

import type { DiffedText } from '../../diff/window/shared.ts';
import {
  blockChange,
  commentOnHead,
  fileSinceOf,
  lineOnHead,
  linesIn,
  onHead,
  runsOnHead,
  type FileSince,
} from './mapping.ts';

/** `old` and `now`, diffed as the diff's job diffs texts. */
function diffed(old: string, now: string): DiffedText {
  return {
    ok: true,
    diff: diffText(old, now, { whitespace: true }),
    tokens: {},
    changes: { deleted: [], added: [] },
  };
}

/** A file at `path` changed from `old` to `now`, by the pushes since unless `pushed` says not. */
function changed(old: string, now: string, path = 'src/a.ts', pushed = true): FileSince {
  return fileSinceOf({ kind: 'changed', path, pushed, texts: { old, new: now } }, diffed(old, now));
}

/** `count` numbered lines, `line 1` on. */
function numbered(count: number, from = 1): string[] {
  return Array.from({ length: count }, (_, at) => `line ${from + at}`);
}

const text = (lines: readonly string[]) => `${lines.join('\n')}\n`;

describe('lineOnHead', () => {
  it('maps lines that moved as lines above them came and went', () => {
    const old = numbered(10);
    // Two lines added at the top, line 4 deleted.
    const now = ['new a', 'new b', ...old.slice(0, 3), ...old.slice(4)];
    const since = changed(text(old), text(now));
    expect(lineOnHead(since, 1)).toBe(3);
    expect(lineOnHead(since, 3)).toBe(5);
    expect(lineOnHead(since, 4)).toBeUndefined();
    expect(lineOnHead(since, 5)).toBe(6);
    expect(lineOnHead(since, 10)).toBe(11);
  });

  it('maps no line that changed, or was deleted, and none moved away', () => {
    const old = numbered(8);
    // Lines 2–3 moved below line 8: a line diff sees them deleted and added again.
    const now = [old[0] ?? '', ...old.slice(3), old[1] ?? '', old[2] ?? ''];
    const since = changed(text(old), text(now));
    expect(lineOnHead(since, 1)).toBe(1);
    expect(lineOnHead(since, 2)).toBeUndefined();
    expect(lineOnHead(since, 3)).toBeUndefined();
    expect(lineOnHead(since, 4)).toBe(2);
    expect(lineOnHead(since, 8)).toBe(6);
  });

  it('maps every line of a file that’s the same, renamed or not', () => {
    const since = fileSinceOf({ kind: 'same', path: 'src/b.ts' }, undefined);
    expect(lineOnHead(since, 12)).toBe(12);
    expect(onHead(since, 'src/a.ts', { start: 12, end: 14 })).toEqual({
      path: 'src/b.ts',
      line: 12,
      lines: { from: 12, to: 14 },
    });
  });

  it('maps no line of a file deleted at the head, or one that isn’t text there', () => {
    const deleted = fileSinceOf({ kind: 'deleted' }, undefined);
    expect(lineOnHead(deleted, 1)).toBeUndefined();
    expect(onHead(deleted, 'src/a.ts', { start: 1, end: 2 })).toBeUndefined();
    const binary = fileSinceOf(
      { kind: 'changed', path: 'logo.png', pushed: true, texts: { why: 'It isn’t text.' } },
      undefined,
    );
    expect(binary).toEqual({
      kind: 'opaque',
      path: 'logo.png',
      pushed: true,
      why: 'It isn’t text.',
    });
    expect(lineOnHead(binary, 1)).toBeUndefined();
    expect(onHead(binary, 'logo.png', { start: 1, end: 2 })).toEqual({
      path: 'logo.png',
      line: undefined,
      lines: undefined,
    });
  });

  it('says it can’t compare a file whose diff failed', () => {
    expect(
      fileSinceOf(
        { kind: 'changed', path: 'a.ts', pushed: true, texts: { old: 'a\n', new: 'b\n' } },
        { ok: false, why: 'The diff took too long.' },
      ),
    ).toEqual({ kind: 'opaque', path: 'a.ts', pushed: true, why: 'The diff took too long.' });
  });
});

describe('runsOnHead', () => {
  it('marks the lines still there, split where lines went or were added among them', () => {
    const old = numbered(12);
    // Line 5 changed, line 8 deleted, and a line added after line 10.
    const now = [
      ...old.slice(0, 4),
      'changed 5',
      ...old.slice(5, 7),
      ...old.slice(8, 10),
      'added',
      ...old.slice(10),
    ];
    const since = changed(text(old), text(now), 'src/b.ts');
    expect(runsOnHead(since, { start: 3, end: 12 })).toEqual({
      path: 'src/b.ts',
      // 3–4; 6–7 and 9–10, one run once line 8 is gone; then 11–12 after the line added.
      runs: [
        { from: 3, to: 4 },
        { from: 6, to: 9 },
        { from: 11, to: 12 },
      ],
    });
    // A block whose every line changed marks nothing.
    expect(runsOnHead(since, { start: 5, end: 5 })).toEqual({ path: 'src/b.ts', runs: [] });
  });

  it('marks a file the same, renamed or not, as written', () => {
    expect(runsOnHead({ kind: 'same', path: 'src/b.ts' }, { start: 2, end: 4 })).toEqual({
      path: 'src/b.ts',
      runs: [{ from: 2, to: 4 }],
    });
  });

  it('marks nothing of a file gone, one whose lines can’t be compared, or one Lo can’t tell', () => {
    const lines = { start: 1, end: 3 };
    expect(runsOnHead({ kind: 'deleted' }, lines)).toBeUndefined();
    expect(
      runsOnHead({ kind: 'opaque', path: 'a.png', pushed: true, why: 'Not text.' }, lines),
    ).toBeUndefined();
    expect(runsOnHead({ kind: 'unknown', why: 'Offline.' }, lines)).toBeUndefined();
  });
});

describe('onHead', () => {
  it('follows a renamed file to its new path, its lines mapped', () => {
    const old = numbered(10);
    const now = ['added', ...old];
    const since = changed(text(old), text(now), 'src/b.ts');
    expect(onHead(since, 'src/a.ts', { start: 4, end: 6 })).toEqual({
      path: 'src/b.ts',
      line: 5,
      lines: { from: 5, to: 7 },
    });
  });

  it('goes to what replaced a block’s first line when it changed', () => {
    const old = numbered(10);
    const now = [...old.slice(0, 3), 'changed 4', ...old.slice(4)];
    const since = changed(text(old), text(now));
    expect(onHead(since, 'src/a.ts', { start: 4, end: 5 })).toMatchObject({
      line: 4,
      lines: { from: 4, to: 5 },
    });
    // A block whose lines were all deleted lands where they were.
    const gone = [...old.slice(0, 3), ...old.slice(6)];
    expect(onHead(changed(text(old), text(gone)), 'src/a.ts', { start: 4, end: 6 })).toMatchObject({
      line: 4,
      lines: { from: 4, to: 4 },
    });
  });

  it('keeps what’s written while the file isn’t known, or Lo can’t tell', () => {
    const written = { path: 'src/a.ts', line: 3, lines: { from: 3, to: 4 } };
    expect(onHead(undefined, 'src/a.ts', { start: 3, end: 4 })).toEqual(written);
    expect(onHead({ kind: 'unknown', why: 'Offline.' }, 'src/a.ts', { start: 3, end: 4 })).toEqual(
      written,
    );
  });
});

describe('commentOnHead', () => {
  it('keeps the lines as they are where the head is the overview’s commit, either side', () => {
    const lines = { side: 'old' as const, from: 6, to: 4 };
    expect(commentOnHead('same', 'src/a.ts', lines)).toEqual({
      kind: 'lines',
      path: 'src/a.ts',
      side: 'old',
      from: 4,
      to: 6,
    });
  });

  it('maps the newer side’s lines where each is there unchanged, in a row, at the new path', () => {
    const old = numbered(10);
    const now = ['added', ...old];
    const since = changed(text(old), text(now), 'src/b.ts');
    expect(commentOnHead(since, 'src/a.ts', { side: 'new', from: 4, to: 6 })).toEqual({
      kind: 'lines',
      path: 'src/b.ts',
      side: 'new',
      from: 5,
      to: 7,
    });
    // The base under the older side may have moved since.
    expect(commentOnHead(since, 'src/a.ts', { side: 'old', from: 4, to: 6 })).toEqual({
      kind: 'file',
      path: 'src/b.ts',
    });
  });

  it('goes on the file where a line changed, or one was added between them', () => {
    const old = numbered(10);
    const changedLine = [...old.slice(0, 4), 'changed 5', ...old.slice(5)];
    expect(
      commentOnHead(changed(text(old), text(changedLine)), 'src/a.ts', {
        side: 'new',
        from: 4,
        to: 6,
      }),
    ).toEqual({ kind: 'file', path: 'src/a.ts' });
    const between = [...old.slice(0, 4), 'added', ...old.slice(4)];
    expect(
      commentOnHead(changed(text(old), text(between)), 'src/a.ts', {
        side: 'new',
        from: 4,
        to: 6,
      }),
    ).toEqual({ kind: 'file', path: 'src/a.ts' });
  });

  it('goes on the file while Lo can’t tell, and nowhere on it once it’s gone', () => {
    const lines = { side: 'new' as const, from: 1, to: 2 };
    expect(commentOnHead({ kind: 'unknown', why: 'Offline.' }, 'src/a.ts', lines)).toEqual({
      kind: 'file',
      path: 'src/a.ts',
    });
    expect(
      commentOnHead(
        { kind: 'opaque', path: 'src/b.bin', pushed: true, why: 'Binary.' },
        'src/a.ts',
        lines,
      ),
    ).toEqual({ kind: 'file', path: 'src/b.bin' });
    expect(commentOnHead({ kind: 'deleted' }, 'src/a.ts', lines)).toEqual({ kind: 'gone' });
  });
});

describe('blockChange', () => {
  // rozed-dev/e2e#80's parser, at its first push and its second.
  const first = [
    '/** A line of input: its number, from 1, and its text. */',
    'export interface Line {',
    '  readonly number: number;',
    '  readonly text: string;',
    '}',
    '',
    '/** Splits `input` into lines, on `\\n` or `\\r\\n`. */',
    'export function parse(input: string): Line[] {',
    '  return input.split(/\\r?\\n/).map((text, index) => ({ number: index + 1, text }));',
    '}',
  ];
  const second = [
    ...first.slice(0, 6),
    '/** Splits `input` into lines, on `\\n` or `\\r\\n`. Empty input has no lines. */',
    first[7] ?? '',
    "  if (input === '') return [];",
    ...first.slice(8),
  ];
  const since = changed(text(first), text(second), 'src/parser.ts');

  it('names the lines a block shows that changed, and where lines were added inside it', () => {
    expect(blockChange(since, { start: 7, end: 10 })).toEqual({
      kind: 'lines',
      changed: [{ from: 7, to: 7 }],
      added: [8],
      addedLines: 1,
    });
    // Lines added just past its last line aren't in it.
    expect(blockChange(since, { start: 7, end: 8 })).toEqual({
      kind: 'lines',
      changed: [{ from: 7, to: 7 }],
      added: [],
      addedLines: 0,
    });
    expect(blockChange(since, { start: 8, end: 10 })).toEqual({
      kind: 'lines',
      changed: [],
      added: [8],
      addedLines: 1,
    });
    expect(blockChange(since, { start: 1, end: 5 })).toEqual({ kind: 'none' });
  });

  it('names deleted lines as changed, and marks each in the excerpt', () => {
    const old = numbered(10);
    const now = [...old.slice(0, 2), ...old.slice(5)];
    const change = blockChange(changed(text(old), text(now)), { start: 2, end: 7 });
    expect(change).toEqual({
      kind: 'lines',
      changed: [{ from: 3, to: 5 }],
      added: [],
      addedLines: 0,
    });
    expect(change.kind === 'lines' && linesIn(change.changed)).toEqual([3, 4, 5]);
  });

  it('flags a file deleted at the head, and one that isn’t text there', () => {
    expect(blockChange({ kind: 'deleted' }, { start: 1, end: 3 })).toEqual({ kind: 'deleted' });
    expect(
      blockChange(
        { kind: 'opaque', path: 'a.png', pushed: true, why: 'It isn’t text.' },
        {
          start: 1,
          end: 3,
        },
      ),
    ).toEqual({ kind: 'opaque' });
  });

  it('flags nothing only the base branch changed, or that Lo can’t tell', () => {
    const base = changed(text(first), text(second), 'src/parser.ts', false);
    expect(blockChange(base, { start: 7, end: 10 })).toEqual({ kind: 'none' });
    expect(
      blockChange(
        { kind: 'opaque', path: 'a.png', pushed: false, why: 'It isn’t text.' },
        {
          start: 1,
          end: 3,
        },
      ),
    ).toEqual({ kind: 'none' });
    expect(blockChange({ kind: 'unknown', why: 'Offline.' }, { start: 1, end: 3 })).toEqual({
      kind: 'none',
    });
    expect(blockChange({ kind: 'same', path: 'b.ts' }, { start: 1, end: 3 })).toEqual({
      kind: 'none',
    });
  });

  it('keeps only the runs of lines that changed, never the texts', () => {
    expect(JSON.stringify(since)).not.toContain('Splits');
  });
});
