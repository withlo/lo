/** A test's own git: the `git` on `PATH`, without the user's or the system's config. */

import { execFileSync } from 'node:child_process';
import { devNull, tmpdir } from 'node:os';

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

/** Runs git in `dir` with `args`, and returns its output as bytes. Throws with git's message. */
export function gitBytes(
  dir: string,
  args: readonly string[],
  input?: Uint8Array | string,
): Buffer {
  try {
    return execFileSync('git', args, {
      cwd: dir,
      env: testGitEnvironment(),
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    });
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
