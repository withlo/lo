// SourceKit-LSP, as its adapter finds and starts it: the developer folder `xcode-select -p` names,
// the copy and SDK in it, what it's told, and the checkouts Lo refuses it. No server runs here, and
// no `xcode-select` but a stand-in.

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, onTestFinished, test, vi } from 'vitest';

import { GIT, tempFolder } from '../../test/support.ts';
import { serverEnvironment } from '../environment.ts';
import {
  developerFolder,
  findSourceKit,
  launchSourceKit,
  placeSourceKit,
  SOURCEKIT_LSP,
  sourceKitCandidates,
  sourceKitCheckoutProblem,
  sourceKitOptions,
  XCODE_SELECT,
} from './sourcekit.ts';

/** Writes the program `text` at `path`, making its folders. */
function program(path: string, text: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, 0o755);
  return path;
}

/** Writes an empty file at `path`, making its folders. */
function file(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '');
  return path;
}

describe('the developer folder', () => {
  test('is what xcode-select names, run with nothing of Lo’s environment', async () => {
    vi.stubEnv('DEVELOPER_DIR', '/Planted');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const folder = tempFolder();
    // It names a folder from what it was given: Lo's DEVELOPER_DIR, and the folder it runs in.
    const named = program(
      join(folder, 'xcode-select'),
      '#!/bin/sh\nprintf "/Fake/Developer%s%s\\n" "$DEVELOPER_DIR" "$(pwd | tr / -)"\n',
    );
    expect(await developerFolder(named)).toBe('/Fake/Developer-');
  });

  test('is none when xcode-select fails, names no absolute path, or isn’t there', async () => {
    const folder = tempFolder();
    const fails = program(
      join(folder, 'fails'),
      '#!/bin/sh\necho "no developer folder" >&2\nexit 2\n',
    );
    const relative = program(join(folder, 'relative'), '#!/bin/sh\necho Developer\n');
    const lines = program(join(folder, 'lines'), '#!/bin/sh\nprintf "/a\\n/b\\n"\n');
    expect(await developerFolder(fails)).toBeUndefined();
    expect(await developerFolder(relative)).toBeUndefined();
    expect(await developerFolder(lines)).toBeUndefined();
    expect(await developerFolder(join(folder, 'missing'))).toBeUndefined();
    expect(XCODE_SELECT).toBe('/usr/bin/xcode-select');
  });
});

/**
 * A stand-in for `findCopy`: the first of `candidates`, but those `refused` names, that's a file
 * with something in it, by its real path.
 */
function findCopy(refused: readonly string[] = []) {
  return async function find(candidates: readonly string[]): Promise<string | undefined> {
    for (const candidate of candidates) {
      if (refused.includes(candidate)) continue;
      try {
        const real = realpathSync(candidate);
        if (readFileSync(real).length > 0) return real;
      } catch {
        // It isn't there.
      }
    }
    return undefined;
  };
}

/** A checkout with a Swift package and its compile commands, which SourceKit-LSP runs on. */
function checkout(): string {
  const root = realpathSync(tempFolder());
  file(join(root, 'Package.swift'));
  file(join(root, 'Sources', 'App', 'main.swift'));
  file(join(root, 'compile_commands.json'));
  file(join(root, 'Sources', 'App', '.swift-version'));
  return root;
}

