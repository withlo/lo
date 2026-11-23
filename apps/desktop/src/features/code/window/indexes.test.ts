// What the status bar says of a view's code index, from what main said of it.

import { describe, expect, it } from 'vitest';

import { indexItem } from './indexes.ts';

describe('the code index’s status item', () => {
  it('counts while it builds, names the index once it’s ready, and says how much a partial one has', () => {
    // Its details say how far, in files.
    expect(indexItem({ kind: 'building', done: 1204, total: 3880 }, 'rozed-dev/e2e')).toEqual({
      ball: 'working',
      text: 'Indexing code · 1,204 / 3,880',
      lines: ['Indexing rozed-dev/e2e · 1,204 / 3,880 files'],
    });
    expect(indexItem({ kind: 'building', done: 0, total: 0 }, 'rozed-dev/e2e')).toEqual({
      ball: 'working',
      text: 'Indexing code…',
      lines: ['Indexing rozed-dev/e2e…'],
    });
    expect(indexItem({ kind: 'ready', partial: null }, 'rozed-dev/e2e')).toEqual({
      ball: 'ready',
      text: 'Code index',
    });
    expect(
      indexItem(
        {
          kind: 'ready',
          partial: { indexed: 20_000, total: 31_422, why: ['files', 'offline'] },
        },
        'rozed-dev/e2e',
      ),
    ).toEqual({
      ball: 'warn',
      text: 'Code index · 20,000 / 31,422 files',
      lines: ['The 20,000 files nearest the changes are indexed.', 'Offline.'],
    });
    // A tree too large to list has no files to count.
    expect(
      indexItem(
        { kind: 'ready', partial: { indexed: 0, total: 0, why: ['listing'] } },
        'rozed-dev/e2e',
      ),
    ).toEqual({
      ball: 'warn',
      text: 'Code index',
      lines: ['The repo has too many files to list.'],
    });
  });

  it('says it can’t index the code, with when it tries again and what main said behind it', () => {
    // A wait, amber, while it's built again by itself.
    expect(
      indexItem(
        { kind: 'failed', message: 'The local copy is gone.', retryAt: 20_000 },
        'rozed-dev/e2e',
      ),
    ).toEqual({
      ball: 'warn',
      text: 'Can’t index the code',
      failure: { message: 'The local copy is gone.', retryAt: 20_000 },
    });
    expect(indexItem({ kind: 'failed', message: '', retryAt: null }, 'rozed-dev/e2e')).toEqual({
      ball: 'failed',
      text: 'Can’t index the code',
      failure: { message: '', retryAt: null },
    });
  });

  it('keeps its place with a ring before the local copy, and says nothing without git', () => {
    expect(indexItem({ kind: 'waiting' }, 'rozed-dev/e2e')).toEqual({
      ball: 'off',
      text: 'Code index',
    });
    expect(indexItem(null, 'rozed-dev/e2e')).toBe(undefined);
    expect(indexItem({ kind: 'noGit' }, 'rozed-dev/e2e')).toBe(undefined);
  });
});
