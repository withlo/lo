/**
 * Swift, on macOS: SourceKit-LSP, Apple's language server for Swift, which comes with Xcode and
 * with Apple's Command Line Tools. Lo downloads no Swift there: it runs the copy in the developer
 * folder the system has chosen, the one `/usr/bin/xcode-select -p` names when it's run with nothing
 * of Lo's environment ({@link developerFolder}): Xcode's,
 * `<folder>/Toolchains/XcodeDefault.xctoolchain/usr/bin/sourcekit-lsp`, or the Command Line Tools',
 * `<folder>/usr/bin/sourcekit-lsp`. Never the one in `/usr/bin`, which is `xcrun`'s shim, nor one
 * on `PATH`, nor `xcrun --find`: each of those reads `DEVELOPER_DIR`, `TOOLCHAINS` and the like from
 * the environment, and a version manager's shim reads the checkout's `.swift-version`. The copy is
 * held to the rules of `copies.ts`, and is Apple's, updated with Xcode or the tools, so Lo pins no
 * version of it.
 *
 * On Linux, SourceKit-LSP comes in Swift's toolchain, which Lo downloads there from swift.org
 * (`swift.ts`), and it's started as it is on macOS, told of no workspace, for the same reasons.
 * {@link launchSourceKitOnLinux}, below, says where it differs; the rest of this is macOS's.
 *
 * SourceKit-LSP takes the rest of its toolchain (the Swift compiler and `sourcekitd`) from the
 * folder it's installed in, and Lo gives it no `SOURCEKIT_TOOLCHAIN_PATH` to say otherwise.
 *
 * Given a workspace, SourceKit-LSP runs what its build files name: a build server that
 * `buildServer.json` or `.bsp/` names, which is a program; a `Package.swift`, which SwiftPM compiles
 * and runs, with its plugins, and whose dependencies it fetches, as background indexing builds the
 * package; and a `compile_commands.json`'s flags, which load code into the compiler (Swift's
 * `-load-plugin-executable`, clang's `-Xclang -load` and `-fplugin`). It reads its settings from
 * the workspace's `.sourcekit-lsp/config.json`, which can turn these on and put its files in the
 * checkout. No option turns that off, so Lo tells it of no workspace at all (the server is
 * rootless: `rootUri` and `workspaceFolders` are `null`), and it runs in its home, not the
 * checkout. With no workspace it opens no build files, reads no workspace settings, and looks for
 * no build files beside the files Lo opens. Each file gets its fallback build settings: the macOS
 * SDK, Lo's flags ({@link sourceKitOptions}) and the file. So nothing of the checkout chooses a
 * program it runs, or a flag of the compiler's.
 *
 * Lo refuses a checkout that holds a `buildServer.json`, a `.bsp` or a `.sourcekit-lsp` anywhere in
 * it ({@link sourceKitCheckoutProblem}), though this SourceKit-LSP reads none of them without a
 * workspace: Apple updates it, so a later one that looked for them beside a file it opened still
 * finds none. It never looks for them in a folder above the checkout, so Lo doesn't either. A
 * `Package.swift` and a `compile_commands.json` are common, and what keeps them out is that there's
 * no workspace, so those aren't refused.
 *
 * Everything it writes is in its home: its generated interfaces where `generatedFilesPath` says and
 * its compiler's module cache where `-module-cache-path` does, since neither follows `HOME` or
 * `TMPDIR`. Lo names both in its options and again in its arguments
 * ({@link sourceKitArguments}), which hold if it drops its options. It logs to the system's log, as
 * Apple's programs do. It needs no network.
 *
 * It reads its own settings, besides what Lo tells it, from `.sourcekit-lsp/config.json` and
 * `Library/Application Support/org.swift.sourcekit-lsp/config.json` in the home folder Apple's
 * Foundation gives it, which on macOS is the user's own unless `CFFIXED_USER_HOME` names another,
 * so that names its home, where there are none; and from the machine's
 * `/Library/Application Support/org.swift.sourcekit-lsp/config.json` (and the same in the network's
 * and the system's `Library`), which only root can write. No option of SourceKit-LSP's turns that
 * off, so the machine's settings, if there are any, are the administrator's; what Lo tells it wins
 * over them key by key ({@link sourceKitOptions}). Nothing of the checkout reaches them.
 *
 * What still reaches it, as Lo can't hold it otherwise:
 *
 * - The answers are a file's own, and the SDK's: with no build, the compiler sees each file alone,
 *   with the SDK, so `gd`, `K` and `gh` answer within the file and into the SDK, and a use of what
 *   another file declares isn't resolved. `gr` needs an index, which only a build makes, so Lo
 *   answers it from the syntax index. A module only iOS has, such as UIKit, isn't in the macOS SDK.
 * - `sourcekitd` runs as `SourceKitService`, an XPC service `launchd` starts for it, outside its
 *   family. It takes the server's environment, so its `HOME` is the server's home, which Swift's
 *   servers on one repository share, one after another: Lo finds it by its name and that home
 *   (`services`), counts its memory against the server's cap, and stops it with the server if it
 *   outlives the stop, as it does one an earlier Swift server on that repository left.
 * - Expanding a macro from the SDK, such as `@Observable`, runs Apple's `swift-plugin-server` with
 *   the toolchain's own macro plugins. A checkout's macros aren't built, so none of them runs.
 * - Like every server Lo runs, it has no sandbox: it reads what the user can, and Lo never opens a
 *   place outside the checkout an answer names.
 */

