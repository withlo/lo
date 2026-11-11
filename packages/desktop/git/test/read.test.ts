// Reading diffs, files and history from a clone. Reads never download: what they need is
// downloaded first, by ID or by path.

import { renameSync } from 'node:fs';

import {
  blobId,
  git,
  missingObjects,
  packs,
  type RemoteRepo,
  type RepoServer,
  sourceLines,
} from '@lo/testing/git';
import { expect, test } from 'vitest';

import {
  type ChangedFile,
  changedPath,
  changedSize,
  type FileVersion,
  isModeChangeOnly,
  isSubmodule,
} from '../src/diff.ts';
import { GitError } from '../src/errors.ts';
import { type Oid, parseOid } from '../src/oid.ts';
import type { Repo } from '../src/repo.ts';
import { displayPath, type FileMode } from '../src/tree.ts';
import { cacheFor, repoServer } from './support.ts';

/** The commits the submodule points at. Neither is on the server, so fetching either fails. */
const SUBMODULE_BEFORE = '1111111111111111111111111111111111111111';
const SUBMODULE_AFTER = '2222222222222222222222222222222222222222';

/** A commit neither the clone nor the server has. */
const UNKNOWN = parseOid('3333333333333333333333333333333333333333');

/**
 * A pull request that changes a file of every kind, and the clone it's fetched into:
 *
 * - `keep.txt` modified, `run.sh` made executable, `data.bin` (binary) modified;
 * - `crlf.txt`'s line endings changed to CRLF;
 * - `old_name.rs` renamed to `src/new_name.rs` and edited;
 * - `gone.txt` deleted, `added.txt` added;
 * - `link`, a symlink, replaced by a file;
 * - `vendor/lib`, a submodule, moved to another commit.
 *
 * Every commit has a `.gitattributes` calling `*.txt` binary, which Lo ignores.
 */
interface Fixture {
  server: RepoServer;
  remote: RemoteRepo;
  first: Oid;
  base: Oid;
  head: Oid;
  trunkTip: Oid;
  repo: Repo;
}

async function fixture(): Promise<Fixture> {
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  remote.write('.gitattributes', '*.txt binary\n').write('keep.txt', 'keep, first version\n');
  const first = parseOid(remote.commit('first'));

  remote
    .write('keep.txt', 'keep\n')
    .write('crlf.txt', 'one\ntwo\n')
    .write('run.sh', 'echo run\n')
    .write('old_name.rs', sourceLines(''))
    .write('gone.txt', 'gone\n')
    .write('data.bin', Buffer.from('\x00\x01\x02base', 'latin1'))
    .write('odd\nname.txt', 'a line break in the name\n')
    .gitlink('vendor/lib', SUBMODULE_BEFORE)
    .symlink('link', 'keep.txt');
  const base = parseOid(remote.commit('base'));

  remote
    .switch('feature')
    .write('keep.txt', 'keep, changed\n')
    .write('crlf.txt', 'one\r\ntwo\r\n')
    .write('data.bin', Buffer.from('\x00\x01\x02head', 'latin1'))
    .remove('old_name.rs')
    .write('src/new_name.rs', sourceLines('pub fn added() {}\n'))
    .remove('gone.txt')
    .write('added.txt', 'added\n')
    .remove('link')
    .write('link', 'a file now\n')
    .gitlink('vendor/lib', SUBMODULE_AFTER)
    .executable('run.sh');
  const head = parseOid(remote.commit('head'));
  remote.publish('refs/pull/1/head');

  remote.switch('trunk').write('trunk.txt', 'trunk moved on\n');
  const trunkTip = parseOid(remote.commit('trunk moves on'));
  remote.publish('refs/heads/trunk');

  const repo = await (await cacheFor(server)).open('owner', 'repo');
  const fetched = await repo.fetchPull({ number: 1, head, baseBranch: 'trunk' });
  expect([fetched.head, fetched.baseTip]).toEqual([head, trunkTip]);
  return { server, remote, first, base, head, trunkTip, repo };
}

/** `path`'s version at `rev`, as the test's git sees it in the working copy's repository. */
function version(f: Fixture, rev: Oid, path: string, mode: FileMode): FileVersion {
  const oid = blobId(f.remote.work, rev, path);
  return {
    path: Buffer.from(path),
    oid: parseOid(oid),
    mode,
    size: Number(git(f.remote.work, 'cat-file', '-s', oid)),
  };
}

/** Downloads both sides of every file that changed from `from` to `to`, as showing their diff does. */
async function downloadChanges(repo: Repo, from: Oid, to: Oid): Promise<void> {
  expect(await repo.download(await repo.changedObjects(from, to))).toEqual([]);
}

