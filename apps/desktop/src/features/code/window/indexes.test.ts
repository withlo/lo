// What the status bar says of a view's syntax index, from what main said of it.

import { describe, expect, it } from 'vitest';

import { indexItem } from './indexes.ts';

describe('the syntax index’s status item', () => {
  it('counts while it builds, names the index once it’s ready, and says how much a partial one has', () => {
    expect(indexItem({ kind: 'building', done: 1204, total: 3880 })).toEqual({
      dot: 'busy',
      text: 'Syntax index 1,204 / 3,880',
    });
    expect(indexItem({ kind: 'building', done: 0, total: 0 })).toMatchObject({
      text: 'Syntax index',
    });
    expect(indexItem({ kind: 'ready', partial: null })).toEqual({
      dot: 'ok',
      text: 'Syntax index',
    });
    expect(
      indexItem({
        kind: 'ready',
        partial: { indexed: 20_000, total: 31_422, why: ['files', 'offline'] },
      }),
    ).toEqual({
      dot: 'warn',
      text: 'Syntax index partial',
      title:
        'It has 20,000 of 31,422 files. Lo reads 20,000 files of a tree at most, nearest the PR’s own first. Offline, Lo reads only what the local copy has.',
    });
    // A tree too large to list has no files to count.
    expect(
      indexItem({ kind: 'ready', partial: { indexed: 0, total: 0, why: ['listing'] } }),
    ).toMatchObject({
      text: 'Syntax index partial',
      title: 'A tree has more files than Lo lists, so none of them are read.',
    });
    expect(indexItem({ kind: 'failed', message: 'The local copy is gone.' })).toMatchObject({
      dot: 'fail',
      text: 'Syntax index failed',
    });
  });

  it('says nothing without git or before the local copy, which say so themselves', () => {
    expect(indexItem(null)).toBe(undefined);
    expect(indexItem({ kind: 'noGit' })).toBe(undefined);
    expect(indexItem({ kind: 'waiting' })).toBe(undefined);
  });
});
