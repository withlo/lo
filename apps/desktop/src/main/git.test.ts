import type * as fs from 'node:fs';
import type * as fsPromises from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { type Cache, DEFAULT_CAP, type GitStatus } from '@lo/git';
import { gitProgram } from '@lo/testing/git';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  cacheFolder,
  clearFormerCache,
  clearOldDataCache,
  createGit,
  curlProxy,
  formerCacheFolder,
  type GitOptions,
  gitSettings,
  GitStopped,
  macCaches,
  oldDataCache,
  onceUp,
  whyNotCaches,
} from './git.ts';
import { StartupError } from './startup.ts';

/**
 * What a test puts in place of the file system's calls, to make happen what otherwise only a race
 * would: where a path really leads, a move, or a deletion that waits.
 */
const fakes = vi.hoisted(() => ({
  realpath: undefined as ((path: string) => string | undefined) | undefined,
  rename: undefined as ((from: string, to: string) => Promise<boolean>) | undefined,
  rm: undefined as ((path: string) => Promise<void>) | undefined,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  const resolve = Object.assign(
    (path: fs.PathLike, options?: fs.EncodingOption) =>
      fakes.realpath?.(String(path)) ?? actual.realpathSync(path, options),
    { native: actual.realpathSync.native },
  );
  return { ...actual, realpathSync: resolve };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>();
  return {
    ...actual,
    // A fake that says it did the move itself, or leaves it to the real one.
    rename: async (from: fs.PathLike, to: fs.PathLike) => {
      if (!(await fakes.rename?.(String(from), String(to)))) await actual.rename(from, to);
    },
    rm: async (path: fs.PathLike, options?: fs.RmOptions) => {
      await fakes.rm?.(String(path));
      await actual.rm(path, options);
    },
  };
});

/** Puts `fake` in place of the file system's `name` until the test ends. */
function fake<Name extends keyof typeof fakes>(name: Name, value: (typeof fakes)[Name]): void {
  fakes[name] = value;
  onTestFinished(() => {
    fakes[name] = undefined;
  });
}

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

/** The Mac's folder for caches, in a test that asks for it. */
const mac = () => '/private/var/folders/ab/cd/C';

/** The Mac's folder for caches, in a test that never asks for it. */
function never(): string {
  throw new Error('macOS was asked');
}

describe('cacheFolder', () => {
  const home = '/home/me';

  it('is Lo in the system’s caches, wherever a packaged build is told to keep its data', () => {
    const env = { LO_USER_DATA_DIR: '/tmp/lo', XDG_CACHE_HOME: '/var/cache/me' };
    // Never in the home folder on a Mac, whatever the environment says.
    expect(
      cacheFolder({ packaged: true, platform: 'darwin', home: '/Users/me', env, macFolder: mac }),
    ).toBe('/private/var/folders/ab/cd/C/Lo');
    expect(cacheFolder({ packaged: true, platform: 'linux', home, env, macFolder: never })).toBe(
      '/var/cache/me/Lo',
    );
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
      cacheFolder({ packaged: false, platform: 'darwin', home, env: {}, macFolder: mac }),
    ).toBe('/private/var/folders/ab/cd/C/Lo Dev');
    expect(
      cacheFolder({
        packaged: false,
        platform: 'darwin',
        home,
        env: { LO_USER_DATA_DIR: '/tmp/lo' },
        macFolder: never,
      }),
    ).toBe('/tmp/lo/lo-cache');
  });

  it('in LO_USER_DATA_DIR, shares no name with a folder Chromium keeps there, in any case', () => {
    // A Mac's disk, by default, takes `cache` and Chromium's `Cache` for one folder.
    const chromium = [
      'Cache',
      'Code Cache',
      'GPUCache',
      'DawnGraphiteCache',
      'DawnWebGPUCache',
      'Shared Dictionary',
      'Local Storage',
      'Session Storage',
      'blob_storage',
      'Network',
      'Partitions',
      'Crashpad',
    ];
    for (const platform of ['darwin', 'linux'] as const) {
      const env = { LO_USER_DATA_DIR: '/tmp/lo' };
      const cache = cacheFolder({ packaged: false, platform, home, env, macFolder: never });
      expect(dirname(cache)).toBe('/tmp/lo');
      expect(chromium.map((name) => name.toLowerCase())).not.toContain(
        basename(cache).toLowerCase(),
      );
    }
  });
});

/** This test's user. */
const uid = process.getuid?.() ?? -1;