import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

import type { Launch } from './node.ts';
import type { Placed, Where } from '../place.ts';
import {
  entriesOf,
  foldName,
  type InstalledToolchain,
  tooManyEntries,
  WALK_LIMIT,
} from '../toolchains.ts';

/** SourceKit-LSP: what it's called, and its license. */
export const SOURCEKIT_LSP = { name: 'SourceKit-LSP', license: 'Apache-2.0' } as const;

/** What Swift needs on macOS when there's no SourceKit-LSP, and what installs it. */
export const NO_SOURCEKIT = {
  needs: 'Apple’s Command Line Tools',
  install: 'xcode-select --install',
} as const;

/** The program that names the developer folder the system has chosen. */
export const XCODE_SELECT = '/usr/bin/xcode-select';

/** How long `xcode-select -p` may take before Lo takes it as naming nothing. */
const XCODE_SELECT_WAIT = 10_000;

/**
 * The developer folder the system has chosen, as `xcode-select -p` names it, or `undefined` when
 * it names none, or there's no `xcode-select`, as on Linux. It's run by `program`, its absolute
 * path, with no shell, in `/`, and with only the system's `PATH`, so neither Lo's environment (a
 * `DEVELOPER_DIR`) nor a folder chooses it.
 */
export async function developerFolder(program: string = XCODE_SELECT): Promise<string | undefined> {
  try {
    const { stdout } = await promisify(execFile)(program, ['-p'], {
      env: { PATH: '/usr/bin:/bin' },
      cwd: '/',
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
      timeout: XCODE_SELECT_WAIT,
    });
    const folder = stdout.replace(/\n$/, '');
    return isAbsolute(folder) && !/[\0\n]/.test(folder) ? folder : undefined;
  } catch {
    return undefined;
  }
}

/** A copy of SourceKit-LSP: its program, the macOS SDK beside it, and what it comes with. */
export interface SourceKit {
  /** The program, by its real path. */
  readonly program: string;
  /** The macOS SDK in the same developer folder. */
  readonly sdk: string;
  /** What it comes with, as a sentence names it: "Xcode", "Apple’s Command Line Tools". */
  readonly from: string;
}

/** Where a copy of SourceKit-LSP may be in the developer folder `developer`, Xcode's first. */
export function sourceKitCandidates(developer: string): readonly SourceKit[] {
  return [
    {
      program: join(
        developer,
        'Toolchains',
        'XcodeDefault.xctoolchain',
        'usr',
        'bin',
        'sourcekit-lsp',
      ),
      sdk: join(developer, 'Platforms', 'MacOSX.platform', 'Developer', 'SDKs', 'MacOSX.sdk'),
      from: 'Xcode',
    },
    {
      program: join(developer, 'usr', 'bin', 'sourcekit-lsp'),
      sdk: join(developer, 'SDKs', 'MacOSX.sdk'),
      from: 'Apple’s Command Line Tools',
    },
  ];
}

