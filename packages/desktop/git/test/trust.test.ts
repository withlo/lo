// Trusting a cached clone: one that holds anything Lo doesn't write, that would send git elsewhere
// or change what it reads, is moved aside and made again on open, before git runs on it.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { git } from '@lo/testing/git';
import { expect, test } from 'vitest';

import type { Cache } from '../src/cache.ts';
import { parseOid } from '../src/oid.ts';
import type { Repo } from '../src/repo.ts';
import { leadsElsewhere } from '../src/trust.ts';
import { blobs, fetch, type PullRequest, pullRequest } from './fixtures.ts';
import { cacheFor, repoServer, script, tempFolder } from './support.ts';

/** A cache with pull request #1 fetched into `owner/repo`'s clone, and a folder for markers. */
async function fetched(): Promise<{
  cache: Cache;
  repo: Repo;
  pr: PullRequest;
  markers: string;
  logged: string[];
}> {
  const server = repoServer();
  const pr = pullRequest(server);
  const logged: string[] = [];
  const cache = await cacheFor(server, { log: (line) => logged.push(line) });
  const repo = await cache.open('owner', 'repo');
  await fetch(repo, 1);
  repo.close();
  const markers = join(tempFolder(), 'markers');
  mkdirSync(markers);
  return { cache, repo, pr, markers, logged };
}

/** Whether opening the clone again made it anew: none of its refs, files or settings are left. */
async function madeAgain(cache: Cache, repo: Repo): Promise<boolean> {
  writeFileSync(join(repo.folder, 'marker'), '');
  const opened = await cache.open('owner', 'repo');
  opened.close();
  const refs = git(opened.folder, 'for-each-ref', '--format=%(refname)');
  return !existsSync(join(opened.folder, 'marker')) && refs === '';
}

test('a clone Lo made, and fetched into, is trusted as it is', async () => {
  const { cache, repo, logged } = await fetched();

  expect(await madeAgain(cache, repo)).toBe(false);
  expect(logged).toEqual([]);
});

