// What a server gets of each toolchain: its folder of programs first on the server's PATH, and the
// variables that hold it to Lo's copy, which a server's environment takes as they are, exactly, so
// that leaving one out fails. And the checkouts a server that uses .NET won't run on, those with a
// global.json, in them or above them, that could choose another SDK, and the ones a server that
// uses Go won’t: those with a go.work above them, or one in them naming a folder outside. And the
// ones rust-analyzer won't: those with a rust-analyzer.toml, a Cargo config with a key Lo's
// variables can't answer or that's a link, or any Cargo config above them. Each matches a name as a
// Mac's disk opens it.

import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { GIT, tempFolder } from '../test/support.ts';
import { NO_NETWORK, serverEnvironment } from './environment.ts';
import { TOOLCHAINS } from './manifest.ts';
import {
  checkoutProblem,
  dotnetAbove,
  foldName,
  TOOLCHAIN_NAMES,
  toolchainUse,
  workFolders,
} from './toolchains.ts';

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
        CARGO_ENCODED_RUSTFLAGS: '',
        CARGO_ENCODED_RUSTDOCFLAGS: '',
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
      'one named with a long s, which a Mac’s disk opens as global.json',
      'app/global.j\u017Fon',
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

  test.each([
    ['Directory.Build.props', 'MSBuild'],
    ['directory.build.TARGETS', 'MSBuild'],
    ['Directory.Packages.props', 'MSBuild'],
    ['NuGet.Config', 'NuGet'],
    // With a long s, which a Mac's disk opens as Directory.Build.props.
    ['Directory.Build.prop\u017F', 'MSBuild'],
  ])(
    'a %s in a folder above it, which %s reads for every project below it',
    async (name, reader) => {
      const { root, above } = checkout(PLANTED);
      const file = join(above, 'checkouts', name);
      writeFileSync(file, '<Project />');
      expect(await checkoutProblem('dotnet', root)).toBe(
        `${file} is in a folder above the checkout, and ${reader} would read it for every project below it.`,
      );
    },
  );

  test('but runs on one that holds them itself, since only its own projects read those', async () => {
    const { root } = checkout({
      ...PLANTED,
      'Directory.Build.props': '<Project />',
      'app/Directory.Build.targets': '<Project />',
      'Directory.Packages.props': '<Project />',
      'NuGet.config': '<configuration />',
    });
    expect(await checkoutProblem('dotnet', root)).toBeUndefined();
  });

  test('and asks the same of each folder above the project Lo writes in a server’s home', async () => {
    const { above } = checkout({});
    const project = join(above, 'homes', 'lo', 'roslyn', 'project');
    mkdirSync(project, { recursive: true });
    expect(await dotnetAbove(project, 'the project Lo writes for C#')).toBeUndefined();
    const file = join(above, 'homes', 'Directory.Build.targets');
    writeFileSync(file, '<Project />');
    expect(await dotnetAbove(project, 'the project Lo writes for C#')).toBe(
      `${file} is in a folder above the project Lo writes for C#, and MSBuild would read it for every project below it.`,
    );
    // And a global.json the SDK resolver would read there, as the checkout's are read.
    rmSync(file);
    const global = join(above, 'global.json');
    writeFileSync(global, '{ "sdk": { "paths": ["evil"] } }');
    expect(await dotnetAbove(project, 'the project Lo writes for C#')).toBe(
      `${global} names folders to look for an SDK in, so it could choose a .NET SDK other than Lo’s.`,
    );
  });

  test('nor looks for one through a link, which may lead anywhere on the disk', async () => {
    const { root, above } = checkout({ 'app/App.csproj': '<Project Sdk="Microsoft.NET.Sdk" />' });
    mkdirSync(join(above, 'elsewhere'));
    writeFileSync(join(above, 'elsewhere', 'global.json'), '{ "sdk": { "paths": ["."] } }');
    symlinkSync(join(above, 'elsewhere'), join(root, 'elsewhere'));
    symlinkSync('/', join(root, 'app', 'disk'));
    expect(await checkoutProblem('dotnet', root)).toBeUndefined();
  });

  test('and the other toolchains read no global.json, nor what MSBuild and NuGet read', async () => {
    const { root, above } = checkout({
      ...PLANTED,
      'global.json': '{ "sdk": { "paths": ["evil"] } }',
    });
    writeFileSync(join(above, 'Directory.Build.props'), '<Project />');
    for (const id of ['go', 'rust', 'temurin'])
      expect(await checkoutProblem(id, root)).toBeUndefined();
  });
});

