// Comparing two revisions of a pull request, across a rebase.

import { randomBytes } from 'node:crypto';
import { chmodSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import { blobId, git, missingObjects, packs, type RemoteRepo } from '@lo/testing/git';
import { expect, test } from 'vitest';

import type { Cache } from '../src/cache.ts';
import { type ComparedFile, type Comparison, isConflicted, type Revision } from '../src/compare.ts';
import { type ChangedFile, changedPath, isModeChangeOnly, isSubmodule } from '../src/diff.ts';
import { GitError } from '../src/errors.ts';
import { type Oid, parseOid } from '../src/oid.ts';
import type { Activity } from '../src/progress.ts';
import type { Repo } from '../src/repo.ts';
import { displayPath } from '../src/tree.ts';
import { cacheFor, compared, eventually, repoServer } from './support.ts';

/** Twenty lines, `<name> line <n>`, with `changes` in place of some. Changes to lines far enough apart merge cleanly. */
function text(name: string, edits: Record<number, string> = {}): string {
  let lines = '';
  for (let n = 1; n <= 20; n++) lines += `${edits[n] ?? `${name} line ${n}`}\n`;
  return lines;
}

/** Twenty lines of Rust named after `name`, long enough that a small edit still reads as a rename. */
function source(name: string, edits: Record<number, string> = {}): string {
  let lines = '';
  for (let n = 1; n <= 20; n++) lines += `${edits[n] ?? `pub fn ${name}_${n}() -> u32 { ${n} }`}\n`;
  return lines;
}

/** A repository whose `trunk` and pull requests the tests move, and the clone they fetch into. */
interface Fixture {
  remote: RemoteRepo;
  cache: Cache;
  repo: Repo;
  /** What the cache logged. */
  logged: string[];
}

async function fixture(): Promise<Fixture> {
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  const logged: string[] = [];
  const cache = await cacheFor(server, { log: (line) => logged.push(line) });
  return { remote, cache, repo: await cache.open('owner', 'repo'), logged };
}

/** Whether a replay had to download more than it worked out it needed. */
function fellBack(f: Fixture): boolean {
  return f.logged.some((line) => line.includes('so downloading what either side changed'));
}

/**
 * Publishes the working copy's commit as pull request `number`'s head, with `baseBranch` as it
 * is, and fetches both, as Lo does after each push. Returns the revision, its base as Lo works it
 * out: the merge base of its head with the base branch as it is now, when it was pushed.
 */
async function pushRevision(f: Fixture, number: number, baseBranch: string): Promise<Revision> {
  f.remote.publish(`refs/pull/${number}/head`);
  const fetched = await f.repo.fetchPull({
    number,
    head: parseOid(f.remote.head()),
    baseBranch,
  });
  const base = await f.repo.mergeBase(fetched.head, fetched.baseTip);
  if (base === undefined) throw new Error('the head and its base share no history');
  return { base, head: fetched.head };
}

async function push(f: Fixture, number: number, baseBranch: string): Promise<Oid> {
  return (await pushRevision(f, number, baseBranch)).head;
}

/** The files that changed from `from` to `to`, both sides downloaded first. */
async function changedFiles(repo: Repo, from: Oid, to: Oid): Promise<ChangedFile[]> {
  await repo.download(await repo.changedObjects(from, to));
  return repo.changedFiles(from, to);
}

/** What a plain comparison of the two heads shows: every path, base changes included. */
async function plainPaths(f: Fixture, old: Oid, now: Oid): Promise<string[]> {
  return changedPaths(await changedFiles(f.repo, old, now));
}

/** The file at `path` in `rev`, downloaded first, or `undefined` when there's none. */
async function read(repo: Repo, rev: Oid, path: string): Promise<string | undefined> {
  const at = Buffer.from(path);
  if ((await repo.fileVersion(rev, at)) === undefined) return undefined;
  await repo.downloadFiles(rev, [at]);
  return (await repo.readFile(rev, at))?.toString('utf8');
}

/** The replayed trees pinned in the clone, with their refs. */
function replayPins(repo: Repo): [string, string][] {
  return git(repo.folder, 'for-each-ref', '--format=%(objectname) %(refname)', 'refs/lo/replays/')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [oid = '', name = ''] = line.split(' ');
      return [oid, name];
    });
}

function paths(files: readonly ComparedFile[]): string[] {
  return files.map((file) => displayPath(file.path));
}

/** How each file changed between the comparison's sides. Every file must have changed. */
function changes(files: readonly ComparedFile[]): ChangedFile[] {
  return files.map((file) => {
    if (file.change === undefined) throw new Error(`${displayPath(file.path)} didn't change`);
    return file.change;
  });
}

/** The files marked as conflicted in the replay. */
function conflicted(files: readonly ComparedFile[]): string[] {
  return files.filter(isConflicted).map((file) => displayPath(file.path));
}

function changedPaths(files: readonly ChangedFile[]): string[] {
  return files.map((file) => displayPath(changedPath(file)));
}

/** How `file`'s conflict was resolved. */
function resolutionOf(file: ComparedFile | undefined): readonly ChangedFile[] {
  if (file?.resolution === undefined) throw new Error('no resolution');
  return file.resolution;
}

async function failure(promise: Promise<unknown>): Promise<GitError> {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof GitError)) throw new Error(`expected a GitError, got ${String(error)}`);
  return error;
}

/**
 * Pull request #1 rebased onto a trunk that moved, with one more change:
 *
 * ```text
 * m1 ── m2                   (trunk: m2 changes b.txt and adds e.txt)
 *  │     └── r2              (rebased: r1's changes, then c.txt changed too)
 *  └── r1                    (a.txt changed, d.txt added)
 * ```
 */
interface Rebased {
  f: Fixture;
  m1: Oid;
  m2: Oid;
  r1: Oid;
  r2: Oid;
}

async function rebased(): Promise<Rebased> {
  const f = await fixture();
  const { remote } = f;
  remote
    .write('a.txt', text('a'))
    .write('b.txt', text('b'))
    .write('c.txt', text('c'))
    .write('untouched.txt', text('untouched'));
  const m1 = parseOid(remote.commit('m1'));
  remote.publish('refs/heads/trunk');
  remote
    .switch('feature')
    .write('a.txt', text('a', { 3: 'a line 3, changed by the PR' }))
    .write('d.txt', text('d'))
    .commit('change a.txt and add d.txt');
  const r1 = await push(f, 1, 'trunk');
  remote
    .switch('trunk')
    .write('b.txt', text('b', { 10: 'b line 10, changed on trunk' }))
    .write('e.txt', text('e'));
  const m2 = parseOid(remote.commit('m2'));
  remote.publish('refs/heads/trunk');
  remote
    .switch('feature-2')
    .write('a.txt', text('a', { 3: 'a line 3, changed by the PR' }))
    .write('d.txt', text('d'))
    .commit('change a.txt and add d.txt');
  remote.write('c.txt', text('c', { 15: 'c line 15, the change r2 adds' })).commit('change c.txt');
  const r2 = await push(f, 1, 'trunk');
  return { f, m1, m2, r1, r2 };
}

