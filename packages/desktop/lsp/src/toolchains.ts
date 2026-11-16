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
 * - .NET: `DOTNET_ROOT`, its telemetry and first-run messages off, and on Linux invariant
 *   globalization, since the system may have no ICU. It has one SDK, so a `global.json` can only
 *   pick it or fail.
 *
 * Each keeps its caches and settings in the server's own `HOME` (`CARGO_HOME`, `GOPATH`,
 * `DOTNET_CLI_HOME` and `NUGET_PACKAGES` all default to folders there), which no one else uses.
 */

import { dirname, join } from 'node:path';

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
 * What a server gets of toolchain `id`, installed at `installed`, on `platform`. It throws for an
 * ID Lo doesn't know.
 */
export function toolchainUse(
  id: string,
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
