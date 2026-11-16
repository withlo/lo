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
import {
  buildGo,
  DownloadError,
  type GoDownload,
  Installer,
  NO_NETWORK,
  type Pinned,
  type Platform,
  REDIRECTS,
} from '../src/index.ts';
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
  options: { free?: number; platform?: Platform } = {},
) {
  const served = await serve(routes);
  const folder = join(tempFolder(), 'servers');
  mkdirSync(folder);
  const installer = new Installer({
    folder,
    fetch: fetch?.(served.fetch) ?? served.fetch,
    backoff: [0, 0],
    stall: STALL,
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.free === undefined ? {} : { free: () => Promise.resolve(options.free) }),
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

/** A layer of rust-installer's, its component's files in `<package>/<component>/`. */
function layer(component: string, path: string, data: string): Buffer {
  return tarGz([
    { path: `${component}-1.0.0/components`, data: component },
    { path: `${component}-1.0.0/${component}/manifest.in`, data: `file:${path}` },
    { path: `${component}-1.0.0/${component}/${path}`, data, mode: 0o755 },
  ]);
}

describe('a toolchain', () => {
  const base = 'https://static.rust-lang.test/dist/';
  const RUSTC = layer('rustc', 'bin/rustc', 'rustc');
  const CARGO = layer('cargo', 'bin/cargo', 'cargo');

  /** Rust's sysroot from `layers`, recorded to unpack to `unpacked` bytes. */
  function rust(layers: readonly [string, Buffer][], unpacked = 10): Pinned {
    return {
      version: '1.0.0',
      hosts: ['static.rust-lang.test'],
      platforms: {
        any: {
          kind: 'layers',
          entry: 'bin/cargo',
          unpacked,
          layers: layers.map(([component, data]) => ({
            url: `${base}${component}.tar.gz`,
            size: data.length,
            sha256: sha256(data),
            from: `${component}-1.0.0/${component}`,
          })),
        },
      },
    };
  }
  const routes = (layers: readonly [string, Buffer][]) =>
    Object.fromEntries(
      layers.map(([component, data]) => [`${base}${component}.tar.gz`, { body: data }]),
    );
  const LAYERS: [string, Buffer][] = [
    ['rustc', RUSTC],
    ['cargo', CARGO],
  ];

  test('installs layers into one folder, and says what its files hold', async () => {
    const { installer, asked } = await setUp(routes(LAYERS));
    const progress: [number, number][] = [];
    const installed = await installer.install('rust', rust(LAYERS), {
      progress: (received, total) => progress.push([received, total]),
    });
    expect(readFileSync(installed.entry, 'utf8')).toBe('cargo');
    expect(readFileSync(join(installed.folder, 'bin', 'rustc'), 'utf8')).toBe('rustc');
    expect(existsSync(join(installed.folder, 'manifest.in'))).toBe(false);
    // Both layers count toward one download.
    expect(progress.at(-1)).toEqual([RUSTC.length + CARGO.length, RUSTC.length + CARGO.length]);
    expect(asked).toHaveLength(2);
    expect(await installer.recorded('rust', rust(LAYERS))).toBe(10);
  });

  test.each<[string, [string, Buffer][], number, RegExp]>([
    [
      'a layer that writes a file another wrote',
      [
        ['rustc', RUSTC],
        ['cargo', layer('cargo', 'bin/rustc', 'not rustc')],
      ],
      100,
      /in the archive twice/,
    ],
    [
      'an archive past what it was recorded to unpack to, and 5% more',
      LAYERS,
      // Its files hold 10 bytes, and 8 and 5% more is 8.4.
      8,
      /unpacks to more than Lo allows/,
    ],
  ])('refuses %s, leaving nothing behind', async (_, layers, unpacked, message) => {
    const { installer, left } = await setUp(routes(layers));
    const error = await failure(installer.install('rust', rust(layers, unpacked)));
    expect(error.message).toMatch(message);
    expect(left()).toEqual([]);
  });

  test('is refused before it downloads when the disk hasn’t room for it unpacked too', async () => {
    const total = RUSTC.length + CARGO.length;
    const { installer, asked, left } = await setUp(routes(LAYERS), undefined, {
      free: total + 9,
    });
    const error = await failure(installer.install('rust', rust(LAYERS)));
    expect(error.problem).toBe('space');
    expect(error.message).toBe('Lo needs 1 MB free for it, and the disk has 1 MB.');
    expect(asked).toEqual([]);
    expect(left()).toEqual([]);
  });

  test('is removed, an install of it under way stopping first, leaving nothing', async () => {
    const sysroot = rust(LAYERS);
    const { installer, folder, asked, left } = await setUp({
      ...routes(LAYERS),
      // The second layer holds the install up halfway.
      [`${base}cargo.tar.gz`]: [{ body: CARGO }, { body: CARGO, cut: 10, hold: true }],
    });
    await installer.install('rust', sysroot);
    expect(await installer.recorded('rust', sysroot)).toBe(10);
    await installer.remove('rust');
    expect(existsSync(join(folder, 'rust'))).toBe(false);
    expect(await installer.recorded('rust', sysroot)).toBeUndefined();

    const again = installer.install('rust', sysroot).then(
      () => undefined,
      (error: unknown) => error,
    );
    await expect.poll(() => asked.length).toBe(4);
    await installer.remove('rust', new Error('Rust was removed.'));
    expect(await again).toEqual(new Error('Rust was removed.'));
    expect(left()).toEqual([]);
  });

  test('isn’t installed while it’s being removed, so nothing gets the folder that goes', async () => {
    const sysroot = rust(LAYERS);
    const { installer, folder, asked } = await setUp(routes(LAYERS));
    await installer.install('rust', sysroot);
    const removing = installer.remove('rust', new Error('Rust was removed.'));
    // Asked for once the removal has started, as a server starting again would.
    await expect(installer.install('rust', sysroot)).rejects.toThrow('Rust was removed.');
    await removing;
    expect(existsSync(join(folder, 'rust'))).toBe(false);
    // Once it's removed, it downloads again.
    const installed = await installer.install('rust', sysroot);
    expect(readFileSync(installed.entry, 'utf8')).toBe('cargo');
    expect(asked).toHaveLength(4);
  });

  test('is removed once an install nobody waits for any longer has ended', async () => {
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    let asked = 0;
    const { installer, left } = await setUp(
      routes(LAYERS),
      // The first layer's download is held until the removal has started, whatever stops it.
      (served) => async (input, init) => {
        asked += 1;
        await held;
        return served(input, init);
      },
    );
    const halted = new AbortController();
    const installing = installer
      .install('rust', rust(LAYERS), { signal: halted.signal })
      .catch((error: unknown) => error);
    await expect.poll(() => asked).toBe(1);
    // A server's start stops, as Settings' "Remove" stops the servers that use it first.
    halted.abort(new Error('The server stopped.'));
    expect(await installing).toEqual(new Error('The server stopped.'));
    const removing = installer.remove('rust');
    release();
    await removing;
    // The install had ended, its download folder gone with it, before the removal was done.
    expect(left()).toEqual([]);
  });
});

const GO_PROXY = 'https://proxy.golang.org';
const GO_MOD = Buffer.from('module example.com/tool\n\ngo 1.24\n');
const GO_ZIP = Buffer.from('the module’s source');
/** What the stand-in for Go builds: the module's zip, as it is. */
const GO_BUILT = GO_ZIP;

/**
 * A stand-in for Lo's Go, `<root>/bin/go`: it records its arguments, its environment and the
 * go.mod and go.sum it's given in `seen`, then writes the module's zip from its proxy as the
 * program, or does what `script` says.
 */
function fakeGo(script = ''): { go: string; seen: string; version: string } {
  const folder = tempFolder();
  const seen = join(folder, 'seen');
  mkdirSync(join(folder, 'go', 'bin'), { recursive: true });
  mkdirSync(seen);
  const go = join(folder, 'go', 'bin', 'go');
  writeFileSync(
    go,
    [
      '#!/bin/sh',
      `seen='${seen}'`,
      'printf "%s\\n" "$@" > "$seen/args"',
      '/usr/bin/env > "$seen/env"',
      'cat go.mod > "$seen/go.mod"; cat go.sum > "$seen/go.sum"',
      script,
      'while [ "$1" != "-o" ]; do shift; done',
      'cat "${GOPROXY#file://}/example.com/tool/@v/v1.0.0.zip" > "$2"',
    ].join('\n'),
    { mode: 0o755 },
  );
  return { go, seen, version: '1.27.4' };
}

/** A module file of `data` at `path` in the Go module proxy, pinned. */
function goPart(path: string, data: Buffer) {
  return { url: `${GO_PROXY}/${path}`, path, size: data.length, sha256: sha256(data) };
}

/** A Go program pinned as built from one module, `example.com/tool`. */
function goTool(builds: GoDownload['builds'] = { 'linux-x64': goBuilt(GO_BUILT) }): Pinned {
  return {
    version: '1.0.0',
    hosts: ['proxy.golang.org'],
    platforms: {
      any: {
        kind: 'go',
        entry: 'tool',
        package: 'example.com/tool',
        go: '1.27.4',
        mod: ['module lo/tool', '', 'go 1.27.4', '', 'require example.com/tool v1.0.0'],
        sum: [
          `example.com/tool v1.0.0 h1:${'A'.repeat(43)}=`,
          `example.com/tool v1.0.0/go.mod h1:${'B'.repeat(43)}=`,
        ],
        modules: [
          goPart('example.com/tool/@v/v1.0.0.mod', GO_MOD),
          goPart('example.com/tool/@v/v1.0.0.zip', GO_ZIP),
        ],
        builds,
        room: 1024 * 1024,
      },
    },
  };
}

/** What a build of `data` is pinned as: its size and SHA-256. */
function goBuilt(data: Buffer) {
  return { size: data.length, sha256: sha256(data) };
}

const GO_ROUTES = {
  [`${GO_PROXY}/example.com/tool/@v/v1.0.0.mod`]: { body: GO_MOD },
  [`${GO_PROXY}/example.com/tool/@v/v1.0.0.zip`]: { body: GO_ZIP },
};

/** Lo's Go as the installer is given it. */
function loGo(fake: { go: string; version: string }) {
  return {
    version: fake.version,
    installed: { folder: join(fake.go, '..', '..'), entry: fake.go },
  };
}

describe('a Go program, built from its modules with Lo’s Go', () => {
  test('is built once, offline, from Lo’s own module proxy, in an environment of its own', async () => {
    const fake = fakeGo();
    const { installer, folder, asked } = await setUp(GO_ROUTES, undefined, {
      platform: 'linux-x64',
    });
    const installed = await installer.install('tool', goTool(), { go: loGo(fake) });
    expect(installed.entry).toBe(join(folder, 'tool', '1.0.0', 'files', 'tool'));
    expect(readFileSync(installed.entry)).toEqual(GO_BUILT);
    expect(lstatSync(installed.entry).mode & 0o111).not.toBe(0);
    expect(await installer.install('tool', goTool(), { go: loGo(fake) })).toEqual(installed);
    expect(asked).toHaveLength(2);

    const read = (name: string) => readFileSync(join(fake.seen, name), 'utf8');
    const args = read('args').trimEnd().split('\n');
    expect(args).toEqual([
      'build',
      '-trimpath',
      '-buildvcs=false',
      '-mod=readonly',
      '-modcacherw',
      '-o',
      expect.stringMatching(/\/build\/out\/tool$/),
      'example.com/tool',
    ]);
    expect(read('go.mod')).toBe(`module lo/tool\n\ngo 1.27.4\n\nrequire example.com/tool v1.0.0\n`);
    expect(read('go.sum').trimEnd().split('\n')).toHaveLength(2);
    const env = Object.fromEntries(
      read('env')
        .trimEnd()
        .split('\n')
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    // The shell's own aside, that's all it's given.
    for (const name of ['PWD', 'SHLVL', '_', 'OLDPWD']) delete env[name];
    const build = args[6]?.replace(/\/out\/tool$/, '') ?? '';
    expect(env).toEqual({
      HOME: `${build}/home`,
      TMPDIR: `${build}/home/tmp`,
      PATH: `${join(fake.go, '..')}:/usr/bin:/bin`,
      LANG: 'C.UTF-8',
      GOROOT: join(fake.go, '..', '..'),
      GOTOOLCHAIN: 'local',
      GOENV: 'off',
      GOFLAGS: '',
      GOWORK: 'off',
      GO111MODULE: 'on',
      GOPROXY: `file://${build}/proxy`,
      GONOPROXY: '',
      GOPRIVATE: '',
      GOINSECURE: '',
      GOVCS: '*:off',
      GOSUMDB: 'off',
      GONOSUMDB: '',
      GOPATH: `${build}/home/go`,
      GOMODCACHE: `${build}/modules`,
      GOCACHE: `${build}/cache`,
      CGO_ENABLED: '0',
      GOOS: 'linux',
      GOARCH: 'amd64',
      HTTPS_PROXY: NO_NETWORK,
      HTTP_PROXY: NO_NETWORK,
    });
  });

  test('is refused, leaving nothing behind, when what’s built isn’t what was pinned', async () => {
    const { installer, left } = await setUp(GO_ROUTES, undefined, { platform: 'linux-x64' });
    const pin = goTool({ 'linux-x64': goBuilt(Buffer.from('another program')) });
    const error = await failure(installer.install('tool', pin, { go: loGo(fakeGo()) }));
    expect(error.problem).toBe('mismatch');
    expect(error.message).toBe(
      'What Lo built isn’t the program it pinned: its SHA-256 is another.',
    );
    expect(left()).toEqual([]);
  });

  test('says why it didn’t build, leaving nothing behind', async () => {
    const { installer, left } = await setUp(GO_ROUTES, undefined, { platform: 'linux-x64' });
    const fake = fakeGo('echo "go: example.com/tool: missing go.sum entry" >&2; exit 1');
    const error = await failure(installer.install('tool', goTool(), { go: loGo(fake) }));
    expect(error.problem).toBe('build');
    expect(error.message).toBe('It didn’t build: go: example.com/tool: missing go.sum entry');
    expect(left()).toEqual([]);
  });

  test('is refused before anything downloads, with another Go or for a system it isn’t built for', async () => {
    const { installer, asked } = await setUp(GO_ROUTES, undefined, { platform: 'linux-x64' });
    const other = { ...loGo(fakeGo()), version: '1.28.0' };
    const error = await failure(installer.install('tool', goTool(), { go: other }));
    expect(error.problem).toBe('refused');
    expect(error.message).toBe('It’s pinned as Go 1.27.4 builds it, and Lo has Go 1.28.0.');
    await expect(installer.install('tool', goTool())).rejects.toThrow('which it wasn’t given');
    const unbuilt = goTool({ 'darwin-arm64': goBuilt(GO_BUILT) });
    expect(
      (await failure(installer.install('tool', unbuilt, { go: loGo(fakeGo()) }))).problem,
    ).toBe('unavailable');
    expect(asked).toEqual([]);
  });

  test('is stopped, with everything Go started, once it takes too long', async () => {
    const folder = tempFolder();
    const pin = goTool().platforms.any;
    if (pin?.kind !== 'go') throw new Error('not a Go program');
    const files = pin.modules.map((part, index) => {
      const file = join(folder, `download-${index}`);
      writeFileSync(file, part.path.endsWith('.zip') ? GO_ZIP : GO_MOD);
      return file;
    });
    const build = join(folder, 'build');
    mkdirSync(build);
    const fake = fakeGo('sleep 30; :');
    const building = buildGo({
      go: fake.go,
      download: pin,
      files,
      folder: build,
      platform: 'linux-x64',
      time: 100,
    });
    await expect(building).rejects.toThrow('It took longer than');
  });
});
