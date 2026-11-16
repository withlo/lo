/**
 * C#: Roslyn's language server, `Microsoft.CodeAnalysis.LanguageServer`, the one the C# extension
 * for VS Code runs, from nuget.org's `roslyn-language-server.<platform>` packages. It's a program
 * for .NET 10, which starts as `dotnet exec` on Lo's .NET SDK, with the SDK's variables
 * (`toolchainUse`).
 *
 * A C# server knows a project through MSBuild, and MSBuild runs a project's own code as it loads
 * it: targets hooked into the build and their `Exec` tasks, inline tasks compiled from the project
 * file, `UsingTask` assemblies, and whatever the `Directory.Build.props`, `Directory.Build.targets`,
 * `Directory.Packages.props` and other files it imports bring. A restore fetches the packages and
 * MSBuild SDKs a project names, from the registries a `NuGet.config` names, and the analyzers and
 * source generators in them run inside the compiler. No setting turns that off for a project of
 * the checkout's. So Roslyn never loads one:
 *
 * - Lo writes a project of its own in the server's home ({@link CSHARP_PROJECT}), which lists the
 *   checkout's `.cs` files one by one, leaving out those in `bin`, `obj`, `node_modules` and
 *   hidden folders and those whose names a project can't hold as they are ({@link writable}), and
 *   compiles them against .NET's and ASP.NET Core's reference assemblies from Lo's SDK. It
 *   imports nothing but the SDK's own files: not the `Directory.Build.*` and
 *   `Directory.Packages.props` MSBuild would look for above it, nor the user's MSBuild folders in
 *   its `HOME`. It restores nothing, names no package or analyzer, and removes the SDK's own
 *   analyzers and source generators before the compiler would get them. It finds no
 *   `.editorconfig` or `.globalconfig` beside the sources, which only configure the compiler and
 *   its analyzers anyway. It's the only project Roslyn is sent (`project/open`), and the folder it
 *   is in is the workspace Roslyn is told of, so Roslyn neither looks through the checkout for
 *   projects nor for files it would run as programs (`dotnet run app.cs`).
 * - Roslyn's own settings, which Lo answers, turn off what would run or fetch anything: a restore,
 *   and the `dotnet` command it runs for a file outside every project. Lo never asks it to run
 *   tests or restore.
 * - It runs in the project's folder, not the checkout, and builds a project only in a process of
 *   its own, `BuildHost`, which it starts as the `dotnet` first on its `PATH`, Lo's, with Lo's
 *   SDK found from the project's folder, in the home. A project like Lo's that imports an SDK
 *   never needs the build host for .NET Framework, which would run `mono`.
 * - It writes in its home, but for a cache of how its own parts fit together, which it keeps in
 *   `cache/` beside its program, in its install: that folder is set in its code, with no option to
 *   move it. Nothing of a checkout's reaches it. It writes the cache to a file of a random name in
 *   that folder and then moves that to the cache's name, so the cache appears whole or not at all,
 *   though nothing syncs it to the disk first. A move that fails, as when another Roslyn has just
 *   written the same cache, leaves the other file behind, about half a megabyte, and a cache it
 *   can't read, it makes again.
 *
 * What the checkout still gives it is its `.cs` files, read as text. A package's types are
 * unknown, so a name from one has no definition or hover, nor do types a source generator would
 * write. The checkout's projects don't count: their target frameworks, `#if` symbols, references
 * between them, `LangVersion` or `Nullable`. Every `.cs` file is in one project, read as C# for
 * .NET 10, with nullable types and the SDK's implicit `using`s on, so the same name in two
 * projects is defined twice. A `.cs` file Lo didn't list, such as one under `bin`, is read alone,
 * with no references.
 *
 * Like every server Lo runs, it has no sandbox: it reads what the user can. Lo never opens a place
 * outside the checkout an answer names, such as the signatures of .NET's types it makes in its
 * `TMPDIR`: it shows as outside the repository.
 */

import { lstat, mkdir, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Installed } from '../install.ts';
import { MANIFEST, type Manifest } from '../manifest.ts';
import type { Workspace, WorkspacePaths } from '../server.ts';
import { dotnetAbove, foldName, type InstalledToolchain } from '../toolchains.ts';
import type { Launch } from './node.ts';

