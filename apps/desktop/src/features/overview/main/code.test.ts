// Main's reader of an overview's code: the pull request's local copy at the commit its header
// names, read as the overview's checks read code. A commit GitHub doesn't have, or a header naming
// something else, links, submodules and folders answer as the checks' readers do; every path is
// looked up in one walk of the commit's trees, however large; a file past what the checks read is
// judged by its size and never read; downloads are stopped past what one file the checks read
// brings, and past what's left for one overview; git reads no more than its limit for one
// overview; and a read stops once it's asked for again.

import { BINARY_WINDOW, LIMITS } from '@lo/artifact';
import { GitError, parseOid, type Oid, type Repo } from '@lo/git';
import { git, gitBytes, RepoServer } from '@lo/testing/git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CodeAnswer, CodeReply } from '../contract.ts';
import { testClone } from '../test/clone.ts';
import { memoryClone } from '../test/memory.ts';
import {
  codeReply,
  CodeReads,
  DOWNLOAD_LIMIT,
  PROBE,
  readCode,
  STREAM_LIMIT,
  type CodeClone,
} from './code.ts';

const encoder = new TextEncoder();
const text = (value: string) => encoder.encode(value);

/** A file that isn't text: a NUL soon after its start, and more after its first 8 KiB. */
const BINARY = new Uint8Array(BINARY_WINDOW * 3).fill(0x61);
BINARY[10] = 0;

/** A file one byte past what the checks read of a file, of one line repeated. */
const HUGE = new Uint8Array(LIMITS.file + 1).fill(0x78);
HUGE[HUGE.length - 1] = 0x0a;

let server: RepoServer;
/** The commit the overview names, on the server. */
let commit: string;
/** A commit the server never had. */
let lost: string;
/** An annotated tag of `commit`, on the server. */
let tag: string;
/** `commit`'s tree, and a file in it: objects on the server that aren't commits. */
let tree: string;
let blob: string;
/** A commit of one folder, `big/`, of `BIG` files, each named in the tree once. */
let big: string;

/** How many files `big/` holds: a tree of megabytes, as anyone may push. */
const BIG = 200_000;

beforeAll(() => {
  server = new RepoServer();
  const remote = server.repo('o', 'r');
  remote
    .write('src/a.ts', 'one\ntwo\nthree\n')
    .write('src/empty.ts', '')
    .write('bin/data.bin', BINARY)
    .write('big/huge.txt', HUGE)
    .write('docs/readme.md', 'Read me.\n')
    .symlink('links/a', '../src/a.ts')
    .symlink('links/src', '../src')
    .gitlink('vendor/lib', '1'.repeat(40));
  commit = remote.commit('The code an overview names.');
  git(remote.work, 'tag', '-a', 'v1', '-m', 'A tag', commit);
  tag = git(remote.work, 'rev-parse', 'v1');
  remote.publish('refs/heads/trunk');
  git(remote.gitDir, 'fetch', '-q', remote.work, 'refs/tags/v1:refs/tags/v1');
  tree = git(remote.work, 'rev-parse', `${commit}^{tree}`);
  blob = git(remote.work, 'rev-parse', `${commit}:src/a.ts`);
  remote.write('src/a.ts', 'lost\n');
  lost = remote.commit('Never pushed.');

  // One file's contents under every name, written straight into the server's repository.
  const contents = gitBytes(remote.gitDir, ['hash-object', '-w', '--stdin'], 'big\n')
    .toString('utf8')
    .trim();
  const listing = Array.from({ length: BIG }, (_, n) => `100644 blob ${contents}\tf${n}.ts\n`);
  const folder = gitBytes(remote.gitDir, ['mktree'], listing.join('')).toString('utf8').trim();
  const root = gitBytes(remote.gitDir, ['mktree'], `040000 tree ${folder}\tbig\n`)
    .toString('utf8')
    .trim();
  big = git(remote.gitDir, 'commit-tree', root, '-m', 'A large folder.');
}, 120_000);

afterAll(() => server.remove());

/** The pull request's local copy, with nothing fetched into it yet. */
const fresh = () => testClone(server.baseUrl, 'o', 'r');

/** `repo`, counting what's read of it, looked up in it and downloaded into it. */
function watched(repo: CodeClone) {
  const reads: Oid[] = [];
  const lookups: number[] = [];
  const downloads: { oids: readonly Oid[]; maxBytes: number | undefined }[] = [];
  const clone: CodeClone = {
    get offline() {
      return repo.offline;
    },
    hasCommit: (oid) => repo.hasCommit(oid),
    fetchCommit: (oid) => repo.fetchCommit(oid),
    missingObjects: (oids) => repo.missingObjects(oids),
    fileVersions(rev, paths) {
      lookups.push(paths.length);
      return repo.fileVersions(rev, paths);
    },
    objectSizes: (oids) => repo.objectSizes(oids),
    download(oids, what, options) {
      downloads.push({ oids, maxBytes: options?.maxBytes });
      return repo.download(oids, what, options);
    },
    readBlob(oid, options) {
      reads.push(oid);
      return repo.readBlob(oid, options);
    },
  };
  return { clone, reads, lookups, downloads };
}

