// What the overview feature's tests share of git: a pull request's local copy in a cache of its
// own, fetching from a remote standing in for GitHub, with nothing fetched into it yet.

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Repo } from '@lo/git';
import { gitProgram } from '@lo/testing/git';
import { onTestFinished } from 'vitest';

import { createGit } from '../../../main/git.ts';

/** A new, empty folder. */
export function folder(prefix = 'lo-overview-'): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/**
 * The local copy of `owner/name` in a new cache in `root`, fetching from `remote`, a `file://`
 * address of `<owner>/<name>.git` repositories, and a function that closes it.
 */
export async function cloneFrom(
  remote: string,
  owner: string,
  name: string,
  root = folder(),
): Promise<{ repo: Repo; close: () => Promise<void> }> {
  const git = createGit({
    settings: { program: gitProgram(), test: { remote } },
    root: join(root, 'cache'),
    env: process.env,
    platform: process.platform,
    log: () => undefined,
    cleanUp: () => Promise.resolve(),
  });
  await git.check();
  const cache = git.cache;
  if (!cache) throw new Error('the cache is closed');
  const repo = await cache.open(owner, name, {});
  return {
    repo,
    close: async () => {
      repo.close();
      await git.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** The local copy of `owner/name`, as {@link cloneFrom} makes it, closed as the test ends. */
export async function testClone(remote: string, owner: string, name: string): Promise<Repo> {
  const { repo, close } = await cloneFrom(remote, owner, name);
  onTestFinished(close);
  return repo;
}
