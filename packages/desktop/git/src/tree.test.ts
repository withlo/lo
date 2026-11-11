import { expect, test } from 'vitest';

import { GitError } from './errors.ts';
import { parseListed, parseTree } from './tree.ts';

const OID = 'a'.repeat(40);

test('records are read with or without sizes', () => {
  const withSize = parseListed(Buffer.from(`100644 blob ${OID}      12\tsrc/lib.rs`));
  expect([withSize.mode, withSize.kind, withSize.size]).toEqual(['100644', 'blob', 12]);
  expect(withSize.path.toString('utf8')).toBe('src/lib.rs');
  expect(withSize.oid).toBe(OID);

  // A blob the clone lacks, and a submodule, have no size to read.
  for (const size of ['     BAD', '       -']) {
    const listed = parseListed(Buffer.from(`100644 blob ${OID} ${size}\ta\tb`));
    expect(listed.size).toBeUndefined();
    // Tabs and spaces in a path stay in it.
    expect(listed.path.toString('utf8')).toBe('a\tb');
  }

  const without = parseListed(Buffer.from(`040000 tree ${OID}\tsrc`));
  expect([without.kind, without.size]).toEqual(['tree', undefined]);
});

test('records that arent entries are refused', () => {
  for (const record of [
    '',
    'no tab here',
    '100644 blob\tpath',
    `100644 blob ${'z'.repeat(40)}\tpath`,
    `100644 blob ${OID}`,
  ]) {
    expect.soft(() => parseListed(Buffer.from(record))).toThrow(GitError);
  }
});

/** A tree object's entry: its mode, its name, a NUL and its ID's bytes. */
function entry(mode: string, name: Buffer | string, oid: string): Buffer {
  return Buffer.concat([
    Buffer.from(`${mode} `),
    Buffer.from(name),
    Buffer.from([0]),
    Buffer.from(oid, 'hex'),
  ]);
}

test('reads a tree objects entries as git takes their modes', () => {
  const tree = Buffer.concat([
    entry('100644', 'a.txt', '1'.repeat(40)),
    entry('100755', 'run', '2'.repeat(40)),
    // Old trees have modes git no longer writes, which it reads as the nearest it does.
    entry('100664', 'group.txt', '3'.repeat(40)),
    entry('120000', 'link', '4'.repeat(40)),
    entry('40000', 'src', '5'.repeat(40)),
    entry('160000', 'vendor', '6'.repeat(40)),
    entry('100644', Buffer.from([0x63, 0x61, 0x66, 0xe9]), '7'.repeat(40)),
    entry('100644', 'odd\nname', '8'.repeat(40)),
  ]);

  const entries = parseTree(tree, 20);

  expect([...entries].map(([name, found]) => [name, found.mode])).toEqual([
    ['a.txt', 'regular'],
    ['run', 'executable'],
    ['group.txt', 'regular'],
    ['link', 'symlink'],
    ['src', 'folder'],
    ['vendor', 'submodule'],
    // Names are bytes, a byte a character.
    ['café', 'regular'],
    ['odd\nname', 'regular'],
  ]);
  expect(entries.get('src')?.oid).toBe('5'.repeat(40));
  // Cut short, or with a mode that isn't one.
  expect(() => parseTree(tree.subarray(0, tree.length - 1), 20)).toThrow(GitError);
  expect(() => parseTree(entry('10x644', 'a', '1'.repeat(40)), 20)).toThrow(GitError);
});
