// Reading which repositories a view's pull request joins: in its account's queue, at the priority
// asked, and given up on through the signal it's handed.

import type { GithubClient, Poller, ReadPriority } from '@lo/github';
import { describe, expect, it, vi } from 'vitest';

import { readRepositories, type RepositoryReading } from './repositories.ts';

/** A view of rozed-dev/e2e#80 acting as rozed-bot, its account's `readOnce` a stand-in. */
function reading() {
  /** The signal and priority of each read made. */
  const made: [AbortSignal | undefined, ReadPriority | undefined][] = [];
  const reads: Pick<Poller, 'readOnce'> = {
    readOnce(_request, signal, priority) {
      made.push([signal, priority]);
      return Promise.reject(new Error('stand-in'));
    },
  };
  const poller = vi.fn<RepositoryReading['poller']>(() => Promise.resolve(reads));
  const views = new Map([
    [
      't1',
      {
        repository: { owner: 'rozed-dev', name: 'e2e' },
        number: 80,
        acting: { kind: 'account' as const, login: 'rozed-bot' },
      },
    ],
  ]);
  const given: RepositoryReading = {
    pull: (id) => views.get(id),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- never reached: it acts as an account.
    anonymous: {} as GithubClient,
    poller,
  };
  return { given, made, poller };
}

describe('reading a view’s repositories', () => {
  it('reads in its account’s queue, at the priority asked, with the signal that gives it up', async () => {
    const { given, made, poller } = reading();
    const signal = new AbortController().signal;
    await expect(readRepositories(given, 't1', 'foreground', signal)).rejects.toThrow('stand-in');
    expect(poller).toHaveBeenCalledWith('rozed-bot');
    expect(made.at(-1)).toEqual([signal, 'foreground']);
    await expect(readRepositories(given, 't1', 'background', undefined)).rejects.toThrow(
      'stand-in',
    );
    expect(made.at(-1)).toEqual([undefined, 'background']);
  });

  it('reads nothing for a view that’s closed', async () => {
    const { given, made } = reading();
    await expect(readRepositories(given, 't9', 'foreground', undefined)).rejects.toThrow(
      'The view is closed',
    );
    expect(made).toEqual([]);
  });
});