/** Both sides of the comparison, as `rebased` makes them. */
function sides(r: Rebased): [Revision, Revision] {
  return [
    { base: r.m1, head: r.r1 },
    { base: r.m2, head: r.r2 },
  ];
}

test('a rebase onto a moved base shows only the authors new change', async () => {
  const r = await rebased();
  const { f, m1, m2, r1, r2 } = r;
  // A plain comparison shows trunk's changes as if the author had made them.
  expect(await plainPaths(f, r1, r2)).toEqual(['b.txt', 'c.txt', 'e.txt']);
  expect(await f.repo.mergeBase(r1, m2)).toBe(m1);
  expect(await f.repo.mergeBase(r2, m2)).toBe(m2);

  const comparison = await compared(f.repo, ...sides(r));

  expect(comparison.replay).toEqual({ kind: 'clean' });
  expect(paths(comparison.files)).toEqual(['c.txt']);
  expect(conflicted(comparison.files)).toEqual([]);
  const [c] = changes(comparison.files);
  expect(c?.change).toEqual({ kind: 'modified' });
  // The old side is c.txt as r1 left it, which is trunk's, and the new side is r2's.
  expect(c?.old?.oid).toBe(blobId(f.remote.work, m2, 'c.txt'));
  expect(c?.new?.oid).toBe(blobId(f.remote.work, r2, 'c.txt'));
  expect(c?.old?.size).toBe(text('c').length);
  expect(c?.new?.size).toBe(text('c', { 15: 'c line 15, the change r2 adds' }).length);
  expect(c?.lines).toEqual({ added: 1, deleted: 1 });

  // The old side is r1's changes on r2's base: a tree, which reads like any revision.
  expect(comparison.old).not.toBe(r1);
  expect(git(f.repo.folder, 'cat-file', '-t', comparison.old)).toBe('tree');
  expect(comparison.new).toBe(r2);
  const old = (path: string) => read(f.repo, comparison.old, path);
  expect(await old('c.txt')).toBe(text('c'));
  expect(await old('a.txt')).toBe(text('a', { 3: 'a line 3, changed by the PR' }));
  expect(await old('b.txt')).toBe(text('b', { 10: 'b line 10, changed on trunk' }));
  expect(await old('e.txt')).toBe(text('e'));
  expect(await read(f.repo, comparison.new, 'c.txt')).toBe(
    text('c', { 15: 'c line 15, the change r2 adds' }),
  );
});

test('a conflicting rebase falls back to the plain comparison with each conflicted file marked', async () => {
  const f = await fixture();
  const { remote } = f;
  remote.write('a.txt', text('a')).write('b.txt', text('b'));
  const m1 = parseOid(remote.commit('m1'));
  remote.publish('refs/heads/trunk');
  remote
    .switch('feature')
    .write('a.txt', text('a', { 3: 'a line 3, changed by the PR' }))
    .write('b.txt', text('b', { 5: 'b line 5, changed by the PR' }))
    .commit('change a.txt and b.txt');
  const r1 = await push(f, 1, 'trunk');
  // Trunk changes the line the pull request changed, so the author resolves it in r2.
  remote
    .switch('trunk')
    .write('a.txt', text('a', { 3: 'a line 3, changed on trunk' }))
    .write('e.txt', text('e'));
  const m2 = parseOid(remote.commit('m2'));
  remote.publish('refs/heads/trunk');
  remote
    .switch('feature-2')
    .write('a.txt', text('a', { 3: 'a line 3, changed by both' }))
    .write('b.txt', text('b', { 5: 'b line 5, changed by the PR' }))
    .commit('change a.txt and b.txt, after trunk');
  const r2 = await push(f, 1, 'trunk');

  const comparison = await compared(f.repo, { base: m1, head: r1 }, { base: m2, head: r2 });

  const { replay } = comparison;
  if (replay.kind !== 'conflicted') throw new Error(`replayed ${replay.kind}`);
  expect(replay.retargeted).toBe(false);
  // The plain comparison of the heads, trunk's e.txt included, with a.txt marked.
  expect(paths(comparison.files)).toEqual(['a.txt', 'e.txt']);
  expect(changes(comparison.files)).toEqual(await f.repo.changedFiles(r1, r2));
  expect(conflicted(comparison.files)).toEqual(['a.txt']);
  expect([comparison.old, comparison.new]).toEqual([r1, r2]);
  // How the author resolved it: from git's conflict markers to the line they wrote.
  const resolution = resolutionOf(comparison.files[0]);
  expect(changedPaths(resolution)).toEqual(['a.txt']);
  const markers = (await read(f.repo, replay.tree, 'a.txt')) ?? '';
  for (const line of [
    '<<<<<<<',
    'a line 3, changed on trunk',
    'a line 3, changed by the PR',
    '>>>>>>>',
  ]) {
    expect.soft(markers).toContain(line);
  }
  const [part] = resolution;
  if (part?.old === undefined || part.new === undefined) throw new Error('two sides');
  expect((await f.repo.readBlob(part.old.oid))?.toString('utf8')).toBe(markers);
  expect(part.new.oid).toBe(blobId(f.remote.work, r2, 'a.txt'));
  // The conflicted replay is pinned, as a clean one is.
  expect(replayPins(f.repo).map(([tree]) => tree)).toEqual([replay.tree]);
});

test('a conflict resolved by dropping the bases change shows', async () => {
  // The base and the pull request change the same line, and the author resolves it by keeping
  // their own, which drops the base's change. Comparing the heads shows nothing for that file.
  const f = await fixture();
  const { remote } = f;
  remote.write('a.txt', text('a')).write('u.txt', text('u'));
  const m1 = parseOid(remote.commit('m1'));
  remote.publish('refs/heads/trunk');
  remote
    .switch('feature')
    .write('a.txt', text('a', { 3: "a line 3, the PR's" }))
    .commit('r1');
  const r1 = await push(f, 1, 'trunk');
  remote
    .switch('trunk')
    .write('a.txt', text('a', { 3: "a line 3, trunk's" }))
    .write('u.txt', text('u', { 9: "u line 9, trunk's" }));
  const m2 = parseOid(remote.commit('m2'));
  remote.publish('refs/heads/trunk');
  remote
    .switch('feature-2')
    .write('a.txt', text('a', { 3: "a line 3, the PR's" }))
    .commit('r2');
  const r2 = await push(f, 1, 'trunk');
  expect(await plainPaths(f, r1, r2)).toEqual(['u.txt']);

  const comparison = await compared(f.repo, { base: m1, head: r1 }, { base: m2, head: r2 });

  expect(comparison.replay.kind).toBe('conflicted');
  expect(paths(comparison.files)).toEqual(['a.txt', 'u.txt']);
  expect(conflicted(comparison.files)).toEqual(['a.txt']);
  const [a] = comparison.files;
  // The same in both heads.
  expect(a?.change).toBeUndefined();
  const resolution = resolutionOf(a);
  expect(changedPaths(resolution)).toEqual(['a.txt']);
  expect(resolution[0]?.change).toEqual({ kind: 'modified' });
  expect(resolution[0]?.new?.oid).toBe(blobId(f.remote.work, r2, 'a.txt'));
});

