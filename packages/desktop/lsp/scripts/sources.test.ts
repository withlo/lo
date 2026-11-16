// pin.ts's checks against a server on this machine, with keys made by the test: what it records,
// and what it refuses to.

import { generateKeyPairSync, sign } from 'node:crypto';

import * as openpgp from 'openpgp';
import { expect, test } from 'vitest';

import { type Platform, PLATFORMS } from '../src/index.ts';
import { serve, sha256, tarGz } from '../test/downloads.ts';
import { tempFolder } from '../test/support.ts';
import { githubRelease, node, type RegistryKey, verifyRegistry } from './sources.ts';

/** A key that signs as one of Node's releasers would, and its armored public key. */
async function releaser() {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: 'curve25519',
    userIDs: [{ name: 'Releaser' }],
    format: 'object',
  });
  const signDetached = async (data: Buffer) =>
    Buffer.from(
      await openpgp.sign({
        message: await openpgp.createMessage({ binary: data }),
        signingKeys: privateKey,
        detached: true,
        format: 'binary',
      }),
    );
  return { publicKey: publicKey.armor(), signDetached };
}

/** A Node release of `version`, served as nodejs.org would, with its checksums signed by `signer`. */
async function release(
  version: string,
  signer: (data: Buffer) => Promise<Buffer>,
  options: { tamper?: string } = {},
) {
  const base = `https://nodejs.org/dist/v${version}/`;
  const routes: Record<string, { body: Buffer }> = {};
  const lines: string[] = [];
  for (const platform of PLATFORMS) {
    const name = `node-v${version}-${platform}`;
    const tarball = tarGz([
      { path: `${name}/bin/node`, data: `node for ${platform}`, mode: 0o755 },
    ]);
    lines.push(`${sha256(tarball)}  ${name}.tar.gz`);
    routes[`${base}${name}.tar.gz`] = {
      body: platform === options.tamper ? Buffer.concat([tarball, Buffer.from('x')]) : tarball,
    };
  }
  const sums = Buffer.from(`${lines.join('\n')}\n`);
  routes[`${base}SHASUMS256.txt`] = { body: sums };
  routes[`${base}SHASUMS256.txt.sig`] = { body: await signer(sums) };
  const served = await serve(routes);
  return { ...served, tools: { fetch: served.fetch, folder: tempFolder(), log: () => undefined } };
}

test('records Node from checksums one of its releasers signed', async () => {
  const signer = await releaser();
  const { tools } = await release('26.0.0', signer.signDetached);
  const pinned = await node([signer.publicKey])('26.0.0', tools);
  expect(pinned.hosts).toEqual(['nodejs.org']);
  expect(Object.keys(pinned.platforms).toSorted()).toEqual([...PLATFORMS].toSorted());
  expect(pinned.platforms['linux-x64']).toMatchObject({
    kind: 'tar.gz',
    url: 'https://nodejs.org/dist/v26.0.0/node-v26.0.0-linux-x64.tar.gz',
    entry: 'node-v26.0.0-linux-x64/bin/node',
  });
});

test('refuses checksums signed by anyone else, or a tarball they don’t list', async () => {
  const signer = await releaser();
  const stranger = await releaser();
  const forged = await release('26.0.0', stranger.signDetached);
  await expect(node([signer.publicKey])('26.0.0', forged.tools)).rejects.toThrow(
    /isn't signed with one of the keys/,
  );

  const tampered = await release('26.0.0', signer.signDetached, { tamper: 'darwin-x64' });
  await expect(node([signer.publicKey])('26.0.0', tampered.tools)).rejects.toThrow(
    /node-v26\.0\.0-darwin-x64\.tar\.gz isn’t what SHASUMS256\.txt lists/,
  );
});

