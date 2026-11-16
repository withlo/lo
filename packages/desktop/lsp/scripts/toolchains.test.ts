// pin.ts's checks of the toolchains, against a server on this machine standing in for each host,
// with keys made by the test: what each records, and what it refuses to.

import { createHash } from 'node:crypto';

import * as openpgp from 'openpgp';
import { describe, expect, test } from 'vitest';

import { PLATFORMS } from '../src/index.ts';
import { type Routes, serve, sha256, tarGz } from '../test/downloads.ts';
import { tempFolder } from '../test/support.ts';
import { dotnet, go, parseChannel, rust, temurin } from './toolchains.ts';

/** A key that signs as a publisher would, armored or not, and its armored public key. */
async function publisher() {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: 'curve25519',
    userIDs: [{ name: 'Publisher' }],
    format: 'object',
  });
  const signDetached = async (data: Buffer, armored = false) => {
    const message = await openpgp.createMessage({ binary: data });
    const signed = armored
      ? await openpgp.sign({ message, signingKeys: privateKey, detached: true })
      : await openpgp.sign({ message, signingKeys: privateKey, detached: true, format: 'binary' });
    return Buffer.from(signed);
  };
  return { publicKey: publicKey.armor(), signDetached };
}

/** What a source works with, against `routes`. */
async function tools(routes: Routes) {
  const served = await serve(routes);
  const lines: string[] = [];
  return {
    ...served,
    lines,
    tools: { fetch: served.fetch, folder: tempFolder(), log: (line: string) => lines.push(line) },
  };
}

const GO_ARCH = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-amd64',
  'linux-x64': 'linux-amd64',
  'linux-arm64': 'linux-arm64',
} as const;

test('a Rust channel file’s tables, with quoted names and arrays of tables left out', () => {
  const tables = parseChannel(
    [
      'manifest-version = "2"',
      '[pkg.rustc]',
      'version = "1.0.0 (abc 2026-01-01)"',
      '[pkg.rust-src.target."*"]',
      'available = true',
      'url = "https://static.rust-lang.org/dist/rust-src-1.0.0.tar.gz"',
      'components = [',
      '  "rustc",',
      ']',
      '[[pkg.rust.target.x.components]]',
      'pkg = "elsewhere"',
    ].join('\n'),
  );
  expect([...tables.keys()]).toEqual(['pkg.rustc', 'pkg.rust-src.target.*']);
  expect(Object.fromEntries(tables.get('pkg.rust-src.target.*') ?? [])).toEqual({
    available: true,
    url: 'https://static.rust-lang.org/dist/rust-src-1.0.0.tar.gz',
  });
});

test('a header with a comment after it begins its own table, and its keys go in it', () => {
  const tables = parseChannel(
    [
      '[pkg.rustc] # the compiler',
      'hash = "rustc" # its SHA-256',
      '[pkg.cargo]   # Cargo, with no hash of its own',
      'hash = "cargo"',
    ].join('\n'),
  );
  expect([...tables.keys()]).toEqual(['pkg.rustc', 'pkg.cargo']);
  expect(tables.get('pkg.rustc')?.get('hash')).toBe('rustc');
  expect(tables.get('pkg.cargo')?.get('hash')).toBe('cargo');
});

test.each(['"""', "'''"])(
  'the lines of a multi-line string in %s are its text, however much they look like tables',
  (delimiter) => {
    const tables = parseChannel(
      [
        '[pkg.rustc]',
        `notes = ${delimiter}`,
        '[pkg.cargo]',
        'hash = "not cargo"',
        `${delimiter} # the notes end`,
        'hash = "rustc"',
        `quoted = ${delimiter}one line, [pkg.cargo]${delimiter}`,
        '[pkg.cargo]',
        'hash = "cargo"',
      ].join('\n'),
    );
    expect([...tables.keys()]).toEqual(['pkg.rustc', 'pkg.cargo']);
    expect(Object.fromEntries(tables.get('pkg.rustc') ?? [])).toEqual({ hash: 'rustc' });
    expect(Object.fromEntries(tables.get('pkg.cargo') ?? [])).toEqual({ hash: 'cargo' });
  },
);

