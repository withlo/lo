/**
 * The checker's readers: code from a repository through `git cat-file`, and an overview from a
 * folder through `lstat`. Each is tried against what would get past it: a file too large to read,
 * a link to follow, a name in another case, a file swapped as it's read, a fetch over the network.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { LIMITS, SIZE_ONLY, type FileAnswer } from '@lo/artifact';
import { git, gitBytes, testGitEnvironment } from '@lo/testing/git';

import { gitCode, type GitCode } from '../src/code.ts';
import { readFolder } from '../src/folder.ts';
import { gitEnvironment, gitIn } from '../src/git.ts';
import { scratch } from './support.ts';

const signal = new AbortController().signal;
const encoder = new TextEncoder();

let root: ReturnType<typeof scratch>;

beforeAll(() => {
  root = scratch('readers');
});

afterAll(() => root.remove());

/** `answer` with its bytes as text, to compare at a glance. */
function shown(answer: FileAnswer): unknown {
  return answer.kind === 'file'
    ? { ...answer, bytes: new TextDecoder().decode(answer.bytes.subarray(0, 40)) }
    : answer;
}

describe('code from git', () => {
  let repo: string;
  let commit: string;
  let code: GitCode;

  beforeAll(() => {
    repo = join(root.dir, 'code');
    mkdirSync(repo);
    git(repo, 'init', '-q', '--object-format=sha1', '.');
    const blob = (contents: string | Uint8Array) =>
      gitBytes(repo, ['hash-object', '-w', '--stdin'], contents).toString().trim();
    const tree = (lines: string[]) =>
      gitBytes(
        repo,
        ['mktree', '-z', '--missing'],
        Buffer.from(lines.map((l) => `${l}\0`).join('')),
      )
        .toString()
        .trim();
    const inner = tree([`100644 blob ${blob('inside\n')}\tinner.ts`]);
    const top = tree([
      `100644 blob ${blob(new Uint8Array(SIZE_ONLY + 1).fill(0x61))}\tbig.txt`,
      `100644 blob ${blob(new Uint8Array(SIZE_ONLY).fill(0x61))}\tat.txt`,
      `100644 blob ${blob('one\ntwo\n')}\tsmall.ts`,
      `100755 blob ${blob('#!/bin/sh\n')}\trun.sh`,
      `100644 blob ${blob('composed\n')}\tcafé.ts`,
      `040000 tree ${inner}\tdir`,
      `120000 blob ${blob('small.ts')}\tlink.ts`,
      `120000 blob ${blob('dir')}\tlinked`,
      `160000 commit ${'1'.repeat(40)}\tmodule`,
    ]);
    commit = gitBytes(repo, ['commit-tree', top], 'Code.\n').toString().trim();
    code = gitCode(gitIn(repo, testGitEnvironment()));
  });

  afterAll(() => code.close());

  const read = (path: string, cap = 8_192, at = commit) => code.read(at, path, cap, signal);

  test('reads a file’s size, and its bytes up to the cap', async () => {
    expect(shown(await read('small.ts'))).toEqual({ kind: 'file', size: 8, bytes: 'one\ntwo\n' });
    expect(shown(await read('small.ts', 3))).toEqual({ kind: 'file', size: 8, bytes: 'one' });
    expect(shown(await read('small.ts', 0))).toEqual({ kind: 'file', size: 8, bytes: '' });
    expect(shown(await read('run.sh'))).toMatchObject({ kind: 'file', size: 10 });
    expect(shown(await read('dir/inner.ts'))).toMatchObject({ kind: 'file', bytes: 'inside\n' });
  });

  test('asks a file’s size first, and reads none of one past what any check reads', async () => {
    const big = await read('big.txt');
    expect(big).toEqual({ kind: 'file', size: SIZE_ONLY + 1, bytes: new Uint8Array() });
    const at = await read('at.txt');
    expect(at.kind === 'file' && at.bytes.length).toBe(8_192);
  });

  test('says what isn’t a file, and never follows a link', async () => {
    expect(await read('dir')).toEqual({ kind: 'notFile', is: 'folder' });
    expect(await read('link.ts')).toEqual({ kind: 'notFile', is: 'link' });
    expect(await read('module')).toEqual({ kind: 'notFile', is: 'submodule' });
    // Through a link, a file or a submodule, there's nothing.
    for (const path of ['linked/inner.ts', 'small.ts/x', 'module/x', 'dir/inner.ts/x']) {
      expect(await read(path), `at ${path}`).toEqual({ kind: 'missing' });
    }
  });

  test('matches names exactly, byte for byte, whatever they hold', async () => {
    for (const path of [
      'Small.ts',
      'café.ts',
      'small.ts\n',
      'small.ts\nsmall.ts',
      '',
      'dir/',
      '/small.ts',
      'a'.repeat(2_000),
    ]) {
      expect(await read(path), `at ${JSON.stringify(path)}`).toEqual({ kind: 'missing' });
    }
    expect(await read('café.ts')).toMatchObject({ kind: 'file', size: 9 });
    // Nothing above reached git as a name, so it still answers.
    expect(await read('small.ts')).toMatchObject({ kind: 'file', size: 8 });
  });

  test('says when the repository doesn’t have the commit, or it isn’t one', async () => {
    expect(await read('small.ts', 8_192, '0'.repeat(40))).toEqual({ kind: 'noCommit' });
    const blob = git(repo, 'rev-parse', `${commit}:small.ts`);
    expect(await read('small.ts', 8_192, blob)).toEqual({ kind: 'noCommit' });
    expect(await code.has(commit)).toBe(true);
    expect(await code.has('0'.repeat(64))).toBe(false);
  });

  test('never gives git a commit that isn’t an id', async () => {
    for (const name of [
      'HEAD',
      `${commit}\nHEAD`,
      '--batch-all-objects',
      `${commit}^`,
      commit.toUpperCase(),
    ]) {
      await expect(read('small.ts', 8_192, name), `at ${JSON.stringify(name)}`).rejects.toThrow(
        "isn't an object's id",
      );
    }
    expect(await read('small.ts')).toMatchObject({ kind: 'file', size: 8 });
  });
});

