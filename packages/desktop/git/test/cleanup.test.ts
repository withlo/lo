// The cache's size, clearing it, removing what nobody used for a while, its cap, and repacking.

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { git, gitBytes, type RepoServer } from '@lo/testing/git';
import { expect, test } from 'vitest';

import type { Cache } from '../src/cache.ts';
import { CHECKOUTS_UNUSED_FOR, repackArguments, UNUSED_FOR } from '../src/cleanup.ts';
import { Git } from '../src/git.ts';
import { type Oid, parseOid } from '../src/oid.ts';
import { gitAt } from '../src/find.ts';
import type { Activity } from '../src/progress.ts';
import type { Repo } from '../src/repo.ts';
import { STOP_GRACE } from '../src/spawn.ts';
import {
  cacheFor,
  compared,
  eventually,
  foundGit,
  repoServer,
  tempFolder,
  wrappedGit,
} from './support.ts';

const DAY = 24 * 60 * 60 * 1000;

/** A server with repositories `owner/old` and `owner/new`, or `names`, each with pull request #1. */
function server(names = ['old', 'new']): RepoServer {
  const made = repoServer();
  for (const name of names) {
    const remote = made.repo('owner', name);
    remote.write('README.md', `# ${name}\n`).commit('base');
    remote.publish('refs/heads/trunk');
    remote.switch('feature').write('feature.txt', 'feature\n').commit('feature');
    remote.publish('refs/pull/1/head');
  }
  return made;
}

async function fetch(repo: Repo): Promise<Oid> {
  return (await repo.fetchPull({ number: 1, baseBranch: 'trunk' })).head;
}

/** Opens `owner/name`, fetches pull request #1 and checks it out. */
async function openAndCheckOut(cache: Cache, name: string): Promise<Repo> {
  const repo = await cache.open('owner', name);
  await repo.checkout(1, await fetch(repo));
  return repo;
}

/** {@link openAndCheckOut}, then closes it again. Returns the clone's folder. */
async function useRepo(cache: Cache, name: string): Promise<string> {
  const repo = await openAndCheckOut(cache, name);
  repo.close();
  return repo.folder;
}

/** Writes a last-used stamp `days` old into `folder`. */
function stampDaysAgo(folder: string, days: number): void {
  writeFileSync(join(folder, 'lo-last-used'), `${Math.floor((Date.now() - days * DAY) / 1000)}\n`);
}

/** Makes `path`, a file or a folder, look last written `days` ago. */
function writtenDaysAgo(path: string, days: number): void {
  const then = new Date(Date.now() - days * DAY);
  utimesSync(path, then, then);
}

/**
 * A folder outside the cache, holding files cleanup must never touch, laid out like what it
 * removes: `old.git`, an unused clone; `ghost`, an orphaned checkout; `old/pull-1`, a checkout.
 */
function outsideFolder(): string {
  const outside = tempFolder();
  for (const folder of ['old.git', 'ghost', 'old/pull-1']) {
    mkdirSync(join(outside, folder), { recursive: true });
    writeFileSync(join(outside, folder, 'keep.txt'), 'important\n');
  }
  stampDaysAgo(join(outside, 'old.git'), 365);
  return outside;
}

/** Whether every file in {@link outsideFolder} is still there. */
function untouched(outside: string): boolean {
  return ['old.git', 'ghost', 'old/pull-1'].every((folder) =>
    existsSync(join(outside, folder, 'keep.txt')),
  );
}

/** Makes the checkout in `folder` look last used `days` ago, through its git folder's stamp. */
function checkoutUsedDaysAgo(folder: string, days: number): void {
  const gitDir = readFileSync(join(folder, '.git'), 'utf8').slice('gitdir:'.length).trim();
  stampDaysAgo(gitDir, days);
}

test('size counts clones and checkouts', async () => {
  const cache = await cacheFor(server());
  const empty = await cache.size();

  await useRepo(cache, 'old');

  const used = await cache.size();
  expect(used).toBeGreaterThan(empty);
  // At least the checkout's files and the clone's packs.
  expect(used).toBeGreaterThan(8 * 1024);
});

test('clear removes every clone and checkout', async () => {
  const cache = await cacheFor(server());
  await useRepo(cache, 'old');
  await useRepo(cache, 'new');

  expect(await cache.clear()).toEqual([]);

  expect(readdirSync(join(cache.root, 'repos/github.com'))).toEqual([]);
  expect(readdirSync(join(cache.root, 'checkouts/github.com'))).toEqual([]);
  expect(await cache.size()).toBeLessThan(64 * 1024);
  // And the cache still works.
  expect(existsSync(await useRepo(cache, 'old'))).toBe(true);
});