describe('finding SourceKit-LSP', () => {
  test('looks in Xcode’s toolchain, then the Command Line Tools’ folder, each with its SDK', () => {
    expect(sourceKitCandidates('/Applications/Xcode.app/Contents/Developer')).toEqual([
      {
        program:
          '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/sourcekit-lsp',
        sdk: '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk',
        from: 'Xcode',
      },
      {
        program: '/Applications/Xcode.app/Contents/Developer/usr/bin/sourcekit-lsp',
        sdk: '/Applications/Xcode.app/Contents/Developer/SDKs/MacOSX.sdk',
        from: 'Apple’s Command Line Tools',
      },
    ]);
  });

  test('takes the first copy that may run and has its SDK', async () => {
    const xcode = realpathSync(tempFolder());
    const [inXcode, inTools] = sourceKitCandidates(xcode);
    program(inXcode?.program ?? '', '#!/bin/sh\n');
    mkdirSync(inXcode?.sdk ?? '', { recursive: true });
    expect(await findSourceKit(xcode, findCopy())).toEqual(inXcode);

    // The Command Line Tools', which has no Xcode toolchain.
    const tools = realpathSync(tempFolder());
    const [, clt] = sourceKitCandidates(tools);
    program(clt?.program ?? '', '#!/bin/sh\n');
    mkdirSync(clt?.sdk ?? '', { recursive: true });
    expect(await findSourceKit(tools, findCopy())).toEqual(clt);

    // A copy findCopy refuses, or one without its SDK, is passed over.
    program(inTools?.program ?? '', '#!/bin/sh\n');
    mkdirSync(inTools?.sdk ?? '', { recursive: true });
    expect(await findSourceKit(xcode, findCopy([inXcode?.program ?? '']))).toEqual(inTools);
    const bare = realpathSync(tempFolder());
    const [noSdk] = sourceKitCandidates(bare);
    program(noSdk?.program ?? '', '#!/bin/sh\n');
    file(noSdk?.sdk ?? '');
    expect(await findSourceKit(bare, findCopy())).toBeUndefined();

    // No developer folder, or one that isn't an absolute path, has none.
    expect(await findSourceKit(undefined, findCopy())).toBeUndefined();
    expect(await findSourceKit('Developer', findCopy())).toBeUndefined();
  });
});

describe('starting SourceKit-LSP', () => {
  const found = {
    program:
      '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/sourcekit-lsp',
    sdk: '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk',
    from: 'Xcode',
  };

  test('starts its program, told of no workspace, and says where it’s from', () => {
    const launch = launchSourceKit(found);
    expect(launch).toMatchObject({ program: found.program, args: [], rootless: true });
    // `sourcekitd`'s XPC service, counted and stopped with it.
    expect(launch.services).toEqual(['SourceKitService']);
    // Nothing of a toolchain's: its own PATH is the system's.
    expect(launch.path).toBeUndefined();
    expect(launch.variables).toBeUndefined();
    expect(launch.version).toBe('SourceKit-LSP from Xcode · Apache-2.0');
    expect(launchSourceKit({ ...found, from: 'Apple’s Command Line Tools' }).version).toBe(
      'SourceKit-LSP from Apple’s Command Line Tools · Apache-2.0',
    );
    expect(SOURCEKIT_LSP.license).toBe('Apache-2.0');
  });

  test('is told to build nothing, write only in its home, and use only the SDK', async () => {
    const where = { root: '/lo/checkouts/work', home: '/lo/homes/swift' };
    const placed = await placeSourceKit(where, found.sdk);
    expect(placed).toEqual({
      variables: { CFFIXED_USER_HOME: '/lo/homes/swift' },
      initializationOptions: {
        backgroundIndexing: false,
        generatedFilesPath: '/lo/homes/swift/generated',
        fallbackBuildSystem: {
          sdk: found.sdk,
          swiftCompilerFlags: ['-module-cache-path', '/lo/homes/swift/cache/modules'],
          cCompilerFlags: [],
          cxxCompilerFlags: [],
        },
        clangdOptions: [],
        sourcekitdRequestTimeout: 10,
        semanticServiceRestartTimeout: 30,
      },
    });
    expect(sourceKitOptions(where.home, found.sdk)).toEqual(placed.initializationOptions);
    // The launch's place gives the same, and its variable is one a server may have.
    const launched = await launchSourceKit(found).place?.(where);
    expect(launched).toEqual(placed);
    const env = serverEnvironment({
      home: where.home,
      roots: [where.root],
      path: [],
      variables: placed.variables,
      git: GIT,
    });
    expect(env.CFFIXED_USER_HOME).toBe(where.home);
  });
});

