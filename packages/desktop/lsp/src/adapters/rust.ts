/**
 * Rust: rust-analyzer, the Rust project's language server, a compiled program pinned from its
 * GitHub releases. It runs on Lo's own Rust toolchain ({@link toolchainUse} for `rust`): `cargo`
 * and `rustc` by their absolute paths, with the sysroot held to Lo's copy, and nothing of the
 * machine's.
 *
 * rust-analyzer reads a Cargo project with `cargo metadata`, which runs `cargo` and, through it,
 * `rustc -vV`. Lo holds every program that choice could reach to its own, and turns off everything
 * that would run a checkout's code:
 *
 * - `cargo` and `rustc` are Lo's, by `CARGO` and `RUSTC` and the toolchain's folder first on the
 *   `PATH`. `RUSTC_WRAPPER` and `RUSTC_WORKSPACE_WRAPPER` are empty, which undoes a checkout's
 *   `.cargo/config.toml` `build.rustc-wrapper`, since `cargo` reads the variable before the file
 *   and treats an empty one as no wrapper; `cargo` reads `RUSTC` before the file's `build.rustc`
 *   too. With no rustup on the `PATH` and `cargo.sysroot` set to Lo's toolchain, nothing reads a
 *   `rust-toolchain.toml`, so a checkout can't ask for another Rust.
 * - `CARGO_NET_OFFLINE=true`, and `CARGO_HOME` defaults to a private `.cargo` in the server's
 *   `HOME`, empty and no one else's. So `cargo metadata` fetches nothing: no registry, no git
 *   dependency, no `[source]` replacement over the network, no `[registries]` and no
 *   credential-provider, whatever a checkout's `.cargo/config.toml` says. For a crate whose
 *   dependencies aren't already in that `CARGO_HOME`, `cargo metadata` can't resolve them offline,
 *   and rust-analyzer falls back to loading the workspace without them (its own `--no-deps`
 *   pre-fetch): the workspace's own code is analysed in full, but go-to-definition into a
 *   dependency doesn't resolve. Lo doesn't fetch crates.
 * - Build scripts (`build.rs`) and proc-macro crates are code from the checkout, so they're off:
 *   `cargo.buildScripts.enable` and `procMacro.enable` are both `false` (rust-analyzer runs build
 *   scripts when either is on). The cost is that code a `build.rs` would generate, and the
 *   expansion of proc-macros and derive macros, aren't seen: a hover or definition that depends on
 *   a macro's output falls back to the syntax index. `cargo metadata` itself never runs a build
 *   script.
 * - The commands that would run a checkout's tools are never sent or turned off:
 *   `check.overrideCommand`, `checkOnSave`, `cargo.buildScripts.overrideCommand` and the runnables'
 *   and tests' override commands are at their safe defaults, and Lo never saves a file, so a check
 *   never runs. Diagnostics, which Lo doesn't show, are off.
 *
 * `cargo.sysroot` is Lo's toolchain root and `cargo.sysrootSrc` its bundled standard-library
 * sources (`rust-src`), so the standard library and its sources are Lo's, read offline.
 *
 * What this adapter can't answer with a setting is a workspace `rust-analyzer.toml`, whose
 * workspace-scoped keys (`cargo.buildScripts.overrideCommand`, `cargo.extraEnv`, …) win over Lo's
 * client settings and can run a program, and a `.cargo/config.toml` `[env]` table, which `cargo`
 * sets on the `rustc` it runs, whatever Lo's environment holds. {@link checkoutProblem} refuses a
 * checkout that holds either, or a `.cargo/config.toml` or `.cargo/config` in a folder above it, as
 * `@lo/lsp`'s `toolchains.ts` describes. Like every server Lo runs, rust-analyzer has no sandbox:
 * it reads what the user can, outside the checkout too (an absolute path, a sysroot's sources), and
 * Lo never opens a place outside the checkout an answer names.
 */

import { dirname, join } from 'node:path';

