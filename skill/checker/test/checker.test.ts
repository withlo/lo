/**
 * The built checker's command line: what it prints, how it exits, and the folders, paths and
 * repositories it's run on, odd ones included.
 */

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { testGitEnvironment } from '@lo/testing/git';

import { overview, repositoryOf, runChecker, runJson, scratch } from './support.ts';

/** A figure that passes. */
const FIGURE =
  '<svg viewBox="0 0 860 120"><rect id="box" width="10" height="5" fill="var(--fig-panel)"/></svg>';

let root: ReturnType<typeof scratch>;
/** A repository whose code the overviews here point at, and its commit. */
let repo: string;
let commit: string;

beforeAll(() => {
  root = scratch('cli');
  repo = join(root.dir, 'a repo with spaces');
  mkdirSync(repo);
  commit = repositoryOf(repo, {
    'src/a.ts': 'one\ntwo\nthree\n',
    'src/a b.ts': 'with a space\n',
    'src/café.ts': 'composed\n',
  });
});

afterAll(() => root.remove());

/** A folder named `name` holding `files`, each a path and its contents. */
function folder(name: string, files: Readonly<Record<string, string | Uint8Array>>): string {
  const dir = join(root.dir, name);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('check', () => {
  test('passes an overview with no errors, exiting 0', () => {
    const dir = folder('clean', {
      'artifact.md': overview(
        commit,
        ':::code src/a.ts#L1-L3\n:::\n\n:::figure figures/flow.svg\nA box.\n\n- [box](code:src/a.ts#L2)\n:::\n',
      ),
      'figures/flow.svg': FIGURE,
    });
    const ran = runChecker(['check', dir], repo);
    expect(ran).toEqual({ status: 0, stdout: 'No errors or warnings.\n', stderr: '' });
  });

  test('prints each finding on a line of its own, at its file and line, and exits 1 on an error', () => {
    const dir = folder('errors', {
      'artifact.md': overview(
        commit,
        '[a](code:src/a.ts#L9)\n\n[b](term:bucket)\n\n## Glossary\n\n- **Cache**: what is kept.\n',
      ),
      'notes.txt': 'Notes.',
    });
    const ran = runChecker(['check', dir], repo);
    expect(ran.status).toBe(1);
    expect(ran.stdout.split('\n')).toEqual([
      "notes.txt: error: notes.txt isn't part of an overview. An overview holds only artifact.md and figures in figures/. [tree-extra]",
      "artifact.md:11: error: src/a.ts has 3 lines, so line 9 isn't there. [code-lines]",
      'artifact.md:13: error: The glossary doesn\'t define "bucket". Define it there, or don\'t link it as a term. [term-undefined]',
      'artifact.md:17: warning: Nothing links to "Cache". Link its uses with term:, or leave it out. [term-unused]',
      '',
      '3 errors and 1 warning.',
      '',
    ]);
  });

  test('passes warnings, exiting 0', () => {
    const dir = folder('warnings', {
      'artifact.md': overview(commit, 'A <br> break.\n'),
    });
    const ran = runChecker(['check', dir], repo);
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe(
      'artifact.md:11: warning: Raw HTML shows as its text. Write Markdown instead. [raw-html]\n\nNo errors, and 1 warning.\n',
    );
  });

  test('checks the current folder unless given one, and a pull request when given one', () => {
    const dir = folder('here', { 'artifact.md': overview(commit) });
    // Run in the overview's folder, it reads code from the repository it's in: none here.
    expect(runChecker(['check'], dir).status).toBe(2);
    const env = { ...testGitEnvironment(), GIT_DIR: join(repo, '.git') };
    expect(runChecker(['check'], dir, env).status).toBe(0);
    expect(runChecker(['check', '--pr', '4797'], dir, env).status).toBe(0);
    const other = runJson(['check', '--pr', '4798'], dir, env);
    expect(other.status).toBe(1);
    expect(other.findings.map(({ code }) => code)).toEqual(['pr-mismatch']);
  });

  test('reads folders and code at odd paths: spaces, newlines, a leading dash, accents', () => {
    const body = [
      ':::figure figures/a b.svg',
      'A box.',
      ':::',
      '',
      '[spaced](<code:src/a b.ts#L1>) and [accented](code:src/café.ts#L1)',
      '',
    ].join('\n');
    for (const name of ['with spaces', 'with\nnewline', '-dashed', 'tab\there']) {
      const dir = folder(name, {
        'artifact.md': overview(commit, body),
        'figures/a b.svg': FIGURE,
      });
      const ran = runChecker(['check', '--', dir], repo);
      expect(ran, `in ${JSON.stringify(name)}`).toEqual({
        status: 0,
        stdout: 'No errors or warnings.\n',
        stderr: '',
      });
    }
  });

  test('reports a name in the folder that isn’t UTF-8, without printing its bytes', (context) => {
    const dir = folder('bytes', { 'artifact.md': overview(commit) });
    try {
      writeFileSync(Buffer.from(`${dir}/figures-\xff.svg`, 'latin1'), FIGURE);
    } catch {
      // This disk takes only UTF-8 names.
      context.skip();
    }
    const ran = runJson(['check', dir], repo);
    expect(ran.status).toBe(1);
    expect(ran.findings.map(({ code, file }) => `${code} ${file}`)).toEqual([
      'tree-extra figures-�.svg',
    ]);
  });

  test('can’t check, exiting 2, outside a repository, without git, or without the commit', () => {
    const dir = folder('elsewhere', { 'artifact.md': overview(commit) });
    const outside = runChecker(['check', dir], root.dir);
    expect(outside.status).toBe(2);
    expect(outside.stderr).toMatch(
      /^Lo can't check the overview\. Run the checker in the pull request's repository/,
    );

    const noGit = runChecker(['check', dir], repo, {
      ...testGitEnvironment(),
      PATH: '/nonexistent',
    });
    expect(noGit).toEqual({
      status: 2,
      stdout: '',
      stderr: "Lo can't check the overview. Git isn't installed, or isn't on your PATH.\n",
    });

    const gone = folder('gone', { 'artifact.md': overview('0'.repeat(40)) });
    const ran = runChecker(['check', gone], repo);
    expect(ran.status).toBe(2);
    expect(ran.stderr).toBe(
      `The repository this runs in doesn't have commit ${'0'.repeat(40)}. Run it in the pull request's repository, with the commit fetched.\nLo couldn't check all of the overview.\n`,
    );
  });

  test('can’t check, exiting 2, a folder that isn’t there or can’t be read', () => {
    const missing = runChecker(['check', join(root.dir, 'nothing')], repo);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toBe(
      `Lo can't check the overview. There's no folder at ${JSON.stringify(join(root.dir, 'nothing'))}.\n`,
    );
    if (process.getuid?.() === 0) return;
    const dir = folder('locked', { 'artifact.md': overview(commit) });
    chmodSync(join(dir, 'artifact.md'), 0o000);
    const locked = runJson(['check', dir], repo);
    expect(locked.status).toBe(2);
    expect(locked.findings.map(({ code }) => code)).toEqual(['unreadable']);
    expect(locked.incomplete).toEqual([
      'artifact.md couldn\'t be read: "artifact.md" couldn\'t be opened (EACCES).',
    ]);
  });

  test('takes only what it knows, exiting 2 with how to use it', () => {
    for (const args of [
      ['chcek'],
      ['check', '--prr', '1'],
      ['check', 'a', 'b'],
      ['check', '--pr', '01'],
      ['check', '--pr', '-1'],
      ['check', '--pr'],
      ['commit', 'dir'],
      ['commit', 'dir', '--pr', '1e3'],
    ]) {
      const ran = runChecker(args, repo);
      expect(ran.status, `for ${args.join(' ')}`).toBe(2);
      expect(ran.stderr).toContain('Usage:');
    }
    expect(runChecker(['--help'], repo)).toMatchObject({ status: 0, stderr: '' });
    expect(runChecker([], repo).stdout).toContain('Usage:');
  });
});