test('clear leaves a clone another lo is making alone', async () => {
  const cache = await cacheFor(server());
  await useRepo(cache, 'old');
  // A clone being made, in a temporary folder of its own; and one still open, which stays.
  const making = join(cache.root, 'tmp/99999-0.git');
  mkdirSync(making, { recursive: true });
  writeFileSync(join(making, 'HEAD'), 'ref: refs/heads/main\n');
  const open = await openAndCheckOut(cache, 'new');

  expect(await cache.clear()).toEqual(['owner/new']);

  expect(existsSync(join(making, 'HEAD'))).toBe(true);
  expect(readdirSync(join(cache.root, 'repos/github.com/owner'))).toEqual(['new.git']);
  expect(existsSync(open.folder)).toBe(true);
  expect(readdirSync(join(cache.root, 'tmp'))).toEqual(['99999-0.git']);
});

test('removes only clones unused for a month and their checkouts', async () => {
  const cache = await cacheFor(server());
  const old = await useRepo(cache, 'old');
  const fresh = await useRepo(cache, 'new');
  stampDaysAgo(old, 31);
  stampDaysAgo(fresh, 29);
  // A checkout whose clone is gone.
  const orphan = join(cache.root, 'checkouts/github.com/someone/ghost/pull-3');
  mkdirSync(orphan, { recursive: true });
  writeFileSync(join(orphan, 'file.txt'), 'orphaned\n');

  expect(await cache.removeUnused()).toEqual(['owner/old']);

  const checkouts = join(cache.root, 'checkouts/github.com');
  expect(existsSync(old)).toBe(false);
  expect(existsSync(join(checkouts, 'owner/old'))).toBe(false);
  const head = git(fresh, 'rev-parse', 'refs/lo/pull/1/head');
  expect(existsSync(join(checkouts, `owner/new/pull-1/${head}/README.md`))).toBe(true);
  expect(existsSync(join(checkouts, 'someone'))).toBe(false);
  // Each was moved aside, then deleted, leaving nothing behind.
  expect(readdirSync(join(cache.root, 'tmp'))).toEqual([]);

  // Nothing else is stale now.
  expect(await cache.removeUnused()).toEqual([]);
});

test('a clone being written to is kept', async () => {
  const cache = await cacheFor(server());
  const old = await useRepo(cache, 'old');
  stampDaysAgo(old, 31);
  // A fetch holds the clone's lock.
  const release = await cache.cloneLock('owner', 'old').acquire('fetching pull request #1');

  expect(await cache.removeUnused()).toEqual([]);
  expect(existsSync(old)).toBe(true);

  // Once it lets go, the clone goes.
  release();
  expect(await cache.removeUnused()).toEqual(['owner/old']);
});

test('opening a clone keeps it', async () => {
  const cache = await cacheFor(server());
  const old = await useRepo(cache, 'old');
  stampDaysAgo(old, 31);

  (await cache.open('owner', 'old')).close();

  expect(await cache.removeUnused()).toEqual([]);
});

test('cleanup never follows a symlinked owner folder', async () => {
  const cache = await cacheFor(server());
  const old = await useRepo(cache, 'old');
  stampDaysAgo(old, 31);
  const outside = outsideFolder();
  // Owner folders that are links to a folder outside the cache: one with what looks like an
  // unused clone, one with what looks like an orphaned checkout.
  symlinkSync(outside, join(cache.root, 'repos/github.com/someone'));
  symlinkSync(outside, join(cache.root, 'checkouts/github.com/someone'));

  expect(await cache.removeUnused()).toEqual(['owner/old']);

  expect(untouched(outside)).toBe(true);
  // The real unused clone still goes.
  expect(existsSync(old)).toBe(false);
});

test('cleanup never follows a symlinked repository or checkouts folder', async () => {
  const cache = await cacheFor(server());
  const old = await useRepo(cache, 'old');
  stampDaysAgo(old, 31);
  const outside = outsideFolder();
  // The unused clone's checkouts, and an orphaned repository's, are links out of the cache.
  const checkouts = join(cache.root, 'checkouts/github.com/owner');
  rmSync(join(checkouts, 'old'), { recursive: true });
  symlinkSync(join(outside, 'old'), join(checkouts, 'old'));
  symlinkSync(join(outside, 'ghost'), join(checkouts, 'ghost'));
  symlinkSync(join(outside, 'old.git'), join(cache.root, 'repos/github.com/owner/stale.git'));

  expect(await cache.removeUnused()).toEqual(['owner/old']);

  expect(untouched(outside)).toBe(true);
  expect(existsSync(old)).toBe(false);
});

