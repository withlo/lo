// The servers that run on Lo's Node, as their adapters start them: what runs, with which flags,
// what each is told, and what the manifest pins for it. No server runs here; `test/hostile.test.ts`
// starts each as Lo would, with the fake server standing in for it.

import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import type { Installed } from '../install.ts';
import { MANIFEST } from '../manifest.ts';
import { sectionOf } from '../requests.ts';
import { LIMITS } from '../server.ts';
import { heapCap, launchOnNode, type NodeServer } from './node.ts';
import { NO_PYTHON, PYRIGHT } from './pyright.ts';
import { VTSLS } from './vtsls.ts';

const SERVERS = [VTSLS, PYRIGHT];

/** Lo's Node, installed as the manifest pins it. */
const NODE: Installed = {
  folder: '/lo/cache/servers/node/26.13.1/files',
  entry: '/lo/cache/servers/node/26.13.1/files/node-v26.13.1-darwin-arm64/bin/node',
};

/** `server`'s npm download, as the manifest pins it. */
function pinned(server: NodeServer) {
  const download = MANIFEST[server.id]?.platforms.any;
  if (download?.kind !== 'npm') throw new Error(`${server.id} isn't pinned as an npm package`);
  return { version: MANIFEST[server.id]?.version ?? '', download };
}

/** `server`, installed as the manifest pins it. */
function installed(server: NodeServer): Installed {
  const { version, download } = pinned(server);
  const folder = `/lo/cache/servers/${server.id}/${version}/files`;
  return { folder, entry: `${folder}/${download.entry}` };
}

/** What `server` hears when it asks for the setting `section`. */
function setting(server: NodeServer, section: string): unknown {
  return sectionOf(server.settings, section);
}

/** The most memory, in megabytes, `flags` let a Node's heap take. */
function heap(flags: readonly string[]): number {
  const caps = flags.flatMap((flag) => /^--max-old-space-size=(\d+)$/.exec(flag)?.[1] ?? []);
  expect(caps).toHaveLength(1);
  return Number(caps[0]);
}

