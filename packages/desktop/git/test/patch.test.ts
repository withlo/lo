// A file's patch from the clone, for the lines GitHub takes comments on when its API leaves the
// patch out, or for a revision that isn't the latest.

import { parsePatch } from '@lo/github';
import { cassette } from '@lo/testing';
import {
  blobId,
  git,
  missingObjects,
  packs,
  type RemoteRepo,
  sourceLines,
  writeTree,
  type Tree,
} from '@lo/testing/git';
import { expect, test } from 'vitest';

import { GitError } from '../src/errors.ts';
import { type Oid, parseOid } from '../src/oid.ts';
import { type FilePatch, MAX_PATCH_LINES } from '../src/patch.ts';
import { PATCH_LIMIT, type Repo } from '../src/repo.ts';
import { cacheFor, repoServer } from './support.ts';

/** The commits a submodule points at. Neither is on the server, so fetching either fails. */
const SUBMODULE_BEFORE = '1111111111111111111111111111111111111111';
const SUBMODULE_AFTER = '2222222222222222222222222222222222222222';

/** Twenty lines, `line 1` to `line 20`, with `edits` in place of some. */
function twentyLines(edits: Record<number, string> = {}): string {
  let text = '';
  for (let number = 1; number <= 20; number++) text += `${edits[number] ?? `line ${number}`}\n`;
  return text;
}

/**
 * Two versions of a file whose first hunk git's Myers diff and its histogram diff draw differently:
 * Myers' starts a line later.
 */
const ALGORITHM_BEFORE =
  'return;\nline 1\nreturn;\n{\n{\nline 5\nline 6\n\nreturn;\nline 9\nline 10\nline 11\n{\n' +
  'line 13\nline 14\n\nreturn;\nline 17\n}\nline 19\nline 20\nline 21\n\n\n\nline 25\n}\n\n}\n\n';
const ALGORITHM_AFTER =
  'return;\nreturn;\n{\nline 1\nchanged 4\n{\n{\nline 5\nline 6\n\nreturn;\nline 9\nline 10\n' +
  'line 11\n{\nline 13\nline 14\n\nreturn;\n}\nline 19\nline 20\nline 21\n\n\n\nline 25\n}\n\n}\n\n';

/**
 * A pull request's base and head, fetched into a clone whose own config asks for every diff
 * setting a patch must not follow, with both sides of each changed file downloaded unless
 * `download` is false.
 */
interface Fixture {
  repo: Repo;
  remote: RemoteRepo;
  base: Oid;
  head: Oid;
}

async function fixture(options: { download?: boolean } = {}): Promise<Fixture> {
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  remote
    .write('lines.txt', twentyLines())
    .write('algorithm.txt', ALGORITHM_BEFORE)
    .write('blank.txt', 'a\n\nb\nc\n')
    .write('old_name.rs', sourceLines(''))
    .write('gone.txt', 'gone\n')
    .write('same.txt', 'same\n')
    .write('data.bin', Buffer.from('\x00\x01\x02base', 'latin1'))
    .gitlink('vendor/lib', SUBMODULE_BEFORE);
  const base = parseOid(remote.commit('base'));
  remote.publish('refs/heads/trunk');

  remote
    .switch('feature')
    .write('lines.txt', twentyLines({ 5: 'line five', 15: 'line fifteen' }))
    .write('algorithm.txt', ALGORITHM_AFTER)
    .write('blank.txt', 'a\n\nb\nC\n')
    .remove('old_name.rs')
    .write('src/new_name.rs', sourceLines('pub fn added() {}\n'))
    .remove('gone.txt')
    .write('added.txt', 'one\ntwo\n')
    .write('data.bin', Buffer.from('\x00\x01\x02head', 'latin1'))
    .gitlink('vendor/lib', SUBMODULE_AFTER);
  const head = parseOid(remote.commit('head'));
  remote.publish('refs/pull/1/head');

  const repo = await (await cacheFor(server)).open('owner', 'repo');
  await repo.fetchPull({ number: 1, head, baseBranch: 'trunk' });
  // What a clone's config could ask for, none of which GitHub's patches do. An external diff that
  // fails would fail every patch.
  for (const [name, value] of [
    ['diff.algorithm', 'histogram'],
    ['diff.context', '10'],
    ['diff.interHunkContext', '10'],
    ['diff.indentHeuristic', 'false'],
    ['diff.noprefix', 'true'],
    ['diff.mnemonicPrefix', 'true'],
    ['diff.suppressBlankEmpty', 'true'],
    ['diff.submodule', 'log'],
    ['diff.renames', 'copies'],
    ['diff.external', 'false'],
    ['color.ui', 'always'],
    ['color.diff', 'always'],
  ] as const) {
    git(repo.folder, 'config', name, value);
  }
  const lacking =
    options.download === false ? [] : await repo.download(await repo.changedObjects(base, head));
  if (lacking.length > 0) throw new Error(`${lacking.length} files didn't download`);
  return { repo, remote, base, head };
}