test('a file set aside in a conflict is marked as the file it came from', async () => {
  // The pull request turns a file into a symlink, which the base changes. git sets the base's file
  // aside as `l.txt~<base>`, which is in neither revision: the conflict is l.txt's.
  const f = await fixture();
  const { remote } = f;
  const m1 = parseOid(remote.write('l.txt', text('l')).commit('m1'));
  remote.publish('refs/heads/trunk');
  remote.switch('feature').symlink('l.txt', 'target').commit('r1');
  const r1 = await push(f, 1, 'trunk');
  remote.switch('trunk').write('l.txt', text('l', { 5: "l line 5, trunk's" }));
  const m2 = parseOid(remote.commit('m2'));
  remote.publish('refs/heads/trunk');
  remote.switch('feature-2').symlink('l.txt', 'target').commit('r2');
  const r2 = await push(f, 1, 'trunk');

  const comparison = await compared(f.repo, { base: m1, head: r1 }, { base: m2, head: r2 });

  expect(comparison.replay.kind).toBe('conflicted');
  expect(paths(comparison.files)).toEqual(['l.txt']);
  expect(conflicted(comparison.files)).toEqual(['l.txt']);
  expect(comparison.files[0]?.change).toBeUndefined();
  // The author dropped trunk's change, set aside under a name of its own.
  const resolution = resolutionOf(comparison.files[0]);
  expect(changedPaths(resolution)).toEqual([`l.txt~${m2}`]);
  expect(resolution[0]?.change).toEqual({ kind: 'deleted' });
  expect(resolution[0]?.old?.oid).toBe(blobId(f.remote.work, m2, 'l.txt'));
});

test('a binary file changed on both sides is marked', async () => {
  const f = await fixture();
  const { remote } = f;
  const m1 = parseOid(remote.write('b.bin', 'a\0b').commit('m1'));
  remote.publish('refs/heads/trunk');
  remote.switch('feature').write('b.bin', "a\0the PR's").commit('r1');
  const r1 = await push(f, 1, 'trunk');
  const m2 = parseOid(remote.switch('trunk').write('b.bin', "a\0trunk's").commit('m2'));
  remote.publish('refs/heads/trunk');
  remote.switch('feature-2').write('b.bin', 'a\0both').commit('r2');
  const r2 = await push(f, 1, 'trunk');

  const comparison = await compared(f.repo, { base: m1, head: r1 }, { base: m2, head: r2 });

  expect(comparison.replay.kind).toBe('conflicted');
  expect(conflicted(comparison.files)).toEqual(['b.bin']);
  const [b] = comparison.files;
  expect(b?.change?.binary).toBe(true);
  // git keeps the new base's version of a binary file it can't merge.
  const resolution = resolutionOf(b);
  expect(changedPaths(resolution)).toEqual(['b.bin']);
  expect(resolution[0]?.binary).toBe(true);
  expect(resolution[0]?.old?.oid).toBe(blobId(f.remote.work, m2, 'b.bin'));
  expect(resolution[0]?.new?.oid).toBe(blobId(f.remote.work, r2, 'b.bin'));
});

/** A `.gitmodules` naming the submodule at `sub`. */
const GITMODULES = '[submodule "sub"]\n\tpath = sub\n\turl = https://example.com/sub.git\n';

test('a submodule moved on both sides is marked', async () => {
  // Both sides move a submodule, and the author keeps the pull request's commit, which moves it
  // back from the base's. Its commits, which are in another repository, are never fetched.
  const [s1, s2, s3] = ['1', '2', '4'].map((digit) => digit.repeat(40));
  if (s1 === undefined || s2 === undefined || s3 === undefined) throw new Error('three commits');
  const f = await fixture();
  const { remote } = f;
  const m1 = parseOid(remote.write('.gitmodules', GITMODULES).gitlink('sub', s1).commit('m1'));
  remote.publish('refs/heads/trunk');
  remote.switch('feature').gitlink('sub', s2).commit('r1');
  const r1 = await push(f, 1, 'trunk');
  const m2 = parseOid(remote.switch('trunk').gitlink('sub', s3).commit('m2'));
  remote.publish('refs/heads/trunk');
  remote.switch('feature-2').gitlink('sub', s2).commit('r2');
  const r2 = await push(f, 1, 'trunk');

  const comparison = await compared(f.repo, { base: m1, head: r1 }, { base: m2, head: r2 });

  expect(comparison.replay.kind).toBe('conflicted');
  expect(paths(comparison.files)).toEqual(['sub']);
  expect(comparison.files[0]?.change).toBeUndefined();
  const resolution = resolutionOf(comparison.files[0]);
  expect(changedPaths(resolution)).toEqual(['sub']);
  const [part] = resolution;
  if (part === undefined) throw new Error('a resolution');
  expect(isSubmodule(part)).toBe(true);
  expect([part.old?.oid, part.new?.oid]).toEqual([s3, s2]);
  expect([part.old?.mode, part.new?.mode]).toEqual(['submodule', 'submodule']);
});

test('a file deleted on one side and changed on the other is marked', async () => {
  // The pull request deletes a file the base changes, and the author keeps it deleted, which drops
  // the base's change.
  const f = await fixture();
  const { remote } = f;
  const m1 = parseOid(remote.write('f.txt', text('f')).write('g.txt', text('g')).commit('m1'));
  remote.publish('refs/heads/trunk');
  remote.switch('feature').remove('f.txt').commit('r1');
  const r1 = await push(f, 1, 'trunk');
  const m2 = parseOid(
    remote
      .switch('trunk')
      .write('f.txt', text('f', { 10: "f line 10, trunk's" }))
      .commit('m2'),
  );
  remote.publish('refs/heads/trunk');
  remote.switch('feature-2').remove('f.txt').commit('r2');
  const r2 = await push(f, 1, 'trunk');
  expect(await plainPaths(f, r1, r2)).toEqual([]);

  const comparison = await compared(f.repo, { base: m1, head: r1 }, { base: m2, head: r2 });

  expect(comparison.replay.kind).toBe('conflicted');
  expect(paths(comparison.files)).toEqual(['f.txt']);
  expect(comparison.files[0]?.change).toBeUndefined();
  const resolution = resolutionOf(comparison.files[0]);
  expect(changedPaths(resolution)).toEqual(['f.txt']);
  expect(resolution[0]?.change).toEqual({ kind: 'deleted' });
  expect(resolution[0]?.old?.oid).toBe(blobId(f.remote.work, m2, 'f.txt'));
});