test('cleanup never follows a symlink above a clones checkouts', async () => {
  const cache = await cacheFor(server());
  const old = await useRepo(cache, 'old');
  stampDaysAgo(old, 31);
  const outside = outsideFolder();
  // The owner folder above the unused clone's checkouts is a link out of the cache.
  const checkouts = join(cache.root, 'checkouts/github.com/owner');
  rmSync(checkouts, { recursive: true });
  symlinkSync(outside, checkouts);

  expect(await cache.removeUnused()).toEqual(['owner/old']);

  expect(untouched(outside)).toBe(true);
  expect(existsSync(old)).toBe(false);
});

test('a clone still open is kept', async () => {
  const cache = await cacheFor(server());
  const open = await openAndCheckOut(cache, 'old');
  stampDaysAgo(open.folder, 31);

  // A launch, while a pull request from the clone is still shown.
  expect(await cache.removeUnused()).toEqual([]);
  expect(existsSync(open.folder)).toBe(true);

  open.close();
  expect(await cache.removeUnused()).toEqual(['owner/old']);
  expect(existsSync(open.folder)).toBe(false);
});

test('fetching or checking out keeps a clone', async () => {
  const cache = await cacheFor(server());
  for (const name of ['old', 'new']) {
    // Opened a month ago, and used since.
    const repo = await cache.open('owner', name);
    stampDaysAgo(repo.folder, 31);
    const head = await fetch(repo);
    if (name === 'new') {
      stampDaysAgo(repo.folder, 31);
      await repo.checkout(1, head);
    }
    repo.close();
  }

  expect(await cache.removeUnused()).toEqual([]);
});

test('removes partial packs left a day ago', async () => {
  const cache = await cacheFor(server());
  const folder = await useRepo(cache, 'new');
  const packs = join(folder, 'objects/pack');
  // What a fetch stopped, or one that crashed, leaves: a pack it hadn't finished.
  const [old, recent] = [join(packs, 'tmp_pack_aB3dEf'), join(packs, 'tmp_pack_gH5iJk')];
  writeFileSync(old, '');
  writeFileSync(recent, '');
  writtenDaysAgo(old, 2);
  const finished = readdirSync(packs).filter((name) => !name.startsWith('tmp_'));
  expect(finished).not.toEqual([]);

  expect(await cache.removeUnused()).toEqual([]);

  expect(existsSync(old)).toBe(false);
  // Something may still be writing a recent one.
  expect(existsSync(recent)).toBe(true);
  expect(finished.filter((name) => !existsSync(join(packs, name)))).toEqual([]);
});

test('cleanup never follows a symlinked pack folder', async () => {
  const cache = await cacheFor(server());
  const folder = await useRepo(cache, 'new');
  // Someone put a link to a folder outside the cache where the clone's packs go.
  const outside = tempFolder();
  const theirs = join(outside, 'tmp_pack_aB3dEf');
  writeFileSync(theirs, '');
  writtenDaysAgo(theirs, 2);
  const packs = join(folder, 'objects/pack');
  renameSync(packs, join(folder, 'objects/pack-moved'));
  symlinkSync(outside, packs);

  await cache.removeUnused();

  expect(existsSync(theirs)).toBe(true);
});

