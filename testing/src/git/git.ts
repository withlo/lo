/** A test's own git: the `git` on `PATH`, without the user's or the system's config. */

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The environment a test's git runs in: none of the user's settings, and a fixed author. A script
 * that runs `git`, as the fixtures do, runs {@link gitProgram}.
 */
export function testGitEnvironment(): Record<string, string> {
  const env = withoutSettings();
  const { folder } = gitFound();
  if (folder !== undefined) env.PATH = `${folder}${delimiter}${env.PATH ?? ''}`;
  return env;
}

/** {@link testGitEnvironment}, but for `PATH`, which is this process's. */
function withoutSettings(): Record<string, string> {
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
    // No gc or maintenance in the background, which git starts after a big commit or fetch: it
    // takes the machine's time from the tests, and writes in folders they're removing.
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'gc.auto',
    GIT_CONFIG_VALUE_0: '0',
    GIT_CONFIG_KEY_1: 'maintenance.auto',
    GIT_CONFIG_VALUE_1: 'false',
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
    execFileSync(gitProgram(), args, {
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

/** Apple's `git`, which runs the developer tools' git: Xcode's, or the Command Line Tools'. */
const APPLE_GIT = '/usr/bin/git';

/** Where the tests keep folders of their own for `PATH`, each holding only a link named `git`. */
const LINKS = fileURLToPath(new URL('../../../node_modules/.cache/lo-testing/', import.meta.url));

/** The tests' git, and the folder that puts it first on `PATH`, if `PATH` has another first. */
interface Found {
  readonly program: string;
  readonly folder: string | undefined;
}

let found: Found | undefined;

/**
 * The `git` on `PATH`, as an absolute path, for tests that run a real git, wrap it or compare with
 * it. On a Mac, where that's Apple's, it's the git Apple's runs: Apple's looks up the developer
 * tools each time it runs, which makes a short git command take three times as long, and the
 * tests run thousands.
 */
export function gitProgram(): string {
  return gitFound().program;
}

/** {@link gitProgram}, found once for each test file, and for Apple's, its folder. */
function gitFound(): Found {
  if (found !== undefined) return found;
  const env = withoutSettings();
  const onPath = execFileSync('sh', ['-c', 'command -v git'], { env, encoding: 'utf8' }).trim();
  if (!onPath.startsWith('/')) throw new Error(`the tests need git on PATH, not ${onPath}`);
  if (process.platform !== 'darwin' || onPath !== APPLE_GIT) {
    found = { program: onPath, folder: undefined };
    return found;
  }
  const program = execFileSync('xcrun', ['--find', 'git'], { env, encoding: 'utf8' }).trim();
  const folder = join(LINKS, createHash('sha256').update(program).digest('hex').slice(0, 16));
  const link = join(folder, 'git');
  if (linkTarget(link) !== program) {
    // Made beside it and moved into place, so a file starting meanwhile never finds it half made.
    mkdirSync(folder, { recursive: true });
    const made = join(folder, `git-${process.pid}-${randomUUID()}`);
    symlinkSync(program, made);
    renameSync(made, link);
  }
  found = { program, folder };
  return found;
}

function linkTarget(path: string): string | undefined {
  try {
    return readlinkSync(path);
  } catch {
    return undefined;
  }
}
