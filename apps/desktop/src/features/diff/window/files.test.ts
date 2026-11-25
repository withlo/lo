import { describe, expect, it } from 'vitest';

import type { FileVersions, Start } from '../contract.ts';
import { diffFileOf, drawsView, headerOf, inOrder, keepsBox, keptOrder, viewKey } from './files.ts';
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
    reach: 0,
    conflicted: false,
    since: null,
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

  it('make a new view only for other files or another order, not another start', () => {
    const a = entry('d0', 'a');
    const b = entry('d1', 'b');
    expect(viewKey('h', [a, b])).toBe(viewKey('h', [a, b]));
    expect(viewKey('h', [a, b])).not.toBe(viewKey('h', [b, a]));
    expect(viewKey('h', [a, b])).not.toBe(viewKey('h', [a]));
    expect(viewKey('h', [a, b])).toBe(viewKey('h', [a, entry('d1', 'b', 'large')]));
  });

  it('show a binary file’s two sizes, and why a file starts as it does', () => {
    const binary = headerOf(entry('d0', 'logo.png', 'binary').versions);
    expect(binary.tags).toEqual(['binary · 2 KB → 3 MB']);
    // With no text to count, it draws no counts.
    expect(binary.counted).toBe(false);
    expect(headerOf(entry('d0', 'big.txt', 'large').versions)).not.toHaveProperty('tags');
    const lock = {
      ...entry('d0', 'pnpm-lock.yaml', 'collapsed').versions,
      generated: 'lockfile' as const,
    };
    expect(headerOf(lock).tags).toEqual(['lockfile']);
    expect(headerOf(entry('d0', 'a.ts').versions).tags).toBe(undefined);
    // A file a rebase's replay conflicted on, in a comparison of revisions.
    const resolved = { ...entry('d0', 'a.ts').versions, conflicted: true };
    expect(headerOf(resolved).tags).toEqual(['conflict resolved']);
    expect(headerOf(resolved)).not.toHaveProperty('counted');
    const unchanged = headerOf({ ...resolved, start: 'unchanged' });
    expect(unchanged.tags).toEqual(['conflict resolved', 'no text changes']);
    expect(unchanged.counted).toBe(false);
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

  it('start a viewed file closed, its ball in its header, and say where one shows from', () => {
    const viewed = diffFileOf(entry('d0', 'a.ts'), shown, 'viewed');
    expect(viewed).toMatchObject({ collapsed: true, header: { viewed: 'viewed' } });
    expect(diffFileOf(entry('d0', 'a.ts'), shown, 'unviewed')).not.toHaveProperty('collapsed');
    expect(diffFileOf(entry('d0', 'a.ts'), shown).header).not.toHaveProperty('viewed');

    const since = entry('d0', 'a.ts');
    const narrowed = { ...since.versions, since: { label: 'r1', why: 'viewed' as const } };
    expect(headerOf(narrowed, 'dismissed')).toMatchObject({ viewed: 'stale', tags: ['since r1'] });
    expect(headerOf({ ...narrowed, since: { label: 'r1', why: 'review' } }).tags).toEqual([
      'since your review of r1',
    ]);
    expect(headerOf({ ...narrowed, start: 'unchanged' }).tags).toEqual(['no change since r1']);
  });
});

/** The files' paths with generated ones last, as review order puts them. */
function byGenerated(changes: readonly { path: { text: string }; generated: unknown }[]): string[] {
  return changes
    .toSorted((a, b) => Number(a.generated !== null) - Number(b.generated !== null))
    .map((change) => change.path.text);
}

/** `each`, marked generated by the local copy's attributes. */
function generated(each: Entry): Entry {
  return { ...each, versions: { ...each.versions, generated: 'attribute' } };
}

describe('the order a diff is drawn in', () => {
  it('stays as it was drawn when what the files say of themselves changes', () => {
    const github = [entry('d0', 'a.ts'), entry('d1', 'b.ts')];
    const first = keptOrder(undefined, 'h', github, 'review', byGenerated);
    expect(first.order).toEqual(['a.ts', 'b.ts']);
    // The local copy marks a.ts generated, which review order would put last.
    const local = [generated(entry('d0', 'a.ts')), entry('d1', 'b.ts')];
    expect(keptOrder(first, 'h', local, 'review', byGenerated).order).toEqual(['a.ts', 'b.ts']);
  });

  it('is worked out again when the reader orders the files another way, or the files change', () => {
    const local = [generated(entry('d0', 'a.ts')), entry('d1', 'b.ts')];
    const first = keptOrder(
      undefined,
      'h',
      [entry('d0', 'a.ts'), entry('d1', 'b.ts')],
      'tree',
      byGenerated,
    );
    expect(keptOrder(first, 'h', local, 'review', byGenerated).order).toEqual(['b.ts', 'a.ts']);
    expect(
      keptOrder(first, 'h', [...local, entry('d2', 'c.ts')], 'tree', byGenerated).order,
    ).toEqual(['b.ts', 'c.ts', 'a.ts']);
    expect(keptOrder(first, 'next', local, 'tree', byGenerated).order).toEqual(['b.ts', 'a.ts']);
  });
});

describe('what the middle shows', () => {
  const waiting = 'Comparing r1 with r2 once the local copy has both…';

  it('draws a view of the files once they, the page and the threads are ready, and none of no files', () => {
    const ready = { key: 'abc||', entries: [{}], nonce: 'n', settled: true };
    expect(drawsView(ready)).toBe(true);
    // No files changed: there's no view, so the middle can say so in its place.
    expect(drawsView({ ...ready, entries: [] })).toBe(false);
    expect(drawsView({ ...ready, key: undefined, entries: undefined })).toBe(false);
    expect(drawsView({ ...ready, nonce: undefined })).toBe(false);
    expect(drawsView({ ...ready, settled: false })).toBe(false);
    // With no view to draw and no view held, the middle is the answer.
    expect(
      keepsBox({
        drawable: drawsView({ ...ready, entries: [] }),
        held: false,
        said: 'No files changed',
        waiting: null,
      }),
    ).toBe(false);
  });

  it('keeps a view drawn, held, while the next loads or waits for what it needs', () => {
    expect(keepsBox({ drawable: true, held: false, said: undefined, waiting: null })).toBe(true);
    expect(keepsBox({ drawable: false, held: true, said: undefined, waiting: null })).toBe(true);
    // A wait for the local copy is a wait: the view stays, held, and the wait goes unsaid.
    expect(keepsBox({ drawable: false, held: true, said: waiting, waiting })).toBe(true);
  });

  it('gives the middle to an answer, and to a wait when nothing is drawn', () => {
    expect(keepsBox({ drawable: false, held: true, said: 'No files changed', waiting: null })).toBe(
      false,
    );
    expect(keepsBox({ drawable: false, held: false, said: waiting, waiting })).toBe(false);
    expect(keepsBox({ drawable: false, held: false, said: undefined, waiting: null })).toBe(false);
  });
});
