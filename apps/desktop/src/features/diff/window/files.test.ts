import { describe, expect, it } from 'vitest';

import type { FileVersions, Start } from '../contract.ts';
import { diffFileOf, headerOf, inOrder, viewKey } from './files.ts';
import type { Entry, Shown } from './loader.ts';

function entry(id: string, path: string, start: Start = 'shown', place = 0): Entry {
  const versions: FileVersions = {
    path: { text: path },
    previous: null,
    change: 'modified',
    additions: 3,
    deletions: 2,
    old: { blob: 'c'.repeat(40), size: 2048 },
    new: { blob: 'd'.repeat(40), size: 3 * 1024 * 1024 },
    start,
    generated: null,
    large: null,
    submodule: null,
  };
  return { id, key: path, place, versions };
}

const shown: Shown = {
  from: 'github',
  lines: { old: ['', 'a'], new: ['', 'b'] },
  gaps: [
    { side: 'old', from: 1, to: 1 },
    { side: 'new', from: 1, to: 1 },
  ],
  diff: {
    oldLineCount: 2,
    newLineCount: 2,
    changes: [],
    rows: [],
    hunks: [],
    approximate: false,
    noNewlineAtEnd: { old: false, new: false },
    lineEndings: { old: 'lf', new: 'lf' },
  },
  tokens: {},
  changes: { deleted: [], added: [] },
  whitespace: true,
};

describe('the files as the view gets them', () => {
  it('go in the left panel’s order, then the rest in main’s', () => {
    const entries = [
      entry('d0', 'a', 'shown', 0),
      entry('d1', 'b', 'shown', 1),
      entry('d2', 'c', 'shown', 2),
    ];
    const ids = new Map([
      ['a', 'd0'],
      ['b', 'd1'],
      ['c', 'd2'],
    ]);
    expect(inOrder(entries, ['c', 'a'], (key) => ids.get(key)).map(({ id }) => id)).toEqual([
      'd2',
      'd0',
      'd1',
    ]);
  });

  it('make a new view only for other files, another order or another start', () => {
    const a = entry('d0', 'a');
    const b = entry('d1', 'b');
    expect(viewKey('h', [a, b])).toBe(viewKey('h', [a, b]));
    expect(viewKey('h', [a, b])).not.toBe(viewKey('h', [b, a]));
    expect(viewKey('h', [a, b])).not.toBe(viewKey('h', [a, entry('d1', 'b', 'large')]));
  });

  it('show a binary file’s two sizes, and why a file starts as it does', () => {
    expect(headerOf(entry('d0', 'logo.png', 'binary').versions).tags).toEqual([
      'binary, 2.0 KiB → 3.0 MiB',
    ]);
    const lock = {
      ...entry('d0', 'pnpm-lock.yaml', 'collapsed').versions,
      generated: 'lockfile' as const,
    };
    expect(headerOf(lock).tags).toEqual(['lockfile']);
    expect(headerOf(entry('d0', 'a.ts').versions).tags).toBe(undefined);
  });

  it('keep binary, unchanged and large files out, and give the rest their lines and gaps', () => {
    expect(diffFileOf(entry('d0', 'a.png', 'binary'), undefined).skip).toBe('binary');
    expect(diffFileOf(entry('d0', 'a.ts', 'unchanged'), undefined).skip).toBe('empty');
    const large = diffFileOf(entry('d0', 'big.txt', 'large'), undefined);
    expect(large.skip).toBe('large');
    expect(large).not.toHaveProperty('lines');
    const loaded = diffFileOf(entry('d0', 'big.txt', 'large'), shown);
    expect(loaded.skip).toBe(undefined);
    expect(loaded.lines).toBe(shown.lines);
    const lock = diffFileOf(entry('d0', 'pnpm-lock.yaml', 'collapsed'), shown);
    expect(lock).toMatchObject({ collapsed: true, gaps: shown.gaps, header: { additions: 3 } });
  });
});
