// Which of a tree's files the syntax index reads, and in what order: nearest the pull request's own
// files first, then the rest of the repository, folder by folder upward.

import { parseOid, type TreeEntry } from '@lo/git';
import { describe, expect, it } from 'vitest';

import { candidates, changedPaths, distances, nearestFirst } from './select.ts';

const OID = parseOid('a'.repeat(40));

function entry(path: string, change: Partial<TreeEntry> = {}): TreeEntry {
  return { path: Buffer.from(path, 'utf8'), oid: OID, mode: 'regular', ...change };
}

describe('which files the index reads', () => {
  it('reads files in a language with tags, but no lockfile, link, long path or file past 1 MB', () => {
    const found = candidates([
      entry('src/parse.ts'),
      entry('src/view.tsx', { mode: 'executable' }),
      entry('README.md'),
      entry('Cargo.lock'),
      entry('src/link.ts', { mode: 'symlink' }),
      entry('vendor', { mode: 'submodule' }),
      entry('src/big.ts', { size: 1024 * 1024 + 1 }),
      entry(`${'deep/'.repeat(250)}far.ts`),
      { path: Buffer.from([0x73, 0xff, 0x2e, 0x74, 0x73]), oid: OID, mode: 'regular' },
    ]);
    expect(found.map(({ path, language }) => ({ path, language }))).toEqual([
      { path: 'src/parse.ts', language: 'typescript' },
      { path: 'src/view.tsx', language: 'tsx' },
    ]);
  });

  it('reads the pull request’s files first, then those around them, then upward', () => {
    const distance = distances(['app/web/form.ts', 'app/web/inputs/text.ts']);
    expect(distance('app/web/form.ts')).toBe(-1);
    expect(distance('app/web/field.ts')).toBe(0);
    expect(distance('app/web/inputs/other.ts')).toBe(0);
    expect(distance('app/web/inputs/deeper/more.ts')).toBe(0);
    expect(distance('app/api/route.ts')).toBe(1);
    expect(distance('lib/far.ts')).toBe(2);
    expect(distance('top.ts')).toBe(2);
    const { chosen, more } = nearestFirst(
      ['lib/far.ts', 'app/api/route.ts', 'app/web/field.ts', 'app/web/form.ts'].map((path) => ({
        path,
        oid: OID,
        language: 'typescript',
        size: undefined,
      })),
      ['app/web/form.ts'],
      3,
    );
    expect(chosen.map((file) => file.path)).toEqual([
      'app/web/form.ts',
      'app/web/field.ts',
      'app/api/route.ts',
    ]);
    expect(more).toBe(true);
  });

  it('finds the paths two trees differ in', () => {
    const other = parseOid('b'.repeat(40));
    expect(
      changedPaths(
        [entry('same.ts'), entry('edited.ts', { oid: other }), entry('added.ts')],
        [entry('same.ts'), entry('edited.ts'), entry('removed.ts')],
      ),
    ).toEqual(new Set(['edited.ts', 'added.ts', 'removed.ts']));
    expect(changedPaths([entry('a.ts')], undefined)).toEqual(new Set(['a.ts']));
  });
});