test('revisions on the same base get the plain comparison', async () => {
  // The base branch moves on between two pushes that don't rebase, so each revision's base, the
  // merge base of its head with the base branch as it was when it was pushed, is the same.
  const f = await fixture();
  const { remote } = f;
  const m1 = parseOid(remote.write('a.txt', text('a')).write('c.txt', text('c')).commit('m1'));
  remote.publish('refs/heads/trunk');
  remote
    .switch('feature')
    .write('a.txt', text('a', { 3: 'a line 3, changed by the PR' }))
    .commit('change a.txt');
  const r1 = await pushRevision(f, 1, 'trunk');
  const m2 = parseOid(remote.switch('trunk').write('e.txt', text('e')).commit('m2'));
  remote.publish('refs/heads/trunk');
  remote
    .switch('feature')
    .write('c.txt', text('c', { 15: 'c line 15, the change r2 adds' }))
    .commit('change c.txt');
  const r2 = await pushRevision(f, 1, 'trunk');
  expect(await f.repo.isAncestor(m2, r2.head)).toBe(false);
  expect([r1.base, r2.base]).toEqual([m1, m1]);

  const comparison = await compared(f.repo, r1, r2);

  expect(comparison.replay).toEqual({ kind: 'sameBase' });
  expect(paths(comparison.files)).toEqual(['c.txt']);
  expect(changes(comparison.files)).toEqual(await f.repo.changedFiles(r1.head, r2.head));
  expect([comparison.old, comparison.new]).toEqual([r1.head, r2.head]);
  expect(replayPins(f.repo)).toEqual([]);
});

test('a change the author drops from the base shows', async () => {
  // What the replay merges cleanly but a plain comparison can't show: the author dropping a change
  // the base made, as r2 does here to line 7 of a.txt. r1 and r2 both have a.txt as it was.
  const f = await fixture();
  const { remote } = f;
  remote.write('a.txt', text('a')).commit('m1');
  remote.publish('refs/heads/trunk');
  remote.switch('feature').write('pr.txt', 'pr\n').commit('r1');
  const r1 = await pushRevision(f, 1, 'trunk');
  remote
    .switch('trunk')
    .write('a.txt', text('a', { 7: "a line 7, trunk's" }))
    .commit('m2');
  remote.publish('refs/heads/trunk');
  remote.switch('feature-2').write('pr.txt', 'pr\n').write('a.txt', text('a')).commit('r2');
  const r2 = await pushRevision(f, 1, 'trunk');
  expect(await plainPaths(f, r1.head, r2.head)).toEqual([]);

  const comparison = await compared(f.repo, r1, r2);

  expect(comparison.replay).toEqual({ kind: 'clean' });
  expect(paths(comparison.files)).toEqual(['a.txt']);
  expect(await read(f.repo, comparison.old, 'a.txt')).toBe(text('a', { 7: "a line 7, trunk's" }));
});

test('a mode change on one side and an edit on the other replay cleanly', async () => {
  // The pull request makes a script executable, which the base edits: the replay keeps both.
  const f = await fixture();
  const { remote } = f;
  remote.write('s.sh', text('s')).commit('m1');
  remote.publish('refs/heads/trunk');
  remote.switch('feature').executable('s.sh').commit('r1');
  const r1 = await pushRevision(f, 1, 'trunk');
  remote
    .switch('trunk')
    .write('s.sh', text('s', { 10: "s line 10, trunk's" }))
    .commit('m2');
  remote.publish('refs/heads/trunk');
  remote.switch('feature-2').executable('s.sh').commit('r2');
  const r2 = await pushRevision(f, 1, 'trunk');

  const comparison = await compared(f.repo, r1, r2);

  expect(comparison.replay).toEqual({ kind: 'clean' });
  expect(comparison.files).toEqual([]);
  // Taking the mode change back out shows as a mode change alone.
  chmodSync(join(remote.work, 's.sh'), 0o644);
  remote.commit('r3');
  const r3 = await pushRevision(f, 1, 'trunk');
  const back = await compared(f.repo, r1, r3);
  expect(back.replay).toEqual({ kind: 'clean' });
  expect(paths(back.files)).toEqual(['s.sh']);
  const [s] = changes(back.files);
  expect(s && isModeChangeOnly(s)).toBe(true);
});

test('a submodule only the pull request moves replays cleanly', async () => {
  // A submodule only the pull request moves replays with no download: its commits are in another
  // repository, and nothing else changed on both sides.
  const f = await fixture();
  const { remote } = f;
  remote.write('.gitmodules', GITMODULES).gitlink('sub', '1'.repeat(40)).commit('m1');
  remote.publish('refs/heads/trunk');
  const s2 = '2'.repeat(40);
  remote.switch('feature').gitlink('sub', s2).commit('r1');
  const r1 = await pushRevision(f, 1, 'trunk');
  remote.switch('trunk').write('other.txt', 'other\n').commit('m2');
  remote.publish('refs/heads/trunk');
  remote.switch('feature-2').gitlink('sub', s2).commit('r2');
  const r2 = await pushRevision(f, 1, 'trunk');
  const before = packs(f.repo.folder);

  const comparison = await compared(f.repo, r1, r2);

  expect(comparison.replay).toEqual({ kind: 'clean' });
  expect(comparison.files).toEqual([]);
  expect(packs(f.repo.folder)).toBe(before);
});

test('a stacked layer compares across its lower layers force push', async () => {
  // A stack: pull request #2 (`upper`) on #1 (`lower`), on `trunk`. The lower layer is amended and
  // force-pushed, and the upper layer rebased onto it, then given one more change:
  //
  //   m1 ── l1 ── u1            (lower, then upper, as first pushed)
  //    └─── l1' ── u2 ── u3     (lower amended; upper rebased onto it, then changed)
  const f = await fixture();
  const { remote } = f;
  const m1 = parseOid(remote.write('a.txt', text('a')).commit('m1'));
  remote.publish('refs/heads/trunk');
  const l1 = parseOid(
    remote.switch('lower').write('lower.txt', text('lower')).commit('lower layer'),
  );
  remote.publish('refs/heads/lower').publish('refs/pull/1/head');
  remote.switch('upper').write('upper.txt', text('upper')).commit('upper layer');
  const u1 = await push(f, 2, 'lower');
  remote.switch('lower').write('lower.txt', text('lower', { 2: 'lower line 2, amended' }));
  const amended = parseOid(remote.amend('lower layer, amended'));
  remote.publish('refs/heads/lower').publish('refs/pull/1/head');
  remote.switch('upper-2').write('upper.txt', text('upper')).commit('upper layer');
  const u2 = await push(f, 2, 'lower');
  // The lower layer's amendment shows in a plain comparison.
  expect(await plainPaths(f, u1, u2)).toEqual(['lower.txt']);

  const old = { base: l1, head: u1 };
  const rebasedOnly = await compared(f.repo, old, { base: amended, head: u2 });
  // The author changed nothing. An amended lower layer isn't a descendant of the old one, so the
  // comparison is flagged as one whose base moved sideways.
  expect(rebasedOnly.replay).toEqual({ kind: 'retargeted' });
  expect(rebasedOnly.files).toEqual([]);

  // The merge base of u1 with the lower branch as it is now is trunk's m1, since l1 is gone from
  // the branch. Replaying from there takes the lower layer for the author's change, and conflicts
  // with its amendment.
  expect(await f.repo.mergeBase(u1, amended)).toBe(m1);
  const fromTrunk = await compared(f.repo, { base: m1, head: u1 }, { base: amended, head: u2 });
  expect(fromTrunk.replay.kind).toBe('conflicted');
  expect(conflicted(fromTrunk.files)).toEqual(['lower.txt']);

  remote
    .write('upper.txt', text('upper', { 7: 'upper line 7, the change u3 adds' }))
    .commit('change upper.txt');
  const u3 = await push(f, 2, 'lower');
  const changed = await compared(f.repo, old, { base: amended, head: u3 });
  expect(changed.replay).toEqual({ kind: 'retargeted' });
  expect(paths(changed.files)).toEqual(['upper.txt']);
  expect(await read(f.repo, changed.old, 'upper.txt')).toBe(text('upper'));
  expect(await read(f.repo, changed.new, 'upper.txt')).toBe(
    text('upper', { 7: 'upper line 7, the change u3 adds' }),
  );
});