test.each([
  'commondir',
  'gitdir',
  'config.worktree',
  'info/grafts',
  'info/attributes',
  'objects/info/alternates',
  'objects/info/http-alternates',
])('a clone holding %s is made again', async (file) => {
  const { cache, repo, logged } = await fetched();
  const path = join(repo.folder, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${join(tempFolder(), 'elsewhere')}\n`);

  expect(await madeAgain(cache, repo)).toBe(true);
  expect(existsSync(path)).toBe(false);
  expect(logged).toEqual([
    `owner/repo: making its local copy again, since it holds ${file}, which Lo never writes`,
  ]);
});

test('a clone with a setting Lo didn’t write is made again, and the setting never takes effect', async () => {
  const { cache, repo, markers } = await fetched();
  const fsmonitor = script(join(markers, '..', 'fsmonitor'), `/usr/bin/touch '${markers}/ran'`);
  git(repo.folder, 'config', 'core.fsmonitor', fsmonitor);

  expect(await madeAgain(cache, repo)).toBe(true);
  expect(readdirSync(markers)).toEqual([]);
});

test('a clone that includes settings from elsewhere is made again', async () => {
  const { cache, repo } = await fetched();
  // Settings in another file would pass a check of the clone's own, were includes followed.
  const elsewhere = join(tempFolder(), 'settings');
  writeFileSync(elsewhere, '[credential]\n\thelper = !touch owned\n');
  appendFileSync(join(repo.folder, 'config'), `[include]\n\tpath = ${elsewhere}\n`);

  expect(await madeAgain(cache, repo)).toBe(true);
});

test('a clone whose settings, objects or refs are links to elsewhere is made again', async () => {
  for (const entry of ['config', 'objects', 'refs', 'HEAD']) {
    const { cache, repo } = await fetched();
    const elsewhere = join(tempFolder(), entry);
    git(dirname(elsewhere), 'init', '-q', '--bare', 'other.git');
    const target = join(dirname(elsewhere), 'other.git', entry);
    rmSync(join(repo.folder, entry), { recursive: true });
    symlinkSync(target, join(repo.folder, entry));

    expect([entry, await madeAgain(cache, repo)]).toEqual([entry, true]);
  }
});

test('a clone git takes for another repository is caught on its own', async () => {
  const { cache, repo } = await fetched();
  expect(await leadsElsewhere(cache.runner, repo.folder)).toBeUndefined();

  const other = join(tempFolder(), 'other.git');
  git(dirname(other), 'init', '-q', '--bare', other);
  writeFileSync(join(repo.folder, 'commondir'), `${other}\n`);

  expect(await leadsElsewhere(cache.runner, repo.folder)).toMatch(/^it leads git to /);
});

/** Plants a checkout's folder in `repo`'s clone, naming `gitdir`, with `settings` if given. */
function plantCheckout(repo: Repo, gitdir: string, settings?: string): void {
  const worktree = join(repo.folder, 'worktrees', 'pull-1');
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(worktree, 'commondir'), '../..\n');
  writeFileSync(join(worktree, 'gitdir'), `${gitdir}\n`);
  writeFileSync(join(worktree, 'HEAD'), `${'0'.repeat(39)}1\n`);
  if (settings !== undefined) writeFileSync(join(worktree, 'config.worktree'), settings);
}

test('a checkout’s folder in a clone must point back at it and into Lo’s checkouts', async () => {
  const inside = await fetched();
  const checkouts = inside.cache.checkoutsFolder('owner', 'repo');
  plantCheckout(inside.repo, join(checkouts, 'pull-1', 'abc', '.git'));
  expect(await madeAgain(inside.cache, inside.repo)).toBe(false);

  const outside = await fetched();
  plantCheckout(outside.repo, join(tempFolder(), 'somewhere', '.git'));
  expect(await madeAgain(outside.cache, outside.repo)).toBe(true);

  const configured = await fetched();
  const own = join(configured.cache.checkoutsFolder('owner', 'repo'), 'pull-1', 'abc', '.git');
  plantCheckout(configured.repo, own, '[core]\n\tfsmonitor = touch owned\n');
  expect(await madeAgain(configured.cache, configured.repo)).toBe(true);

  const elsewhere = await fetched();
  plantCheckout(elsewhere.repo, join(checkouts, 'pull-1', 'abc', '.git'));
  writeFileSync(
    join(elsewhere.repo.folder, 'worktrees', 'pull-1', 'commondir'),
    `${tempFolder()}\n`,
  );
  expect(await madeAgain(elsewhere.cache, elsewhere.repo)).toBe(true);
});

test('a clone’s attributes, which would change a checkout’s bytes, make it again', async () => {
  const { cache, repo, pr } = await fetched();
  const opened = await cache.open('owner', 'repo');
  expect(await opened.download(blobs(opened, pr.head))).toEqual([]);
  opened.close();
  mkdirSync(join(repo.folder, 'info'), { recursive: true });
  writeFileSync(join(repo.folder, 'info', 'attributes'), '* text eol=crlf\n');
  // git applies a clone's own attributes whatever `--attr-source` says.
  const work = tempFolder();
  await cache.runner
    .command({ gitDir: repo.folder, workTree: work })
    .arg('checkout', '-f', pr.head, '--', 'feature.txt')
    .run();
  expect(readFileSync(join(work, 'feature.txt'), 'utf8')).toBe('first version\r\n');

  expect(await madeAgain(cache, repo)).toBe(true);
});

test('a hook planted in a clone never runs, and a replace ref changes nothing', async () => {
  const { cache, repo, pr, markers } = await fetched();
  // Swapping the head for the base would hide the pull request's change.
  git(repo.folder, 'replace', pr.head, pr.base);
  mkdirSync(join(repo.folder, 'hooks'), { recursive: true });
  script(join(repo.folder, 'hooks', 'reference-transaction'), `/usr/bin/touch '${markers}/hook'`);
  const opened = await cache.open('owner', 'repo');

  expect(await madeAgain(cache, repo)).toBe(false);
  pr.remote.switch('feature').write('more.txt', 'more\n');
  const pushed = parseOid(pr.remote.commit('more'));
  pr.remote.publish('refs/pull/1/head');
  const again = await fetch(opened, 1);

  expect(again.head).toBe(pushed);
  expect(await opened.mergeBase(pr.head, pr.trunkTip)).toBe(pr.base);
  expect(await opened.isAncestor(pr.base, pr.head)).toBe(true);
  expect(await opened.pullCommits(pr.trunkTip, pushed)).toEqual([pr.head, pushed]);
  expect(readdirSync(markers)).toEqual([]);
});

test('a clone of code with commits whose history it lacks is made again', async () => {
  const { cache, repo, pr } = await fetched();
  writeFileSync(join(repo.folder, 'shallow'), `${pr.trunkTip}\n`);

  expect(await madeAgain(cache, repo)).toBe(true);
});

test('a link anywhere in a clone, not just at its top, makes it again', async () => {
  for (const entry of ['objects/pack', 'refs/lo', 'refs/lo/pull/1/head']) {
    const { cache, repo } = await fetched();
    const elsewhere = join(tempFolder(), 'elsewhere');
    mkdirSync(elsewhere);
    rmSync(join(repo.folder, entry), { recursive: true, force: true });
    symlinkSync(elsewhere, join(repo.folder, entry));

    expect([entry, await madeAgain(cache, repo)]).toEqual([entry, true]);
  }
});

test('a clone with a setting that holds two values is made again', async () => {
  const { cache, repo } = await fetched();
  // git fetches from a remote's first address, and `config --get` reads its last.
  const settings = readFileSync(join(repo.folder, 'config'), 'utf8');
  writeFileSync(
    join(repo.folder, 'config'),
    `[remote "origin"]\n\turl = https://elsewhere.example/repo.git\n${settings}`,
  );

  expect(await madeAgain(cache, repo)).toBe(true);
});

