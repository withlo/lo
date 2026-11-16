// Downloads and installs against a server on this machine, with archives built by each test: what
// installs, and every way a download is refused or cut short, each leaving nothing behind.

import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import * as disk from '../src/disk.ts';
import { DownloadError, Installer, type Pinned, REDIRECTS } from '../src/index.ts';
import type { StallLimits } from '../src/download.ts';
import { fingerprint } from '../src/install.ts';
import { UNPACK_RULES } from '../src/unpack.ts';
import { pinned, serve, type Routes, sha256, tarGz } from './downloads.ts';
import { tempFolder } from './support.ts';

// Each sync to the disk is seen, and made.
vi.mock(import('../src/disk.ts'), async (original) => {
  const real = await original();
  return { ...real, syncPath: vi.fn<typeof real.syncPath>(real.syncPath) };
});

const URL = 'https://downloads.test/server-1.0.0.tar.gz';

/** A server's archive, with its program inside. */
const ARCHIVE = tarGz([
  { path: 'server/', type: 'Directory' },
  { path: 'server/bin/server', data: 'program', mode: 0o755 },
]);

const PINNED = pinned(URL, ARCHIVE, 'tar.gz', 'server/bin/server');

/**
 * Lo's stall limits scaled down: nothing for 300 ms, or less than 256 bytes in any 1.5 s, where Lo
 * waits 30 s and 5 minutes for 16 KB.
 */
const STALL: StallLimits = { quiet: 300, window: 1500, least: 256 };

async function setUp(
  routes: Routes,
  fetch?: (served: typeof globalThis.fetch) => typeof globalThis.fetch,
) {
  const served = await serve(routes);
  const folder = join(tempFolder(), 'servers');
  mkdirSync(folder);
  const installer = new Installer({
    folder,
    fetch: fetch?.(served.fetch) ?? served.fetch,
    backoff: [0, 0],
    stall: STALL,
  });
  /** What's in the installer's folder, but for empty folders it keeps for downloads. */
  const left = () =>
    readdirSync(folder, { recursive: true, encoding: 'utf8' }).filter(
      (path) => path !== '.partial',
    );
  return { ...served, folder, installer, left };
}

/** What `promise` threw, which must be a download error. */
async function failure(promise: Promise<unknown>): Promise<DownloadError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof DownloadError)) throw new Error(`not a download error: ${String(error)}`);
  return error;
}

/** {@link PINNED} with its file's address or hash changed. */
function changed(change: { url?: string; sha256?: string }): Pinned {
  const download = {
    kind: 'tar.gz' as const,
    url: URL,
    size: ARCHIVE.length,
    sha256: sha256(ARCHIVE),
  };
  return { ...PINNED, platforms: { any: { ...download, entry: 'server/bin/server', ...change } } };
}

test('installs a version once, in its own folder, and finds it there after', async () => {
  const { installer, folder, asked } = await setUp({ [URL]: { body: ARCHIVE } });
  const progress: [number, number][] = [];
  const installed = await installer.install('server', PINNED, {
    progress: (received, total) => progress.push([received, total]),
  });
  expect(installed.entry).toBe(join(folder, 'server', '1.0.0', 'files', 'server', 'bin', 'server'));
  expect(readFileSync(installed.entry, 'utf8')).toBe('program');
  expect(progress.at(-1)).toEqual([ARCHIVE.length, ARCHIVE.length]);
  // Nothing is left of the download but what's installed.
  expect(readdirSync(join(folder, '.partial'))).toEqual([]);
  expect(await installer.install('server', PINNED)).toEqual(installed);
  expect(await installer.installed('server', PINNED)).toEqual(installed);
  expect(asked).toEqual([URL]);
});

test('two installs of a version at once make one download', async () => {
  const { installer, asked } = await setUp({ [URL]: { body: ARCHIVE } });
  const [one, two] = await Promise.all([
    installer.install('server', PINNED),
    installer.install('server', PINNED),
  ]);
  expect(one).toEqual(two);
  expect(asked).toEqual([URL]);
});

