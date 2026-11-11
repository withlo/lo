// Checkouts of pull requests' heads.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { git, gitBytes, type RemoteRepo, type RepoServer } from '@lo/testing/git';
import { expect, test } from 'vitest';

import type { Cache } from '../src/cache.ts';
import { changedPath } from '../src/diff.ts';
import { GitError } from '../src/errors.ts';
import { type Oid, parseOid } from '../src/oid.ts';
import type { Repo } from '../src/repo.ts';
import { cacheFor, repoServer, script, tempFolder } from './support.ts';

/** Pull request #1, with a second revision `r2` that changes, adds and removes files. */
interface Fixture {
  server: RepoServer;
  remote: RemoteRepo;
  r1: Oid;
  r2: Oid;
  cache: Cache;
  repo: Repo;
}

async function fixture(): Promise<Fixture> {
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  remote.write('README.md', '# repo\n').write('src/lib.rs', 'pub fn a() {}\n').commit('base');
  remote.publish('refs/heads/trunk');
  const r1 = parseOid(
    remote
      .switch('feature')
      .write('src/lib.rs', 'pub fn a() { 1 }\n')
      .write('removed_later.txt', 'here in r1\n')
      .gitlink('vendor/lib', '1'.repeat(40))
      .commit('r1'),
  );
  remote.publish('refs/pull/1/head');
  const r2 = parseOid(
    remote
      .write('src/lib.rs', 'pub fn a() { 2 }\n')
      .write('added_later.txt', 'new in r2\n')
      .remove('removed_later.txt')
      .commit('r2'),
  );
  const cache = await cacheFor(server);
  const repo = await cache.open('owner', 'repo');
  await fetch(repo);
  return { server, remote, r1, r2, cache, repo };
}

async function fetch(repo: Repo): Promise<Oid> {
  return (await repo.fetchPull({ number: 1, baseBranch: 'trunk' })).head;
}

/** Pushes r2 as pull request #1's new head and fetches it. */
async function pushR2(f: Fixture): Promise<void> {
  f.remote.publish('refs/pull/1/head');
  expect(await fetch(f.repo)).toBe(f.r2);
}

/** Every link under `folder`, which must have none. */
function links(folder: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) found.push(path);
    else if (entry.isDirectory()) found.push(...links(path));
  }
  return found;
}

const read = (path: string) => readFileSync(path, 'utf8');

test('checks out a pull request detached', async () => {
  const f = await fixture();

  const dir = await f.repo.checkout(1, f.r1);

  expect(dir).toBe(join(f.cache.root, `checkouts/github.com/owner/repo/pull-1/${f.r1}`));
  expect(git(dir, 'rev-parse', 'HEAD')).toBe(f.r1);
  expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');
  expect(git(dir, 'status', '--porcelain')).toBe('');
  expect(read(join(dir, 'src/lib.rs'))).toBe('pub fn a() { 1 }\n');
  // The submodule is an empty folder; its commit isn't fetched.
  expect(readdirSync(join(dir, 'vendor/lib'))).toEqual([]);
  // The checkout belongs to the clone.
  expect(read(join(dir, '.git'))).toContain(join(f.repo.folder, 'worktrees'));
});

test('each head gets a checkout of its own', async () => {
  const f = await fixture();
  const r1 = await f.repo.checkout(1, f.r1);

  await pushR2(f);
  const r2 = await f.repo.checkout(1, f.r2);

  // A window still showing r1 keeps its checkout as it was.
  expect(r1).not.toBe(r2);
  expect(git(r1, 'rev-parse', 'HEAD')).toBe(f.r1);
  expect(read(join(r1, 'src/lib.rs'))).toBe('pub fn a() { 1 }\n');
  expect(existsSync(join(r1, 'removed_later.txt'))).toBe(true);
  expect(git(r2, 'rev-parse', 'HEAD')).toBe(f.r2);
  expect(read(join(r2, 'src/lib.rs'))).toBe('pub fn a() { 2 }\n');
  expect(existsSync(join(r2, 'added_later.txt'))).toBe(true);
  expect(existsSync(join(r2, 'removed_later.txt'))).toBe(false);
});