test('removes what fetches and crashes left a day ago past what it cant', async () => {
  const cache = await cacheFor(server());
  const tmp = join(cache.root, 'tmp');
  // A trace a fetch left when Lo quit, a temporary clone a crash left, and recent ones of each.
  const [oldTrace, recentTrace] = [join(tmp, '1-0.trace'), join(tmp, '1-1.trace')];
  const [oldClone, recentClone] = [join(tmp, '1-2.git'), join(tmp, '1-3.git')];
  for (const trace of [oldTrace, recentTrace]) writeFileSync(trace, '{"event":"version"}\n');
  for (const clone of [oldClone, recentClone]) {
    mkdirSync(clone);
    writeFileSync(join(clone, 'HEAD'), 'ref: refs/heads/main\n');
  }
  // And one nothing can remove: a folder in it can't be written to.
  const stuck = join(tmp, '1-4.trash');
  mkdirSync(join(stuck, 'locked'), { recursive: true });
  writeFileSync(join(stuck, 'locked/file'), 'stuck\n');
  chmodSync(join(stuck, 'locked'), 0o555);
  for (const old of [oldTrace, oldClone, stuck]) writtenDaysAgo(old, 2);

  const removed = await cache.removeUnused().finally(() => chmodSync(join(stuck, 'locked'), 0o755));

  expect(removed).toEqual([]);
  expect(existsSync(oldTrace)).toBe(false);
  expect(existsSync(oldClone)).toBe(false);
  expect(existsSync(join(stuck, 'locked/file'))).toBe(true);
  // Something may still be writing a recent one.
  expect(existsSync(recentTrace)).toBe(true);
  expect(existsSync(join(recentClone, 'HEAD'))).toBe(true);
});

test('removes checkouts unused for two weeks', async () => {
  const cache = await cacheFor(server());
  const repo = await cache.open('owner', 'old');
  const head = await fetch(repo);
  const base = parseOid(git(repo.folder, 'rev-parse', 'refs/lo/pull/1/base'));
  const stale = await repo.checkout(1, head);
  const fresh = await repo.checkout(2, base);
  checkoutUsedDaysAgo(stale, 15);
  checkoutUsedDaysAgo(fresh, 13);
  repo.close();

  // No clone goes, but the stale checkout does, as the clone isn't open.
  expect(await cache.removeUnused()).toEqual([]);

  expect(existsSync(stale)).toBe(false);
  // Nor its empty `pull-1` folder.
  expect(existsSync(join(stale, '..'))).toBe(false);
  expect(existsSync(join(fresh, 'README.md'))).toBe(true);
  const worktrees = git(repo.folder, 'worktree', 'list', '--porcelain');
  expect(worktrees).not.toContain(stale);
  expect(worktrees.split('worktree ').length - 1).toBe(2);
});

test('a checkout of a clone still open is kept', async () => {
  const cache = await cacheFor(server());
  const repo = await cache.open('owner', 'old');
  const checkout = await repo.checkout(1, await fetch(repo));
  checkoutUsedDaysAgo(checkout, 15);

  await cache.removeUnused();

  expect(existsSync(join(checkout, 'README.md'))).toBe(true);
  repo.close();
});

test('checking a head out again keeps its checkout', async () => {
  const cache = await cacheFor(server());
  const repo = await cache.open('owner', 'old');
  const head = await fetch(repo);
  const checkout = await repo.checkout(1, head);
  checkoutUsedDaysAgo(checkout, 15);
  await repo.checkout(1, head);
  repo.close();

  await cache.removeUnused();

  expect(existsSync(join(checkout, 'README.md'))).toBe(true);
});

test('the limits are a month for clones and two weeks for checkouts', () => {
  expect([UNUSED_FOR, CHECKOUTS_UNUSED_FOR]).toEqual([30 * DAY, 14 * DAY]);
});

/** The one checkout of `owner/name`'s pull request #1. */
function checkoutOf(cache: Cache, name: string): string {
  const folder = join(cache.checkoutsFolder('owner', name), 'pull-1');
  const [head, ...more] = readdirSync(folder);
  if (head === undefined || more.length > 0) throw new Error(`${folder} doesn't hold one checkout`);
  return join(folder, head);
}

test('past its cap the least recently used checkouts go first, only until the cache is under', async () => {
  const cache = await cacheFor(server());
  const [old, fresh] = [await useRepo(cache, 'old'), await useRepo(cache, 'new')];
  const [oldCheckout, newCheckout] = [checkoutOf(cache, 'old'), checkoutOf(cache, 'new')];
  stampDaysAgo(old, 10);
  stampDaysAgo(fresh, 1);
  checkoutUsedDaysAgo(oldCheckout, 10);
  checkoutUsedDaysAgo(newCheckout, 1);

  // A byte under: a checkout is enough, so no clone goes.
  expect(await cache.setCap((await cache.size()) - 1)).toEqual([]);

  expect(await cache.size()).toBeLessThanOrEqual(cache.cap);
  expect([existsSync(oldCheckout), existsSync(newCheckout)]).toEqual([false, true]);
  expect([existsSync(old), existsSync(fresh)]).toEqual([true, true]);
  // The clone forgot it.
  expect(git(old, 'worktree', 'list')).not.toContain(oldCheckout);
});