/** The hunks of the patch of `path`, renamed from `oldPath`, as text; `binary` for a binary file. */
async function patch(f: Fixture, path: string, oldPath?: string): Promise<string> {
  const patched = await f.repo.patch(
    f.base,
    f.head,
    Buffer.from(path),
    oldPath === undefined ? undefined : Buffer.from(oldPath),
  );
  return hunks(patched);
}

function hunks(patched: FilePatch): string {
  return patched.binary ? 'binary' : patched.hunks.toString('utf8');
}

function headers(text: string): string[] {
  return text.split('\n').filter((line) => line.startsWith('@@'));
}

/** Lines `line <from>` to `line <to>`, unchanged. */
function context(from: number, to: number): string {
  let lines = '';
  for (let number = from; number <= to; number++) lines += ` line ${number}\n`;
  return lines;
}

test('a patch has three lines of context and a hunk for each change', async () => {
  const f = await fixture();

  const text = await patch(f, 'lines.txt');

  expect(text).toBe(
    `@@ -2,7 +2,7 @@ line 1\n${context(2, 4)}-line 5\n+line five\n${context(6, 8)}` +
      `@@ -12,7 +12,7 @@ line 11\n${context(12, 14)}-line 15\n+line fifteen\n${context(16, 18)}`,
  );
  // Its hunks say which lines take comments, as GitHub's patch would: those they cover.
  const parsed = parsePatch(text);
  const covers = (side: 'old' | 'new', line: number) =>
    parsed.hunks.some((hunk) => hunk[side].start < line && line <= hunk[side].end);
  for (const [side, line] of [
    ['new', 2],
    ['new', 5],
    ['old', 5],
    ['new', 18],
  ] as const) {
    expect.soft([side, line, covers(side, line)]).toEqual([side, line, true]);
  }
  for (const line of [1, 10, 19]) expect.soft([line, covers('new', line)]).toEqual([line, false]);
});

test('a patch is myers whatever the clone says', async () => {
  const f = await fixture();

  expect(headers(await patch(f, 'algorithm.txt'))).toEqual([
    '@@ -1,7 +1,9 @@',
    '@@ -15,7 +17,6 @@ line 13',
  ]);
  // Histogram's, for the same two files, which the clone's config asks for.
  const histogram = git(
    f.repo.folder,
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--diff-algorithm=histogram',
    '--inter-hunk-context=0',
    '-U3',
    f.base,
    f.head,
    '--',
    'algorithm.txt',
  );
  expect(headers(histogram)).toEqual(['@@ -1,6 +1,8 @@', '@@ -15,7 +17,6 @@ line 13']);
});

test('a blank unchanged line keeps its space', async () => {
  const f = await fixture();
  expect(await patch(f, 'blank.txt')).toBe('@@ -1,4 +1,4 @@\n a\n \n b\n-c\n+C\n');
});

test('an added or deleted file is diffed against nothing', async () => {
  const f = await fixture();
  expect(await patch(f, 'added.txt')).toBe('@@ -0,0 +1,2 @@\n+one\n+two\n');
  expect(await patch(f, 'gone.txt')).toBe('@@ -1 +0,0 @@\n-gone\n');
});