/** Why a Cargo config with an `[unstable]` table, or an `include`, refuses its checkout. */
const UNSTABLE = 'has an [unstable] table, which turns on cargo’s unstable features';
const INCLUDE = 'includes another config, which can be outside the checkout';

describe('a checkout rust-analyzer won’t run on', () => {
  test('a rust-analyzer.toml, whose settings win over Lo’s and could run a program', async () => {
    const { root } = checkout({
      'crate/rust-analyzer.toml': '[cargo.buildScripts]\noverrideCommand = ["./evil.sh"]\n',
    });
    expect(await checkoutProblem('rust', root)).toBe(
      'The checkout’s crate/rust-analyzer.toml is a rust-analyzer.toml, whose settings win over Lo’s and could run a program, so Lo won’t run rust-analyzer on it.',
    );
  });

  test('a rust-analyzer.toml named with a long s, which a Mac’s disk opens as one', async () => {
    const { root } = checkout({ 'ru\u017Ft-analyzer.toml': '[cargo]\nextraEnv = { X = "1" }\n' });
    expect(await checkoutProblem('rust', root)).toBe(
      'The checkout’s ru\u017Ft-analyzer.toml is a rust-analyzer.toml, whose settings win over Lo’s and could run a program, so Lo won’t run rust-analyzer on it.',
    );
  });

  test.each([
    ['config.toml', '[env]\nDYLD_INSERT_LIBRARIES = { value = "./evil.dylib", force = true }\n'],
    ['config', 'env.LD_PRELOAD = "./evil.so"\n'],
    ['config.toml', '[build]\nrustc = "x"\n[ env ]\nFOO = "bar"\n'],
    ['config.toml', 'env = { FOO = "bar" }\n'],
    // Keys quoted, or spelled with an escape, are the same key to cargo.
    ['config.toml', '["env"]\nFOO = "bar"\n'],
    ['config.toml', '\'env\'.FOO = "bar"\n'],
    ['config.toml', '["\\u0065nv"]\nFOO = "bar"\n'],
    ['config', '"env" = { FOO = "bar" }\n'],
  ])('a .cargo/%s with an [env] table cargo sets on rustc: %j', async (name, text) => {
    const { root } = checkout({ [`.cargo/${name}`]: text });
    expect(await checkoutProblem('rust', root)).toBe(
      `The checkout’s .cargo/${name} has an [env] table, which cargo sets on the rustc it runs, so Lo won’t run rust-analyzer on it.`,
    );
  });

  test.each([
    ['an [unstable] table', '[unstable]\nbuild-std = ["core"]\n', UNSTABLE],
    ['an unstable key', 'unstable.config-include = true\n', UNSTABLE],
    ['an include', 'include = "more.toml"\n', INCLUDE],
    ['an include of a file outside', 'include = ["../../outside.toml"]\n', INCLUDE],
    ['TOML that doesn’t parse', '[build\nrustc = "x"\n', 'isn’t TOML Lo can read'],
  ])('a .cargo/config.toml with %s', async (_, text, why) => {
    const { root } = checkout({ '.cargo/config.toml': text });
    expect(await checkoutProblem('rust', root)).toBe(
      `The checkout’s .cargo/config.toml ${why}, so Lo won’t run rust-analyzer on it.`,
    );
  });

  test('a .cargo/config.toml that’s a link, which cargo follows', async () => {
    const { root } = checkout({ 'real.toml': '[env]\nFOO = "bar"\n' });
    mkdirSync(join(root, '.cargo'));
    symlinkSync('../real.toml', join(root, '.cargo', 'config.toml'));
    expect(await checkoutProblem('rust', root)).toBe(
      'The checkout’s .cargo/config.toml isn’t a plain file, so Lo won’t run rust-analyzer on it.',
    );
  });

  test('a .cargo that’s a link to a folder whose config Lo wouldn’t see', async () => {
    const { root } = checkout({ 'elsewhere/config.toml': '[env]\nFOO = "bar"\n' });
    symlinkSync('elsewhere', join(root, '.cargo'));
    expect(await checkoutProblem('rust', root)).toBe(
      'The checkout’s .cargo isn’t a plain folder, so Lo won’t run rust-analyzer on it.',
    );
  });

  test('nor looks for one through a link to a folder, which may lead anywhere', async () => {
    const { root, above } = checkout({});
    mkdirSync(join(above, 'elsewhere'));
    writeFileSync(join(above, 'elsewhere', 'rust-analyzer.toml'), '[cargo]\nextraEnv = {}\n');
    symlinkSync(join(above, 'elsewhere'), join(root, 'elsewhere'));
    symlinkSync('/', join(root, 'disk'));
    expect(await checkoutProblem('rust', root)).toBeUndefined();
  });

  test('a .cargo/config.toml above the checkout, which cargo reads too', async () => {
    const { root, above } = checkout({});
    mkdirSync(join(above, '.cargo'), { recursive: true });
    writeFileSync(join(above, '.cargo', 'config.toml'), '[build]\ntarget = "x"\n');
    expect(await checkoutProblem('rust', root)).toBe(
      `${join(above, '.cargo', 'config.toml')} is a Cargo config above the checkout, which cargo reads, so Lo won’t run rust-analyzer on this checkout.`,
    );
  });

  test.each([
    ['a link, as a dotfile manager makes', 'link'],
    ['a folder', 'folder'],
  ])('a Cargo config above the checkout that’s %s', async (_, kind) => {
    const { root, above } = checkout({});
    mkdirSync(join(above, '.cargo'), { recursive: true });
    const file = join(above, '.cargo', 'config.toml');
    if (kind === 'link') {
      writeFileSync(join(above, 'dotfiles.toml'), '[build]\ntarget = "x"\n');
      symlinkSync('../dotfiles.toml', file);
    } else {
      mkdirSync(file);
    }
    expect(await checkoutProblem('rust', root)).toBe(
      `${file} is a Cargo config above the checkout, which cargo reads, so Lo won’t run rust-analyzer on this checkout.`,
    );
  });

  test('but runs on one whose Cargo config holds only keys Lo’s variables answer', async () => {
    const { root } = checkout({
      // `rustflags`, the build's and a target's, which `CARGO_ENCODED_RUSTFLAGS` answers, and
      // `rustdocflags`, which `CARGO_ENCODED_RUSTDOCFLAGS` does.
      '.cargo/config.toml':
        '# a project config\n[build]\nrustc-wrapper = "./wrap.sh"\ntarget = "wasm32-unknown-unknown"\nrustflags = ["--cfg", "x"]\nrustdocflags = ["--cfg", "x"]\n[target.x86_64-unknown-linux-gnu]\nrustflags = ["-C", "target-cpu=native"]\n[source.crates-io]\nreplace-with = "vendored"\n[registries.other]\nindex = "sparse+https://example.invalid/"\n',
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

test('names are matched as a Mac’s disk opens them, in any case or Unicode form', () => {
  // A long s, a Kelvin sign, and an accent composed or not.
  expect(foldName('.\u017Fourcekit-lsp')).toBe('.sourcekit-lsp');
  expect(foldName('go.wor\u212A')).toBe('go.work');
  expect(foldName('BUILDSERVER.JSON')).toBe('buildserver.json');
  expect(foldName('e\u0301')).toBe(foldName('\u00E9'));
  // APFS opens both sharp s's, the small ß and the capital ẞ, as ss.
  expect(foldName('\u00DF')).toBe('ss');
  expect(foldName('\u1E9E')).toBe('ss');
  expect(foldName('STRA\u1E9EE')).toBe(foldName('strasse'));
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
    [
      'one named with a Kelvin sign, which a Mac’s disk opens',
      'go.wor\u212A',
      'use /etc\n',
      '/etc',
    ],
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

describe('a checkout with more files and folders than Lo looks through', () => {
  test.each([
    ['dotnet', 'a server that uses the .NET SDK'],
    ['go', 'a server that uses Go'],
    ['rust', 'rust-analyzer'],
  ])('is refused by %s, since what Lo didn’t look at could be anything', async (id, server) => {
    // `app`, `app/main.txt` and `notes.txt`.
    const { root } = checkout({ 'app/main.txt': '', 'notes.txt': '' });
    expect(await checkoutProblem(id, root, 3)).toBeUndefined();
    expect(await checkoutProblem(id, root, 2)).toBe(
      `The checkout has more than 2 files and folders, more than Lo looks through, so Lo won’t run ${server} on it.`,
    );
  });

  test('and the other toolchains don’t look', async () => {
    const { root } = checkout({ 'app/main.txt': '', 'notes.txt': '' });
    for (const id of ['temurin', 'node', 'python'])
      expect(await checkoutProblem(id, root, 1)).toBeUndefined();
  });
});