test('then the least recently used clones go, only until the cache is under', async () => {
  const cache = await cacheFor(server(['old', 'new', 'third']));
  const folders: string[] = [];
  for (const [name, days] of [
    ['old', 10],
    ['new', 5],
    ['third', 1],
  ] as const) {
    const repo = await cache.open('owner', name);
    await fetch(repo);
    repo.close();
    stampDaysAgo(repo.folder, days);
    folders.push(repo.folder);
  }

  // A byte under: the least recently used clone is enough.
  expect(await cache.setCap((await cache.size()) - 1)).toEqual(['owner/old']);

  expect(await cache.size()).toBeLessThanOrEqual(cache.cap);
  expect(folders.map((folder) => existsSync(folder))).toEqual([false, true, true]);
});

test('past its cap a clone open or being written to keeps everything, and the newest stays', async () => {
  const cache = await cacheFor(server(['old', 'new', 'third', 'fourth']));
  const names = ['old', 'new', 'third', 'fourth'] as const;
  const folders: string[] = [];
  for (const name of names) folders.push(await useRepo(cache, name));
  const checkouts = names.map((name) => checkoutOf(cache, name));
  // A fetch holds the least recently used clone, and the third is open.
  const release = await cache.cloneLock('owner', 'old').acquire('fetching pull request #1');
  const open = await cache.open('owner', 'third');
  for (const [index, days] of [10, 5, 3, 1].entries()) stampDaysAgo(folders[index] ?? '', days);
  const kept = () => folders.map((folder) => existsSync(folder));
  const checkedOut = () => checkouts.map((checkout) => existsSync(checkout));

  // Nothing fits, but only what's free goes, and never the clone used last.
  expect(await cache.setCap(0)).toEqual(['owner/new']);
  expect(kept()).toEqual([true, false, true, true]);
  expect(checkedOut()).toEqual([true, false, true, false]);

  release();
  expect(await cache.setCap(0)).toEqual(['owner/old']);
  open.close();
  expect(await cache.setCap(0)).toEqual(['owner/third']);
  expect(kept()).toEqual([false, false, false, true]);

  // The cache is never emptied, however often it's kept under.
  expect(await cache.cleanUp()).toMatchObject({ overCap: [] });
  expect(kept()).toEqual([false, false, false, true]);
});

test('a clone over the cap alone loses its checkouts, least recently used first, and stays', async () => {
  const made = repoServer();
  const remote = made.repo('owner', 'solo');
  remote.write('README.md', '# solo\n').commit('base');
  remote.publish('refs/heads/trunk');
  remote.switch('feature').write('a.txt', 'first\n').commit('r1');
  remote.publish('refs/pull/1/head');
  const cache = await cacheFor(made);
  const repo = await cache.open('owner', 'solo');
  const first = await repo.checkout(1, await fetch(repo));
  remote.write('a.txt', 'second\n').commit('r2');
  remote.publish('refs/pull/1/head');
  const second = await repo.checkout(1, await fetch(repo));
  repo.close();
  checkoutUsedDaysAgo(first, 3);
  checkoutUsedDaysAgo(second, 1);

  expect(await cache.setCap((await cache.size()) - 1)).toEqual([]);
  expect([existsSync(first), existsSync(second)]).toEqual([false, true]);

  // However often: at every launch, it stays.
  for (let launch = 0; launch < 2; launch++) {
    expect(await cache.setCap(1)).toEqual([]);
    expect([existsSync(second), existsSync(repo.folder)]).toEqual([false, true]);
  }
});

test('a fetch that makes a clone keeps the cache under its cap', async () => {
  const cache = await cacheFor(server(), { cap: 1 });
  const old = await useRepo(cache, 'old');
  stampDaysAgo(old, 1);

  // Making `new` grows the cache past its cap, so the clone least recently used goes, but never
  // the one just made, which is open.
  const repo = await cache.open('owner', 'new');
  await fetch(repo);

  expect(existsSync(old)).toBe(false);
  expect(existsSync(repo.folder)).toBe(true);
});

/** Twenty numbered lines, with `edits` in place of some. */
function lines(edits: Record<number, string>): string {
  return Array.from(
    { length: 20 },
    (_, index) => `${edits[index + 1] ?? `line ${index + 1}`}\n`,
  ).join('');
}

