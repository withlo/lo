/**
 * The toolchains language servers use: Go, Rust, a Temurin JDK and the .NET SDK. Lo downloads its
 * own copy of each, pinned in `toolchains.json` and installed as servers are, and a server uses
 * only Lo's copy, never one installed on the machine, nor a version a checkout asks for.
 *
 * What a server gets of one ({@link toolchainUse}) is the folder of its programs, first on its
 * `PATH`, and the variables that hold the toolchain to Lo's copy:
 *
 * - Go: `GOROOT`, `GOTOOLCHAIN=local`, so a `go.mod`'s `toolchain` line can't download another Go,
 *   `GOENV=off`, `GOPROXY=off` and `CGO_ENABLED=0`.
 * - Rust: `RUSTC` and `CARGO`, and empty `RUSTC_WRAPPER` and `RUSTC_WORKSPACE_WRAPPER`, which undo
 *   a checkout's `build.rustc-wrapper`, an empty `CARGO_ENCODED_RUSTFLAGS`, which undoes every
 *   config's `rustflags`, and `CARGO_NET_OFFLINE=true`. With no rustup, nothing reads
 *   `rust-toolchain.toml`.
 * - The JDK: `JAVA_HOME`.
 * - .NET: `DOTNET_ROOT`, MSBuild's SDK resolver held to Lo's SDK (`DOTNET_MSBUILD_SDK_RESOLVER_*`,
 *   and `DOTNET_HOST_PATH`), programs held to the runtime they were built for and its patches
 *   (`DOTNET_ROLL_FORWARD=LatestPatch`), its telemetry and first-run messages off, and on Linux
 *   invariant globalization, since the system may have no ICU.
 *
 * Each keeps its caches and settings in the server's own `HOME` (`CARGO_HOME`, `GOPATH`,
 * `DOTNET_CLI_HOME` and `NUGET_PACKAGES` all default to folders there), which no one else uses.
 *
 * Some files in a checkout the variables can't answer, so {@link checkoutProblem} refuses a
 * checkout that holds one, as the pool asks it to before a server starts or moves:
 *
 * - .NET: a `global.json`, in the checkout or in a folder above it, whose `sdk.paths` names folders
 *   to look for an SDK in (the checkout's own among them), or that spells a key with an escape that
 *   hides such a name. Since .NET 10 the SDK's commands and MSBuild read the `global.json` nearest
 *   where they run, however the variables are set, so a server that uses .NET runs only as
 *   `dotnet exec`, and only where no such file is found.
 * - Rust: a `rust-analyzer.toml`, whose workspace-scoped settings (`cargo.buildScripts.enable` with
 *   an `overrideCommand`, `cargo.extraEnv`, …) win over Lo's own client settings and can run a
 *   program; or a `.cargo/config.toml` (or `.cargo/config`), read as TOML, with an `[env]` table,
 *   which `cargo` sets on the `rustc` it runs for `cargo metadata`, whatever Lo's environment
 *   holds, so it can load code through the dynamic linker; with an `[unstable]` table, which
 *   takes effect since rust-analyzer runs `cargo` with `RUSTC_BOOTSTRAP=1`; or with an `include`,
 *   which reads another config, one outside the checkout too. A config that's a link, or in a
 *   `.cargo` that's one, or that isn't TOML Lo can read, is refused too. Lo's environment answers
 *   the config's other keys that reach `rustc` or the network (`build.rustc*` by
 *   `RUSTC`/`RUSTC_WRAPPER`/`RUSTC_WORKSPACE_WRAPPER`, `rustflags` by `CARGO_ENCODED_RUSTFLAGS`,
 *   the rest by `CARGO_NET_OFFLINE`), so those don't refuse the checkout. Anything named
 *   `.cargo/config.toml` or `.cargo/config` in a folder above the checkout is refused outright,
 *   since `cargo` reads it too and Lo can't vet what's outside the checkout; a
 *   `rust-analyzer.toml` above the checkout isn't, since rust-analyzer reads one only from a
 *   workspace root or under it, and its user config from `HOME`, which is Lo's.
 */