/** A folder for caches as macOS makes it, reached through a link as `/var` is. */
function userCaches() {
  const dir = folder();
  mkdirSync(join(dir, 'private', 'C'), { recursive: true, mode: 0o700 });
  symlinkSync('private', join(dir, 'var'));
  const given = join(dir, 'var', 'C');
  return { said: `${given}/\n`, given, real: join(dir, 'private', 'C') };
}

/** A `getconf` that fails. */
function broken(): string {
  throw new Error('getconf: no such variable');
}

/** What `start` threw a {@link StartupError} for. */
function refusal(start: () => unknown): unknown {
  try {
    start();
  } catch (error) {
    if (error instanceof StartupError) return error.failure;
    throw error;
  }
  return undefined;
}

describe('macCaches', () => {
  it('asks getconf, by its path, and gives the folder’s real path', () => {
    const { said, real } = userCaches();
    const asked: string[][] = [];
    const run = (program: string, args: readonly string[]) => {
      asked.push([program, ...args]);
      return said;
    };
    expect(macCaches({ run, uid })).toBe(real);
    expect(asked).toEqual([['/usr/bin/getconf', 'DARWIN_USER_CACHE_DIR']]);
  });

  it('refuses a folder that won’t do, and an answer it can’t get, rather than go elsewhere', () => {
    const { said, given, real } = userCaches();
    chmodSync(real, 0o777);
    expect(() => macCaches({ run: () => said, uid })).toThrow(StartupError);
    expect(refusal(() => macCaches({ run: () => said, uid }))).toEqual({
      kind: 'cacheFolder',
      why: 'writable',
      path: given,
    });
    expect(refusal(() => macCaches({ run: broken, uid }))).toEqual({
      kind: 'cacheFolder',
      why: 'noLocation',
      said: 'getconf: no such variable',
    });
  });

  it('checks the real path it gives, not only the one getconf named', () => {
    const { said } = userCaches();
    // Where the named folder really leads, as a link swapped in after the check would make it.
    const elsewhere = folder();
    chmodSync(elsewhere, 0o777);
    fake('realpath', (path) => (path === said.slice(0, -1) ? elsewhere : undefined));
    expect(refusal(() => macCaches({ run: () => said, uid }))).toMatchObject({
      why: 'writable',
      path: elsewhere,
    });
  });

  it.runIf(process.platform === 'darwin')('finds this user’s folder for caches', () => {
    // Only reads: it looks at the folder, and nothing in it.
    expect(macCaches()).toMatch(/^\/private\/var\/folders\/[^/]+\/[^/]+\/C$/);
  });
});

describe('whyNotCaches', () => {
  it('takes a folder of the user’s own that nobody else can change', () => {
    const dir = folder();
    for (const mode of [0o700, 0o755]) {
      chmodSync(dir, mode);
      expect(whyNotCaches(dir, uid)).toBe(undefined);
      expect(whyNotCaches(`${dir}/`, uid)).toBe(undefined);
    }
  });

  it('refuses anything else', () => {
    const dir = folder();
    const file = join(dir, 'file');
    writeFileSync(file, '');
    const link = join(dir, 'link');
    symlinkSync(dir, link);
    for (const path of ['cache', '', '/Users/me/../other']) {
      expect(whyNotCaches(path, uid)).toEqual({ why: 'noLocation', said: JSON.stringify(path) });
    }
    expect(whyNotCaches(join(dir, 'missing'), uid)).toMatchObject({
      why: 'missing',
      path: join(dir, 'missing'),
      said: expect.stringMatching(/ENOENT/),
    });
    expect(whyNotCaches(file, uid)).toEqual({ why: 'notFolder', path: file });
    // Even with the slash that would have the link followed.
    expect(whyNotCaches(link, uid)).toEqual({ why: 'link', path: link });
    expect(whyNotCaches(`${link}/`, uid)).toEqual({ why: 'link', path: link });
    expect(whyNotCaches(dir, uid + 1)).toEqual({ why: 'owner', path: dir });
    for (const mode of [0o770, 0o702]) {
      chmodSync(dir, mode);
      expect(whyNotCaches(dir, uid)).toEqual({ why: 'writable', path: dir });
    }
  });
});

