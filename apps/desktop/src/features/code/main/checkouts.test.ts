// Letting go of checkouts in the cache: a pull request's, or a repository's but those still
// trusted, each through the cache.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { letGo, type CheckoutCache } from './checkouts.ts';

/** A cache whose checkouts are folders named `pulls`, noting what it's asked to remove. */
function cacheWith(pulls: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), 'lo-checkouts-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'rozed-dev', 'e2e');
  for (const pull of pulls) mkdirSync(join(folder, pull), { recursive: true });
  const dropped: (number | 'all')[] = [];
  const cache: CheckoutCache = {
    checkoutsFolder: (owner, name) => join(root, owner, name),
    dropCheckouts(_owner, _name, options) {
      dropped.push(options?.pull ?? 'all');
      return Promise.resolve();
    },
  };
  return { cache, dropped };
}

describe('letting go of checkouts', () => {
  it('removes a repository’s checkouts but those of the pull requests still trusted', async () => {
    const { cache, dropped } = cacheWith(['pull-80', 'pull-97', 'pull-12', 'notes']);
    await letGo(cache, { repo: 'rozed-dev/e2e', except: [97] });
    expect(dropped.toSorted((one, other) => Number(one) - Number(other))).toEqual([12, 80]);
  });

  it('removes all of a repository’s when none are still trusted, and one pull request’s', async () => {
    const { cache, dropped } = cacheWith(['pull-80']);
    await letGo(cache, { repo: 'rozed-dev/e2e', except: [] });
    await letGo(cache, { repo: 'rozed-dev/e2e', pull: 97 });
    expect(dropped).toEqual(['all', 97]);
  });

  it('removes nothing from a repository with no checkouts', async () => {
    const { cache, dropped } = cacheWith([]);
    await letGo(cache, { repo: 'rozed-dev/other', except: [97] });
    expect(dropped).toEqual([]);
  });
});