test('git reaches no network: a partial clone’s missing file stays missing', async () => {
  const source = join(root.dir, 'source');
  mkdirSync(source);
  git(source, 'init', '-q', '.');
  writeFileSync(join(source, 'a.ts'), 'remote\n');
  git(source, 'add', 'a.ts');
  git(source, 'commit', '-q', '-m', 'Code');
  git(source, 'config', 'uploadpack.allowFilter', 'true');
  const commit = git(source, 'rev-parse', 'HEAD');
  const blob = git(source, 'rev-parse', 'HEAD:a.ts');
  const clone = join(root.dir, 'partial');
  git(root.dir, 'clone', '-q', '--filter=blob:none', '--no-checkout', `file://${source}`, clone);
  const lacks = () =>
    execFileSync('git', ['cat-file', '--batch-check'], {
      cwd: clone,
      input: `${blob}\n`,
      env: { ...testGitEnvironment(), GIT_NO_LAZY_FETCH: '1' },
    })
      .toString()
      .trim() === `${blob} missing`;
  expect(lacks()).toBe(true);

  const code = gitCode(gitIn(clone, testGitEnvironment()));
  try {
    await expect(code.read(commit, 'a.ts', 8_192, signal)).rejects.toThrow(
      `The repository lacks blob ${blob}.`,
    );
  } finally {
    code.close();
  }
  // Fetched, it would be there now.
  expect(lacks()).toBe(true);
});

test('git runs with the network closed, and asks for nothing', () => {
  const env = gitEnvironment({ PATH: '/bin', GIT_NO_LAZY_FETCH: '0', GIT_ALLOW_PROTOCOL: 'https' });
  expect(env).toEqual({
    PATH: '/bin',
    GIT_NO_LAZY_FETCH: '1',
    GIT_ALLOW_PROTOCOL: 'none',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
  });
});

/** The entries of the folder `dir`, each as its kind and path. */
function paths(dir: string): string[] {
  return readFolder(dir).entries.map(
    ({ path, kind }) => `${kind} ${new TextDecoder().decode(path)}`,
  );
}

