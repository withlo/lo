// What Settings asks of the cache of local copies: how much room it takes, and clearing it. Nothing
// here calls Electron, so it runs under unit tests.

import type { Cache, GitStatus } from '@lo/git';

import { IpcError } from '../../../ipc/contract.ts';
import { cacheCleared, cacheUsage, type CacheCleared, type CacheUsage } from '../contract.ts';

/** What these need of git: the cache of local copies once it's open, and what Lo found of git. */
export interface Copies {
  readonly cache: Pick<Cache, 'size' | 'cap' | 'clear'> | undefined;
  readonly status: { readonly status: GitStatus['status'] } | undefined;
}

/**
 * How much room the local copies take against the cap, or why there are none. Before Lo has looked
 * for git, and while it opens the cache once it has found it, the answer is `checking`; with no git
 * that works there is no cache.
 */
export async function measure({ cache, status }: Copies): Promise<CacheUsage> {
  if (cache) return cacheUsage.parse({ status: 'ready', used: await cache.size(), cap: cache.cap });
  const looking = status === undefined || status.status === 'found';
  return cacheUsage.parse({ status: looking ? 'checking' : 'unavailable' });
}

/**
 * Removes the local copies that aren't in use, and says how many it had to leave. Accounts, marks
 * and everything else Lo keeps are elsewhere, and stay.
 */
export async function clear({ cache }: Pick<Copies, 'cache'>): Promise<CacheCleared> {
  if (!cache) throw new IpcError('unavailable', 'Lo has no local copies to clear.');
  return cacheCleared.parse({ kept: (await cache.clear()).length });
}