/** Downloads the files at `paths` in `rev`. */
async function downloadAt(repo: Repo, rev: Oid, ...paths: string[]): Promise<void> {
  expect(
    await repo.downloadFiles(
      rev,
      paths.map((path) => Buffer.from(path)),
    ),
  ).toEqual([]);
}

async function failure(promise: Promise<unknown>): Promise<GitError> {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof GitError)) throw new Error(`expected a GitError, got ${String(error)}`);
  return error;
}

/** The submodule's side, at `oid`. */
function submodule(oid: string): FileVersion {
  return { path: Buffer.from('vendor/lib'), oid: parseOid(oid), mode: 'submodule' };
}

/** A changed file, with its lines added and deleted. */
function changed(
  change: ChangedFile['change'],
  old: FileVersion | undefined,
  now: FileVersion | undefined,
  binary: boolean,
  lines?: [number, number],
): ChangedFile {
  return { change, old, new: now, binary, lines: lines && { added: lines[0], deleted: lines[1] } };
}

test('lists what changed with renames binary files modes and submodules', async () => {
  const f = await fixture();
  await downloadChanges(f.repo, f.base, f.head);

  const files = await f.repo.changedFiles(f.base, f.head);

  const { base, head } = f;
  expect(files).toEqual([
    changed({ kind: 'added' }, undefined, version(f, head, 'added.txt', 'regular'), false, [1, 0]),
    changed(
      { kind: 'modified' },
      version(f, base, 'crlf.txt', 'regular'),
      version(f, head, 'crlf.txt', 'regular'),
      false,
      [2, 2],
    ),
    changed(
      { kind: 'modified' },
      version(f, base, 'data.bin', 'regular'),
      version(f, head, 'data.bin', 'regular'),
      true,
    ),
    changed({ kind: 'deleted' }, version(f, base, 'gone.txt', 'regular'), undefined, false, [0, 1]),
    changed(
      { kind: 'modified' },
      version(f, base, 'keep.txt', 'regular'),
      version(f, head, 'keep.txt', 'regular'),
      false,
      [1, 1],
    ),
    changed(
      { kind: 'typeChanged' },
      version(f, base, 'link', 'symlink'),
      version(f, head, 'link', 'regular'),
      false,
      [1, 1],
    ),
    changed(
      { kind: 'modified' },
      version(f, base, 'run.sh', 'regular'),
      version(f, head, 'run.sh', 'executable'),
      false,
      [0, 0],
    ),
    changed(
      { kind: 'renamed', similarity: 97 },
      version(f, base, 'old_name.rs', 'regular'),
      version(f, head, 'src/new_name.rs', 'regular'),
      false,
      [1, 0],
    ),
    // A commit in another repository, which Lo never reads.
    changed({ kind: 'modified' }, submodule(SUBMODULE_BEFORE), submodule(SUBMODULE_AFTER), false),
  ]);
  const [added, , , gone, keep, , run, renamed, lib] = files;
  if (!added || !gone || !keep || !run || !renamed || !lib) throw new Error('too few files');
  expect(displayPath(changedPath(gone))).toBe('gone.txt');
  expect(displayPath(changedPath(renamed))).toBe('src/new_name.rs');
  expect(renamed.old && displayPath(renamed.old.path)).toBe('old_name.rs');
  expect(isModeChangeOnly(run)).toBe(true);
  // The larger side's size, in bytes.
  expect(changedSize(keep)).toBe('keep, changed\n'.length);
  expect(changedSize(added)).toBe('added\n'.length);
  expect(changedSize(lib)).toBeUndefined();
  expect(isModeChangeOnly(keep)).toBe(false);
  expect(isSubmodule(lib)).toBe(true);
});

test('listing changes downloads both sides at once', async () => {
  const f = await fixture();
  const keep = blobId(f.remote.work, f.base, 'keep.txt');
  expect(missingObjects(f.repo.folder, f.base)).toContain(keep);
  const before = packs(f.repo.folder);
  // Without them, the list fails rather than downloading them one at a time.
  const error = await failure(f.repo.changedFiles(f.base, f.head));
  expect(error.detail.kind).toBe('notDownloaded');
  expect(packs(f.repo.folder)).toBe(before);

  await downloadChanges(f.repo, f.base, f.head);
  await f.repo.changedFiles(f.base, f.head);

  // In one download.
  expect(packs(f.repo.folder)).toBe(before + 1);
  const missing = missingObjects(f.repo.folder, f.head);
  expect(missing).not.toContain(keep);
  for (const path of ['keep.txt', 'added.txt', 'data.bin', 'src/new_name.rs']) {
    expect.soft(missing).not.toContain(blobId(f.remote.work, f.head, path));
  }
  // A file the pull request doesn't touch stays on the server.
  expect(missing).toContain(blobId(f.remote.work, f.head, 'odd\nname.txt'));
});

