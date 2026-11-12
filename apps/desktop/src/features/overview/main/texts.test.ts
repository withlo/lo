// The files an overview's blocks show, read from the pull request's local copy: each file's text at
// the overview's commit, and where its diff starts, from the commit's merge base with the base
// branch, renames found; files the pull request doesn't touch, or only made executable, read as
// the same; what isn't a file, isn't text or is too large isn't read; and reads stop with the tab.

import { BINARY_WINDOW, LIMITS } from '@lo/artifact';
import { parseOid, type Oid, type Repo } from '@lo/git';
import { RepoServer } from '@lo/testing/git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LocalState } from '../../tab/contract.ts';
import { testClone } from '../test/clone.ts';
import { DOWNLOAD_LIMIT, PROBE } from './code.ts';
import { baseOf, BlockTexts, type ReadyLocal, type TextsClone } from './texts.ts';

/** A file that isn't text: a NUL soon after its start. */
const BINARY = new Uint8Array(BINARY_WINDOW * 2).fill(0x61);
BINARY[10] = 0;

/** A file one byte past what Lo reads of a file. */
const HUGE = new Uint8Array(LIMITS.file + 1).fill(0x78);

const PARSE = 'export function parse(text) {\n  return text.split("\\n");\n}\n';
const PARSER = 'export function parse(text) {\n  return text.split(/\\r?\\n/);\n}\n';

let server: RepoServer;
/** The pull request's first push, and its second. */
let first: string;
let second: string;

beforeAll(() => {
  server = new RepoServer();
  const remote = server.repo('o', 'r');
  remote
    .write('README.md', 'Read me.\n')
    .write('src/parse.ts', PARSE)
    .write('src/format.ts', 'export const format = String;\n')
    .write('bin/run.sh', 'echo run\n')
    .write('src/old.ts', 'before\n');
  remote.commit('The base.');
  remote.publish('refs/heads/trunk');

  remote.switch('pull');
  remote.remove('src/parse.ts').write('src/parser.ts', PARSER).write('src/cache.ts', 'cache\n');
  remote.executable('bin/run.sh').symlink('src/link.ts', 'parser.ts');
  remote.write('data.bin', BINARY).write('huge.txt', HUGE);
  first = remote.commit('Renames the parser.');
  remote.write('src/old.ts', 'after\n');
  second = remote.commit('Changes the old file.');
  remote.publish('refs/pull/1/head');

  // The base branch moves on after the pull request branched off.
  remote.switch('trunk').write('README.md', 'Read me, now.\n');
  remote.commit('The base moves on.');
  remote.publish('refs/heads/trunk');
}, 60_000);

afterAll(() => server.remove());

