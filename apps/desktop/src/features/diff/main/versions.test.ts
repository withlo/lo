import { createHash } from 'node:crypto';

import type { PullFile } from '@lo/github';
import { describe, expect, it } from 'vitest';

import { githubVersions, treePathOf } from './versions.ts';

const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function listed(filename: string, extra: Partial<PullFile> = {}): PullFile {
  return {
    filename,
    status: 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    patch: '@@ -1 +1 @@\n-a\n+b',
    ...extra,
  };
}

describe('a file’s path, as the diff sends it', () => {
  it('carries a long path’s digest, by which it’s known, and keeps its text to show', () => {
    const kilobyte = `src/${'k'.repeat(1100)}/a.ts`;
    const twenty = `src/${'t'.repeat(20 * 1024)}/b.ts`;
    expect(treePathOf(Buffer.from('src/a.ts'))).toEqual({ text: 'src/a.ts' });
    expect(treePathOf(Buffer.from(kilobyte))).toEqual({ text: kilobyte, digest: digest(kilobyte) });
    expect(githubVersions(listed(twenty)).path).toEqual({ text: twenty, digest: digest(twenty) });
    expect(treePathOf(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toEqual({
      text: 'caf�',
      hex: '636166e9',
    });
  });
});

describe('a file GitHub lists', () => {
  it('starts out as GitHub’s list lets the diff tell', () => {
    expect(githubVersions(listed('a.ts')).start).toBe('shown');
    expect(githubVersions(listed('pnpm-lock.yaml'))).toMatchObject({
      start: 'collapsed',
      generated: 'lockfile',
    });
    expect(
      githubVersions(
        listed('logo.png', { additions: 0, deletions: 0, changes: 0, patch: undefined }),
      ).start,
    ).toBe('binary');
    expect(
      githubVersions(
        listed('b.ts', {
          status: 'renamed',
          previous_filename: 'a.ts',
          additions: 0,
          deletions: 0,
          changes: 0,
          patch: undefined,
        }),
      ),
    ).toMatchObject({ start: 'unchanged', previous: { text: 'a.ts' } });
    expect(githubVersions(listed('big.txt', { additions: 9000, patch: undefined }))).toMatchObject({
      start: 'large',
      large: expect.stringContaining('more than the 5000 Lo loads at once'),
    });
    // Too large for GitHub's diff, though not for Lo's.
    expect(githubVersions(listed('wide.txt', { patch: undefined }))).toMatchObject({
      start: 'large',
      large: expect.stringContaining('local copy'),
    });
  });
});