/**
 * A stack whose upper layer (#2) gets a fix after its lower layer (#1) was amended and
 * force-pushed, and is restacked onto the amended lower layer after that:
 *
 * ```text
 * m1 ── l1 ── u1 ── u1b     (lower, upper, then upper's fix, still on l1)
 *  └─── l1' ── u2           (lower amended; upper restacked onto it)
 * ```
 */
async function restacked() {
  const f = await fixture();
  const { remote } = f;
  remote.write('a.txt', text('a')).commit('m1');
  remote.publish('refs/heads/trunk');
  const l1 = parseOid(
    remote.switch('lower').write('lower.txt', text('lower')).commit('lower layer'),
  );
  remote.publish('refs/heads/lower');
  remote.switch('upper').write('upper.txt', text('upper')).commit('upper layer');
  const u1 = await push(f, 2, 'lower');
  remote.switch('lower').write('lower.txt', text('lower', { 2: 'lower line 2, amended' }));
  const amended = parseOid(remote.amend('lower layer, amended'));
  remote.publish('refs/heads/lower');
  const fixed = text('upper', { 9: 'upper line 9, fixed' });
  remote.switch('upper').write('upper.txt', fixed).commit('fix upper layer');
  const u1b = await push(f, 2, 'lower');
  remote.switch('lower').switch('upper-2').write('upper.txt', fixed).commit('upper layer, fixed');
  const u2 = await push(f, 2, 'lower');
  return { f, l1, amended, u1, u1b, u2 };
}

test('a base that isnt an ancestor of its head is an error', async () => {
  // A base the head doesn't contain would show the changes between the two as the author's, with
  // nothing to warn about.
  const { f, l1, amended, u1, u1b, u2 } = await restacked();
  const notAncestor = { kind: 'baseNotAncestor', base: amended, head: u1b };
  // The lower layer's head when u1b was pushed, which u1b doesn't contain.
  const asOld = await failure(
    compared(f.repo, { base: amended, head: u1b }, { base: amended, head: u2 }),
  );
  expect(asOld.detail).toEqual(notAncestor);
  const asNew = await failure(
    compared(f.repo, { base: l1, head: u1 }, { base: amended, head: u1b }),
  );
  expect(asNew.detail).toEqual(notAncestor);

  // The base branch's tip, as GitHub's `base.sha` gives it, after the base branch moved on.
  const r = await rebased();
  const tip = await failure(
    compared(r.f.repo, { base: r.m2, head: r.r1 }, { base: r.m2, head: r.r2 }),
  );
  expect(tip.detail).toEqual({ kind: 'baseNotAncestor', base: r.m2, head: r.r1 });
  expect(replayPins(r.f.repo)).toEqual([]);
});

test('a stacked layer starts at the newest lower head it contains', async () => {
  // A layer's base is the newest head of the layer below that its head contains: u1b's is still
  // l1, since it was pushed before the restack.
  const { f, l1, amended, u1, u1b, u2 } = await restacked();
  expect(await f.repo.isAncestor(l1, u1b)).toBe(true);
  expect(await f.repo.isAncestor(amended, u1b)).toBe(false);
  const fix = { base: l1, head: u1b };

  // The fix, and only the fix.
  const fixed = await compared(f.repo, { base: l1, head: u1 }, fix);
  expect(fixed.replay).toEqual({ kind: 'sameBase' });
  expect(paths(fixed.files)).toEqual(['upper.txt']);

  // The restack changed nothing of the author's. The amended lower layer isn't a descendant of
  // l1, so this is flagged.
  const restack = await compared(f.repo, fix, { base: amended, head: u2 });
  expect(restack.replay).toEqual({ kind: 'retargeted' });
  expect(restack.files).toEqual([]);
});

test('a retargeted base is flagged', async () => {
  // Pull request #1 branched from `develop`, which `main` doesn't have, and is retargeted to
  // `main`, with its head unchanged, then rebased onto it with one more change:
  //
  //   m1 ── d1 ── h1            (develop adds develop-only.txt; the PR changes a.txt)
  //    └─── h2                  (the PR on main, then c.txt changed too)
  //
  // Its patch now brings `develop-only.txt` too, which came with the base, not from the author.
  const f = await fixture();
  const { remote } = f;
  // The working copy's `trunk` is the server's `main`.
  const m1 = parseOid(remote.write('a.txt', text('a')).write('c.txt', text('c')).commit('m1'));
  remote.publish('refs/heads/main');
  const d1 = parseOid(remote.switch('develop').write('develop-only.txt', 'develop\n').commit('d1'));
  remote.publish('refs/heads/develop');
  remote
    .switch('feature')
    .write('a.txt', text('a', { 3: "a line 3, the PR's" }))
    .commit('h1');
  const h1 = await push(f, 1, 'develop');
  const onDevelop = { base: (await f.repo.mergeBase(h1, d1)) ?? d1, head: h1 };
  const onMain = { base: (await f.repo.mergeBase(h1, m1)) ?? m1, head: h1 };
  expect([onDevelop.base, onMain.base]).toEqual([d1, m1]);

  const retargeted = await compared(f.repo, onDevelop, onMain);

  expect(retargeted.replay).toEqual({ kind: 'retargeted' });
  expect(paths(retargeted.files)).toEqual(['develop-only.txt']);
  expect(changes(retargeted.files)[0]?.change).toEqual({ kind: 'added' });

  // The author rebases onto main and changes c.txt, which shows, still flagged.
  remote
    .switch('trunk')
    .switch('feature-2')
    .write('a.txt', text('a', { 3: "a line 3, the PR's" }))
    .write('c.txt', text('c', { 15: 'c line 15, the change h2 adds' }))
    .commit('h2');
  const h2 = await push(f, 1, 'main');
  const moved = await compared(f.repo, onDevelop, { base: m1, head: h2 });
  expect(moved.replay).toEqual({ kind: 'retargeted' });
  expect(paths(moved.files)).toEqual(['c.txt']);
});