test('reads files by blob id', async () => {
  const f = await fixture();
  await downloadChanges(f.repo, f.base, f.head);
  const files = await f.repo.changedFiles(f.base, f.head);
  const read = async (side: FileVersion | undefined) => {
    if (side === undefined) throw new Error('no such side');
    return (await f.repo.readBlob(side.oid))?.toString('latin1');
  };
  const [, , data, , , link, , renamed] = files;

  expect(await read(renamed?.old)).toBe(sourceLines(''));
  expect(await read(renamed?.new)).toBe(sourceLines('pub fn added() {}\n'));
  expect(await read(data?.new)).toBe('\x00\x01\x02head');
  // A symlink's contents are its target.
  expect(await read(link?.old)).toBe('keep.txt');

  // A commit isn't a file.
  expect((await failure(f.repo.readBlob(f.head))).message).toContain('is a commit, not a file');
  // An object the clone doesn't have.
  expect(await f.repo.readBlob(UNKNOWN)).toBeUndefined();
  // And the reader still works afterwards.
  expect(await read(data?.new)).toBe('\x00\x01\x02head');
});

test('reads files by path at any revision', async () => {
  const f = await fixture();
  await downloadAt(f.repo, f.base, 'old_name.rs', 'odd\nname.txt');
  await downloadAt(f.repo, f.head, 'data.bin');
  await downloadAt(f.repo, f.first, 'keep.txt');
  await downloadAt(f.repo, f.trunkTip, 'trunk.txt');
  const read = async (rev: Oid, path: string) =>
    (await f.repo.readFile(rev, Buffer.from(path)))?.toString('latin1');

  expect(await read(f.base, 'old_name.rs')).toBe(sourceLines(''));
  expect(await read(f.head, 'data.bin')).toBe('\x00\x01\x02head');
  expect(await read(f.first, 'keep.txt')).toBe('keep, first version\n');
  expect(await read(f.trunkTip, 'trunk.txt')).toBe('trunk moved on\n');
  expect(await read(f.base, 'odd\nname.txt')).toBe('a line break in the name\n');

  expect(await read(f.base, 'added.txt')).toBeUndefined();
  expect(await read(f.head, 'gone.txt')).toBeUndefined();
  expect(await read(f.head, 'odd\nmissing.txt')).toBeUndefined();
  // Pathspec magic and globs are just names.
  expect(await read(f.head, '*.txt')).toBeUndefined();
  expect(await read(f.head, ':(glob)**/*.rs')).toBeUndefined();
  expect(await read(f.head, 'src/')).toBeUndefined();

  expect((await failure(read(f.head, 'src'))).message).toContain('src is a tree');
  expect((await failure(read(f.head, ''))).detail.kind).toBe('invalid');
});

test('describes a file at any revision as a diff would', async () => {
  const f = await fixture();
  await downloadChanges(f.repo, f.base, f.head);
  await downloadAt(f.repo, f.base, 'odd\nname.txt');
  const at = (rev: Oid, path: string) => f.repo.fileVersion(rev, Buffer.from(path));

  expect(await at(f.head, 'keep.txt')).toEqual(version(f, f.head, 'keep.txt', 'regular'));
  expect(await at(f.head, 'run.sh')).toEqual(version(f, f.head, 'run.sh', 'executable'));
  expect(await at(f.base, 'link')).toEqual(version(f, f.base, 'link', 'symlink'));
  expect(await at(f.base, 'odd\nname.txt')).toEqual(version(f, f.base, 'odd\nname.txt', 'regular'));
  // A submodule is the commit it points at, which nothing reads.
  expect(await at(f.head, 'vendor/lib')).toEqual({
    path: Buffer.from('vendor/lib'),
    oid: SUBMODULE_AFTER,
    mode: 'submodule',
  });
  // As the diff listed it.
  const listed = await f.repo.changedFiles(f.base, f.head);
  const keep = listed.find((file) => displayPath(changedPath(file)) === 'keep.txt');
  expect(await at(f.head, 'keep.txt')).toEqual(keep?.new);
  expect(await at(f.base, 'keep.txt')).toEqual(keep?.old);

  expect(await at(f.head, 'gone.txt')).toBeUndefined();
  expect(await at(f.head, 'src/')).toBeUndefined();
  expect((await failure(at(f.head, 'src'))).message).toContain('src is a tree');
});