test('takes a package only with its integrity signed by npm’s registry', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const der = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const keys: RegistryKey[] = [
    { keyid: 'SHA256:old', key: der, expires: '2025-01-29T00:00:00.000Z' },
    { keyid: 'SHA256:new', key: der, expires: null },
  ];
  const integrity = 'sha512-abc';
  const signature = (signed: string) =>
    sign('sha256', Buffer.from(signed), privateKey).toString('base64');
  const sig = signature(`pkg@1.0.0:${integrity}`);
  const { fetch } = await serve({
    'https://registry.npmjs.org/pkg': {
      body: Buffer.from(JSON.stringify({ time: { '1.0.0': '2024-05-01T00:00:00.000Z' } })),
    },
    'https://registry.npmjs.org/late': {
      body: Buffer.from(JSON.stringify({ time: { '1.0.0': '2025-05-01T00:00:00.000Z' } })),
    },
  });
  const tools = { fetch, folder: tempFolder() };
  await verifyRegistry('pkg', '1.0.0', integrity, [{ keyid: 'SHA256:new', sig }], keys, tools);
  // A key that has expired counts only for what it signed before then.
  await verifyRegistry('pkg', '1.0.0', integrity, [{ keyid: 'SHA256:old', sig }], keys, tools);
  const late = signature(`late@1.0.0:${integrity}`);
  await expect(
    verifyRegistry('late', '1.0.0', integrity, [{ keyid: 'SHA256:old', sig: late }], keys, tools),
  ).rejects.toThrow(/didn't sign late@1\.0\.0/);
  // Another integrity, or a key it doesn't know, is refused.
  await expect(
    verifyRegistry('pkg', '1.0.0', 'sha512-other', [{ keyid: 'SHA256:new', sig }], keys, tools),
  ).rejects.toThrow(/didn't sign pkg@1\.0\.0/);
  await expect(
    verifyRegistry('pkg', '1.0.0', integrity, [{ keyid: 'SHA256:else', sig }], keys, tools),
  ).rejects.toThrow(/didn't sign pkg@1\.0\.0/);
});

/**
 * A GitHub release of `version`, served as github.com would, each archive redirected to GitHub's
 * store and listed in the `.sha256` beside it.
 */
async function githubServed(
  version: string,
  options: { tamper?: string; elsewhere?: string } = {},
) {
  const base = `https://github.com/lo/server/releases/download/v${version}/`;
  const store = 'https://release-assets.githubusercontent.com/assets/';
  const routes: Record<string, { body: Buffer } | { redirect: string }> = {};
  for (const platform of PLATFORMS) {
    const name = `server-${platform}.tar.gz`;
    const archive = tarGz([{ path: 'server', data: `server for ${platform}`, mode: 0o755 }]);
    routes[`${base}${name}.sha256`] = { body: Buffer.from(`${sha256(archive)}  ${name}\n`) };
    const stored = platform === options.elsewhere ? 'https://example.com/' : store;
    routes[`${base}${name}`] = { redirect: `${stored}${name}` };
    routes[`${stored}${name}`] = {
      body: platform === options.tamper ? Buffer.concat([archive, Buffer.from('x')]) : archive,
    };
  }
  const served = await serve(routes);
  return { fetch: served.fetch, folder: tempFolder(), log: () => undefined };
}

const ARCHIVES: Record<Platform, string> = {
  'darwin-arm64': 'server-darwin-arm64.tar.gz',
  'darwin-x64': 'server-darwin-x64.tar.gz',
  'linux-x64': 'server-linux-x64.tar.gz',
  'linux-arm64': 'server-linux-arm64.tar.gz',
};

test('records a GitHub release’s archives, each as the checksum beside it lists', async () => {
  const pinned = await githubRelease(
    'lo/server',
    ARCHIVES,
    'server',
  )('1.2.3', await githubServed('1.2.3'));
  expect(pinned.hosts).toEqual(['github.com', 'release-assets.githubusercontent.com']);
  expect(Object.keys(pinned.platforms).toSorted()).toEqual([...PLATFORMS].toSorted());
  expect(pinned.platforms['darwin-arm64']).toMatchObject({
    kind: 'tar.gz',
    url: 'https://github.com/lo/server/releases/download/v1.2.3/server-darwin-arm64.tar.gz',
    entry: 'server',
  });
});

test('refuses an archive its checksum doesn’t list, or one stored anywhere but GitHub', async () => {
  const source = githubRelease('lo/server', ARCHIVES, 'server');
  await expect(
    source('1.2.3', await githubServed('1.2.3', { tamper: 'linux-arm64' })),
  ).rejects.toThrow(
    /server-linux-arm64\.tar\.gz isn’t what server-linux-arm64\.tar\.gz\.sha256 lists/,
  );
  await expect(
    source('1.2.3', await githubServed('1.2.3', { elsewhere: 'linux-x64' })),
  ).rejects.toThrow(/example\.com/);
  await expect(source('latest', await githubServed('1.2.3'))).rejects.toThrow(
    /isn’t a release’s version/,
  );
});