/** Replaces `from` in the clone's settings with `to`, failing when they don't hold it. */
function rewriteSettings(repo: Repo, from: string, to: string): void {
  const path = join(repo.folder, 'config');
  const settings = readFileSync(path, 'utf8');
  expect(settings).toContain(from);
  writeFileSync(path, settings.replace(from, to));
}

test('a clone whose promisor is a remote of another name is made again', async () => {
  const { cache, repo, logged } = await fetched();
  // git tells remotes apart by case: fetches would download what the clone lacks from `Origin`,
  // which Lo never points at GitHub, rather than from `origin`.
  rewriteSettings(repo, '[remote "origin"]', '[remote "Origin"]');
  rewriteSettings(repo, 'partialclone = origin', 'partialclone = Origin');

  expect(await madeAgain(cache, repo)).toBe(true);
  expect(logged).toEqual([
    "owner/repo: making its local copy again, since it has settings Lo didn't write " +
      '(remote.Origin.url, remote.Origin.promisor, remote.Origin.partialclonefilter)',
  ]);
});

test.each([
  ['extensions.partialclone', 'upstream'],
  ['remote.origin.promisor', 'false'],
  ['remote.origin.partialclonefilter', 'tree:0'],
  ['remote.origin.url', 'https://elsewhere.example/owner/repo.git'],
  ['core.bare', 'false'],
  ['core.repositoryformatversion', '0'],
  ['core.logallrefupdates', 'always'],
])('a clone with %s set to %s, which Lo never sets, is made again', async (name, value) => {
  const { cache, repo, logged } = await fetched();
  git(repo.folder, 'config', name, value);

  expect(await madeAgain(cache, repo)).toBe(true);
  expect(logged).toEqual([
    `owner/repo: making its local copy again, since it has settings Lo set otherwise (${name})`,
  ]);
});

test('a clone with a setting Lo writes, but without its value, is made again', async () => {
  const { cache, repo, logged } = await fetched();
  // A name alone sets it to true, which isn't how Lo writes it.
  rewriteSettings(repo, 'promisor = true', 'promisor');

  expect(await madeAgain(cache, repo)).toBe(true);
  expect(logged).toEqual([
    'owner/repo: making its local copy again, since it has settings Lo set otherwise ' +
      '(remote.origin.promisor)',
  ]);
});

test('a clone that fails the check is never pulled out from under a repository reading it', async () => {
  const { cache, repo } = await fetched();
  const reading = await cache.open('owner', 'repo');
  writeFileSync(join(repo.folder, 'commondir'), '/elsewhere\n');

  await expect(cache.open('owner', 'repo')).rejects.toThrow('is still open');
  expect(existsSync(join(reading.folder, 'commondir'))).toBe(true);
  reading.close();
  expect(await madeAgain(cache, repo)).toBe(true);
});
