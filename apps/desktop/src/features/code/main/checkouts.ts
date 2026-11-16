// Letting go of the checkouts of what's no longer trusted, in Lo's cache of repositories, where
// each pull request's checkouts are a folder of the repository's, `pull-<number>`: once an entry
// is out of the settings file, and as Lo starts, for entries taken out while it was closed.
// Nothing here calls Electron, so it runs under unit tests.

import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { sameName, type TrustEntry } from '../settings.ts';
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

/** The folders in `folder`, none when it isn't there. */
async function foldersIn(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (Reflect.get(Object(error), 'code') === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Removes every checkout in `cache` that none of `entries` trusts, as Lo starts: those of an entry
 * taken out of the settings file while Lo was closed. A repository's entry keeps all its checkouts,
 * and a pull request's keeps that pull request's. Each repository goes on its own, so one that
 * can't be removed leaves the others, and says why in `log`.
 */
export async function letGoUntrusted(
  cache: CheckoutCache,
  entries: readonly TrustEntry[],
  log: (line: string) => void,
): Promise<void> {
  // The folder every repository's checkouts are in, by owner, as the cache lays them out.
  const host = dirname(dirname(cache.checkoutsFolder('owner', 'name')));
  for (const owner of await foldersIn(host)) {
    for (const name of await foldersIn(join(host, owner))) {
      const repo = `${owner}/${name}`;
      const named = entries.filter((entry) => sameName(entry.repo, repo));
      if (named.some((entry) => entry.kind === 'repo')) continue;
      const except = named.flatMap((entry) => (entry.kind === 'pull' ? [entry.pull] : []));
      try {
        await letGo(cache, { repo, except: [...new Set(except)] });
      } catch (error) {
        log(`couldn't let go of ${repo}'s checkouts: ${String(error)}`);
      }
    }
  }
}
