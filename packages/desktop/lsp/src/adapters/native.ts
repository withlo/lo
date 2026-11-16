/**
 * The language servers that are programs of their own, each downloaded as the manifest pins it for
 * the platform Lo runs on. A server starts as its program, by its absolute path inside its install,
 * then its own arguments: no shell, no launcher script, and nothing from the checkout.
 *
 * As for a server on Lo's Node (`node.ts`), its environment is `serverEnvironment`'s, built from
 * nothing, and what it's told comes only from its adapter.
 */

import { isAbsolute } from 'node:path';

import type { Installed } from '../install.ts';
import { MANIFEST, type Manifest } from '../manifest.ts';
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
  /**
   * What `launchNative` tells it, static for a server launched that way. A server with its own
   * launcher, such as rust-analyzer on Lo's toolchain, computes these instead and leaves it unset.
   */
  readonly settings?: unknown;
  readonly initializationOptions?: unknown;
  /** Whether it gives inlay hints, which `gh` shows: `false` for one that answers none. */
  readonly hints: boolean;
}

/** How `server` starts from `installed`, its install. */
export function launchNative(
  server: NativeServer,
  installed: Installed,
  manifest: Manifest = MANIFEST,
): Launch {
  const pinned = Object.hasOwn(manifest, server.id) ? manifest[server.id] : undefined;
  if (pinned === undefined) throw new Error(`Lo's list of language servers has no ${server.id}.`);
  if (!isAbsolute(installed.entry)) throw new Error(`${installed.entry} isn't an absolute path.`);
  return {
    program: installed.entry,
    args: [...server.args],
    settings: server.settings,
    initializationOptions: server.initializationOptions,
    version: `${server.name} ${pinned.version} · ${server.license}`,
  };
}