/**
 * The copy of SourceKit-LSP in the developer folder `developer` that may run, with its SDK, or
 * `undefined` when there's none: `findCopy` says whether a program may run, by the rules of
 * `copies.ts`, and gives its real path.
 */
export async function findSourceKit(
  developer: string | undefined,
  findCopy: (candidates: readonly string[]) => Promise<string | undefined>,
): Promise<SourceKit | undefined> {
  if (developer === undefined || !isAbsolute(developer)) return undefined;
  for (const candidate of sourceKitCandidates(developer)) {
    const program = await findCopy([candidate.program]);
    if (program === undefined) continue;
    const sdk = await stat(candidate.sdk).catch(() => undefined);
    if (sdk?.isDirectory() !== true) continue;
    return { ...candidate, program };
  }
  return undefined;
}

/**
 * How long a request of SourceKit-LSP's to `sourcekitd` may take, in seconds: just past Lo's
 * longest wait. Each time is given with a fraction: SourceKit-LSP reads a whole number in its
 * `initializationOptions` as an integer, which an option that takes a `Double` refuses, and then it
 * drops every option Lo gives it.
 */
const REQUEST_TIMEOUT = 10.5;

/** How long a request may take before SourceKit-LSP takes `sourcekitd` as hung and restarts it. */
const RESTART_TIMEOUT = 30.5;

/** Where SourceKit-LSP keeps its generated files, in its home `home`. */
const generatedFiles = (home: string) => join(home, 'generated');

/** Where its compiler keeps its module cache, in its home `home`. */
const moduleCache = (home: string) => join(home, 'cache', 'modules');

/**
 * What SourceKit-LSP is told, as its `initializationOptions`, with `home` its home and, on macOS,
 * `sdk` the macOS SDK: no background indexing, which would build the package; its generated files,
 * and its compiler's module cache, in its home; a file's fallback build settings with Lo's flags
 * and the SDK, so it never asks `xcrun` for one (Linux has no SDK, and it asks nothing there);
 * nothing more for clangd; and `sourcekitd`'s requests held to Lo's longest wait, about 10 s, not
 * 2 minutes, and `sourcekitd` restarted once one hangs for about 30 s, not 5 minutes, since Lo has
 * given up on any request by then.
 */
export function sourceKitOptions(home: string, sdk?: string): Record<string, unknown> {
  return {
    backgroundIndexing: false,
    generatedFilesPath: generatedFiles(home),
    fallbackBuildSystem: {
      ...(sdk === undefined ? {} : { sdk }),
      swiftCompilerFlags: ['-module-cache-path', moduleCache(home)],
      cCompilerFlags: [],
      cxxCompilerFlags: [],
    },
    clangdOptions: [],
    sourcekitdRequestTimeout: REQUEST_TIMEOUT,
    semanticServiceRestartTimeout: RESTART_TIMEOUT,
  };
}

/**
 * SourceKit-LSP's arguments, with `home` its home: its generated files, and its compiler's module
 * cache, in the folders of its home that its options name. It drops every option it's told when
 * one doesn't decode, as it did a whole number for an option that takes a fraction, and these hold
 * all the same.
 */
export function sourceKitArguments(home: string): string[] {
  return [
    '--generated-files-path',
    generatedFiles(home),
    // Each `-Xswiftc` passes one argument on to the compiler.
    '-Xswiftc',
    '-module-cache-path',
    '-Xswiftc',
    moduleCache(home),
  ];
}

/**
 * What SourceKit-LSP is given where it runs, with `sdk` the macOS SDK, which Linux has none of: its
 * home, and its arguments and options.
 */
export async function placeSourceKit({ home }: Where, sdk?: string): Promise<Placed> {
  return {
    args: sourceKitArguments(home),
    // Foundation's home folder, where SourceKit-LSP reads its own settings, and on Linux writes its
    // logs, is the user's otherwise: Foundation takes it from this before `HOME`, and on Linux
    // from the user's entry in the system's list of users too.
    variables: { CFFIXED_USER_HOME: home },
    initializationOptions: sourceKitOptions(home, sdk),
  };
}

