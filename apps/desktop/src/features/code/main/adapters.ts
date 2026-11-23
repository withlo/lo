// Language servers' adapters: for each server, the languages it reads, how Lo gets it and what it
// starts as. A server here is whatever an adapter describes: one pinned in `@lo/lsp`'s manifest
// and downloaded, or an installed copy from a place the adapter names. An adapter never runs
// anything itself, and nothing in a checkout chooses what it starts: what each server is told is
// `@lo/lsp`'s, with the reasons. Nothing here calls Electron. Swift's differs by system: on macOS
// it's the SourceKit-LSP of Xcode or Apple's Command Line Tools, and on Linux the one in the Swift
// toolchain Lo downloads for the distribution, by `/etc/os-release`.

import {
  currentPlatform,
  developerFolder,
  findSourceKit,
  GOPLS,
  JDTLS,
  jdtlsCheckoutProblem,
  launchJdtls,
  launchNative,
  launchOnNode,
  launchRoslyn,
  launchRustAnalyzer,
  launchSourceKit,
  launchSourceKitOnLinux,
  missingPackages,
  NO_SOURCEKIT,
  packagesNeeded,
  PHP_LSP,
  PYRIGHT,
  ROSLYN,
  readOsRelease,
  RUST_ANALYZER,
  SOURCEKIT_LSP,
  sourceKitCheckoutProblem,
  swiftDistroFor,
  swiftToolchainId,
  TERRAFORM_LS,
  VTSLS,
  type Installed,
  type Launch,
  type NativeServer,
  type NodeServer,
  type SwiftDistro,
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
      /** What it needs: "Go 1.24 or newer". */
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
  /**
   * Those of the packages Swift's toolchain needs on Linux distribution `distro` that aren't
   * installed: those swift.org lists for it, in its order, and any the system's release needs
   * besides.
   */
  missingPackages(distro: SwiftDistro): Promise<readonly string[]>;
  /** Aborts once nothing waits for the server any longer. */
  readonly signal: AbortSignal;
}

/**
 * An adapter's {@link PrepareContext}: `parts`, from what Lo has, with what it finds on the system
 * itself, the developer folder `xcode-select -p` names and the packages Swift needs that aren't
 * installed.
 */
export function prepareContext(
  parts: Omit<PrepareContext, 'developerFolder' | 'missingPackages'>,
): PrepareContext {
  return { ...parts, developerFolder, missingPackages };
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
   * Why its server mustn't run on the checkout at `folder`, by what it alone reads there, such as
   * the `.settings` at a checkout's root that Java's server would take as its own, or `undefined`
   * when it may. It's the reason alone: the status says first that Lo won't run the server. What
   * the toolchains it uses read there is asked besides.
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
    noHints: server.hints ? undefined : `${server.name} has no type hints`,
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
  noReferences: `${SOURCEKIT_LSP.name} needs a build to find references`,
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
 * The Swift adapter, on Linux distribution `distro`: the SourceKit-LSP in the Swift toolchain Lo
 * downloads for it, from swift.org, which it runs told of no workspace, as on macOS. The toolchain
 * needs some of the distribution's packages, so when any is missing it says which, and the command
 * that installs them, and downloads nothing.
 */
function swiftOnLinux(distro: SwiftDistro): Adapter {
  const toolchain = swiftToolchainId(distro);
  return {
    id: 'swift',
    name: 'Swift',
    languages: { swift: 'swift' },
    noReferences: `${SOURCEKIT_LSP.name} needs a build to find references`,
    checkout: sourceKitCheckoutProblem,
    // The server comes in the toolchain.
    downloads: { servers: [], toolchains: [toolchain] },
    async prepare(context) {
      const missing = await context.missingPackages(distro);
      if (missing.length > 0) return { kind: 'missing', ...packagesNeeded(distro, missing) };
      const swift = await context.toolchain(toolchain);
      return { kind: 'ready', launch: launchSourceKitOnLinux(swift, swift.version) };
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
    noHints: server.hints ? undefined : `${server.name} has no type hints`,
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

/**
 * The adapter for C#: Roslyn's server, which downloads once, on first use, with the .NET SDK it
 * runs on. It loads the project Lo writes for the checkout in its home, never one of the checkout's
 * (`@lo/lsp`'s `roslyn.ts` says why).
 */
const CSHARP: Adapter = {
  id: 'csharp',
  name: 'C#',
  languages: { csharp: 'csharp' },
  // A first definition waits on the project's first load.
  definitionDeadline: 5000,
  downloads: { servers: [ROSLYN.id], toolchains: ['dotnet'] },
  async prepare(context) {
    const dotnet = await context.toolchain('dotnet');
    return { kind: 'ready', launch: launchRoslyn(await context.install(ROSLYN.id), dotnet) };
  },
};

/**
 * The adapters Lo ships on `platform`: Swift's on macOS, and on Linux when `distro`, the
 * distribution of swift.org's builds the system takes, is given.
 */
export function shippedAdapters(
  platform: NodeJS.Platform,
  distro?: SwiftDistro,
): readonly Adapter[] {
  if (platform === 'darwin') return [...EVERYWHERE, SWIFT];
  if (platform === 'linux' && distro !== undefined) return [...EVERYWHERE, swiftOnLinux(distro)];
  return EVERYWHERE;
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
  // A JVM answers its first definitions slower than most, while it compiles its own code.
  onJdk({ id: 'java', name: 'Java', languages: { java: 'java' }, definitionDeadline: 5000 }),
  CSHARP,
];

/**
 * The Linux distribution whose build of Swift this system takes, by its `/etc/os-release`, if it's
 * a Linux Lo downloads for and one fits.
 */
export const SWIFT_DISTRO: SwiftDistro | undefined = currentPlatform()?.startsWith('linux-')
  ? swiftDistroFor(readOsRelease())
  : undefined;

/** The adapters Lo ships on this platform. */
export const ADAPTERS: readonly Adapter[] = shippedAdapters(process.platform, SWIFT_DISTRO);

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
