// A pull request's local copy for the merge feature's tests: in a cache of its own, fetching from a
// remote standing in for GitHub, with nothing fetched into it yet, closed as the test ends.

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Repo } from '@lo/git';
import { gitProgram } from '@lo/testing/git';
import { onTestFinished } from 'vitest';

import { createGit } from '../../../../main/git.ts';

/** The local copy of `owner/name`, fetching from `remote`, a `file://` address of repositories. */
export async function testClone(remote: string, owner: string, name: string): Promise<Repo> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lo-merge-')));
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
  onTestFinished(async () => {
    repo.close();
    await git.stop();
    rmSync(root, { recursive: true, force: true });
  });
  return repo;
}
