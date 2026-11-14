// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import type * as RevisionsShared from '../../revisions/window/shared.ts';
import type { Drawn } from './tabs.ts';
import { markViewed, marksFrom, nextUnviewed } from './viewed.ts';

// The viewed marks, as `e` reads and toggles them, by path.
const marks = vi.hoisted(() => new Set<string>());
vi.mock('../../revisions/window/shared.ts', async (original) => ({
  ...(await original<typeof RevisionsShared>()),
  toggleViewed: (_tab: string, file: { path: { text: string } }) => {
    if (marks.delete(file.path.text)) return { kind: 'clearing' };
    marks.add(file.path.text);
    return { kind: 'marking' };
  },
  passedOver: (_marks: unknown, path: { text: string }) => marks.has(path.text),
}));

const order = ['d0', 'd1', 'd2', 'd3'];

/** Says `ids` are viewed. */
const viewed = (ids: string[]) => (id: string) => ids.includes(id);

describe('where e goes after marking a file viewed', () => {
  it('to the next file that isn’t viewed, in the order the diff shows them', () => {
    expect(nextUnviewed(order, 'd0', viewed(['d0', 'd1']))).toBe('d2');
  });

  it('round the end to the start', () => {
    expect(nextUnviewed(order, 'd2', viewed(['d2', 'd3']))).toBe('d0');
  });

  it('nowhere when every other file is viewed', () => {
    expect(nextUnviewed(order, 'd1', viewed(['d0', 'd1', 'd2', 'd3']))).toBeUndefined();
    expect(nextUnviewed(order, 'd1', viewed(['d0', 'd2', 'd3']))).toBeUndefined();
    expect(nextUnviewed(order, 'gone', viewed([]))).toBeUndefined();
  });
});

describe('what 3e marks', () => {
  it('that many files from the one at the cursor, and goes to the one after them', () => {
    expect(marksFrom(order, 'd0', 2, viewed([]))).toEqual({ marks: ['d0', 'd1'], next: 'd2' });
  });

  it('past files that are viewed, the one at the cursor too, and round the end', () => {
    expect(marksFrom(order, 'd1', 2, viewed(['d1', 'd3']))).toEqual({
      marks: ['d2', 'd0'],
      next: undefined,
    });
  });

  it('as many as there are when the count is more', () => {
    expect(marksFrom(order, 'd2', 10, viewed(['d0']))).toEqual({
      marks: ['d2', 'd3', 'd1'],
      next: undefined,
    });
  });
});

/** A diff of `ids`, the file at the cursor `at`, and where each mark it heard sends the cursor. */
function diffOf(ids: readonly string[], at: string) {
  const went: [string, boolean, string | undefined][] = [];
  const entries = ids.map((id) => ({ id, versions: { path: { text: id }, previous: null } }));
  const fake = {
    tab: 't1',
    order: ids,
    fileAt: () => at,
    loader: { snapshot: () => ({ ready: { entries } }) },
    viewedHere: (id: string, marked: boolean, next: string | undefined) => {
      went.push([id, marked, next]);
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only what `e` reads is here.
  return { drawn: fake as unknown as Drawn, went };
}

describe('e in the diff', () => {
  const line = { kind: 'line', at: { file: 'd1', side: 'new', line: 1 } } as const;

  it('alone, marks the file or clears its mark; with a count, even 1e, only marks', () => {
    marks.clear();
    marks.add('d1');
    const { drawn, went } = diffOf(order, 'd1');
    markViewed(drawn, line, 1);
    expect([...marks].toSorted()).toEqual(['d1', 'd2']);
    expect(went).toEqual([['d2', true, 'd3']]);
    markViewed(drawn, line);
    expect([...marks].toSorted()).toEqual(['d2']);
    expect(went.at(-1)).toEqual(['d1', false, undefined]);
  });
});
