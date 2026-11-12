/** A test's own git: the `git` on `PATH`, without the user's or the system's config. */

import { execFileSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';

/** The environment a test's git runs in: none of the user's settings, and a fixed author. */
export function testGitEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith('GIT_') && name !== 'XDG_CONFIG_HOME') {
      env[name] = value;
    }
  }
  return {
    ...env,
    HOME: tmpdir(),
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Lo test',
    GIT_AUTHOR_EMAIL: 'test@lo.invalid',
    GIT_COMMITTER_NAME: 'Lo test',
    GIT_COMMITTER_EMAIL: 'test@lo.invalid',
    LC_ALL: 'C',
  };
}

/**
 * The most input git is given through a pipe. Past it, git reads a file: on macOS 27, Node's
 * `execFileSync` can stall for good while it writes megabytes to a pipe, with git waiting in
 * `read` for the rest and Node waiting in `kevent` for the pipe to drain. (`git hash-object -w
 * --stdin` fed 10 MiB, many times, stalled within a hundred runs; the same input read from a file,
 * or written by an asynchronous `spawn`, never did.) A test can't time such a call out, since its
 * timer can't run while the call is stuck.
 */
const PIPED = 64 * 1024;

/** Runs `run` with a read-only file descriptor on `input`, in a file made for it and removed after. */
function fromFile<T>(input: Uint8Array | string, run: (stdin: number) => T): T {
  const folder = mkdtempSync(join(tmpdir(), 'lo-git-input-'));
  try {
    const path = join(folder, 'input');
    writeFileSync(path, input);
    const stdin = openSync(path, 'r');
    try {
      return run(stdin);
    } finally {
      closeSync(stdin);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Runs git in `dir` with `args`, and returns its output as bytes. Throws with git's message. */
export function gitBytes(
  dir: string,
  args: readonly string[],
  input?: Uint8Array | string,
): Buffer {
  const run = (stdin: 'pipe' | number, piped?: Uint8Array | string) =>
    execFileSync('git', args, {
      cwd: dir,
      env: testGitEnvironment(),
      input: piped,
      stdio: [stdin, 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    });
  try {
    return input !== undefined && Buffer.byteLength(input) > PIPED
      ? fromFile(input, (stdin) => run(stdin))
      : run('pipe', input);
  } catch (error) {
    const stderr =
      error instanceof Error && 'stderr' in error && Buffer.isBuffer(error.stderr)
        ? error.stderr.toString('utf8').trim()
        : String(error);
    throw new Error(`git ${args.join(' ')} in ${dir} failed: ${stderr}`, {
      cause: error,
    });
  }
}

/** Runs git in `dir` with `args`, and returns its output as text, trimmed. */
export function git(dir: string, ...args: string[]): string {
  return gitBytes(dir, args).toString('utf8').trim();
}

/** The `git` on `PATH`, as an absolute path, for tests that need a real git to wrap or compare. */
export function gitProgram(): string {
  const found = execFileSync('sh', ['-c', 'command -v git'], {
    env: testGitEnvironment(),
    encoding: 'utf8',
  }).trim();
  if (!found.startsWith('/')) throw new Error(`the tests need git on PATH, not ${found}`);
  return found;
}
