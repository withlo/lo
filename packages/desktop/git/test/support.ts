/** What the package's tests share: folders that clean up after themselves, and gits to run. */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitProgram, RepoServer } from '@lo/testing/git';
import { onTestFinished } from 'vitest';

import { Cache, type CacheOptions } from '../src/cache.ts';
import { type Environment, GITHUB } from '../src/environment.ts';
import { findGit, gitAt } from '../src/find.ts';
import { type Git, Runner, type RunnerSettings } from '../src/git.ts';

/** A new folder, deleted when the test ends. Its path has no symlinks in it. */
export function tempFolder(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'lo-git-test-')));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

/** The git Lo would find in `env`: the test's own environment unless it says otherwise. */
export async function foundGit(env: Environment = process.env): Promise<Git> {
  const status = await findGit({ env, platform: process.platform });
  if (status.status !== 'found') throw new Error(`the tests need git: ${status.message}`);
  return status.git;
}

/**
 * A runner for a cache in a new folder: git's home is `home` inside it, and git looks for no
 * repository in the folder or above it.
 */
export async function runnerIn(
  folder: string,
  options: {
    git?: Git | undefined;
    log?: RunnerSettings['log'];
    /** Where fetches go. Anything but GitHub, and any `config`, takes the test-only settings. */
    remote?: string | undefined;
    config?: string[] | undefined;
  } = {},
): Promise<Runner> {
  const home = join(folder, 'home');
  mkdirSync(home, { recursive: true });
  const git = options.git ?? (await foundGit());
  const { remote, config } = options;
  const ownSettings = (remote === undefined || remote === GITHUB) && config === undefined;
  return new Runner(git, {
    home,
    ceiling: folder,
    log: options.log,
    test: ownSettings ? undefined : { remote, config },
  });
}

/** Writes an executable shell script at `path`. */
export function script(path: string, body: string): string {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** A script at `path` that pretends to be git `version`, and does nothing else. */
export function fakeGit(path: string, version: string): string {
  return script(path, `echo 'git version ${version}'`);
}

/**
 * A script at `path` that runs the real git, first running `before`, and saying it's `version`
 * when asked, if given.
 */
export function wrappedGit(
  path: string,
  options: { version?: string; before?: string } = {},
): string {
  const lines = [options.before ?? ''];
  if (options.version !== undefined) {
    lines.push(`if [ "$1" = --version ]; then echo 'git version ${options.version}'; exit 0; fi`);
  }
  lines.push(`exec '${gitProgram()}' "$@"`);
  return script(path, lines.join('\n'));
}

/** A git that runs the real one and notes the name of each command it runs. */
export interface TracedGit {
  readonly git: Git;
  /** The name of every command that ran, such as `diff` or `fetch`, in order. */
  commands(): string[];
  /** How many times the command `name` ran. */
  count(name: string): number;
}

/**
 * A {@link TracedGit}: a script that notes the first argument that's neither an option nor a
 * setting after `-c`, which is the command, and runs the real git.
 */
export async function tracedGit(): Promise<TracedGit> {
  const dir = tempFolder();
  const log = join(dir, 'commands');
  const program = script(
    join(dir, 'git'),
    [
      'skip=',
      'for arg; do',
      '  if [ -n "$skip" ]; then skip=; continue; fi',
      `  case $arg in -c) skip=1 ;; -*) ;; *) printf '%s\\n' "$arg" >> '${log}'; break ;; esac`,
      'done',
      `exec '${gitProgram()}' "$@"`,
    ].join('\n'),
  );
  const status = await gitAt(program, { env: process.env, platform: process.platform });
  if (status.status !== 'found') throw new Error(`the traced git: ${status.status}`);
  const commands = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter((line) => line !== '')
      : [];
  return {
    git: status.git,
    commands,
    count: (name) => commands().filter((command) => command === name).length,
  };
}

/** The message `promise` fails with, or `undefined` if it doesn't fail. */
export async function failureOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Polls `check` until it's true, for up to `limit` milliseconds. */
export async function eventually(
  check: () => boolean | Promise<boolean>,
  limit = 10_000,
): Promise<void> {
  const until = Date.now() + limit;
  while (!(await check())) {
    if (Date.now() > until) throw new Error(`still not so after ${limit} ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** A server of repositories in a folder, removed when the test ends. */
export function repoServer(): RepoServer {
  const server = new RepoServer();
  onTestFinished(() => server.remove());
  return server;
}

/**
 * A cache in a new folder, fetching from `remote` (a {@link RepoServer}'s, or a server's
 * address), with `config` after Lo's settings, closed when the test ends.
 */
export async function cacheFor(
  remote: RepoServer | string,
  options: Partial<CacheOptions> & { config?: string[] | undefined } = {},
): Promise<Cache> {
  const address = typeof remote === 'string' ? remote : remote.baseUrl;
  const ownSettings = address === GITHUB && options.config === undefined;
  const cache = await Cache.open({
    root: options.root ?? join(tempFolder(), 'cache'),
    git: options.git ?? (await foundGit()),
    log: options.log,
    limits: options.limits,
    test: ownSettings ? undefined : { remote: address, config: options.config },
  });
  onTestFinished(() => cache.close());
  return cache;
}