/** Whether the clone at `gitDir` has `oid`, which must not be downloaded. */
function hasObject(gitDir: string, oid: string): boolean {
  try {
    git(gitDir, '-c', 'remote.origin.url=file:///nowhere', 'cat-file', '-e', oid);
    return true;
  } catch {
    return false;
  }
}

test('cleanup collects the trees comparisons replayed', async () => {
  // Pull request #1 changes line 3 of a.txt, trunk then line 18, and r2 is r1 rebased with line 10
  // changed too: replaying r1 merges a.txt into a file that exists only in the clone.
  const made = repoServer();
  const remote = made.repo('owner', 'repo');
  const m1 = parseOid(remote.write('a.txt', lines({})).commit('m1'));
  remote.publish('refs/heads/trunk');
  remote
    .switch('feature')
    .write('a.txt', lines({ 3: "the PR's" }))
    .commit('r1');
  remote.publish('refs/pull/1/head');
  const cache = await cacheFor(made);
  const repo = await cache.open('owner', 'repo');
  const r1 = await fetch(repo);
  const m2 = parseOid(
    remote
      .switch('trunk')
      .write('a.txt', lines({ 18: "trunk's" }))
      .commit('m2'),
  );
  remote.publish('refs/heads/trunk');
  remote
    .switch('feature-2')
    .write('a.txt', lines({ 3: "the PR's", 10: 'rebased', 18: "trunk's" }))
    .commit('r2');
  remote.publish('refs/pull/1/head');
  const r2 = await fetch(repo);
  const comparison = await compared(repo, { base: m1, head: r1 }, { base: m2, head: r2 });
  const merged = git(repo.folder, 'rev-parse', `${comparison.old}:a.txt`);
  expect(remote.has(merged)).toBe(false);

  // While the clone is open, a comparison from it may be shown.
  await cache.removeUnused();
  expect(hasObject(repo.folder, merged)).toBe(true);
  expect(hasObject(repo.folder, comparison.old)).toBe(true);

  repo.close();
  await cache.removeUnused();

  expect(hasObject(repo.folder, merged)).toBe(false);
  expect(hasObject(repo.folder, comparison.old)).toBe(false);
  expect(git(repo.folder, 'for-each-ref', 'refs/lo/replays/')).toBe('');
  // What was fetched stays.
  expect(hasObject(repo.folder, r2)).toBe(true);
});

/** How `git repack` runs with git 2.`minor`. */
function repackWith(minor: number): string[] {
  return repackArguments({ major: 2, minor, patch: 0 });
}

test('repacks geometrically only where promisor packs survive it', () => {
  expect(repackWith(54)).toContain('--geometric=2');
  expect(repackWith(52)).toContain('--geometric=2');
  expect(repackWith(51)).toContain('-a');
  expect(repackWith(41)).toContain('-a');
});

/** Files pull request #1 adds. All but the last are downloaded, one download each. */
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'unread'].map((name) => `${name}.txt`);

/** Every pack of the clone at `gitDir`, and whether each has its `.promisor` marker. */
function packFiles(gitDir: string): { name: string; promisor: boolean }[] {
  const pack = join(gitDir, 'objects', 'pack');
  return readdirSync(pack)
    .filter((name) => name.endsWith('.pack'))
    .map((name) => ({
      name,
      promisor: existsSync(join(pack, name.replace(/\.pack$/u, '.promisor'))),
    }));
}

