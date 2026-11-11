import { expect, test } from 'vitest';

import { fit, plainTarget, type LineTarget, type Target } from './targets.ts';

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
