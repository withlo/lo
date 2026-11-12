// The lines another feature explains, as the diff marks them: on each file's newer side, by the
// path it has there, and none on a file the diff doesn't have there.

import { describe, expect, it } from 'vitest';

import { marksOf, sameMarks, type ExplainedLines } from './explained.ts';

const note = { label: 'How it works', text: 'It splits lines.' };

const lines = (path: string, from: number, to: number): ExplainedLines => ({
  path,
  from,
  to,
  block: '1.4',
  note,
});

const files = [
  { id: 'f0', path: 'src/parser.ts', change: 'modified' },
  { id: 'f1', path: 'src/legacy.ts', change: 'deleted' },
  { id: 'f2', path: 'src/new.ts', change: 'added' },
];

describe('marksOf', () => {
  it('marks each file’s newer side by its path there, and nothing on a file it hasn’t', () => {
    expect(
      marksOf(
        [
          lines('src/parser.ts', 8, 10),
          lines('src/new.ts', 1, 1),
          lines('src/legacy.ts', 1, 2),
          lines('README.md', 1, 4),
        ],
        files,
      ),
    ).toEqual([
      { kind: 'overview', at: { file: 'f0', side: 'new', from: 8, to: 10 }, block: '1.4', note },
      { kind: 'overview', at: { file: 'f2', side: 'new', from: 1, to: 1 }, block: '1.4', note },
    ]);
  });

  it('tells marks that are the same from those that aren’t', () => {
    const one = marksOf([lines('src/parser.ts', 8, 10)], files);
    expect(sameMarks(one, marksOf([lines('src/parser.ts', 8, 10)], files))).toBe(true);
    expect(sameMarks(one, marksOf([lines('src/parser.ts', 8, 11)], files))).toBe(false);
    expect(sameMarks(one, [])).toBe(false);
  });
});