test('a header it can’t read ends the table before it, whose keys it then keeps from it', () => {
  const tables = parseChannel(
    ['[pkg.rustc]', 'hash = "rustc"', '[pkg."rust\\u0073td"]', 'hash = "elsewhere"'].join('\n'),
  );
  expect([...tables.keys()]).toEqual(['pkg.rustc']);
  expect(tables.get('pkg.rustc')?.get('hash')).toBe('rustc');
});

describe('Rust', () => {
  const TARGETS = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'linux-x64': 'x86_64-unknown-linux-gnu',
    'linux-arm64': 'aarch64-unknown-linux-gnu',
  } as const;
  const BASE = 'https://static.rust-lang.org/dist/2026-01-01/';

  /** A release of Rust 1.0.0, served as static.rust-lang.org would, its channel file signed. */
  async function release(options: { tamper?: string } = {}) {
    const signer = await publisher();
    const routes: Routes = {};
    const lines = ['manifest-version = "2"', '[pkg.rustc]', 'version = "1.0.0 (abc 2026-01-01)"'];
    const add = (component: string, target: string, folder: string, path: string) => {
      const name = target === '*' ? `${component}-1.0.0` : `${component}-1.0.0-${target}`;
      const archive = tarGz([
        { path: `${name}/${folder}/manifest.in`, data: `file:${path}` },
        { path: `${name}/${folder}/${path}`, data: `${component} for ${target}`, mode: 0o755 },
      ]);
      const url = `${BASE}${name}.tar.gz`;
      routes[url] = { body: name === options.tamper ? Buffer.from('tampered') : archive };
      const quoted = target === '*' ? '"*"' : target;
      lines.push(
        `[pkg.${component}.target.${quoted}]`,
        'available = true',
        `url = "${url}"`,
        `hash = "${sha256(archive)}"`,
      );
    };
    for (const target of Object.values(TARGETS)) {
      add('rustc', target, 'rustc', 'bin/rustc');
      add('cargo', target, 'cargo', 'bin/cargo');
      add('rust-std', target, `rust-std-${target}`, `lib/rustlib/${target}/lib/libstd.rlib`);
    }
    add('rust-src', '*', 'rust-src', 'lib/rustlib/src/rust/library/lib.rs');
    const channel = Buffer.from(`${lines.join('\n')}\n`);
    const address = 'https://static.rust-lang.org/dist/channel-rust-1.0.0.toml';
    routes[address] = { body: channel };
    routes[`${address}.asc`] = { body: await signer.signDetached(channel, true) };
    return { signer, ...(await tools(routes)) };
  }

  test('records rustc, cargo, the standard library and its sources as layers of one sysroot', async () => {
    const { signer, tools: given } = await release();
    const pinned = await rust([signer.publicKey])('1.0.0', given);
    expect(pinned.hosts).toEqual(['static.rust-lang.org']);
    for (const platform of PLATFORMS) {
      const target = TARGETS[platform];
      const download = pinned.platforms[platform];
      expect(download).toMatchObject({ kind: 'layers', entry: 'bin/cargo' });
      if (download?.kind !== 'layers') throw new Error('no layers');
      expect(download.layers.map((layer) => layer.from)).toEqual([
        `rustc-1.0.0-${target}/rustc`,
        `cargo-1.0.0-${target}/cargo`,
        `rust-std-1.0.0-${target}/rust-std-${target}`,
        'rust-src-1.0.0/rust-src',
      ]);
      // What each layer holds, but its list.
      const holds = ['rustc', 'cargo', 'rust-std', 'rust-src'].map((component) =>
        Buffer.byteLength(`${component} for ${component === 'rust-src' ? '*' : target}`),
      );
      expect(download.unpacked).toBe(holds.reduce((sum, bytes) => sum + bytes, 0));
    }
  });

  test('refuses a channel file signed by another key, and a component it doesn’t list', async () => {
    const other = await publisher();
    const unsigned = await release();
    await expect(rust([other.publicKey])('1.0.0', unsigned.tools)).rejects.toThrow(
      /isn't signed with one of the keys/,
    );
    const tampered = await release({ tamper: 'cargo-1.0.0-x86_64-apple-darwin' });
    await expect(rust([tampered.signer.publicKey])('1.0.0', tampered.tools)).rejects.toThrow(
      /isn’t what the channel file lists/,
    );
  });
});

