import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Cache, DEFAULT_CAP, type GitStatus } from '@lo/git';
import { gitProgram } from '@lo/testing/git';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  cacheFolder,
  createGit,
  curlProxy,
  type GitOptions,
  gitSettings,
  GitStopped,
  onceUp,
} from './git.ts';

/** A new folder, removed when the test ends. */
function folder(): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'lo-main-git-')));
  onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

/** An executable shell script at `path`. */
function script(path: string, body: string): string {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** Git for main, with the test's git, a cache in a new folder, and no cleanup unless `options` say. */
function testGit(options: Partial<GitOptions> = {}) {
  const lines: string[] = [];
  const root = join(folder(), 'cache');
  const git = createGit({
    settings: { program: gitProgram() },
    root,
    env: process.env,
    platform: process.platform,
    log: (line) => lines.push(line),
    cleanUp: () => Promise.resolve(),
    ...options,
  });
  onTestFinished(() => git.stop());
  return { git, root, lines };
}

describe('gitSettings', () => {
  const env = { LO_GIT: '/opt/test/git', LO_GIT_REMOTE: 'http://127.0.0.1:8080' };

  it('takes a test git and remote in a build run from source', () => {
    expect(gitSettings({ packaged: false, env })).toEqual({
      program: '/opt/test/git',
      test: { remote: 'http://127.0.0.1:8080' },
    });
    expect(gitSettings({ packaged: false, env: { LO_GIT: 'none' } })).toEqual({
      program: 'none',
      test: undefined,
    });
  });

  it('ignores both in a packaged build', () => {
    expect(gitSettings({ packaged: true, env })).toEqual({});
  });

  it('finds git and fetches from GitHub when neither is set, or set empty', () => {
    const none = { program: undefined, test: undefined };
    expect(gitSettings({ packaged: false, env: {} })).toEqual(none);
    expect(gitSettings({ packaged: false, env: { LO_GIT: '', LO_GIT_REMOTE: '' } })).toEqual(none);
  });

  it('refuses a git that isn’t an absolute path, and a remote that isn’t an address', () => {
    expect(() => gitSettings({ packaged: false, env: { LO_GIT: 'git' } })).toThrow(
      'LO_GIT must be an absolute path or "none"',
    );
    expect(() => gitSettings({ packaged: false, env: { LO_GIT_REMOTE: 'nowhere' } })).toThrow(
      'LO_GIT_REMOTE must be an address',
    );
  });
});

describe('cacheFolder', () => {
  const home = '/home/me';

  it('is Lo in the system’s caches, wherever a packaged build is told to keep its data', () => {
    const env = { LO_USER_DATA_DIR: '/tmp/lo', XDG_CACHE_HOME: '/var/cache/me' };
    expect(cacheFolder({ packaged: true, platform: 'darwin', home: '/Users/me', env })).toBe(
      '/Users/me/Library/Caches/Lo',
    );
    expect(cacheFolder({ packaged: true, platform: 'linux', home, env })).toBe('/var/cache/me/Lo');
    expect(cacheFolder({ packaged: true, platform: 'linux', home, env: {} })).toBe(
      '/home/me/.cache/Lo',
    );
    // Only an absolute XDG_CACHE_HOME counts.
    const relative = { XDG_CACHE_HOME: 'cache' };
    expect(cacheFolder({ packaged: true, platform: 'linux', home, env: relative })).toBe(
      '/home/me/.cache/Lo',
    );
  });

  it('is Lo Dev for a build run from source, or in its LO_USER_DATA_DIR', () => {
    expect(cacheFolder({ packaged: false, platform: 'linux', home, env: {} })).toBe(
      '/home/me/.cache/Lo Dev',
    );
    expect(
      cacheFolder({
        packaged: false,
        platform: 'darwin',
        home,
        env: { LO_USER_DATA_DIR: '/tmp/lo' },
      }),
    ).toBe('/tmp/lo/cache');
  });
});

describe('curlProxy', () => {
  it('goes direct where Chromium does', () => {
    expect(curlProxy('DIRECT')).toBe(undefined);
    expect(curlProxy('')).toBe(undefined);
  });

  it('takes the first proxy curl can use, in curl’s words', () => {
    expect(curlProxy('PROXY proxy.example:3128; DIRECT')).toBe('http://proxy.example:3128');
    expect(curlProxy('HTTPS proxy.example:443')).toBe('https://proxy.example:443');
    expect(curlProxy('SOCKS5 127.0.0.1:1080')).toBe('socks5h://127.0.0.1:1080');
    expect(curlProxy('SOCKS 10.0.0.1:1080')).toBe('socks4://10.0.0.1:1080');
    expect(curlProxy('QUIC proxy.example:443; PROXY other.example:8080')).toBe(
      'http://other.example:8080',
    );
  });

  it('never makes an address of anything else', () => {
    expect(curlProxy('PROXY user@proxy.example:3128')).toBe(undefined);
    expect(curlProxy('PROXY proxy.example')).toBe(undefined);
    expect(curlProxy('PROXY proxy.example:3128/path')).toBe(undefined);
    expect(curlProxy('QUIC proxy.example:443')).toBe(undefined);
  });
});

/**
 * The real git, noting each process it runs as, which waits half a minute before the command
 * `slow`, a `case` pattern, matches, having made `started`.
 */
function slowGit(slow: string) {
  const dir = folder();
  const tmp = join(dir, 'tmp');
  mkdirSync(tmp);
  // Where the look makes the throwaway clone it asks git about.
  vi.stubEnv('TMPDIR', tmp);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const [pids, started] = [join(dir, 'pids'), join(dir, 'started')];
  const program = script(
    join(dir, 'git'),
    [
      `echo $$ >> '${pids}'`,
      `case " $* " in ${slow}) /usr/bin/touch '${started}'; /bin/sleep 30;; esac`,
      `exec '${gitProgram()}' "$@"`,
    ].join('\n'),
  );
  const ran = () => readFileSync(pids, 'utf8').trim().split('\n').map(Number);
  return { program, started, tmp, ran };
}

describe('createGit', () => {
  it('looks for nothing until asked, then finds git, says so, and opens the cache', async () => {
    const opened: Cache[] = [];
    const { git, root } = testGit({
      cleanUp: (cache) => {
        opened.push(cache);
        return Promise.resolve();
      },
    });
    const heard: GitStatus[] = [];
    git.onStatus((status) => heard.push(status));
    expect(git.status).toBe(undefined);
    expect(existsSync(root)).toBe(false);

    const status = await git.check();

    expect(status.status).toBe('found');
    expect(git.status).toBe(status);
    expect(heard).toEqual([status]);
    expect(git.cache?.root).toBe(root);
    expect(existsSync(join(root, 'lo-cache.lock'))).toBe(true);
    // Cleanup runs once the cache is open.
    await expect.poll(() => opened).toEqual([git.cache]);
  });

  it('hands the cache to each feature waiting for it once it opens, or at once once it has', async () => {
    const { git } = testGit();
    const early: Cache[] = [];
    const gone: Cache[] = [];
    git.onCache((cache) => early.push(cache));
    const stop = git.onCache((cache) => gone.push(cache));
    stop();
    // One that fails is only noted: the cache still opens, and the others still hear.
    git.onCache(() => {
      throw new Error('a feature that fails');
    });

    await git.check();

    expect(early).toEqual([git.cache]);
    expect(gone).toEqual([]);
    const late: Cache[] = [];
    git.onCache((cache) => late.push(cache));
    expect(late).toEqual([git.cache]);
    // Looking again opens nothing new.
    await git.check();
    expect(early).toHaveLength(1);
  });

  it('runs no git with LO_GIT=none, and opens no cache', async () => {
    const { git, root } = testGit({ settings: { program: 'none' } });

    expect(await git.check()).toMatchObject({ status: 'missing', message: "Lo can't find git." });

    expect(git.cache).toBe(undefined);
    expect(existsSync(root)).toBe(false);
  });

  it('says a git is too old, and opens no cache', async () => {
    const old = script(join(folder(), 'git'), "echo 'git version 2.30.0'");
    const { git, root } = testGit({ settings: { program: old } });

    expect(await git.check()).toMatchObject({
      status: 'tooOld',
      version: { major: 2, minor: 30, patch: 0 },
      check: 'version',
    });

    expect(git.cache).toBe(undefined);
    expect(existsSync(root)).toBe(false);
  });

  it('finds a git again when asked, and opens the cache then', async () => {
    const program = join(folder(), 'git');
    const { git } = testGit({ settings: { program } });
    expect((await git.check()).status).toBe('missing');

    script(program, `exec '${gitProgram()}' "$@"`);

    expect((await git.check()).status).toBe('found');
    expect(git.cache).toBeDefined();
  });

  it('looks once for checks asked at once', async () => {
    const { git } = testGit();
    const [first, second] = await Promise.all([git.check(), git.check()]);
    expect(first).toBe(second);
  });

  it('never waits for cleanup, and only notes it when cleanup fails', async () => {
    const waiting = testGit({ cleanUp: () => new Promise(() => undefined) });
    expect((await waiting.git.check()).status).toBe('found');
    expect(waiting.git.cache).toBeDefined();

    const failing = testGit({ cleanUp: () => Promise.reject(new Error('the disk is on fire')) });
    expect((await failing.git.check()).status).toBe('found');
    await expect
      .poll(() => failing.lines)
      .toContain("can't clean up the cache: the disk is on fire");
  });

  it('notes a cache it can’t open, and goes on without one', async () => {
    const blocked = join(folder(), 'file');
    writeFileSync(blocked, '');
    const { git, lines } = testGit({ root: join(blocked, 'cache') });

    expect((await git.check()).status).toBe('found');

    expect(git.cache).toBe(undefined);
    expect(lines.some((line) => line.startsWith("can't open the cache at "))).toBe(true);
  });

  it('keeps the cache under the cap main sets, before it opens and after', async () => {
    const { git } = testGit();
    await git.setCap(5 * 1024 ** 3);
    await git.check();
    expect(git.cache?.cap).toBe(5 * 1024 ** 3);

    await git.setCap(DEFAULT_CAP);
    expect(git.cache?.cap).toBe(DEFAULT_CAP);

    for (const cap of [0, -1, 1.5, Number.NaN])
      await expect(git.setCap(cap)).rejects.toThrow(RangeError);
  });

  it('stops the cache as Lo quits, and runs no git after', async () => {
    const { git, root } = testGit();
    await git.check();

    await git.stop();

    expect(git.cache).toBe(undefined);
    expect(existsSync(join(root, 'lo-cache.lock'))).toBe(false);
    // Looking again is refused, and runs nothing.
    await expect(git.check()).rejects.toBeInstanceOf(GitStopped);
    expect(git.cache).toBe(undefined);
    expect(existsSync(join(root, 'lo-cache.lock'))).toBe(false);
  });

  it('looks for nothing once stopped', async () => {
    const dir = folder();
    const program = script(
      join(dir, 'git'),
      `echo ran >> '${dir}/ran'; exec '${gitProgram()}' "$@"`,
    );
    const { git } = testGit({ settings: { program } });

    await git.stop();

    await expect(git.check()).rejects.toBeInstanceOf(GitStopped);
    expect(existsSync(join(dir, 'ran'))).toBe(false);
  });

  describe('stopping while it looks stops the look’s git at once, and leaves nothing behind', () => {
    it.each([
      ['asking it its version', '*" --version "*', 0],
      ['asking whether it can be kept from downloading', '*" mktree "*', 1],
    ])('while %s', async (_, pattern, clones) => {
      const slow = slowGit(pattern);
      const { git, root } = testGit({ settings: { program: slow.program } });
      const looking = git.check();
      await expect.poll(() => existsSync(slow.started)).toBe(true);
      const throwaway = () => readdirSync(slow.tmp).filter((name) => name.startsWith('lo-git-'));
      expect(throwaway()).toHaveLength(clones);

      const began = Date.now();
      await git.stop();

      // Well within the half minute the git would take.
      expect(Date.now() - began).toBeLessThan(3000);
      await expect(looking).rejects.toBeInstanceOf(GitStopped);
      expect(slow.ran().filter((pid) => !groupGone(pid))).toEqual([]);
      expect(throwaway()).toEqual([]);
      expect(git.status).toBe(undefined);
      expect(existsSync(root)).toBe(false);
    });
  });
});

describe('onceUp', () => {
  it('looks once the window is up, and only once', () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const look = vi.fn<() => void>();
    let up: (() => void) | undefined;

    onceUp((ready) => (up = ready), look, 3000);
    expect(look).not.toHaveBeenCalled();
    up?.();
    expect(look).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    up?.();
    expect(look).toHaveBeenCalledTimes(1);
  });

  it('looks anyway when the window never says it’s up', () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const look = vi.fn<() => void>();

    onceUp(() => undefined, look, 3000);
    vi.advanceTimersByTime(2999);
    expect(look).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(look).toHaveBeenCalledTimes(1);
  });
});

/** Whether nothing is left running in the group `pid` led. */
function groupGone(pid: number): boolean {
  try {
    process.kill(-pid, 0);
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH';
  }
  // Something is in the group: only a process that has exited and waits to be collected, as one
  // whose parent exited first does until the system collects it, isn't running.
  return execFileSync('ps', ['-A', '-o', 'pgid=,stat='], { encoding: 'utf8' })
    .split('\n')
    .every((line) => {
      const [group, state = ''] = line.trim().split(/\s+/);
      return Number(group) !== pid || state.startsWith('Z');
    });
}
