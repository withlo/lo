/**
 * The built checker's command line: what it prints, how it exits, and the folders, paths and
 * repositories it's run on, odd ones included.
 */

import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { git, gitProgram, testGitEnvironment } from '@lo/testing/git';

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

  test('warns of a link Markdown can’t read, at its line, with how to write it', () => {
    const dir = folder('unread-links', {
      'artifact.md': overview(
        commit,
        [
          'A [wake timer](term:wake timer) shows as text, as does [the file](code:src/a b.ts#L1).',
          '',
          '- [wrapped](term:wake',
          '  timer), and [above](#how it works)',
          '',
          '## How it works',
          '',
          'Nothing here.',
          '',
          '## Glossary',
          '',
          '- **Wake timer**: what wakes a request.',
          '',
        ].join('\n'),
      ),
    });
    const ran = runChecker(['check', dir], repo);
    // Lo shows the overview, with the link as text, so it passes.
    expect(ran.status).toBe(0);
    expect(ran.stdout.split('\n')).toEqual([
      "artifact.md:11: warning: [wake timer](term:wake timer) isn't a link, a space ends a link's address, so it shows as text. Put the address in angle brackets: [wake timer](<term:wake timer>). [link-address]",
      "artifact.md:11: warning: [the file](code:src/a b.ts#L1) isn't a link, a space ends a link's address, so it shows as text. Put the address in angle brackets: [the file](<code:src/a b.ts#L1>). [link-address]",
      "artifact.md:13: warning: [wrapped](term:wake timer) isn't a link, a line break ends a link's address, so it shows as text. Write the address on one line, in angle brackets: [wrapped](<term:wake timer>). [link-address]",
      "artifact.md:14: warning: [above](#how it works) isn't a link, a space ends a link's address, so it shows as text. A heading's anchor is its text in lower case, with - for spaces: [above](#how-it-works). [link-address]",
      'artifact.md:22: warning: Nothing links to "Wake timer". Link its uses with term:, or leave it out. [term-unused]',
      '',
      'No errors, and 5 warnings.',
      '',
    ]);
  });

  test('passes links written as the errors say, and text that only looks like one', () => {
    const dir = folder('read-links', {
      'artifact.md': overview(
        commit,
        [
          'A [wake timer](<term:wake timer>) and [the file](<code:src/a b.ts#L1>), [above](#how-it-works),',
          '[hyphenated](term:wake-timer) and [plain](code:src/a.ts#L1-L2).',
          '',
          'Only text: `[a](term:wake timer)`, \\[b\\](term:wake timer) and [c](https://example.com/a b).',
          '',
          '## How it works',
          '',
          'Nothing here.',
          '',
          '## Glossary',
          '',
          '- **Wake timer**: what wakes a request.',
          '- **Wake-timer**: the same, hyphenated.',
          '',
        ].join('\n'),
      ),
    });
    const ran = runChecker(['check', dir], repo);
    expect(ran).toEqual({ status: 0, stdout: 'No errors or warnings.\n', stderr: '' });
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
      `The repository doesn't have commit ${'0'.repeat(40)}. Check the overview against the pull request's repository, with the commit fetched.\nLo couldn't check all of the overview.\n`,
    );
  });

  test('reads the code from the repository --repo names, wherever it runs', () => {
    const dir = folder('repo option', {
      'artifact.md': overview(commit, ':::code src/a.ts#L1-L3\n:::\n'),
    });
    // Run from a folder outside any repository, which is where its git would otherwise look.
    const away = folder('away', {});
    expect(runChecker(['check', dir, '--repo', repo], away)).toEqual({
      status: 0,
      stdout: 'No errors or warnings.\n',
      stderr: '',
    });
    // A relative one is from where it runs.
    expect(runChecker(['check', dir, `--repo=../${basename(repo)}`], away).status).toBe(0);
    expect(runChecker(['check', dir], away).status).toBe(2);

    const written = runJson(['commit', dir, '--pr', '4797', '--repo', repo], away);
    expect(written.status).toBe(0);
    expect(git(repo, 'cat-file', '-t', written.commit!)).toBe('commit');

    const missing = runChecker(['check', dir, '--repo', join(root.dir, 'nowhere')], away);
    expect(missing).toEqual({
      status: 2,
      stdout: '',
      stderr: `Lo can't check the overview. There's no folder at ${JSON.stringify(join(root.dir, 'nowhere'))} for --repo.\n`,
    });
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

  test('never runs a git in the folder it runs in, which may be a pull request’s checkout', () => {
    const dir = folder('planted', {
      'artifact.md': overview(commit, ':::code src/a.ts#L1\n:::\n'),
    });
    const marker = join(root.dir, 'planted git ran');
    const planted = join(repo, 'git');
    writeFileSync(planted, `#!/bin/sh\necho ran > '${marker}'\n`);
    chmodSync(planted, 0o755);
    try {
      // An empty entry and a dot both name the folder git would run in.
      const env = { ...testGitEnvironment(), PATH: `:.:${dirname(gitProgram())}` };
      expect(runChecker(['check', dir], repo, env)).toEqual({
        status: 0,
        stdout: 'No errors or warnings.\n',
        stderr: '',
      });
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(planted);
    }
  });

  test('with --json, says why it can’t check as JSON too', () => {
    const dir = folder('json', { 'artifact.md': overview(commit) });
    const outside = runChecker(['check', dir, '--json'], root.dir);
    expect(outside.status).toBe(2);
    expect(JSON.parse(outside.stdout)).toEqual({
      error: expect.stringMatching(
        /^Lo can't check the overview\. Run the checker in the pull request's repository/,
      ),
    });
    const unknown = runChecker(['chcek', '--json'], repo);
    expect(unknown.status).toBe(2);
    expect(JSON.parse(unknown.stdout)).toEqual({ error: '"chcek" isn\'t a command.' });
    // After --, it's a folder's name.
    expect(runChecker(['check', '--', '--json'], repo).stdout).toBe('');
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
      ['check', '--repo'],
      ['check', '--repo='],
    ]) {
      const ran = runChecker(args, repo);
      expect(ran.status, `for ${args.join(' ')}`).toBe(2);
      expect(ran.stderr).toContain('Usage:');
    }
    expect(runChecker(['--help'], repo)).toMatchObject({ status: 0, stderr: '' });
    expect(runChecker([], repo).stdout).toContain('Usage:');
  });
});