test('each starts as Lo’s Node, its heap capped, then its own entry point, with no launcher', () => {
  const entries = Object.fromEntries(
    SERVERS.map((server) => [server.id, pinned(server).download.entry]),
  );
  expect(entries).toEqual({
    // vtsls's own, not `bin/vtsls.js`, which only loads it.
    vtsls: 'node_modules/@vtsls/language-server/dist/main.js',
    pyright: 'node_modules/pyright/langserver.index.js',
  });
  for (const server of SERVERS) {
    const install = installed(server);
    const launch = launchOnNode(server, NODE, install);
    expect(launch.program).toBe(NODE.entry);
    expect(launch.args).toEqual([...server.node, install.entry, '--stdio']);
    expect(server.node).toEqual([expect.stringMatching(/^--max-old-space-size=\d+$/)]);
    // Nothing of its own goes into its environment, which is Lo's alone.
    expect([launch.path, launch.variables, launch.allowed]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  }
  expect(() =>
    launchOnNode(VTSLS, { folder: 'node', entry: 'node/bin/node' }, installed(VTSLS)),
  ).toThrow("node/bin/node isn't an absolute path");
  expect(() => launchOnNode({ ...VTSLS, id: 'tsserver' }, NODE, installed(VTSLS))).toThrow(
    'has no tsserver',
  );
});

test('each says what it is, with its version and license, wherever its details show', () => {
  expect(SERVERS.map((server) => launchOnNode(server, NODE, installed(server)).version)).toEqual([
    `vtsls ${pinned(VTSLS).version} · MIT`,
    `Pyright ${pinned(PYRIGHT).version} · MIT`,
  ]);
  // The README lists each with its version, source and license.
  const readme = readFileSync(join(import.meta.dirname, '..', '..', 'README.md'), 'utf8');
  for (const server of SERVERS) {
    const row = new RegExp(
      `^\\| ${server.name}\\b[^|\\n]*\\| ${pinned(server).version} +\\|[^\\n]*\\| ${server.license}\\b`,
      'm',
    );
    expect(readme).toMatch(row);
  }
});

test('each says whether it gives the inlay hints `gh` shows: Pyright has none', () => {
  expect(SERVERS.map((server) => [server.id, server.hints])).toEqual([
    ['vtsls', true],
    ['pyright', false],
  ]);
});

test('each one’s heaps fit under Lo’s cap on its group', () => {
  const cap = LIMITS.memoryCap / 1024 ** 2;
  // vtsls, and the `tsserver` it starts.
  const tsserver = Number(setting(VTSLS, 'typescript.tsserver.maxTsServerMemory'));
  expect(heap(VTSLS.node) + tsserver).toBeLessThan(cap);
  expect(setting(VTSLS, 'typescript.tsserver.useSyntaxServer')).toBe('never');
  expect(heap(PYRIGHT.node)).toBeLessThan(cap);
  expect(heapCap(512)).toBe('--max-old-space-size=512');
});

describe('vtsls', () => {
  test('runs its own TypeScript, pinned with it', () => {
    const paths = pinned(VTSLS).download.packages.map((pkg) => pkg.path);
    expect(paths).toContain('node_modules/@vtsls/language-server');
    expect(paths).toContain('node_modules/typescript');
    // Never a workspace's: no folder of one is given, and none is picked by itself.
    expect(setting(VTSLS, 'typescript.tsdk')).toBeNull();
    expect(setting(VTSLS, 'vtsls.typescript.globalTsdk')).toBeNull();
    expect(setting(VTSLS, 'vtsls.autoUseWorkspaceTsdk')).toBe(false);
    // `tsserver` runs on vtsls's Node, and TypeScript's Go port, another program, is off.
    expect(setting(VTSLS, 'typescript.tsserver.nodePath')).toBeNull();
    expect(setting(VTSLS, 'typescript.experimental.useTsgo')).toBe(false);
  });

  test('loads no plugin from the checkout, and installs and fetches nothing', () => {
    expect(setting(VTSLS, 'typescript.tsserver.pluginPaths')).toEqual([]);
    expect(setting(VTSLS, 'vtsls.tsserver.globalPlugins')).toEqual([]);
    expect(setting(VTSLS, 'typescript.disableAutomaticTypeAcquisition')).toBe(true);
    expect(setting(VTSLS, 'typescript.npm')).toBeNull();
    expect(setting(VTSLS, 'typescript.check.npmIsInstalled')).toBe(false);
    expect(setting(VTSLS, 'typescript.tsserver.log')).toBe('off');
  });

  test('gives the type hints gh shows, in TypeScript and JavaScript', () => {
    for (const language of ['typescript', 'javascript']) {
      expect(setting(VTSLS, `${language}.inlayHints.variableTypes.enabled`)).toBe(true);
      expect(setting(VTSLS, `${language}.inlayHints.functionLikeReturnTypes.enabled`)).toBe(true);
    }
  });
});

describe('Pyright', () => {
  test('is given no interpreter it can run, and looks for none', () => {
    expect(setting(PYRIGHT, 'python.pythonPath')).toBe(NO_PYTHON);
    expect(NO_PYTHON).toBe('/dev/null');
    // A device, never a program: Pyright's attempt to run it fails, and it runs nothing else.
    expect(statSync(NO_PYTHON).isFile()).toBe(false);
    expect(() => accessSync(NO_PYTHON, constants.X_OK)).toThrow('EACCES');
    // Nor does Lo name a virtual environment, and its analysis is as with no settings at all.
    expect(setting(PYRIGHT, 'python.venvPath')).toBeNull();
    expect(setting(PYRIGHT, 'python.analysis')).toBeNull();
  });

  test('is one package, with nothing else for npm to bring', () => {
    expect(pinned(PYRIGHT).download.packages.map((pkg) => pkg.path)).toEqual([
      'node_modules/pyright',
    ]);
  });
});