import { lstat, open, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import type { Installed } from './install.ts';

/** What Lo calls a toolchain: in a row of Settings, and in a sentence about it. */
export interface ToolchainName {
  /** "Temurin JDK". */
  readonly name: string;
  /** "the Temurin JDK", as a sentence names it. */
  readonly phrase: string;
}

/** The toolchains Lo knows, by their IDs in `toolchains.json`. */
export const TOOLCHAIN_NAMES: Readonly<Record<string, ToolchainName>> = {
  go: { name: 'Go', phrase: 'Go' },
  rust: { name: 'Rust', phrase: 'Rust' },
  temurin: { name: 'Temurin JDK', phrase: 'the Temurin JDK' },
  dotnet: { name: '.NET SDK', phrase: 'the .NET SDK' },
};

/** What a server gets of a toolchain, to add to its own: its `PATH` and its variables. */
export interface ToolchainUse {
  /** The folders of its programs, first on the server's `PATH`. */
  readonly path: readonly string[];
  readonly variables: Readonly<Record<string, string>>;
  /** The names among `variables` that choose a program, which the toolchain sets on purpose. */
  readonly allowed: readonly string[];
}

/**
 * What a server gets of toolchain `id`, `version` of it installed at `installed`, on `platform`.
 * It throws for an ID Lo doesn't know.
 */
export function toolchainUse(
  id: string,
  version: string,
  installed: Installed,
  platform: NodeJS.Platform = process.platform,
): ToolchainUse {
  // Each entry point is a program in the toolchain's own folder of them, `<root>/bin/<program>`,
  // but .NET's, which is at its root.
  const bin = dirname(installed.entry);
  const root = dirname(bin);
  switch (id) {
    case 'go':
      return {
        path: [bin],
        variables: {
          GOROOT: root,
          GOTOOLCHAIN: 'local',
          GOENV: 'off',
          GOPROXY: 'off',
          CGO_ENABLED: '0',
        },
        allowed: [],
      };
    case 'rust':
      return {
        path: [bin],
        variables: {
          RUSTC: join(bin, 'rustc'),
          CARGO: join(bin, 'cargo'),
          RUSTC_WRAPPER: '',
          RUSTC_WORKSPACE_WRAPPER: '',
          // Empty, it beats `RUSTFLAGS` and every config's `rustflags`, the build's and each
          // target's, so no flag of a checkout's reaches Lo's rustc.
          CARGO_ENCODED_RUSTFLAGS: '',
          CARGO_NET_OFFLINE: 'true',
        },
        allowed: ['RUSTC', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER'],
      };
    case 'temurin':
      return { path: [bin], variables: { JAVA_HOME: root }, allowed: [] };
    case 'dotnet':
      return {
        path: [bin],
        variables: {
          DOTNET_ROOT: bin,
          // MSBuild finds a project's SDK by these, not by a `global.json`.
          DOTNET_MSBUILD_SDK_RESOLVER_CLI_DIR: bin,
          DOTNET_MSBUILD_SDK_RESOLVER_SDKS_DIR: join(bin, 'sdk', version, 'Sdks'),
          DOTNET_MSBUILD_SDK_RESOLVER_SDKS_VER: version,
          // The `dotnet` tasks and tools run, which is otherwise the resolved SDK's.
          DOTNET_HOST_PATH: join(bin, 'dotnet'),
          DOTNET_ROLL_FORWARD: 'LatestPatch',
          DOTNET_CLI_TELEMETRY_OPTOUT: '1',
          DOTNET_NOLOGO: '1',
          DOTNET_ADD_GLOBAL_TOOLS_TO_PATH: '0',
          DOTNET_GENERATE_ASPNET_CERTIFICATE: '0',
          ...(platform === 'linux' ? { DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' } : {}),
        },
        allowed: [],
      };
    default:
      throw new Error(`Lo has no toolchain ${id}`);
  }
}

/** The largest config file {@link checkoutProblem} reads; a larger one it refuses. */
const CONFIG_LIMIT = 1024 * 1024;

/**
 * Why a server that uses toolchain `id` mustn't run on the checkout at `root`, or `undefined` when
 * it may. It's `dotnet` or `rust`, each with a file the toolchain's variables can't answer
 * ({@link dotnetProblem}, {@link rustProblem}); the other toolchains read nothing in a checkout
 * that their variables don't answer.
 */
export async function checkoutProblem(id: string, root: string): Promise<string | undefined> {
  if (id === 'dotnet') return dotnetProblem(root);
  if (id === 'rust') return rustProblem(root);
  return undefined;
}

/**
 * Why .NET mustn't run on the checkout at `root`: a `global.json` in it, or in a folder above it,
 * that could choose an SDK other than Lo's — one that names folders to look for an SDK in
 * (`sdk.paths`), or that spells a key with an escape, which hides such a name from a look at its
 * text.
 */
async function dotnetProblem(root: string): Promise<string | undefined> {
  const found: string[] = [];
  // Every folder in the checkout, since each project's own nearest file counts, and the disk may
  // not tell names apart by case.
  for (const path of await readdir(root, { recursive: true, encoding: 'utf8' })) {
    if (basename(path).toLowerCase() === 'global.json') found.push(join(root, path));
  }
  for (let folder = dirname(root); ; folder = dirname(folder)) {
    found.push(join(folder, 'global.json'));
    if (dirname(folder) === folder) break;
  }
  for (const file of found) {
    const why = await steers(file);
    if (why === undefined) continue;
    const named = file.startsWith(`${root}/`) ? `The checkout’s ${relative(root, file)}` : file;
    return `${named} ${why}, so it could choose a .NET SDK other than Lo’s.`;
  }
  return undefined;
}

/** What makes the `global.json` at `file` one Lo can't run .NET beside, if anything does. */
async function steers(file: string): Promise<string | undefined> {
  const info = await lstat(file).catch(() => undefined);
  if (info === undefined || info.isDirectory()) return undefined;
  if (!info.isFile()) return 'isn’t a plain file';
  if (info.size > CONFIG_LIMIT) return 'is too large for Lo to read';
  const handle = await open(file, 'r');
  let text: string;
  try {
    text = (await handle.readFile()).toString('latin1');
  } finally {
    await handle.close();
  }
  if (/paths/i.test(text)) return 'names folders to look for an SDK in';
  if (/\\u/i.test(text)) return 'spells a name with an escape Lo doesn’t read';
  return undefined;
}

/** Whether `name` is `.cargo/config.toml` or `.cargo/config`, the files `cargo metadata` reads. */
function isCargoConfig(path: string): boolean {
  const base = basename(path).toLowerCase();
  return (
    (base === 'config.toml' || base === 'config') &&
    basename(dirname(path)).toLowerCase() === '.cargo'
  );
}

/**
 * Why rust-analyzer mustn't run on the checkout at `root`: a `rust-analyzer.toml` anywhere in it,
 * whose workspace settings win over Lo's and can run a program; a `.cargo` in it that's a link; a
 * `.cargo/config.toml` (or `.cargo/config`) in it that {@link cargoConfigProblem} refuses; or
 * anything at all named `.cargo/config.toml` or `.cargo/config` in a folder above it, which `cargo`
 * reads, following a link, and Lo can't vet.
 */
async function rustProblem(root: string): Promise<string | undefined> {
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    const path = relative(root, join(entry.parentPath, entry.name));
    const name = entry.name.toLowerCase();
    if (name === 'rust-analyzer.toml') {
      return refused(
        path,
        'is a rust-analyzer.toml, whose settings win over Lo’s and could run a program',
      );
    }
    // A link cargo follows to a folder whose config this walk would never see by that name.
    if (name === '.cargo' && !entry.isDirectory()) {
      return refused(path, 'isn’t a plain folder, which Lo can’t vet');
    }
    if (isCargoConfig(path)) {
      const why = await cargoConfigProblem(join(root, path));
      if (why !== undefined) return refused(path, why);
    }
  }
  for (let folder = dirname(root); ; folder = dirname(folder)) {
    for (const name of ['config.toml', 'config']) {
      const file = join(folder, '.cargo', name);
      // Anything there, a link to a dotfile or a file Lo can't read included.
      if ((await lstat(file).catch(() => undefined)) !== undefined) {
        return `${file} is a Cargo config above the checkout, which cargo reads, so Lo won’t run rust-analyzer on this checkout.`;
      }
    }
    if (dirname(folder) === folder) break;
  }
  return undefined;
}

/** What Lo says of the checkout's `path`, for `why` it won't run rust-analyzer there. */
function refused(path: string, why: string): string {
  return `The checkout’s ${path} ${why}, so Lo won’t run rust-analyzer on it.`;
}

/**
 * What makes the Cargo config at `file` in a checkout one Lo can't run rust-analyzer beside, if
 * anything does: that it isn't a plain file (a link, which cargo follows), is too large, or isn't
 * TOML Lo can read; or that it has a key Lo's variables can't answer. It's read as TOML, so a key
 * quoted or spelled with an escape is the key cargo reads.
 */
async function cargoConfigProblem(file: string): Promise<string | undefined> {
  const info = await lstat(file).catch(() => undefined);
  // A folder by that name is no config: cargo can't read one.
  if (info === undefined || info.isDirectory()) return undefined;
  if (!info.isFile()) return 'isn’t a plain file, which Lo can’t vet';
  if (info.size > CONFIG_LIMIT) return 'is too large for Lo to read';
  let config: Record<string, unknown>;
  try {
    const handle = await open(file, 'r');
    try {
      config = parseToml(new TextDecoder('utf-8', { fatal: true }).decode(await handle.readFile()));
    } finally {
      await handle.close();
    }
  } catch {
    return 'isn’t TOML Lo can read';
  }
  if (Object.hasOwn(config, 'env')) {
    return 'has an [env] table, which cargo sets on the rustc it runs';
  }
  // rust-analyzer runs cargo with `RUSTC_BOOTSTRAP=1`, so these features would take effect.
  if (Object.hasOwn(config, 'unstable')) {
    return 'has an [unstable] table, which turns on cargo’s unstable features';
  }
  if (Object.hasOwn(config, 'include')) {
    return 'includes another config, which can be outside the checkout';
  }
  return undefined;
}
