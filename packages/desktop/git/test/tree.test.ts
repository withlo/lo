// Listing a commit's files, and downloading them in batches.

import { execFileSync } from 'node:child_process';

import {
  blobId,
  git,
  missingObjects,
  objectSizes,
  packedObjects,
  packs,
  type RemoteRepo,
  type RepoServer,
} from '@lo/testing/git';
import { expect, test } from 'vitest';

import type { Cache } from '../src/cache.ts';
import { EMPTY_TREE } from '../src/environment.ts';
import { GitError } from '../src/errors.ts';
import { type Oid, parseOid } from '../src/oid.ts';
import type { Activity } from '../src/progress.ts';
import type { Repo } from '../src/repo.ts';
import { displayPath, type TreeEntry } from '../src/tree.ts';
import { cacheFor, eventually, repoServer, type TracedGit, tracedGit } from './support.ts';

/** A pull request whose head adds files to a base with a README, fetched into a clone whose git is traced. */
interface Fixture {
  head: Oid;
  remote: RemoteRepo;
  server: RepoServer;
  git: TracedGit;
  cache: Cache;
  repo: Repo;
}

/** Builds the pull request's head with `build`, which writes files into the working copy and commits. */
async function fixture(build: (remote: RemoteRepo) => string): Promise<Fixture> {
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  remote.write('README', 'readme\n').commit('base');
  remote.publish('refs/heads/trunk');
  remote.switch('feature');
  const head = parseOid(build(remote));
  remote.publish('refs/pull/1/head');
  const traced = await tracedGit();
  const cache = await cacheFor(server, { git: traced.git });
  const repo = await cache.open('owner', 'repo');
  await repo.fetchPull({ number: 1, head, baseBranch: 'trunk' });
  return { head, remote, server, git: traced, cache, repo };
}

/** A pull request of `count` files with long paths, each a different size. */
function manyFiles(count: number): Promise<Fixture> {
  return fixture((remote) => {
    for (let i = 0; i < count; i++) {
      const path =
        `packages/${'component'.repeat(4)}-${String(i % 50).padStart(2, '0')}/source/` +
        `${'directory'.repeat(4)}/file-${String(i).padStart(5, '0')}.txt`;
      remote.write(path, `file ${i}\n${'x'.repeat(i % 97)}\n`);
    }
    return remote.commit('head');
  });
}

/** The paths of `entries` that are files, as `downloadFiles` takes them. */
function filePaths(entries: readonly TreeEntry[]): Buffer[] {
  return entries.filter((entry) => entry.mode !== 'submodule').map((entry) => entry.path);
}

function shown(paths: readonly Uint8Array[]): string[] {
  return paths.map(displayPath);
}

async function offline(f: Fixture): Promise<Repo> {
  const repo = await f.cache.openOffline('owner', 'repo');
  if (repo === undefined) throw new Error('no clone to read offline');
  return repo;
}

test('lists every file with its mode blob and size', async () => {
  const f = await fixture((remote) => {
    remote
      .write('src/lib.rs', 'pub fn a() {}\n')
      .write('src/deep/er/mod.rs', 'mod x;\n')
      .write('bin/run', '#!/bin/sh\n')
      .executable('bin/run')
      .write('empty', '')
      .write('with space.txt', 'spaced\n')
      .symlink('link', 'src/lib.rs')
      .gitlink('vendor/lib', '1'.repeat(40));
    return remote.commitWithNames(
      [
        [Buffer.from('caf\xe9.txt', 'latin1'), 'latin-1\n'],
        [Buffer.from('tab\tand\nline.txt'), 'odd\n'],
      ],
      'head',
    );
  });

  const tree = await f.repo.tree(f.head);

  // git's order, which is by path, in bytes.
  expect(tree.map((entry) => entry.path)).toEqual(
    tree.map((entry) => entry.path).toSorted((a, b) => Buffer.compare(a, b)),
  );
  expect(tree.map((entry) => [entry.path.toString('latin1'), entry.mode])).toEqual([
    ['README', 'regular'],
    ['bin/run', 'executable'],
    ['caf\xe9.txt', 'regular'],
    ['empty', 'regular'],
    ['link', 'symlink'],
    ['src/deep/er/mod.rs', 'regular'],
    ['src/lib.rs', 'regular'],
    ['tab\tand\nline.txt', 'regular'],
    ['vendor/lib', 'submodule'],
    ['with space.txt', 'regular'],
  ]);
  // Paths that git quotes are out of `rev-parse`'s reach; it names the others.
  const named = tree.filter((entry) => /^[\x20-\x7e]+$/.test(entry.path.toString('latin1')));
  expect(named.map((entry) => entry.oid)).toEqual(
    named.map((entry) => blobId(f.remote.work, f.head, entry.path.toString('utf8'))),
  );
  const submodule = tree.find((entry) => entry.path.toString('utf8') === 'vendor/lib');
  expect(submodule?.oid).toBe('1'.repeat(40));
  expect(submodule?.size).toBeUndefined();

  // The files are still on the server, so the clone doesn't know their sizes yet.
  expect(tree.filter((entry) => entry.size !== undefined)).toEqual([]);
  expect(await f.repo.downloadFiles(f.head, filePaths(tree))).toEqual([]);

  const listed = await f.repo.tree(f.head);
  const sizes = objectSizes(f.remote.work);
  for (const entry of listed.filter((each) => each.mode !== 'submodule')) {
    expect.soft(entry.size).toBe(sizes.get(entry.oid));
  }
  const size = (path: string) => listed.find((entry) => entry.path.toString('utf8') === path)?.size;
  expect(size('src/lib.rs')).toBe(14);
  expect(size('empty')).toBe(0);
  expect(size('vendor/lib')).toBeUndefined();
});