/** `repo`, as the reads see it, with `changes` made to it. */
function through(repo: Repo, changes: Partial<TextsClone> = {}): TextsClone {
  return {
    get offline() {
      return repo.offline;
    },
    hasCommit: (oid) => repo.hasCommit(oid),
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

/** The pull request's local copy, fetched, and how the tab says it is. */
async function fetched(): Promise<{ repo: Repo; local: ReadyLocal }> {
  const repo = await testClone(server.baseUrl, 'o', 'r');
  const { head, baseTip } = await repo.fetchPull({ number: 1, baseBranch: 'trunk' });
  const mergeBase = await repo.mergeBase(head, baseTip);
  return {
    repo,
    local: { kind: 'ready', head, base: baseTip, mergeBase: mergeBase ?? null, offline: false },
  };
}

describe('BlockTexts', () => {
  it('reads a renamed file and where its diff starts, from its old name', async () => {
    const { repo, local } = await fetched();
    const texts = new BlockTexts();
    // Each file the copy lacks is downloaded alone, stopped past what a probe of one brings.
    const caps: (number | undefined)[] = [];
    const watched = through(repo, {
      download: (oids, what, options) => {
        caps.push(options?.maxBytes);
        return repo.download(oids, what, options);
      },
    });
    expect(
      await texts.read(local, () => Promise.resolve(watched), second, 'src/parser.ts', true),
    ).toEqual({
      kind: 'text',
      text: PARSER,
      base: { kind: 'changed', path: 'src/parse.ts', text: PARSE },
    });
    expect(caps.length).toBeGreaterThan(0);
    expect(new Set(caps)).toEqual(new Set([PROBE]));
  });

  it('reads files the pull request didn’t change, or only made executable, as the same', async () => {
    const { repo, local } = await fetched();
    const texts = new BlockTexts();
    const read = (path: string) =>
      texts.read(local, () => Promise.resolve(repo), second, path, true);
    expect(await read('src/format.ts')).toEqual({
      kind: 'text',
      text: 'export const format = String;\n',
      base: { kind: 'same' },
    });
    // The base branch changed it after the pull request branched off: not the pull request's.
    expect(await read('README.md')).toEqual({
      kind: 'text',
      text: 'Read me.\n',
      base: { kind: 'same' },
    });
    expect(await read('bin/run.sh')).toEqual({
      kind: 'text',
      text: 'echo run\n',
      base: { kind: 'same' },
    });
    expect(await read('src/cache.ts')).toEqual({
      kind: 'text',
      text: 'cache\n',
      base: { kind: 'added' },
    });
  });

  it('reads an earlier push from where it branched off too', async () => {
    const { repo, local } = await fetched();
    const texts = new BlockTexts();
    const read = (path: string) =>
      texts.read(local, () => Promise.resolve(repo), first, path, true);
    expect(await read('src/old.ts')).toEqual({
      kind: 'text',
      text: 'before\n',
      base: { kind: 'same' },
    });
    expect(await read('src/parser.ts')).toMatchObject({
      base: { kind: 'changed', path: 'src/parse.ts', text: PARSE },
    });
    // The base branch changed it after the push branched off: not the pull request's.
    expect(await read('README.md')).toMatchObject({ base: { kind: 'same' } });
  });

  it('reads the file alone without its base', async () => {
    const { repo, local } = await fetched();
    expect(
      await new BlockTexts().read(local, () => Promise.resolve(repo), second, 'src/old.ts', false),
    ).toEqual({ kind: 'text', text: 'after\n', base: null });
  });

  it('looks for the file at the same path when what changed is past what Lo downloads', async () => {
    const { repo, local } = await fetched();
    const caps: (number | undefined)[] = [];
    const refusing = through(repo, {
      compareRevisions: (_base, _head, options) => {
        caps.push(options?.maxBytes);
        return Promise.resolve({ refused: 'tooLarge', limit: 1 } as const);
      },
    });
    const texts = new BlockTexts();
    const read = (path: string) =>
      texts.read(local, () => Promise.resolve(refusing), second, path, true);
    // Its old name is unknown, so it's new.
    expect(await read('src/parser.ts')).toMatchObject({ base: { kind: 'added' } });
    expect(await read('src/old.ts')).toMatchObject({
      base: { kind: 'changed', path: 'src/old.ts', text: 'before\n' },
    });
    expect(await read('src/format.ts')).toMatchObject({ base: { kind: 'same' } });
    // Worked out once for the commit, stopped past what Lo downloads for it.
    expect(caps).toEqual([DOWNLOAD_LIMIT]);
  });

  it('counts every download for a commit against what Lo downloads for one', async () => {
    const { repo, local } = await fetched();
    const caps: (number | undefined)[] = [];
    // The comparison brings all there is room for, and is refused.
    const spending = through(repo, {
      compareRevisions: (_base, _head, options) => {
        options?.received?.(DOWNLOAD_LIMIT);
        return Promise.resolve({ refused: 'tooLarge', limit: DOWNLOAD_LIMIT } as const);
      },
      download: (oids, what, options) => {
        caps.push(options?.maxBytes);
        return repo.download(oids, what, options);
      },
    });
    const texts = new BlockTexts();
    const read = (path: string) =>
      texts.read(local, () => Promise.resolve(spending), second, path, true);
    // The head's file comes first, with the whole cap; its old one finds nothing left.
    expect(await read('src/old.ts')).toEqual({
      kind: 'text',
      text: 'after\n',
      base: {
        kind: 'unknown',
        why: 'Lo downloaded as much of this overview’s code as it downloads for one.',
      },
    });
    expect(caps).toEqual([PROBE]);
  });

  it('reads nothing that isn’t a file, isn’t text, or is too large', async () => {
    const { repo, local } = await fetched();
    const texts = new BlockTexts();
    const read = (path: string, commit = second) =>
      texts.read(local, () => Promise.resolve(repo), commit, path, true);
    expect(await read('src/link.ts')).toEqual({ kind: 'unread', why: 'It isn’t a file.' });
    expect(await read('data.bin')).toEqual({ kind: 'unread', why: 'It isn’t text.' });
    expect(await read('huge.txt')).toEqual({
      kind: 'unread',
      why: `It’s larger than ${LIMITS.file / 2 ** 20} MB, the most Lo reads of a file.`,
    });
    expect(await read('src')).toMatchObject({ kind: 'unread' });
    expect(await read('nowhere.ts')).toMatchObject({ kind: 'unread' });
    expect(await read('src/parser.ts', '1'.repeat(40))).toEqual({
      kind: 'unread',
      why: 'The local copy doesn’t have the commit the overview describes.',
    });
  });

  it('says why it reads nothing before the local copy is there', async () => {
    const texts = new BlockTexts();
    const states: LocalState[] = [
      { kind: 'waiting' },
      { kind: 'fetching', progress: null, attempt: 1 },
      { kind: 'noGit', message: 'No git.', install: 'Install it.' },
      { kind: 'failed', failure: 'network', message: 'It broke.' },
    ];
    const answers = await Promise.all(
      states.map((local) => texts.read(local, opened, second, 'README.md', true)),
    );
    expect(answers).toEqual([
      { kind: 'unread', why: 'The pull request’s local copy isn’t here yet.' },
      { kind: 'unread', why: 'The pull request’s local copy isn’t here yet.' },
      { kind: 'unread', why: 'Lo needs git to read the code.' },
      { kind: 'unread', why: 'The pull request’s local copy couldn’t be fetched: It broke.' },
    ]);
  });

  it('stops its reads as the tab closes', async () => {
    const { repo, local } = await fetched();
    let started!: () => void;
    const downloading = new Promise<void>((resolve) => (started = resolve));
    const waiting = through(repo, {
      download: (_oids, _what, options) => {
        started();
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('stopped')));
        });
      },
    });
    const texts = new BlockTexts();
    const read = texts.read(local, () => Promise.resolve(waiting), second, 'src/old.ts', false);
    await downloading;
    texts.stop();
    expect(await read).toEqual({ kind: 'unread', why: 'The read was stopped.' });
  });
});