describe('formerCacheFolder', () => {
  const home = '/Users/me';

  it('is where a Mac’s cache was, in Library/Caches', () => {
    const env = { LO_USER_DATA_DIR: '/tmp/lo' };
    expect(formerCacheFolder({ packaged: true, platform: 'darwin', home, env })).toBe(
      '/Users/me/Library/Caches/Lo',
    );
    expect(formerCacheFolder({ packaged: false, platform: 'darwin', home, env: {} })).toBe(
      '/Users/me/Library/Caches/Lo Dev',
    );
  });

  it('is none where the cache hasn’t moved, or moved only within LO_USER_DATA_DIR', () => {
    expect(formerCacheFolder({ packaged: true, platform: 'linux', home, env: {} })).toBe(undefined);
    const env = { LO_USER_DATA_DIR: '/tmp/lo' };
    expect(formerCacheFolder({ packaged: false, platform: 'darwin', home, env })).toBe(undefined);
    // There, the one an earlier build kept is `cache`, whose folders Lo made go.
    expect(oldDataCache({ packaged: false, platform: 'darwin', home, env })).toBe('/tmp/lo/cache');
    expect(oldDataCache({ packaged: true, platform: 'darwin', home, env })).toBe(undefined);
    expect(oldDataCache({ packaged: false, platform: 'linux', home, env: {} })).toBe(undefined);
  });
});

describe('clearOldDataCache', () => {
  it('removes only what Lo made in the cache it kept in LO_USER_DATA_DIR, never Chromium’s', async () => {
    const data = folder();
    const old = join(data, 'cache');
    for (const name of [
      'repos/github.com/owner/repo.git',
      'checkouts/github.com/owner/repo/pull-1',
      'code/homes/owner/repo/typescript',
      'servers/vtsls/1',
      'git-env/home',
      'tmp',
    ]) {
      mkdirSync(join(old, name), { recursive: true });
    }
    // Chromium's own, the same folder on a Mac's disk.
    mkdirSync(join(old, 'Cache_Data'));
    writeFileSync(join(old, 'Cache_Data', 'index'), 'chromium');
    // A link where Lo's toolchains were goes, and what it leads to stays.
    const elsewhere = folder();
    writeFileSync(join(elsewhere, 'kept'), '');
    symlinkSync(elsewhere, join(old, 'toolchains'));
    const root = join(data, 'lo-cache');
    mkdirSync(join(root, 'tmp'), { recursive: true });
    const cache = {
      root,
      temporaryPath: (extension: string) => join(root, 'tmp', `${randomUUID()}${extension}`),
      trash: async (path: string) => {
        await rm(path, { recursive: true, force: true });
        return true;
      },
    };
    const lines: string[] = [];
    const clear = () => clearOldDataCache(cache, old, { log: (line) => lines.push(line) });

    expect(await clear()).toBe(true);
    expect(readdirSync(old)).toEqual(['Cache_Data']);
    expect(readFileSync(join(old, 'Cache_Data', 'index'), 'utf8')).toBe('chromium');
    expect(readdirSync(elsewhere)).toEqual(['kept']);
    expect(readdirSync(join(root, 'tmp'))).toEqual([]);
    expect(lines).toEqual([`removed what an earlier Lo kept in ${old}`]);
    // With none of Lo's left, nothing is written there, not even a lock.
    expect(await clear()).toBe(true);
    expect(readdirSync(old)).toEqual(['Cache_Data']);
    expect(lines).toHaveLength(1);
  });
});

/** A cache an earlier Lo left in a home folder, and the new cache, elsewhere. */
function earlier() {
  const home = folder();
  const former = join(home, 'Library', 'Caches', 'Lo');
  for (const name of ['git-env/home', 'tmp', 'repos/github.com/owner/repo.git', 'servers/x/1']) {
    mkdirSync(join(former, name), { recursive: true });
  }
  writeFileSync(join(former, 'repos/github.com/owner/repo.git/HEAD'), 'ref: refs/heads/main\n');
  const root = join(folder(), 'C', 'Lo');
  mkdirSync(join(root, 'tmp'), { recursive: true });
  const trashed: string[] = [];
  const cache = {
    root,
    temporaryPath: (extension: string) => join(root, 'tmp', `${randomUUID()}${extension}`),
    trash: async (path: string) => {
      trashed.push(path);
      await rm(path, { recursive: true, force: true });
      return true;
    },
  };
  const lines: string[] = [];
  const clear = (path = former, user?: number) =>
    clearFormerCache(cache, path, { log: (line) => lines.push(line), uid: user });
  return { home, former, root, trashed, lines, clear };
}

