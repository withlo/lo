// Reads that git takes too long over, as a crafted pair of files can make it, stopped at their
// limit like fetches.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { GitError } from '../src/errors.ts';
import { gitAt } from '../src/find.ts';
import { DEFAULT_FETCH_LIMITS } from '../src/limits.ts';
import { parseOid } from '../src/oid.ts';
import { cacheFor, eventually, repoServer, tempFolder, wrappedGit } from './support.ts';

/** The processes on this machine that mention `text`. */
function processesMentioning(text: string): string[] {
  return execFileSync('ps', ['axww', '-o', 'command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes(text) && !line.includes('ps axww'));
}

test('a read past its limit is stopped with everything it started', async () => {
  const dir = tempFolder();
  const slow = join(dir, 'slow');
  // Once `slow` exists, every read below takes a minute, in a process of its own, as git's
  // children are; everything else is git's.
  const marker = `lo-slow-read-${Date.now()}`;
  const program = wrappedGit(join(dir, 'git'), {
    before: [
      `if [ -e '${slow}' ]; then`,
      '  case " $* " in',
      `    *" diff "*|*" check-attr "*|*" ls-tree "*|*" cat-file --batch-command "*) exec sh -c 'sleep 60' ${marker};;`,
      '  esac',
      'fi',
    ].join('\n'),
  });
  const found = await gitAt(program, { env: process.env, platform: process.platform });
  if (found.status !== 'found') throw new Error(found.message);
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  const base = parseOid(remote.write('a.txt', 'a\n').commit('base'));
  remote.publish('refs/heads/trunk');
  const head = parseOid(remote.switch('feature').write('a.txt', 'b\n').commit('head'));
  remote.publish('refs/pull/1/head');
  const limit = 1000;
  const cache = await cacheFor(server, {
    git: found.git,
    limits: { ...DEFAULT_FETCH_LIMITS, read: limit },
  });
  const repo = await cache.open('owner', 'repo');
  await repo.fetchPull({ number: 1, head, baseBranch: 'trunk' });
  expect(await repo.download(await repo.changedObjects(base, head))).toEqual([]);
  writeFileSync(slow, '');

  const a = Buffer.from('a.txt');
  for (const [what, read] of [
    ['a diff', () => repo.changedFiles(base, head)],
    ['a patch', () => repo.patch(base, head, a)],
    ['attributes', () => repo.attribute(head, 'linguist-generated', [a])],
    ['a listing', () => repo.tree(head)],
    ['a lookup through the reader', () => repo.readFile(head, a)],
  ] as const) {
    const began = Date.now();
    const error: unknown = await read().catch((caught: unknown) => caught);
    const took = Date.now() - began;
    expect.soft([what, error instanceof GitError && error.detail.kind]).toEqual([what, 'tooSlow']);
    expect.soft([what, took < limit * 5]).toEqual([what, true]);
  }
  await eventually(() => processesMentioning(marker).length === 0, 2000);
});
