// What a server gets of each toolchain: its folder of programs first on the server's PATH, and the
// variables that hold it to Lo's copy, which a server's environment takes as they are. A checkout's
// own choice of a version (`go.mod`'s `toolchain`, `rust-toolchain.toml`, `global.json`,
// `gradle.properties`) changes none of it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { GIT, tempFolder } from '../test/support.ts';
import { serverEnvironment } from './environment.ts';
import { TOOLCHAINS } from './manifest.ts';
import { TOOLCHAIN_NAMES, toolchainUse } from './toolchains.ts';

const FILES = '/cache/toolchains/go/1.27.4/files';

test.each([
  [
    'go',
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
    },
  ],
  [
    'rust',
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
    },
  ],
  [
    'temurin',
    `${FILES}/jdk-25/Contents/Home/bin/java`,
    'darwin',
    {
      path: [`${FILES}/jdk-25/Contents/Home/bin`],
      variables: { JAVA_HOME: `${FILES}/jdk-25/Contents/Home` },
    },
  ],
  [
    'dotnet',
    `${FILES}/dotnet`,
    'linux',
    {
      path: [FILES],
      variables: {
        DOTNET_ROOT: FILES,
        DOTNET_CLI_TELEMETRY_OPTOUT: '1',
        DOTNET_NOLOGO: '1',
        DOTNET_ADD_GLOBAL_TOOLS_TO_PATH: '0',
        DOTNET_GENERATE_ASPNET_CERTIFICATE: '0',
        DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1',
      },
    },
  ],
] as const)('%s holds a server to Lo’s copy', (id, entry, platform, expected) => {
  const use = toolchainUse(id, { folder: FILES, entry }, platform);
  expect(use).toMatchObject(expected);
  // A server's environment takes it as it is.
  const env = serverEnvironment({
    home: '/cache/code/homes/a/b/server',
    roots: ['/cache/checkouts/a/b/pull-1'],
    path: [...use.path, '/opt/homebrew/bin'],
    variables: use.variables,
    allowed: use.allowed,
    git: GIT,
  });
  expect(env.PATH).toBe([...use.path, '/opt/homebrew/bin', '/usr/bin', '/bin'].join(':'));
  for (const [name, value] of Object.entries(use.variables)) expect(env[name]).toBe(value);
});

test('.NET reads the system’s globalization on macOS', () => {
  const use = toolchainUse('dotnet', { folder: FILES, entry: `${FILES}/dotnet` }, 'darwin');
  expect(use.variables).not.toHaveProperty('DOTNET_SYSTEM_GLOBALIZATION_INVARIANT');
});

test('each toolchain pinned has a name, and Lo knows how a server uses it', () => {
  for (const id of Object.keys(TOOLCHAINS)) {
    expect(TOOLCHAIN_NAMES[id]?.name).toBeTruthy();
    expect(() => toolchainUse(id, { folder: FILES, entry: `${FILES}/bin/x` })).not.toThrow();
  }
  expect(() => toolchainUse('ruby', { folder: FILES, entry: `${FILES}/bin/ruby` })).toThrow(
    /no toolchain ruby/,
  );
});

describe('a checkout that asks for other versions', () => {
  test('changes nothing a server gets', () => {
    const folder = tempFolder();
    const plain = join(folder, 'plain');
    const hostile = join(folder, 'hostile');
    mkdirSync(plain);
    // What the hostile fixture plants, as text.
    for (const [path, text] of [
      ['go/go.mod', 'module example.com/sample\n\ngo 1.24\n\ntoolchain go1.99.9\n'],
      ['rust/rust-toolchain.toml', '[toolchain]\nchannel = "99.0.0"\n'],
      ['rust/.cargo/config.toml', '[build]\nrustc-wrapper = "./lo-rustc-wrapper.sh"\n'],
      ['csharp/global.json', '{ "sdk": { "version": "8.0.100", "rollForward": "latestMajor" } }'],
      ['kotlin/gradle.properties', 'org.gradle.java.home=/elsewhere\n'],
    ] as const) {
      mkdirSync(join(hostile, path, '..'), { recursive: true });
      writeFileSync(join(hostile, path), text);
    }
    const environment = (root: string) =>
      Object.keys(TOOLCHAINS).map((id) => {
        const use = toolchainUse(id, { folder: FILES, entry: `${FILES}/bin/x` });
        return serverEnvironment({
          home: join(folder, 'home'),
          roots: [root],
          path: use.path,
          variables: use.variables,
          allowed: use.allowed,
          git: GIT,
        });
      });
    expect(environment(hostile)).toEqual(environment(plain));
  });
});