test('listing downloads nothing and works offline', async () => {
  const f = await fixture((remote) => {
    for (let i = 0; i < 40; i++) remote.write(`dir/f${i}.txt`, `file ${i}\n`);
    return remote.commit('head');
  });
  const before = { packs: packs(f.repo.folder), fetches: f.git.count('fetch') };
  const missing = missingObjects(f.repo.folder, f.head);
  // The 40 files and the README are all to download.
  expect(missing).toHaveLength(41);

  const tree = await f.repo.tree(f.head);

  expect(tree).toHaveLength(41);
  expect(packs(f.repo.folder)).toBe(before.packs);
  expect(missingObjects(f.repo.folder, f.head)).toEqual(missing);
  expect(f.git.count('fetch')).toBe(before.fetches);
  // The same, from a clone opened to read offline, with the server gone.
  const reader = await offline(f);
  f.server.remove();
  expect(await reader.tree(f.head)).toEqual(tree);
  expect(packs(f.repo.folder)).toBe(before.packs);
});

test('a commits tree is named without downloading and a tree names itself', async () => {
  const f = await fixture((remote) => remote.write('src/lib.rs', 'pub fn a() {}\n').commit('head'));
  const before = { packs: packs(f.repo.folder), fetches: f.git.count('fetch') };
  const tree = git(f.remote.work, 'rev-parse', `${f.head}^{tree}`);

  expect(await f.repo.treeId(f.head)).toBe(tree);
  expect(await f.repo.treeId(parseOid(tree))).toBe(tree);
  // The same, from a clone opened to read offline, with the server gone.
  const reader = await offline(f);
  f.server.remove();
  expect(await reader.treeId(f.head)).toBe(tree);
  expect(f.git.count('fetch')).toBe(before.fetches);
  expect(packs(f.repo.folder)).toBe(before.packs);
});

test('what the clone lacks is said without downloading', async () => {
  const f = await fixture((remote) => {
    for (let i = 0; i < 4; i++) remote.write(`src/f${i}.rs`, `pub fn f${i}() {}\n`);
    return remote.commit('head');
  });
  const all = [0, 1, 2, 3].map((i) => Buffer.from(`src/f${i}.rs`));
  expect(
    await f.repo.downloadFiles(
      f.head,
      all.filter((_, i) => i % 2 === 1),
    ),
  ).toEqual([]);
  const before = { packs: packs(f.repo.folder), fetches: f.git.count('fetch') };

  // In the order asked, each once.
  const lacking = await f.repo.lackingFiles(f.head, [...all, ...all.slice(0, 1)]);
  expect(shown(lacking)).toEqual(['src/f0.rs', 'src/f2.rs']);
  const reader = await offline(f);
  f.server.remove();
  expect(await reader.lackingFiles(f.head, all)).toEqual(lacking);
  await expect(f.repo.lackingFiles(f.head, [Buffer.from('src/nothing.rs')])).rejects.toThrow(
    GitError,
  );
  expect(f.git.count('fetch')).toBe(before.fetches);
  expect(packs(f.repo.folder)).toBe(before.packs);
});

