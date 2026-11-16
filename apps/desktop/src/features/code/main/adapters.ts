// Language servers' adapters: for each server, the languages it reads, how Lo gets it and what it
// starts as. A server here is whatever an adapter describes: one pinned in `@lo/lsp`'s manifest
// and downloaded, or an installed copy from a place the adapter names. An adapter never runs
// anything itself, and nothing in a checkout chooses what it starts: what each server is told is
// `@lo/lsp`'s, with the reasons. Nothing here calls Electron.

import {
  findSourceKit,
  GOPLS,
  launchNative,
  launchOnNode,
  launchRustAnalyzer,
  launchSourceKit,
  NO_SOURCEKIT,
  PHP_LSP,
  PYRIGHT,
  RUST_ANALYZER,
  SOURCEKIT_LSP,
  sourceKitCheckoutProblem,
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
      /** Whether `needs` names them, not it: "Apple’s Command Line Tools". */
      readonly plural?: boolean | undefined;
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
  /**
   * The developer folder the system has chosen on macOS, as `xcode-select -p` names it, where
   * Xcode or Apple's Command Line Tools are, or `undefined` when there's none.
   */
  developerFolder(): Promise<string | undefined>;
  /** Aborts once nothing waits for the server any longer. */
  readonly signal: AbortSignal;
}

/** What an adapter may use to find a toolchain of the system's, for Settings. */
export type FindContext = Pick<PrepareContext, 'findCopy' | 'developerFolder'>;

/**
 * A toolchain of the system's that a server comes with, which Lo doesn't download, as SourceKit-LSP
 * comes with Xcode: Settings lists it among Lo's, with where it's from, and has nothing to remove.
 */
export interface SystemToolchain {
  /** Its row's ID and name: `swift`, "Swift". */
  readonly id: string;
  readonly name: string;
  /** What it needs when there's none: "Apple’s Command Line Tools". */
  readonly needs: string;
  /** Where the copy Lo would run is from, "Xcode", or `undefined` when there's none. */
  from(context: FindContext): Promise<string | undefined>;
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
   * Why its server gives no references Lo can use, for one that finds them only from what Lo never
   * makes, such as a build's index: `gr` answers from the syntax index and says why, and Lo never
   * asks the server.
   */
  readonly noReferences?: string | undefined;
  /**
   * Why its server mustn't run on the checkout at `folder`, by what the server itself reads there,
   * or `undefined` when it may. What a toolchain it uses reads there is checked too.
   */
  readonly checkout?: ((folder: string) => Promise<string | undefined>) | undefined;
  /** The toolchain of the system's it comes with, for one Lo doesn't download. */
  readonly system?: SystemToolchain | undefined;
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
 * The Rust adapter: rust-analyzer, a compiled program Lo downloads, run on Lo's Rust toolchain.
 * Both download on first use, their progress added up from the start.
 */
const RUST: Adapter = {
  id: 'rust',
  name: 'Rust',
  languages: { rust: 'rust' },
  downloads: { servers: [RUST_ANALYZER.id], toolchains: ['rust'] },
  async prepare(context) {
    const server = await context.install(RUST_ANALYZER.id);
    const toolchain = await context.toolchain('rust');
    return { kind: 'ready', launch: launchRustAnalyzer(server, toolchain) };
  },
};

/** The SourceKit-LSP Lo would run, in the developer folder `context` finds, if there's one. */
async function sourceKitIn(context: FindContext) {
  const developer = await context.developerFolder();
  return findSourceKit(developer, (candidates) => context.findCopy(candidates));
}

/**
 * The Swift adapter, on macOS: SourceKit-LSP, which Lo doesn't download. It comes with Xcode and
 * with Apple's Command Line Tools, and Lo runs the copy in the developer folder the system has
 * chosen, told of no workspace, as `@lo/lsp`'s adapter says why. Its answers are each file's own,
 * and it finds references only from a build's index, so `gr` comes from the syntax index.
 */
const SWIFT: Adapter = {
  id: 'swift',
  name: 'Swift',
  languages: { swift: 'swift' },
  noReferences: `${SOURCEKIT_LSP.name} finds references only from a build, which Lo never runs.`,
  checkout: sourceKitCheckoutProblem,
  system: {
    id: 'swift',
    name: 'Swift',
    needs: NO_SOURCEKIT.needs,
    from: async (context) => (await sourceKitIn(context))?.from,
  },
  async prepare(context) {
    const found = await sourceKitIn(context);
    if (found === undefined) return { kind: 'missing', ...NO_SOURCEKIT, plural: true };
    return { kind: 'ready', launch: launchSourceKit(found) };
  },
};

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

/** The adapters Lo ships on `platform`: Swift's only on macOS. */
export function shippedAdapters(platform: NodeJS.Platform = process.platform): readonly Adapter[] {
  return platform === 'darwin' ? [...EVERYWHERE, SWIFT] : EVERYWHERE;
}

/** The adapters Lo ships on every platform. */
const EVERYWHERE: readonly Adapter[] = [
  onNode(VTSLS, {
    id: 'typescript',
    name: 'TypeScript',
    languages: { typescript: 'typescript', tsx: 'typescriptreact', javascript: 'javascript' },
  }),
  onNode(PYRIGHT, { id: 'python', name: 'Python', languages: { python: 'python' } }),
  RUST,
  native(PHP_LSP, { id: 'php', name: 'PHP', languages: { php: 'php' } }),
  native(GOPLS, { id: 'go', name: 'Go', languages: { go: 'go' } }, ['go']),
  native(TERRAFORM_LS, {
    id: 'terraform',
    name: 'Terraform',
    languages: { terraform: 'terraform' },
    extensions: { tfvars: 'terraform-vars' },
    referencesFromDefinition: true,
  }),
];

/** The adapters Lo ships on this platform. */
export const ADAPTERS: readonly Adapter[] = shippedAdapters();

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