/**
 * Go 1.0.0, served as dl.google.com and go.dev would, each archive signed, or with a signature of
 * another file when `signs` says.
 */
async function goRelease(options: { listed?: string; signs?: Buffer } = {}) {
  const signer = await publisher();
  const routes: Routes = {};
  const files = [];
  for (const arch of Object.values(GO_ARCH)) {
    const name = `go1.0.0.${arch}.tar.gz`;
    const archive = tarGz([{ path: 'go/bin/go', data: `go for ${arch}`, mode: 0o755 }]);
    routes[`https://dl.google.com/go/${name}`] = { body: archive };
    routes[`https://dl.google.com/go/${name}.asc`] = {
      body: await signer.signDetached(options.signs ?? archive, true),
    };
    files.push({ filename: name, kind: 'archive', sha256: options.listed ?? sha256(archive) });
  }
  routes['https://go.dev/dl/?mode=json&include=all'] = {
    body: Buffer.from(JSON.stringify([{ version: 'go1.0.0', files }])),
  };
  return { signer, ...(await tools(routes)) };
}

describe('Go', () => {
  test('records each archive its key signed and go.dev lists, refusing one it lists otherwise', async () => {
    const { signer, tools: given } = await goRelease();
    const pinned = await go([signer.publicKey])('1.0.0', given);
    expect(pinned.hosts).toEqual(['dl.google.com']);
    expect(pinned.platforms['linux-arm64']).toMatchObject({
      kind: 'tar.gz',
      url: 'https://dl.google.com/go/go1.0.0.linux-arm64.tar.gz',
      entry: 'go/bin/go',
      unpacked: Buffer.byteLength('go for linux-arm64'),
    });
    const listed = await goRelease({ listed: 'f'.repeat(64) });
    await expect(go([listed.signer.publicKey])('1.0.0', listed.tools)).rejects.toThrow(
      /isn’t what go\.dev lists/,
    );
  });

  test('refuses an archive signed by another key, or whose signature is of another file', async () => {
    const other = await publisher();
    const unsigned = await goRelease();
    await expect(go([other.publicKey])('1.0.0', unsigned.tools)).rejects.toThrow(
      /isn't signed with one of the keys/,
    );
    const elsewhere = await goRelease({ signs: Buffer.from('another file') });
    await expect(go([elsewhere.signer.publicKey])('1.0.0', elsewhere.tools)).rejects.toThrow(
      /isn't signed with one of the keys/,
    );
  });
});

/** Temurin's names for the platforms. */
const TEMURIN_ARCH = ['aarch64_mac', 'x64_mac', 'x64_linux', 'aarch64_linux'] as const;

/**
 * The Temurin JDK 25.0.1+8, served as GitHub would, each archive with its binary signature, or a
 * signature of another file when `signs` says.
 */
async function temurinRelease(options: { signs?: Buffer } = {}) {
  const signer = await publisher();
  const routes: Routes = {};
  const base = 'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.1%2B8/';
  for (const arch of TEMURIN_ARCH) {
    const name = `OpenJDK25U-jdk_${arch}_hotspot_25.0.1_8.tar.gz`;
    const home = arch.endsWith('_mac') ? 'jdk-25.0.1+8/Contents/Home' : 'jdk-25.0.1+8';
    const archive = tarGz([{ path: `${home}/bin/java`, data: `java for ${arch}`, mode: 0o755 }]);
    routes[`${base}${name}`] = { body: archive };
    routes[`${base}${name}.sig`] = { body: await signer.signDetached(options.signs ?? archive) };
  }
  return { signer, ...(await tools(routes)) };
}

