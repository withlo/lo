// The adapters Lo ships: which files each reads, and what it downloads before it starts: Node for
// the servers that run on it, Go for gopls, which Lo builds with it, and the JDK Java's runs on.
// What each server runs as, and is told, is `@lo/lsp`'s, and tested there.

import {
  GOPLS,
  type Installed,
  jdtlsCheckoutProblem,
  launchJdtls,
  launchNative,
  launchOnNode,
  PHP_LSP,
  PYRIGHT,
  TERRAFORM_LS,
  toolchainUse,
  VTSLS,
} from '@lo/lsp';
import { describe, expect, it } from 'vitest';

import {
  type Adapter,
  ADAPTERS,
  adapterFor,
  type PrepareContext,
  type Toolchain,
} from './adapters.ts';

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
 * every install there, and of the toolchains, those `given`.
 */
async function prepared(adapter: Adapter, given: Readonly<Record<string, Toolchain>> = {}) {
  const installs: string[] = [];
  const toolchains: string[] = [];
  const ready = await adapter.prepare({
    install: (id) => {
      installs.push(id);
      return Promise.resolve(installedAs(id));
    },
    toolchain: (id) => {
      toolchains.push(id);
      const toolchain = given[id];
      return toolchain ? Promise.resolve(toolchain) : Promise.reject(new Error(`no ${id}`));
    },
    findCopy: () => Promise.reject(new Error('no copy is looked for')),
    signal: new AbortController().signal,
  });
  return { installs, toolchains, ready };
}

/** Lo's Temurin JDK, installed, and what a server gets of it. */
const JDK_INSTALLED: Installed = {
  folder: '/lo/cache/toolchains/temurin/25/files',
  entry: '/lo/cache/toolchains/temurin/25/files/jdk-25/bin/java',
};
const JDK: Toolchain = {
  version: '25',
  installed: JDK_INSTALLED,
  ...toolchainUse('temurin', '25', JDK_INSTALLED, 'linux'),
};

describe('Lo’s adapters', () => {
  it('read TypeScript and JavaScript, Python, PHP, Go, Terraform and Java', () => {
    expect(readBy('src/a.ts')).toEqual(['TypeScript', 'typescript']);
    expect(readBy('src/a.mts')).toEqual(['TypeScript', 'typescript']);
    expect(readBy('src/A.tsx')).toEqual(['TypeScript', 'typescriptreact']);
    expect(readBy('src/a.js')).toEqual(['TypeScript', 'javascript']);
    expect(readBy('src/a.jsx')).toEqual(['TypeScript', 'javascript']);
    expect(readBy('pkg/a.py')).toEqual(['Python', 'python']);
    expect(readBy('pkg/a.pyi')).toEqual(['Python', 'python']);
    expect(readBy('src/A.php')).toEqual(['PHP', 'php']);
    expect(readBy('views/a.phtml')).toEqual(['PHP', 'php']);
    expect(readBy('cmd/main.go')).toEqual(['Go', 'go']);
    expect(readBy('infra/main.tf')).toEqual(['Terraform', 'terraform']);
    // terraform-ls reads a file of variables as one, by its own id.
    expect(readBy('infra/prod.tfvars')).toEqual(['Terraform', 'terraform-vars']);
    expect(readBy('infra/PROD.TFVARS')).toEqual(['Terraform', 'terraform-vars']);
    expect(readBy('src/main/java/a/B.java')).toEqual(['Java', 'java']);
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

  it('install Go, then build gopls with it, and start gopls with that Go', async () => {
    const asked: string[] = [];
    let builtWith: Toolchain | undefined;
    const go: Toolchain = {
      ...toolchainUse('go', '1.27.4', installedAs('go')),
      version: '1.27.4',
      installed: installedAs('go'),
    };
    const context: PrepareContext = {
      install: (id, options) => {
        asked.push(id);
        builtWith = options?.go;
        return Promise.resolve(installedAs(id));
      },
      toolchain: (id) => {
        asked.push(`toolchain ${id}`);
        return id === 'go' ? Promise.resolve(go) : Promise.reject(new Error(`no ${id}`));
      },
      findCopy: () => Promise.reject(new Error('no copy is looked for')),
      signal: new AbortController().signal,
    };
    const adapter = shipped('go');
    expect(adapter.downloads).toEqual({ servers: ['gopls'], toolchains: ['go'] });
    expect(await adapter.prepare(context)).toEqual({
      kind: 'ready',
      launch: launchNative(GOPLS, installedAs('gopls'), [go]),
    });
    expect(asked).toEqual(['toolchain go', 'gopls']);
    expect(builtWith).toBe(go);
  });

  it('download terraform-ls alone, with no toolchain, and start it as its own program', async () => {
    const adapter = shipped('terraform');
    const { installs, toolchains, ready } = await prepared(adapter);
    expect(installs).toEqual(['terraform-ls']);
    expect(toolchains).toEqual([]);
    expect(adapter.downloads).toEqual({ servers: ['terraform-ls'], toolchains: [] });
    expect(ready).toEqual({
      kind: 'ready',
      launch: launchNative(TERRAFORM_LS, installedAs('terraform-ls')),
    });
  });

  it('ask terraform-ls for references from a definition, as it finds them only there', () => {
    expect(ADAPTERS.filter((each) => each.referencesFromDefinition).map((each) => each.id)).toEqual(
      ['terraform'],
    );
  });

  it('download Lo’s JDK, then JDT LS, and start it on that JDK, on a checkout it may read', async () => {
    const adapter = shipped('java');
    const { installs, toolchains, ready } = await prepared(adapter, { temurin: JDK });
    expect(toolchains).toEqual(['temurin']);
    expect(installs).toEqual(['jdtls']);
    expect(adapter.downloads).toEqual({ servers: ['jdtls'], toolchains: ['temurin'] });
    const launch = launchJdtls(installedAs('jdtls'), JDK_INSTALLED, JDK);
    expect(ready.kind === 'ready' && ready.launch).toMatchObject({
      ...launch,
      place: expect.any(Function),
    });
    expect(ready.kind === 'ready' && ready.launch.program).toBe(JDK_INSTALLED.entry);
    // A JVM answers its first definitions slower than most.
    expect(adapter.definitionDeadline).toBe(5000);
    // What it alone reads in a checkout, beside what its toolchain does.
    expect(adapter.checkout).toBe(jdtlsCheckoutProblem);
    expect(ADAPTERS.filter((each) => each.checkout !== undefined)).toEqual([adapter]);
  });

  it('say which servers give no inline type hints, as Pyright and terraform-ls give none', () => {
    expect(ADAPTERS.map((adapter) => [adapter.id, adapter.noHints])).toEqual([
      ['typescript', undefined],
      ['python', 'Pyright has no type hints.'],
      ['php', undefined],
      ['go', undefined],
      ['terraform', 'terraform-ls has no type hints.'],
      ['java', undefined],
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
    // Nor when the JDK's does, and the server's own download never starts.
    const installs: string[] = [];
    const unavailable = new Error('GitHub answered 503');
    await expect(
      shipped('java').prepare({
        install: (id) => {
          installs.push(id);
          return Promise.resolve(installedAs(id));
        },
        toolchain: () => Promise.reject(unavailable),
        findCopy: () => Promise.resolve(undefined),
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(unavailable);
    expect(installs).toEqual([]);
  });
});