const file = (size: number | null, bytes: Uint8Array | string = new Uint8Array()) => ({
  kind: 'file' as const,
  size,
  bytes: typeof bytes === 'string' ? text(bytes) : bytes,
});

describe('readCode', () => {
  it('answers each file as the checks read it, fetching the commit it lacks', async () => {
    const repo = await fresh();
    const answers = await readCode(repo, commit, [
      { path: 'src/a.ts', lines: true },
      { path: 'src/empty.ts', lines: true },
      { path: 'bin/data.bin', lines: true },
      { path: 'nowhere.ts', lines: true },
      { path: 'docs/readme.md', lines: false },
      // Asked for again: read once, by its first place, its lines named.
      { path: 'src/a.ts', lines: false },
    ]);
    expect(answers).toEqual([
      file(14, 'one\ntwo\nthree\n'),
      file(0),
      // The start alone: it isn't text, so the checks read no more.
      file(BINARY.length, BINARY.subarray(0, BINARY_WINDOW)),
      { kind: 'missing' },
      // Named whole, it's only looked for, and never downloaded.
      file(null),
      file(14, 'one\ntwo\nthree\n'),
    ]);
    expect(await repo.hasCommit(parseOid(commit))).toBe(true);
    const readme = await repo.fileVersion(parseOid(commit), text('docs/readme.md'));
    expect(readme?.size).toBe(undefined);
  });

  it('answers links, submodules and folders as they are, never following a link', async () => {
    const answers = await readCode(
      await fresh(),
      commit,
      ['links/a', 'links/src/a.ts', 'vendor/lib', 'vendor/lib/x.ts', 'src', 'src/a.ts/x'].map(
        (path) => ({ path, lines: true }),
      ),
    );
    expect(answers).toEqual([
      { kind: 'notFile', is: 'link' },
      { kind: 'missing' },
      { kind: 'notFile', is: 'submodule' },
      { kind: 'missing' },
      { kind: 'notFile', is: 'folder' },
      { kind: 'missing' },
    ]);
  });

  it('answers noCommit for every file at a commit GitHub doesn’t have, or that isn’t one', async () => {
    const repo = await fresh();
    const files = [
      { path: 'src/a.ts', lines: true },
      { path: 'docs/readme.md', lines: false },
    ];
    const none = [{ kind: 'noCommit' }, { kind: 'noCommit' }];
    expect(await readCode(repo, lost, files)).toEqual(none);
    // A tag names a commit, but isn't the commit an overview names; nor is a tree or a file.
    expect(await readCode(repo, tag, files)).toEqual(none);
    expect(await readCode(repo, tree, files)).toEqual(none);
    expect(await readCode(repo, blob, files)).toEqual(none);
    // Asked again, with each already in the copy.
    expect(await readCode(repo, tree, files)).toEqual(none);
    expect(await readCode(repo, blob, files)).toEqual(none);
  });

  it('looks every path up in one walk of a large tree, reading it once', async () => {
    const { clone, lookups } = watched(await fresh());
    const files = Array.from({ length: 500 }, (_, n) => ({
      path: `big/f${n * 397}.ts`,
      lines: false,
    }));
    const started = performance.now();
    const answers = await readCode(clone, big, files);
    // Reading the tree once a path takes minutes; once, well under a second.
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(lookups).toEqual([500]);
    expect(answers.every((answer) => answer.kind === 'file')).toBe(true);
  }, 60_000);

  it('judges a file past what the checks read by its size, never reading it', async () => {
    const { clone: repo, reads, downloads } = watched(await fresh());
    const huge = [{ path: 'big/huge.txt', lines: true }];
    // Its size is known once its contents are downloaded, which compress well.
    expect(await readCode(repo, commit, huge)).toEqual([file(HUGE.length)]);
    expect(downloads).toHaveLength(1);
    // Then the copy has it, and says its size first.
    expect(await readCode(repo, commit, huge)).toEqual([file(HUGE.length)]);
    expect(downloads).toHaveLength(1);
    expect(reads).toEqual([]);
  });

  it('downloads what the copy lacks all at once, stopped past what one file brings', async () => {
    const real = await fresh();
    const { clone: repo, downloads } = watched(real);
    // The copy has one file the overview names by its lines already.
    await readCode(repo, commit, [{ path: 'bin/data.bin', lines: true }]);
    downloads.length = 0;
    await readCode(repo, commit, [
      { path: 'bin/data.bin', lines: true },
      { path: 'src/a.ts', lines: true },
      { path: 'docs/readme.md', lines: true },
    ]);
    expect(downloads).toEqual([
      { oids: [expect.any(String), expect.any(String)], maxBytes: PROBE },
    ]);
  });

  it('downloads one at a time once all at once is stopped', async () => {
    const real = await fresh();
    const { clone: inner, downloads } = watched(real);
    // Downloading more than one file at once brings more than it may.
    const repo: CodeClone = {
      ...inner,
      offline: false,
      async download(oids, what, options) {
        if (oids.length > 1) {
          downloads.push({ oids, maxBytes: options?.maxBytes });
          throw new GitError({
            kind: 'fetch',
            what: what ?? '',
            failure: 'tooLarge',
            message: 'past',
          });
        }
        return inner.download(oids, what, options);
      },
    };
    const answers = await readCode(repo, commit, [
      { path: 'src/a.ts', lines: true },
      { path: 'bin/data.bin', lines: true },
      { path: 'docs/readme.md', lines: true },
    ]);
    expect(answers).toEqual([
      file(14, 'one\ntwo\nthree\n'),
      file(BINARY.length, BINARY.subarray(0, BINARY_WINDOW)),
      file(9, 'Read me.\n'),
    ]);
    expect(downloads.map(({ oids }) => oids.length)).toEqual([3, 1, 1, 1]);
    expect(downloads.every(({ maxBytes }) => maxBytes === PROBE)).toBe(true);
  });

  it('judges a file whose download is stopped past what one file brings too large', async () => {
    const { clone: inner } = watched(await fresh());
    const repo: CodeClone = {
      ...inner,
      offline: false,
      download: (_oids, what) =>
        Promise.reject(
          new GitError({ kind: 'fetch', what: what ?? '', failure: 'tooLarge', message: 'past' }),
        ),
    };
    expect(await readCode(repo, commit, [{ path: 'src/a.ts', lines: true }])).toEqual([
      { kind: 'tooLarge' },
    ]);
  });

  it('leaves a file unread when its download failed, and downloads nothing more', async () => {
    const { clone: inner, downloads } = watched(await fresh());
    const repo: CodeClone = {
      ...inner,
      offline: false,
      download(oids, what, options) {
        downloads.push({ oids, maxBytes: options?.maxBytes });
        return Promise.reject(
          new GitError({ kind: 'fetch', what: what ?? '', failure: 'network', message: 'gone' }),
        );
      },
    };
    const answers = await readCode(repo, commit, [
      { path: 'src/a.ts', lines: true },
      { path: 'docs/readme.md', lines: true },
    ]);
    expect(answers).toEqual([
      { kind: 'unread', why: expect.any(String) },
      { kind: 'unread', why: expect.any(String) },
    ]);
    expect(downloads).toHaveLength(1);
  });
});