describe('refuses, leaving nothing behind,', () => {
  test.each<[string, Pinned, Routes, RegExp]>([
    [
      'a file with another hash',
      changed({ sha256: sha256(Buffer.from('x')) }),
      { [URL]: { body: ARCHIVE } },
      /isn’t the file Lo pinned/,
    ],
    [
      'a file larger than pinned',
      PINNED,
      { [URL]: { body: Buffer.concat([ARCHIVE, Buffer.from('more')]) } },
      /larger than/,
    ],
    [
      'a file larger than pinned, sent without its length',
      PINNED,
      { [URL]: { body: Buffer.concat([ARCHIVE, Buffer.from('more')]), chunked: true } },
      /larger than/,
    ],
    [
      'a redirect to a host it doesn’t list',
      PINNED,
      { [URL]: { redirect: 'https://elsewhere.test/server.tar.gz' } },
      /elsewhere\.test, which isn’t one of the hosts/,
    ],
    [
      'a redirect to http',
      PINNED,
      { [URL]: { redirect: 'http://downloads.test/server.tar.gz' } },
      /only over https/,
    ],
    [
      'a redirect to another port',
      PINNED,
      { [URL]: { redirect: 'https://downloads.test:8443/server.tar.gz' } },
      /only over https, on its usual port/,
    ],
    [
      `more than ${REDIRECTS} redirects`,
      PINNED,
      Object.fromEntries(
        Array.from({ length: REDIRECTS + 1 }, (_, hop) => [
          hop === 0 ? URL : `https://downloads.test/${hop}`,
          { redirect: `https://downloads.test/${hop + 1}` },
        ]),
      ),
      /more than 5 times/,
    ],
    [
      'an archive with a path leading out',
      pinned(URL, tarGz([{ path: '../../escaped', data: 'x' }]), 'tar.gz', 'escaped'),
      { [URL]: { body: tarGz([{ path: '../../escaped', data: 'x' }]) } },
      /leads out of its folder/,
    ],
    [
      'an archive with a link to its entry point',
      pinned(
        URL,
        tarGz([{ path: 'server', type: 'SymbolicLink', linkpath: '/bin/sh' }]),
        'tar.gz',
        'server',
      ),
      { [URL]: { body: tarGz([{ path: 'server', type: 'SymbolicLink', linkpath: '/bin/sh' }]) } },
      /target Lo doesn’t allow/,
    ],
    [
      'an archive without its entry point',
      pinned(URL, ARCHIVE, 'tar.gz', 'server/bin/other'),
      { [URL]: { body: ARCHIVE } },
      /no server\/bin\/other to start from/,
    ],
  ])('%s', async (_, pin, routes, message) => {
    const { installer, left } = await setUp(routes);
    const error = await failure(installer.install('server', pin));
    expect(error.message).toMatch(message);
    expect(error.problem).not.toBe('interrupted');
    expect(left()).toEqual([]);
  });

  test('an answer a fetch followed a redirect to itself, unseen', async () => {
    const { installer, asked, left } = await setUp(
      {
        // Relative, so a fetch that follows it reaches the test server.
        [URL]: { redirect: '/elsewhere.test/server.tar.gz' },
        'https://elsewhere.test/server.tar.gz': { body: ARCHIVE },
      },
      (fetch) => (input, init) => fetch(input, { ...init, redirect: 'follow' }),
    );
    const error = await failure(installer.install('server', PINNED));
    expect(error.message).toMatch(/redirected without Lo seeing where/);
    expect(error.problem).toBe('refused');
    expect(asked).toEqual([URL, 'https://elsewhere.test/server.tar.gz']);
    expect(left()).toEqual([]);
  });

  test('an address that isn’t https, asking nothing', async () => {
    const http = 'http://downloads.test/server-1.0.0.tar.gz';
    const { installer, asked, left } = await setUp({ [http]: { body: ARCHIVE } });
    const error = await failure(installer.install('server', changed({ url: http })));
    expect(error.message).toMatch(/only over https/);
    expect(asked).toEqual([]);
    expect(left()).toEqual([]);
  });
});

test('a download cut short is tried again, from the start', async () => {
  const { installer, asked } = await setUp({
    [URL]: [{ body: ARCHIVE, cut: 40 }, { status: 503 }, { body: ARCHIVE }],
  });
  const installed = await installer.install('server', PINNED);
  expect(readFileSync(installed.entry, 'utf8')).toBe('program');
  expect(asked).toEqual([URL, URL, URL]);
});

test('a download that stalls, before its answer or within it, is tried again', async () => {
  // Nothing comes for 300 ms, so each try is given up as cut short.
  const { installer, asked } = await setUp({
    [URL]: [{ silent: true }, { body: ARCHIVE, cut: 40, hold: true }, { body: ARCHIVE }],
  });
  const installed = await installer.install('server', PINNED);
  expect(readFileSync(installed.entry, 'utf8')).toBe('program');
  expect(asked).toEqual([URL, URL, URL]);
});

