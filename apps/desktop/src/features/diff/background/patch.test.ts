import { diffText } from '@lo/diff';
import { describe, expect, it } from 'vitest';

import { patchShown } from './patch.ts';

/** src/parser.ts in rozed-dev/e2e#78, as GitHub's list of the pull request's files gives it. */
const PARSER = [
  '@@ -4,9 +4,10 @@ export interface Line {',
  '   readonly text: string;',
  ' }',
  ' ',
  '-/** Splits `input` into lines, on `\\n`. */',
  '+/** Splits `input` into lines, on `\\n` or `\\r\\n`. Empty input has no lines. */',
  ' export function parse(input: string): Line[] {',
  "-  return input.split('\\n').map((text, index) => ({ number: index + 1, text }));",
  "+  if (input === '') return [];",
  '+  return input.split(/\\r?\\n/).map((text, index) => ({ number: index + 1, text }));',
  ' }',
  ' ',
  ' /** The lines of `input` that aren’t blank. */',
].join('\n');

/** The changes as rows can show them: which lines, on each side. */
const changes = (shown: { diff: { changes: { old: unknown; new: unknown }[] } }) =>
  shown.diff.changes.map((change) => ({ old: change.old, new: change.new }));

describe('GitHub’s diff', () => {
  it('draws a patch’s hunk at its real line numbers, with placeholders before it', () => {
    const shown = patchShown(PARSER);

    expect(shown.lines.old).toHaveLength(12);
    expect(shown.lines.new).toHaveLength(13);
    expect(shown.lines.old.slice(0, 3)).toEqual(['', '', '']);
    expect(shown.lines.new[3]).toBe('  readonly text: string;');
    expect(shown.gaps).toEqual([
      { side: 'old', from: 1, to: 3 },
      { side: 'new', from: 1, to: 3 },
    ]);
    expect(changes(shown)).toEqual([
      { old: { start: 7, end: 8 }, new: { start: 7, end: 8 } },
      { old: { start: 9, end: 10 }, new: { start: 9, end: 11 } },
    ]);
    // The words inside a change, at the file's line numbers.
    expect(shown.diff.changes[0]?.newWords.every((word) => word.line === 7)).toBe(true);
    expect(shown.diff.changes[0]?.newWords.length).toBeGreaterThan(0);
  });

  it('keeps the unchanged lines between hunks as placeholders, as many on each side', () => {
    const patch = [
      '@@ -1,2 +1,2 @@',
      '-a',
      '+A',
      ' b',
      '@@ -10,2 +10,3 @@',
      ' j',
      '+inserted',
      ' k',
    ].join('\n');
    const shown = patchShown(patch);

    expect(shown.gaps).toEqual([
      { side: 'old', from: 3, to: 9 },
      { side: 'new', from: 3, to: 9 },
    ]);
    expect(shown.lines.new.slice(9)).toEqual(['j', 'inserted', 'k']);
    expect(changes(shown)).toEqual([
      { old: { start: 1, end: 2 }, new: { start: 1, end: 2 } },
      { old: { start: 11, end: 11 }, new: { start: 11, end: 12 } },
    ]);
  });

  it('never diffs GitHub’s lines again, so a change shows only where GitHub put it', () => {
    // GitHub's diff swaps two lines as one change, which a diff of the same lines wouldn't.
    const patch = ['@@ -1,4 +1,4 @@', ' x', '-first', '-second', '+second', '+first', ' y'].join(
      '\n',
    );
    const shown = patchShown(patch);

    expect(changes(shown)).toEqual([{ old: { start: 2, end: 4 }, new: { start: 2, end: 4 } }]);
    const again = diffText(`${shown.lines.old.join('\n')}\n`, `${shown.lines.new.join('\n')}\n`);
    expect(changes({ diff: again })).not.toEqual(changes(shown));
  });

  it('draws an added file’s and a deleted file’s lines on their one side', () => {
    const added = patchShown(['@@ -0,0 +1,2 @@', '+one', '+two'].join('\n'));
    expect(added.lines).toEqual({ old: [], new: ['one', 'two'] });
    expect(added.gaps).toEqual([]);
    expect(changes(added)).toEqual([{ old: { start: 1, end: 1 }, new: { start: 1, end: 3 } }]);

    const deleted = patchShown(['@@ -1,2 +0,0 @@', '-one', '-two'].join('\n'));
    expect(deleted.lines).toEqual({ old: ['one', 'two'], new: [] });
    expect(changes(deleted)).toEqual([{ old: { start: 1, end: 3 }, new: { start: 1, end: 1 } }]);
  });

  it('says when a side has no newline at its end', () => {
    const shown = patchShown(
      ['@@ -1 +1 @@', '-old', '\\ No newline at end of file', '+new'].join('\n'),
    );
    expect(shown.diff.noNewlineAtEnd).toEqual({ old: true, new: false });
  });

  it('refuses a patch whose unchanged lines between hunks don’t pair up', () => {
    const patch = ['@@ -1,1 +1,1 @@', ' a', '@@ -5,1 +9,1 @@', ' e'].join('\n');
    expect(() => patchShown(patch)).toThrow(/differ in number/);
  });
});
