// Downloads and installs against a server on this machine, with archives built by each test: what
// installs, and every way a download is refused or cut short, each leaving nothing behind.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { DownloadError, Installer, type Pinned, REDIRECTS } from '../src/index.ts';
import { pinned, serve, type Routes, sha256, tarGz } from './downloads.ts';
import { tempFolder } from './support.ts';

const URL = 'https://downloads.test/server-1.0.0.tar.gz';

/** A server's archive, with its program inside. */
const ARCHIVE = tarGz([
  { path: 'server/', type: 'Directory' },
  { path: 'server/bin/server', data: 'program', mode: 0o755 },
]);

const PINNED = pinned(URL, ARCHIVE, 'tar.gz', 'server/bin/server');

async function setUp(routes: Routes) {
  const served = await serve(routes);
  const folder = join(tempFolder(), 'servers');
  mkdirSync(folder);
  const installer = new Installer({ folder, fetch: served.fetch, backoff: [0, 0] });
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
