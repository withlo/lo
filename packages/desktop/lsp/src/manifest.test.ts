import { expect, test } from 'vitest';

import { MANIFEST, parseManifest, parseToolchains, PLATFORMS, TOOLCHAINS } from './manifest.ts';

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
  expect(Object.keys(TOOLCHAINS).toSorted()).toEqual(['dotnet', 'go', 'rust', 'temurin']);
  for (const entry of Object.values(TOOLCHAINS)) {
    for (const platform of PLATFORMS) {
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
  expect(() => parseToolchains({ go: changed })).toThrow(/doesn't say what it unpacks to/);
  // A server needn't.
  expect(() => parseManifest({ go: changed })).not.toThrow();
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