/**
 * Another process holding the cache lock at `path`, as another Lo would, with `@lo/git`'s own
 * code, until it's told to end, when it leaves the lock behind as a crash would.
 */
async function otherLo(path: string) {
  const code = [
    `import { lockCache } from ${JSON.stringify(import.meta.resolve('@lo/git'))};`,
    `await lockCache(${JSON.stringify(path)});`,
    "console.log('locked');",
    'process.stdin.resume();',
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  onTestFinished(() => {
    child.kill();
  });
  const ended = new Promise((resolve) => child.once('close', resolve));
  const said = await new Promise<string>((resolve) => {
    child.stdout.once('data', (data: Buffer) => resolve(data.toString('utf8').trim()));
  });
  expect(said).toBe('locked');
  return {
    pid: child.pid,
    end: async () => {
      child.stdin.end();
      await ended;
    },
  };
}

describe('clearFormerCache', () => {
  it('moves it into the cache’s tmp, and has the cache delete it', async () => {
    const { home, former, root, trashed, lines, clear } = earlier();

    expect(await clear()).toBe(true);

    expect(existsSync(former)).toBe(false);
    expect(trashed).toHaveLength(1);
    expect(trashed[0]?.startsWith(join(root, 'tmp'))).toBe(true);
    expect(readdirSync(join(root, 'tmp'))).toEqual([]);
    expect(readdirSync(join(home, 'Library', 'Caches'))).toEqual([]);
    expect(lines).toEqual([`removed the cache an earlier Lo kept at ${former}`]);
    // With nothing there, there's nothing to do.
    expect(await clear()).toBe(true);
    expect(lines).toHaveLength(1);
  });

  it('leaves it while another Lo has it open, and takes it once that Lo is gone', async () => {
    const { former, lines, clear } = earlier();
    const lock = join(former, 'lo-cache.lock');
    const other = await otherLo(lock);

    expect(await clear()).toBe(false);
    expect(existsSync(join(former, 'repos/github.com/owner/repo.git/HEAD'))).toBe(true);
    expect(lines).toEqual([
      `leaving ${former} for now: another program, process ${other.pid}, is using ${lock}`,
    ]);

    // Gone without letting go, as after a crash: its lock is no one's.
    await other.end();
    expect(existsSync(lock)).toBe(true);
    expect(await clear()).toBe(true);
    expect(existsSync(former)).toBe(false);
  });

  it('never takes the cache it has open, though a link above makes it look like the earlier one', async () => {
    const { home, root, lines, clear } = earlier();
    // The new cache, open and locked as Lo has it, and `~/Library/Caches` a link to its folder.
    mkdirSync(join(root, 'git-env'));
    const lock = join(root, 'lo-cache.lock');
    writeFileSync(lock, `lo-cache 2\n${process.pid}\nThu Jan  1 00:00:00 1970\n`);
    const caches = join(home, 'Library', 'Caches');
    rmSync(caches, { recursive: true });
    symlinkSync(join(root, '..'), caches);

    expect(await clear(join(caches, 'Lo'))).toBe(false);

    expect(existsSync(lock)).toBe(true);
    expect(readdirSync(root).toSorted()).toEqual(['git-env', 'lo-cache.lock', 'tmp']);
    expect(lines).toEqual([
      `not removing ${join(caches, 'Lo')}, which may be the cache Lo has open, hold it or be in it`,
    ]);
    // Nor a folder holding it, nor one in it.
    expect(await clear(join(root, '..'))).toBe(false);
    expect(await clear(join(root, 'tmp'))).toBe(false);
    expect(existsSync(lock)).toBe(true);
  });

  it('deletes it where it is when it’s on another volume, never through a link', async () => {
    const { home, former, root, trashed, lines, clear } = earlier();
    const outside = join(home, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep'), 'mine');
    symlinkSync(outside, join(former, 'linked'));
    fake('rename', (from) => {
      if (from !== former) return Promise.resolve(false);
      return Promise.reject(Object.assign(new Error('cross-device link'), { code: 'EXDEV' }));
    });

    expect(await clear()).toBe(true);

    expect(existsSync(former)).toBe(false);
    expect(readFileSync(join(outside, 'keep'), 'utf8')).toBe('mine');
    expect(trashed).toEqual([]);
    expect(readdirSync(join(root, 'tmp'))).toEqual([]);
    expect(lines).toEqual([`removed the cache an earlier Lo kept at ${former}`]);
  });

  it('puts back what took its place, outside the cache’s tmp, and deletes none of it', async () => {
    const { home, former, root, trashed, lines, clear } = earlier();
    const caches = join(home, 'Library', 'Caches');
    const real = join(home, 'real');
    // Just as it's moved, something else takes its place, and something else again after.
    fake('rename', (from, to) => {
      if (from !== former) return Promise.resolve(false);
      renameSync(former, real);
      mkdirSync(former);
      writeFileSync(join(former, 'theirs'), 'theirs');
      renameSync(former, to);
      mkdirSync(former);
      writeFileSync(join(former, 'next'), 'next');
      return Promise.resolve(true);
    });

    expect(await clear()).toBe(false);

    expect(trashed).toEqual([]);
    expect(readdirSync(join(root, 'tmp'))).toEqual([]);
    expect(existsSync(join(real, 'git-env'))).toBe(true);
    const kept = readdirSync(caches).filter((name) => name.startsWith('Lo.'));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(caches, kept[0] ?? '', 'theirs'), 'utf8')).toBe('theirs');
    expect(readFileSync(join(former, 'next'), 'utf8')).toBe('next');
    expect(lines).toEqual([
      `not removing what took the place of the cache an earlier Lo kept, now at ${join(caches, kept[0] ?? '')}`,
    ]);
  });

  it('never follows a link, nor removes what isn’t a cache Lo left', async () => {
    const { home, former, trashed, clear } = earlier();
    const caches = join(home, 'Library', 'Caches');
    // A cache moved elsewhere, with a link left in its place.
    const moved = join(home, 'moved');
    rmSync(former, { recursive: true });
    mkdirSync(join(moved, 'git-env'), { recursive: true });
    mkdirSync(join(moved, 'tmp'));
    symlinkSync(moved, former);
    expect(await clear()).toBe(false);
    expect(existsSync(join(moved, 'git-env'))).toBe(true);
    rmSync(former);

    // Something else of the same name, a file or a folder without a cache's folders, or with a
    // link for one.
    writeFileSync(former, 'notes');
    expect(await clear()).toBe(false);
    rmSync(former);
    mkdirSync(join(former, 'tmp'), { recursive: true });
    writeFileSync(join(former, 'notes.txt'), 'mine');
    expect(await clear()).toBe(false);
    symlinkSync(moved, join(former, 'git-env'));
    expect(await clear()).toBe(false);
    expect(readdirSync(former).toSorted()).toEqual(['git-env', 'notes.txt', 'tmp']);
    expect(existsSync(join(moved, 'git-env'))).toBe(true);
    expect(trashed).toEqual([]);
    expect(readdirSync(caches)).toEqual(['Lo']);
  });

  it('never removes another user’s folder', async () => {
    const { former, clear } = earlier();
    expect(await clear(former, uid + 1)).toBe(false);
    expect(existsSync(join(former, 'git-env'))).toBe(true);
  });

  it('deletes it as the cache deletes its own, so closing the cache waits for it', async () => {
    const { former } = earlier();
    const { git } = testGit();
    await git.check();
    const cache = git.cache;
    if (!cache) throw new Error('no cache');
    // A deletion that takes until the test says.
    const deleting = Promise.withResolvers<void>();
    let started = false;
    fake('rm', async (path) => {
      if (!path.endsWith('.trash')) return;
      started = true;
      await deleting.promise;
    });

    expect(await clearFormerCache(cache, former, { log: () => undefined })).toBe(true);
    await expect.poll(() => started).toBe(true);
    let closed = false;
    const closing = cache.close().then(() => (closed = true));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(closed).toBe(false);

    deleting.resolve();
    await closing;
    expect(readdirSync(join(cache.root, 'tmp'))).toEqual([]);
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

  it('removes the cache an earlier Lo kept once the cache opens', async () => {
    const former = join(folder(), 'Library', 'Caches', 'Lo');
    mkdirSync(join(former, 'git-env', 'home'), { recursive: true });
    mkdirSync(join(former, 'tmp'));
    const { git, lines } = testGit({ former });
    expect(existsSync(former)).toBe(true);

    await git.check();

    await expect.poll(() => existsSync(former)).toBe(false);
    expect(lines).toContain(`removed the cache an earlier Lo kept at ${former}`);
  });

  it('runs no git with LO_GIT=none, and opens no cache', async () => {
    const { git, root } = testGit({ settings: { program: 'none' } });

    expect(await git.check()).toMatchObject({ status: 'missing' });

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
