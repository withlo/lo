// The adapters Lo ships: which files each reads, and what it downloads before it starts. What each
// server runs as, and is told, is `@lo/lsp`'s, and tested there.

import {
  acceptanceOf,
  INTELEPHENSE,
  type Installed,
  labelOf,
  launchOnNode,
  PYRIGHT,
  VTSLS,
} from '@lo/lsp';
import { describe, expect, it } from 'vitest';

import { ADAPTERS, adapterFor } from './adapters.ts';

function installedAs(id: string): Installed {
  return { folder: `/lo/cache/servers/${id}`, entry: `/lo/cache/servers/${id}/entry` };
}

/** The adapter that reads the file at `path`, by name, and the protocol's id for the file. */
function readBy(path: string) {
  const found = adapterFor(ADAPTERS, path);
  return found && [found.adapter.name, found.languageId];
}

describe('Lo’s adapters', () => {
  it('read TypeScript and JavaScript, Python and PHP', () => {
    expect(readBy('src/a.ts')).toEqual(['TypeScript', 'typescript']);
    expect(readBy('src/a.mts')).toEqual(['TypeScript', 'typescript']);
    expect(readBy('src/A.tsx')).toEqual(['TypeScript', 'typescriptreact']);
    expect(readBy('src/a.js')).toEqual(['TypeScript', 'javascript']);
    expect(readBy('src/a.jsx')).toEqual(['TypeScript', 'javascript']);
    expect(readBy('pkg/a.py')).toEqual(['Python', 'python']);
    expect(readBy('pkg/a.pyi')).toEqual(['Python', 'python']);
    expect(readBy('src/A.php')).toEqual(['PHP', 'php']);
    // Ruby has none.
    expect(readBy('lib/a.rb')).toBeUndefined();
  });

  it('download Node, then their server, and start it on that Node', async () => {
    const servers = new Map([
      ['typescript', VTSLS],
      ['python', PYRIGHT],
      ['php', INTELEPHENSE],
    ]);
    for (const adapter of ADAPTERS) {
      const installs: string[] = [];
      const prepared = await adapter.prepare({
        install: (id) => {
          installs.push(id);
          return Promise.resolve(installedAs(id));
        },
        findCopy: () => Promise.reject(new Error('no copy is looked for')),
        signal: new AbortController().signal,
      });
      const server = servers.get(adapter.id);
      if (!server) throw new Error(`${adapter.id} has no server here`);
      expect(installs).toEqual(['node', server.id]);
      expect(prepared).toEqual({
        kind: 'ready',
        launch: launchOnNode(server, installedAs('node'), installedAs(server.id)),
      });
    }
  });

  it('ask for Intelephense’s license first, show its messages, and say which have no hints', () => {
    expect(
      ADAPTERS.map(({ id, about, license, shows, hints }) => ({
        id,
        about,
        license,
        shows,
        hints,
      })),
    ).toEqual([
      { id: 'typescript', about: labelOf(VTSLS), license: undefined, shows: false, hints: true },
      { id: 'python', about: labelOf(PYRIGHT), license: undefined, shows: false, hints: false },
      {
        id: 'php',
        about: labelOf(INTELEPHENSE),
        license: acceptanceOf(INTELEPHENSE),
        shows: true,
        hints: false,
      },
    ]);
    expect(acceptanceOf(INTELEPHENSE)).toMatchObject({ serverName: 'Intelephense', major: 1 });
  });

  it('start nothing when a download fails', async () => {
    const [typescript] = ADAPTERS;
    const failed = new Error('npm’s registry answered 503');
    await expect(
      typescript?.prepare({
        install: (id) =>
          id === 'node' ? Promise.resolve(installedAs(id)) : Promise.reject(failed),
        findCopy: () => Promise.resolve(undefined),
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(failed);
  });
});
