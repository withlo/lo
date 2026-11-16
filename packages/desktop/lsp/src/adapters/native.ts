/**
 * The language servers that are programs of their own, built for the system they run on, each
 * installed as the manifest pins it for the platform Lo runs on: php-lsp, downloaded from its
 * releases, terraform-ls, from HashiCorp's, and gopls, which Lo builds from its modules with its
 * own Go. A server starts as its program, by its absolute path inside its install, then its own
 * arguments: no shell, no launcher script, and nothing from the checkout.
 *
 * As for a server on Lo's Node (`node.ts`), its environment is `serverEnvironment`'s, built from
 * nothing, with the toolchains it uses, each as `toolchainUse` gives it (the folder of its programs
 * first on `PATH`, its variables and its caches' folders in the server's home), and the server's
 * own variables. What it's told comes only from its adapter: its settings, which answer
 * `workspace/configuration`, and its initialization options.
 */

import { isAbsolute } from 'node:path';

import type { Installed } from '../install.ts';
import { MANIFEST, type Manifest } from '../manifest.ts';
import type { ToolchainUse } from '../toolchains.ts';
import type { Launch } from './node.ts';

/** A language server that's a program of its own. */
export interface NativeServer {
  /** Its entry in the manifest, `servers.json`, whose `entry` is its program. */
  readonly id: string;
  /** What it's called: "php-lsp". */
  readonly name: string;
  /** Its license, as its details and the README name it: "MIT". */
  readonly license: string;
  readonly args: readonly string[];
  /** Its own variables, such as the soft cap on a Go program's heap. */
  readonly variables?: Readonly<Record<string, string>> | undefined;
  readonly settings: unknown;
  readonly initializationOptions?: unknown;
  /** Whether it gives inlay hints, which `gh` shows: `false` for one that answers none. */
  readonly hints: boolean;
}

/** How `server` starts from `installed`, its install, with `toolchains`, those it uses. */
export function launchNative(
  server: NativeServer,
  installed: Installed,
  toolchains: readonly ToolchainUse[] = [],
  manifest: Manifest = MANIFEST,
): Launch {
  const pinned = Object.hasOwn(manifest, server.id) ? manifest[server.id] : undefined;
  if (pinned === undefined) throw new Error(`Lo's list of language servers has no ${server.id}.`);
  if (!isAbsolute(installed.entry)) throw new Error(`${installed.entry} isn't an absolute path.`);
  const path = toolchains.flatMap((use) => use.path);
  const variables = merged([...toolchains.map((use) => use.variables), server.variables ?? {}]);
  const allowed = toolchains.flatMap((use) => use.allowed);
  const homeFolders = merged(toolchains.map((use) => use.homeFolders ?? {}));
  return {
    program: installed.entry,
    args: [...server.args],
    // Only what it has: a server with no toolchain and no variable gets nothing of its own.
    ...(path.length > 0 ? { path } : {}),
    ...(Object.keys(variables).length > 0 ? { variables } : {}),
    ...(allowed.length > 0 ? { allowed } : {}),
    ...(Object.keys(homeFolders).length > 0 ? { homeFolders } : {}),
    settings: server.settings,
    initializationOptions: server.initializationOptions,
    version: `${server.name} ${pinned.version} · ${server.license}`,
  };
}

/** `records` as one, a later one's value for a name taking an earlier one's place. */
function merged(records: readonly Readonly<Record<string, string>>[]): Record<string, string> {
  return Object.fromEntries(records.flatMap((record) => Object.entries(record)));
}

/**
 * A soft cap on a Go program's heap, for `GOMEMLIMIT`: three quarters of `cap`, the cap Lo holds
 * its group to, so Go's collector works harder as it nears the cap, before Lo stops it, and leaves
 * room for the `go` commands it runs.
 */
export function goMemoryLimit(cap: number): string {
  return `${Math.floor((cap * 0.75) / 1024 ** 2)}MiB`;
}