test('a slow download that keeps coming isn’t given up, however long it takes', async () => {
  // 32 bytes every 50 ms: never quiet, and more than 256 bytes in any 1.5 s, for 2.4 s.
  const data = randomBytes(1536);
  const slow = pinned(URL, data, 'file', 'server');
  const { installer, asked } = await setUp({
    [URL]: { body: data, drip: { every: 50, bytes: 32 } },
  });
  const installed = await installer.install('server', slow);
  expect(readFileSync(installed.entry)).toEqual(data);
  expect(asked).toEqual([URL]);
});

test('a download a proxy holds back as it scans it, a byte at a time, then sends whole, isn’t given up', async () => {
  // A byte every 100 ms for 600 ms, as a proxy sends one every 10 s for 2 minutes, then the rest.
  const { installer, asked } = await setUp({
    [URL]: { body: ARCHIVE, drip: { every: 100, for: 600 } },
  });
  const installed = await installer.install('server', PINNED);
  expect(readFileSync(installed.entry, 'utf8')).toBe('program');
  expect(asked).toEqual([URL]);
});

test('a download that brings a byte just before each quiet limit is given up as stalled', async () => {
  // A byte every 290 ms, as one every 29 s: never 300 ms with nothing, but far less than 256 bytes
  // in 1.5 s.
  const { installer, asked } = await setUp({
    [URL]: [{ body: ARCHIVE, drip: { every: 290 } }, { body: ARCHIVE }],
  });
  const installed = await installer.install('server', PINNED);
  expect(readFileSync(installed.entry, 'utf8')).toBe('program');
  expect(asked).toEqual([URL, URL]);
});

test.each([
  ['cut short', { body: ARCHIVE, cut: 40 }],
  ['shorter than pinned', { body: ARCHIVE.subarray(0, 40) }],
])(
  'a download that keeps coming %s fails after three tries, leaving nothing',
  async (_, answer) => {
    const { installer, asked, left } = await setUp({ [URL]: answer });
    const error = await failure(installer.install('server', PINNED));
    expect(error.problem).toBe('interrupted');
    expect(asked).toHaveLength(3);
    expect(left()).toEqual([]);
  },
);

test('a folder without its marker, or with another, is removed and fetched again', async () => {
  const { installer, folder, asked } = await setUp({ [URL]: { body: ARCHIVE } });
  const version = join(folder, 'server', '1.0.0');
  mkdirSync(join(version, 'files', 'server', 'bin'), { recursive: true });
  writeFileSync(join(version, 'files', 'server', 'bin', 'server'), 'half');
  const installed = await installer.install('server', PINNED);
  expect(readFileSync(installed.entry, 'utf8')).toBe('program');
  // Pinned again, as the same version with another file, it's fetched again.
  writeFileSync(join(version, 'installed.json'), '{"fingerprint":"another"}');
  await installer.install('server', PINNED);
  expect(asked).toEqual([URL, URL]);
});

test('a folder whose files aren’t as its marker records is fetched again', async () => {
  // As a power loss could leave it: whole by its marker, its program cut short.
  const { installer, asked } = await setUp({ [URL]: { body: ARCHIVE } });
  const installed = await installer.install('server', PINNED);
  writeFileSync(installed.entry, 'prog');
  expect(await installer.installed('server', PINNED)).toBeUndefined();
  await installer.install('server', PINNED);
  expect(readFileSync(installed.entry, 'utf8')).toBe('program');
  expect(asked).toEqual([URL, URL]);
});

test('a folder whose folders aren’t as its marker records is fetched again', async () => {
  // One of its folders swapped for a link to one outside, which holds files of the same sizes.
  const archive = tarGz([
    { path: 'server/bin/server', data: 'program', mode: 0o755 },
    { path: 'server/lib/data', data: 'data' },
  ]);
  const withLib = pinned(URL, archive, 'tar.gz', 'server/bin/server');
  const { installer, asked } = await setUp({ [URL]: { body: archive } });
  const installed = await installer.install('server', withLib);
  const outside = join(tempFolder(), 'lib');
  mkdirSync(outside);
  writeFileSync(join(outside, 'data'), 'atad');
  const lib = join(installed.folder, 'server', 'lib');
  rmSync(lib, { recursive: true });
  symlinkSync(outside, lib);
  expect(await installer.installed('server', withLib)).toBeUndefined();
  await installer.install('server', withLib);
  expect(readFileSync(join(lib, 'data'), 'utf8')).toBe('data');
  expect(asked).toEqual([URL, URL]);
});