test('a retargeted base that conflicts is flagged', async () => {
  // Retargeting can conflict too, and what the conflicted files' resolutions show then includes
  // what came with the base.
  const f = await fixture();
  const { remote } = f;
  const m1 = parseOid(remote.write('a.txt', text('a')).commit('m1'));
  remote.publish('refs/heads/main');
  const d1 = parseOid(
    remote
      .switch('develop')
      .write('a.txt', text('a', { 3: "a line 3, develop's" }))
      .commit('d1'),
  );
  remote.publish('refs/heads/develop');
  remote
    .switch('feature')
    .write('a.txt', text('a', { 3: "a line 3, develop's", 4: "a line 4, the PR's" }))
    .commit('h1');
  const h1 = await push(f, 1, 'develop');

  const comparison = await compared(f.repo, { base: d1, head: h1 }, { base: m1, head: h1 });

  expect(comparison.replay).toMatchObject({ kind: 'conflicted', retargeted: true });
  expect(conflicted(comparison.files)).toEqual(['a.txt']);
});

test('an unchanged head whose base moved on is flagged', async () => {
  // The lower layer of a stack gets a push the upper layer already has, so the upper layer's base
  // moves on while its head stays put: nothing changed, and nothing is the author's.
  const f = await fixture();
  const { remote } = f;
  remote.write('a.txt', text('a')).commit('m1');
  remote.publish('refs/heads/trunk');
  const l1 = parseOid(remote.switch('lower').write('lower.txt', text('lower')).commit('l1'));
  remote.publish('refs/heads/lower');
  const l2 = parseOid(
    remote.write('lower.txt', text('lower', { 4: "lower line 4, l2's" })).commit('l2'),
  );
  remote.switch('upper').write('upper.txt', text('upper')).commit('u1');
  const u1 = await push(f, 2, 'lower');
  // The lower layer's next push, then a fetch of the upper layer, whose head stays put.
  remote.switch('lower').publish('refs/heads/lower');
  remote.switch('upper');
  expect(await push(f, 2, 'lower')).toBe(u1);

  const comparison = await compared(f.repo, { base: l1, head: u1 }, { base: l2, head: u1 });

  expect(comparison.replay).toEqual({ kind: 'retargeted' });
  expect(comparison.files).toEqual([]);
});

test('renames across a rebase show only what the author renamed', async () => {
  const f = await fixture();
  const { remote } = f;
  const m1 = parseOid(remote.write('b.rs', source('b')).write('c.rs', source('c')).commit('m1'));
  remote.publish('refs/heads/trunk');
  // r1 renames b.rs and edits it.
  remote
    .switch('feature')
    .remove('b.rs')
    .write('src/bee.rs', source('b', { 3: 'pub fn b_3() -> u32 { 33 }' }))
    .commit('rename b.rs to src/bee.rs');
  const r1 = await push(f, 1, 'trunk');
  // Trunk edits b.rs elsewhere.
  const m2 = parseOid(
    remote
      .switch('trunk')
      .write('b.rs', source('b', { 16: 'pub fn b_16() -> u32 { 1616 }' }))
      .commit('m2'),
  );
  remote.publish('refs/heads/trunk');
  // r2 is r1 rebased, which carries trunk's edit into src/bee.rs, then renames c.rs and adds a
  // file.
  const both = { 3: 'pub fn b_3() -> u32 { 33 }', 16: 'pub fn b_16() -> u32 { 1616 }' };
  remote
    .switch('feature-2')
    .remove('b.rs')
    .write('src/bee.rs', source('b', both))
    .commit('rename b.rs to src/bee.rs');
  remote
    .remove('c.rs')
    .write('src/c.rs', source('c'))
    .write('extra.txt', 'extra\n')
    .commit('rename c.rs, add extra.txt');
  const r2 = await push(f, 1, 'trunk');
  expect(await plainPaths(f, r1, r2)).toEqual(['extra.txt', 'src/bee.rs', 'src/c.rs']);

  const comparison = await compared(f.repo, { base: m1, head: r1 }, { base: m2, head: r2 });

  expect(comparison.replay).toEqual({ kind: 'clean' });
  expect(paths(comparison.files)).toEqual(['extra.txt', 'src/c.rs']);
  const [extra, c] = changes(comparison.files);
  expect(extra?.change).toEqual({ kind: 'added' });
  expect(c?.change).toEqual({ kind: 'renamed', similarity: 100 });
  expect(c?.old && displayPath(c.old.path)).toBe('c.rs');
  // r1's rename, replayed: src/bee.rs with trunk's edit, and no b.rs.
  expect(await read(f.repo, comparison.old, 'b.rs')).toBeUndefined();
  expect(await read(f.repo, comparison.old, 'src/bee.rs')).toBe(source('b', both));
  // Finding the rename needed only what was worked out beforehand.
  expect(fellBack(f)).toBe(false);
});

test('a folder the base renamed takes the authors new file along', async () => {
  // The base renames a folder the old revision added a file to, and the rebased revision has the
  // file in the renamed folder, where a rebase puts it.
  const f = await fixture();
  const { remote } = f;
  for (const name of ['x', 'y', 'z']) remote.write(`lib/${name}.rs`, source(name));
  const m1 = parseOid(remote.commit('m1'));
  remote.publish('refs/heads/trunk');
  remote.switch('feature').write('lib/new.rs', source('new')).commit('add lib/new.rs');
  const r1 = await push(f, 1, 'trunk');
  remote.switch('trunk');
  for (const name of ['x', 'y', 'z'])
    remote.remove(`lib/${name}.rs`).write(`src/${name}.rs`, source(name));
  const m2 = parseOid(remote.commit('move lib to src'));
  remote.publish('refs/heads/trunk');
  remote.switch('feature-2').write('src/new.rs', source('new')).commit('add src/new.rs');
  const r2 = await push(f, 1, 'trunk');
  expect(await plainPaths(f, r1, r2)).toEqual(['src/new.rs', 'src/x.rs', 'src/y.rs', 'src/z.rs']);

  const comparison = await compared(f.repo, { base: m1, head: r1 }, { base: m2, head: r2 });

  expect(comparison.replay).toEqual({ kind: 'clean' });
  expect(comparison.files).toEqual([]);
  expect(await read(f.repo, comparison.old, 'lib/new.rs')).toBeUndefined();
  expect(await read(f.repo, comparison.old, 'src/new.rs')).toBe(source('new'));
});

test('a replayed tree is pinned once and stays pinned while the clone is open', async () => {
  const r = await rebased();
  const { f } = r;
  const [old, now] = sides(r);

  const comparison = await compared(f.repo, old, now);

  const pin = [comparison.old, `refs/lo/replays/${comparison.old}`];
  expect(replayPins(f.repo)).toEqual([pin]);
  // Comparing the same revisions again, here or through another repository open on the clone,
  // makes the same tree, which is pinned already.
  const again = await compared(f.repo, old, now);
  const other = await f.cache.open('owner', 'repo');
  const throughOther = await compared(other, old, now);
  expect([again.old, throughOther.old]).toEqual([comparison.old, comparison.old]);
  expect(replayPins(f.repo)).toEqual([pin]);
  // Closing the other leaves it: this one is open.
  other.close();
  expect(replayPins(f.repo)).toEqual([pin]);
  expect(paths(again.files)).toEqual(['c.txt']);
  expect(await read(f.repo, again.old, 'c.txt')).toBe(text('c'));

  // Nothing else of the replay is in a ref, and fetching still works.
  const refs = git(f.repo.folder, 'for-each-ref', '--format=%(refname)').split('\n');
  expect(refs.filter((name) => !/^refs\/lo\/(pull|replays)\//.test(name))).toEqual([]);
  f.remote.switch('feature-2').write('f.txt', 'f\n').commit('r3');
  await push(f, 1, 'trunk');
});

/** Whether `value` holds nothing but data: no function, and no object but arrays, buffers and plain ones. */
function plainData(value: unknown): boolean {
  if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value))
    return true;
  if (typeof value !== 'object') return false;
  if (Buffer.isBuffer(value)) return true;
  if (Array.isArray(value)) return value.every(plainData);
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype && Object.values(value).every(plainData);
}

