// Which of a tree's files the syntax index reads, and in what order: nearest the pull request's own
// files first, then the rest of the repository, folder by folder upward. A large tree's files are
// gone through without holding main the whole time.

import { parseOid, type TreeEntry } from '@lo/git';
import { describe, expect, it } from 'vitest';

import { candidates, changedPaths, distances, nearestFirst } from './select.ts';

const OID = parseOid('a'.repeat(40));

function entry(path: string, change: Partial<TreeEntry> = {}): TreeEntry {
  return { path: Buffer.from(path, 'utf8'), oid: OID, mode: 'regular', ...change };
}

/** Whether other work ran before `work` finished. */
async function between(work: Promise<unknown>): Promise<boolean> {
  let ran = false;
  setImmediate(() => {
    ran = true;
  });
  await work;
  return ran;
}

describe('which files the index reads', () => {
  it('reads files in a language with tags, but no lockfile, link, long path or file past 1 MB', async () => {
    const found = await candidates([
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

  it('reads the pull request’s files first, then those around them, then upward', async () => {
    const distance = await distances(['app/web/form.ts', 'app/web/inputs/text.ts']);
    expect(distance('app/web/form.ts')).toBe(-1);
    expect(distance('app/web/field.ts')).toBe(0);
    expect(distance('app/web/inputs/other.ts')).toBe(0);
    expect(distance('app/web/inputs/deeper/more.ts')).toBe(0);
    expect(distance('app/api/route.ts')).toBe(1);
    expect(distance('lib/far.ts')).toBe(2);
    expect(distance('top.ts')).toBe(2);
    const { chosen, more } = await nearestFirst(
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

  it('finds the paths two trees differ in', async () => {
    const other = parseOid('b'.repeat(40));
    expect(
      await changedPaths(
        [entry('same.ts'), entry('edited.ts', { oid: other }), entry('added.ts')],
        [entry('same.ts'), entry('edited.ts'), entry('removed.ts')],
      ),
    ).toEqual(new Set(['edited.ts', 'added.ts', 'removed.ts']));
    expect(await changedPaths([entry('a.ts')], undefined)).toEqual(new Set(['a.ts']));
  });

  it('lets main do other work while it goes through a large tree', async () => {
    const ours = Array.from({ length: 20_000 }, (_, index) => entry(`src/${index}.ts`));
    const theirs = ours.slice(1);
    expect(await between(changedPaths(ours, theirs))).toBe(true);
    const found = await candidates(ours);
    expect(await between(candidates(ours))).toBe(true);
    expect(await between(nearestFirst(found, ['src/0.ts']))).toBe(true);
  });
});