test('a renamed file is diffed against its old path', async () => {
  const f = await fixture();
  expect(await patch(f, 'src/new_name.rs', 'old_name.rs')).toBe(
    '@@ -18,3 +18,4 @@ pub fn function_16() -> u32 { 16 }\n' +
      ' pub fn function_17() -> u32 { 17 }\n' +
      ' pub fn function_18() -> u32 { 18 }\n' +
      ' pub fn function_19() -> u32 { 19 }\n' +
      '+pub fn added() {}\n',
  );
  // Without its old path, it's a file added; with an old path the base doesn't have, too.
  const added = '@@ -0,0 +1,21 @@\n';
  expect((await patch(f, 'src/new_name.rs')).startsWith(added)).toBe(true);
  expect((await patch(f, 'src/new_name.rs', 'not_there.rs')).startsWith(added)).toBe(true);
});

test('binary files and submodules have no lines but their own', async () => {
  const f = await fixture();
  expect(await patch(f, 'data.bin')).toBe('binary');
  // A submodule's commits, as GitHub shows them, without fetching either.
  expect(await patch(f, 'vendor/lib')).toBe(
    `@@ -1 +1 @@\n-Subproject commit ${SUBMODULE_BEFORE}\n+Subproject commit ${SUBMODULE_AFTER}\n`,
  );
});

test('an unchanged or missing file has an empty patch', async () => {
  const f = await fixture();
  expect(await patch(f, 'same.txt')).toBe('');
  expect(await patch(f, 'nowhere.txt')).toBe('');
  await expect(f.repo.patch(f.base, f.head, Buffer.alloc(0))).rejects.toThrow(GitError);
});

test('a patch downloads only its files two versions', async () => {
  const f = await fixture({ download: false });
  const lines = Buffer.from('lines.txt');
  const sides = [
    blobId(f.remote.work, f.base, 'lines.txt'),
    blobId(f.remote.work, f.head, 'lines.txt'),
  ];
  const before = packs(f.repo.folder);
  // The patch reads them, and never downloads them itself.
  const error: unknown = await f.repo
    .patch(f.base, f.head, lines)
    .catch((caught: unknown) => caught);
  expect(error instanceof GitError && error.detail).toEqual({ kind: 'notDownloaded', oids: sides });
  expect(packs(f.repo.folder)).toBe(before);

  // One download, for the two blobs.
  expect(await f.repo.download(sides.map(parseOid))).toEqual([]);
  expect(packs(f.repo.folder)).toBe(before + 1);
  expect(hunks(await f.repo.patch(f.base, f.head, lines))).toMatch(/^@@ -2,7 \+2,7 @@/);
  expect(hunks(await f.repo.patch(f.base, f.head, lines))).toMatch(/^@@ -2,7 \+2,7 @@/);
  expect(packs(f.repo.folder)).toBe(before + 1);
  // The other files stay on the server.
  expect(missingObjects(f.repo.folder, f.head)).toContain(
    blobId(f.remote.work, f.head, 'blank.txt'),
  );
});

/** A file of the `rozed-dev/e2e` pull request whose files a recorded answer lists. */
interface GitHubFile {
  filename: string;
  sha: string;
  previous_filename?: string;
  patch: string;
}

function isGitHubFile(value: unknown): value is GitHubFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'filename' in value &&
    typeof value.filename === 'string' &&
    'sha' in value &&
    typeof value.sha === 'string' &&
    'patch' in value &&
    typeof value.patch === 'string'
  );
}

/** The files of the pull request GitHub listed in the `answer`th answer of `rest_pull_files_e2e`. */
function githubFiles(answer: number): GitHubFile[] {
  const recorded = cassette('rest_pull_files_e2e').interactions[answer - 1];
  const body = recorded?.interaction.response.body;
  if (!Array.isArray(body)) throw new Error(`no answer ${answer}`);
  const files: GitHubFile[] = [];
  for (const file of body) if (isGitHubFile(file)) files.push(file);
  return files;
}

