// What changed since an overview's commit, up to the head on screen, read from the pull request's
// local copy: how many files the pushes since changed, across a rebase, with the base's changes
// left out; and for each file, where it is at the head, renames found, with both texts when it
// changed and whether the pushes changed it. Nothing that isn't text or is too large is read, the
// downloads stop at what Lo downloads for the two, and reads stop with the tab.

import { BINARY_WINDOW, LIMITS } from '@lo/artifact';
import { parseOid, type Repo } from '@lo/git';
import { RepoServer } from '@lo/testing/git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LocalState } from '../../tab/contract.ts';
import { testClone } from '../test/clone.ts';
import { DOWNLOAD_LIMIT, PROBE } from './code.ts';
import { SinceReads, type SinceClone } from './since.ts';
import type { ReadyLocal } from './texts.ts';

/** Files that aren't text: a NUL soon after their start. */
const BINARY = new Uint8Array(BINARY_WINDOW * 2).fill(0x61);
BINARY[10] = 0;
const BINARY_2 = new Uint8Array(BINARY_WINDOW * 2).fill(0x62);
BINARY_2[10] = 0;

/** A file one byte past what Lo reads of a file. */
const HUGE = new Uint8Array(LIMITS.file + 1).fill(0x78);

const PARSE = 'export function parse(text) {\n  return text.split("\\n");\n}\n';
const PARSER = 'export function parse(text) {\n  return text.split(/\\r?\\n/);\n}\n';
const PARSER_2 =
  'export function parse(text) {\n  if (text === "") return [];\n  return text.split(/\\r?\\n/);\n}\n';
const FORMAT = 'export const format = String;\n';
const WORDS = 'one\ntwo\nthree\nfour\nfive\nsix\n';
const WORDS_2 = WORDS.replace('two', 'TWO');

let server: RepoServer;
/** The pull request's first push, and its second, rebased onto a newer base. */
let first: string;
let second: string;

beforeAll(() => {
  server = new RepoServer();
  const remote = server.repo('o', 'r');
  remote
    .write('README.md', 'Read me.\n')
    .write('src/parse.ts', PARSE)
    .write('src/format.ts', FORMAT)
    .write('src/gone.ts', 'gone\n')
    .write('src/kept.ts', 'kept\n')
    .write('data.bin', BINARY)
    .write('huge.txt', 'small\n')
    .write('src/old.ts', WORDS);
  remote.commit('The base.');
  remote.publish('refs/heads/trunk');

  // The first push: renames the parser, changing it.
  remote.switch('first');
  remote.remove('src/parse.ts').write('src/parser.ts', PARSER);
  first = remote.commit('Renames the parser.');
  remote.publish('refs/heads/first');

  // The base branch moves on, renaming a file the first push doesn't touch.
  remote.switch('trunk').write('README.md', 'Read me, now.\n');
  remote.remove('src/old.ts').write('src/new.ts', WORDS);
  remote.commit('The base moves on.');
  remote.publish('refs/heads/trunk');

  // The second push: the first, rebased onto it, then more.
  remote.switch('second');
  remote.remove('src/parse.ts').write('src/parser.ts', PARSER);
  remote.commit('Renames the parser.');
  remote.write('src/parser.ts', PARSER_2).remove('src/gone.ts');
  remote.remove('src/format.ts').write('src/text/format.ts', FORMAT);
  remote.write('data.bin', BINARY_2).write('huge.txt', HUGE).write('src/new.ts', WORDS_2);
  second = remote.commit('Handles empty input.');
  remote.publish('refs/pull/1/head');
}, 60_000);

afterAll(() => server.remove());

/** `repo`, as the reads see it, with `changes` made to it. */
function through(repo: Repo, changes: Partial<SinceClone> = {}): SinceClone {
  return {
    get offline() {
      return repo.offline;
    },
    hasCommit: (oid) => repo.hasCommit(oid),
    fetchCommit: (oid) => repo.fetchCommit(oid),
    mergeBase: (a, b) => repo.mergeBase(a, b),
    compareRevisions: (base, head, options) => repo.compareRevisions(base, head, options),
    fileVersions: (rev, paths) => repo.fileVersions(rev, paths),
    objectSizes: (oids) => repo.objectSizes(oids),
    download: (oids, what, options) => repo.download(oids, what, options),
    readBlob: (oid, options) => repo.readBlob(oid, options),
    ...changes,
  };
}

/** A local copy that mustn't be opened. */
function opened(): never {
  throw new Error('opened the local copy');
}

/** The pull request's local copy at the second push, with the first fetched too. */
async function fetched(): Promise<{ repo: Repo; local: ReadyLocal }> {
  const repo = await testClone(server.baseUrl, 'o', 'r');
  const { head, baseTip } = await repo.fetchPull({ number: 1, baseBranch: 'trunk' });
  await repo.fetchCommit(parseOid(first));
  const mergeBase = await repo.mergeBase(head, baseTip);
  return {
    repo,
    local: { kind: 'ready', head, base: baseTip, mergeBase: mergeBase ?? null, offline: false },
  };
}

