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
import { findGit, gitEnvironment, gitIn } from '../src/git.ts';
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

  test('takes a commit by its exact id only: not a tag’s, a name’s, or a shorter id', async () => {
    const tag = gitBytes(
      repo,
      ['hash-object', '-t', 'tag', '-w', '--stdin'],
      `object ${commit}\ntype commit\ntag v1\ntagger Lo test <test@lo.invalid> 0 +0000\n\nA tag.\n`,
    )
      .toString()
      .trim();
    // A ref named like a SHA-256 id, in a SHA-1 repository.
    const named = 'a'.repeat(64);
    git(repo, 'update-ref', `refs/tags/${named}`, commit);
    for (const at of [tag, named]) {
      expect(await read('small.ts', 8_192, at), `at ${at}`).toEqual({ kind: 'noCommit' });
      expect(await code.has(at), `has ${at}`).toBe(false);
    }

    // A SHA-256 repository's commit, by its first 40 digits.
    const wide = join(root.dir, 'sha256');
    mkdirSync(wide);
    git(wide, 'init', '-q', '--object-format=sha256', '.');
    writeFileSync(join(wide, 'a.ts'), 'one\n');
    git(wide, 'add', 'a.ts');
    git(wide, 'commit', '-q', '-m', 'Code');
    const id = git(wide, 'rev-parse', 'HEAD');
    const wideCode = gitCode(gitIn(wide, testGitEnvironment()));
    try {
      expect(await wideCode.read(id, 'a.ts', 100, signal)).toMatchObject({ kind: 'file', size: 4 });
      expect(await wideCode.read(id.slice(0, 40), 'a.ts', 100, signal)).toEqual({
        kind: 'noCommit',
      });
    } finally {
      wideCode.close();
    }
  });
});

describe('what git writes', () => {
  const MIB = 1024 * 1024;
  let repo: string;
  let commit: string;

  beforeAll(() => {
    repo = join(root.dir, 'large');
    mkdirSync(repo);
    git(repo, 'init', '-q', '--object-format=sha1', '.');
    const blob = (contents: string | Uint8Array) =>
      gitBytes(repo, ['hash-object', '-w', '--stdin'], contents).toString().trim();
    const tree = (lines: string[]) =>
      gitBytes(repo, ['mktree', '-z'], Buffer.from(lines.map((line) => `${line}\0`).join('')))
        .toString()
        .trim();
    // Six files of 1 MiB, each its own, and a folder of 2,000 files.
    const large = Array.from({ length: 6 }, (_, n) => {
      const bytes = new Uint8Array(MIB);
      bytes.set(encoder.encode(`file ${n}\n`));
      return `100644 blob ${blob(bytes)}\t${n}.bin`;
    });
    const small = blob('one\n');
    const many = tree(
      Array.from(
        { length: 2_000 },
        (_, n) => `100644 blob ${small}\tf${String(n).padStart(4, '0')}.ts`,
      ),
    );
    const top = tree([...large, `040000 tree ${many}\tmany`, `100644 blob ${small}\ta.ts`]);
    commit = gitBytes(repo, ['commit-tree', top], 'Code.\n').toString().trim();
  });

  test('keeps only the bytes asked for, and stops past its limit, saying so', async () => {
    const files = Array.from({ length: 6 }, (_, n) => `${n}.bin`);
    const code = gitCode(gitIn(repo, testGitEnvironment()), [...files, 'a.ts'], 5.5 * MIB);
    try {
      for (const path of files.slice(0, 5)) {
        const answer = await code.read(commit, path, 8_192, signal);
        // A copy of its own: nothing holds on to the rest of the file.
        expect(answer.kind === 'file' && answer.bytes.buffer.byteLength).toBe(8_192);
      }
      expect(code.streamed()).toBeGreaterThan(5 * MIB);
      await expect(code.read(commit, '5.bin', 8_192, signal)).rejects.toThrow(
        'Checking the overview would read more than 6 MiB from git, the most the checker reads for one overview. Name fewer large files.',
      );
      // What still fits is still read.
      expect(await code.read(commit, 'a.ts', 8_192, signal)).toMatchObject({
        kind: 'file',
        size: 4,
      });
    } finally {
      code.close();
    }
  });

  test('holds only the tree entries on the way to the paths the overview names', async () => {
    const code = gitCode(gitIn(repo, testGitEnvironment()), ['many/f0001.ts', 'a.ts']);
    try {
      expect(await code.read(commit, 'many/f0001.ts', 100, signal)).toMatchObject({ size: 4 });
      expect(await code.read(commit, 'a.ts', 100, signal)).toMatchObject({ size: 4 });
      // The root's many and a.ts, and the folder's f0001.ts: not the 2,000 beside it.
      expect(code.held()).toBe(3);
      // A path no target names is read all the same, holding nothing more.
      expect(await code.read(commit, 'many/f1999.ts', 100, signal)).toMatchObject({ size: 4 });
      expect(await code.read(commit, 'many/f2000.ts', 100, signal)).toEqual({ kind: 'missing' });
      expect(code.held()).toBe(3);
    } finally {
      code.close();
    }
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
    NoDefaultCurrentDirectoryInExePath: '1',
  });
});

describe('finding git', () => {
  test('takes the first git in a folder PATH names absolutely, never the folder it runs in', () => {
    const programs = new Set([
      '/usr/bin/git',
      '/opt/git/bin/git',
      'git',
      '.git',
      './git',
      'bin/git',
    ]);
    const found = (path: string) => programs.has(path);
    expect(findGit({ PATH: ':.:./:bin:/usr/bin:/opt/git/bin' }, 'linux', found)).toBe(
      '/usr/bin/git',
    );
    expect(findGit({ PATH: '/opt/git/bin:/usr/bin' }, 'darwin', found)).toBe('/opt/git/bin/git');
    expect(findGit({ PATH: ':.:bin' }, 'linux', found)).toBeUndefined();
    expect(findGit({ Path: '/usr/bin' }, 'linux', found)).toBeUndefined();
    expect(findGit({}, 'linux', found)).toBeUndefined();
  });

  test('on Windows, takes git.exe from Path, whatever its case, skipping relative entries', () => {
    const programs = new Set([
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'git.exe',
      '.\\git.exe',
      'C:git.exe',
      'tools\\git.exe',
    ]);
    const found = (path: string) => programs.has(path);
    expect(findGit({ Path: '.;;C:;tools;"C:\\Program Files\\Git\\cmd"' }, 'win32', found)).toBe(
      'C:\\Program Files\\Git\\cmd\\git.exe',
    );
    expect(findGit({ PATH: '.;;C:;tools' }, 'win32', found)).toBeUndefined();
  });

  test('finds this machine’s git, by an absolute path', () => {
    const found = findGit(testGitEnvironment());
    expect(found).toMatch(/^\/.*\/git$/);
    expect(gitIn(root.dir, testGitEnvironment()).program).toBe(found);
    expect(() => gitIn(root.dir, { PATH: '' })).toThrow(
      "Git isn't installed, or isn't on your PATH.",
    );
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
          // Made while the first is still there, so it can't take the first's inode.
          writeFileSync(join(dir, 'figures/b.svg'), '<svg/>');
          renameSync(join(dir, 'figures/b.svg'), join(dir, 'figures/a.svg'));
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
