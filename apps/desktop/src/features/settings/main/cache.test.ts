import { describe, expect, it, vi } from 'vitest';

import { clear, measure, type Copies } from './cache.ts';

/** An open cache that takes `size` bytes under `cap`, with `copies` that are in use. */
function open(size: number, cap: number, inUse: string[] = []): NonNullable<Copies['cache']> {
  return {
    size: vi.fn<() => Promise<number>>(async () => size),
    cap,
    clear: vi.fn<() => Promise<string[]>>(async () => inUse),
  };
}

describe('measure', () => {
  it('says how much room the copies take against the cap, once the cache is open', async () => {
    const cache = open(6_657_199_308, 10 * 1024 ** 3);
    expect(await measure({ cache, status: { status: 'found' } })).toEqual({
      status: 'ready',
      used: 6_657_199_308,
      cap: 10 * 1024 ** 3,
    });
    expect(await measure({ cache: open(0, 1024 ** 3), status: undefined })).toEqual({
      status: 'ready',
      used: 0,
      cap: 1024 ** 3,
    });
  });

  it('is still looking until Lo has looked for git, and while it opens the cache after finding it', async () => {
    expect(await measure({ cache: undefined, status: undefined })).toEqual({ status: 'checking' });
    expect(await measure({ cache: undefined, status: { status: 'found' } })).toEqual({
      status: 'checking',
    });
  });

  it('has no cache without a git that works', async () => {
    for (const status of ['missing', 'tooOld'] as const) {
      expect(await measure({ cache: undefined, status: { status } })).toEqual({
        status: 'unavailable',
      });
    }
  });

  it('says nothing of a size the window could not take', async () => {
    // A size under nothing, and a cap of nothing: the reply's own schema refuses them.
    await expect(measure({ cache: open(-1, 1024), status: undefined })).rejects.toThrow(
      /too small/i,
    );
    await expect(measure({ cache: open(1, 0), status: undefined })).rejects.toThrow(/too small/i);
  });
});

/** What clears answers, and how often it was asked to. */
function answers() {
  return { clearAnswers: vi.fn<() => void>() };
}

describe('clear', () => {
  it('clears the cache, and says how many copies it had to leave', async () => {
    const cache = open(5, 10, ['withlo/lo', 'sharkdp/fd']);
    expect(await clear({ cache }, answers())).toEqual({ kept: 2 });
    expect(cache.clear).toHaveBeenCalledTimes(1);
    expect(await clear({ cache: open(5, 10) }, answers())).toEqual({ kept: 0 });
  });

  it('clears the answers saved from GitHub with them', async () => {
    const saved = answers();
    await clear({ cache: open(5, 10) }, saved);
    expect(saved.clearAnswers).toHaveBeenCalledTimes(1);
  });

  it('clears the answers, and nothing else, when there is no cache', async () => {
    const saved = answers();
    expect(await clear({ cache: undefined }, saved)).toEqual({ kept: 0 });
    expect(saved.clearAnswers).toHaveBeenCalledTimes(1);
  });

  it('fails, as anything else would, when the answers can’t be cleared, leaving the copies', async () => {
    const cache = open(5, 10);
    await expect(
      clear(
        { cache },
        {
          clearAnswers: () => {
            throw new Error('The database is locked.');
          },
        },
      ),
    ).rejects.toThrow('The database is locked.');
    expect(cache.clear).not.toHaveBeenCalled();
  });

  it('clears what other features keep, before the copies, and fails when one can’t', async () => {
    const cache = open(5, 10);
    const order: string[] = [];
    vi.mocked(cache.clear).mockImplementation(async () => {
      order.push('copies');
      return [];
    });
    const saved = { clearAnswers: () => order.push('answers') };
    await clear({ cache }, saved, [() => order.push('overviews'), () => order.push('other')]);
    expect(order).toEqual(['answers', 'overviews', 'other', 'copies']);

    const failing = open(5, 10);
    await expect(
      clear({ cache: failing }, answers(), [
        () => {
          throw new Error('The database is locked.');
        },
      ]),
    ).rejects.toThrow('locked');
    expect(failing.clear).not.toHaveBeenCalled();
  });
});
