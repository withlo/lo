// The adapters Lo ships: which files each reads, and what it downloads before it starts, which is
// no toolchain but for C#'s, which runs on Lo's .NET SDK. What each server runs as, and is told,
// is `@lo/lsp`'s, and tested there.

import {
  type Installed,
  launchNative,
  launchOnNode,
  launchRoslyn,
  PHP_LSP,
  PYRIGHT,
  ROSLYN,
  toolchainUse,
  VTSLS,
} from '@lo/lsp';
import { describe, expect, it } from 'vitest';

import { type Adapter, ADAPTERS, adapterFor, type Toolchain } from './adapters.ts';

function installedAs(id: string): Installed {
  return { folder: `/lo/cache/servers/${id}`, entry: `/lo/cache/servers/${id}/entry` };
}

/** The adapter that reads the file at `path`, by name, and the protocol's id for the file. */
function readBy(path: string) {
  const found = adapterFor(ADAPTERS, path);
  return found && [found.adapter.name, found.languageId];
}

/** Lo's adapter `id`. */
function shipped(id: string): Adapter {
  const found = ADAPTERS.find((adapter) => adapter.id === id);
  if (!found) throw new Error(`Lo ships no adapter ${id}`);
  return found;
}

/**
 * What `adapter` installs, in order, the toolchains it asks for, and what it says to start, with
 * every install there.
 */
async function prepared(adapter: Adapter) {
  const installs: string[] = [];
  const toolchains: string[] = [];
  const ready = await adapter.prepare({
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
  return { installs, toolchains, ready };
}

describe('Lo’s adapters', () => {
  it('read TypeScript and JavaScript, Python, PHP and C#', () => {
    expect(readBy('src/a.ts')).toEqual(['TypeScript', 'typescript']);
    expect(readBy('src/a.mts')).toEqual(['TypeScript', 'typescript']);
    expect(readBy('src/A.tsx')).toEqual(['TypeScript', 'typescriptreact']);
    expect(readBy('src/a.js')).toEqual(['TypeScript', 'javascript']);
    expect(readBy('src/a.jsx')).toEqual(['TypeScript', 'javascript']);
    expect(readBy('pkg/a.py')).toEqual(['Python', 'python']);
    expect(readBy('pkg/a.pyi')).toEqual(['Python', 'python']);
    expect(readBy('src/A.php')).toEqual(['PHP', 'php']);
    expect(readBy('views/a.phtml')).toEqual(['PHP', 'php']);
    expect(readBy('src/App/Program.cs')).toEqual(['C#', 'csharp']);
    // Ruby has none.
    expect(readBy('lib/a.rb')).toBeUndefined();
  });

  it('download Node, then their server, and start it on that Node, with no toolchain', async () => {
    for (const [id, server] of [
      ['typescript', VTSLS],
      ['python', PYRIGHT],
    ] as const) {
      const adapter = shipped(id);
      const { installs, toolchains, ready } = await prepared(adapter);
      expect(installs).toEqual(['node', server.id]);
      expect(toolchains).toEqual([]);
      // Named up front, so the status bar adds them up from the first byte.
      expect(adapter.downloads).toEqual({ servers: ['node', server.id], toolchains: [] });
      expect(ready).toEqual({
        kind: 'ready',
        launch: launchOnNode(server, installedAs('node'), installedAs(server.id)),
      });
    }
  });

  it('download php-lsp alone, with no toolchain, and start it as its own program', async () => {
    const adapter = shipped('php');
    const { installs, toolchains, ready } = await prepared(adapter);
    expect(installs).toEqual(['php-lsp']);
    expect(toolchains).toEqual([]);
    expect(adapter.downloads).toEqual({ servers: ['php-lsp'], toolchains: [] });
    expect(ready).toEqual({ kind: 'ready', launch: launchNative(PHP_LSP, installedAs('php-lsp')) });
    expect(ready.kind === 'ready' && ready.launch.program).toBe(installedAs('php-lsp').entry);
  });

  it('download .NET’s SDK and Roslyn, and start Roslyn as `dotnet exec` on that SDK', async () => {
    const adapter = shipped('csharp');
    const installs: string[] = [];
    const toolchains: string[] = [];
    const dotnet: Toolchain = {
      installed: installedAs('dotnet'),
      ...toolchainUse('dotnet', '10.0.404', installedAs('dotnet'), 'darwin'),
    };
    const ready = await adapter.prepare({
      install: (id) => {
        installs.push(id);
        return Promise.resolve(installedAs(id));
      },
      toolchain: (id) => {
        toolchains.push(id);
        return Promise.resolve(dotnet);
      },
      findCopy: () => Promise.reject(new Error('no copy is looked for')),
      signal: new AbortController().signal,
    });
    expect(toolchains).toEqual(['dotnet']);
    expect(installs).toEqual([ROSLYN.id]);
    // Named up front, so the status bar adds them up from the first byte, and Settings lists C#
    // as using the SDK.
    expect(adapter.downloads).toEqual({ servers: [ROSLYN.id], toolchains: ['dotnet'] });
    expect(ready).toEqual({
      kind: 'ready',
      launch: launchRoslyn(installedAs(ROSLYN.id), dotnet),
    });
    // A first definition waits on the first load of its project, so `gd` gives it longer.
    expect(adapter.definitionDeadline).toBe(5000);
  });

  it('say which servers give no inline type hints, as Pyright gives none', () => {
    expect(ADAPTERS.map((adapter) => [adapter.id, adapter.noHints])).toEqual([
      ['typescript', undefined],
      ['python', 'Pyright has no type hints.'],
      ['php', undefined],
      ['csharp', undefined],
    ]);
  });

  it('start nothing when a download fails', async () => {
    const failed = new Error('npm’s registry answered 503');
    await expect(
      shipped('typescript').prepare({
        install: (id) =>
          id === 'node' ? Promise.resolve(installedAs(id)) : Promise.reject(failed),
        toolchain: () => Promise.reject(new Error('no toolchain is asked for')),
        findCopy: () => Promise.resolve(undefined),
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(failed);
    const missing = new Error('GitHub answered 404');
    await expect(
      shipped('php').prepare({
        install: () => Promise.reject(missing),
        toolchain: () => Promise.reject(new Error('no toolchain is asked for')),
        findCopy: () => Promise.resolve(undefined),
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(missing);
    // C#'s starts nothing when its toolchain can't download, and downloads no server for it.
    const sdk = new Error('The .NET SDK couldn’t download.');
    const installs: string[] = [];
    await expect(
      shipped('csharp').prepare({
        install: (id) => {
          installs.push(id);
          return Promise.resolve(installedAs(id));
        },
        toolchain: () => Promise.reject(sdk),
        findCopy: () => Promise.resolve(undefined),
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(sdk);
    expect(installs).toEqual([]);
  });
});
