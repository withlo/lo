// What the status bar says of a view's code index, from what main said of it.

import { describe, expect, it } from 'vitest';

import { indexItem } from './indexes.ts';

const NOW = 1_700_000_000_000;
const item = (state: Parameters<typeof indexItem>[0]) => indexItem(state, 'rozed-dev/e2e', NOW);

describe('the code index’s status item', () => {
  it('counts while it builds, names the index once it’s ready, and says how much a partial one has', () => {
    // Its details say how far, in files.
    expect(item({ kind: 'building', done: 1204, total: 3880 })).toEqual({
      ball: 'working',
      text: 'Indexing code · 1,204 / 3,880',
      facts: [{ label: 'State', value: 'Indexing rozed-dev/e2e · 1,204 / 3,880 files' }],
    });
    expect(item({ kind: 'building', done: 0, total: 0 })).toEqual({
      ball: 'working',
      text: 'Indexing code…',
      facts: [{ label: 'State', value: 'Indexing rozed-dev/e2e…' }],
    });
    // Once it's ready, its details say what it covers, and when it was built.
    expect(
      item({
        kind: 'ready',
        partial: null,
        languages: [
          { name: 'TypeScript', files: 3102 },
          { name: 'JavaScript', files: 640 },
        ],
        at: NOW - 5 * 60_000,
      }),
    ).toEqual({
      ball: 'ready',
      text: 'Code index',
      facts: [
        { label: 'State', value: 'Ready' },
        { label: 'Files', value: '3,742' },
        { label: 'Languages', value: 'TypeScript 3,102 · JavaScript 640' },
        { label: 'Indexed', value: '5 min ago' },
      ],
    });
    expect(
      item({
        kind: 'ready',
        partial: { indexed: 20_000, total: 31_422, why: ['files', 'offline'] },
        languages: [{ name: 'Go', files: 20_000 }],
        at: NOW,
      }),
    ).toEqual({
      ball: 'warn',
      text: 'Code index · 20,000 / 31,422 files',
      facts: [
        {
          label: 'State',
          value: 'Partial · 20,000 / 31,422 files',
          why: ['The 20,000 files nearest the changes are indexed.', 'Offline.'],
        },
        { label: 'Languages', value: 'Go 20,000' },
        { label: 'Indexed', value: 'just now' },
      ],
    });
    // A tree too large to list has no files to count.
    expect(
      item({
        kind: 'ready',
        partial: { indexed: 0, total: 0, why: ['listing'] },
        languages: [],
        at: NOW,
      }),
    ).toEqual({
      ball: 'warn',
      text: 'Code index',
      facts: [
        { label: 'State', value: 'Partial', why: ['The repo has too many files to list.'] },
        { label: 'Indexed', value: 'just now' },
      ],
    });
  });

  it('says it can’t index the code, with when it tries again and what main said behind it', () => {
    // A wait, amber, while it's built again by itself.
    expect(item({ kind: 'failed', message: 'The local copy is gone.', retryAt: 20_000 })).toEqual({
      ball: 'warn',
      text: 'Can’t index the code',
      facts: [],
      failure: { message: 'The local copy is gone.', retryAt: 20_000 },
    });
    expect(item({ kind: 'failed', message: '', retryAt: null })).toEqual({
      ball: 'failed',
      text: 'Can’t index the code',
      facts: [],
      failure: { message: '', retryAt: null },
    });
  });

  it('keeps its place with a ring before the local copy, and says nothing without git', () => {
    expect(item({ kind: 'waiting' })).toEqual({
      ball: 'off',
      text: 'Code index',
      facts: [{ label: 'State', value: 'Waiting for local copy…' }],
    });
    expect(item(null)).toBe(undefined);
    expect(item({ kind: 'noGit' })).toBe(undefined);
  });
});
