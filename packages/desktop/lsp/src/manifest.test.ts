import { expect, test } from 'vitest';

import {
  MANIFEST,
  parseManifest,
  parseToolchains,
  PLATFORMS,
  TOOLCHAINS,
  versionFor,
} from './manifest.ts';
import { SWIFT_DISTROS, SWIFT_PLATFORMS, swiftToolchainId } from './swift.ts';

const NODE = MANIFEST.node;

test('Lo’s manifest pins Node for every platform, from nodejs.org', () => {
  expect(NODE?.hosts).toEqual(['nodejs.org']);
  for (const platform of PLATFORMS) {
    expect(NODE?.platforms[platform]).toMatchObject({
      kind: 'tar.gz',
      url: `https://nodejs.org/dist/v${NODE?.version}/node-v${NODE?.version}-${platform}.tar.gz`,
      entry: `node-v${NODE?.version}-${platform}/bin/node`,
    });
  }
});

test.each([
  ['an address that isn’t https', { url: 'http://nodejs.org/node.tar.gz' }],
  ['an address on another port', { url: 'https://nodejs.org:8443/node.tar.gz' }],
  ['an address on a host it doesn’t list', { url: 'https://example.com/node.tar.gz' }],
  ['an entry point outside', { entry: '../bin/node' }],
  ['a hash that isn’t SHA-256', { sha256: 'abc' }],
])('refuses %s', (_, change) => {
  const download = NODE?.platforms['linux-x64'];
  const changed = { ...NODE, platforms: { 'linux-x64': { ...download, ...change } } };
  expect(() => parseManifest({ node: changed })).toThrow(/the manifest is invalid/);
});

test('refuses a version that isn’t a folder’s name', () => {
  expect(() => parseManifest({ node: { ...NODE, version: '../26' } })).toThrow(/a version/);
});

test('Lo’s toolchains are pinned for every platform, each with what it unpacks to', () => {
  const swift = SWIFT_DISTROS.map(swiftToolchainId);
  expect(Object.keys(TOOLCHAINS).toSorted()).toEqual(
    ['dotnet', 'go', 'rust', 'temurin', ...swift].toSorted(),
  );
  for (const [id, entry] of Object.entries(TOOLCHAINS)) {
    // Swift's, for Linux alone.
    for (const platform of swift.includes(id) ? SWIFT_PLATFORMS : PLATFORMS) {
      expect(entry.platforms[platform]?.unpacked).toBeGreaterThan(0);
    }
  }
  // Rust's components are layers of one sysroot.
  expect(TOOLCHAINS.rust?.platforms['darwin-arm64']).toMatchObject({
    kind: 'layers',
    entry: 'bin/cargo',
  });
});

test('refuses a toolchain that doesn’t say what it unpacks to', () => {
  const go = TOOLCHAINS.go;
  const download = go?.platforms['linux-x64'];
  const changed = { ...go, platforms: { 'linux-x64': { ...download, unpacked: undefined } } };
  expect(() => parseToolchains({ go: changed })).toThrow(/doesn’t say what it unpacks to/);
  // A server needn't.
  expect(() => parseManifest({ go: changed })).not.toThrow();
});

test('a toolchain’s platform may stay on an older version of its own, and a server’s may not', () => {
  const temurin = TOOLCHAINS.temurin;
  if (temurin === undefined) throw new Error('no Temurin');
  const download = temurin.platforms['darwin-x64'];
  const behind = {
    ...temurin,
    version: '99.0.0+1',
    platforms: { ...temurin.platforms, 'darwin-x64': { ...download, version: '98.0.0+1' } },
  };
  const parsed = parseToolchains({ temurin: behind }).temurin;
  if (parsed === undefined) throw new Error('no Temurin');
  expect(versionFor(parsed, 'darwin-x64')).toBe('98.0.0+1');
  expect(versionFor(parsed, 'linux-x64')).toBe('99.0.0+1');
  expect(() =>
    parseToolchains({
      temurin: { ...behind, platforms: { 'darwin-x64': { ...download, version: '../98' } } },
    }),
  ).toThrow(/a version/);
  const node = {
    ...NODE,
    platforms: { 'linux-x64': { ...NODE?.platforms['linux-x64'], version: '1.0.0' } },
  };
  expect(() => parseManifest({ node })).toThrow(/names a version of its own on linux-x64/);
});