test('five thousand files download in one fetch', async () => {
  const f = await manyFiles(4999);
  const tree = await f.repo.tree(f.head);
  const paths = filePaths(tree);
  expect(paths).toHaveLength(5000);
  const total = paths.reduce((sum, path) => sum + path.length, 0);
  // More than a command line takes.
  expect(total).toBeGreaterThan(500_000);
  const before = {
    packs: packs(f.repo.folder),
    fetches: f.git.count('fetch'),
    listings: f.git.count('ls-tree'),
  };
  expect(missingObjects(f.repo.folder, f.head)).toHaveLength(5000);

  expect(await f.repo.downloadFiles(f.head, paths)).toEqual([]);

  expect(missingObjects(f.repo.folder, f.head)).toEqual([]);
  // Their IDs go to the fetch on its stdin, so one fetch brings the lot, as one pack.
  expect(f.git.count('fetch') - before.fetches).toBe(1);
  expect(packs(f.repo.folder) - before.packs).toBe(1);
  // The paths are looked up in the trees, never on a command line.
  expect(f.git.count('ls-tree') - before.listings).toBe(0);
  // Reading them needs no more.
  for (const entry of tree.filter((_, index) => index % 250 === 0)) {
    expect.soft(await f.repo.readBlob(entry.oid)).toBeDefined();
  }
  expect(f.git.count('fetch') - before.fetches).toBe(1);
  // Every size is the object's own.
  const sizes = objectSizes(f.remote.work);
  const listed = await f.repo.tree(f.head);
  expect(listed).toHaveLength(5000);
  expect(listed.filter((entry) => entry.size !== sizes.get(entry.oid))).toEqual([]);
});

test('past ten thousand files a download takes another fetch', async () => {
  const f = await fixture((remote) => {
    for (let i = 0; i < 10_001; i++)
      remote.write(`d${String(i % 100).padStart(3, '0')}/f${i}.txt`, `${i}\n`);
    return remote.commit('head');
  });
  const paths = filePaths(await f.repo.tree(f.head));
  expect(paths).toHaveLength(10_002);
  const before = { packs: packs(f.repo.folder), fetches: f.git.count('fetch') };

  expect(await f.repo.downloadFiles(f.head, paths)).toEqual([]);

  // 5,000 files a fetch: two of them, and one more for the last two files.
  expect(missingObjects(f.repo.folder, f.head)).toEqual([]);
  expect(f.git.count('fetch') - before.fetches).toBe(3);
  expect(packs(f.repo.folder) - before.packs).toBe(3);
});

test('files the clone has are not downloaded again or waited for', async () => {
  const f = await manyFiles(60);
  const paths = filePaths(await f.repo.tree(f.head));
  const [first, rest] = [paths.slice(0, 25), paths.slice(25)];
  expect(await f.repo.downloadFiles(f.head, first)).toEqual([]);
  const before = { packs: packs(f.repo.folder), fetches: f.git.count('fetch') };
  expect(missingObjects(f.repo.folder, f.head)).toHaveLength(rest.length);

  // Asking for what it has fetches nothing and needs no lock: it doesn't wait for a fetch.
  const release = await f.cache.cloneLock('owner', 'repo').acquire('fetching pull request #1');
  const done = await Promise.race([
    f.repo.downloadFiles(f.head, first),
    new Promise((resolve) => setTimeout(() => resolve('still waiting'), 20_000)),
  ]);
  release();
  expect(done).toEqual([]);
  expect(f.git.count('fetch')).toBe(before.fetches);
  expect(packs(f.repo.folder)).toBe(before.packs);

  // Asking for all of them brings the rest, in one fetch.
  expect(await f.repo.downloadFiles(f.head, paths)).toEqual([]);
  expect(f.git.count('fetch')).toBe(before.fetches + 1);
  expect(packs(f.repo.folder)).toBe(before.packs + 1);
  expect(missingObjects(f.repo.folder, f.head)).toEqual([]);
});

test('a download waits for the clone and fetches nothing another downloaded meanwhile', async () => {
  const f = await manyFiles(40);
  const paths = filePaths(await f.repo.tree(f.head));
  const fetches = f.git.count('fetch');
  const activities: Activity[] = [];
  const repo = await f.cache.open('owner', 'repo', {
    progress: (activity) => activities.push(activity),
  });

  // Another fetch holds the clone.
  const release = await f.cache.cloneLock('owner', 'repo').acquire('fetching pull request #1');
  let finished = false;
  const download = repo.downloadFiles(f.head, paths).finally(() => {
    finished = true;
  });
  await eventually(() => activities.some((activity) => activity.kind === 'waitingForLock'));
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(finished).toBe(false);
  expect(f.git.count('fetch')).toBe(fetches);

  // That fetch brings the files, and lets go.
  git(f.repo.folder, 'diff', '--numstat', EMPTY_TREE, f.head);
  expect(missingObjects(f.repo.folder, f.head)).toEqual([]);
  const before = { packs: packs(f.repo.folder), objects: packedObjects(f.repo.folder) };
  release();

  // Finding them there, the download fetches nothing.
  expect(await download).toEqual([]);
  expect(f.git.count('fetch')).toBe(fetches);
  expect(packs(f.repo.folder)).toBe(before.packs);
  expect(packedObjects(f.repo.folder)).toBe(before.objects);
});