describe('SinceReads', () => {
  it('counts the files the pushes since changed, leaving out what came with the base', async () => {
    const { repo, local } = await fetched();
    const since = new SinceReads();
    // README.md and the rename came with the rebase; the other six are the second push's.
    expect(await since.count(local, () => Promise.resolve(repo), first, second)).toEqual({
      kind: 'read',
      files: 6,
    });
    expect(await since.count(local, () => Promise.resolve(repo), second, second)).toEqual({
      kind: 'read',
      files: 0,
    });
  });

  it('gives a changed file’s texts at both, and says whether the pushes changed it', async () => {
    const { repo, local } = await fetched();
    const since = new SinceReads();
    const file = (path: string) =>
      since.file(local, () => Promise.resolve(repo), first, second, path);
    expect(await file('src/parser.ts')).toEqual({
      kind: 'changed',
      path: 'src/parser.ts',
      pushed: true,
      texts: { old: PARSER, new: PARSER_2 },
    });
    // Changed only by the base branch the second push was rebased onto.
    expect(await file('README.md')).toEqual({
      kind: 'changed',
      path: 'README.md',
      pushed: false,
      texts: { old: 'Read me.\n', new: 'Read me, now.\n' },
    });
  });

  it('finds a file renamed since, and one that’s the same or deleted', async () => {
    const { repo, local } = await fetched();
    const since = new SinceReads();
    const file = (path: string) =>
      since.file(local, () => Promise.resolve(repo), first, second, path);
    expect(await file('src/format.ts')).toEqual({ kind: 'same', path: 'src/text/format.ts' });
    expect(await file('src/kept.ts')).toEqual({ kind: 'same', path: 'src/kept.ts' });
    expect(await file('src/gone.ts')).toEqual({ kind: 'deleted' });
  });

  it('finds a file the base branch renamed, which the pushes then changed', async () => {
    const { repo, local } = await fetched();
    const since = new SinceReads();
    expect(
      await since.file(local, () => Promise.resolve(repo), first, second, 'src/old.ts'),
    ).toEqual({
      kind: 'changed',
      path: 'src/new.ts',
      pushed: true,
      texts: { old: WORDS, new: WORDS_2 },
    });
  });

  it('reads nothing that isn’t text or is too large, saying the file changed', async () => {
    const { repo, local } = await fetched();
    const since = new SinceReads();
    const file = (path: string) =>
      since.file(local, () => Promise.resolve(repo), first, second, path);
    expect(await file('data.bin')).toEqual({
      kind: 'changed',
      path: 'data.bin',
      pushed: true,
      texts: { why: 'It isn’t text.' },
    });
    expect(await file('huge.txt')).toEqual({
      kind: 'changed',
      path: 'huge.txt',
      pushed: true,
      texts: { why: `It’s larger than ${LIMITS.file / 2 ** 20} MB, the most Lo reads of a file.` },
    });
    expect(await file('src/nothing.ts')).toEqual({
      kind: 'unread',
      why: 'There’s no file at that path at the overview’s commit.',
    });
  });

  it('compares the two once, downloading each file alone, within what Lo downloads for them', async () => {
    const { repo, local } = await fetched();
    const compared: (number | undefined)[] = [];
    let received = 0;
    const caps: (number | undefined)[] = [];
    const watched = through(repo, {
      compareRevisions: (old, now, options) => {
        compared.push(options?.maxBytes);
        return repo.compareRevisions(old, now, {
          ...options,
          received: (bytes) => {
            received += bytes;
            options?.received?.(bytes);
          },
        });
      },
      download: (oids, what, options) => {
        caps.push(options?.maxBytes);
        return repo.download(oids, what, options);
      },
    });
    const since = new SinceReads();
    const clone = () => Promise.resolve(watched);
    await since.count(local, clone, first, second);
    await since.file(local, clone, first, second, 'src/parser.ts');
    await since.file(local, clone, first, second, 'README.md');
    // The pushes', then everything that changed, each once, the second within what the first left.
    expect(compared).toHaveLength(2);
    expect(compared[0]).toBe(DOWNLOAD_LIMIT);
    expect(compared[1]).toBeLessThan(DOWNLOAD_LIMIT);
    // What the comparisons brought counts against what the files may download.
    expect(received).toBeGreaterThan(0);
    for (const cap of caps) expect(cap).toBeLessThanOrEqual(DOWNLOAD_LIMIT - received);
    for (const cap of caps) expect(cap).toBeLessThanOrEqual(PROBE);
  });

  it('downloads nothing more once what Lo downloads for the two is spent', async () => {
    const { repo, local } = await fetched();
    const spending = through(repo, {
      compareRevisions: (old, now, options) => {
        options?.received?.(DOWNLOAD_LIMIT);
        return Promise.resolve({ refused: 'tooLarge', limit: DOWNLOAD_LIMIT } as const);
      },
      download: () => Promise.reject(new Error('downloaded past what Lo downloads')),
    });
    const since = new SinceReads();
    const clone = () => Promise.resolve(spending);
    expect(await since.file(local, clone, first, second, 'src/parser.ts')).toMatchObject({
      kind: 'changed',
      pushed: true,
      texts: { why: 'Lo downloaded as much of this overview’s code as it downloads for one.' },
    });
  });

  it('looks at the same path when the comparisons are past what Lo downloads, counting every change', async () => {
    const { repo, local } = await fetched();
    const refusing = through(repo, {
      compareRevisions: () => Promise.resolve({ refused: 'tooLarge', limit: 1 } as const),
    });
    const since = new SinceReads();
    const clone = () => Promise.resolve(refusing);
    expect(await since.count(local, clone, first, second)).toEqual({ kind: 'read', files: null });
    // Renamed or deleted, it isn't where it was, and Lo can't tell which; every change may be the
    // pushes'.
    for (const path of ['src/format.ts', 'src/gone.ts', 'src/old.ts']) {
      expect(await since.file(local, clone, first, second, path)).toEqual({
        kind: 'unread',
        why: 'Lo couldn’t tell where the file went since.',
      });
    }
    expect(await since.file(local, clone, first, second, 'README.md')).toMatchObject({
      kind: 'changed',
      pushed: true,
    });
    expect(await since.file(local, clone, first, second, 'src/kept.ts')).toEqual({
      kind: 'same',
      path: 'src/kept.ts',
    });
  });

  it('waits for the local copy and both commits, and says why it can’t read without them', async () => {
    const since = new SinceReads();
    const waiting: LocalState[] = [
      { kind: 'waiting' },
      { kind: 'fetching', progress: null, attempt: 1 },
      { kind: 'retrying', failure: 'network', message: 'Offline.', attempt: 2, retryAt: 0 },
    ];
    for (const local of waiting) {
      expect(await since.count(local, opened, first, second)).toEqual({ kind: 'waiting' });
      expect(await since.file(local, opened, first, second, 'README.md')).toEqual({
        kind: 'waiting',
      });
    }
    const noGit: LocalState = { kind: 'noGit', message: 'No git.', install: 'Install it.' };
    expect(await since.count(noGit, opened, first, second)).toEqual({ kind: 'noGit' });
    expect(await since.file(noGit, opened, first, second, 'README.md')).toEqual({
      kind: 'unread',
      why: 'Lo needs git to read the code.',
    });
    const failed: LocalState = { kind: 'failed', failure: 'auth', message: 'Signed out.' };
    expect(await since.count(failed, opened, first, second)).toEqual({
      kind: 'failed',
      why: 'The pull request’s local copy couldn’t be fetched: Signed out.',
    });

    // A copy that hasn't fetched the head yet, as just after a newer push is loaded.
    const { repo, local } = await fetched();
    const lacking = through(repo, { hasCommit: (oid) => Promise.resolve(oid !== second) });
    expect(await since.count(local, () => Promise.resolve(lacking), first, second)).toEqual({
      kind: 'waiting',
    });
    expect(await since.count(local, () => undefined, first, second)).toEqual({ kind: 'waiting' });
  });

  it('fetches the overview’s commit when the copy lacks it, once for every read', async () => {
    const repo = await testClone(server.baseUrl, 'o', 'r');
    const { head, baseTip } = await repo.fetchPull({ number: 1, baseBranch: 'trunk' });
    const mergeBase = await repo.mergeBase(head, baseTip);
    const local: ReadyLocal = {
      kind: 'ready',
      head,
      base: baseTip,
      mergeBase: mergeBase ?? null,
      offline: false,
    };
    const fetches: string[] = [];
    const clone = through(repo, {
      fetchCommit: (oid) => {
        fetches.push(oid);
        return repo.fetchCommit(oid);
      },
    });
    const since = new SinceReads();
    const [count, parser] = await Promise.all([
      since.count(local, () => Promise.resolve(clone), first, second),
      since.file(local, () => Promise.resolve(clone), first, second, 'src/parser.ts'),
    ]);
    expect(count).toEqual({ kind: 'read', files: 6 });
    expect(parser).toMatchObject({ kind: 'changed', path: 'src/parser.ts', pushed: true });
    expect(fetches).toEqual([first]);

    // Offline, it waits; and says so when GitHub no longer has it.
    const missing = '9'.repeat(40);
    const offline = through(repo, { offline: true });
    expect(
      await new SinceReads().count(local, () => Promise.resolve(offline), missing, second),
    ).toEqual({ kind: 'waiting' });
    expect(
      await new SinceReads().count(local, () => Promise.resolve(clone), missing, second),
    ).toEqual({ kind: 'failed', why: 'GitHub no longer has the commit the overview describes.' });
  });

  it('stops its reads as the tab closes', async () => {
    const { repo, local } = await fetched();
    const since = new SinceReads();
    let started!: () => void;
    const comparing = new Promise<void>((resolve) => (started = resolve));
    const held = through(repo, {
      compareRevisions: (old, now, options) => {
        started();
        return new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('stopped')));
        });
      },
    });
    const reading = since.count(local, () => Promise.resolve(held), first, second);
    await comparing;
    since.stop();
    // The comparison stopped, so the count is unknown, and nothing is logged as failing.
    expect(await reading).toEqual({ kind: 'read', files: null });
  });
});
