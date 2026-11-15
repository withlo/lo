import { expect, test } from 'vitest';

import { MANIFEST, parseManifest, PLATFORMS } from './manifest.ts';

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
