/** What the package's tests share: folders that clean up after themselves, and gits to run. */

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitProgram } from '@lo/testing/git';
import { onTestFinished } from 'vitest';

import type { Environment } from '../src/environment.ts';
import { findGit } from '../src/find.ts';
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
  settings: Partial<RunnerSettings> & { git?: Git | undefined } = {},
): Promise<Runner> {
  const home = join(folder, 'home');
  mkdirSync(home, { recursive: true });
  const git = settings.git ?? (await foundGit());
  return new Runner(git, { home, ceiling: folder, ...settings });
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
