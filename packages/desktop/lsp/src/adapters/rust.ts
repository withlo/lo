/**
 * Rust: rust-analyzer, the Rust project's language server, a compiled program pinned from its
 * GitHub releases. It runs on Lo's own Rust toolchain ({@link toolchainUse} for `rust`): `cargo`
 * and `rustc` by their absolute paths, with the sysroot held to Lo's copy, and nothing of the
 * machine's.
 *
 * rust-analyzer reads a Cargo project with `cargo metadata`, which runs `cargo` and, through it,
 * `rustc -vV`, and asks `cargo rustc --print` for the target's `cfg`s and data layout, with
 * `RUSTC_BOOTSTRAP=1` and the nightly channel, so `rustc`'s and `cargo`'s unstable options are on.
 * It passes its own environment to every `cargo` and `rustc` it runs, adding only `cargo.extraEnv`,
 * which Lo leaves empty. Lo holds every program those calls could reach to its own, and turns off
 * everything that would run a checkout's code:
 *
 * - `cargo` and `rustc` are Lo's, by `CARGO` and `RUSTC` and the toolchain's folder first on the
 *   `PATH`. `RUSTC_WRAPPER` and `RUSTC_WORKSPACE_WRAPPER` are empty, which undoes a checkout's
 *   `.cargo/config.toml` `build.rustc-wrapper`, since `cargo` reads the variable before the file
 *   and treats an empty one as no wrapper; `cargo` reads `RUSTC` before the file's `build.rustc`
 *   too. With no rustup on the `PATH` and `cargo.sysroot` set to Lo's toolchain, nothing reads a
 *   `rust-toolchain.toml`, so a checkout can't ask for another Rust.
 * - `CARGO_ENCODED_RUSTFLAGS` is empty, which beats `RUSTFLAGS` and a config's `build.rustflags`
 *   and `target.*.rustflags`, so no flag of a checkout's reaches Lo's `rustc`; with unstable
 *   options on, some flags would load code into it. `CARGO_ENCODED_RUSTDOCFLAGS` is empty too, for
 *   `rustdoc`'s.
 * - `CARGO_NET_OFFLINE=true`, and `CARGO_HOME` defaults to a private `.cargo` in the server's
 *   `HOME`, empty and no one else's. So `cargo metadata` fetches nothing: no registry, no git
 *   dependency, no `[source]` replacement over the network, no `[registries]` and no
 *   credential-provider, whatever a checkout's `.cargo/config.toml` says. For a crate whose
 *   dependencies aren't already in that `CARGO_HOME`, `cargo metadata` can't resolve them offline,
 *   and rust-analyzer falls back to loading the workspace without them (its own `--no-deps`
 *   pre-fetch): the workspace's own code is analysed in full, but go-to-definition into a
 *   dependency doesn't resolve. Lo doesn't fetch crates.
 * - Nothing is written in the checkout. `cargo metadata` writes a `Cargo.lock` as it resolves a
 *   workspace that has none: beside its `Cargo.toml`, or wherever on the disk a config's
 *   `resolver.lockfile-path` names. rust-analyzer points `cargo` at a copy in its `TMPDIR` (by
 *   `CARGO_RESOLVER_LOCKFILE_PATH`) only for a workspace that has a lock file, so for the rest Lo
 *   sets `CARGO_RESOLVER_LOCKFILE_PATH` to a file in the server's home, which beats the config
 *   ({@link placeRustAnalyzer}). A lock file steers the next resolve that reads it: `cargo` keeps
 *   the versions it names, and fails when a vendored crate's checksum differs from it, loading the
 *   workspace without its dependencies. So the file is the checkout's, in a folder named by a hash
 *   of its path, and each start removes every such folder first, so no resolve starts from another
 *   pull request's lock file or an earlier start's. For the same reason rust-analyzer starts again
 *   on another checkout rather than moving there (`stays`). Workspaces without a lock file in one
 *   checkout still share that file: each resolve starts from what the last one wrote, so one
 *   workspace's versions can steer another's. With build scripts, proc-macros and checks off,
 *   nothing is built, so no `target/` is made either.
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
 * client settings and can run a program, and three keys of a `.cargo/config.toml`: an `[env]`
 * table, which `cargo` sets on the `rustc` it runs, whatever Lo's environment holds; an
 * `[unstable]` table, which `RUSTC_BOOTSTRAP=1` lets take effect; and an `include`, which reads
 * another config, one outside the checkout too. {@link checkoutProblem} refuses a checkout that
 * holds any of these, a Cargo config Lo can't read as TOML or that isn't a plain file, or anything
 * named `.cargo/config.toml` or `.cargo/config` in a folder above it, as `@lo/lsp`'s
 * `toolchains.ts` describes. Like every server Lo runs, rust-analyzer has no sandbox: it reads what
 * the user can, outside the checkout too (an absolute path, a sysroot's sources), and Lo never
 * opens a place outside the checkout an answer names.
 */

import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { NativeServer } from './native.ts';
import type { Launch } from './node.ts';
import type { Installed } from '../install.ts';
import { MANIFEST, type Manifest } from '../manifest.ts';
import type { Placed, Where } from '../place.ts';
import type { InstalledToolchain } from '../toolchains.ts';

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
    throw new Error(`Lo’s list of language servers has no ${RUST_ANALYZER.id}.`);
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
    ...(toolchain.homeFolders === undefined ? {} : { homeFolders: toolchain.homeFolders }),
    // The section rust-analyzer asks for, and the same object in `initialize`.
    settings: { 'rust-analyzer': settings },
    initializationOptions: settings,
    place: placeRustAnalyzer,
    // Its lock file is its checkout's, so it starts again on another.
    stays: true,
    version: `${RUST_ANALYZER.name} ${entry.version} · ${RUST_ANALYZER.license}`,
  };
}

/** The folder in rust-analyzer's home that holds the lock file `cargo` writes for its checkout. */
export const LOCK_FILES = 'lockfile';

/**
 * What rust-analyzer is given where it runs: `CARGO_RESOLVER_LOCKFILE_PATH`, where `cargo` writes
 * the lock file of a workspace in the checkout at `root` that has none. It's `Cargo.lock` in a
 * folder of its own in `home`, named by a hash of the checkout's path, made empty: every lock file
 * an earlier start wrote, for this checkout or another, is removed first.
 */
export async function placeRustAnalyzer({ root, home }: Where): Promise<Placed> {
  const folder = join(home, LOCK_FILES);
  // A link the server left there is removed, never followed.
  await rm(folder, { recursive: true, force: true });
  const checkout = join(folder, createHash('sha256').update(root).digest('hex').slice(0, 16));
  await mkdir(checkout, { recursive: true, mode: 0o700 });
  return { variables: { CARGO_RESOLVER_LOCKFILE_PATH: join(checkout, 'Cargo.lock') } };
}