/** Text of `size` bytes. */
const textOf = (size: number) => new Uint8Array(size).fill(0x78);

describe('the limit on what downloads bring', () => {
  it('reads what the checks read past files larger than they read, judged by their downloads', async () => {
    const files = new Map([
      // Past what one file brings: stopped there.
      ['huge.txt', textOf(3 * LIMITS.file)],
      // Within it, though past what the checks read: its size is known once it's here.
      ['large.txt', textOf(LIMITS.file + 1)],
      ['small.txt', text('one\n')],
    ]);
    const { clone, downloads } = memoryClone(files, { lacking: true });
    const answers = await readCode(
      clone,
      'a'.repeat(40),
      [...files.keys()].map((path) => ({ path, lines: true })),
    );
    expect(answers).toEqual([{ kind: 'tooLarge' }, file(LIMITS.file + 1), file(4, 'one\n')]);
    expect(downloads.map(({ paths }) => paths)).toEqual([
      [...files.keys()],
      ['huge.txt'],
      ['large.txt'],
      ['small.txt'],
    ]);
  });

  it('leaves files unread past it, having brought no more', async () => {
    // Each past what one file brings, so each costs that much to find out.
    const count = Math.ceil(DOWNLOAD_LIMIT / PROBE) + 2;
    const files = new Map(
      Array.from({ length: count }, (_, n) => [`huge/${n}.txt`, textOf(3 * LIMITS.file)]),
    );
    const { clone, downloads } = memoryClone(files, { lacking: true });
    const answers = await readCode(
      clone,
      'a'.repeat(40),
      [...files.keys()].map((path) => ({ path, lines: true })),
    );
    const brought = downloads.reduce((sum, { brought: each }) => sum + each, 0);
    expect(brought).toBeLessThanOrEqual(DOWNLOAD_LIMIT);
    expect(answers.filter(({ kind }) => kind === 'tooLarge').length).toBeGreaterThan(0);
    expect(answers.at(-1)).toEqual({ kind: 'unread', why: expect.any(String) });
  });
});

