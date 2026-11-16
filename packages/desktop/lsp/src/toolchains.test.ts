// What a server gets of each toolchain: its folder of programs first on the server's PATH, and the
// variables that hold it to Lo's copy, which a server's environment takes as they are, exactly, so
// that leaving one out fails. And the checkouts a server that uses .NET won't run on: those with a
// global.json, in them or above them, that could choose another SDK.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { GIT, tempFolder } from '../test/support.ts';
import { serverEnvironment } from './environment.ts';
import { TOOLCHAINS } from './manifest.ts';
import { checkoutProblem, TOOLCHAIN_NAMES, toolchainUse } from './toolchains.ts';

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
        CGO_ENABLED: '0',
      },
      allowed: [],
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
  const env = serverEnvironment({
    home: '/cache/code/homes/a/b/server',
    roots: ['/cache/checkouts/a/b/pull-1'],
    path: [...use.path, '/opt/homebrew/bin'],
    variables: use.variables,
    allowed: use.allowed,
    git: GIT,
  });
  expect(env).toEqual({
    ...GIT,
    ...expected.variables,
    HOME: '/cache/code/homes/a/b/server',
    TMPDIR: '/cache/code/homes/a/b/server/tmp',
    PATH: [...expected.path, '/opt/homebrew/bin', '/usr/bin', '/bin'].join(':'),
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

  test('and the other toolchains read no global.json', async () => {
    const { root } = checkout({ ...PLANTED, 'global.json': '{ "sdk": { "paths": ["evil"] } }' });
    for (const id of ['go', 'rust', 'temurin'])
      expect(await checkoutProblem(id, root)).toBeUndefined();
  });
});

describe('a checkout rust-analyzer won’t run on', () => {
  test('a rust-analyzer.toml, whose settings win over Lo’s and could run a program', async () => {
    const { root } = checkout({
      'crate/rust-analyzer.toml': '[cargo.buildScripts]\noverrideCommand = ["./evil.sh"]\n',
    });
    expect(await checkoutProblem('rust', root)).toBe(
      'The checkout’s crate/rust-analyzer.toml is a rust-analyzer.toml, whose settings win over Lo’s and could run a program, so Lo won’t run rust-analyzer on it.',
    );
  });

  test.each([
    ['config.toml', '[env]\nDYLD_INSERT_LIBRARIES = { value = "./evil.dylib", force = true }\n'],
    ['config', 'env.LD_PRELOAD = "./evil.so"\n'],
    ['config.toml', '[build]\nrustc = "x"\n[ env ]\nFOO = "bar"\n'],
    ['config.toml', 'env = { FOO = "bar" }\n'],
  ])('a .cargo/%s with an [env] table cargo sets on rustc', async (name, text) => {
    const { root } = checkout({ [`.cargo/${name}`]: text });
    expect(await checkoutProblem('rust', root)).toBe(
      `The checkout’s .cargo/${name} has an [env] table, which cargo sets on the rustc it runs, so Lo won’t run rust-analyzer on it.`,
    );
  });

  test('a .cargo/config.toml above the checkout, which cargo reads too', async () => {
    const { root, above } = checkout({});
    mkdirSync(join(above, '.cargo'), { recursive: true });
    writeFileSync(join(above, '.cargo', 'config.toml'), '[build]\ntarget = "x"\n');
    expect(await checkoutProblem('rust', root)).toBe(
      `${join(above, '.cargo', 'config.toml')} is a Cargo config above the checkout, which cargo reads, so Lo won’t run rust-analyzer on this checkout.`,
    );
  });

  test('but runs on one whose Cargo config holds only keys Lo’s variables answer', async () => {
    const { root } = checkout({
      '.cargo/config.toml':
        '# a project config\n[build]\nrustc-wrapper = "./wrap.sh"\ntarget = "wasm32-unknown-unknown"\n[source.crates-io]\nreplace-with = "vendored"\n[registries.other]\nindex = "sparse+https://example.invalid/"\n',
    });
    expect(await checkoutProblem('rust', root)).toBeUndefined();
    expect(await checkoutProblem('rust', checkout({}).root)).toBeUndefined();
  });

  test('and the other toolchains read no rust-analyzer.toml or Cargo config', async () => {
    const { root } = checkout({
      'rust-analyzer.toml': '[cargo]\nextraEnv = { X = "1" }\n',
      '.cargo/config.toml': '[env]\nX = "1"\n',
    });
    for (const id of ['go', 'dotnet', 'temurin'])
      expect(await checkoutProblem(id, root)).toBeUndefined();
  });
});