test('a comparison keeps no repo or progress callback', async () => {
  // So a view that keeps one keeps neither the clone open nor the progress callback, which may
  // hold the view.
  const r = await rebased();
  const comparison = await compared(r.f.repo, ...sides(r));

  expect(plainData(comparison)).toBe(true);
  expect(comparison.replay).toEqual({ kind: 'clean' });
});

test('a comparison can go to another thread', async () => {
  // Or to the window: a structured clone of it is the same comparison.
  const r = await rebased();
  const comparison = await compared(r.f.repo, ...sides(r));

  const copied: Comparison = structuredClone(comparison);

  expect(paths(copied.files)).toEqual(['c.txt']);
  // A path comes as the bytes it is.
  expect(displayPath(copied.files[0]?.change?.old?.path ?? Buffer.alloc(0))).toBe('c.txt');
  expect({ ...copied, files: [] }).toEqual({ ...comparison, files: [] });
});

/**
 * Pull request #1 changes line 6 of a.txt, b.txt and c.txt; trunk then changes line 19 of each,
 * and the rebased r2 also changes line 12 of c.txt. Replaying r1 merges all three files.
 */
async function contentMerges(): Promise<{ f: Fixture; old: Revision; now: Revision }> {
  const f = await fixture();
  const { remote } = f;
  for (const name of ['a', 'b', 'c', 'untouched']) remote.write(`${name}.txt`, text(name));
  const m1 = parseOid(remote.commit('m1'));
  remote.publish('refs/heads/trunk');
  remote.switch('feature');
  for (const name of ['a', 'b', 'c'])
    remote.write(`${name}.txt`, text(name, { 6: "line 6, the PR's" }));
  remote.commit('change line 6');
  const r1 = await push(f, 1, 'trunk');
  remote.switch('trunk');
  for (const name of ['a', 'b', 'c'])
    remote.write(`${name}.txt`, text(name, { 19: "line 19, trunk's" }));
  const m2 = parseOid(remote.commit('m2'));
  remote.publish('refs/heads/trunk');
  remote.switch('feature-2');
  const merged = { 6: "line 6, the PR's", 19: "line 19, trunk's" };
  for (const name of ['a', 'b']) remote.write(`${name}.txt`, text(name, merged));
  remote.write('c.txt', text('c', { ...merged, 12: 'line 12, the change r2 adds' }));
  remote.commit('change line 6, after trunk, and line 12 of c.txt');
  const r2 = await push(f, 1, 'trunk');
  return { f, old: { base: m1, head: r1 }, now: { base: m2, head: r2 } };
}

/** Whether the clone at `gitDir` has `oid`, without downloading it. */
function hasObject(gitDir: string, oid: string): boolean {
  try {
    git(gitDir, '-c', 'remote.origin.url=file:///nowhere', 'cat-file', '-e', oid);
    return true;
  } catch {
    return false;
  }
}

test('a pinned replay survives repacking and pruning and an unpinned one doesnt', async () => {
  // A pin is a ref to a tree whose files are partly on the server, which repacking a partial
  // clone and fetching into it must take in stride. Without it, the files merged into the tree,
  // which exist only in the clone, go.
  const merged = { 6: "line 6, the PR's", 19: "line 19, trunk's" };
  for (const pinned of [true, false]) {
    const { f, old, now } = await contentMerges();
    const comparison = await compared(f.repo, old, now);
    // The merged c.txt, without r2's change to line 12, was made here and is nowhere else.
    const replayedC = git(f.repo.folder, 'rev-parse', `${comparison.old}:c.txt`);
    expect(f.remote.has(replayedC)).toBe(false);
    if (!pinned) {
      for (const [, name] of replayPins(f.repo)) git(f.repo.folder, 'update-ref', '-d', name);
    }

    // A fetch, with a tree pinned among the refs.
    f.remote.switch('trunk').write('f.txt', 'f\n').commit('m3');
    f.remote.publish('refs/heads/trunk');
    f.remote.switch('feature-2');
    await push(f, 1, 'trunk');
    const moved = `${f.remote.gitDir}.moved`;
    renameSync(f.remote.gitDir, moved);
    // What drops what no ref reaches, with the server gone.
    git(f.repo.folder, 'repack', '-a', '-d', '-q', '--no-write-bitmap-index');
    git(f.repo.folder, 'prune', '--expire=now');

    expect.soft([pinned, hasObject(f.repo.folder, replayedC)]).toEqual([pinned, pinned]);
    expect.soft([pinned, hasObject(f.repo.folder, comparison.old)]).toEqual([pinned, pinned]);
    if (!pinned) continue;
    expect(await read(f.repo, comparison.old, 'a.txt')).toBe(text('a', merged));
    expect(await read(f.repo, comparison.old, 'c.txt')).toBe(text('c', merged));
    // What was never downloaded still downloads.
    renameSync(moved, f.remote.gitDir);
    expect(await read(f.repo, comparison.old, 'untouched.txt')).toBe(text('untouched'));
  }
});

test('replaying downloads only what it merges and shows in batches', async () => {
  // Each path changed on one side only: the replay needs no file contents, and the comparison
  // downloads both sides of c.txt at once.
  const r = await rebased();
  const before = packs(r.f.repo.folder);
  const comparison = await compared(r.f.repo, ...sides(r));
  expect(paths(comparison.files)).toEqual(['c.txt']);
  expect(packs(r.f.repo.folder) - before).toBe(1);
  const missing = missingObjects(r.f.repo.folder, r.r2);
  for (const path of ['a.txt', 'b.txt', 'd.txt', 'e.txt', 'untouched.txt']) {
    expect.soft(missing).toContain(blobId(r.f.remote.work, r.r2, path));
  }

  // Three files changed on both sides: one download for the three merges, and one for the
  // comparison.
  const { f, old, now } = await contentMerges();
  const start = packs(f.repo.folder);
  const merged = await compared(f.repo, old, now);
  expect(paths(merged.files)).toEqual(['c.txt']);
  expect(packs(f.repo.folder) - start).toBe(2);
  expect(missingObjects(f.repo.folder, now.head)).toContain(
    blobId(f.remote.work, now.head, 'untouched.txt'),
  );
  // Everything is here now, so comparing again downloads nothing.
  const again = await compared(f.repo, old, now);
  expect(again.old).toBe(merged.old);
  expect(packs(f.repo.folder) - start).toBe(2);
  // What the merges needed was worked out beforehand.
  expect(fellBack(f)).toBe(false);
});

