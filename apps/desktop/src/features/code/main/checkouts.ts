// Letting go of the checkouts of what's no longer trusted, in Lo's cache of repositories, where
// each pull request's checkouts are a folder of the repository's, `pull-<number>`. Nothing here
// calls Electron, so it runs under unit tests.

import { readdir } from 'node:fs/promises';

import type { Drop } from './entries.ts';

/** What letting go needs of the cache. */
export interface CheckoutCache {
  checkoutsFolder(owner: string, name: string): string;
  dropCheckouts(owner: string, name: string, options?: { pull?: number }): Promise<void>;
}

/** Each pull request's folder of checkouts, by its number. */
const PULL_FOLDER = /^pull-([1-9]\d{0,9})$/;

/**
 * Removes the checkouts `drop` names from `cache`: one pull request's, or a repository's but for
 * the pull requests it keeps, each removed by the cache, which refuses a link on the way.
 */
export async function letGo(cache: CheckoutCache, drop: Drop): Promise<void> {
  const [owner = '', name = ''] = drop.repo.split('/');
  if ('pull' in drop) {
    await cache.dropCheckouts(owner, name, { pull: drop.pull });
    return;
  }
  if (drop.except.length === 0) {
    await cache.dropCheckouts(owner, name);
    return;
  }
  let folders: string[];
  try {
    folders = await readdir(cache.checkoutsFolder(owner, name));
  } catch (error) {
    // No checkouts at all.
    if (Reflect.get(Object(error), 'code') === 'ENOENT') return;
    throw error;
  }
  for (const folder of folders) {
    const number = PULL_FOLDER.exec(folder)?.[1];
    const pull = number === undefined ? undefined : Number(number);
    if (pull !== undefined && !drop.except.includes(pull)) {
      await cache.dropCheckouts(owner, name, { pull });
    }
  }
}
