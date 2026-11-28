import { expect, test } from 'vitest';

import { fit, isOn, plainTarget, together, type LineTarget, type Target } from './targets.ts';

const line: LineTarget = { kind: 'line', at: { file: 'a.ts', side: 'new', line: 4 }, thread: 't1' };

test('a target fits a command that takes its kind as it is', () => {
  expect(fit(['line', 'file'], line)).toBe(line);
  expect(fit(['file'], { kind: 'file', file: 'b.ts' })).toEqual({ kind: 'file', file: 'b.ts' });
});

test('a line gives its file and its thread, and anything does for a command that takes nothing', () => {
  expect(fit(['file'], line)).toEqual({ kind: 'file', file: 'a.ts' });
  expect(fit(['thread'], line)).toEqual({ kind: 'thread', thread: 't1' });
  expect(fit(['thread'], { kind: 'line', at: line.at })).toBeUndefined();
  expect(fit(['none'], line)).toEqual({ kind: 'none' });
  // In the order the command lists its kinds.
  expect(fit(['thread', 'file'], line)).toEqual({ kind: 'thread', thread: 't1' });
  expect(fit(['tab', 'none'], line)).toEqual({ kind: 'none' });
});

test('a header gives its file, and is a line for no command', () => {
  const header: Target = { kind: 'header', file: 'a.ts', side: 'old' };
  expect(fit(['file'], header)).toEqual({ kind: 'file', file: 'a.ts' });
  expect(fit(['line'], header)).toBeUndefined();
  expect(fit(['line', 'header'], header)).toBe(header);
  expect(plainTarget({ ...header, extra: 1 } as Target)).toEqual(header);
});

test('a line or a header in a comment box gives the box, and nothing else does', () => {
  const inBox: LineTarget = { ...line, box: 'b1' };
  expect(fit(['box'], inBox)).toEqual({ kind: 'box', box: 'b1' });
  expect(fit(['box'], { kind: 'header', file: 'a.ts', side: 'new', box: 'b2' })).toEqual({
    kind: 'box',
    box: 'b2',
  });
  expect(fit(['box'], line)).toBeUndefined();
  expect(fit(['line', 'box'], inBox)).toBe(inBox);
  expect(plainTarget(inBox)).toEqual(inBox);
  expect(plainTarget({ kind: 'box', box: 'b1' })).toEqual({ kind: 'box', box: 'b1' });
});

test('a line under an overview note gives the note, where no thread or draft takes it', () => {
  const at = { file: 'a.ts', side: 'new', line: 4 } as const;
  const noted: LineTarget = { kind: 'line', at, note: true };
  expect(fit(['note'], noted)).toEqual({ kind: 'note', at });
  expect(isOn(noted, 'note')).toBe(true);
  expect(fit(['note'], { ...noted, thread: 't1' })).toBeUndefined();
  expect(fit(['note'], { ...noted, draft: true })).toBeUndefined();
  expect(fit(['note'], { kind: 'line', at })).toBeUndefined();
  expect(fit(['note'], { ...noted, at: { file: 'a.ts', side: 'new', from: 3, to: 4 } })).toBe(
    undefined,
  );
  // One of the popover's notes, by its key, is as it is.
  const one: Target = { kind: 'note', at, note: 'n1' };
  expect(fit(['note'], one)).toBe(one);
  expect(plainTarget({ ...one, extra: 1 } as Target)).toEqual(one);
  expect(plainTarget(noted)).toEqual(noted);
});

test('a thread, a draft and a note are never on one line together, so their keys may be the same', () => {
  expect(together('thread', 'note')).toBe(false);
  expect(together('draft', 'note')).toBe(false);
  expect(together('note', 'note')).toBe(true);
  expect(together('line', 'note')).toBe(true);
});

test('a line with a draft’s mark gives the draft, but where it gives a thread, or is lines', () => {
  const at = { file: 'a.ts', side: 'new', line: 4 } as const;
  const drafted: LineTarget = { kind: 'line', at, draft: true };
  expect(fit(['draft'], drafted)).toEqual({ kind: 'draft', at });
  expect(isOn(drafted, 'draft')).toBe(true);
  expect(fit(['draft'], { ...drafted, thread: 't1' })).toBeUndefined();
  expect(isOn({ ...drafted, thread: 't1' }, 'draft')).toBe(false);
  expect(fit(['draft'], { kind: 'line', at })).toBeUndefined();
  const lines: LineTarget = {
    kind: 'line',
    at: { file: 'a.ts', side: 'new', from: 3, to: 4 },
    draft: true,
  };
  expect(fit(['draft'], lines)).toBeUndefined();
  expect(plainTarget(drafted)).toEqual(drafted);
  expect(plainTarget({ kind: 'draft', at })).toEqual({ kind: 'draft', at });
});

test('a target that fits none of the kinds is refused', () => {
  expect(fit(['line'], { kind: 'none' })).toBeUndefined();
  expect(fit(['block'], line)).toBeUndefined();
  expect(fit(['file'], { kind: 'tab', tab: 'x' })).toBeUndefined();
});

test('a plain copy keeps a target’s own fields and nothing else', () => {
  const span: Target = { kind: 'line', at: { file: 'a.ts', side: 'old', from: 3, to: 9 } };
  expect(plainTarget(span)).toEqual(span);
  expect(
    plainTarget({ kind: 'line', at: { file: 'a.ts', side: 'old', line: 1, column: 2 } }),
  ).toEqual({
    kind: 'line',
    at: { file: 'a.ts', side: 'old', line: 1, column: 2 },
  });
  const extra = Object.assign({ kind: 'block', block: 'b1' } as const, { node: { remove() {} } });
  expect(plainTarget(extra)).toEqual({ kind: 'block', block: 'b1' });
  // A kind from a caller that broke the types.
  const unknownKind: Target = JSON.parse('{ "kind": "editor" }');
  expect(() => plainTarget(unknownKind)).toThrow('A target of an unknown kind.');
});

test('a key acts on a thread that is its target, or on a line with one, but not on a header', () => {
  const at = { file: 'a', side: 'new' as const, line: 3 };
  expect(isOn({ kind: 'thread', thread: 't' }, 'thread')).toBe(true);
  expect(isOn({ kind: 'line', at, thread: 't' }, 'thread')).toBe(true);
  expect(isOn({ kind: 'line', at }, 'thread')).toBe(false);
  expect(isOn({ kind: 'header', file: 'a', side: 'new', thread: 't' }, 'thread')).toBe(false);
});

test('a term’s row is on a row for a key, but gives no row to what takes one', () => {
  const row = { kind: 'term', term: 'bucket', block: 'b1', row: true } as const;
  const used = { kind: 'term', term: 'bucket', block: 'b1' } as const;
  expect(isOn(row, 'row')).toBe(true);
  expect(isOn(used, 'row')).toBe(false);
  expect(isOn(row, 'term')).toBe(true);
  expect(fit(['row'], row)).toBeUndefined();
  expect(fit(['row', 'none'], row)).toEqual({ kind: 'none' });
  expect(plainTarget({ ...row, extra: 1 } as Target)).toEqual(row);
  expect(plainTarget(used)).toEqual(used);
});