test('never fetches a submodules commit', async () => {
  const f = await fixture();
  await downloadChanges(f.repo, f.base, f.head);

  // The submodule's commits aren't on the server, so fetching either would fail.
  const files = await f.repo.changedFiles(f.base, f.head);
  expect(files.some(isSubmodule)).toBe(true);
  const error = await failure(f.repo.readFile(f.head, Buffer.from('vendor/lib')));
  expect(error.message).toContain('vendor/lib is a submodule');
  expect(await f.repo.downloadFiles(f.head, [Buffer.from('vendor/lib')])).toEqual([]);

  // Everything else still reads.
  expect((await f.repo.readFile(f.head, Buffer.from('keep.txt')))?.toString('utf8')).toBe(
    'keep, changed\n',
  );
});

test('reading a file downloads it once', async () => {
  const f = await fixture();
  const blob = blobId(f.remote.work, f.first, 'keep.txt');
  expect(missingObjects(f.repo.folder, f.first)).toContain(blob);
  const keep = Buffer.from('keep.txt');
  // Reading alone never downloads it.
  const before = packs(f.repo.folder);
  expect((await failure(f.repo.readFile(f.first, keep))).detail).toEqual({
    kind: 'notDownloaded',
    oids: [blob],
  });
  expect(packs(f.repo.folder)).toBe(before);

  expect(await f.repo.downloadFiles(f.first, [keep])).toEqual([]);
  expect(await f.repo.downloadFiles(f.first, [keep])).toEqual([]);

  expect(missingObjects(f.repo.folder, f.first)).not.toContain(blob);
  expect(packs(f.repo.folder)).toBe(before + 1);
  expect((await f.repo.readFile(f.first, keep))?.toString('utf8')).toBe('keep, first version\n');
});

test('a failed download is a fetch error and the next read recovers', async () => {
  const f = await fixture();
  const keep = Buffer.from('keep.txt');
  // Start the long-lived reader, then take the server away.
  await downloadAt(f.repo, f.head, 'keep.txt');
  expect(await f.repo.readFile(f.head, keep)).toBeDefined();
  const moved = `${f.remote.gitDir}.moved`;
  renameSync(f.remote.gitDir, moved);

  const error = await failure(f.repo.downloadFiles(f.first, [keep]));
  expect(error.detail).toMatchObject({ kind: 'fetch', failure: 'repoNotFound' });
  expect((await failure(f.repo.readFile(f.first, keep))).detail.kind).toBe('notDownloaded');

  renameSync(moved, f.remote.gitDir);
  expect(await f.repo.downloadFiles(f.first, [keep])).toEqual([]);
  expect((await f.repo.readFile(f.first, keep))?.toString('utf8')).toBe('keep, first version\n');
});

test('lists changed files at some paths only', async () => {
  const f = await fixture();
  await downloadChanges(f.repo, f.base, f.head);
  const all = await f.repo.changedFiles(f.base, f.head);
  expect(all.length).toBeGreaterThan(2);

  const paths = ['keep.txt', 'added.txt'].map((path) => Buffer.from(path));
  const some = await f.repo.changedFiles(f.base, f.head, { paths });

  expect(some.map((file) => displayPath(changedPath(file)))).toEqual(['added.txt', 'keep.txt']);
});

test('finds merge bases and ancestors', async () => {
  const f = await fixture();
  const { repo } = f;

  expect(await repo.mergeBase(f.head, f.trunkTip)).toBe(f.base);
  expect(await repo.isAncestor(f.base, f.head)).toBe(true);
  expect(await repo.isAncestor(f.head, f.head)).toBe(true);
  expect(await repo.isAncestor(f.head, f.base)).toBe(false);
  expect(await repo.isAncestor(f.trunkTip, f.head)).toBe(false);

  // A pull request with no history in common with its base.
  f.remote.orphan('unrelated').write('other.txt', 'other\n');
  const unrelated = parseOid(f.remote.commit('unrelated'));
  f.remote.publish('refs/pull/2/head');
  const fetched = await repo.fetchPull({ number: 2, baseBranch: 'trunk' });
  expect(fetched.head).toBe(unrelated);
  expect(await repo.mergeBase(unrelated, f.head)).toBeUndefined();
  expect(await repo.isAncestor(unrelated, f.head)).toBe(false);
  // A commit the clone doesn't have is an error, not "no history in common".
  await expect(repo.mergeBase(UNKNOWN, f.head)).rejects.toThrow(GitError);
});

