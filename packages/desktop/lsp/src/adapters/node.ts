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
  /** What it gets for `workspace/configuration`, by section. */
  readonly settings?: unknown;
  readonly initializationOptions?: unknown;
  /** What it is, for its details: its name, version and license, "vtsls 0.3.0 · MIT". */
  readonly version?: string | undefined;
  /** The requests Lo never sends it, such as those its license keeps for paying users. */
  readonly never?: readonly string[] | undefined;
}

/**
 * A license the reader accepts before Lo downloads a server: what it's called, and the page that
 * has it, on its publisher's site.
 */
export interface License {
  readonly name: string;
  readonly url: string;
}

/** The license a server's pinned version has, which the reader accepts once for its major version. */
export interface Acceptance extends License {
  /** The server's entry in the manifest: `intelephense`. */
  readonly server: string;
  /** What the server is called: "Intelephense". */
  readonly serverName: string;
  /** The major version the manifest pins, which an acceptance covers. */
  readonly major: number;
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
  /** Whether it gives inlay hints, which `gh` shows. */
  readonly hints: boolean;
  /** A license the reader accepts before Lo downloads it, once for each major version. */
  readonly accept?: License | undefined;
  /**
   * Whether the messages it shows the reader reach them as it sent them, as its license asks:
   * `window/showMessage`, the questions of `window/showMessageRequest`, and the web pages
   * `window/showDocument` names, which Lo shows as links.
   */
  readonly shows?: boolean | undefined;
  /** The requests Lo never sends it, such as those its license keeps for paying users. */
  readonly never?: readonly string[] | undefined;
}

/** How `server` starts from `installed`, its install, on `node`, Lo's Node as installed. */
export function launchOnNode(
  server: NodeServer,
  node: Installed,
  installed: Installed,
  manifest: Manifest = MANIFEST,
): Launch {
  const version = labelOf(server, manifest);
  for (const path of [node.entry, installed.entry]) {
    if (!isAbsolute(path)) throw new Error(`${path} isn't an absolute path.`);
  }
  return {
    program: node.entry,
    args: [...server.node, installed.entry, ...server.args],
    settings: server.settings,
    initializationOptions: server.initializationOptions,
    version,
    never: server.never,
  };
}

/** What `server` is, as its details say: its name, pinned version and license. */
export function labelOf(server: NodeServer, manifest: Manifest = MANIFEST): string {
  return `${server.name} ${pinnedOf(server, manifest).version} · ${server.license}`;
}

function pinnedOf(server: NodeServer, manifest: Manifest) {
  const pinned = Object.hasOwn(manifest, server.id) ? manifest[server.id] : undefined;
  if (pinned === undefined) throw new Error(`Lo's list of language servers has no ${server.id}.`);
  return pinned;
}

/**
 * The license the reader accepts before Lo downloads `server`, as `manifest` pins it, with the
 * major version an acceptance covers, or nothing for a server that has none to accept.
 */
export function acceptanceOf(
  server: NodeServer,
  manifest: Manifest = MANIFEST,
): Acceptance | undefined {
  if (server.accept === undefined) return undefined;
  const pinned = pinnedOf(server, manifest);
  const major = Number(/^(\d+)\./.exec(pinned.version)?.[1]);
  if (!Number.isSafeInteger(major)) {
    throw new Error(`${server.id}'s version, ${pinned.version}, has no major version.`);
  }
  return { ...server.accept, server: server.id, serverName: server.name, major };
}

/** Node's flag that caps its heap at `megabytes`, so it collects before Lo's cap stops it. */
export function heapCap(megabytes: number): string {
  return `--max-old-space-size=${megabytes}`;
}