describe('the limit on what git reads', () => {
  it('leaves files unread past it, though the checks count only their starts', async () => {
    // Files that aren't text, each as large as the checks read: only their starts count.
    const binary = new Uint8Array(LIMITS.file);
    const count = Math.floor(STREAM_LIMIT / LIMITS.file) + 2;
    const files = new Map(Array.from({ length: count }, (_, n) => [`bin/${n}`, binary]));
    const { clone, reads } = memoryClone(files);
    const answers = await readCode(
      clone,
      'a'.repeat(40),
      [...files.keys()].map((path) => ({ path, lines: true })),
    );
    const read = Math.floor(STREAM_LIMIT / LIMITS.file);
    expect(reads).toHaveLength(read);
    expect(answers.slice(0, read).every(({ kind }) => kind === 'file')).toBe(true);
    expect(answers.slice(read).map(({ kind }) => kind)).toEqual(['unread', 'unread']);
  });
});

/** A local copy that's never opened. */
function never(): never {
  throw new Error('opened the copy');
}

describe('codeReply', () => {
  it('reads nothing until the local copy is there, nor without git', async () => {
    const files = [{ path: 'src/a.ts', lines: true }];
    expect(await codeReply({ kind: 'waiting' }, never, commit, files)).toEqual({
      kind: 'waiting',
    });
    expect(
      await codeReply({ kind: 'fetching', progress: null, attempt: 1 }, never, commit, files),
    ).toEqual({ kind: 'waiting' });
    expect(
      await codeReply(
        { kind: 'noGit', message: 'No git.', install: 'Install it.' },
        never,
        commit,
        files,
      ),
    ).toEqual({ kind: 'noGit' });
    expect(
      await codeReply(
        { kind: 'failed', failure: 'repoNotFound', message: 'GitHub has no such repository.' },
        never,
        commit,
        files,
      ),
    ).toEqual({ kind: 'failed', why: 'GitHub has no such repository.' });
  });

  it('reads from the local copy once it’s there', async () => {
    const repo: Repo = await fresh();
    const reply = await codeReply(
      {
        kind: 'ready',
        head: commit,
        base: commit,
        mergeBase: commit,
        offline: false,
      },
      () => Promise.resolve(repo),
      commit,
      [{ path: 'src/a.ts', lines: true }],
    );
    const answers: CodeAnswer[] = [file(14, 'one\ntwo\nthree\n')];
    expect(reply).toEqual({ kind: 'read', files: answers });
  });
});

describe('stopping a read', () => {
  it('stops a read asked for another way, or whose tab closed, and joins one asked for alike', async () => {
    const reads = new CodeReads();
    const stopped: string[] = [];
    let started = 0;
    const waiting = (name: string) => (signal: AbortSignal) => {
      started += 1;
      return new Promise<CodeReply>((resolve) => {
        signal.addEventListener('abort', () => {
          stopped.push(name);
          resolve({ kind: 'failed', why: name });
        });
      });
    };
    const first = reads.run('t1', 'a', waiting('first'));
    const other = reads.run('t2', 'a', waiting('other'));
    // Asked the same way: the read under way answers both.
    const again = reads.run('t1', 'a', waiting('again'));
    expect(started).toBe(2);
    const second = reads.run('t1', 'b', waiting('second'));
    expect(await first).toEqual({ kind: 'failed', why: 'first' });
    expect(await again).toEqual({ kind: 'failed', why: 'first' });
    expect(stopped).toEqual(['first']);
    reads.stop('t1');
    reads.stop('t2');
    await Promise.all([second, other]);
    expect(stopped).toEqual(['first', 'second', 'other']);
  });

  it('reads nothing more once stopped', async () => {
    const { clone, reads } = watched(await fresh());
    const controller = new AbortController();
    controller.abort();
    const reply = await codeReply(
      { kind: 'ready', head: commit, base: commit, mergeBase: commit, offline: false },
      () => Promise.resolve(clone),
      commit,
      [{ path: 'src/a.ts', lines: true }],
      { signal: controller.signal },
    );
    expect(reply).toEqual({ kind: 'failed', why: expect.any(String) });
    expect(reads).toEqual([]);
  });
});