/**
 * Compares each patch with GitHub's, for each file of the `rozed-dev/e2e` pull request that the
 * cassette's `answer`th answer lists and `tree` writes both sides of. Returns the files whose
 * patches differ, or that changed since: none.
 */
async function differences(tree: Tree, answer: number): Promise<object[]> {
  const server = repoServer();
  const remote = server.repo('rozed-dev', 'e2e');
  writeTree(tree, 'base', remote.work);
  const base = parseOid(remote.commit('base'));
  remote.publish('refs/heads/main');
  writeTree(tree, 'head', remote.work);
  const head = parseOid(remote.commit('head'));
  remote.publish('refs/pull/1/head');
  const repo = await (await cacheFor(server)).open('rozed-dev', 'e2e');
  await repo.fetchPull({ number: 1, head, baseBranch: 'main' });
  await repo.download(await repo.changedObjects(base, head));

  const files = githubFiles(answer);
  if (files.length === 0) return [{ answer, files: 'none' }];
  const different: object[] = [];
  for (const file of files) {
    // The tree is the one that was pushed.
    const blob = blobId(remote.work, head, file.filename);
    if (blob !== file.sha) different.push({ file: file.filename, blob, github: file.sha });
    const ours = await repo.patch(
      base,
      head,
      Buffer.from(file.filename),
      file.previous_filename === undefined ? undefined : Buffer.from(file.previous_filename),
    );
    // GitHub's patch is the hunks, without the last line's line break.
    const github = `${file.patch}\n`;
    if (hunks(ours) !== github) different.push({ file: file.filename, ours: hunks(ours), github });
  }
  return different;
}

test('patches match githubs for e6s code', async () => {
  expect(await differences('e6_tree', 1)).toEqual([]);
});

test('patches match githubs for e9s moves and large file', async () => {
  expect(await differences('e9_tree', 2)).toEqual([]);
});

test('patches match githubs for e12s languages', async () => {
  expect(await differences('e12_tree', 3)).toEqual([]);
});

test('a huge file is refused and one of many lines is written in one piece', async () => {
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  const base = parseOid(remote.write('README', 'readme\n').commit('base'));
  remote.publish('refs/heads/trunk');
  // Any author can push a file like these, and GitHub leaves their patches out.
  const huge = Buffer.alloc(20 * 1024 * 1024, '\n');
  const many = Buffer.from('x\n'.repeat(400_000));
  remote.switch('feature').write('huge.txt', huge).write('many.txt', many);
  const head = parseOid(remote.commit('head'));
  remote.publish('refs/pull/1/head');
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  await repo.fetchPull({ number: 1, head, baseBranch: 'trunk' });
  expect(await repo.download(await repo.changedObjects(base, head))).toEqual([]);
  const patchOf = (path: string, maxBytes?: number) =>
    repo.patch(base, head, Buffer.from(path), undefined, { maxBytes });
  const refusal = async (path: string, maxBytes?: number) => {
    const error: unknown = await patchOf(path, maxBytes).catch((caught: unknown) => caught);
    return error instanceof GitError ? error.detail : error;
  };

  // Past the cap on bytes, it's never read; past the cap on lines, it's never written.
  expect(await refusal('huge.txt')).toEqual({
    kind: 'tooLarge',
    command: 'git diff',
    limit: PATCH_LIMIT,
    unit: undefined,
  });
  expect(await refusal('huge.txt', 32 * 1024 * 1024)).toEqual({
    kind: 'tooLarge',
    command: 'git diff',
    limit: MAX_PATCH_LINES,
    unit: 'lines',
  });

  // 400,000 lines, in one buffer a third larger than the file, and no object for each line.
  const heap = process.memoryUsage().heapUsed;
  const written = await patchOf('many.txt');
  expect(process.memoryUsage().heapUsed - heap).toBeLessThan(16 * 1024 * 1024);
  if (written.binary) throw new Error('not binary');
  const header = '@@ -0,0 +1,400000 @@\n';
  expect(written.hunks.length).toBe(header.length + many.length * 1.5);
  expect(written.hunks.subarray(0, header.length + 6).toString('utf8')).toBe(`${header}+x\n+x\n`);
});