test.each([
  ['no layers', { layers: [] }],
  ['a layer’s folder outside', { layers: [{ ...layerOf(), from: '../rustc' }] }],
])('refuses layers with %s', (_, change) => {
  const rust = TOOLCHAINS.rust;
  const changed = {
    ...rust,
    platforms: { 'linux-x64': { ...rust?.platforms['linux-x64'], ...change } },
  };
  expect(() => parseToolchains({ rust: changed })).toThrow(/the manifest is invalid/);
});

/** The first layer of Rust's download for Linux. */
function layerOf() {
  const download = TOOLCHAINS.rust?.platforms['linux-x64'];
  if (download?.kind !== 'layers') throw new Error('Rust has no layers');
  return download.layers[0];
}

/** gopls's download, which Lo builds from its modules. */
function goplsOf() {
  const download = MANIFEST.gopls?.platforms.any;
  if (download?.kind !== 'go') throw new Error('gopls isn’t built from its modules');
  return download;
}

/** A module path as the proxy protocol escapes it, unescaped: `!burnt!sushi` is `BurntSushi`. */
function unescaped(path: string): string {
  return path.replaceAll(/!([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

test('gopls is built with Lo’s Go, from modules from the Go module proxy, on every platform', () => {
  const gopls = goplsOf();
  expect(MANIFEST.gopls?.hosts).toEqual(['proxy.golang.org', 'storage.googleapis.com']);
  expect(gopls).toMatchObject({ entry: 'gopls', package: 'golang.org/x/tools/gopls' });
  // Its binary's hash holds only for the Go it's pinned with.
  expect(gopls.go).toBe(TOOLCHAINS.go?.version);
  expect(Object.keys(gopls.builds).toSorted()).toEqual([...PLATFORMS].toSorted());
  expect(gopls.mod).toContain('tool golang.org/x/tools/gopls');
  expect(gopls.mod).toContain(`\tgolang.org/x/tools/gopls v${MANIFEST.gopls?.version} // indirect`);
  // Each module file is one the go.sum holds a line for.
  const sums = new Set(gopls.sum.map((line) => line.split(' ').slice(0, 2).join(' ')));
  for (const module of gopls.modules) {
    expect(module.url).toBe(`https://proxy.golang.org/${module.path}`);
    const [, name, version, kind] = /^(.+)\/@v\/(.+)\.(mod|zip)$/.exec(module.path) ?? [];
    const key = `${unescaped(name ?? '')} ${unescaped(version ?? '')}`;
    expect(sums).toContain(kind === 'mod' ? `${key}/go.mod` : key);
  }
});

test('terraform-ls is pinned for every platform, from HashiCorp’s releases', () => {
  const pinned = MANIFEST['terraform-ls'];
  expect(pinned?.hosts).toEqual(['releases.hashicorp.com']);
  for (const platform of PLATFORMS) {
    const [os, arch] = platform.replace('x64', 'amd64').split('-');
    expect(pinned?.platforms[platform]).toMatchObject({
      kind: 'zip',
      entry: 'terraform-ls',
      url: `https://releases.hashicorp.com/terraform-ls/${pinned?.version}/terraform-ls_${pinned?.version}_${os}_${arch}.zip`,
    });
  }
});

test.each([
  ['no build', { builds: {} }],
  [
    'a module from another path',
    { modules: [{ ...moduleOf(), url: 'https://proxy.golang.org/x' }] },
  ],
  ['a module path outside the proxy', { modules: [{ ...moduleOf(), path: '../@v/v1.0.0.zip' }] }],
  ['a module file twice', { modules: [moduleOf(), moduleOf()] }],
  ['a go.mod line that ends another', { mod: ['module lo/gopls\nreplace x => ../x'] }],
  ['a go.sum line that isn’t one', { sum: ['golang.org/x/tools v0.1.0 h1:short='] }],
  ['a package that isn’t one', { package: 'golang.org/x/tools/gopls@latest' }],
])('refuses a Go program with %s', (_, change) => {
  const changed = { ...MANIFEST.gopls, platforms: { any: { ...goplsOf(), ...change } } };
  expect(() => parseManifest({ gopls: changed })).toThrow(/the manifest is invalid/);
});

/** The first module file gopls is built from. */
function moduleOf() {
  const [module] = goplsOf().modules;
  if (module === undefined) throw new Error('gopls has no modules');
  return module;
}
