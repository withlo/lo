// What Settings asks of the cache: how much room the local copies take, and clearing them with the
// answers Lo saved from GitHub. Nothing here calls Electron, so it runs under unit tests.

import type { Cache, GitStatus } from '@lo/git';

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

/** What clears the answers Lo saved from GitHub, which are kept with the accounts. */
export interface Answers {
  clearAnswers(): void;
}

/**
 * Clears what Lo keeps to open pull requests fast: the answers it saved from GitHub, what `others`
 * clear (what other features keep, such as overviews' files), and the local copies that aren't in
 * use, which it says how many it had to leave. Accounts, the pull requests opened lately and every
 * mark are elsewhere, and stay. With no cache, there are no copies to clear but the rest goes all
 * the same.
 */
export async function clear(
  { cache }: Pick<Copies, 'cache'>,
  answers: Answers,
  others: Iterable<() => void> = [],
): Promise<CacheCleared> {
  answers.clearAnswers();
  for (const each of others) each();
  const left = cache ? await cache.clear() : [];
  return cacheCleared.parse({ kept: left.length });
}