test('downloads at once fetch each file once', async () => {
  const f = await manyFiles(2000);
  const paths = filePaths(await f.repo.tree(f.head));
  expect(paths).toHaveLength(2001);
  const before = { objects: packedObjects(f.repo.folder), fetches: f.git.count('fetch') };

  // Two views of one tree that share a good part of it: 1,400 files each, 800 of them the same.
  const done = await Promise.all([
    f.repo.downloadFiles(f.head, paths.slice(0, 1400)),
    f.repo.downloadFiles(f.head, paths.slice(600, 2000)),
  ]);

  expect(done).toEqual([[], []]);
  // The second to hold the clone fetched what the first hadn't, and every file came once.
  expect(f.git.count('fetch') - before.fetches).toBeLessThanOrEqual(2);
  expect(packedObjects(f.repo.folder) - before.objects).toBe(2000);
  expect(missingObjects(f.repo.folder, f.head)).toHaveLength(1);
});

test('offline nothing downloads and whats missing is reported', async () => {
  const f = await manyFiles(30);
  const paths = filePaths(await f.repo.tree(f.head));
  const [first, rest] = [paths.slice(0, 10), paths.slice(10)];
  await f.repo.downloadFiles(f.head, first);
  const before = { packs: packs(f.repo.folder), fetches: f.git.count('fetch') };
  const missing = missingObjects(f.repo.folder, f.head);
  expect(missing).toHaveLength(rest.length);

  // The server is still there, so a read that could download would.
  const reader = await offline(f);
  const reported = await reader.downloadFiles(f.head, paths);

  expect(packs(f.repo.folder)).toBe(before.packs);
  expect(f.git.count('fetch')).toBe(before.fetches);
  expect(missingObjects(f.repo.folder, f.head)).toEqual(missing);
  expect(reported).toEqual(rest);
  // What it has, it reports as there, and a path asked twice once.
  expect(await reader.downloadFiles(f.head, first)).toEqual([]);
  const [one, two] = rest;
  if (one === undefined || two === undefined) throw new Error('too few files');
  expect(await reader.downloadFiles(f.head, [one, two, one])).toEqual([one, two]);

  // Once the files are downloaded online, offline has them all.
  await f.repo.downloadFiles(f.head, paths);
  expect(await reader.downloadFiles(f.head, paths)).toEqual([]);
});

test('offline with the server gone fails cleanly', async () => {
  const f = await manyFiles(20);
  const paths = filePaths(await f.repo.tree(f.head));
  const reader = await offline(f);
  f.server.remove();

  // Opened to read offline: it reports what it lacks.
  expect(await reader.downloadFiles(f.head, paths)).toHaveLength(paths.length);

  // Opened to download, with nothing to download from: an error, not a hang.
  const error: unknown = await f.repo
    .downloadFiles(f.head, paths)
    .catch((caught: unknown) => caught);
  expect(error instanceof GitError && error.detail.kind).toBe('fetch');
});

test('a commit the clone lacks is never downloaded by listing or downloading', async () => {
  const f = await manyFiles(5);
  // A commit on the server that the clone never fetched.
  const other = parseOid(f.remote.switch('other').write('other.txt', 'other\n').commit('other'));
  f.remote.publish('refs/heads/other');
  const before = { packs: packs(f.repo.folder), fetches: f.git.count('fetch') };
  const path = [Buffer.from('other.txt')];

  const notFetched = { kind: 'notFetched', oid: other };
  for (const read of [
    f.repo.tree(other),
    f.repo.treeId(other),
    f.repo.downloadFiles(other, path),
    f.repo.downloadAttributes(other, path),
    f.repo.attribute(other, 'linguist-generated', path),
  ]) {
    const error: unknown = await read.catch((caught: unknown) => caught);
    expect.soft(error instanceof GitError && error.detail).toEqual(notFetched);
  }

  expect(f.git.count('fetch')).toBe(before.fetches);
  expect(packs(f.repo.folder)).toBe(before.packs);
});

