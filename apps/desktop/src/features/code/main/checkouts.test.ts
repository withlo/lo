// Letting go of checkouts in the cache: a pull request's, or a repository's but those still
// trusted, each through the cache; and, as Lo starts, every checkout no entry trusts.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { letGo, letGoUntrusted, type CheckoutCache } from './checkouts.ts';

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

describe('letting go of what nothing trusts as Lo starts', () => {
  it('removes the checkouts of entries taken out while Lo was closed, and keeps those still trusted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lo-checkouts-'));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const host = join(root, 'checkouts', 'github.com');
    for (const folder of [
      'rozed-dev/e2e/pull-80',
      'rozed-dev/e2e/pull-97',
      'rozed-dev/kept/pull-1',
      'rozed-dev/forks/pull-5',
      'rozed-dev/forks/pull-6',
      'someone/gone/pull-2',
    ]) {
      mkdirSync(join(host, folder), { recursive: true });
    }
    const dropped: string[] = [];
    const cache: CheckoutCache = {
      checkoutsFolder: (owner, name) => join(host, owner, name),
      dropCheckouts(owner, name, options) {
        dropped.push(`${owner}/${name}${options?.pull === undefined ? '' : `#${options.pull}`}`);
        return Promise.resolve();
      },
    };
    await letGoUntrusted(
      cache,
      [
        { kind: 'repo', repo: 'Rozed-Dev/Kept', id: 'R_kept' },
        {
          kind: 'pull',
          repo: 'rozed-dev/forks',
          id: 'R_forks',
          pull: 5,
          from: 'rozed-bot/forks',
          fromId: 'R_bot',
        },
      ],
      () => undefined,
    );
    expect(dropped.toSorted()).toEqual(['rozed-dev/e2e', 'rozed-dev/forks#6', 'someone/gone']);
  });
});
