/**
 * The toolchains language servers use: Go, Rust, a Temurin JDK and the .NET SDK. Lo downloads its
 * own copy of each, pinned in `toolchains.json` and installed as servers are, and a server uses
 * only Lo's copy, never one installed on the machine, nor a version a checkout asks for.
 *
 * What a server gets of one ({@link toolchainUse}) is the folder of its programs, first on its
 * `PATH`, and the variables that hold the toolchain to Lo's copy:
 *
 * - Go: `GOROOT`, `GOTOOLCHAIN=local`, so a `go.mod`'s or `go.work`'s `toolchain` line can't
 *   download another Go and a newer `go` line fails rather than fetch one, `GOENV=off`, so no
 *   settings file is read, `GOPROXY=off`, so no module is fetched, an empty `GOFLAGS`, so nothing
 *   adds a flag such as `-toolexec` or `-overlay`, `CGO_ENABLED=0`, so no C compiler runs, and
 *   `GOPACKAGESDRIVER=off`, so Go's package loader, which gopls is built on, runs `go list` rather
 *   than a driver program the variable names or a `gopackagesdriver` on `PATH`. Its caches,
 *   `GOPATH`, `GOMODCACHE` and `GOCACHE`, are folders in the server's home.
 * - Rust: `RUSTC` and `CARGO`, and empty `RUSTC_WRAPPER` and `RUSTC_WORKSPACE_WRAPPER`, which undo
 *   a checkout's `build.rustc-wrapper`, and `CARGO_NET_OFFLINE=true`. With no rustup, nothing
 *   reads `rust-toolchain.toml`.
 * - The JDK: `JAVA_HOME`.
 * - .NET: `DOTNET_ROOT`, MSBuild's SDK resolver held to Lo's SDK (`DOTNET_MSBUILD_SDK_RESOLVER_*`,
 *   and `DOTNET_HOST_PATH`), programs held to the runtime they were built for and its patches
 *   (`DOTNET_ROLL_FORWARD=LatestPatch`), its telemetry and first-run messages off, and on Linux
 *   invariant globalization, since the system may have no ICU.
 *
 * Each keeps its caches and settings in the server's own `HOME` (`CARGO_HOME`, `DOTNET_CLI_HOME`
 * and `NUGET_PACKAGES` all default to folders there), which no one else uses.
 *
 * Two files in a checkout, or above it, are what the variables can't answer, and a server that
 * uses the toolchain doesn't run on a checkout {@link checkoutProblem} finds one of them in:
 *
 * - A `global.json`: since .NET 10 its `sdk.paths` names folders to look for an SDK in, the
 *   checkout's own among them, and the SDK found there runs with its own runtime. The SDK's
 *   commands read the `global.json` nearest the folder they run in, and MSBuild the one nearest
 *   each project, however the variables are set. So a server that uses .NET runs only as
 *   `dotnet exec`, which reads none, and only on a checkout with no such file in it, nor above.
 *   Nor does it run below a folder that holds a file MSBuild or NuGet read for every project
 *   under it, such as a `Directory.Build.props` ({@link dotnetAbove}).
 * - A `go.work`, which makes the modules it names one workspace, loaded together. Go reads the one
 *   nearest the folder it runs in, so one in a folder above the checkout would make the user's
 *   other modules, or anyone's, the server's workspace; and one in the checkout may name a folder
 *   outside it (`use ../../elsewhere`, or a `replace` with a path), whose packages Go would load
 *   and the server read as the checkout's own. Its `go` and `toolchain` lines are held by
 *   `GOTOOLCHAIN=local`, as a `go.mod`'s are. A `go.mod`'s `replace` with a path outside the
 *   checkout loads only the packages the checkout imports from it, which the server reads as it
 *   reads any file outside the checkout, as the README says.
 */

import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { isInside } from './environment.ts';
import type { Installed } from './install.ts';

/** What Lo calls a toolchain: in a row of Settings, and in a sentence about it. */
export interface ToolchainName {
  /** "Temurin JDK". */
  readonly name: string;
  /** "the Temurin JDK", as a sentence names it. */
  readonly phrase: string;
}

/** The toolchains Lo knows, by their IDs in `toolchains.json`. */
export const TOOLCHAIN_NAMES: Readonly<Record<string, ToolchainName>> = {
  go: { name: 'Go', phrase: 'Go' },
  rust: { name: 'Rust', phrase: 'Rust' },
  temurin: { name: 'Temurin JDK', phrase: 'the Temurin JDK' },
  dotnet: { name: '.NET SDK', phrase: 'the .NET SDK' },
};