test('checking a head out again keeps only what git put there', async () => {
  const f = await fixture();
  const dir = await f.repo.checkout(1, f.r1);
  // A language server leaves things behind, and a file gets changed.
  writeFileSync(join(dir, 'untracked.txt'), 'left behind\n');
  mkdirSync(join(dir, 'target/debug'), { recursive: true });
  writeFileSync(join(dir, 'target/debug/x'), 'build output\n');
  writeFileSync(join(dir, 'README.md'), 'changed on disk\n');

  const again = await f.repo.checkout(1, f.r1);

  expect(again).toBe(dir);
  expect(existsSync(join(dir, 'untracked.txt'))).toBe(false);
  expect(existsSync(join(dir, 'target'))).toBe(false);
  expect(read(join(dir, 'README.md'))).toBe('# repo\n');
  expect(git(dir, 'status', '--porcelain', '--ignored')).toBe('');
});

test('nothing in a checkout points outside it', async () => {
  const f = await fixture();
  f.remote
    .switch('feature')
    .symlink('escape', '../../../../../../etc')
    .symlink('absolute', '/etc/passwd')
    .symlink('nested/up', '..');
  const withLinks = parseOid(f.remote.commit('symlinks'));
  f.remote.publish('refs/pull/1/head');
  expect(await fetch(f.repo)).toBe(withLinks);

  const dir = await f.repo.checkout(1, withLinks);

  expect(links(dir)).toEqual([]);
  // Each is a plain file holding its target.
  expect(read(join(dir, 'escape'))).toBe('../../../../../../etc');
  expect(read(join(dir, 'absolute'))).toBe('/etc/passwd');
  expect(read(join(dir, 'nested/up'))).toBe('..');
});

test('a checkout left without its clone is rebuilt', async () => {
  const f = await fixture();
  const dir = await f.repo.checkout(1, f.r1);
  f.repo.close();
  rmSync(f.repo.folder, { recursive: true, force: true });

  const repo = await f.cache.open('owner', 'repo');
  const head = await fetch(repo);
  const rebuilt = await repo.checkout(1, head);

  expect(rebuilt).toBe(dir);
  expect(git(dir, 'rev-parse', 'HEAD')).toBe(f.r1);
  expect(git(dir, 'status', '--porcelain')).toBe('');
});

test('checkouts at once all succeed', async () => {
  const f = await fixture();
  await pushR2(f);

  // Windows on one pull request, some still on r1, check it out at once.
  const heads = Array.from({ length: 8 }, (_, index) => (index % 2 === 0 ? f.r1 : f.r2));
  const dirs = await Promise.all(
    heads.map(async (head) => (await f.cache.open('owner', 'repo')).checkout(1, head)),
  );

  for (const [index, dir] of dirs.entries()) {
    expect.soft(git(dir, 'rev-parse', 'HEAD')).toBe(heads[index]);
    expect.soft(git(dir, 'status', '--porcelain')).toBe('');
  }
  // The clone, and a checkout for each head.
  expect(git(f.repo.folder, 'worktree', 'list').split('\n')).toHaveLength(3);
});

test('hashes a checkouts files as git would', async () => {
  const f = await fixture();
  const dir = await f.repo.checkout(1, f.r1);
  const blob = (path: string) => git(f.remote.work, 'rev-parse', `${f.r1}:${path}`);
  const hash = (path: string, folder = dir) => f.repo.hashCheckoutFile(folder, Buffer.from(path));

  for (const path of ['README.md', 'src/lib.rs', 'removed_later.txt']) {
    expect.soft(await hash(path)).toBe(blob(path));
  }
  // Not regular files: missing, a folder, a submodule's empty folder.
  for (const path of ['missing.txt', 'src', 'vendor/lib'])
    expect.soft(await hash(path)).toBeUndefined();
  // A file changed on disk no longer hashes to its blob.
  writeFileSync(join(dir, 'README.md'), 'changed on disk\n');
  expect(await hash('README.md')).not.toBe(blob('README.md'));
  // Nothing outside the checkout.
  for (const path of ['../repo.git/HEAD', '/etc/passwd', '']) {
    await expect.soft(hash(path)).rejects.toThrow(GitError);
  }
  // Nor in a folder that isn't one of the clone's checkouts, such as another repository.
  await expect(hash('README.md', f.remote.work)).rejects.toThrow("isn't a valid checkout");
});

/** A program that leaves a marker named `name` in `markers` when it runs. */
function markerProgram(markers: string, name: string): string {
  mkdirSync(markers, { recursive: true });
  return script(join(markers, '..', `${name}-program`), `touch '${join(markers, name)}'`);
}

