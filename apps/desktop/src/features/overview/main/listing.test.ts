import { LIMITS } from '@lo/artifact';
import type { TreeItem } from '@lo/github';
import { describe, expect, it } from 'vitest';

import { entryAt, isReadable, listedEntries, pathBytes, treeEntries } from './listing.ts';

const SHA = 'a'.repeat(40);

const item = (path: string, type: TreeItem['type'] = 'blob', mode = '100644'): TreeItem => ({
  path,
  type,
  mode,
  sha: SHA,
  ...(type === 'blob' ? { size: 3 } : {}),
});

describe('listedEntries', () => {
  it('says what each entry is, by its type and mode', () => {
    expect(
      listedEntries([
        item('artifact.md'),
        item('figures', 'tree', '040000'),
        item('figures/a.svg', 'blob', '120000'),
        item('vendor', 'commit', '160000'),
      ]),
    ).toEqual([
      { path: 'artifact.md', kind: 'file', size: 3, id: SHA },
      { path: 'figures', kind: 'folder', size: null, id: SHA },
      { path: 'figures/a.svg', kind: 'link', size: 3, id: SHA },
      { path: 'vendor', kind: 'submodule', size: null, id: SHA },
    ]);
  });

  it('lists one past the most an overview may hold, and artifact.md wherever it is', () => {
    const items = Array.from({ length: 2 * LIMITS.entries }, (_, at) => item(`f${at}`));
    items.push(item('artifact.md'));
    const listed = listedEntries(items);
    expect(listed).toHaveLength(LIMITS.entries + 2);
    expect(listed?.at(-2)?.path).toBe(`f${LIMITS.entries}`);
    expect(listed?.at(-1)?.path).toBe('artifact.md');
  });

  it('refuses a listing whose entries name no object GitHub would', () => {
    expect(listedEntries([{ ...item('artifact.md'), sha: '../../user' }])).toBeUndefined();
  });
});

describe('pathBytes', () => {
  it('is the UTF-8 of a path, with a byte no UTF-8 holds for each U+FFFD GitHub wrote', () => {
    expect([...pathBytes('café.svg')]).toEqual([...new TextEncoder().encode('café.svg')]);
    const mangled = pathBytes('figures/caf\uFFFD.svg');
    expect([...mangled]).toEqual([
      ...new TextEncoder().encode('figures/caf'),
      0xff,
      46,
      115,
      118,
      103,
    ]);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(mangled)).toThrow('not valid');
    expect([...pathBytes('\uFFFD\uFFFD')]).toEqual([0xff, 0xff]);
  });

  it("gives a mangled name's entry to the checks as a path that isn't UTF-8", () => {
    const [entry] = treeEntries([
      { path: 'figures/caf\uFFFD.svg', kind: 'file', size: 3, id: SHA },
    ]);
    expect(entry?.path.includes(0xff)).toBe(true);
    expect(entry?.kind).toBe('file');
  });
});

describe('isReadable', () => {
  it('is only artifact.md and figures directly in figures/', () => {
    expect(isReadable('artifact.md')).toBe(true);
    expect(isReadable('figures/flow.svg')).toBe(true);
    expect(isReadable('figures/shot.jpeg')).toBe(true);
    for (const path of [
      'Artifact.md',
      'README.md',
      'figures/deep/flow.svg',
      'figures/flow.SVG',
      'figures/.svg',
      'figures/notes.txt',
      'src/figures/flow.svg',
      // A name GitHub mangled is never the one the overview names.
      'figures/caf\uFFFD.svg',
    ]) {
      expect([path, isReadable(path)]).toEqual([path, false]);
    }
  });
});

describe('entryAt', () => {
  it('finds an entry by its exact path, and none listed twice', () => {
    const entries = [
      { path: 'artifact.md', kind: 'file' as const, size: 1, id: SHA },
      { path: 'figures/a.svg', kind: 'file' as const, size: 1, id: SHA },
      { path: 'figures/a.svg', kind: 'file' as const, size: 2, id: SHA },
    ];
    expect(entryAt(entries, 'artifact.md')?.size).toBe(1);
    expect(entryAt(entries, 'ARTIFACT.md')).toBeUndefined();
    expect(entryAt(entries, 'figures/a.svg')).toBeUndefined();
  });
});