describe('Temurin', () => {
  test('records each archive Adoptium’s key signed, with the JDK’s home in it', async () => {
    const { signer, tools: given } = await temurinRelease();
    const pinned = await temurin([signer.publicKey])('25.0.1+8', given);
    expect(pinned.hosts).toEqual(['github.com', 'release-assets.githubusercontent.com']);
    expect(pinned.platforms['darwin-arm64']).toMatchObject({
      kind: 'tar.gz',
      entry: 'jdk-25.0.1+8/Contents/Home/bin/java',
    });
    expect(pinned.platforms['linux-x64']).toMatchObject({ entry: 'jdk-25.0.1+8/bin/java' });
  });

  test('refuses an archive signed by another key, or whose signature is of another file', async () => {
    const other = await publisher();
    const unsigned = await temurinRelease();
    await expect(temurin([other.publicKey])('25.0.1+8', unsigned.tools)).rejects.toThrow(
      /isn't signed with one of the keys/,
    );
    const elsewhere = await temurinRelease({ signs: Buffer.from('another file') });
    await expect(
      temurin([elsewhere.signer.publicKey])('25.0.1+8', elsewhere.tools),
    ).rejects.toThrow(/isn't signed with one of the keys/);
  });
});

/** A `releases.json` listing SDK 10.0.100's `files`. */
function releases(files: unknown[]): Buffer {
  return Buffer.from(JSON.stringify({ releases: [{ sdks: [{ version: '10.0.100', files }] }] }));
}

/** SDK 10.0.100's releases.json, as `site` and `repository` each list its archives. */
async function lists(change: (hash: string) => { site: string; repository: string }) {
  const routes: Routes = {};
  const site = [];
  const repository = [];
  for (const rid of ['osx-arm64', 'osx-x64', 'linux-x64', 'linux-arm64']) {
    const archive = tarGz([{ path: 'dotnet', data: `dotnet for ${rid}`, mode: 0o755 }]);
    const url = `https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.100/dotnet-sdk-10.0.100-${rid}.tar.gz`;
    routes[url] = { body: archive };
    const hash = createHash('sha512').update(archive).digest('hex');
    const hashes = change(hash);
    site.push({ name: `dotnet-sdk-${rid}.tar.gz`, url, hash: hashes.site });
    repository.push({ name: `dotnet-sdk-${rid}.tar.gz`, url, hash: hashes.repository });
  }
  routes['https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json'] = {
    body: releases(site),
  };
  routes['https://raw.githubusercontent.com/dotnet/core/main/release-notes/10.0/releases.json'] = {
    body: releases(repository),
  };
  return tools(routes);
}

describe('.NET', () => {
  test('records each archive whose SHA-512 both lists give', async () => {
    const { tools: given } = await lists((hash) => ({
      site: hash,
      repository: hash.toUpperCase(),
    }));
    const pinned = await dotnet()('10.0.100', given);
    expect(pinned.platforms['linux-x64']).toMatchObject({ kind: 'tar.gz', entry: 'dotnet' });
  });

  test.each([
    [
      'the lists differ',
      (hash: string) => ({ site: hash, repository: 'a'.repeat(128) }),
      /differently/,
    ],
    [
      'both list another file',
      () => ({ site: 'a'.repeat(128), repository: 'a'.repeat(128) }),
      /isn’t what both releases\.json files list/,
    ],
  ])('refuses an archive when %s', async (_, change, message) => {
    const { tools: given } = await lists(change);
    await expect(dotnet()('10.0.100', given)).rejects.toThrow(message);
  });
});