test('hostile config in the clone has no effect', async () => {
  const f = await fixture();
  const scratch = tempFolder();
  const markers = join(scratch, 'markers');
  // What anything able to write the clone's config could set: hooks, a file system monitor, and
  // attributes for every file.
  const hooks = join(scratch, 'hooks');
  const ownHooks = join(f.repo.folder, 'hooks');
  for (const [folder, prefix] of [
    [hooks, ''],
    [ownHooks, 'own-'],
  ] as const) {
    mkdirSync(folder, { recursive: true });
    for (const hook of ['post-checkout', 'reference-transaction']) {
      writeFileSync(join(folder, hook), read(markerProgram(markers, `${prefix}${hook}`)), {
        mode: 0o755,
      });
    }
  }
  const attributes = join(scratch, 'attributes');
  writeFileSync(attributes, '* ident eol=crlf\n');
  for (const [key, value] of [
    ['core.hooksPath', hooks],
    ['core.fsmonitor', markerProgram(markers, 'fsmonitor')],
    ['core.attributesFile', attributes],
  ] as const) {
    git(f.repo.folder, 'config', key, value);
  }

  // A checkout made, another for a new head, and their files hashed.
  const dir = await f.repo.checkout(1, f.r1);
  await pushR2(f);
  const r2 = await f.repo.checkout(1, f.r2);
  await f.repo.checkout(1, f.r1);
  for (const folder of [dir, r2]) await f.repo.hashCheckoutFile(folder, Buffer.from('src/lib.rs'));

  expect(readdirSync(markers)).toEqual([]);
  expect(read(join(r2, 'src/lib.rs'))).toBe('pub fn a() { 2 }\n');
});

test('a pull requests own attributes never apply in its checkout', async () => {
  const f = await fixture();
  // Attributes that would change the checkout's bytes: keyword expansion, line endings and a
  // re-encoding. git applies the last when committing, so the blob is UTF-8.
  f.remote
    .switch('feature')
    .write('.gitattributes', '*.txt ident eol=crlf\n*.enc working-tree-encoding=UTF-16LE\n')
    .write('id.txt', '$Id$\nline\n')
    .write('x.enc', Buffer.from('h\0i\0\n\0', 'latin1'));
  const head = parseOid(f.remote.commit('attributes'));
  f.remote.publish('refs/pull/1/head');
  expect(await fetch(f.repo)).toBe(head);

  const dir = await f.repo.checkout(1, head);

  for (const path of ['id.txt', 'x.enc', '.gitattributes']) {
    const blob = await f.repo.readFile(head, Buffer.from(path));
    expect.soft(readFileSync(join(dir, path))).toEqual(blob);
    const id = git(f.remote.work, 'rev-parse', `${head}:${path}`);
    expect.soft(await f.repo.hashCheckoutFile(dir, Buffer.from(path))).toBe(id);
  }
});