test('reads a commits parents first parent first', async () => {
  const f = await fixture();
  const { repo } = f;
  expect(await repo.parents(f.first)).toEqual([]);
  expect(await repo.parents(f.base)).toEqual([f.first]);

  // The pull request merged into trunk with a merge commit.
  f.remote.switch('trunk');
  git(f.remote.work, 'merge', '-q', '--no-ff', '-m', 'merge', f.head);
  const merge = parseOid(f.remote.head());
  f.remote.publish('refs/heads/trunk');
  await repo.fetchPull({ number: 1, baseBranch: 'trunk' });
  expect(await repo.parents(merge)).toEqual([f.trunkTip, f.head]);
  // The merge that brought the head in is found from the base branch alone.
  expect(await repo.mergedBy(f.head, merge)).toEqual([f.trunkTip, f.head]);
  expect(await repo.mergedBy(f.head, f.trunkTip)).toBeUndefined();
  expect(await repo.mergedBy(f.head, f.head)).toBeUndefined();

  // A commit the clone doesn't have is never downloaded.
  expect((await failure(repo.parents(UNKNOWN))).detail).toEqual({
    kind: 'notFetched',
    oid: UNKNOWN,
  });
});

test('the clones own config cant turn attributes on', async () => {
  const f = await fixture();
  await downloadChanges(f.repo, f.base, f.head);
  // Every commit's `.gitattributes` calls `*.txt` binary. A setting naming a tree to read
  // attributes from, as `attr.tree` does, would apply it, once the clone has the file.
  await downloadAt(f.repo, f.head, '.gitattributes');
  git(f.repo.folder, 'config', 'attr.tree', 'refs/lo/pull/1/head');

  const files = await f.repo.changedFiles(f.base, f.head);

  const keep = files.find((file) => displayPath(changedPath(file)) === 'keep.txt');
  expect(keep?.binary).toBe(false);
  expect(keep?.lines).toEqual({ added: 1, deleted: 1 });
});

test('names that arent utf8 or hold a tab are listed and read', async () => {
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  const base = parseOid(remote.write('README.md', '# repo\n').commit('base'));
  remote.publish('refs/heads/trunk');
  // Latin-1 for "café.txt", which GitHub accepts, and a tab, which a Mac's disk does.
  const cafe = Buffer.from('caf\xe9.txt', 'latin1');
  remote.switch('feature').write('tab\tname.txt', 'a tab\n');
  const head = parseOid(remote.commitWithNames([[cafe, 'latin-1\n']], 'names'));
  remote.publish('refs/pull/1/head');
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  await repo.fetchPull({ number: 1, baseBranch: 'trunk' });
  await downloadChanges(repo, base, head);

  const files = await repo.changedFiles(base, head);

  expect(files.map(changedPath)).toEqual([cafe, Buffer.from('tab\tname.txt')]);
  const [first] = files;
  expect(first && displayPath(changedPath(first))).toBe('caf�.txt');
  expect(first?.lines).toEqual({ added: 1, deleted: 0 });
  expect((await repo.readFile(head, cafe))?.toString('utf8')).toBe('latin-1\n');
  expect((await repo.readFile(head, Buffer.from('tab\tname.txt')))?.toString('utf8')).toBe(
    'a tab\n',
  );
  expect(await repo.readFile(head, Buffer.from('caf\xe8.txt', 'latin1'))).toBeUndefined();
});

test('a file larger than its reader takes is refused without reading it', async () => {
  const f = await fixture();
  await downloadAt(f.repo, f.head, 'keep.txt');
  const keep = Buffer.from('keep.txt');
  const oid = parseOid(blobId(f.remote.work, f.head, 'keep.txt'));

  const error = await failure(f.repo.readBlob(oid, { maxBytes: 'keep, changed\n'.length - 1 }));
  expect(error.detail).toMatchObject({ kind: 'tooLarge', limit: 13 });
  await expect(f.repo.readFile(f.head, keep, { maxBytes: 13 })).rejects.toThrow(GitError);

  // The reader goes on, and a cap the file fits takes it.
  expect((await f.repo.readBlob(oid, { maxBytes: 14 }))?.toString('utf8')).toBe('keep, changed\n');
});

test('a diff of more files than its reader takes is refused', async () => {
  const f = await fixture();
  await downloadChanges(f.repo, f.base, f.head);

  const error = await failure(f.repo.changedFiles(f.base, f.head, { maxEntries: 8 }));

  expect(error.detail).toMatchObject({ kind: 'tooLarge', limit: 8, unit: 'entries' });
  expect(await f.repo.changedFiles(f.base, f.head, { maxEntries: 9 })).toHaveLength(9);
});
