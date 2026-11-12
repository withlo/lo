// Main's reader of an overview's code: the pull request's local copy at the header's commit, read
// as the overview's checks read code. A commit GitHub doesn't have, links, submodules and folders
// answer as the checks' readers do; a file past what the checks read is judged by its size and
// never read; downloads are capped at what's left of the code the checks read; and git reads no
// more than its limit for one overview.

import { BINARY_WINDOW, LIMITS } from '@lo/artifact';
import { GitError, parseOid, type Oid, type Repo } from '@lo/git';
import { git, RepoServer } from '@lo/testing/git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CodeAnswer } from '../contract.ts';
import { testClone } from '../test/clone.ts';
import { memoryClone } from '../test/memory.ts';
import { codeReply, readCode, STREAM_LIMIT, type CodeClone } from './code.ts';

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
  remote.write('src/a.ts', 'lost\n');
  lost = remote.commit('Never pushed.');
}, 60_000);

afterAll(() => server.remove());

/** The pull request's local copy, with nothing fetched into it yet. */
const fresh = () => testClone(server.baseUrl, 'o', 'r');

/** `repo`, counting what's read of it and downloaded into it. */
function watched(repo: CodeClone) {
  const reads: Oid[] = [];
  const downloads: { oids: readonly Oid[]; maxBytes: number | undefined }[] = [];
  const clone: CodeClone = {
    get offline() {
      return repo.offline;
    },
    hasCommit: (oid) => repo.hasCommit(oid),
    fetchCommit: (oid) => repo.fetchCommit(oid),
    fileVersion: (rev, path) => repo.fileVersion(rev, path),
    download(oids, what, options) {
      downloads.push({ oids, maxBytes: options?.maxBytes });
      return repo.download(oids, what, options);
    },
    readBlob(oid, options) {
      reads.push(oid);
      return repo.readBlob(oid, options);
    },
  };
  return { clone, reads, downloads };
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
    expect(await readCode(repo, lost, files)).toEqual([{ kind: 'noCommit' }, { kind: 'noCommit' }]);
    // A tag names a commit, but isn't the commit an overview names.
    expect(await readCode(repo, tag, files)).toEqual([{ kind: 'noCommit' }, { kind: 'noCommit' }]);
  });

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

  it('downloads what the copy lacks, capped at what’s left of the code the checks read', async () => {
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
    // All at once, as if what the copy has were read whole.
    expect(downloads).toEqual([
      { oids: [expect.any(String), expect.any(String)], maxBytes: LIMITS.code - BINARY.length },
    ]);
  });

  it('downloads one at a time once all at once is past the cap, each capped at what’s left', async () => {
    const real = await fresh();
    const { clone: inner, downloads } = watched(real);
    // Downloading more than one file at once brings more than the cap allows.
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
    expect(downloads.map(({ maxBytes }) => maxBytes)).toEqual([
      LIMITS.code,
      // What's left once the text before it was read, and its download counted.
      LIMITS.code,
      LIMITS.code - 14,
      LIMITS.code - 14 - BINARY.length,
    ]);
  });

  it('leaves a file unread when its download is past what’s left', async () => {
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
      { kind: 'unread', why: expect.any(String) },
    ]);
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
