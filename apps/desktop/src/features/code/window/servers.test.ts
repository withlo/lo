// What a language server's status item shows, from what main said of it, and what copying its log
// takes.

import { describe, expect, it } from 'vitest';

import { copiedLog, itemState } from './servers.ts';

describe('a language server’s status item', () => {
  it('shows main’s states, its memory cap in gigabytes', () => {
    expect(itemState({ kind: 'indexing', percent: 40 })).toEqual({ kind: 'indexing', percent: 40 });
    expect(itemState({ kind: 'notAnswering' })).toEqual({ kind: 'notAnswering' });
    expect(itemState({ kind: 'unpacking' })).toEqual({ kind: 'unpacking' });
    expect(itemState({ kind: 'building' })).toEqual({ kind: 'building' });
    expect(itemState({ kind: 'refused', why: 'Lo won’t run it.' })).toEqual({
      kind: 'refused',
      why: 'Lo won’t run it.',
    });
    expect(itemState({ kind: 'waiting', count: 4, next: true })).toEqual({
      kind: 'waiting',
      count: 4,
      next: true,
    });
    expect(itemState({ kind: 'failed', why: { kind: 'memory', cap: 4 * 1024 ** 3 } })).toEqual({
      kind: 'failed',
      why: { kind: 'memory', limit: '4 GB' },
    });
    expect(
      itemState({ kind: 'failed', why: { kind: 'error', message: 'It quit with exit code 1.' } }),
    ).toEqual({ kind: 'failed', why: { kind: 'error', message: 'It quit with exit code 1.' } });
  });

  it('copies as much of the log as a copy holds, newest lines kept', () => {
    expect(copiedLog(['one', 'two'])).toBe('one\ntwo');
    const long = 'x'.repeat(600 * 1024);
    expect(copiedLog([long, long, 'last'])).toBe(`${long}\nlast`);
  });
});