/** Where in its home Lo writes the project Roslyn loads, and what it's called. */
export const CSHARP_PROJECT = { folder: 'project', file: 'checkout.csproj' } as const;

/** The most `.cs` files Lo lists in its project: a checkout with more isn't read. */
export const CSHARP_FILES = 50_000;

/**
 * The most memory each .NET process of the server's may take for its objects, Roslyn's and its
 * build host's, so it collects before Lo's 4 GB cap on them all stops it: 3 GB, in hex as .NET
 * reads it.
 */
export const DOTNET_HEAP = (3 * 1024 ** 3).toString(16);

/** What Roslyn is told, as `workspace/configuration` asks for it: each section's values. */
const SETTINGS = {
  projects: {
    // No `dotnet restore`.
    dotnet_enable_automatic_restore: false,
    // A file outside every project is read alone, with no references, never as a program, whose
    // project `dotnet` would make from the folder it's in.
    dotnet_enable_file_based_programs: false,
    dotnet_enable_file_based_programs_when_ambiguous: false,
  },
  navigation: {
    // A definition in .NET's own assemblies is their signatures, not sources decompiled, or
    // fetched by their Source Link.
    dotnet_navigate_to_decompiled_sources: false,
    dotnet_navigate_to_source_link_and_embedded_sources: false,
  },
  // Each per language, for C#: the names of parameters at a call, and the types C# infers.
  'csharp|inlay_hints': {
    dotnet_enable_inlay_hints_for_parameters: true,
    dotnet_enable_inlay_hints_for_literal_parameters: true,
    dotnet_enable_inlay_hints_for_indexer_parameters: true,
    dotnet_enable_inlay_hints_for_object_creation_parameters: true,
    dotnet_enable_inlay_hints_for_other_parameters: true,
    csharp_enable_inlay_hints_for_types: true,
    csharp_enable_inlay_hints_for_implicit_variable_types: true,
    csharp_enable_inlay_hints_for_lambda_parameter_types: true,
    csharp_enable_inlay_hints_for_implicit_object_creation: true,
    csharp_enable_inlay_hints_for_collection_expressions: true,
  },
  // Lo shows no code lens, and a test's would run it.
  'csharp|code_lens': {
    dotnet_enable_references_code_lens: false,
    dotnet_enable_tests_code_lens: false,
  },
};

/** Roslyn's server: its entry in `servers.json`, and what it's told. */
export const ROSLYN = {
  id: 'roslyn',
  name: 'Roslyn',
  license: 'MIT',
  // It speaks the protocol over its stdio, logs what it does, sends no telemetry, and loads no
  // project until it's sent one: no `--autoLoadProjects`.
  args: ['--stdio', '--logLevel', 'Information', '--telemetryLevel', 'off'],
  settings: SETTINGS,
  variables: { DOTNET_GCHeapHardLimit: DOTNET_HEAP },
  // Parameters' names at a call, and inferred types.
  hints: true,
} as const;

/**
 * How Roslyn starts from `installed`, its install, on `dotnet`, Lo's .NET SDK: as `dotnet exec`
 * on its own program, with the SDK's folder and variables and its own, and the workspace Lo makes
 * for it ({@link csharpWorkspace}).
 */
export function launchRoslyn(
  installed: Installed,
  dotnet: InstalledToolchain,
  manifest: Manifest = MANIFEST,
): Launch {
  const pinned = Object.hasOwn(manifest, ROSLYN.id) ? manifest[ROSLYN.id] : undefined;
  if (pinned === undefined) throw new Error(`Lo's list of language servers has no ${ROSLYN.id}.`);
  for (const path of [dotnet.installed.entry, installed.entry]) {
    if (!isAbsolute(path)) throw new Error(`${path} isn't an absolute path.`);
  }
  return {
    program: dotnet.installed.entry,
    args: ['exec', installed.entry, ...ROSLYN.args],
    path: dotnet.path,
    variables: { ...dotnet.variables, ...ROSLYN.variables },
    allowed: dotnet.allowed,
    settings: ROSLYN.settings,
    version: `${ROSLYN.name} ${pinned.version} · ${ROSLYN.license}`,
    workspace: csharpWorkspace,
  };
}

