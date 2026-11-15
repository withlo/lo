import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { describe, expect, test } from 'vitest';

import { tarGz, type TarEntry, zip, type ZipEntry } from '../test/downloads.ts';
import { tempFolder } from '../test/support.ts';
import { DownloadError } from './errors.ts';
import { Unpacker, type UnpackLimits } from './unpack.ts';

/** A folder beside the archive's, which nothing may reach. */
function setUp() {
  const folder = tempFolder();
  const root = join(folder, 'files');
  const outside = join(folder, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  return { folder, root, outside };
}

async function unpackTar(entries: readonly TarEntry[], limits?: UnpackLimits) {
  const { folder, root, outside } = setUp();
  const archive = join(folder, 'archive.tar.gz');
  writeFileSync(archive, tarGz(entries));
  const unpacker = new Unpacker(root, { limits });
  const result = await unpacker
    .tarGz(archive)
    .then(() => unpacker.finish())
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  return { root, outside, error: result };
}

async function unpackZip(entries: readonly ZipEntry[]) {
  const { folder, root, outside } = setUp();
  const archive = join(folder, 'archive.zip');
  writeFileSync(archive, zip(entries));
  const unpacker = new Unpacker(root);
  const result = await unpacker
    .zip(archive)
    .then(() => unpacker.finish())
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  return { root, outside, error: result };
}

/** What `error` says, when it's a refusal. */
function refusal(error: unknown): string {
  return error instanceof DownloadError && error.problem === 'refused'
    ? error.message
    : `not a refusal: ${String(error)}`;
}

describe('a tar', () => {
  test('unpacks its files, folders and links inside, with only their execute bits', async () => {
    const { root, error } = await unpackTar([
      { path: 'node/', type: 'Directory' },
      { path: 'node/bin/node', data: 'program', mode: 0o4777 },
      { path: './node/lib/cli.js', data: 'script', mode: 0o666 },
      { path: 'node/bin/npm', type: 'SymbolicLink', linkpath: '../lib/cli.js' },
    ]);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, 'node/bin/node'), 'utf8')).toBe('program');
    expect(statSync(join(root, 'node/bin/node')).mode & 0o7777).toBe(0o755);
    expect(statSync(join(root, 'node/lib/cli.js')).mode & 0o7777).toBe(0o644);
    expect(readlinkSync(join(root, 'node/bin/npm'))).toBe('../lib/cli.js');
    expect(readFileSync(join(root, 'node/bin/npm'), 'utf8')).toBe('script');
  });

  test.each<[string, TarEntry[], RegExp]>([
    ['a path with ..', [{ path: 'a/../../outside/x', data: 'x' }], /leads out of its folder/],
    ['an absolute path', [{ path: '/tmp/x', data: 'x' }], /absolute path/],
    [
      'a link with an absolute target',
      [{ path: 'a', type: 'SymbolicLink', linkpath: '/etc/passwd' }],
      /target Lo doesn’t allow/,
    ],
    [
      'a link leading out',
      [{ path: 'a/b', type: 'SymbolicLink', linkpath: '../../outside' }],
      /link to something outside/,
    ],
    [
      'links that lead out only together',
      [
        { path: 'here', type: 'SymbolicLink', linkpath: '.' },
        { path: 'up', type: 'SymbolicLink', linkpath: 'here/..' },
      ],
      /"up" is a link to something outside/,
    ],
    [
      'a link written through',
      [
        { path: 'here', type: 'SymbolicLink', linkpath: '.' },
        { path: 'here/x', type: 'SymbolicLink', linkpath: '.' },
      ],
      /where a folder must be/,
    ],
    ['a hard link', [{ path: 'x', type: 'Link', linkpath: '../outside/x' }], /hard link/],
    ['a device', [{ path: 'x', type: 'CharacterDevice' }], /CharacterDevice/],
    ['a pipe', [{ path: 'x', type: 'FIFO' }], /FIFO/],
    [
      'a file twice',
      [
        { path: 'x', data: 'one' },
        { path: 'x', data: 'two' },
      ],
      /twice/,
    ],
    ['a backslash', [{ path: '..\\outside\\x', data: 'x' }], /characters/],
  ])('refuses %s, writing nothing outside', async (_, entries, message) => {
    const { outside, error } = await unpackTar(entries);
    expect(refusal(error)).toMatch(message);
    expect(readdirSync(outside)).toEqual([]);
  });

  test('refuses more entries or bytes than its limits, before writing past them', async () => {
    const limits = { entries: 3, bytes: 100 };
    const many = await unpackTar(
      ['a', 'b', 'c', 'd'].map((path) => ({ path, data: 'x' })),
      limits,
    );
    expect(refusal(many.error)).toMatch(/more entries/);
    // A header that says a file is huge is refused before it's written.
    const huge = await unpackTar([{ path: 'huge', size: 1024 ** 3, data: 'x' }], limits);
    expect(refusal(huge.error)).toMatch(/more than Lo allows/);
    expect(readdirSync(huge.root)).toEqual([]);
    const large = await unpackTar([{ path: 'large', data: Buffer.alloc(101) }], limits);
    expect(refusal(large.error)).toMatch(/more than Lo allows/);
  });

  test('refuses what isn’t a gzipped tar', async () => {
    const { folder, root } = setUp();
    const archive = join(folder, 'archive.tar.gz');
    writeFileSync(archive, gzipSync('not a tar'));
    const error = await new Unpacker(root).tarGz(archive).catch((thrown: unknown) => thrown);
    expect(refusal(error)).toMatch(/can’t be read/);
  });

  test('drops leading folders, and places entries in a folder, as npm’s tarballs need', async () => {
    const { folder, root } = setUp();
    const archive = join(folder, 'package.tgz');
    writeFileSync(
      archive,
      tarGz([
        { path: 'package/package.json', data: '{}' },
        { path: 'package/lib/index.js', data: 'js' },
      ]),
    );
    const unpacker = new Unpacker(root);
    await unpacker.tarGz(archive, { at: 'node_modules/@scope/name', strip: 1 });
    await unpacker.finish();
    expect(readFileSync(join(root, 'node_modules/@scope/name/lib/index.js'), 'utf8')).toBe('js');
  });
});

