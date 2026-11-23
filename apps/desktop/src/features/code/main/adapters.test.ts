// The adapters Lo ships: which files each reads, and what it downloads before it starts: Node for
// the servers that run on it, Go for gopls, which Lo builds with it, Lo's Rust for rust-analyzer,
// which runs on it, the JDK Java's runs on, and the .NET SDK Roslyn runs on; on macOS, the
// SourceKit-LSP it finds in Xcode or Apple's Command Line Tools; and on Linux, Swift's toolchain
// for the distribution, unless packages it needs are missing. What each server runs as, and is
// told, is `@lo/lsp`'s, and tested there.

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  developerFolder,
  GOPLS,
  type Installed,
  jdtlsCheckoutProblem,
  launchJdtls,
  launchNative,
  launchOnNode,
  launchRoslyn,
  launchRustAnalyzer,
  launchSourceKitOnLinux,
  missingPackages,
  PHP_LSP,
  PYRIGHT,
  ROSLYN,
  RUST_ANALYZER,
  sourceKitCandidates,
  sourceKitCheckoutProblem,
  SWIFT_DISTROS,
  type SwiftDistro,
  TERRAFORM_LS,
  toolchainUse,
  VTSLS,
} from '@lo/lsp';
import { describe, expect, it, onTestFinished } from 'vitest';

import {
  type Adapter,
  adapterFor,
  type PrepareContext,
  prepareContext,
  shippedAdapters,
  type Toolchain,
} from './adapters.ts';

/** The adapters Lo ships on macOS, Swift's among them. */
const ADAPTERS = shippedAdapters('darwin');

function installedAs(id: string): Installed {
  return { folder: `/lo/cache/servers/${id}`, entry: `/lo/cache/servers/${id}/entry` };
}

