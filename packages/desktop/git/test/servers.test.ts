// The git a language server runs in its checkout, with the variables `serverGitEnvironment` gives
// it, against a pull request that plants a bare repository, a repository whose own settings name
// programs to run, and a file the clone lacks. Each is run without them too, to show what they
// keep from happening.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { blobId, git, missingObjects, type RemoteRepo } from '@lo/testing/git';
import { expect, test } from 'vitest';

import { serverGitEnvironment } from '../src/environment.ts';
import { cacheFor, repoServer, script, systemPath, tempFolder } from './support.ts';

/** Programs that each leave a marker named after themselves, and the markers they left. */
function markers(): { program: (name: string) => string; left: () => string[] } {
  const dir = tempFolder();
  const folder = join(dir, 'markers');
  mkdirSync(folder);
  return {
    program: (name) => script(join(dir, name), `/usr/bin/touch '${join(folder, name)}'\nexit 1`),
    left: () => readdirSync(folder).toSorted(),
  };
}

/**
 * An environment built from nothing, as a server's is: a `PATH` with git, an empty `HOME`, an
 * author, and no system or global config, so what git does without the server's variables comes
 * from the repository alone. With `server`, those variables too.
 */
function environment(server: boolean): Record<string, string> {
  const home = join(tempFolder(), 'home');
  mkdirSync(home);
  return {
    PATH: systemPath(),
    HOME: home,
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Server',
    GIT_AUTHOR_EMAIL: 'server@lo.invalid',
    GIT_COMMITTER_NAME: 'Server',
    GIT_COMMITTER_EMAIL: 'server@lo.invalid',
    ...(server ? serverGitEnvironment() : {}),
  };
}

/** Runs the `git` on `env`'s `PATH` in `cwd`, as a server would, with `input` on its stdin. */
function run(cwd: string, env: Record<string, string>, args: string[], input = '') {
  const done = spawnSync('git', args, { cwd, env, input, encoding: 'utf8', timeout: 20_000 });
  return { code: done.status, stdout: done.stdout.trim(), stderr: done.stderr };
}

/**
 * Pull request #1's head, with what `plant` writes, checked out by Lo; and the base's version of
 * the file it changes, which the clone lacks, since a checkout downloads only the head's files.
 */
async function checkedOut(plant: (remote: RemoteRepo) => void) {
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  remote.write('README.md', '# repo\n').write('src/lib.rs', 'pub fn a() {}\n');
  const base = remote.commit('base');
  remote.publish('refs/heads/trunk');
  remote.switch('feature').write('src/lib.rs', 'pub fn a() { 1 }\n');
  plant(remote);
  remote.commit('head');
  remote.publish('refs/pull/1/head');
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  const { head } = await repo.fetchPull({ number: 1, baseBranch: 'trunk' });
  const dir = await repo.checkout(1, head);
  return { clone: repo.folder, dir, base, lacking: blobId(remote.work, base, 'src/lib.rs') };
}

test('a server’s git never takes a bare repository a pull request plants', async () => {
  const { program, left } = markers();
  const monitor = program('fsmonitor');
  // As an attack plants one: with a work tree, so that `status` runs its monitor.
  const { dir } = await checkedOut((remote) => {
    remote
      .write('evil/HEAD', 'ref: refs/heads/main\n')
      .write('evil/config', `[core]\n\tbare = false\n\tworktree = ..\n\tfsmonitor = ${monitor}\n`)
      .write('evil/objects/.keep', '')
      .write('evil/refs/.keep', '');
  });
  const planted = join(dir, 'evil');
  // Without the server's variables, git takes the planted repository as the one it's in.
  expect(run(planted, environment(false), ['rev-parse', '--absolute-git-dir']).stdout).toBe(
    planted,
  );

  const env = environment(true);
  for (const args of [['status'], ['rev-parse', '--git-dir']]) {
    const found = run(planted, env, args);
    expect.soft(found.code).not.toBe(0);
    expect.soft(found.stderr).toContain("cannot use bare repository '");
  }

  expect(left()).toEqual([]);
  // The checkout itself is still a repository the server's git reads.
  expect(run(dir, env, ['status', '--porcelain'])).toMatchObject({ code: 0, stdout: '' });
});

test('a server’s git runs no hook, monitor, askpass program or credential helper', () => {
  const { program, left } = markers();
  const hooks = join(tempFolder(), 'hooks');
  mkdirSync(hooks);
  copyFileSync(program('pre-commit'), join(hooks, 'pre-commit'));
  const repo = join(tempFolder(), 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', 'a.txt');
  // A repository's own settings, each naming a program.
  git(repo, 'config', 'core.hooksPath', hooks);
  git(repo, 'config', 'core.fsmonitor', program('fsmonitor'));
  git(repo, 'config', 'core.askPass', program('askpass'));
  git(repo, 'config', 'credential.helper', program('helper'));
  const ask = 'protocol=https\nhost=example.com\n\n';

  const env = environment(true);
  expect(run(repo, env, ['commit', '-q', '-m', 'a']).code).toBe(0);
  const asked = run(repo, env, ['credential', 'fill'], ask);
  expect(asked.code).not.toBe(0);
  expect(asked.stderr).toContain('terminal prompts disabled');
  expect(left()).toEqual([]);
  // They're the command line's settings, which git counts as protected configuration.
  expect(run(repo, env, ['config', '--show-scope', '--get', 'safe.bareRepository']).stdout).toBe(
    'command\texplicit',
  );

  // Without them, each runs.
  const own = environment(false);
  expect(run(repo, own, ['commit', '-q', '--allow-empty', '-m', 'b']).code).not.toBe(0);
  run(repo, own, ['credential', 'fill'], ask);
  expect(left()).toEqual(['askpass', 'fsmonitor', 'helper', 'pre-commit']);
});

test('a server’s git never downloads what the clone lacks', async () => {
  const { clone, dir, base, lacking } = await checkedOut(() => undefined);

  const read = run(dir, environment(true), ['cat-file', '-p', lacking]);

  expect(read.code).not.toBe(0);
  expect(missingObjects(clone, base)).toContain(lacking);
  // Without them, git downloads it from the clone's remote.
  expect(run(dir, environment(false), ['cat-file', '-p', lacking]).stdout).toBe('pub fn a() {}');
  expect(missingObjects(clone, base)).not.toContain(lacking);
});