test.each(['server', 'server/1.0.0'])(
  'an install whose folder %s is a link to a copy elsewhere is fetched again, and the copy left',
  async (path) => {
    const { installer, folder, asked } = await setUp({ [URL]: { body: ARCHIVE } });
    await installer.install('server', PINNED);
    const copy = join(tempFolder(), 'copy');
    renameSync(join(folder, path), copy);
    symlinkSync(copy, join(folder, path));
    expect(await installer.installed('server', PINNED)).toBeUndefined();
    const installed = await installer.install('server', PINNED);
    expect(lstatSync(join(folder, path)).isDirectory()).toBe(true);
    expect(readFileSync(installed.entry, 'utf8')).toBe('program');
    expect(readdirSync(copy)).not.toEqual([]);
    expect(asked).toEqual([URL, URL]);
  },
);

test('a folder unpacked under older rules is fetched again', async () => {
  const { installer, folder, asked } = await setUp({ [URL]: { body: ARCHIVE } });
  await installer.install('server', PINNED);
  const download = PINNED.platforms.any;
  if (download === undefined) throw new Error('nothing pinned');
  const file = join(folder, 'server', '1.0.0', 'installed.json');
  const marker = readFileSync(file, 'utf8');
  const current = fingerprint('server', PINNED, download);
  expect(marker).toContain(current);
  // As an older Lo would have left it, whole by its rules.
  const older = fingerprint('server', PINNED, download, UNPACK_RULES - 1);
  writeFileSync(file, marker.replace(current, older));
  expect(await installer.installed('server', PINNED)).toBeUndefined();
  await installer.install('server', PINNED);
  expect(asked).toEqual([URL, URL]);
});

test('what’s installed is on the disk before it’s put in place', async () => {
  const { installer, folder } = await setUp({ [URL]: { body: ARCHIVE } });
  const synced = vi.mocked(disk.syncPath);
  synced.mockClear();
  await installer.install('server', PINNED);
  // Each path synced, the temporary folder's as `work`.
  const paths = synced.mock.calls.map(([path]) => relative(folder, path));
  const work = paths
    .find((path) => path.startsWith('.partial/'))
    ?.split('/')
    .slice(0, 2)
    .join('/');
  const shown = paths.map((path) =>
    work !== undefined && (path === work || path.startsWith(`${work}/`))
      ? `work${path.slice(work.length)}`
      : path,
  );
  // Every file and folder unpacked, then the marker, then the folder that holds them, renamed
  // into place only then, then where it went.
  expect(shown.slice(0, -3).toSorted()).toEqual([
    'work/files',
    'work/files/server',
    'work/files/server/bin',
    'work/files/server/bin/server',
  ]);
  expect(shown.slice(-3)).toEqual(['work/installed.json', 'work', 'server']);
});

test('an install nobody waits for any more stops, and leaves nothing', async () => {
  const { installer, left } = await setUp({ [URL]: { body: ARCHIVE, cut: 40, hold: true } });
  const one = new AbortController();
  const two = new AbortController();
  const first = installer.install('server', PINNED, { signal: one.signal });
  const second = installer.install('server', PINNED, { signal: two.signal });
  one.abort(new Error('closed'));
  await expect(first).rejects.toThrow('closed');
  two.abort(new Error('closed too'));
  await expect(second).rejects.toThrow('closed too');
  await expect.poll(left).toEqual([]);
});

test('pruning removes other versions and half-done downloads, but not one in use', async () => {
  const { installer, folder } = await setUp({ [URL]: { body: ARCHIVE } });
  const installed = await installer.install('server', PINNED);
  for (const old of ['server/0.9.0', 'server/0.8.0', 'gone/1.0.0', '.partial/server-x']) {
    mkdirSync(join(folder, old), { recursive: true });
  }
  const running = { folder: join(folder, 'server', '0.8.0', 'files'), entry: 'unused' };
  await installer.prune({ server: PINNED }, [running]);
  expect(readdirSync(join(folder, 'server')).toSorted()).toEqual(['0.8.0', '1.0.0']);
  expect(existsSync(join(folder, 'gone'))).toBe(false);
  expect(readdirSync(join(folder, '.partial'))).toEqual([]);
  expect(existsSync(installed.entry)).toBe(true);
});