/** Whether the disk under `folder` takes `a` and `b` for one name. */
function sameNameOnDisk(folder: string, a: string, b: string): boolean {
  const probe = join(folder, `probe-${process.pid}`);
  mkdirSync(probe);
  try {
    writeFileSync(join(probe, a), '');
    return existsSync(join(probe, b));
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

test('names a disk folds together never both hash to their blobs', async () => {
  const f = await fixture();
  f.remote.switch('feature');
  const [nfc, nfd] = ['café.txt', 'café.txt'];
  const head = parseOid(
    f.remote.commitWithNames(
      [
        [Buffer.from('Lib.rs'), 'pub fn evil() {}\n'],
        [Buffer.from('lib.rs'), 'pub fn benign() {}\n'],
        [Buffer.from(nfc), 'composed\n'],
        [Buffer.from(nfd), 'decomposed\n'],
      ],
      'names that differ only in case or normalization',
    ),
  );
  f.remote.publish('refs/pull/1/head');
  expect(await fetch(f.repo)).toBe(head);
  const base = parseOid(git(f.repo.folder, 'rev-parse', 'refs/lo/pull/1/base'));
  await f.repo.download(await f.repo.changedObjects(base, head));
  // Each name reads as its own file from git.
  for (const [path, contents] of [
    ['Lib.rs', 'pub fn evil() {}\n'],
    ['lib.rs', 'pub fn benign() {}\n'],
    [nfc, 'composed\n'],
    [nfd, 'decomposed\n'],
  ] as const) {
    expect.soft((await f.repo.readFile(head, Buffer.from(path)))?.toString('utf8')).toBe(contents);
  }
  const files = await f.repo.changedFiles(base, head);

  const dir = await f.repo.checkout(1, head);

  for (const [a, b] of [
    ['Lib.rs', 'lib.rs'],
    [nfc, nfd],
  ] as const) {
    const matches = async (path: string) => {
      const file = files.find((each) => changedPath(each).equals(Buffer.from(path)));
      return (await f.repo.hashCheckoutFile(dir, Buffer.from(path))) === file?.new?.oid;
    };
    const both = [await matches(a), await matches(b)];
    // On a disk that folds the two together, one file holds one of them, so the other is shown
    // from git.
    const folds = sameNameOnDisk(dir, a, b);
    expect.soft([a, folds ? !(both[0] && both[1]) : both[0] && both[1]]).toEqual([a, true]);
  }
});

/**
 * Pull request #1 moved to a commit on r1 whose tree holds `<folder>/config`, a name git itself
 * refuses to write by default, made from objects directly, as anyone can push it.
 */
function withFolder(f: Fixture, folder: string): Oid {
  const work = f.remote.work;
  const run = (args: string[], input: string) =>
    gitBytes(work, args, input).toString('utf8').trim();
  const config = run(['hash-object', '-w', '--stdin'], '[core]\n\thooksPath = /tmp\n');
  const readme = run(['hash-object', '-w', '--stdin'], '# repo\n');
  const inner = run(['mktree', '-z'], `100644 blob ${config}\tconfig\0`);
  const root = run(
    ['mktree', '-z'],
    `100644 blob ${readme}\tREADME.md\x00040000 tree ${inner}\t${folder}\x00`,
  );
  const commit = run(['commit-tree', root, '-p', f.r1, '-m', folder], '');
  git(work, 'update-ref', 'refs/heads/refused', commit);
  git(f.remote.gitDir, 'fetch', '-q', work, '+refs/heads/refused:refs/pull/1/head');
  return parseOid(commit);
}

/** Whether a checkout of the clone holds `name` anywhere. */
function holds(cache: Cache, name: string): boolean {
  const search = (folder: string): boolean =>
    readdirSync(folder).some(
      (entry) =>
        entry === name ||
        (lstatSync(join(folder, entry)).isDirectory() && search(join(folder, entry))),
    );
  const root = join(cache.root, 'checkouts');
  return existsSync(root) && search(root);
}

for (const [disk, folder] of [
  // A Mac's file system ignores a zero-width non-joiner, so this is `.git` to it.
  ['a Macs', '.g\u200cit'],
  // An old Windows short name for `.git`.
  ['Windows', 'git~1'],
] as const) {
  test(`a checkout never writes a name ${disk} disk takes for git`, async () => {
    const f = await fixture();
    const head = withFolder(f, folder);
    expect(await fetch(f.repo)).toBe(head);
    // Even when the clone's own settings would let it.
    git(f.repo.folder, 'config', 'core.protectHFS', 'false');
    git(f.repo.folder, 'config', 'core.protectNTFS', 'false');

    const error: unknown = await f.repo.checkout(1, head).catch((caught: unknown) => caught);

    expect(error instanceof GitError && error.message).toContain('invalid path');
    expect(holds(f.cache, folder)).toBe(false);
  });
}

test('git never takes a bare repository it finds in a checkout', async () => {
  // A pull request that holds a whole bare repository, which git could otherwise find by itself
  // and run what its settings say.
  const f = await fixture();
  const marker = join(tempFolder(), 'ran');
  f.remote
    .switch('feature')
    .write('nested/HEAD', 'ref: refs/heads/main\n')
    .write('nested/config', `[core]\n\tbare = true\n\tfsmonitor = touch ${marker}\n`)
    .write('nested/objects/info/packs', '')
    .write('nested/refs/heads/.keep', '');
  const head = parseOid(f.remote.commit('a bare repository'));
  f.remote.publish('refs/pull/1/head');
  expect(await fetch(f.repo)).toBe(head);
  const dir = await f.repo.checkout(1, head);

  const found = await f.cache.runner
    .command('none')
    .arg('-C')
    .path(join(dir, 'nested'))
    .arg('rev-parse', '--git-dir')
    .finish();

  expect(found.code).not.toBe(0);
  expect(found.stderr).toContain('safe.bareRepository');
  expect(existsSync(marker)).toBe(false);
});
