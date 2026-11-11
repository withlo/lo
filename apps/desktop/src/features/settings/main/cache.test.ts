import { describe, expect, it, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
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

describe('clear', () => {
  it('clears the cache, and says how many copies it had to leave', async () => {
    const cache = open(5, 10, ['withlo/lo', 'sharkdp/fd']);
    expect(await clear({ cache })).toEqual({ kept: 2 });
    expect(cache.clear).toHaveBeenCalledTimes(1);
    expect(await clear({ cache: open(5, 10) })).toEqual({ kept: 0 });
  });

  it('fails as unavailable when there is no cache', async () => {
    const failure = clear({ cache: undefined });
    await expect(failure).rejects.toBeInstanceOf(IpcError);
    await expect(failure).rejects.toMatchObject({
      code: 'unavailable',
      message: 'Lo has no local copies to clear.',
    });
  });
});