test('paths that arent files are refused and submodules skipped', async () => {
  const f = await fixture((remote) =>
    remote
      .write('src/lib.rs', 'pub fn a() {}\n')
      .gitlink('vendor/lib', '1'.repeat(40))
      .commit('head'),
  );
  const before = packs(f.repo.folder);
  const lib = Buffer.from('src/lib.rs');

  // Nothing at the path, a folder, an empty path, and one git would misread.
  for (const path of ['nothing.txt', 'src', '', 'a\0b']) {
    const error: unknown = await f.repo
      .downloadFiles(f.head, [lib, Buffer.from(path)])
      .catch((caught: unknown) => caught);
    expect
      .soft(error instanceof GitError && error.detail.kind, JSON.stringify(path))
      .toBe('invalid');
  }
  // Nothing downloaded for a bad list.
  expect(packs(f.repo.folder)).toBe(before);

  // A submodule is another repository's: nothing to download. A path asked twice downloads once.
  const submodule = Buffer.from('vendor/lib');
  expect(await f.repo.downloadFiles(f.head, [submodule, lib, lib])).toEqual([]);
  expect(packs(f.repo.folder)).toBe(before + 1);
  // Only the README is left.
  expect(missingObjects(f.repo.folder, f.head)).toHaveLength(1);

  // No paths, or only a submodule's, start no git: the clone's reader already looked them up.
  const commands = f.git.commands().length;
  expect(await f.repo.downloadFiles(f.head, [])).toEqual([]);
  expect(await f.repo.downloadFiles(f.head, [submodule])).toEqual([]);
  expect(f.git.commands().slice(commands)).toEqual([]);
});

test('a trees attributes are answered by one check attr', async () => {
  const f = await fixture((remote) => {
    remote.write('.gitattributes', '*.gen.txt linguist-generated\n');
    remote.write('a/.gitattributes', '*.txt linguist-generated=false\n');
    for (let i = 0; i < 3000; i++) {
      const name = i % 10 === 0 ? 'gen' : 'plain';
      remote.write(
        `packages/${'component'.repeat(4)}-${String(i % 50).padStart(2, '0')}/` +
          `${'directory'.repeat(3)}/file-${String(i).padStart(5, '0')}.${name}.txt`,
        `${i}\n`,
      );
    }
    return remote.write('a/x.gen.txt', 'x\n').commit('head');
  });
  const paths = (await f.repo.tree(f.head)).map((entry) => entry.path);
  expect(paths).toHaveLength(3004);
  expect(await f.repo.downloadAttributes(f.head, paths)).toEqual([]);

  const attributes = await f.repo.attribute(f.head, 'linguist-generated', paths);

  expect(attributes).toHaveLength(paths.length);
  expect(f.git.count('check-attr')).toBe(1);
  const expected = paths.map((path) => {
    const name = displayPath(path);
    if (name === 'a/x.gen.txt') return { value: 'false' };
    return name.endsWith('.gen.txt') ? 'set' : 'unspecified';
  });
  expect(attributes).toEqual(expected);
});

test('a listing longer than its reader takes is refused', async () => {
  const f = await manyFiles(5);
  const error: unknown = await f.repo
    .tree(f.head, { maxEntries: 5 })
    .catch((caught: unknown) => caught);
  expect(error instanceof GitError && error.detail).toMatchObject({
    kind: 'tooLarge',
    limit: 5,
    unit: 'entries',
  });
  expect(await f.repo.tree(f.head, { maxEntries: 6 })).toHaveLength(6);
});

/** The `cat-file --batch-command` processes reading the clone at `folder`. */
function readers(folder: string): string[] {
  return execFileSync('ps', ['axww', '-o', 'command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes('cat-file --batch-command') && line.includes(folder));
}

test('a clone open twice shares one reader', async () => {
  const f = await manyFiles(2);
  const second = await f.cache.open('owner', 'repo');
  const third = await f.cache.openOffline('owner', 'repo');
  if (third === undefined) throw new Error('no clone to read offline');

  for (const repo of [f.repo, second, third]) expect(await repo.treeId(f.head)).toBeDefined();

  expect(readers(f.repo.folder)).toHaveLength(1);
  // It runs while any of them is open.
  f.repo.close();
  third.close();
  expect(await second.treeId(f.head)).toBeDefined();
  expect(readers(f.repo.folder)).toHaveLength(1);
  second.close();
  await eventually(() => readers(f.repo.folder).length === 0);
});
