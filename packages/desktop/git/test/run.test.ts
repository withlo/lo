// Running git: input and output of any length, `-z` output as it streams, and each git in a process
// group of its own that stops with whatever it started.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { FakeServer, git, gitBytes } from '@lo/testing/git';
import { expect, onTestFinished, test } from 'vitest';

import { GitError } from '../src/errors.ts';
import { eventually, runnerIn, tempFolder } from './support.ts';

/** A runner and an empty bare repository for it. */
async function bare() {
  const dir = tempFolder();
  const repo = join(dir, 'repo.git');
  git(dir, 'init', '-q', '--bare', repo);
  return { dir, repo, lo: await runnerIn(dir) };
}

test('input and output longer than the pipes hold dont wait on each other', async () => {
  const { repo, lo } = await bare();
  // `cat-file --batch-check` answers each line as it reads it: with a megabyte each way, far more
  // than a pipe holds, it stops reading while its answers wait to be read, and the writer of its
  // input must not be the one that reads them.
  const lines = 20_000;
  const input = Array.from({ length: lines }, (_, i) => `${i.toString(16).padStart(40, '0')}\n`);

  const output = await lo
    .command({ gitDir: repo })
    .arg('cat-file', '--batch-check')
    .run(input.join(''));

  expect(output.toString('utf8').trimEnd().split('\n')).toHaveLength(lines);
});

test('git that stops reading its input is not an error', async () => {
  const { repo, lo } = await bare();
  // `rev-parse` exits without reading any of it, so writing it ends in a broken pipe, which git's
  // exit status already answers for.
  const input = Buffer.alloc(8 << 20, 'x');

  const finished = await lo.command({ gitDir: repo }).arg('rev-parse', '--git-dir').finish(input);

  expect([finished.code, finished.stderr]).toEqual([0, '']);
  expect(finished.stdout.toString('utf8').trim()).toMatch(/repo\.git$/);
});

test('streams -z output record by record, and fails after the last when git does', async () => {
  const dir = tempFolder();
  const work = join(dir, 'work');
  git(dir, 'init', '-q', work);
  // Enough names that the listing comes in many pieces, some cut mid-name.
  const names = Array.from({ length: 5000 }, (_, i) => `folder/file name ${i}.txt`);
  const empty = gitBytes(work, ['hash-object', '-w', '--stdin'], '').toString('utf8').trim();
  const entries = names.map((name) => `100644 ${empty}\t${name}\n`).join('');
  gitBytes(work, ['update-index', '--index-info'], entries);
  const lo = await runnerIn(dir);
  const gitDir = join(work, '.git');

  const records: string[] = [];
  for await (const record of lo.command({ gitDir }).arg('ls-files', '-z').records()) {
    records.push(record.toString('utf8'));
  }

  expect(records.toSorted()).toEqual(names.toSorted());
  const read = async () => {
    for await (const record of lo.command({ gitDir }).arg('ls-tree', '-z', 'nowhere').records()) {
      expect(record).toBeUndefined();
    }
  };
  await expect(read()).rejects.toThrow(GitError);
});

test('logs and errors name arguments, and count folders of Lo’s own', async () => {
  const dir = tempFolder();
  const logged: string[] = [];
  const lo = await runnerIn(dir, { log: (line) => logged.push(line) });
  const command = lo
    .command('none')
    .arg('init', '--bare', '--bogus-option')
    .path(join(dir, 'secret-folder-name'));

  await expect(command.run()).rejects.toThrow(/^`git init --bare --bogus-option <path>` failed: /);
  expect(command.display).toBe('git init --bare --bogus-option <path>');
  expect(logged).toEqual([
    expect.stringMatching(/^git init --bare --bogus-option <path> exited with 129 after \d+ ms$/),
  ]);
  expect(logged.join('')).not.toContain('secret-folder-name');
});

/** The processes in the group `group` leads. */
function inGroup(group: number): number[] {
  try {
    return execFileSync('pgrep', ['-g', String(group)], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map(Number);
  } catch {
    // pgrep exits with 1 when nothing matches.
    return [];
  }
}

test('each git leads a process group, and stopping it stops what it started', async () => {
  const silent = await FakeServer.silent();
  onTestFinished(() => silent.close());
  const lo = await runnerIn(tempFolder(), { remote: silent.url });
  // git starts `git-remote-http`, which waits for an answer that never comes.
  const child = lo
    .command('none', { fetching: {} })
    .arg('ls-remote', `${silent.url}/owner/repo.git`)
    .start();
  const pid = child.pid ?? 0;
  const group = execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' });
  expect(Number(group.trim())).toBe(pid);
  await eventually(() => silent.requests().length > 0 && inGroup(pid).length > 1);

  child.stop();

  expect(await child.exited).toMatchObject({ signal: 'SIGKILL' });
  await eventually(() => inGroup(pid).length === 0);
});

test('an aborted run stops git', async () => {
  const silent = await FakeServer.silent();
  onTestFinished(() => silent.close());
  const lo = await runnerIn(tempFolder(), { remote: silent.url });
  const controller = new AbortController();
  const listing = lo
    .command('none', { fetching: {} })
    .arg('ls-remote', `${silent.url}/owner/repo.git`)
    .run(undefined, { signal: controller.signal });
  await eventually(() => silent.requests().length > 0);

  controller.abort(new Error('no longer needed'));

  await expect(listing).rejects.toThrow('no longer needed');
});