/** What a server gets of a toolchain, to add to its own: its `PATH` and its variables. */
export interface ToolchainUse {
  /** The folders of its programs, first on the server's `PATH`. */
  readonly path: readonly string[];
  readonly variables: Readonly<Record<string, string>>;
  /** The names among `variables` that choose a program, which the toolchain sets on purpose. */
  readonly allowed: readonly string[];
  /** Variables naming the toolchain's caches, by their paths in the server's home. */
  readonly homeFolders?: Readonly<Record<string, string>> | undefined;
}

/** A toolchain Lo installed, and what a server gets of it. */
export interface InstalledToolchain extends ToolchainUse {
  readonly installed: Installed;
}

/**
 * What a server gets of toolchain `id`, `version` of it installed at `installed`, on `platform`.
 * It throws for an ID Lo doesn't know.
 */
export function toolchainUse(
  id: string,
  version: string,
  installed: Installed,
  platform: NodeJS.Platform = process.platform,
): ToolchainUse {
  // Each entry point is a program in the toolchain's own folder of them, `<root>/bin/<program>`,
  // but .NET's, which is at its root.
  const bin = dirname(installed.entry);
  const root = dirname(bin);
  switch (id) {
    case 'go':
      return {
        path: [bin],
        variables: {
          GOROOT: root,
          GOTOOLCHAIN: 'local',
          GOENV: 'off',
          GOPROXY: 'off',
          GOFLAGS: '',
          CGO_ENABLED: '0',
          GOPACKAGESDRIVER: 'off',
        },
        allowed: ['GOFLAGS', 'GOPACKAGESDRIVER'],
        homeFolders: { GOPATH: 'go', GOMODCACHE: 'go/pkg/mod', GOCACHE: 'cache/go-build' },
      };
    case 'rust':
      return {
        path: [bin],
        variables: {
          RUSTC: join(bin, 'rustc'),
          CARGO: join(bin, 'cargo'),
          RUSTC_WRAPPER: '',
          RUSTC_WORKSPACE_WRAPPER: '',
          CARGO_NET_OFFLINE: 'true',
        },
        allowed: ['RUSTC', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER'],
      };
    case 'temurin':
      return { path: [bin], variables: { JAVA_HOME: root }, allowed: [] };
    case 'dotnet':
      return {
        path: [bin],
        variables: {
          DOTNET_ROOT: bin,
          // MSBuild finds a project's SDK by these, not by a `global.json`.
          DOTNET_MSBUILD_SDK_RESOLVER_CLI_DIR: bin,
          DOTNET_MSBUILD_SDK_RESOLVER_SDKS_DIR: join(bin, 'sdk', version, 'Sdks'),
          DOTNET_MSBUILD_SDK_RESOLVER_SDKS_VER: version,
          // The `dotnet` tasks and tools run, which is otherwise the resolved SDK's.
          DOTNET_HOST_PATH: join(bin, 'dotnet'),
          DOTNET_ROLL_FORWARD: 'LatestPatch',
          DOTNET_CLI_TELEMETRY_OPTOUT: '1',
          DOTNET_NOLOGO: '1',
          DOTNET_ADD_GLOBAL_TOOLS_TO_PATH: '0',
          DOTNET_GENERATE_ASPNET_CERTIFICATE: '0',
          ...(platform === 'linux' ? { DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' } : {}),
        },
        allowed: [],
      };
    default:
      throw new Error(`Lo has no toolchain ${id}`);
  }
}

/** The largest `global.json` or `go.work` {@link checkoutProblem} reads; a larger one it refuses. */
const READ_LIMIT = 1024 * 1024;

/**
 * Why a server that uses toolchain `id` mustn't run on the checkout at `root`, or `undefined`
 * when it may:
 *
 * - for .NET, a `global.json` in the checkout, or in a folder above it, that could choose an SDK
 *   other than Lo's: one that names folders to look for an SDK in (`sdk.paths`), or that spells a
 *   key with an escape, which hides such a name from a look at its text; or one of the files
 *   MSBuild and NuGet read from every folder above a project, in a folder above the checkout
 *   ({@link dotnetAbove});
 * - for Go, a `go.work` in a folder above the checkout, or one in it that names a folder outside
 *   it, by `use` or by a `replace` with a path, or that Lo can't read for certain, as one that
 *   spells a path with an escape.
 *
 * The other toolchains read nothing in a checkout that their variables don't answer.
 */
export async function checkoutProblem(id: string, root: string): Promise<string | undefined> {
  switch (id) {
    case 'dotnet':
      return dotnetProblem(root);
    case 'go':
      return goProblem(root);
    default:
      return undefined;
  }
}

/**
 * The files named `name` in the checkout at `root`, in any case, since the disk may not tell names
 * apart by case, and each folder above it, where one by that name would be. It looks in the
 * checkout's own folders, never through a link to one, which may lead anywhere on the disk, or
 * back into the checkout without end; a file of that name that is a link is found, and refused
 * as no plain file.
 */
async function filesNamed(
  root: string,
  name: string,
): Promise<{ inside: string[]; above: string[] }> {
  const inside: string[] = [];
  const folders = [root];
  for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
    for (const entry of await readdir(folder, { withFileTypes: true, encoding: 'utf8' })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) folders.push(path);
      else if (entry.name.toLowerCase() === name) inside.push(path);
    }
  }
  inside.sort();
  const above: string[] = [];
  for (let folder = dirname(root); ; folder = dirname(folder)) {
    above.push(join(folder, name));
    if (dirname(folder) === folder) break;
  }
  return { inside, above };
}

/** The text of the file at `file`, or why Lo won't read it, or `undefined` when there's none. */
async function readSmall(file: string): Promise<{ text: string } | { why: string } | undefined> {
  const info = await lstat(file).catch(() => undefined);
  if (info === undefined || info.isDirectory()) return undefined;
  if (!info.isFile()) return { why: 'isn’t a plain file' };
  if (info.size > READ_LIMIT) return { why: 'is too large for Lo to read' };
  const handle = await open(file, 'r');
  try {
    return { text: (await handle.readFile()).toString('latin1') };
  } finally {
    await handle.close();
  }
}

/** How a sentence names `file`: by its path in the checkout at `root`, or by its own. */
function nameOf(root: string, file: string): string {
  return file.startsWith(`${root}/`) ? `The checkout’s ${relative(root, file)}` : file;
}

async function dotnetProblem(root: string): Promise<string | undefined> {
  const { inside } = await filesNamed(root, 'global.json');
  for (const file of inside) {
    const why = await steers(file);
    if (why === undefined) continue;
    return `${nameOf(root, file)} ${why}, so it could choose a .NET SDK other than Lo’s.`;
  }
  // The folders above it, for a global.json and the files MSBuild and NuGet read.
  return dotnetAbove(root);
}

/**
 * The files MSBuild and NuGet look for in each folder above a project, by their names in lowercase:
 * MSBuild imports the nearest `Directory.Build.props`, `Directory.Build.targets` and
 * `Directory.Packages.props` into the project, and NuGet reads every `NuGet.config`.
 */
const READ_ABOVE: ReadonlyMap<string, string> = new Map([
  ['directory.build.props', 'MSBuild'],
  ['directory.build.targets', 'MSBuild'],
  ['directory.packages.props', 'MSBuild'],
  ['nuget.config', 'NuGet'],
]);

/**
 * Why .NET mustn't run below `folder`, by what's in each folder above it: a `global.json` that
 * could choose an SDK other than Lo's, as {@link checkoutProblem} reads one, or a file that
 * MSBuild or NuGet would read for every project below it ({@link READ_ABOVE}), whatever the case
 * of its name. It's asked of a checkout, and of the folder of the project Lo writes for a server in
 * its home, since MSBuild looks above the project, not above its sources; `what` names the folder.
 */
export async function dotnetAbove(
  folder: string,
  what = 'the checkout',
): Promise<string | undefined> {
  for (let above = dirname(folder); ; above = dirname(above)) {
    // A folder Lo can't list is looked in by the names themselves.
    const names = (await readdir(above).catch(() => undefined)) ?? [
      'global.json',
      ...READ_ABOVE.keys(),
    ];
    for (const name of names) {
      const file = join(above, name);
      const lower = name.toLowerCase();
      if (lower === 'global.json') {
        const why = await steers(file);
        if (why !== undefined)
          return `${file} ${why}, so it could choose a .NET SDK other than Lo’s.`;
        continue;
      }
      const reader = READ_ABOVE.get(lower);
      if (reader === undefined) continue;
      if ((await lstat(file).catch(() => undefined)) === undefined) continue;
      return `${file} is in a folder above ${what}, and ${reader} would read it for every project below it.`;
    }
    if (dirname(above) === above) return undefined;
  }
}

/** What makes the `global.json` at `file` one Lo can't run .NET beside, if anything does. */
async function steers(file: string): Promise<string | undefined> {
  const read = await readSmall(file);
  if (read === undefined) return undefined;
  if ('why' in read) return read.why;
  if (/paths/i.test(read.text)) return 'names folders to look for an SDK in';
  if (/\\u/i.test(read.text)) return 'spells a name with an escape Lo doesn’t read';
  return undefined;
}

async function goProblem(root: string): Promise<string | undefined> {
  const { inside, above } = await filesNamed(root, 'go.work');
  // Go takes a `go.work` above as it finds one, by `stat`, a link to a file included.
  for (const file of above) {
    const info = await stat(file).catch(() => undefined);
    if (info !== undefined && !info.isDirectory()) {
      return `${file} is a go.work in a folder above the checkout, which Go would take as the checkout’s workspace.`;
    }
  }
  const real = await realpath(root);
  for (const file of inside) {
    const read = await readSmall(file);
    if (read === undefined) continue;
    const named = nameOf(root, file);
    if ('why' in read)
      return `${named} ${read.why}, so it could name a folder outside the checkout.`;
    const folders = workFolders(read.text);
    if (folders === undefined) {
      return `${named} spells a path in a way Lo doesn’t read, so it could name a folder outside the checkout.`;
    }
    for (const folder of folders) {
      const target = resolve(dirname(file), folder);
      const resolved = await realpath(target).catch(() => undefined);
      if (!isInside(root, target) || (resolved !== undefined && !isInside(real, resolved))) {
        return `${named} names ${folder}, a folder outside the checkout, as part of its workspace.`;
      }
    }
  }
  return undefined;
}

/** The verbs of a `go.work` whose arguments name folders. */
const VERBS = new Set(['use', 'replace']);

/**
 * The folders a `go.work`'s `text` names, by `use` or by a `replace` with a path, as written, or
 * `undefined` for one Lo can't read for certain: a string with an escape, or one left open.
 */
export function workFolders(text: string): string[] | undefined {
  const folders: string[] = [];
  let block: string | undefined;
  for (const line of text.split('\n')) {
    const tokens = tokensOf(line);
    if (tokens === undefined) return undefined;
    const [first, second] = tokens;
    if (first === undefined) continue;
    if (block !== undefined && first === ')') {
      block = undefined;
      continue;
    }
    if (block === undefined && second === '(' && tokens.length === 2) {
      block = first;
      continue;
    }
    // A block opened or closed anywhere else is one Lo can't follow for certain.
    if (tokens.includes('(') || tokens.includes(')')) return undefined;
    const verb = block ?? first;
    const args = block === undefined ? tokens.slice(1) : tokens;
    if (!VERBS.has(verb)) continue;
    if (verb === 'use') {
      folders.push(...args);
      continue;
    }
    const arrow = args.indexOf('=>');
    const target = arrow === -1 ? undefined : args[arrow + 1];
    if (target !== undefined && isDirectoryPath(target)) folders.push(target);
  }
  return block === undefined ? folders : undefined;
}

/** Whether a `replace`'s target is a folder, as Go tells: `./`, `../`, `/`, `.` or `..`. */
function isDirectoryPath(path: string): boolean {
  return (
    path.startsWith('./') ||
    path.startsWith('../') ||
    isAbsolute(path) ||
    path === '.' ||
    path === '..'
  );
}

/** The characters Go's reader takes as tokens of their own, which end a word. */
const PUNCTUATION = new Set(['(', ')', '[', ']', '{', '}', ',']);

/**
 * The tokens of a line of a `go.mod` or `go.work`, as Go's reader splits them: words, punctuation
 * (`(`, `)` and the like) and strings, a comment's left out, or `undefined` for a line Lo can't
 * read for certain. A word runs to a space, punctuation or a comment, so Go takes `=>` as the
 * arrow only as a word of its own, and a quote inside a word as part of it: Lo refuses a word that
 * holds either, rather than read it otherwise than Go does.
 */
function tokensOf(line: string): string[] | undefined {
  const tokens: string[] = [];
  let at = 0;
  while (at < line.length) {
    const char = line[at] ?? '';
    if (/\s/.test(char)) {
      at += 1;
    } else if (line.startsWith('//', at)) {
      break;
    } else if (char === '"' || char === '`') {
      const end = line.indexOf(char, at + 1);
      if (end === -1) return undefined;
      const inside = line.slice(at + 1, end);
      // An escape in a quoted string spells what its text doesn't show.
      if (char === '"' && inside.includes('\\')) return undefined;
      tokens.push(inside);
      at = end + 1;
    } else if (PUNCTUATION.has(char)) {
      tokens.push(char);
      at += 1;
    } else {
      let end = at;
      while (
        end < line.length &&
        !/\s/.test(line[end] ?? '') &&
        !PUNCTUATION.has(line[end] ?? '') &&
        !line.startsWith('//', end)
      ) {
        end += 1;
      }
      const word = line.slice(at, end);
      if (/["`]/.test(word) || (word.includes('=>') && word !== '=>')) return undefined;
      tokens.push(word);
      at = end;
    }
  }
  return tokens;
}
