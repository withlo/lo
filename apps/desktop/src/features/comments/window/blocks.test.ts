// Threads on an overview's code blocks: under their lines of the block's file at the commit the
// overview describes, on the side they're on, open while unresolved; none on another file, on a
// file as a whole, or on another commit's lines; and for a stack's layer, none on its base side.

import { expect, test } from 'vitest';

import type { DrawnBlock } from '../../overview/window/shared.ts';
import type { ThreadRow } from '../contract.ts';
import { threadsOnBlock } from './blocks.ts';

const HEAD = 'h'.repeat(40);
const OLDER = 'o'.repeat(40);
const LOWER = 'l'.repeat(40);

/** A thread on `src/cost.ts`'s line 5, on the head's side, written on the head. */
function row(overrides: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id: 'T1',
    path: 'src/cost.ts',
    subject: 'LINE',
    side: 'RIGHT',
    startSide: null,
    line: 5,
    startLine: null,
    originalLine: 5,
    originalStartLine: null,
    outdated: false,
    resolved: false,
    currentOn: HEAD,
    writtenOn: HEAD,
    comments: [],
    viewerCanReply: true,
    viewerCanResolve: true,
    viewerCanUnresolve: false,
    ...overrides,
  };
}

/** A block of the overview of `HEAD` that shows `src/cost.ts`'s lines 3 to 6. */
function block(overrides: Partial<DrawnBlock> = {}): DrawnBlock {
  return {
    tab: 'v1',
    key: 'k',
    block: '1.4',
    file: 'overview-code1',
    path: 'src/cost.ts',
    commit: HEAD,
    from: null,
    lines: { start: 3, end: 6 },
    ...overrides,
  };
}

test('a block shows the threads on its file’s lines at its commit, on their side', () => {
  const rows = [
    row(),
    row({ id: 'T2', side: 'LEFT', line: 4, originalLine: 4, resolved: true }),
    row({ id: 'T3', startLine: 3, startSide: 'RIGHT', originalStartLine: 3, line: 6 }),
  ];
  expect(threadsOnBlock(rows, block())).toEqual([
    {
      id: 'T1',
      at: { file: 'overview-code1', side: 'new', line: 5 },
      open: true,
      version: expect.any(Number),
    },
    {
      id: 'T2',
      at: { file: 'overview-code1', side: 'old', line: 4 },
      open: false,
      version: expect.any(Number),
    },
    // A thread on a range goes under its last line.
    {
      id: 'T3',
      at: { file: 'overview-code1', side: 'new', line: 6 },
      open: true,
      version: expect.any(Number),
    },
  ]);
});

test('none on another file, on the file as a whole, or on another commit’s lines', () => {
  const rows = [
    row({ id: 'P', path: 'src/other.ts' }),
    row({ id: 'F', subject: 'FILE', line: null, originalLine: null }),
  ];
  expect(threadsOnBlock(rows, block())).toEqual([]);
  // An overview written for an older push: a thread on the head's lines isn't on its lines, and
  // one written on its commit is, where it was written.
  const older = block({ commit: OLDER });
  expect(threadsOnBlock([row()], older)).toEqual([]);
  const written = row({
    id: 'W',
    outdated: true,
    currentOn: null,
    writtenOn: OLDER,
    line: null,
    originalLine: 4,
  });
  expect(threadsOnBlock([written], older)).toEqual([
    {
      id: 'W',
      at: { file: 'overview-code1', side: 'new', line: 4 },
      open: true,
      version: expect.any(Number),
    },
  ]);
});

test('a stack’s layer shows none on its base side, which is the layer below’s', () => {
  const layer = block({ from: LOWER });
  const rows = [row(), row({ id: 'L', side: 'LEFT', line: 4, originalLine: 4 })];
  expect(threadsOnBlock(rows, layer).map(({ id }) => id)).toEqual(['T1']);
});

test('a thread’s version changes with what it shows', () => {
  const [before] = threadsOnBlock([row()], block());
  const [after] = threadsOnBlock([row({ resolved: true })], block());
  expect(after?.version).not.toBe(before?.version);
  expect(after?.open).toBe(false);
});
