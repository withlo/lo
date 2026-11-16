// Language servers' adapters: for each server, the languages it reads, how Lo gets it and what it
// starts as. A server here is whatever an adapter describes: one pinned in `@lo/lsp`'s manifest
// and downloaded, or an installed copy from a place the adapter names. An adapter never runs
// anything itself, and nothing in a checkout chooses what it starts: what each server is told is
// `@lo/lsp`'s, with the reasons. Nothing here calls Electron.

import {
  launchOnNode,
  PYRIGHT,
  VTSLS,
  type Installed,
  type Launch,
  type NodeServer,
} from '@lo/lsp';
import { languageOfPath, type LanguageName } from '@lo/syntax';

/** What a server starts as, once Lo has it: its program and arguments, and what it's told. */
export type { Launch };

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

/** What an adapter may use to find its server, for a view the reader trusts. */
export interface PrepareContext {
  /**
   * Installs `id` as Lo's manifest pins it, unless it's installed already, and says where. Its
   * download's progress shows in the status bar.
   */
  install(id: string): Promise<Installed>;
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
   * Why its server gives no inline type hints, for one that has none: `gh` says so, and Lo never
   * asks it for them.
   */
  readonly noHints?: string | undefined;
  /** Finds or downloads what the server starts as. */
  prepare(context: PrepareContext): Promise<Prepared>;
}

/**
 * An adapter for `server`, which runs on Lo's Node: Node downloads first, then the server, each
 * once, on first use.
 */
function onNode(server: NodeServer, adapter: Omit<Adapter, 'prepare' | 'noHints'>): Adapter {
  return {
    ...adapter,
    noHints: server.hints ? undefined : `${server.name} has no type hints.`,
    async prepare(context) {
      const node = await context.install('node');
      return {
        kind: 'ready',
        launch: launchOnNode(server, node, await context.install(server.id)),
      };
    },
  };
}

/** The adapters Lo ships. */
export const ADAPTERS: readonly Adapter[] = [
  onNode(VTSLS, {
    id: 'typescript',
    name: 'TypeScript',
    languages: { typescript: 'typescript', tsx: 'typescriptreact', javascript: 'javascript' },
  }),
  onNode(PYRIGHT, { id: 'python', name: 'Python', languages: { python: 'python' } }),
];

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