const oid = (digit: string) => parseOid(digit.repeat(40));
const [head, other, tipOid, forked, merged, earlier] = ['1', '2', '3', '4', '5', '6'].map(oid);

/** A copy whose merge bases are `bases`, by the first digits of the two commits asked about. */
function basesOf(bases: Record<string, Oid | undefined>) {
  const asked: string[] = [];
  return {
    asked,
    mergeBase(a: Oid, b: Oid) {
      asked.push(`${a[0]}${b[0]}`);
      return Promise.resolve(bases[`${a[0]}${b[0]}`]);
    },
  };
}

describe('baseOf', () => {
  const local: ReadyLocal = {
    kind: 'ready',
    head: head!,
    base: tipOid!,
    mergeBase: forked!,
    offline: false,
  };

  it('is the local copy’s own merge base at its head', async () => {
    const copy = basesOf({});
    expect(await baseOf(copy, local, head!)).toBe(forked);
    expect(copy.asked).toEqual([]);
  });

  it('is an earlier push’s merge base with the base branch’s tip, never the tip', async () => {
    const copy = basesOf({ '63': earlier, '23': forked });
    expect(await baseOf(copy, local, other!)).toBe(forked);
    expect(copy.asked).toEqual(['23']);
  });

  it('is where the head branched off, for a commit the base branch holds already', async () => {
    const copy = basesOf({ '53': merged, '54': forked });
    expect(await baseOf(copy, local, merged!)).toBe(forked);
    expect(copy.asked).toEqual(['53', '54']);
  });

  it('is none without history in common', async () => {
    expect(await baseOf(basesOf({}), local, other!)).toBe(undefined);
    expect(await baseOf(basesOf({}), { ...local, mergeBase: null }, head!)).toBe(undefined);
  });
});
