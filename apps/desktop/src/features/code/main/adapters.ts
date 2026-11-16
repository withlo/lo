// Language servers' adapters: for each server, the languages it reads, how Lo gets it and what it
// starts as. A server here is whatever an adapter describes: one pinned in `@lo/lsp`'s manifest
// and downloaded, or an installed copy from a place the adapter names. An adapter never runs
// anything itself, and nothing in a checkout chooses what it starts. Nothing here calls Electron.

import type { Installed, ToolchainUse } from '@lo/lsp';
import { languageOfPath, type LanguageName } from '@lo/syntax';

/** What a server starts as, once Lo has it. */
export interface Launch {
  /** The server's own program, by absolute path: a compiled program, never a launcher script. */
  readonly program: string;
  readonly args: readonly string[];
  /** The folders of the toolchain it needs, first on its `PATH`, before Lo's git and the system's. */
  readonly path?: readonly string[] | undefined;
  /** Its own variables, such as `GOPROXY=off`. */
  readonly variables?: Readonly<Record<string, string>> | undefined;
  /** The names among `variables` that load code or configure a program, set on purpose. */
  readonly allowed?: readonly string[] | undefined;
  /** What it gets for `workspace/configuration`. */
  readonly settings?: unknown;
  readonly initializationOptions?: unknown;
  /** What it is, for its details: "vtsls 0.2.9". */
  readonly version?: string | undefined;
}

/** What an adapter found: how the server starts, or the toolchain it needs that isn't installed. */
export type Prepared =
  | { readonly kind: 'ready'; readonly launch: Launch }
  | {
      readonly kind: 'missing';
      /** What it needs: "Go 1.24 or later". */
      readonly needs: string;
      /** A command that installs it, when there's one: `brew install go`. */
      readonly install?: string | undefined;
    };

/**
 * A toolchain Lo installed for a server: where, and what the server gets of it, to add to its
 * `Launch`: its folder of programs, first on the server's `PATH`, and its variables.
 */
export interface Toolchain extends ToolchainUse {
  readonly installed: Installed;
}

/** What an adapter may use to find its server, for a view the reader trusts. */
export interface PrepareContext {
  /**
   * Installs `id` as Lo's manifest pins it, unless it's installed already, and says where. Its
   * download's progress shows in the status bar.
   */
  install(id: string): Promise<Installed>;
  /**
   * Installs toolchain `id` as `toolchains.json` pins it, unless it's installed already, and says
   * what the server gets of it. Its download's progress shows with the server's, and a failure
   * names it. A server uses only Lo's toolchains, never the machine's.
   */
  toolchain(id: string): Promise<Toolchain>;
  /** The first of `candidates` that may run as a server, by its real path: an installed copy. */
  findCopy(candidates: readonly string[]): Promise<string | undefined>;
  /** Aborts once nothing waits for the server any longer. */
  readonly signal: AbortSignal;
}

export interface Adapter {
  /** Its own id, which the window names it by: `typescript`. */
  readonly id: string;
  /** What the reader calls it, which labels its answers: "TypeScript". */
  readonly name: string;
  /** The languages it reads, each with the id the protocol names it by, such as `typescriptreact`. */
  readonly languages: Readonly<Partial<Record<LanguageName, string>>>;
  /** How long `gd` waits for it, for a server slower than most to answer, such as a JVM's. */
  readonly definitionDeadline?: number | undefined;
  /**
   * What it downloads, by ID, named up front so its progress adds them all up from the start
   * ("Java downloading · 40 of 186 MB"): servers and Node from the manifest, and toolchains, which
   * Settings lists it as using.
   */
  readonly downloads?:
    { readonly servers?: readonly string[]; readonly toolchains?: readonly string[] } | undefined;
  /** Finds or downloads what the server starts as. */
  prepare(context: PrepareContext): Promise<Prepared>;
}

/** The adapters Lo ships. */
export const ADAPTERS: readonly Adapter[] = [];

/** The adapter that reads the file at `path`, and the protocol's id for its language, if one does. */
export function adapterFor(
  adapters: readonly Adapter[],
  path: string,
): { readonly adapter: Adapter; readonly languageId: string } | undefined {
  const language = languageOfPath(path);
  if (language === undefined) return undefined;
  for (const adapter of adapters) {
    const languageId = adapter.languages[language];
    if (languageId !== undefined) return { adapter, languageId };
  }
  return undefined;
}