describe('the checkouts it refuses', () => {
  test('runs on a package, with its compile commands', async () => {
    expect(await sourceKitCheckoutProblem(checkout())).toBeUndefined();
  });

  test('refuses a build server’s file or folder, or its settings, anywhere in it, in any case', async () => {
    const cases: [string, (root: string) => void, string][] = [
      [
        'buildServer.json',
        (root) => file(join(root, 'buildServer.json')),
        'The checkout’s buildServer.json names a build server to run, so Lo won’t run SourceKit-LSP on it.',
      ],
      [
        'one in a folder, in another case',
        (root) => file(join(root, 'Sources', 'BuildServer.JSON')),
        'The checkout’s Sources/BuildServer.JSON names a build server to run, so Lo won’t run SourceKit-LSP on it.',
      ],
      [
        '.bsp',
        (root) => file(join(root, '.bsp', 'tool.json')),
        'The checkout’s .bsp names a build server to run, so Lo won’t run SourceKit-LSP on it.',
      ],
      [
        '.bsp, a file',
        (root) => file(join(root, 'Sources', '.bsp')),
        'The checkout’s Sources/.bsp names a build server to run, so Lo won’t run SourceKit-LSP on it.',
      ],
      [
        '.sourcekit-lsp',
        (root) => file(join(root, 'Sources', 'App', '.SourceKit-LSP', 'config.json')),
        'The checkout’s Sources/App/.SourceKit-LSP holds SourceKit-LSP’s settings, so Lo won’t run SourceKit-LSP on it.',
      ],
      [
        '.sourcekit-lsp with a long s, which a Mac’s disk opens as .sourcekit-lsp',
        (root) => file(join(root, '.\u017Fourcekit-lsp', 'config.json')),
        'The checkout’s .\u017Fourcekit-lsp holds SourceKit-LSP’s settings, so Lo won’t run SourceKit-LSP on it.',
      ],
      [
        '.sourcekit-lsp with a Kelvin sign',
        (root) => file(join(root, 'Sources', '.source\u212Ait-lsp', 'config.json')),
        'The checkout’s Sources/.source\u212Ait-lsp holds SourceKit-LSP’s settings, so Lo won’t run SourceKit-LSP on it.',
      ],
      [
        'buildServer.json, decomposed and with a long s',
        (root) => file(join(root, 'buildServer.j\u017Fon'.normalize('NFD'))),
        `The checkout’s ${'buildServer.j\u017Fon'.normalize('NFD')} names a build server to run, so Lo won’t run SourceKit-LSP on it.`,
      ],
      [
        'a link by that name',
        (root) => symlinkSync(tempFolder(), join(root, '.sourcekit-lsp')),
        'The checkout’s .sourcekit-lsp holds SourceKit-LSP’s settings, so Lo won’t run SourceKit-LSP on it.',
      ],
    ];
    const refused: [string, string | undefined][] = [];
    for (const [what, plant] of cases) {
      const root = checkout();
      plant(root);
      refused.push([what, await sourceKitCheckoutProblem(root)]);
    }
    expect(refused).toEqual(cases.map(([what, , why]) => [what, why]));
  });

  test('refuses a checkout with more entries than it looks through', async () => {
    const root = checkout();
    // Package.swift, Sources, Sources/App, its main.swift and .swift-version, and the commands.
    expect(await sourceKitCheckoutProblem(root, 6)).toBeUndefined();
    expect(await sourceKitCheckoutProblem(root, 5)).toBe(
      'The checkout has more than 5 files and folders, more than Lo looks through, so Lo won’t run SourceKit-LSP on it.',
    );
  });

  test('looks in its own folders, never through a link to one', async () => {
    const root = checkout();
    const elsewhere = tempFolder();
    file(join(elsewhere, 'buildServer.json'));
    symlinkSync(elsewhere, join(root, 'linked'));
    expect(await sourceKitCheckoutProblem(root)).toBeUndefined();
  });
});