describe('a zip', () => {
  test('unpacks its files, folders and links inside', async () => {
    const { root, error } = await unpackZip([
      { path: 'bin/' },
      { path: 'bin/server', data: 'program', mode: 0o100755 },
      { path: 'lib/server.jar', data: 'jar' },
      { path: 'bin/jar', data: '../lib/server.jar', mode: 0o120777 },
    ]);
    expect(error).toBeUndefined();
    expect(statSync(join(root, 'bin/server')).mode & 0o7777).toBe(0o755);
    expect(lstatSync(join(root, 'bin/jar')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(root, 'bin/jar'), 'utf8')).toBe('jar');
  });

  test.each<[string, ZipEntry[], RegExp]>([
    ['a path with ..', [{ path: '../outside/x', data: 'x' }], /\.\./],
    ['an absolute path', [{ path: '/tmp/x', data: 'x' }], /absolute|relative/],
    [
      'a link leading out',
      [{ path: 'a', data: '../outside', mode: 0o120777 }],
      /link to something outside/,
    ],
    ['a device', [{ path: 'x', mode: 0o020644 }], /neither a file, a folder nor a link/],
  ])('refuses %s, writing nothing outside', async (_, entries, message) => {
    const { outside, error } = await unpackZip(entries);
    expect(refusal(error)).toMatch(message);
    expect(readdirSync(outside)).toEqual([]);
  });
});

test('a gzipped program is unpacked as its name, made executable', async () => {
  const { folder, root } = setUp();
  const archive = join(folder, 'server.gz');
  writeFileSync(archive, gzipSync('program'));
  await new Unpacker(root).gunzip(archive, 'server');
  expect(readFileSync(join(root, 'server'), 'utf8')).toBe('program');
  expect(statSync(join(root, 'server')).mode & 0o777).toBe(0o755);
});
