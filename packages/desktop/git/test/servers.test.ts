// The git a language server runs in its checkout, with the variables `serverGitEnvironment` gives
// it, against a pull request that plants a bare repository, a symlink and a submodule, a
// repository whose own settings name programs to run, the system's and the user's settings, a
// clone with garbage to collect, and a file the clone lacks. Each is run without them too, to show
// what they keep from happening.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

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
 * An environment built from nothing, as a server's is: a `PATH` with git, a `HOME`, and an
 * author. The system's settings and the user's are the test's own files, which say only where
 * they're from: `lo.from` is `system` in the one and `user` in the other. With `server`, the
 * server's variables too, and nothing else of git's: whatever keeps those files from being read
 * comes from them.
 */
function environment(server: boolean): Record<string, string> {
  const dir = tempFolder();
  const home = join(dir, 'home');
  mkdirSync(home);
  writeFileSync(join(home, '.gitconfig'), '[lo]\n\tfrom = user\n');
  const system = join(dir, 'system-config');
  writeFileSync(system, '[lo]\n\tfrom = system\n');
  return {
    PATH: systemPath(),
    HOME: home,
    GIT_CONFIG_SYSTEM: system,
    LC_ALL: 'C',
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

test('a server’s git reads neither the system’s settings nor the user’s', () => {
  const dir = tempFolder();
  expect(run(dir, environment(false), ['config', '--get-all', 'lo.from']).stdout).toBe(
    'system\nuser',
  );

  const read = run(dir, environment(true), ['config', '--get-all', 'lo.from']);

  expect(read).toMatchObject({ code: 1, stdout: '' });
});

test('a server’s git leaves a checkout’s symlinks plain files', async () => {
  const { dir } = await checkedOut((remote) => remote.symlink('link', '/etc/hosts'));
  const link = join(dir, 'link');
  // Without the server's variables, git takes the file Lo checked out for a changed link.
  expect(run(dir, environment(false), ['status', '--porcelain']).stdout).toBe('T link');

  const env = environment(true);
  expect(run(dir, env, ['status', '--porcelain']).stdout).toBe('');
  expect(run(dir, env, ['checkout', '--', 'link']).code).toBe(0);

  expect(lstatSync(link).isSymbolicLink()).toBe(false);
  expect(readFileSync(link, 'utf8')).toBe('/etc/hosts');
});

test('a server’s git reaches no remote a pull request names', async () => {
  const { program, left } = markers();
  const { dir } = await checkedOut((remote) =>
    remote
      .write(
        '.gitmodules',
        '[submodule "vendor"]\n\tpath = vendor\n\turl = ssh://example.invalid/x.git\n',
      )
      .gitlink('vendor', '1'.repeat(40)),
  );
  // ssh, as git would run it to reach the submodule.
  const ssh = { GIT_SSH_COMMAND: program('ssh') };

  const update = run(dir, { ...environment(true), ...ssh }, ['submodule', 'update', '--init']);

  expect(update.code).not.toBe(0);
  expect(update.stderr).toContain("transport 'ssh' not allowed");
  expect(left()).toEqual([]);
  // Without the server's variables, git runs ssh.
  run(dir, { ...environment(false), ...ssh }, ['submodule', 'update', '--init']);
  expect(left()).toEqual(['ssh']);
});

/**
 * Writes `count` loose objects into the clone at `gitDir`, all in `objects/17`, the folder git
 * counts to tell whether it's time to collect garbage: past 27 there, as many as 6,700 in all.
 */
function plantLooseObjects(gitDir: string, count: number): void {
  const folder = join(gitDir, 'objects', '17');
  mkdirSync(folder, { recursive: true });
  for (let at = 0, planted = 0; planted < count; at++) {
    const body = Buffer.from(`planted ${at}\n`);
    const object = Buffer.concat([Buffer.from(`blob ${body.length}\0`), body]);
    const oid = createHash('sha1').update(object).digest('hex');
    if (!oid.startsWith('17')) continue;
    writeFileSync(join(folder, oid.slice(2)), deflateSync(object));
    planted++;
  }
}

test('a server’s git never collects garbage or runs maintenance in the clone', async () => {
  const { clone, dir } = await checkedOut(() => undefined);
  plantLooseObjects(clone, 30);
  // What each git started, as git traces it. Neither detaches, so all of it is done when it ends.
  const runs = (env: Record<string, string>) => {
    const trace = join(tempFolder(), 'trace');
    const traced = { ...env, GIT_TRACE: trace };
    const quiet = ['-c', 'gc.autoDetach=false', '-c', 'maintenance.autoDetach=false'];
    run(dir, traced, [...quiet, 'gc', '--auto']);
    run(dir, traced, [...quiet, 'commit', '-q', '--allow-empty', '-m', 'a commit']);
    const lines = existsSync(trace) ? readFileSync(trace, 'utf8').split('\n') : [];
    return lines.flatMap((line) => /run_command: git (\S+)/.exec(line)?.[1] ?? []);
  };

  expect(runs(environment(true))).toEqual([]);

  // Without the server's variables, git repacks the clone, and a commit starts maintenance.
  const started = runs(environment(false));
  expect(started).toContain('repack');
  expect(started).toContain('maintenance');
});
