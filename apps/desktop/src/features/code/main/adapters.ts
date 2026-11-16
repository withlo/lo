// Language servers' adapters: for each server, the languages it reads, how Lo gets it and what it
// starts as. A server here is whatever an adapter describes: one pinned in `@lo/lsp`'s manifest
// and downloaded, or an installed copy from a place the adapter names. An adapter never runs
// anything itself, and nothing in a checkout chooses what it starts: what each server is told is
// `@lo/lsp`'s, with the reasons. Nothing here calls Electron.

import {
  GOPLS,
  JDTLS,
  jdtlsCheckoutProblem,
  launchJdtls,
  launchNative,
  launchOnNode,
  PHP_LSP,
  PYRIGHT,
  TERRAFORM_LS,
  VTSLS,
  type Installed,
  type Launch,
  type NativeServer,
  type NodeServer,
  type ToolchainUse,
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

/**
 * A toolchain Lo installed for a server: where, and what the server gets of it, to add to its
 * `Launch`: its folder of programs, first on the server's `PATH`, and its variables.
 */
export interface Toolchain extends ToolchainUse {
  /** The version installed, as `toolchains.json` pins it. */
  readonly version: string;
  readonly installed: Installed;
}

/** What an adapter may use to find its server, for a view the reader trusts. */
export interface PrepareContext {
  /**
   * Installs `id` as Lo's manifest pins it, unless it's installed already, and says where. Its
   * download's progress shows in the status bar. A server Lo builds from its Go modules, as it
   * does gopls, is built with `go`, Lo's Go.
   */
  install(id: string, options?: { readonly go?: Toolchain | undefined }): Promise<Installed>;
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
  /**
   * The protocol's ids for files of its languages with these extensions, which its server reads
   * as another kind of file: Terraform's variables, `.tfvars`, are `terraform-vars`.
   */
  readonly extensions?: Readonly<Record<string, string>> | undefined;
  /** How long `gd` waits for it, for a server slower than most to answer, such as a JVM's. */
  readonly definitionDeadline?: number | undefined;
  /**
   * Whether its server finds references only from a declaration, as terraform-ls does, so that
   * asked at a use it finds none: when it finds none where the reader is, `gr` asks it for the
   * definition, then for the references there.
   */
  readonly referencesFromDefinition?: boolean | undefined;
  /**
   * What it downloads, by ID, named up front so its progress adds them all up from the start
   * ("Java downloading · 38.1 MB of 177.4 MB"): servers and Node from the manifest, and
   * toolchains, which Settings lists it as using and it may install alone.
   */
  readonly downloads?:
    { readonly servers?: readonly string[]; readonly toolchains?: readonly string[] } | undefined;
  /**
   * Why its server gives no inline type hints, for one that has none: `gh` says so, and Lo never
   * asks it for them.
   */
  readonly noHints?: string | undefined;
  /**
   * Why its server mustn't run on the checkout at `folder`, by what it alone reads there, such as
   * the `.settings` at a checkout's root that Java's server would take as its own, or `undefined`
   * when it may. What the toolchains it uses read there is asked besides.
   */
  readonly checkout?: ((folder: string) => Promise<string | undefined>) | undefined;
  /** Finds or downloads what the server starts as. */
  prepare(context: PrepareContext): Promise<Prepared>;
}

/**
 * An adapter for `server`, which runs on Lo's Node: Node downloads first, then the server, each
 * once, on first use.
 */
function onNode(
  server: NodeServer,
  adapter: Omit<Adapter, 'prepare' | 'noHints' | 'downloads'>,
): Adapter {
  return {
    ...adapter,
    noHints: server.hints ? undefined : `${server.name} has no type hints.`,
    // Node and the server, and no toolchain: it runs on Node alone.
    downloads: { servers: ['node', server.id], toolchains: [] },
    async prepare(context) {
      const node = await context.install('node');
      return {
        kind: 'ready',
        launch: launchOnNode(server, node, await context.install(server.id)),
      };
    },
  };
}

/**
 * An adapter for `server`, a program of its own, which uses the toolchains `toolchains` names:
 * each downloads first, then the server, which Lo builds with its Go when it's built from Go
 * modules, as gopls is.
 */
function native(
  server: NativeServer,
  adapter: Omit<Adapter, 'prepare' | 'noHints' | 'downloads'>,
  toolchains: readonly string[] = [],
): Adapter {
  return {
    ...adapter,
    noHints: server.hints ? undefined : `${server.name} has no type hints.`,
    downloads: { servers: [server.id], toolchains },
    async prepare(context) {
      const used = new Map<string, Toolchain>();
      for (const id of toolchains) used.set(id, await context.toolchain(id));
      const installed = await context.install(server.id, { go: used.get('go') });
      return { kind: 'ready', launch: launchNative(server, installed, [...used.values()]) };
    },
  };
}

/**
 * The adapter for Java's server, JDT LS, which runs on Lo's Temurin JDK: the JDK downloads first,
 * then the server, each once, on first use. It doesn't start on a checkout whose root holds a
 * `.settings`, which it would take as its project's own.
 */
function onJdk(adapter: Omit<Adapter, 'prepare' | 'noHints' | 'downloads' | 'checkout'>): Adapter {
  return {
    ...adapter,
    // The JDK it runs on, and the server.
    downloads: { servers: [JDTLS.id], toolchains: ['temurin'] },
    checkout: jdtlsCheckoutProblem,
    async prepare(context) {
      const jdk = await context.toolchain('temurin');
      const installed = await context.install(JDTLS.id);
      return { kind: 'ready', launch: launchJdtls(installed, jdk.installed, jdk) };
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
  native(PHP_LSP, { id: 'php', name: 'PHP', languages: { php: 'php' } }),
  native(GOPLS, { id: 'go', name: 'Go', languages: { go: 'go' } }, ['go']),
  native(TERRAFORM_LS, {
    id: 'terraform',
    name: 'Terraform',
    languages: { terraform: 'terraform' },
    extensions: { tfvars: 'terraform-vars' },
    referencesFromDefinition: true,
  }),
  // A JVM answers its first definitions slower than most, while it compiles its own code.
  onJdk({ id: 'java', name: 'Java', languages: { java: 'java' }, definitionDeadline: 5000 }),
];

/** The adapter that reads the file at `path`, and the protocol's id for its language, if one does. */
export function adapterFor(
  adapters: readonly Adapter[],
  path: string,
): { readonly adapter: Adapter; readonly languageId: string } | undefined {
  const language = languageOfPath(path);
  if (language === undefined) return undefined;
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase();
  for (const adapter of adapters) {
    const languageId = adapter.languages[language];
    if (languageId === undefined) continue;
    const byExtension =
      extension !== undefined &&
      adapter.extensions !== undefined &&
      Object.hasOwn(adapter.extensions, extension)
        ? adapter.extensions[extension]
        : undefined;
    return { adapter, languageId: byExtension ?? languageId };
  }
  return undefined;
}
