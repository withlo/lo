// The servers Lo runs, on its Node or as programs of their own, as their adapters start them: what
// runs, with which flags, what each is told, and what the manifest pins for it. No server runs
// here; `test/hostile.test.ts` starts each as Lo would, with the fake server standing in for it.

import {
  accessSync,
  constants,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, test } from 'vitest';

import { tempFolder } from '../../test/support.ts';
import type { Installed } from '../install.ts';
import { MANIFEST, PLATFORMS } from '../manifest.ts';
import { sectionOf } from '../requests.ts';
import { LIMITS } from '../server.ts';
import { type InstalledToolchain, toolchainUse } from '../toolchains.ts';
import { launchNative } from './native.ts';
import { heapCap, launchOnNode, type NodeServer } from './node.ts';
import { PHP_LSP, PHP_VERSION } from './phplsp.ts';
import { NO_PYTHON, PYRIGHT } from './pyright.ts';
import {
  CSHARP_FILES,
  CSHARP_FOLDERS,
  CSHARP_PROJECT,
  csharpProject,
  csharpSources,
  csharpWorkspace,
  DOTNET_HEAP,
  inCheckout,
  launchRoslyn,
  msbuild,
  ROSLYN,
  writable,
} from './roslyn.ts';
import { launchRustAnalyzer, RUST_ANALYZER } from './rust.ts';
import { VTSLS } from './vtsls.ts';

const SERVERS = [VTSLS, PYRIGHT];

/** The version the manifest pins of `id`. */
function pinnedVersion(id: string): string {
  return MANIFEST[id]?.version ?? '';
}

/** php-lsp's version, as the manifest pins it. */
const PHP_LSP_VERSION = pinnedVersion('php-lsp');

/** php-lsp, installed as the manifest pins it. */
const PHP_LSP_INSTALLED: Installed = {
  folder: `/lo/cache/servers/php-lsp/${PHP_LSP_VERSION}/files`,
  entry: `/lo/cache/servers/php-lsp/${PHP_LSP_VERSION}/files/php-lsp`,
};

/** Roslyn's version, as the manifest pins it. */
const ROSLYN_VERSION = pinnedVersion('roslyn');

/** Roslyn, installed as the manifest pins it, for macOS on Arm. */
const ROSLYN_INSTALLED: Installed = {
  folder: `/lo/cache/servers/roslyn/${ROSLYN_VERSION}/files`,
  entry: `/lo/cache/servers/roslyn/${ROSLYN_VERSION}/files/tools/net10.0/osx-arm64/Microsoft.CodeAnalysis.LanguageServer.dll`,
};

/** Lo's .NET SDK, installed as `toolchains.json` pins it, and what a server gets of it. */
const DOTNET_INSTALLED: Installed = {
  folder: '/lo/cache/toolchains/dotnet/10.0.404/files',
  entry: '/lo/cache/toolchains/dotnet/10.0.404/files/dotnet',
};
const DOTNET: InstalledToolchain = {
  installed: DOTNET_INSTALLED,
  ...toolchainUse('dotnet', '10.0.404', DOTNET_INSTALLED, 'darwin'),
};

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
function setting(server: { readonly settings?: unknown }, section: string): unknown {
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
  expect([
    ...SERVERS.map((server) => launchOnNode(server, NODE, installed(server)).version),
    launchNative(PHP_LSP, PHP_LSP_INSTALLED).version,
    launchRoslyn(ROSLYN_INSTALLED, DOTNET).version,
  ]).toEqual([
    `vtsls ${pinnedVersion('vtsls')} · MIT`,
    `Pyright ${pinnedVersion('pyright')} · MIT`,
    `php-lsp ${pinnedVersion('php-lsp')} · MIT`,
    `Roslyn ${ROSLYN_VERSION} · MIT`,
  ]);
  // The README lists each with its version, source and license.
  const readme = readFileSync(join(import.meta.dirname, '..', '..', 'README.md'), 'utf8');
  for (const server of [...SERVERS, PHP_LSP, ROSLYN]) {
    const row = new RegExp(
      `^\\| ${server.name}\\b[^|\\n]*\\| ${pinnedVersion(server.id)} +\\|[^\\n]*\\| ${server.license}\\b`,
      'm',
    );
    expect(readme).toMatch(row);
  }
});