/**
 * Writes the project Roslyn loads for the checkout at `root`, in the folder `project` in `home`,
 * replacing what was there, and says what Roslyn's told: that folder as its workspace, and the
 * project to open. It refuses a checkout with more than {@link CSHARP_FILES} `.cs` files, and a
 * project below a folder that holds a file MSBuild or NuGet would read for it.
 */
export async function csharpWorkspace({ root, home }: WorkspacePaths): Promise<Workspace> {
  const folder = join(home, CSHARP_PROJECT.folder);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const above = await dotnetAbove(folder, 'the project Lo writes for C#');
  if (above !== undefined) throw new Error(above);
  const sources = await csharpSources(root);
  const file = join(folder, CSHARP_PROJECT.file);
  const writing = `${file}.writing`;
  await writeFile(writing, csharpProject(sources), { mode: 0o600 });
  await rename(writing, file);
  return {
    folder,
    notifications: [{ method: 'project/open', params: { projects: [pathToFileURL(file).href] } }],
  };
}

/**
 * The most folders {@link csharpSources} looks in, the checkout's root and the nearest it first.
 */
export const CSHARP_FOLDERS = 20_000;

/** Folders Lo never looks in for `.cs` files: build output, as the SDK leaves out, and packages. */
const LEFT_OUT = new Set(['bin', 'obj', 'node_modules']);

/**
 * The `.cs` files of the checkout at `root`, by absolute path, sorted: plain files only, never a
 * link, and none whose name, or a folder's on its way, a project can't hold as it is
 * ({@link writable}), each as MSBuild reads it ({@link inCheckout}). It never looks in a link, a
 * hidden folder, such as `.git`, or `bin`, `obj` or `node_modules`. Names are matched by
 * {@link foldName}, as a Mac's disk matches them.
 *
 * It looks in {@link CSHARP_FOLDERS} folders at most, or `limits.folders`, the nearest the root
 * first, and no further: a file only those past them hold isn't listed, so Roslyn reads it alone,
 * as it would any other. It throws past {@link CSHARP_FILES} files, or `limits.files`.
 */
export async function csharpSources(
  root: string,
  limits: { folders: number; files: number } = { folders: CSHARP_FOLDERS, files: CSHARP_FILES },
): Promise<string[]> {
  const found: string[] = [];
  const folders = [root];
  for (let at = 0; at < folders.length; at += 1) {
    const folder = folders[at] ?? root;
    // A folder that can't be read is passed over, but not the checkout.
    const entries = await readdir(folder, { withFileTypes: true }).catch((error: unknown) => {
      if (folder === root) throw error;
      return [];
    });
    for (const entry of entries.toSorted((a, b) => (a.name < b.name ? -1 : 1))) {
      if (!writable(entry.name)) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        const looked = !entry.name.startsWith('.') && !LEFT_OUT.has(foldName(entry.name));
        if (looked && folders.length < limits.folders) folders.push(path);
      } else if (entry.isFile() && foldName(entry.name).endsWith('.cs')) {
        found.push(path);
        if (found.length > limits.files) {
          throw new Error(
            `The checkout has more than ${limits.files.toLocaleString('en-US')} C# files.`,
          );
        }
      }
    }
  }
  return (await inCheckout(root, found)).toSorted();
}

/**
 * Whether `name` can be part of a path in Lo's project as it is. Not with a `\`, which MSBuild on
 * macOS and Linux reads as `/`, so `a\..\..\b.cs` would be a file two folders above the checkout,
 * and `.\c.cs` the checkout's `c.cs`, which may be a link; nor a character XML 1.0 can't hold,
 * such as U+FFFE and U+FFFF, which would make the project no XML; nor a control character, which
 * an attribute reads as a space; nor U+FFFD, which stands for bytes that aren't UTF-8, so the name
 * isn't the file's.
 */
