// What Settings lists of the toolchains, removing one, and what a server says when its toolchain
// can't download or was removed, against a stand-in installer and pool.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DownloadError, Installer, partsOf, TOOLCHAINS } from '@lo/lsp';
import { expect, it, onTestFinished } from 'vitest';

import { ADAPTERS as SHIPPED, type Adapter } from './adapters.ts';
import {
  listedToolchain,
  listToolchains,
  removalFailure,
  removedMessage,
  removeToolchain,
  toolchainFailure,
  type ToolchainHost,
} from './toolchains.ts';

function adapter(id: string, name: string, toolchains: readonly string[]): Adapter {
  return {
    id,
    name,
    languages: {},
    downloads: { toolchains },
    prepare: () => Promise.reject(new Error('not in tests')),
  };
}

const ADAPTERS = [
  adapter('java', 'Java', ['temurin']),
  adapter('kotlin', 'Kotlin', ['temurin']),
  adapter('typescript', 'TypeScript', []),
];

/** A host whose installer has `installed` downloaded, with their sizes, and what it was told. */
function host(installed: Record<string, number> = {}) {
  const removed: string[] = [];
  const halted: { stopped: string[]; message: string }[] = [];
  const order: string[] = [];
  const given: ToolchainHost = {
    manifest: TOOLCHAINS,
    platform: 'darwin-arm64',
    installer: () => ({
      recorded: (id) => Promise.resolve(installed[id]),
      remove: async (id, _reason, first) => {
        order.push(`refuse ${id}`);
        await first?.();
        order.push(`delete ${id}`);
        removed.push(id);
      },
    }),
    adapters: () => ADAPTERS,
    halt: (uses, message) => {
      order.push('halt');
      halted.push({ stopped: ADAPTERS.filter(uses).map((each) => each.id), message });
      return Promise.resolve();
    },
  };
  return { given, removed, halted, order };
}

it('lists each toolchain pinned for this system, downloaded or not, and what uses it', async () => {
  const listed = await listToolchains(host({ go: 240_208_599 }).given);
  expect(listed.map((each) => [each.id, each.name, each.installed, each.uses])).toEqual([
    ['dotnet', '.NET SDK', null, []],
    ['go', 'Go', 240_208_599, []],
    ['rust', 'Rust', null, []],
    ['temurin', 'Temurin JDK', null, ['Java', 'Kotlin']],
  ]);
  // Rust's download is its layers, added up.
  const rust = listed.find((each) => each.id === 'rust');
  const pinned = TOOLCHAINS.rust?.platforms['darwin-arm64'];
  const layers = pinned === undefined ? [] : partsOf(pinned);
  expect(layers).toHaveLength(4);
  expect(rust).toMatchObject({
    version: TOOLCHAINS.rust?.version,
    download: layers.reduce((sum, layer) => sum + layer.size, 0),
  });
});

it('lists nothing downloaded while the cache isn’t open, and nothing for a system Lo has none for', async () => {
  const { given } = host();
  expect(
    (await listToolchains({ ...given, installer: () => undefined })).map((each) => each.installed),
  ).toEqual([null, null, null, null]);
  expect(await listToolchains({ ...given, platform: undefined })).toEqual([]);
});

it('stops the servers that use a toolchain, each saying so, before its files go', async () => {
  const { given, removed, halted, order } = host({ temurin: 1 });
  await removeToolchain(given, 'temurin');
  expect(halted).toEqual([
    {
      stopped: ['java', 'kotlin'],
      message: 'The Temurin JDK was removed. Restart downloads it again.',
    },
  ]);
  expect(removed).toEqual(['temurin']);
  expect(order).toEqual(['refuse temurin', 'halt', 'delete temurin']);
  await expect(removeToolchain(given, 'ruby')).rejects.toThrow(/no toolchain ruby/);
});

it('refuses an install of a toolchain from the moment Remove starts, while its servers stop', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'lo-toolchains-'));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  const installer = new Installer({
    folder,
    fetch: () => Promise.reject(new Error('no downloads in tests')),
    platform: 'darwin-arm64',
    backoff: [0, 0],
  });
  let during: unknown;
  const given: ToolchainHost = {
    ...host().given,
    installer: () => installer,
    // A server starting while the others stop, or "Restart" pressed then.
    halt: async () => {
      during = await installer.install('go', TOOLCHAINS.go!).catch((error: unknown) => error);
    },
  };
  await removeToolchain(given, 'go');
  expect(during).toEqual(new Error('Go was removed. Restart downloads it again.'));
});

it('gives a server only the toolchains its adapter names, which “Remove” stops it for', async () => {
  const asked: string[] = [];
  const toolchain = listedToolchain(ADAPTERS[0]!, (id) => {
    asked.push(id);
    return Promise.resolve(id);
  });
  expect(await toolchain('temurin')).toBe('temurin');
  await expect(toolchain('dotnet')).rejects.toThrow(
    'Java doesn’t name the toolchain dotnet among its downloads.',
  );
  expect(asked).toEqual(['temurin']);
});

it('gives Lo’s own servers only the toolchains they name: Rust’s Rust, Go’s Go, and the rest none', async () => {
  expect(SHIPPED.map((each) => [each.name, each.downloads?.toolchains])).toEqual([
    ['TypeScript', []],
    ['Python', []],
    ['Rust', ['rust']],
    ['PHP', []],
    ['Go', ['go']],
    ['Terraform', []],
  ]);
  for (const shipped of SHIPPED) {
    const toolchain = listedToolchain(shipped, (id) => Promise.resolve(id));
    const named = shipped.downloads?.toolchains ?? [];
    for (const id of named) expect(await toolchain(id)).toBe(id);
    for (const id of Object.keys(TOOLCHAINS).filter((each) => !named.includes(each))) {
      await expect(toolchain(id)).rejects.toThrow(
        `${shipped.name} doesn’t name the toolchain ${id} among its downloads.`,
      );
    }
  }
  // So Settings lists Rust's server as using Rust, and Go's as using Go.
  const listed = await listToolchains({ ...host().given, adapters: () => SHIPPED });
  expect(listed.map((each) => [each.id, each.uses])).toEqual([
    ['dotnet', []],
    ['go', ['Go']],
    ['rust', ['Rust']],
    ['temurin', []],
  ]);
});

it('names the toolchain and why, when one can’t download or was removed', () => {
  const mismatch = new DownloadError(
    'mismatch',
    'The download isn’t the file Lo pinned: its SHA-256 is another.',
  );
  expect(toolchainFailure('temurin', mismatch).message).toBe(
    'The Temurin JDK couldn’t download. The download isn’t the file Lo pinned: its SHA-256 is another.',
  );
  expect(
    toolchainFailure('dotnet', new DownloadError('space', 'Lo needs 877 MB free.')).message,
  ).toBe('The .NET SDK couldn’t download. Lo needs 877 MB free.');
  expect(removedMessage('go')).toBe('Go was removed. Restart downloads it again.');
});

it('says why a toolchain’s files weren’t deleted', () => {
  const denied = Object.assign(new Error('EACCES: permission denied'), {
    code: 'EACCES',
    path: '/lo/toolchains/go',
  });
  expect(removalFailure(denied)).toBe('Lo isn’t allowed to delete /lo/toolchains/go.');
  const busy = Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
  expect(removalFailure(busy)).toBe('A program is using its folder.');
  expect(removalFailure(new Error('The disk is full'))).toBe('The disk is full.');
});
