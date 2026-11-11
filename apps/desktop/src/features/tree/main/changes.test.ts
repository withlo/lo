import { type ChangedFile, parseOid } from '@lo/git';
import type { PullFile } from '@lo/github';
import { describe, expect, it } from 'vitest';

import { githubChanged, listedAt, localChange } from './changes.ts';

const OID = parseOid('1'.repeat(40));

function version(path: string) {
  return { path: Buffer.from(path), oid: OID, mode: 'regular' as const, size: 10 };
}

describe('localChange', () => {
  it('entries from the local copy keep renames counts and binary files', () => {
    const renamed: ChangedFile = {
      change: { kind: 'renamed', similarity: 90 },
      old: version('old/name.rs'),
      new: version('new/name.rs'),
      binary: false,
      lines: { added: 3, deleted: 2 },
    };
    const deletedBinary: ChangedFile = {
      change: { kind: 'deleted' },
      old: version('logo.png'),
      binary: true,
    };
    // The tree marks how a file changed and where a rename came from; its counts and whether it's
    // binary are the diff's to show.
    expect(localChange(renamed)).toEqual({
      path: { text: 'new/name.rs' },
      change: 'renamed',
      previous: { text: 'old/name.rs' },
      generated: null,
    });
    expect(localChange(deletedBinary, true)).toEqual({
      path: { text: 'logo.png' },
      change: 'deleted',
      previous: null,
      generated: 'attribute',
    });
  });

  it('counts a lockfile generated unless .gitattributes unsets it', () => {
    const lockfile: ChangedFile = {
      change: { kind: 'modified' },
      old: version('Cargo.lock'),
      new: version('Cargo.lock'),
      binary: false,
    };
    expect(localChange(lockfile).generated).toBe('lockfile');
    expect(localChange(lockfile, false).generated).toBeNull();
  });
});

function listed(more: Partial<PullFile>): PullFile {
  return { filename: 'a.ts', status: 'modified', additions: 1, deletions: 1, changes: 2, ...more };
}

describe('githubChanged', () => {
  it('takes GitHub’s status and a rename’s old path, and counts only lockfiles generated', () => {
    expect(
      githubChanged(listed({ status: 'renamed', filename: 'b.ts', previous_filename: 'a.ts' })),
    ).toEqual({
      path: { text: 'b.ts' },
      change: 'renamed',
      previous: { text: 'a.ts' },
      generated: null,
    });
    // A copy shows as added, with its own path.
    expect(githubChanged(listed({ status: 'copied', previous_filename: 'z.ts' }))).toMatchObject({
      change: 'added',
      previous: null,
    });
    expect(githubChanged(listed({ status: 'removed', filename: 'yarn.lock' }))).toMatchObject({
      change: 'deleted',
      generated: 'lockfile',
    });
  });
});

const listedAtHead = (head: string) =>
  listed({ contents_url: `https://api.github.com/repos/o/r/contents/a.ts?ref=${head}` });

describe('listedAt', () => {
  it('says whether GitHub listed the files at the head on screen', () => {
    expect(
      listedAt([listedAtHead('a'.repeat(40)), listed({ status: 'removed' })], 'a'.repeat(40)),
    ).toBe(true);
    expect(listedAt([listedAtHead('b'.repeat(40))], 'a'.repeat(40))).toBe(false);
  });
});