import type { Launch } from './node.ts';
import type { Installed } from '../install.ts';
import { MANIFEST, type Manifest } from '../manifest.ts';
import type { ToolchainUse } from '../toolchains.ts';

/** A language server that runs as a compiled program, not on Lo's Node. */
export interface NativeServer {
  /** Its entry in the manifest, `servers.json`, whose download is the program itself. */
  readonly id: string;
  /** What it's called, which labels its answers: "rust-analyzer". */
  readonly name: string;
  /** Its license, as its details and the README name it. */
  readonly license: string;
  /** Its own arguments, after the program. */
  readonly args: readonly string[];
  /** Whether it gives inlay hints, which `gh` shows. */
  readonly hints: boolean;
}

/** rust-analyzer: a program Lo downloads, run on Lo's Rust toolchain. */
export const RUST_ANALYZER: NativeServer = {
  id: 'rust-analyzer',
  name: 'rust-analyzer',
  // Dual-licensed, as the project and its releases are.
  license: 'MIT OR Apache-2.0',
  // No subcommand: rust-analyzer speaks the protocol over stdio.
  args: [],
  hints: true,
};

/**
 * What rust-analyzer is told, for the sysroot at `sysroot`, Lo's Rust toolchain. It's given both
 * in `initialize` (as `initializationOptions`) and in answer to `workspace/configuration`, so it
 * holds from the first moment. Each setting is above, in this file's comment.
 */
export function rustAnalyzerSettings(sysroot: string): Record<string, unknown> {
  return {
    cargo: {
      // The standard library and its sources are Lo's, read offline.
      sysroot,
      sysrootSrc: join(sysroot, 'lib', 'rustlib', 'src', 'rust', 'library'),
      // Build scripts are a checkout's code: off, with nothing to override them.
      buildScripts: { enable: false, overrideCommand: null, useRustcWrapper: false },
      // Nothing of the checkout's reaches cargo's or rustc's environment through rust-analyzer.
      extraEnv: {},
    },
    // Proc-macros are a checkout's code: off. This also keeps build scripts off.
    procMacro: { enable: false, attributes: { enable: false } },
    // No check runs: Lo never saves, and no command stands in for `cargo check`.
    checkOnSave: false,
    check: { overrideCommand: null },
    // Lo shows no diagnostics, and doesn't warm caches for files it never opens.
    diagnostics: { enable: false },
    cachePriming: { enable: false },
  };
}

/** A Rust toolchain Lo installed, as the desktop side hands it to the adapter. */
export interface InstalledToolchain extends ToolchainUse {
  readonly installed: Installed;
}

/**
 * How rust-analyzer `server` starts, on Lo's Rust `toolchain`: the program by its absolute path,
 * the toolchain's folder and variables, and its settings, with the sysroot held to Lo's copy. The
 * sysroot is the toolchain's root, which holds its `bin/`, its `lib/rustlib`, and `rust-src`'s
 * sources.
 */
export function launchRustAnalyzer(
  server: Installed,
  toolchain: InstalledToolchain,
  manifest: Manifest = MANIFEST,
): Launch {
  const entry = Object.hasOwn(manifest, RUST_ANALYZER.id) ? manifest[RUST_ANALYZER.id] : undefined;
  if (entry === undefined) {
    throw new Error(`Lo's list of language servers has no ${RUST_ANALYZER.id}.`);
  }
  // `<sysroot>/bin/<program>` is the toolchain's layout, so the sysroot is two folders up.
  const sysroot = dirname(dirname(toolchain.installed.entry));
  const settings = rustAnalyzerSettings(sysroot);
  return {
    program: server.entry,
    args: [...RUST_ANALYZER.args],
    path: toolchain.path,
    variables: toolchain.variables,
    allowed: toolchain.allowed,
    // The section rust-analyzer asks for, and the same object in `initialize`.
    settings: { 'rust-analyzer': settings },
    initializationOptions: settings,
    version: `${RUST_ANALYZER.name} ${entry.version} · ${RUST_ANALYZER.license}`,
  };
}
