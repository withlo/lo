// The adapters Lo ships: which files each reads, and what it downloads before it starts. What each
// server runs as, and is told, is `@lo/lsp`'s, and tested there.

import {
  type Installed,
  type InstalledToolchain,
  launchOnNode,
  launchRustAnalyzer,
  PYRIGHT,
  RUST_ANALYZER,
  toolchainUse,
  VTSLS,
} from '@lo/lsp';
import { describe, expect, it } from 'vitest';

import { ADAPTERS, adapterFor } from './adapters.ts';

function installedAs(id: string): Installed {
  return { folder: `/lo/cache/servers/${id}`, entry: `/lo/cache/servers/${id}/entry` };
}

/** Lo's Rust toolchain, installed, as the desktop side hands it to an adapter. */
function installedToolchain(): InstalledToolchain {
  const installed: Installed = {
    folder: '/lo/cache/toolchains/rust',
    entry: '/lo/cache/toolchains/rust/bin/cargo',
  };
  return { installed, ...toolchainUse('rust', '1.100.0', installed) };
}

/** The adapter that reads the file at `path`, by name, and the protocol's id for the file. */
function readBy(path: string) {
  const found = adapterFor(ADAPTERS, path);
  return found && [found.adapter.name, found.languageId];
}

describe('Lo’s adapters', () => {
  it('read TypeScript and JavaScript, Python, and Rust', () => {
    expect(readBy('src/a.ts')).toEqual(['TypeScript', 'typescript']);
    expect(readBy('src/a.mts')).toEqual(['TypeScript', 'typescript']);
    expect(readBy('src/A.tsx')).toEqual(['TypeScript', 'typescriptreact']);
    expect(readBy('src/a.js')).toEqual(['TypeScript', 'javascript']);
    expect(readBy('src/a.jsx')).toEqual(['TypeScript', 'javascript']);
    expect(readBy('pkg/a.py')).toEqual(['Python', 'python']);
    expect(readBy('pkg/a.pyi')).toEqual(['Python', 'python']);
    expect(readBy('src/a.rs')).toEqual(['Rust', 'rust']);
    // PHP and Ruby have none.
    expect(readBy('src/A.php')).toBeUndefined();
    expect(readBy('lib/a.rb')).toBeUndefined();
  });

  it('download Node, then a JavaScript server, and start it on that Node, with no toolchain', async () => {
    const servers = new Map([
      ['typescript', VTSLS],
      ['python', PYRIGHT],
    ]);
    for (const adapter of ADAPTERS) {
      if (adapter.id === 'rust') continue;
      const installs: string[] = [];
      const toolchains: string[] = [];
      const prepared = await adapter.prepare({
        install: (id) => {
          installs.push(id);
          return Promise.resolve(installedAs(id));
        },
        toolchain: (id) => {
          toolchains.push(id);
          return Promise.reject(new Error('no toolchain is asked for'));
        },
        findCopy: () => Promise.reject(new Error('no copy is looked for')),
        signal: new AbortController().signal,
      });
      const server = servers.get(adapter.id);
      if (!server) throw new Error(`${adapter.id} has no server here`);
      expect(installs).toEqual(['node', server.id]);
      expect(toolchains).toEqual([]);
      // Named up front, so the status bar adds them up from the first byte.
      expect(adapter.downloads).toEqual({ servers: ['node', server.id], toolchains: [] });
      expect(prepared).toEqual({
        kind: 'ready',
        launch: launchOnNode(server, installedAs('node'), installedAs(server.id)),
      });
    }
  });

  it('download rust-analyzer and Lo’s Rust toolchain, and start it on that toolchain', async () => {
    const rust = ADAPTERS.find((adapter) => adapter.id === 'rust');
    if (!rust) throw new Error('there is no Rust adapter');
    const installs: string[] = [];
    const toolchains: string[] = [];
    const toolchain = installedToolchain();
    const prepared = await rust.prepare({
      install: (id) => {
        installs.push(id);
        return Promise.resolve(installedAs(id));
      },
      toolchain: (id) => {
        toolchains.push(id);
        return Promise.resolve(toolchain);
      },
      findCopy: () => Promise.reject(new Error('no copy is looked for')),
      signal: new AbortController().signal,
    });
    expect(installs).toEqual([RUST_ANALYZER.id]);
    expect(toolchains).toEqual(['rust']);
    // Named up front: the server and the toolchain it runs on.
    expect(rust.downloads).toEqual({ servers: [RUST_ANALYZER.id], toolchains: ['rust'] });
    expect(prepared).toEqual({
      kind: 'ready',
      launch: launchRustAnalyzer(installedAs(RUST_ANALYZER.id), toolchain),
    });
  });

  it('say which servers give no inline type hints, as Pyright gives none', () => {
    expect(ADAPTERS.map((adapter) => [adapter.id, adapter.noHints])).toEqual([
      ['typescript', undefined],
      ['python', 'Pyright has no type hints.'],
      ['rust', undefined],
    ]);
  });

  it('start nothing when a download fails', async () => {
    const [typescript] = ADAPTERS;
    const failed = new Error('npm’s registry answered 503');
    await expect(
      typescript?.prepare({
        install: (id) =>
          id === 'node' ? Promise.resolve(installedAs(id)) : Promise.reject(failed),
        toolchain: () => Promise.reject(new Error('no toolchain is asked for')),
        findCopy: () => Promise.resolve(undefined),
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(failed);
  });
});