export function writable(name: string): boolean {
  return !/[^\u0020-\uD7FF\uE000-\uFFFC\u{10000}-\u{10FFFF}]|[\p{Cc}\\]/u.test(name);
}

/**
 * Of `paths`, files in the checkout at `root`, those that, as MSBuild reads them, with each `\` a
 * `/`, are still in the checkout, and name a plain file there, through no link.
 */
export async function inCheckout(root: string, paths: readonly string[]): Promise<string[]> {
  const real = await realpath(root);
  const kept = await Promise.all(
    paths.map(async (path) => {
      const read = resolve(path.replaceAll('\\', '/'));
      if (!read.startsWith(`${root}${sep}`)) return undefined;
      // What the walk listed is as it was: a file that has since become a link is left out.
      if ((await lstat(read).catch(() => undefined))?.isFile() !== true) return undefined;
      const target = await realpath(read).catch(() => undefined);
      return target === join(real, relative(root, read)) ? path : undefined;
    }),
  );
  return kept.filter((path) => path !== undefined);
}

/**
 * Lo's project for `sources`, the checkout's `.cs` files by absolute path. Each path is escaped
 * for MSBuild, so `$`, `@`, `%`, `*` and the rest are only characters of a name, never a property,
 * an item, a function or a wildcard, and then for XML.
 */
export function csharpProject(sources: readonly string[]): string {
  const items = sources.map((path) => `    <Compile Include="${xml(msbuild(path))}" />`);
  return `<Project>
  <!-- Lo's project for its C# language server: the checkout's .cs files, read against .NET's own
       reference assemblies, with nothing else of the checkout's. -->
  <PropertyGroup>
    <ImportDirectoryBuildProps>false</ImportDirectoryBuildProps>
    <ImportDirectoryBuildTargets>false</ImportDirectoryBuildTargets>
    <ImportDirectoryPackagesProps>false</ImportDirectoryPackagesProps>
    <ImportProjectExtensionProps>false</ImportProjectExtensionProps>
    <ImportProjectExtensionTargets>false</ImportProjectExtensionTargets>
    <ImportUserLocationsByWildcardBeforeMicrosoftCommonProps>false</ImportUserLocationsByWildcardBeforeMicrosoftCommonProps>
    <ImportUserLocationsByWildcardAfterMicrosoftCommonProps>false</ImportUserLocationsByWildcardAfterMicrosoftCommonProps>
    <ImportUserLocationsByWildcardBeforeMicrosoftCommonTargets>false</ImportUserLocationsByWildcardBeforeMicrosoftCommonTargets>
    <ImportUserLocationsByWildcardAfterMicrosoftCommonTargets>false</ImportUserLocationsByWildcardAfterMicrosoftCommonTargets>
  </PropertyGroup>
  <Import Project="Sdk.props" Sdk="Microsoft.NET.Sdk" />
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <OutputType>Library</OutputType>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <EnableDefaultItems>false</EnableDefaultItems>
    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>
    <ManagePackageVersionsCentrally>false</ManagePackageVersionsCentrally>
    <EnableNETAnalyzers>false</EnableNETAnalyzers>
    <RunAnalyzers>false</RunAnalyzers>
    <DiscoverEditorConfigFiles>false</DiscoverEditorConfigFiles>
    <DiscoverGlobalAnalyzerConfigFiles>false</DiscoverGlobalAnalyzerConfigFiles>
  </PropertyGroup>
  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
${items.join('\n')}
  </ItemGroup>
  <Import Project="Sdk.targets" Sdk="Microsoft.NET.Sdk" />
  <!-- The SDK's own analyzers and source generators, which the compiler would load, removed once
       the SDK has added them. -->
  <Target Name="LoWithoutAnalyzers" BeforeTargets="CoreCompile">
    <ItemGroup>
      <Analyzer Remove="@(Analyzer)" />
    </ItemGroup>
  </Target>
</Project>
`;
}

/** `text` with each character MSBuild reads as more than a character escaped, as `%XX`. */
export function msbuild(text: string): string {
  return text.replace(
    /[%$@'();?*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `text` with what XML reads in an attribute escaped. */
function xml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