test('a replay that cant download is a fetch error', async () => {
  const { f, old, now } = await contentMerges();
  const moved = `${f.remote.gitDir}.moved`;
  renameSync(f.remote.gitDir, moved);

  const error = await failure(compared(f.repo, old, now));

  expect(error.detail).toMatchObject({ kind: 'fetch', failure: 'repoNotFound' });
  expect(replayPins(f.repo)).toEqual([]);
  renameSync(moved, f.remote.gitDir);
  const comparison = await compared(f.repo, old, now);
  expect(paths(comparison.files)).toEqual(['c.txt']);
});

test('a comparison whose downloads would bring more than it may is refused', async () => {
  // a.txt is 180 KB of noise, which pull request #1 changes at line 3 and trunk at line 18, so the
  // replay downloads three versions of it, at most 300 KB; the rebased revision adds 550 KB more,
  // which the comparison downloads. Each download fits in 600 KB, but not both.
  const f = await fixture();
  const noise = Array.from({ length: 20 }, () => randomBytes(4500).toString('hex'));
  const edited = (edits: Record<number, string>) =>
    noise.map((line, index) => `${edits[index + 1] ?? line}\n`).join('');
  f.remote.write('a.txt', edited({})).commit('m1');
  f.remote.publish('refs/heads/trunk');
  f.remote
    .switch('feature')
    .write('a.txt', edited({ 3: "the PR's" }))
    .commit('r1');
  const old = await pushRevision(f, 1, 'trunk');
  f.remote
    .switch('trunk')
    .write('a.txt', edited({ 18: "trunk's" }))
    .commit('m2');
  f.remote.publish('refs/heads/trunk');
  f.remote
    .switch('feature-2')
    .write('a.txt', edited({ 3: "the PR's", 18: "trunk's" }))
    .write('b.bin', randomBytes(550 * 1024))
    .commit('r2');
  const now = await pushRevision(f, 1, 'trunk');
  const limit = 600 * 1024;

  expect(await f.repo.compareRevisions(old, now, { maxBytes: limit })).toEqual({
    refused: 'tooLarge',
    limit,
  });
  expect(f.logged.some((line) => line.endsWith('of files, so Lo refused it'))).toBe(true);

  // With room for both, it's compared.
  const comparison = await compared(f.repo, old, now, { maxBytes: 2 * limit });
  expect(paths(comparison.files)).toEqual(['b.bin']);
});

test('an aborted comparison stops waiting for the clone', async () => {
  const { f, old, now } = await contentMerges();
  const activities: Activity[] = [];
  const repo = await f.cache.open('owner', 'repo', {
    progress: (activity) => activities.push(activity),
  });
  const release = await f.cache.cloneLock('owner', 'repo').acquire('fetching pull request #2');
  const controller = new AbortController();
  const reason = new Error('the comparison was closed');
  const comparing = repo.compareRevisions(old, now, { signal: controller.signal });
  await eventually(() => activities.some((activity) => activity.kind === 'waitingForLock'));

  controller.abort(reason);

  await expect(comparing).rejects.toBe(reason);
  release();
  // It left the queue, so the next comparison isn't kept waiting for it.
  expect(paths((await compared(repo, old, now)).files)).toEqual(['c.txt']);
  repo.close();
});

test('a commit the clone lacks is an error and never downloaded', async () => {
  // A commit GitHub has but the clone never fetched, as when Lo learns of a revision from the
  // timeline. git would download it, with its history, behind the caller's back.
  const r = await rebased();
  const { f } = r;
  const unfetched = parseOid(
    f.remote.switch('elsewhere').write('x.txt', 'x\n').commit('on the server only'),
  );
  f.remote.publish('refs/heads/elsewhere');
  const unknown = parseOid('3'.repeat(40));
  const [old, now] = sides(r);
  const before = packs(f.repo.folder);

  for (const missing of [unfetched, unknown]) {
    for (const [o, n] of [
      [{ ...old, base: missing }, now],
      [{ ...old, head: missing }, now],
      [old, { ...now, base: missing }],
      [old, { ...now, head: missing }],
    ] as const) {
      const error = await failure(compared(f.repo, o, n));
      expect.soft(error.detail).toEqual({ kind: 'notFetched', oid: missing });
    }
  }

  expect(packs(f.repo.folder)).toBe(before);
  expect(replayPins(f.repo)).toEqual([]);
});

test('pins go once the clone is opened with no lo having it open', async () => {
  // Pins outlive the process that made them: a Lo that quits runs no destructors, and one that
  // crashes can't. Opening the clone with none of its repositories open removes them all.
  const r = await rebased();
  const { f } = r;
  const comparison = await compared(f.repo, ...sides(r));
  const tree = comparison.old;
  // What an earlier run of Lo, which showed another comparison, left when it quit.
  const left = git(f.repo.folder, 'rev-parse', `${r.m1}^{tree}`);
  git(f.repo.folder, 'update-ref', `refs/lo/replays/${left}`, left);
  const pins = [
    [tree, `refs/lo/replays/${tree}`],
    [left, `refs/lo/replays/${left}`],
  ].toSorted((a, b) => (a[1] ?? '').localeCompare(b[1] ?? ''));
  expect(replayPins(f.repo)).toEqual(pins);

  // Another window opening the clone leaves them, since this one might be showing them.
  const other = await f.cache.open('owner', 'repo');
  expect(replayPins(f.repo)).toEqual(pins);
  other.close();

  // Once no repository has the clone open, even while a comparison is kept, opening it removes
  // them, and a comparison made then pins its tree again.
  f.repo.close();
  const reopened = await f.cache.open('owner', 'repo');
  expect(replayPins(reopened)).toEqual([]);
  expect((await compared(reopened, ...sides(r))).old).toBe(tree);
  expect(replayPins(reopened)).toEqual([[tree, `refs/lo/replays/${tree}`]]);
});

test('tells whether a tree is here without downloading it', async () => {
  const f = await fixture();
  const { remote } = f;
  const fetched = parseOid(remote.write('a.txt', 'a.txt\n').commit('a'));
  remote.publish('refs/heads/a');
  const unfetched = git(
    remote.work,
    'rev-parse',
    `${remote.write('b.txt', 'b.txt\n').commit('b')}^{tree}`,
  );
  remote.publish('refs/heads/b');
  await f.repo.fetchCommit(fetched);
  const before = packs(f.repo.folder);

  expect(await f.repo.hasTree(parseOid(git(remote.work, 'rev-parse', `${fetched}^{tree}`)))).toBe(
    true,
  );
  expect(await f.repo.hasTree(parseOid(unfetched))).toBe(false);
  expect(await f.repo.hasTree(parseOid('3'.repeat(40)))).toBe(false);
  expect(packs(f.repo.folder)).toBe(before);
});
