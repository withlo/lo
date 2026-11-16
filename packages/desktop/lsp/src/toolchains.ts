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
 *   a checkout's `build.rustc-wrapper`, and `CARGO_NET_OFFLINE=true`. With no rustup, nothing
 *   reads `rust-toolchain.toml`.
 * - The JDK: `JAVA_HOME`.
 * - .NET: `DOTNET_ROOT`, MSBuild's SDK resolver held to Lo's SDK (`DOTNET_MSBUILD_SDK_RESOLVER_*`,
 *   and `DOTNET_HOST_PATH`), programs held to the runtime they were built for and its patches
 *   (`DOTNET_ROLL_FORWARD=LatestPatch`), its telemetry and first-run messages off, and on Linux
 *   invariant globalization, since the system may have no ICU.
 *
 * Each keeps its caches and settings in the server's own `HOME` (`CARGO_HOME`, `GOPATH`,
 * `DOTNET_CLI_HOME` and `NUGET_PACKAGES` all default to folders there), which no one else uses.
 *
 * A `global.json` is the one file in a checkout the variables can't answer: since .NET 10 its
 * `sdk.paths` names folders to look for an SDK in, the checkout's own among them, and the SDK
 * found there runs with its own runtime. The SDK's commands read the `global.json` nearest the
 * folder they run in, and MSBuild the one nearest each project, however the variables are set.
 * So a server that uses .NET runs only as `dotnet exec`, which reads none, and only on a checkout
 * {@link checkoutProblem} finds no such file in, nor in a folder above.
 */

import { lstat, open, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';

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

/** The largest `global.json` {@link checkoutProblem} reads; a larger one it refuses. */
const GLOBAL_JSON_LIMIT = 1024 * 1024;

/**
 * Why a server that uses toolchain `id` mustn't run on the checkout at `root`, or `undefined`
 * when it may. For .NET, it's a `global.json` in the checkout, or in a folder above it, that could
 * choose an SDK other than Lo's: one that names folders to look for an SDK in (`sdk.paths`), or
 * that spells a key with an escape, which hides such a name from a look at its text. The other
 * toolchains read nothing in a checkout that their variables don't answer.
 */
export async function checkoutProblem(id: string, root: string): Promise<string | undefined> {
  if (id !== 'dotnet') return undefined;
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
  if (info.size > GLOBAL_JSON_LIMIT) return 'is too large for Lo to read';
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