describe('an overview from a folder', () => {
  let made = 0;
  /** A new folder holding `files`. */
  const folder = (files: Readonly<Record<string, string>>): string => {
    const dir = join(root.dir, `folder-${made++}`);
    mkdirSync(dir);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  };
  test('lists files, links and folders, with their sizes', () => {
    const dir = folder({ 'artifact.md': 'Text.', 'figures/a.svg': '<svg/>' });
    symlinkSync('/etc/passwd', join(dir, 'figures/b.svg'));
    expect(
      readFolder(dir).entries.map(({ path, kind, size }) => [
        new TextDecoder().decode(path),
        kind,
        size,
      ]),
    ).toEqual([
      ['artifact.md', 'file', 5],
      ['figures', 'folder', undefined],
      ['figures/a.svg', 'file', 6],
      ['figures/b.svg', 'link', 11],
    ]);
  });

  test('reads none of a file past what any check reads, knowing it by its size', async () => {
    const dir = folder({ 'artifact.md': 'Text.' });
    mkdirSync(join(dir, 'figures'));
    writeFileSync(join(dir, 'figures/big.png'), '');
    truncateSync(join(dir, 'figures/big.png'), SIZE_ONLY + 1);
    const files = readFolder(dir);
    expect(await files.read('figures/big.png', 4_096, signal)).toEqual({
      kind: 'file',
      size: SIZE_ONLY + 1,
      bytes: new Uint8Array(),
    });
    expect(files.contents('figures/big.png')).toBeUndefined();
  });

  test('never follows a link, to a file or a folder', async () => {
    const elsewhere = folder({ 'artifact.md': 'Elsewhere.', 'figures/a.svg': '<svg/>' });
    const dir = folder({});
    symlinkSync(join(elsewhere, 'artifact.md'), join(dir, 'artifact.md'));
    symlinkSync(join(elsewhere, 'figures'), join(dir, 'figures'));
    expect(paths(dir)).toEqual(['link artifact.md', 'link figures']);
    const files = readFolder(dir);
    expect(await files.read('artifact.md', 100, signal)).toEqual({ kind: 'notFile', is: 'link' });
    expect(await files.read('figures/a.svg', 100, signal)).toEqual({ kind: 'missing' });
  });

  test('matches names exactly, even on a disk that ignores case', async () => {
    const dir = folder({ 'Artifact.md': 'Text.', 'figures/A.svg': '<svg/>' });
    const files = readFolder(dir);
    expect(await files.read('artifact.md', 100, signal)).toEqual({ kind: 'missing' });
    expect(await files.read('figures/a.svg', 100, signal)).toEqual({ kind: 'missing' });
    expect(await files.read('figures/A.svg', 100, signal)).toMatchObject({ kind: 'file', size: 6 });
  });

  test('refuses a file changed since it was listed: swapped, linked or grown', async () => {
    const other = folder({ 'a.svg': '<svg/>' });
    const swaps: [string, (dir: string) => void][] = [
      [
        'a link',
        (dir) => {
          rmSync(join(dir, 'figures/a.svg'));
          symlinkSync(join(other, 'a.svg'), join(dir, 'figures/a.svg'));
        },
      ],
      [
        'another file',
        (dir) => {
          rmSync(join(dir, 'figures/a.svg'));
          writeFileSync(join(dir, 'figures/a.svg'), '<svg/>');
        },
      ],
      [
        'a folder of links',
        (dir) => {
          renameSync(join(dir, 'figures'), join(dir, 'gone'));
          symlinkSync(other, join(dir, 'figures'));
        },
      ],
      [
        'a link to it, moved away',
        (dir) => {
          renameSync(join(dir, 'figures/a.svg'), join(dir, 'moved.svg'));
          symlinkSync(join(dir, 'moved.svg'), join(dir, 'figures/a.svg'));
        },
      ],
      ['a file grown', (dir) => writeFileSync(join(dir, 'figures/a.svg'), '<svg></svg>')],
    ];
    for (const [what, swap] of swaps) {
      const dir = folder({ 'artifact.md': 'Text.', 'figures/a.svg': '<svg/>' });
      const files = readFolder(dir);
      swap(dir);
      await expect(files.read('figures/a.svg', 100, signal), `swapped for ${what}`).rejects.toThrow(
        '"figures/a.svg" changed as it was checked. Check it again.',
      );
    }
  });

  test('keeps what it read, so what was checked is what’s committed', async () => {
    const dir = folder({ 'artifact.md': 'Text.', 'figures/a.svg': '<svg/>' });
    const files = readFolder(dir);
    expect(files.contents('figures/a.svg')).toBeUndefined();
    await files.read('figures/a.svg', 2, signal);
    writeFileSync(join(dir, 'figures/a.svg'), '<svg/ >');
    expect(new TextDecoder().decode(files.contents('figures/a.svg'))).toBe('<svg/>');
    expect(await files.read('figures/a.svg', 100, signal)).toMatchObject({ size: 6 });
  });

  test('stops listing past the limit, but always finds artifact.md', () => {
    const dir = folder({});
    for (let n = 0; n < LIMITS.entries + 100; n++) writeFileSync(join(dir, `a${n}.md`), '');
    writeFileSync(join(dir, 'artifact.md'), 'Text.');
    writeFileSync(join(dir, 'zz.md'), '');
    const { entries } = readFolder(dir);
    expect(entries).toHaveLength(LIMITS.entries + 1);
    expect(entries[0]?.path).toEqual(encoder.encode('artifact.md'));
  });

  test('refuses what isn’t a file, a folder or a link', () => {
    const dir = folder({ 'artifact.md': 'Text.' });
    execFileSync('mkfifo', [join(dir, 'pipe')]);
    expect(() => readFolder(dir)).toThrow(
      "\"pipe\" isn't a file, a folder or a link, so it can't be in an overview's commit.",
    );
  });
});
