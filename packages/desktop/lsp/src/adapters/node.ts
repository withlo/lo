/**
 * The language servers that run on Lo's own Node, `node` in the manifest, each downloaded from npm
 * as the manifest pins it. A server starts as Node, by its absolute path, with Node's flags, then
 * the server's own entry point by its absolute path inside its install, never the launcher script
 * npm would link, then the server's arguments: no shell, and nothing from the checkout.
 *
 * Each server's environment is `serverEnvironment`'s, built from nothing, with no variables of its
 * own: Node loads the server's modules from its install, found from its entry point, never from
 * the checkout it runs in or a `NODE_PATH`.
 *
 * What a server is told comes only from its adapter: its settings, which answer
 * `workspace/configuration`, and its initialization options. None names a file of the checkout,
 * and each setting that would let the checkout choose a program, such as a workspace's TypeScript,
 * is set so it can't.
 */

import { isAbsolute } from 'node:path';

import type { Installed } from '../install.ts';
import { MANIFEST, type Manifest } from '../manifest.ts';
import type { Place } from '../place.ts';
import type { Workspace, WorkspacePaths } from '../server.ts';

/** How a server Lo has installed starts, and what it's told. */
export interface Launch {
  /** The server's program, by absolute path: a compiled program, never a launcher script. */
  readonly program: string;
  readonly args: readonly string[];
  /** The folders of the toolchain it needs, on its `PATH` before the system's. */
  readonly path?: readonly string[] | undefined;
  /** Its own variables, such as `GOPROXY=off`. */
  readonly variables?: Readonly<Record<string, string>> | undefined;
  /** The names among `variables` that load code or configure a program, set on purpose. */
  readonly allowed?: readonly string[] | undefined;
  /** Variables naming folders and files in its home, by their paths there, such as Go's caches. */
  readonly homeFolders?: Readonly<Record<string, string>> | undefined;
  /** What it gets for `workspace/configuration`, by section. */
  readonly settings?: unknown;
  readonly initializationOptions?: unknown;
  /** What it's given that depends on its checkout and its home, as Java's server needs. */
  readonly place?: Place | undefined;
  /** Whether it starts again to go to another checkout, rather than moving there. */
  readonly stays?: boolean | undefined;
  /** Whether it's told of no workspace, only of the files Lo opens, as SourceKit-LSP is. */
  readonly rootless?: boolean | undefined;
  /**
   * The programs the system starts for it, outside its family, by their file names, which Lo
   * counts and stops with it when their `HOME` is its home: SourceKit-LSP's `SourceKitService`.
   */
  readonly services?: readonly string[] | undefined;
  /** What it is, for its details: its name, version and license, "vtsls 0.3.0 · MIT". */
  readonly version?: string | undefined;
  /** The workspace Lo makes for it in its home, in place of the checkout, if it needs one. */
  readonly workspace?: ((paths: WorkspacePaths) => Promise<Workspace>) | undefined;
}

/** A language server that runs on Lo's Node. */
export interface NodeServer {
  /** Its entry in the manifest, `servers.json`, whose `entry` is its own entry point. */
  readonly id: string;
  /** What it's called: "vtsls". */
  readonly name: string;
  /** Its license, as its details and the README name it: "MIT". */
  readonly license: string;
  /** Node's flags, before the entry point, such as the cap on its heap. */
  readonly node: readonly string[];
  /** Its own arguments, after the entry point. */
  readonly args: readonly string[];
  readonly settings: unknown;
  readonly initializationOptions?: unknown;
  /** Whether it gives inlay hints, which `gh` shows: `false` for one that answers none. */
  readonly hints: boolean;
}

/** How `server` starts from `installed`, its install, on `node`, Lo's Node as installed. */
export function launchOnNode(
  server: NodeServer,
  node: Installed,
  installed: Installed,
  manifest: Manifest = MANIFEST,
): Launch {
  const pinned = Object.hasOwn(manifest, server.id) ? manifest[server.id] : undefined;
  if (pinned === undefined) throw new Error(`Lo's list of language servers has no ${server.id}.`);
  for (const path of [node.entry, installed.entry]) {
    if (!isAbsolute(path)) throw new Error(`${path} isn't an absolute path.`);
  }
  return {
    program: node.entry,
    args: [...server.node, installed.entry, ...server.args],
    settings: server.settings,
    initializationOptions: server.initializationOptions,
    version: `${server.name} ${pinned.version} · ${server.license}`,
  };
}

/** Node's flag that caps its heap at `megabytes`, so it collects before Lo's cap stops it. */
export function heapCap(megabytes: number): string {
  return `--max-old-space-size=${megabytes}`;
}