test('each says whether it gives the inlay hints `gh` shows: Pyright has none', () => {
  expect([...SERVERS, PHP_LSP, ROSLYN].map((server) => [server.id, server.hints])).toEqual([
    ['vtsls', true],
    ['pyright', false],
    ['php-lsp', true],
    ['roslyn', true],
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

describe('rust-analyzer', () => {
  /** The sysroot Lo's Rust toolchain installs to, with `bin/cargo` inside. */
  const SYSROOT = '/lo/cache/toolchains/rust/1.100.0/files';

  /** rust-analyzer, as the manifest pins it, installed. */
  const RA: Installed = {
    folder: '/lo/cache/servers/rust-analyzer/2026-11-09/files',
    entry: '/lo/cache/servers/rust-analyzer/2026-11-09/files/rust-analyzer',
  };

  /** Lo's Rust toolchain, installed at `SYSROOT`, as a server gets it. */
  function toolchain() {
    const at: Installed = { folder: SYSROOT, entry: `${SYSROOT}/bin/cargo` };
    return { ...toolchainUse('rust', '1.100.0', at), installed: at };
  }

  /** How rust-analyzer starts, on Lo's Rust toolchain. */
  function launch() {
    return launchRustAnalyzer(RA, toolchain());
  }

  /** What rust-analyzer hears for the setting `section`, which it reads nested under its name. */
  function told(section: string): unknown {
    return sectionOf(launch().initializationOptions, section);
  }

  test('starts as the downloaded program itself, with no arguments', () => {
    const started = launch();
    expect(started.program).toBe(RA.entry);
    expect(started.args).toEqual([]);
    expect(RUST_ANALYZER.args).toEqual([]);
  });

  test('runs on Lo’s Rust toolchain, held to Lo’s cargo, rustc and sysroot', () => {
    const started = launch();
    // The toolchain's folder first on the PATH, and its variables, as `toolchainUse` gives them.
    expect(started.path).toEqual([`${SYSROOT}/bin`]);
    expect(started.variables).toEqual({
      RUSTC: `${SYSROOT}/bin/rustc`,
      CARGO: `${SYSROOT}/bin/cargo`,
      RUSTC_WRAPPER: '',
      RUSTC_WORKSPACE_WRAPPER: '',
      // Beats `RUSTFLAGS` and every config's `rustflags`, so none reaches Lo's rustc.
      CARGO_ENCODED_RUSTFLAGS: '',
      CARGO_ENCODED_RUSTDOCFLAGS: '',
      CARGO_NET_OFFLINE: 'true',
    });
    // The wrappers and compiler it sets on purpose, which undo a checkout's `build.rustc*`.
    expect(started.allowed).toEqual(['RUSTC', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER']);
    // The sysroot is the toolchain's root, with its bundled standard-library sources.
    expect(told('cargo.sysroot')).toBe(SYSROOT);
    expect(told('cargo.sysrootSrc')).toBe(`${SYSROOT}/lib/rustlib/src/rust/library`);
  });

  test('runs no build script and expands no proc-macro, a checkout’s code', () => {
    expect(told('cargo.buildScripts.enable')).toBe(false);
    expect(told('cargo.buildScripts.overrideCommand')).toBeNull();
    expect(told('cargo.buildScripts.useRustcWrapper')).toBe(false);
    expect(told('procMacro.enable')).toBe(false);
    expect(told('procMacro.attributes.enable')).toBe(false);
  });

  test('never runs a check, and brings no environment of the checkout’s to cargo', () => {
    expect(told('checkOnSave')).toBe(false);
    expect(told('check.overrideCommand')).toBeNull();
    expect(told('cargo.extraEnv')).toEqual({});
    expect(told('diagnostics.enable')).toBe(false);
    expect(told('cachePriming.enable')).toBe(false);
  });

  test('hears its settings in `initialize` and for the section it asks for alike', () => {
    const started = launch();
    expect(started.settings).toEqual({ 'rust-analyzer': started.initializationOptions });
    // rust-analyzer asks for the `rust-analyzer` section.
    expect(sectionOf(started.settings, 'rust-analyzer')).toEqual(started.initializationOptions);
  });

  test('gives the inlay hints gh shows', () => {
    expect(RUST_ANALYZER.hints).toBe(true);
  });

  test('says what it is, with its version and dual license, and the README lists it', () => {
    const version = MANIFEST[RUST_ANALYZER.id]?.version ?? '';
    expect(launch().version).toBe(`rust-analyzer ${version} · MIT OR Apache-2.0`);
    const readme = readFileSync(join(import.meta.dirname, '..', '..', 'README.md'), 'utf8');
    expect(readme).toMatch(
      new RegExp(
        `^\\| rust-analyzer\\b[^|\\n]*\\| ${version} +\\|[^\\n]*\\| MIT OR Apache-2.0\\b`,
        'm',
      ),
    );
  });

  test('is pinned as a gzipped program for every platform', () => {
    const entry = MANIFEST[RUST_ANALYZER.id];
    expect(entry).toBeDefined();
    for (const download of Object.values(entry?.platforms ?? {})) {
      expect(download.kind).toBe('gz');
      expect(download.entry).toBe('rust-analyzer');
    }
  });

  test('refuses a manifest with no entry for it', () => {
    expect(() => launchRustAnalyzer(RA, toolchain(), {})).toThrow('has no rust-analyzer');
  });
});

describe('php-lsp', () => {
  test('starts as its own program, from its release for each platform, with no launcher', () => {
    const pinnedPhp = MANIFEST['php-lsp'];
    expect(pinnedPhp?.hosts).toEqual(['github.com', 'release-assets.githubusercontent.com']);
    expect(Object.keys(pinnedPhp?.platforms ?? {}).toSorted()).toEqual([...PLATFORMS].toSorted());
    const release = `https://github.com/jorgsowa/php-lsp/releases/download/v${PHP_LSP_VERSION}/`;
    for (const download of Object.values(pinnedPhp?.platforms ?? {})) {
      expect(download).toMatchObject({ kind: 'tar.gz', entry: 'php-lsp' });
      expect(download.kind === 'tar.gz' && download.url.startsWith(release)).toBe(true);
    }
    const launch = launchNative(PHP_LSP, PHP_LSP_INSTALLED);
    expect([launch.program, launch.args]).toEqual([PHP_LSP_INSTALLED.entry, []]);
    // Nothing of its own goes into its environment, which is Lo's alone.
    expect([launch.path, launch.variables, launch.allowed]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(() => launchNative(PHP_LSP, { folder: 'php-lsp', entry: 'php-lsp/php-lsp' })).toThrow(
      "php-lsp/php-lsp isn't an absolute path",
    );
    expect(() => launchNative({ ...PHP_LSP, id: 'phpactor' }, PHP_LSP_INSTALLED)).toThrow(
      'has no phpactor',
    );
  });

  test('is told which PHP to read code as, so it runs no `php`, and runs no tools', () => {
    const { initializationOptions } = launchNative(PHP_LSP, PHP_LSP_INSTALLED);
    expect(initializationOptions).toEqual({
      phpVersion: PHP_VERSION,
      // A checkout has no dependencies installed, so only a committed `vendor/` is there to skip.
      indexVendor: false,
      externalTools: { phpstan: { enabled: false }, phpcs: { enabled: false } },
    });
    // One of those php-lsp knows (7.4, and 8.0 to 8.6), so it reads code as that PHP.
    expect(PHP_VERSION).toMatch(/^(?:7\.4|8\.[0-6])$/);
    // It hears the same when it asks for its settings, as it does once they change.
    expect(setting(PHP_LSP, 'php-lsp')).toEqual(initializationOptions);
  });

  test('names no folder for its cache, so it keeps its own, with its caps, in its home', () => {
    const launch = launchNative(PHP_LSP, PHP_LSP_INSTALLED);
    expect(launch).not.toHaveProperty('cacheOption');
    expect(launch.initializationOptions).not.toHaveProperty('cachePath');
    expect(setting(PHP_LSP, 'php-lsp.cachePath')).toBeNull();
    // Nor does it name a folder for caches, which php-lsp would keep its own in.
    expect(launch.variables).toBeUndefined();
  });
});

describe('Roslyn', () => {
  /** .NET's name for each platform, in Roslyn's packages' names and folders. */
  const RIDS = {
    'darwin-arm64': 'osx-arm64',
    'darwin-x64': 'osx-x64',
    'linux-x64': 'linux-x64',
    'linux-arm64': 'linux-arm64',
  } as const;

  test('starts as `dotnet exec` on its own program, from its package for each platform', () => {
    const pinnedRoslyn = MANIFEST.roslyn;
    expect(pinnedRoslyn?.hosts).toEqual(['api.nuget.org']);
    expect(Object.keys(pinnedRoslyn?.platforms ?? {}).toSorted()).toEqual(
      [...PLATFORMS].toSorted(),
    );
    for (const platform of PLATFORMS) {
      const rid = RIDS[platform];
      const id = `roslyn-language-server.${rid}`;
      expect(pinnedRoslyn?.platforms[platform]).toMatchObject({
        kind: 'zip',
        url: `https://api.nuget.org/v3-flatcontainer/${id}/${ROSLYN_VERSION}/${id}.${ROSLYN_VERSION}.nupkg`,
        entry: `tools/net10.0/${rid}/Microsoft.CodeAnalysis.LanguageServer.dll`,
      });
    }
    const launch = launchRoslyn(ROSLYN_INSTALLED, DOTNET);
    // Lo's `dotnet`, which runs the program on .NET's runtime and reads no global.json, never the
    // launcher the package's tool would run, and no `--autoLoadProjects`.
    expect([launch.program, launch.args]).toEqual([
      DOTNET_INSTALLED.entry,
      [
        'exec',
        ROSLYN_INSTALLED.entry,
        '--stdio',
        '--logLevel',
        'Information',
        '--telemetryLevel',
        'off',
      ],
    ]);
    expect(launch.workspace).toBe(csharpWorkspace);
    expect(() => launchRoslyn({ folder: 'roslyn', entry: 'roslyn/server.dll' }, DOTNET)).toThrow(
      "roslyn/server.dll isn't an absolute path",
    );
    expect(() =>
      launchRoslyn(ROSLYN_INSTALLED, {
        ...DOTNET,
        installed: { folder: 'dotnet', entry: 'dotnet/dotnet' },
      }),
    ).toThrow("dotnet/dotnet isn't an absolute path");
    expect(() => launchRoslyn(ROSLYN_INSTALLED, DOTNET, {})).toThrow('has no roslyn');
  });

  test('gets .NET’s folder and variables, and a cap on each heap under Lo’s on its group', () => {
    const launch = launchRoslyn(ROSLYN_INSTALLED, DOTNET);
    expect(launch.path).toEqual([DOTNET_INSTALLED.folder]);
    expect(launch.variables).toEqual({ ...DOTNET.variables, DOTNET_GCHeapHardLimit: 'c0000000' });
    expect(launch.allowed).toEqual([]);
    // 3 GB, in hex as .NET reads it.
    expect(Number.parseInt(DOTNET_HEAP, 16)).toBe(3 * 1024 ** 3);
    expect(Number.parseInt(DOTNET_HEAP, 16)).toBeLessThan(LIMITS.memoryCap);
  });

  test('restores nothing, builds no file as a program, and fetches no sources', () => {
    expect(setting(ROSLYN, 'projects.dotnet_enable_automatic_restore')).toBe(false);
    expect(setting(ROSLYN, 'projects.dotnet_enable_file_based_programs')).toBe(false);
    expect(setting(ROSLYN, 'projects.dotnet_enable_file_based_programs_when_ambiguous')).toBe(
      false,
    );
    expect(setting(ROSLYN, 'navigation.dotnet_navigate_to_decompiled_sources')).toBe(false);
    expect(setting(ROSLYN, 'navigation.dotnet_navigate_to_source_link_and_embedded_sources')).toBe(
      false,
    );
    // No code lens, whose tests' would run them.
    expect(setting(ROSLYN, 'csharp|code_lens.dotnet_enable_tests_code_lens')).toBe(false);
    expect(setting(ROSLYN, 'csharp|code_lens.dotnet_enable_references_code_lens')).toBe(false);
  });

  test('gives the type hints gh shows: parameters’ names, and the types C# infers', () => {
    for (const name of [
      'dotnet_enable_inlay_hints_for_parameters',
      'csharp_enable_inlay_hints_for_types',
      'csharp_enable_inlay_hints_for_implicit_variable_types',
      'csharp_enable_inlay_hints_for_lambda_parameter_types',
    ]) {
      expect(setting(ROSLYN, `csharp|inlay_hints.${name}`)).toBe(true);
    }
  });

  test('loads a project of Lo’s, which imports only the SDK’s files and lists each file', () => {
    const project = csharpProject([
      '/c/src/A.cs',
      '/c/$(Evil)/@(Items)/%41;*?.cs',
      "/c/it's (1).cs",
    ]);
    expect(project.match(/<Compile Include="[^"]*" \/>/g)).toEqual([
      '<Compile Include="/c/src/A.cs" />',
      '<Compile Include="/c/%24%28Evil%29/%40%28Items%29/%2541%3B%2A%3F.cs" />',
      '<Compile Include="/c/it%27s %281%29.cs" />',
    ]);
    // The SDK's own files, and nothing it would import from above the project, or from the user's
    // MSBuild folders.
    expect(project.match(/<Import [^>]*>/g)).toEqual([
      '<Import Project="Sdk.props" Sdk="Microsoft.NET.Sdk" />',
      '<Import Project="Sdk.targets" Sdk="Microsoft.NET.Sdk" />',
    ]);
    for (const name of [
      'ImportDirectoryBuildProps',
      'ImportDirectoryBuildTargets',
      'ImportDirectoryPackagesProps',
      'ImportProjectExtensionProps',
      'ImportProjectExtensionTargets',
      'ImportUserLocationsByWildcardBeforeMicrosoftCommonProps',
      'ImportUserLocationsByWildcardAfterMicrosoftCommonProps',
      'ImportUserLocationsByWildcardBeforeMicrosoftCommonTargets',
      'ImportUserLocationsByWildcardAfterMicrosoftCommonTargets',
      'EnableDefaultItems',
      'ManagePackageVersionsCentrally',
      'EnableNETAnalyzers',
      'RunAnalyzers',
      'DiscoverEditorConfigFiles',
      'DiscoverGlobalAnalyzerConfigFiles',
    ]) {
      expect(project).toContain(`<${name}>false</${name}>`);
    }
    // No package, and no analyzer or source generator, not even the SDK's own.
    expect(project).not.toMatch(/PackageReference|UsingTask|Exec\b/);
    expect(project).toContain('<Analyzer Remove="@(Analyzer)" />');
    // MSBuild's characters, each escaped, and XML's.
    expect(msbuild("%$@'();?*")).toBe('%25%24%40%27%28%29%3B%3F%2A');
    expect(csharpProject(['/c/a&b<c>"d.cs'])).toContain(
      '<Compile Include="/c/a&amp;b&lt;c&gt;&quot;d.cs" />',
    );
  });

  test('lists the checkout’s .cs files, but none in build output or hidden folders, nor links', async () => {
    const root = tempFolder();
    const files = {
      'src/A.cs': '',
      'src/Lower.CS': '',
      'src/nested/B.cs': '',
      'src/bin/Built.cs': '',
      'src/OBJ/Generated.cs': '',
      '.hidden/C.cs': '',
      'src/.git/D.cs': '',
      'src/.editorconfig': '',
      'src/Readme.md': '',
      'src/bad\u0007name.cs': '',
    };
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    symlinkSync(join(root, 'src', 'A.cs'), join(root, 'src', 'Link.cs'));
    symlinkSync(join(root, 'src'), join(root, 'linked'));
    expect(await csharpSources(root)).toEqual([
      join(root, 'src', 'A.cs'),
      join(root, 'src', 'Lower.CS'),
      join(root, 'src', 'nested', 'B.cs'),
    ]);
    await expect(csharpSources(root, { folders: CSHARP_FOLDERS, files: 2 })).rejects.toThrow(
      'The checkout has more than 2 C# files.',
    );
  });

  test('never looks in .git or node_modules, and looks in so many folders, the nearest first', async () => {
    const root = tempFolder();
    for (const folder of [
      '.git/objects/pack',
      'node_modules/a/b',
      'Node_Modules/c',
      'src/deep/er',
    ]) {
      mkdirSync(join(root, folder), { recursive: true });
    }
    for (const file of [
      'node_modules/a/b/N.cs',
      'Node_Modules/c/M.cs',
      'src/A.cs',
      'src/deep/er/B.cs',
    ]) {
      writeFileSync(join(root, file), '');
    }
    // The checkout's root and `src`: neither `.git` nor `node_modules` is one it looks in.
    expect(await csharpSources(root, { folders: 2, files: CSHARP_FILES })).toEqual([
      join(root, 'src', 'A.cs'),
    ]);
    expect(await csharpSources(root)).toEqual([
      join(root, 'src', 'A.cs'),
      join(root, 'src', 'deep', 'er', 'B.cs'),
    ]);
  });

  test('lists no file whose path MSBuild would read as another file’s', async () => {
    const folder = tempFolder();
    const root = join(folder, 'outer', 'checkout');
    mkdirSync(root, { recursive: true });
    // On macOS and Linux MSBuild reads `\` as `/`: the first is `outside.cs`, two folders above
    // the checkout, and `.\z.cs` is `z.cs`, a link to a file outside it.
    writeFileSync(join(folder, 'outside.cs'), '');
    writeFileSync(join(root, 'back\\..\\..\\outside.cs'), '');
    symlinkSync('/etc/hosts', join(root, 'z.cs'));
    writeFileSync(join(root, '.\\z.cs'), '');
    writeFileSync(join(root, 'A.cs'), '');
    expect(await csharpSources(root)).toEqual([join(root, 'A.cs')]);
    // A name with a `\` is never one, and a path that got past that isn't kept either.
    expect(writable('back\\..\\..\\outside.cs')).toBe(false);
    expect(writable('.\\z.cs')).toBe(false);
    const named = ['back\\..\\..\\outside.cs', '.\\z.cs', 'z.cs', 'A.cs'];
    expect(
      await inCheckout(
        root,
        named.map((name) => join(root, name)),
      ),
    ).toEqual([join(root, 'A.cs')]);
    // Nor one through a link to a folder out of the checkout.
    writeFileSync(join(folder, 'B.cs'), '');
    symlinkSync(folder, join(root, 'away'));
    expect(await inCheckout(root, [join(root, 'away', 'B.cs')])).toEqual([]);
  });

  test('lists no file whose name XML can’t hold, which would make its project no XML', async () => {
    // XML 1.0 holds none of U+FFFE, U+FFFF, a lone surrogate or most controls, and an attribute
    // reads a tab or line break as a space. Linux names files with any of them; macOS with some.
    const names = ['a\uFFFE.cs', 'b\uFFFF.cs', 'c\uD800.cs', 'd\u0001.cs', 'e\t.cs', 'f\u0085.cs'];
    expect(names.filter((name) => writable(name))).toEqual([]);
    expect(
      ['A.cs', 'é.cs', '中.cs', '\u{1F600}.cs', 'a b.cs'].every((name) => writable(name)),
    ).toBe(true);
    const root = tempFolder();
    writeFileSync(join(root, 'A.cs'), '');
    for (const name of names) {
      try {
        writeFileSync(join(root, name), '');
      } catch {
        // A name the disk can't hold either.
      }
    }
    expect(await csharpSources(root)).toEqual([join(root, 'A.cs')]);
  });

  test('writes its project in its home, and is told of no folder but that one', async () => {
    const folder = tempFolder();
    const root = join(folder, 'checkout');
    const home = join(folder, 'home');
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(join(root, 'app', 'Program.cs'), '');
    writeFileSync(join(root, 'Directory.Build.props'), '<Project />');
    const workspace = await csharpWorkspace({ root, home });
    const project = join(home, CSHARP_PROJECT.folder, CSHARP_PROJECT.file);
    expect(workspace).toEqual({
      folder: join(home, CSHARP_PROJECT.folder),
      notifications: [
        { method: 'project/open', params: { projects: [pathToFileURL(project).href] } },
      ],
    });
    expect(readFileSync(project, 'utf8')).toBe(csharpProject([join(root, 'app', 'Program.cs')]));
    // Below a folder that holds a file MSBuild reads for every project below it, it writes none.
    writeFileSync(join(folder, 'Directory.Build.props'), '<Project />');
    await expect(csharpWorkspace({ root, home })).rejects.toThrow(
      `${join(folder, 'Directory.Build.props')} is in a folder above the project Lo writes for C#`,
    );
  });
});