/** The loose refs under `refs/lo` of the clone at `gitDir`. */
function looseRefs(gitDir: string): string[] {
  const folder = join(gitDir, 'refs', 'lo');
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * A cache using `options.git`, noting to `options.log`, with `owner/repo`: a pack for its fetch and
 * one for each file downloaded on its own.
 */
async function manyPacks(options: { git?: Git; log?: (line: string) => void } = {}) {
  const made = repoServer();
  const remote = made.repo('owner', 'repo');
  remote.write('README.md', '# repo\n').commit('base');
  remote.publish('refs/heads/trunk');
  remote.switch('feature');
  for (const file of FILES) remote.write(file, `${file}\n`);
  remote.commit('files');
  remote.publish('refs/pull/1/head');
  const cache = await cacheFor(made, { git: options.git ?? (await foundGit()), log: options.log });
  const repo = await cache.open('owner', 'repo');
  const head = await fetch(repo);
  for (const file of FILES.slice(0, -1)) await repo.downloadFiles(head, [Buffer.from(file)]);
  repo.close();
  return { cache, remote, head, gitDir: repo.folder };
}

test('repacks a clone with too many packs', async () => {
  const found = await foundGit();
  // The git found, and one that says it's too old to repack geometrically.
  for (const program of [
    found,
    new Git(found.program, { major: 2, minor: 41, patch: 0 }, found.inherited),
  ]) {
    const { cache, remote, head, gitDir } = await manyPacks({ git: program });
    const before = packFiles(gitDir).length;
    expect(before).toBeGreaterThanOrEqual(FILES.length);
    expect(looseRefs(gitDir)).not.toEqual([]);

    // Without the server, so repacking needs no network.
    const moved = `${remote.gitDir}.moved`;
    renameSync(remote.gitDir, moved);
    expect(await cache.repack(FILES.length / 2)).toEqual(['owner/repo']);

    const after = packFiles(gitDir);
    expect(after.length).toBeLessThanOrEqual(2);
    // Every pack is still a promisor pack, so what isn't downloaded stays downloadable.
    expect(after.every((pack) => pack.promisor)).toBe(true);
    // The refs are packed.
    expect(looseRefs(gitDir)).toEqual([]);
    // What was downloaded reads without the server.
    const repo = await cache.open('owner', 'repo');
    for (const file of FILES.slice(0, -1)) {
      expect((await repo.readFile(head, Buffer.from(file)))?.toString()).toBe(`${file}\n`);
    }
    expect(await repo.pullRevisions(1)).toContain(head);
    // And what wasn't still downloads once the server is back.
    renameSync(moved, remote.gitDir);
    await repo.downloadFiles(head, [Buffer.from('unread.txt')]);
    expect((await repo.readFile(head, Buffer.from('unread.txt')))?.toString()).toBe('unread.txt\n');
    repo.close();
  }
});

test('leaves clones under the limit or being written to alone', async () => {
  const { cache, gitDir } = await manyPacks();
  const before = packFiles(gitDir).length;

  expect(await cache.repack(before)).toEqual([]);
  expect(packFiles(gitDir)).toHaveLength(before);

  // A fetch holds the clone's lock.
  const release = await cache.cloneLock('owner', 'repo').acquire('fetching pull request #1');
  expect(await cache.repack(1)).toEqual([]);
  expect(packFiles(gitDir)).toHaveLength(before);
  release();
});

/** The command lines of the processes on this machine that mention `text`. */
function processesMentioning(text: string): string[] {
  return execFileSync('ps', ['axww', '-o', 'command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes(text) && !line.includes('ps axww'));
}

/**
 * A git that runs `command`, such as `repack`, only once `go` exists, until then waiting in a shell
 * named `marker`, having made `started`. With `stubborn`, it makes a lock in the clone first and
 * ignores SIGTERM, as a git that only SIGKILL stops, which can't remove its own lock.
 */
async function slowGit(command: string, options: { stubborn?: boolean } = {}) {
  const dir = tempFolder();
  const [started, go] = [join(dir, 'started'), join(dir, 'go')];
  const marker = `lo-slow-${command.replaceAll(/\W+/gu, '-')}-${Date.now()}`;
  const wait = `while [ ! -e '${go}' ]; do sleep 0.05; done`;
  const program = wrappedGit(join(dir, 'git'), {
    before: [
      'for arg; do case $arg in --git-dir=*) gitdir=${arg#--git-dir=};; esac; done',
      `if [ ! -e '${go}' ]; then`,
      '  case " $* " in',
      `    *" ${command} "*)`,
      ...(options.stubborn ? ["      trap '' TERM", '      touch "$gitdir/packed-refs.lock"'] : []),
      `      touch '${started}'`,
      `      sh -c "${wait}" ${marker};;`,
      '  esac',
      'fi',
    ].join('\n'),
  });
  const found = await gitAt(program, { env: process.env, platform: process.platform });
  if (found.status !== 'found') throw new Error(found.message);
  return { git: found.git, started, go, marker };
}

test('an open behind a long repack gets the clone at once, and the repack runs again later', async () => {
  const slow = await slowGit('repack');
  const logged: string[] = [];
  const { cache, gitDir } = await manyPacks({ git: slow.git, log: (line) => logged.push(line) });
  const before = packFiles(gitDir).length;
  const repacking = cache.repack(1);
  await eventually(() => existsSync(slow.started));

  const began = Date.now();
  const repo = await cache.open('owner', 'repo');

  // In the second a git has to stop, not the half hour a repack may take.
  expect(Date.now() - began).toBeLessThan(STOP_GRACE + 1000);
  expect(await repacking).toEqual([]);
  expect(packFiles(gitDir)).toHaveLength(before);
  expect(logged).toContain(
    'stopped repacking owner/repo for opening its local copy, to do again at the next cleanup',
  );
  await eventually(() => processesMentioning(slow.marker).length === 0, 2000);
  repo.close();

  writeFileSync(slow.go, '');
  expect(await cache.repack(1)).toEqual(['owner/repo']);
  expect(packFiles(gitDir).length).toBeLessThan(before);
});

test('a pack-refs killed part way leaves no lock behind, so the next repack works', async () => {
  const slow = await slowGit('pack-refs', { stubborn: true });
  const { cache, gitDir } = await manyPacks({ git: slow.git });
  const repacking = cache.repack(1);
  await eventually(() => existsSync(slow.started));
  expect(existsSync(join(gitDir, 'packed-refs.lock'))).toBe(true);

  const began = Date.now();
  const repo = await cache.open('owner', 'repo');

  // Killed once the second it had to stop by itself was up.
  expect(Date.now() - began).toBeLessThan(STOP_GRACE + 1000);
  expect(await repacking).toEqual([]);
  expect(existsSync(join(gitDir, 'packed-refs.lock'))).toBe(false);
  repo.close();
  writeFileSync(slow.go, '');
  expect(await cache.repack(0)).toEqual(['owner/repo']);
  expect(looseRefs(gitDir)).toEqual([]);
});

test('a fetch behind a repack stops it, and only then removes the packs it was writing', async () => {
  const slow = await slowGit('repack');
  const { cache, head, gitDir } = await manyPacks({ git: slow.git });
  const repo = await cache.open('owner', 'repo');
  const repacking = cache.repack(1);
  await eventually(() => existsSync(slow.started));
  // As the repack writes its pack.
  const writing = join(gitDir, 'objects', 'pack', `.tmp-${process.pid}-pack-repacking.pack`);
  writeFileSync(writing, '');

  await repo.downloadFiles(head, [Buffer.from('unread.txt')]);

  expect(await repacking).toEqual([]);
  expect(processesMentioning(slow.marker)).toEqual([]);
  expect(existsSync(writing)).toBe(false);
  expect((await repo.readFile(head, Buffer.from('unread.txt')))?.toString()).toBe('unread.txt\n');
  repo.close();
});

test('an open waiting for a fetch stops once its signal aborts', async () => {
  const cache = await cacheFor(server());
  await useRepo(cache, 'old');
  const release = await cache.cloneLock('owner', 'old').acquire('fetching pull request #1');
  const activities: Activity[] = [];
  const controller = new AbortController();
  const reason = new Error('the tab was closed');
  const opening = cache.open('owner', 'old', {
    progress: (activity) => activities.push(activity),
    signal: controller.signal,
  });
  await eventually(() => activities.some((activity) => activity.kind === 'waitingForLock'));

  controller.abort(reason);

  await expect(opening).rejects.toBe(reason);
  // It left the queue: the next open gets the clone once the fetch is done.
  release();
  const repo = await cache.open('owner', 'old');
  expect(cache.cloneLock('owner', 'old').users).toBe(1);
  repo.close();
});

test('reading offline stops cleanup collecting replays, and waits for it', async () => {
  const slow = await slowGit('prune --expire=now');
  const logged: string[] = [];
  const cache = await cacheFor(server(), { git: slow.git, log: (line) => logged.push(line) });
  const folder = await useRepo(cache, 'old');
  // A loose object, as a replay writes.
  const loose = gitBytes(folder, ['hash-object', '-w', '--stdin'], 'replayed\n').toString().trim();
  const cleaning = cache.removeUnused();
  await eventually(() => existsSync(slow.started));

  const began = Date.now();
  const repo = await cache.openOffline('owner', 'old');

  expect(repo).toBeDefined();
  expect(Date.now() - began).toBeLessThan(STOP_GRACE + 1000);
  await cleaning;
  expect(logged).toContain(
    "stopped removing owner/old's replayed trees for reading its local copy, to do again at the " +
      'next cleanup',
  );
  expect(hasObject(folder, loose)).toBe(true);
  // While it's open, cleanup leaves the clone alone.
  writeFileSync(slow.go, '');
  await cache.removeUnused();
  expect(hasObject(folder, loose)).toBe(true);
  repo?.close();
  await cache.removeUnused();
  expect(hasObject(folder, loose)).toBe(false);
});
