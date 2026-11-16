// What a server gets of each toolchain: its folder of programs first on the server's PATH, and the
// variables that hold it to Lo's copy, which a server's environment takes as they are, exactly, so
// that leaving one out fails. And the checkouts a server that uses .NET won't run on, those with a
// global.json, in them or above them, that could choose another SDK, and the ones a server that
// uses Go won't: those with a go.work above them, or one in them naming a folder outside.

import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { GIT, tempFolder } from '../test/support.ts';
import { NO_NETWORK, serverEnvironment } from './environment.ts';
import { TOOLCHAINS } from './manifest.ts';
import { checkoutProblem, TOOLCHAIN_NAMES, toolchainUse, workFolders } from './toolchains.ts';

const FILES = '/cache/toolchains/go/1.27.4/files';

test.each([
  [
    'go',
    '1.27.4',
    `${FILES}/go/bin/go`,
    'linux',
    {
      path: [`${FILES}/go/bin`],
      variables: {
        GOROOT: `${FILES}/go`,
        GOTOOLCHAIN: 'local',
        GOENV: 'off',
        GOPROXY: 'off',
        GOFLAGS: '',
        CGO_ENABLED: '0',
        GOPACKAGESDRIVER: 'off',
      },
      allowed: ['GOFLAGS', 'GOPACKAGESDRIVER'],
      homeFolders: { GOPATH: 'go', GOMODCACHE: 'go/pkg/mod', GOCACHE: 'cache/go-build' },
    },
  ],
  [
    'rust',
    '1.100.0',
    `${FILES}/bin/cargo`,
    'darwin',
    {
      path: [`${FILES}/bin`],
      variables: {
        RUSTC: `${FILES}/bin/rustc`,
        CARGO: `${FILES}/bin/cargo`,
        RUSTC_WRAPPER: '',
        RUSTC_WORKSPACE_WRAPPER: '',
        CARGO_NET_OFFLINE: 'true',
      },
      allowed: ['RUSTC', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER'],
    },
  ],
  [
    'temurin',
    '25.0.5+8',
    `${FILES}/jdk-25/Contents/Home/bin/java`,
    'darwin',
    {
      path: [`${FILES}/jdk-25/Contents/Home/bin`],
      variables: { JAVA_HOME: `${FILES}/jdk-25/Contents/Home` },
      allowed: [],
    },
  ],
  [
    'dotnet',
    '10.0.404',
    `${FILES}/dotnet`,
    'linux',
    {
      path: [FILES],
      variables: {
        DOTNET_ROOT: FILES,
        DOTNET_MSBUILD_SDK_RESOLVER_CLI_DIR: FILES,
        DOTNET_MSBUILD_SDK_RESOLVER_SDKS_DIR: `${FILES}/sdk/10.0.404/Sdks`,
        DOTNET_MSBUILD_SDK_RESOLVER_SDKS_VER: '10.0.404',
        DOTNET_HOST_PATH: `${FILES}/dotnet`,
        DOTNET_ROLL_FORWARD: 'LatestPatch',
        DOTNET_CLI_TELEMETRY_OPTOUT: '1',
        DOTNET_NOLOGO: '1',
        DOTNET_ADD_GLOBAL_TOOLS_TO_PATH: '0',
        DOTNET_GENERATE_ASPNET_CERTIFICATE: '0',
        DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1',
      },
      allowed: [],
    },
  ],
] as const)('%s holds a server to Lo’s copy', (id, version, entry, platform, expected) => {
  const use = toolchainUse(id, version, { folder: FILES, entry }, platform);
  expect(use).toEqual(expected);
  // A server's environment takes it as it is, and holds nothing else of it.
  const home = '/cache/code/homes/a/b/server';
  const env = serverEnvironment({
    home,
    roots: ['/cache/checkouts/a/b/pull-1'],
    path: [...use.path, '/opt/homebrew/bin'],
    variables: use.variables,
    allowed: use.allowed,
    homeFolders: use.homeFolders,
    git: GIT,
  });
  const homes: Readonly<Record<string, string>> =
    'homeFolders' in expected ? expected.homeFolders : {};
  expect(env).toEqual({
    ...GIT,
    ...expected.variables,
    ...Object.fromEntries(Object.entries(homes).map(([name, path]) => [name, `${home}/${path}`])),
    HOME: home,
    TMPDIR: `${home}/tmp`,
    PATH: [...expected.path, '/opt/homebrew/bin', '/usr/bin', '/bin'].join(':'),
    HTTPS_PROXY: NO_NETWORK,
    https_proxy: NO_NETWORK,
    HTTP_PROXY: NO_NETWORK,
    http_proxy: NO_NETWORK,
    ALL_PROXY: NO_NETWORK,
    all_proxy: NO_NETWORK,
    LANG: 'C.UTF-8',
  });
});

test('.NET reads the system’s globalization on macOS', () => {
  const use = toolchainUse(
    'dotnet',
    '10.0.404',
    { folder: FILES, entry: `${FILES}/dotnet` },
    'darwin',
  );
  expect(use.variables).not.toHaveProperty('DOTNET_SYSTEM_GLOBALIZATION_INVARIANT');
});

test('each toolchain pinned has a name, and Lo knows how a server uses it', () => {
  for (const [id, pinned] of Object.entries(TOOLCHAINS)) {
    expect(TOOLCHAIN_NAMES[id]?.name).toBeTruthy();
    const installed = { folder: FILES, entry: `${FILES}/bin/x` };
    expect(() => toolchainUse(id, pinned.version, installed)).not.toThrow();
  }
  expect(() =>
    toolchainUse('ruby', '3.0.0', { folder: FILES, entry: `${FILES}/bin/ruby` }),
  ).toThrow(/no toolchain ruby/);
});

/** A checkout in a folder of its own, with `files` written into it, and where it is. */
function checkout(files: Record<string, string>): { root: string; above: string } {
  const above = tempFolder();
  const root = join(above, 'checkouts', 'pull-1', 'abc');
  mkdirSync(root, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, above };
}

/** An SDK planted in a checkout, for a global.json's `sdk.paths` to send `dotnet` to. */
const PLANTED = {
  'evil/sdk/10.0.404/dotnet.dll': 'leaves lo-hostile-dotnet beside the checkout',
  'evil/sdk/10.0.404/dotnet.runtimeconfig.json': '{}',
  'app/App.csproj': '<Project Sdk="Microsoft.NET.Sdk" />',
};

describe('a checkout a server that uses .NET won’t run on', () => {
  test.each([
    [
      'a global.json beside it that names folders to look for an SDK in',
      'global.json',
      '{ "sdk": { "paths": ["evil"] } }',
    ],
    [
      'one in a project’s folder, nearest it',
      'app/global.json',
      '{ "sdk": { "paths": ["../evil", "$host$"] } }',
    ],
    [
      'one named in other case, which a Mac’s disk finds',
      'app/Global.JSON',
      '{ "sdk": { "paths": ["../evil"] } }',
    ],
    [
      'one that spells its key with an escape',
      'global.json',
      '{ "sdk": { "pa\\u0074hs": ["evil"] } }',
    ],
    [
      'one with a comment around its key',
      'global.json',
      '{ /* pinned */ "sdk": { "paths": /* here */ ["evil"] } }',
    ],
  ])('%s', async (_, path, text) => {
    const { root } = checkout({ ...PLANTED, [path]: text });
    expect(await checkoutProblem('dotnet', root)).toBe(
      `The checkout’s ${path} ${text.includes('\\u') ? 'spells a name with an escape Lo doesn’t read' : 'names folders to look for an SDK in'}, so it could choose a .NET SDK other than Lo’s.`,
    );
  });

  test('one in a folder above it, which the SDK reads when the checkout has none', async () => {
    const { root, above } = checkout(PLANTED);
    writeFileSync(
      join(above, 'global.json'),
      '{ "sdk": { "paths": ["checkouts/pull-1/abc/evil"] } }',
    );
    expect(await checkoutProblem('dotnet', root)).toBe(
      `${join(above, 'global.json')} names folders to look for an SDK in, so it could choose a .NET SDK other than Lo’s.`,
    );
  });

  test('but runs on one whose global.json can only pick Lo’s SDK, or fail', async () => {
    const { root } = checkout({
      'global.json':
        '{ // the SDK this repo builds with\n "sdk": { "version": "8.0.100", "rollForward": "latestMajor" } }',
      'app/App.csproj': '<Project Sdk="Microsoft.NET.Sdk" />',
    });
    expect(await checkoutProblem('dotnet', root)).toBeUndefined();
    expect(await checkoutProblem('dotnet', checkout({}).root)).toBeUndefined();
  });

  test('nor looks for one through a link, which may lead anywhere on the disk', async () => {
    const { root, above } = checkout({ 'app/App.csproj': '<Project Sdk="Microsoft.NET.Sdk" />' });
    mkdirSync(join(above, 'elsewhere'));
    writeFileSync(join(above, 'elsewhere', 'global.json'), '{ "sdk": { "paths": ["."] } }');
    symlinkSync(join(above, 'elsewhere'), join(root, 'elsewhere'));
    symlinkSync('/', join(root, 'app', 'disk'));
    expect(await checkoutProblem('dotnet', root)).toBeUndefined();
  });

  test('and the other toolchains read no global.json', async () => {
    const { root } = checkout({ ...PLANTED, 'global.json': '{ "sdk": { "paths": ["evil"] } }' });
    for (const id of ['go', 'rust', 'temurin'])
      expect(await checkoutProblem(id, root)).toBeUndefined();
  });
});

describe('a checkout a server that uses Go won’t run on', () => {
  const MODULE = {
    'go.mod': 'module example.com/app\n\ngo 1.24\n',
    'app/main.go': 'package main\n',
  };

  test('one with a go.work in a folder above it, which Go would take as its workspace', async () => {
    const { root, above } = checkout(MODULE);
    writeFileSync(join(above, 'go.work'), 'go 1.24\n\nuse ./checkouts/pull-1/abc\n');
    expect(await checkoutProblem('go', root)).toBe(
      `${join(above, 'go.work')} is a go.work in a folder above the checkout, which Go would take as the checkout’s workspace.`,
    );
    // Go finds one by its name alone, so a link to a file counts, and an empty file.
    const linked = checkout(MODULE);
    writeFileSync(join(linked.above, 'elsewhere'), '');
    symlinkSync(join(linked.above, 'elsewhere'), join(linked.above, 'checkouts', 'go.work'));
    expect(await checkoutProblem('go', linked.root)).toMatch(/is a go\.work in a folder above/);
  });

  test.each([
    ['a use of a folder above it', 'go.work', 'go 1.24\nuse ../../elsewhere\n', '../../elsewhere'],
    ['one in a block', 'go.work', 'go 1.24\n\nuse (\n\t./app\n\t"../outside"\n)\n', '../outside'],
    ['an absolute one', 'go.work', 'use /etc\n', '/etc'],
    ['a replace with a path', 'go.work', 'replace example.com/x v1.0.0 => ../x\n', '../x'],
    [
      'a replace in a block',
      'go.work',
      'replace (\n\texample.com/x => example.com/y v1.0.0\n\texample.com/z => /tmp/z\n)\n',
      '/tmp/z',
    ],
    ['one from a go.work in a module of its own', 'app/go.work', 'use ../..\n', '../..'],
    ['a link inside it to a folder outside', 'go.work', 'use ./link\n', './link'],
  ])('one whose go.work names a folder outside it: %s', async (_, path, text, folder) => {
    const { root, above } = checkout({ ...MODULE, [path]: text });
    symlinkSync(above, join(root, 'link'));
    expect(await checkoutProblem('go', root)).toBe(
      `The checkout’s ${path} names ${folder}, a folder outside the checkout, as part of its workspace.`,
    );
  });

  test('one whose go.work is a link, which may lead anywhere', async () => {
    const { root, above } = checkout(MODULE);
    writeFileSync(join(above, 'elsewhere.work'), 'use .\n');
    symlinkSync(join(above, 'elsewhere.work'), join(root, 'app', 'go.work'));
    expect(await checkoutProblem('go', root)).toBe(
      'The checkout’s app/go.work isn’t a plain file, so it could name a folder outside the checkout.',
    );
  });

  test('and looks for one in its own folders, not through a link that leads out of them', async () => {
    const { root, above } = checkout(MODULE);
    mkdirSync(join(above, 'elsewhere'));
    writeFileSync(join(above, 'elsewhere', 'go.work'), 'use /\n');
    symlinkSync(join(above, 'elsewhere'), join(root, 'elsewhere'));
    symlinkSync(root, join(root, 'app', 'loop'));
    expect(await checkoutProblem('go', root)).toBeUndefined();
  });

  test.each([
    ['an escape in a path', 'use "..\\x2e/elsewhere"\n'],
    ['a string left open', 'use "../elsewhere\n'],
    ['a block left open', 'use (\n\t./app\n'],
    ['a block opened mid-line', 'use ./app (\n\t../elsewhere\n)\n'],
    // Go takes `x=>y` as the module's path, and `../../elsewhere` as where it's replaced from.
    ['an arrow inside a word', 'replace x=>y => ../../elsewhere\n'],
    ['an arrow that starts a word', 'replace x =>../../elsewhere\n'],
    ['a quote inside a word', 'use ./app"../../elsewhere"\n'],
  ])('one whose go.work Lo can’t read for certain: %s', async (_, text) => {
    const { root } = checkout({ ...MODULE, 'go.work': text });
    expect(await checkoutProblem('go', root)).toBe(
      'The checkout’s go.work spells a path in a way Lo doesn’t read, so it could name a folder outside the checkout.',
    );
  });

  test('but runs on one whose go.work names only its own folders', async () => {
    const text = [
      'go 1.24',
      'toolchain go1.99.9 // GOTOOLCHAIN=local holds it',
      'use (',
      '\t.',
      '\t./app // the app',
      '\t`tools`',
      ')',
      'use ./app/../tools',
      'replace example.com/x v1.0.0 => example.com/y v1.2.0',
      'replace example.com/z => ./vendor/z',
      'godebug default=go1.21',
    ].join('\n');
    const { root } = checkout({ ...MODULE, 'go.work': text, 'app/go.work': 'use ..\n' });
    expect(workFolders(text)).toEqual(['.', './app', 'tools', './app/../tools', './vendor/z']);
    expect(await checkoutProblem('go', root)).toBeUndefined();
    expect(await checkoutProblem('go', checkout(MODULE).root)).toBeUndefined();
  });

  test('and the other toolchains read no go.work', async () => {
    const { root, above } = checkout({ ...MODULE, 'go.work': 'use ../..\n' });
    writeFileSync(join(above, 'go.work'), 'use .\n');
    for (const id of ['dotnet', 'rust', 'temurin'])
      expect(await checkoutProblem(id, root)).toBeUndefined();
  });
});