/** Lo's Rust toolchain, installed, as the desktop side hands it to an adapter. */
function installedToolchain(): Toolchain {
  const installed: Installed = {
    folder: '/lo/cache/toolchains/rust',
    entry: '/lo/cache/toolchains/rust/bin/cargo',
  };
  return { ...toolchainUse('rust', '1.100.0', installed), version: '1.100.0', installed };
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
    developerFolder: () => Promise.reject(new Error('no developer folder is looked for')),
    missingPackages: () => Promise.resolve([]),
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
  it('read TypeScript and JavaScript, Python, Rust, PHP, Go, Terraform, Java, C# and, on macOS, Swift', () => {
    expect(readBy('src/a.ts')).toEqual(['TypeScript', 'typescript']);
    expect(readBy('src/a.mts')).toEqual(['TypeScript', 'typescript']);
    expect(readBy('src/A.tsx')).toEqual(['TypeScript', 'typescriptreact']);
    expect(readBy('src/a.js')).toEqual(['TypeScript', 'javascript']);
    expect(readBy('src/a.jsx')).toEqual(['TypeScript', 'javascript']);
    expect(readBy('pkg/a.py')).toEqual(['Python', 'python']);
    expect(readBy('pkg/a.pyi')).toEqual(['Python', 'python']);
    expect(readBy('src/a.rs')).toEqual(['Rust', 'rust']);
    expect(readBy('src/A.php')).toEqual(['PHP', 'php']);
    expect(readBy('views/a.phtml')).toEqual(['PHP', 'php']);
    expect(readBy('cmd/main.go')).toEqual(['Go', 'go']);
    expect(readBy('infra/main.tf')).toEqual(['Terraform', 'terraform']);
    // terraform-ls reads a file of variables as one, by its own id.
    expect(readBy('infra/prod.tfvars')).toEqual(['Terraform', 'terraform-vars']);
    expect(readBy('infra/PROD.TFVARS')).toEqual(['Terraform', 'terraform-vars']);
    expect(readBy('src/main/java/a/B.java')).toEqual(['Java', 'java']);
    expect(readBy('src/App/Program.cs')).toEqual(['C#', 'csharp']);
    expect(readBy('Sources/App/main.swift')).toEqual(['Swift', 'swift']);
    expect(adapterFor(shippedAdapters('linux'), 'Sources/App/main.swift')).toBeUndefined();
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

  it('download rust-analyzer and Lo’s Rust toolchain, and start it on that toolchain', async () => {
    const adapter = shipped('rust');
    const installs: string[] = [];
    const toolchains: string[] = [];
    const toolchain = installedToolchain();
    const ready = await adapter.prepare({
      install: (id) => {
        installs.push(id);
        return Promise.resolve(installedAs(id));
      },
      toolchain: (id) => {
        toolchains.push(id);
        return Promise.resolve(toolchain);
      },
      findCopy: () => Promise.reject(new Error('no copy is looked for')),
      developerFolder: () => Promise.reject(new Error('no developer folder is looked for')),
      missingPackages: () => Promise.resolve([]),
      signal: new AbortController().signal,
    });
    expect(installs).toEqual([RUST_ANALYZER.id]);
    expect(toolchains).toEqual(['rust']);
    // Named up front: the server and the toolchain it runs on.
    expect(adapter.downloads).toEqual({ servers: [RUST_ANALYZER.id], toolchains: ['rust'] });
    expect(ready).toEqual({
      kind: 'ready',
      launch: launchRustAnalyzer(installedAs(RUST_ANALYZER.id), toolchain),
    });
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
      developerFolder: () => Promise.reject(new Error('no developer folder is looked for')),
      missingPackages: () => Promise.resolve([]),
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
    expect(ADAPTERS.filter((each) => each.checkout !== undefined)).toEqual([
      adapter,
      shipped('swift'),
    ]);
  });

  it('download .NET’s SDK and Roslyn, and start Roslyn as `dotnet exec` on that SDK', async () => {
    const adapter = shipped('csharp');
    const installs: string[] = [];
    const toolchains: string[] = [];
    const dotnet: Toolchain = {
      version: '10.0.404',
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
      developerFolder: () => Promise.reject(new Error('no developer folder is looked for')),
      missingPackages: () => Promise.resolve([]),
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

  it('say which servers give no inline type hints, as Pyright and terraform-ls give none', () => {
    expect(ADAPTERS.map((adapter) => [adapter.id, adapter.noHints])).toEqual([
      ['typescript', undefined],
      ['python', 'Pyright has no type hints'],
      ['rust', undefined],
      ['php', undefined],
      ['go', undefined],
      ['terraform', 'terraform-ls has no type hints'],
      ['java', undefined],
      ['csharp', undefined],
      ['swift', undefined],
    ]);
  });

  it('answer Swift’s references from the syntax index, as SourceKit-LSP finds them from a build', () => {
    expect(ADAPTERS.map((adapter) => [adapter.id, adapter.noReferences])).toEqual([
      ['typescript', undefined],
      ['python', undefined],
      ['rust', undefined],
      ['php', undefined],
      ['go', undefined],
      ['terraform', undefined],
      ['java', undefined],
      ['csharp', undefined],
      ['swift', 'SourceKit-LSP needs a build to find references'],
    ]);
  });

  it('start the SourceKit-LSP in the developer folder, downloading nothing, or say what Swift needs', async () => {
    const developer = realpathSync(mkdtempSync(join(tmpdir(), 'lo-developer-')));
    onTestFinished(() => rmSync(developer, { recursive: true, force: true }));
    const [xcode, tools] = sourceKitCandidates(developer);
    // Only Xcode's SDK is there.
    mkdirSync(xcode?.sdk ?? '', { recursive: true });
    const asked: (readonly string[])[] = [];
    /** A context whose `findCopy` takes `found` as a copy that may run; nothing installs. */
    const context = (found: string | undefined, folder: string | undefined = developer) => ({
      install: () => Promise.reject(new Error('nothing is installed')),
      toolchain: () => Promise.reject(new Error('no toolchain is asked for')),
      findCopy: (candidates: readonly string[]) => {
        asked.push(candidates);
        return Promise.resolve(candidates.find((candidate) => candidate === found));
      },
      developerFolder: () => Promise.resolve(folder),
      missingPackages: () => Promise.resolve([]),
      signal: new AbortController().signal,
    });
    const adapter = shipped('swift');
    expect(adapter.downloads).toBeUndefined();
    expect(adapter.checkout).toBe(sourceKitCheckoutProblem);
    expect(adapter.system).toMatchObject({
      id: 'swift',
      name: 'Swift',
      needs: 'Apple’s Command Line Tools',
    });

    // Xcode's, with its SDK, starts as `@lo/lsp` starts it.
    expect(await adapter.prepare(context(xcode?.program))).toMatchObject({
      kind: 'ready',
      launch: {
        program: xcode?.program,
        rootless: true,
        version: 'SourceKit-LSP from Xcode · Apache-2.0',
      },
    });
    expect(await adapter.system?.from(context(xcode?.program))).toBe('Xcode');

    // The Command Line Tools' without its SDK, or no developer folder, and Swift needs the tools.
    const missing = {
      kind: 'missing',
      needs: 'Apple’s Command Line Tools',
      install: 'xcode-select --install',
      plural: true,
    };
    asked.length = 0;
    expect(await adapter.prepare(context(tools?.program))).toEqual(missing);
    expect(asked).toEqual([[xcode?.program], [tools?.program]]);
    expect(await adapter.prepare(context(undefined, undefined))).toEqual(missing);
    expect(await adapter.system?.from(context(tools?.program))).toBeUndefined();
  });

  it('on Linux, download Swift for the distribution, or say which of its packages it needs', async () => {
    const fedora = SWIFT_DISTROS.find((distro) => distro.id === 'fedora41');
    if (!fedora) throw new Error('swift.org builds for Fedora 41');
    // Only on a Linux that takes one of swift.org's builds.
    expect(shippedAdapters('linux').map((each) => each.id)).not.toContain('swift');
    const adapter = shippedAdapters('linux', fedora).find((each) => each.id === 'swift');
    if (!adapter) throw new Error('no Swift on Fedora');
    expect(adapter.downloads).toEqual({ servers: [], toolchains: ['swift-fedora41'] });
    expect(adapter.checkout).toBe(sourceKitCheckoutProblem);
    expect(adapter.system).toBeUndefined();
    expect(adapter.noReferences).toBe('SourceKit-LSP needs a build to find references');

    const files = '/lo/cache/toolchains/swift-fedora41/6.4.2/files';
    const installed: Installed = {
      folder: files,
      entry: `${files}/swift-6.4.2-RELEASE-fedora41/usr/bin/sourcekit-lsp`,
    };
    const swift: Toolchain = {
      version: '6.4.2',
      installed,
      ...toolchainUse('swift-fedora41', '6.4.2', installed),
    };
    const asked: string[] = [];
    const context = (missing: readonly string[]) => ({
      install: () => Promise.reject(new Error('no server downloads')),
      toolchain: (id: string) => {
        asked.push(id);
        return Promise.resolve(swift);
      },
      findCopy: () => Promise.reject(new Error('no copy is looked for')),
      developerFolder: () => Promise.reject(new Error('no developer folder is looked for')),
      missingPackages: (distro: SwiftDistro) =>
        Promise.resolve(distro === fedora ? missing : ['not this distribution']),
      signal: new AbortController().signal,
    });

    // With packages missing, it downloads nothing, and says which and how to install them.
    expect(await adapter.prepare(context(['libxml2-devel', 'python3-devel']))).toEqual({
      kind: 'missing',
      needs: 'the packages libxml2-devel and python3-devel',
      install: 'sudo dnf install libxml2-devel python3-devel',
      plural: true,
    });
    expect(asked).toEqual([]);

    // With them all, it starts the SourceKit-LSP in the toolchain, told of no workspace, as
    // `@lo/lsp` starts it.
    const ready = await adapter.prepare(context([]));
    expect(asked).toEqual(['swift-fedora41']);
    if (ready.kind !== 'ready') throw new Error('not ready');
    const { place, ...launch } = ready.launch;
    const { place: lsp, ...expected } = launchSourceKitOnLinux(swift, '6.4.2');
    expect(launch).toEqual(expected);
    expect(launch).toMatchObject({
      program: installed.entry,
      path: [`${files}/swift-6.4.2-RELEASE-fedora41/usr/bin`],
      rootless: true,
      version: 'SourceKit-LSP from Swift 6.4.2 · Apache-2.0',
    });
    expect(launch.services).toBeUndefined();
    const where = { root: '/checkout', home: '/home' };
    expect(await place?.(where)).toEqual(await lsp?.(where));
    // Foundation's home folder is its home, not the user's from the system's list of users.
    expect(await place?.(where)).toMatchObject({ variables: { CFFIXED_USER_HOME: '/home' } });
  });

  it('find the developer folder and the packages Swift needs on the system itself, as Lo runs', () => {
    const parts: Omit<PrepareContext, 'developerFolder' | 'missingPackages'> = {
      install: () => Promise.reject(new Error('nothing is installed')),
      toolchain: () => Promise.reject(new Error('no toolchain is installed')),
      findCopy: () => Promise.resolve(undefined),
      signal: new AbortController().signal,
    };
    // `xcode-select -p`, and dpkg's list or rpm, not a stand-in that says none is missing.
    expect(prepareContext(parts)).toEqual({ ...parts, developerFolder, missingPackages });
  });

  it('start nothing when a download fails', async () => {
    const failed = new Error('npm’s registry answered 503');
    await expect(
      shipped('typescript').prepare({
        install: (id) =>
          id === 'node' ? Promise.resolve(installedAs(id)) : Promise.reject(failed),
        toolchain: () => Promise.reject(new Error('no toolchain is asked for')),
        findCopy: () => Promise.resolve(undefined),
        developerFolder: () => Promise.resolve(undefined),
        missingPackages: () => Promise.resolve([]),
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(failed);
    const missing = new Error('GitHub answered 404');
    await expect(
      shipped('php').prepare({
        install: () => Promise.reject(missing),
        toolchain: () => Promise.reject(new Error('no toolchain is asked for')),
        findCopy: () => Promise.resolve(undefined),
        developerFolder: () => Promise.resolve(undefined),
        missingPackages: () => Promise.resolve([]),
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
        developerFolder: () => Promise.resolve(undefined),
        missingPackages: () => Promise.resolve([]),
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(unavailable);
    // C#'s starts nothing when its toolchain can't download, and downloads no server for it.
    const sdk = new Error('The .NET SDK couldn’t download.');
    await expect(
      shipped('csharp').prepare({
        install: (id) => {
          installs.push(id);
          return Promise.resolve(installedAs(id));
        },
        toolchain: () => Promise.reject(sdk),
        findCopy: () => Promise.resolve(undefined),
        developerFolder: () => Promise.reject(new Error('no developer folder is looked for')),
        missingPackages: () => Promise.resolve([]),
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(sdk);
    expect(installs).toEqual([]);
  });
});