/**
 * How SourceKit-LSP `found` starts: its program, told of no workspace, with its arguments and
 * options worked out once its home is made.
 */
export function launchSourceKit(found: SourceKit): Launch {
  return {
    program: found.program,
    // No subcommand: it speaks the protocol over stdio. Its other arguments name its home.
    args: [],
    rootless: true,
    // `sourcekitd`'s XPC service, which `launchd` starts for it with its environment.
    services: ['SourceKitService'],
    place: (where) => placeSourceKit(where, found.sdk),
    version: `${SOURCEKIT_LSP.name} from ${found.from} · ${SOURCEKIT_LSP.license}`,
  };
}

/**
 * How SourceKit-LSP starts on Linux, from `swift`, the toolchain of `version` Lo downloaded for the
 * system's distribution (`swift.ts`), whose entry point it is: told of no workspace, and kept to
 * its home ({@link placeSourceKit}) once that's made, as on macOS, for the same reasons. There it
 * differs from macOS in that:
 *
 * - it runs `sourcekitd` in its own process, from the toolchain's `libsourcekitdInProc.so`, so
 *   there's no service outside its family, and what that runs, such as `swift-plugin-server` for a
 *   macro from the toolchain, is in its family too;
 * - there's no SDK: the compiler reads the system's headers, from the distribution's packages,
 *   which `missingPackages` checks are installed, and the toolchain's own modules;
 * - Foundation's home folder, which `CFFIXED_USER_HOME` makes the server's home, is where it writes
 *   its logs (`.sourcekit-lsp/logs`), besides reading its settings (`.sourcekit-lsp/config.json`,
 *   of which there's none). Foundation on Linux takes the home folder from that variable, then
 *   from the user's entry in the system's list of users, and from `HOME` only when there's no
 *   entry, so without it SourceKit-LSP would read the user's settings, write its logs among the
 *   user's, and delete theirs over an hour old. It reads
 *   `$XDG_CONFIG_HOME/sourcekit-lsp/config.json` too, but only when that's set, which it isn't, and
 *   nothing of the machine's. Lo sets no `XDG_*` variable, so what goes by XDG's folders falls back
 *   to folders in its home, and its temporary files are in its `TMPDIR`, as every server's are;
 * - its folder of programs is first on its `PATH`, as each toolchain's is.
 */
export function launchSourceKitOnLinux(swift: InstalledToolchain, version: string): Launch {
  return {
    program: swift.installed.entry,
    args: [],
    path: [...swift.path],
    rootless: true,
    place: (where) => placeSourceKit(where),
    version: `${SOURCEKIT_LSP.name} from Swift ${version} · ${SOURCEKIT_LSP.license}`,
  };
}

/** The names of what Lo refuses a checkout for, when it's anywhere in it, as {@link foldName} gives them. */
const BUILD_FILES = new Set(['buildserver.json', '.bsp', '.sourcekit-lsp']);

/**
 * Why SourceKit-LSP mustn't run on the checkout at `root`, or `undefined` when it may: a
 * `buildServer.json` or a `.bsp`, which name a build server, a program it would run, or a
 * `.sourcekit-lsp`, its settings, anywhere in the checkout, by {@link foldName}, so in any case or
 * Unicode form, a link or a file in place of a folder included. It looks in the checkout's own
 * folders, never through a link to one, and through `limit` of their entries at most: a checkout
 * with more is refused, since what's past them would go unchecked. It's the reason alone, as
 * `checkoutProblem`'s is.
 */
export async function sourceKitCheckoutProblem(
  root: string,
  limit = WALK_LIMIT,
): Promise<string | undefined> {
  const entries = await entriesOf(root, limit);
  if (entries === undefined) return tooManyEntries(limit);
  for (const { path } of entries) {
    const name = foldName(basename(path));
    if (!BUILD_FILES.has(name)) continue;
    const named = `The checkout’s ${path.slice(root.length + 1)}`;
    const what =
      name === '.sourcekit-lsp' ? 'holds SourceKit-LSP’s settings' : 'names a build server to run';
    return `${named} ${what}.`;
  }
  return undefined;
}
