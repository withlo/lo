/**
 * Java: Eclipse JDT LS, the language server of Eclipse's Java tools, which VS Code's Java runs too.
 * It's Java itself, Eclipse's bundles on Equinox, Eclipse's runtime, so it runs on Lo's Temurin
 * JDK, the only Java it's given: it starts as that JDK's `java`, by its absolute path, with
 * `JAVA_HOME` naming it, and it reads that JDK's classes and sources as the project's library.
 *
 * JDT LS makes a project of a folder by importing it: with Gradle, which runs the checkout's build
 * scripts and whose wrapper downloads the Gradle `gradle-wrapper.properties` names; with Maven,
 * through m2e, which fetches dependencies, loads the extensions `.mvn/extensions.xml` names and
 * runs the plugins a `pom.xml` maps to its build; or as the Eclipse project a `.project` and
 * `.classpath` describe, which can name builders that run, Maven's among them, annotation
 * processors (`.factorypath`) and settings (`.settings`). Lo imports nothing:
 *
 * - Gradle's and Maven's imports are off, with their wrappers, downloads and annotation processing,
 *   should anything reach them. Gradle's home is a folder in the server's own, whose
 *   `gradle.properties` holds any Gradle to Lo's JDK and lets it detect or download no other;
 * - Eclipse's import, which no setting turns off, finds nothing: every folder, `**`, is left out of
 *   the search for build files, so no `.project`, `pom.xml` or `build.gradle` is ever found.
 *
 * What JDT LS reads is a project of its own instead, an invisible one, in its workspace in its
 * home, linked to the checkout. Its source folders are the ones Lo finds ({@link sourcePaths}):
 * for each `.java` file, the folder its package starts from. JDT LS would find them itself only
 * beside no build file, so Lo names them, and has it make the project at once, from a file at the
 * checkout's root that isn't there ({@link TRIGGER}), as it would on opening one. Its library is
 * Lo's JDK, and the jars in a `lib/` at the root, which it reads and never runs. It compiles
 * nothing (`java.autobuild.enabled`), so nothing runs an annotation processor, and it writes
 * nothing in the checkout: the project's files, its index and its logs are all in its home.
 *
 * Its own `.settings` is the one thing in a checkout JDT LS reads as the project's, and writes to:
 * when the checkout's root holds one, it links the project's settings to it. So Lo doesn't start
 * it there ({@link jdtlsCheckoutProblem}). A `.settings` anywhere else is only a folder of files.
 *
 * What the JVM is told is Lo's alone: no agent (`-javaagent`, as VS Code adds for Lombok), and it
 * starts with `-jar`, so its classes come from Equinox's launcher, never from the folder it runs
 * in, the checkout. It reads no `JDK_JAVA_OPTIONS` or `JAVA_TOOL_OPTIONS`, since its environment is
 * Lo's, and a product build of the JVM, as Temurin's is, reads a `.hotspotrc` or
 * `.hotspot_compiler` in that folder only when told to, which it isn't. The JVM takes its home and
 * its temporary folder from system properties, not `HOME` or `TMPDIR`, so they name its own
 * (`user.home`, `java.io.tmpdir`), as do Equinox's configuration and JDT LS's workspace. Its native
 * libraries come from Lo's JDK alone: on macOS the JVM would also look in the folder it runs in.
 * Its warnings go to stderr, never to stdout, where the protocol is.
 *
 * It reaches no host. Its JVM looks names up only in a hosts file in its home that has none
 * (`jdk.net.hosts.file`), and it uses no proxy, which would look names up itself: JDT LS would give
 * Eclipse's networking the system's proxies, unless told not to (`jdt.ls.disableProxies`), and the
 * JVM takes none either (`java.net.useSystemProxies`, and no `http.proxyHost`). Two parts of it
 * try to fetch anyway, and no setting stops them trying, only finding no host:
 *
 * - Buildship, Gradle's part, asks services.gradle.org for Gradle's versions as it starts;
 * - a hover on a class from a jar in `lib/`, or that class's source, has it ask search.maven.org
 *   which artifact the jar is, by its SHA-1, then m2e, Maven's part, to download the artifact's
 *   sources, named by the jar's own `pom.properties` when it has one. Maven's offline setting keeps
 *   m2e to the repository in its home, which holds nothing.
 *
 * What in a checkout can reach it, then: the `.java` files, whose packages say where its source
 * folders are and which it reads as source; the jars in a `lib/` at the root, which it reads as
 * classes and never runs; and a `.settings` at the root, which Lo refuses. What can't: build files
 * and wrappers (`build.gradle`, `settings.gradle`, `gradle.properties`, `gradlew`, `pom.xml`,
 * `.mvn/`), Eclipse's project (`.project`, `.classpath`, `.factorypath`, a `.settings` anywhere
 * else), the JVM's options files, and version files (`.java-version`, `.sdkmanrc`). Above the
 * checkout it reads nothing: when a folder the checkout is in is named `src`, it looks only for
 * whether the folder holding that one has a build file, and makes no project if it has.
 *
 * Like every server Lo runs, it has no sandbox: it reads what the user can, so a link in the
 * checkout can lead it to files outside it, and a hover can show what's in one. Lo never opens a
 * place outside the checkout an answer names: it shows as outside the repository.
 */

import { open, readdir } from 'node:fs/promises';
import { isAbsolute, join, posix } from 'node:path';

import { temporaryFolder } from '../environment.ts';
import type { Installed } from '../install.ts';
import { currentPlatform, MANIFEST, type Manifest, type Platform } from '../manifest.ts';
import type { Placed, Where } from '../place.ts';
import { foldName, type ToolchainUse } from '../toolchains.ts';
import { fileUri } from '../uri.ts';
import type { Launch } from './node.ts';

/** JDT LS, as Lo names it. */
export const JDTLS = {
  /** Its entry in the manifest, `servers.json`, whose `entry` is Equinox's launcher. */
  id: 'jdtls',
  name: 'Eclipse JDT LS',
  license: 'EPL-2.0',
  // Parameters' names at a call, and the types `var` and a lambda's parameters leave out.
  hints: true,
} as const;

/**
 * The cap on its heap, in megabytes: under Lo's 4 GB for its process, with room for what a JVM
 * holds besides, its classes, compiled code and threads.
 */
export const JDTLS_HEAP = 2560;

/**
 * The file it's told to start from, at the checkout's root, which no checkout has: it finds none
 * to read, which it logs, so it takes the root as where a project begins, and makes the project
 * with Lo's source folders.
 */
export const TRIGGER = '.lo-project.java';

/** The folder of Equinox's configuration for each platform, in JDT LS's install. */
const CONFIGURATIONS: Readonly<Record<Platform, string>> = {
  'darwin-arm64': 'config_mac_arm',
  'darwin-x64': 'config_mac',
  'linux-x64': 'config_linux',
  'linux-arm64': 'config_linux_arm',
};

/** What JDT LS is told, in `initialize` and when it asks: the `java` settings. */
export function jdtlsSettings(sources: readonly string[]) {
  return {
    java: {
      import: {
        // No folder is searched for a build file: no Eclipse project, `pom.xml` or `build.gradle`.
        exclusions: ['**'],
        gradle: {
          enabled: false,
          wrapper: { enabled: false },
          offline: { enabled: true },
          annotationProcessing: { enabled: false },
        },
        // Offline, m2e asks no repository for a jar's sources either.
        maven: { enabled: false, offline: { enabled: true } },
        generatesMetadataFilesAtProjectRoot: false,
      },
      configuration: { updateBuildConfiguration: 'disabled' },
      maven: { downloadSources: false, updateSnapshots: false },
      eclipse: { downloadSources: false },
      // It compiles nothing, so it writes no classes and runs no annotation processor.
      autobuild: { enabled: false },
      maxConcurrentBuilds: 1,
      // The source folders Lo found, and the checkout's own encoding left as it is.
      project: { sourcePaths: [...sources], encoding: 'ignore' },
      inlayHints: {
        parameterNames: { enabled: 'literals' },
        parameterTypes: { enabled: true },
        variableTypes: { enabled: true },
      },
      // What it would tell Lo of its own use, which Lo drops anyway.
      telemetry: { enabled: false },
    },
  };
}

/**
 * What a Gradle that ran would read in its home before a project's own: Lo's JDK as the one it runs
 * builds with, and no other found on the machine or downloaded. Nothing runs Gradle: it's there in
 * case anything reached it.
 */
export function gradleProperties(javaHome: string): string {
  const value = javaHome.replaceAll('\\', '\\\\');
  return [
    '# Lo’s, for a Gradle that runs here, though none does: Lo’s JDK, and no other.',
    `org.gradle.java.home=${value}`,
    'org.gradle.java.installations.auto-detect=false',
    'org.gradle.java.installations.auto-download=false',
    '',
  ].join('\n');
}

/**
 * How JDT LS starts from `installed`, its install, on `jdk`, Lo's Temurin JDK as installed, with
 * `use`, what a server gets of it, on `platform`.
 */
export function launchJdtls(
  installed: Installed,
  jdk: Installed,
  use: ToolchainUse,
  platform: Platform | undefined = currentPlatform(),
  manifest: Manifest = MANIFEST,
): Launch {
  const pinned = Object.hasOwn(manifest, JDTLS.id) ? manifest[JDTLS.id] : undefined;
  if (pinned === undefined) throw new Error(`Lo's list of language servers has no ${JDTLS.id}.`);
  if (platform === undefined) throw new Error('Lo has no Java server for this system.');
  for (const path of [installed.folder, installed.entry, jdk.entry]) {
    if (!isAbsolute(path)) throw new Error(`${path} isn't an absolute path.`);
  }
  const javaHome = use.variables.JAVA_HOME;
  if (javaHome === undefined) throw new Error('The JDK doesn’t say where its home is.');
  return {
    program: jdk.entry,
    args: [
      `-Xmx${JDTLS_HEAP}m`,
      '-Xms100m',
      // VS Code's Java's collector, which gives memory back as the heap empties.
      '-XX:+UseParallelGC',
      '-XX:GCTimeRatio=4',
      '-XX:AdaptiveSizePolicyWeight=90',
      // The JVM's own warnings on stderr, never on stdout, where the protocol is.
      '-Xlog:disable',
      '-Xlog:all=warning:stderr',
      // Native libraries from Lo's JDK alone, never the folder it runs in.
      `-Djava.library.path=${join(javaHome, 'lib')}`,
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
      '-Declipse.product=org.eclipse.jdt.ls.core.product',
      '-Dosgi.bundles.defaultStartLevel=4',
      '-Dosgi.checkConfiguration=true',
      // Equinox's configuration in the install, read only, and what it writes in its home.
      `-Dosgi.sharedConfiguration.area=${join(installed.folder, CONFIGURATIONS[platform])}`,
      '-Dosgi.sharedConfiguration.area.readOnly=true',
      '-Dosgi.configuration.cascaded=true',
      // No proxy, for Eclipse's networking or the JVM's: one would look names up itself.
      '-Djdt.ls.disableProxies=true',
      '-Djava.net.useSystemProxies=false',
      '--add-modules=ALL-SYSTEM',
      '--add-opens',
      'java.base/java.util=ALL-UNNAMED',
      '--add-opens',
      'java.base/java.lang=ALL-UNNAMED',
      '-jar',
      installed.entry,
    ],
    path: use.path,
    variables: use.variables,
    allowed: [...use.allowed, 'GRADLE_USER_HOME'],
    // Gradle's home, in its own: where a Gradle that ran would read its properties first.
    homeFolders: { GRADLE_USER_HOME: 'gradle' },
    settings: jdtlsSettings([]),
    place: (where) => placeJdtls(where, javaHome),
    // It finds its project's source folders only as it starts.
    stays: true,
    version: `${JDTLS.name} ${pinned.version} · ${JDTLS.license}`,
  };
}

/** The hosts file its JVM looks names up in, in place of the system's resolver: one with none. */
const HOSTS = 'hosts';

/** What JDT LS is given where it runs: its folders in its home, and its checkout's source folders. */
export async function placeJdtls({ root, home }: Where, javaHome: string): Promise<Placed> {
  const settings = jdtlsSettings(await sourcePaths(root));
  return {
    args: [
      `-Duser.home=${home}`,
      `-Djava.io.tmpdir=${temporaryFolder(home)}`,
      `-Dosgi.configuration.area=${join(home, 'configuration')}`,
      `-Dosgi.instance.area=${join(home, 'workspace')}`,
      // Names resolve only from Lo's hosts file, which has none, so it reaches no host by name.
      `-Djdk.net.hosts.file=${join(home, HOSTS)}`,
    ],
    files: {
      'gradle/gradle.properties': gradleProperties(javaHome),
      [HOSTS]: '# Lo’s: no host has an address here, so Java’s server looks none up.\n',
    },
    settings,
    initializationOptions: { settings, triggerFiles: [fileUri(root, TRIGGER)] },
  };
}

/** The most folders {@link sourcePaths} looks in, the checkout's root and the nearest it first. */
export const SOURCE_FOLDERS = 20_000;

/** The most `.java` files {@link sourcePaths} reads, the nearest the checkout's root first. */
export const SOURCE_FILES = 20_000;

/** How much of a file is read for its package. */
const HEAD = 16 * 1024;

/**
 * The checkout's source folders, by their paths in it: for each `.java` file, the folder its
 * package starts from, as its path says, so `src/main/java` for `src/main/java/a/B.java` in package
 * `a`. A file whose path doesn't end with its package names none, as JDT LS would take it, and nor
 * does a file at the checkout's root: everything there would be code. A file in no package names
 * its own folder only when that isn't inside another source folder: JDT LS would make it a source
 * folder within that one, and read none of the outer folder's package there. Hidden folders and
 * `node_modules` aren't looked in, and no link is followed.
 *
 * It looks in {@link SOURCE_FOLDERS} folders and reads {@link SOURCE_FILES} files at most, or
 * `limits`, the nearest the root first, and no further: a source folder only those past them show
 * isn't found, so JDT LS takes the files in it as outside its project, as it would any file Lo
 * hadn't named a folder for, and answers less there.
 */
export async function sourcePaths(
  root: string,
  limits: { folders: number; files: number } = { folders: SOURCE_FOLDERS, files: SOURCE_FILES },
): Promise<string[]> {
  const found = new Set<string>();
  // The folders of files in no package.
  const loose = new Set<string>();
  const folders = [''];
  let read = 0;
  for (let at = 0; at < folders.length && read < limits.files; at += 1) {
    const folder = folders[at] ?? '';
    const entries = await readdir(join(root, folder), { withFileTypes: true }).catch(() => []);
    for (const entry of entries.toSorted((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = folder === '' ? entry.name : `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        const looked = !entry.name.startsWith('.') && entry.name !== 'node_modules';
        if (looked && folders.length < limits.folders) folders.push(path);
      } else if (entry.isFile() && entry.name.endsWith('.java') && read < limits.files) {
        read += 1;
        const name = await packageOf(join(root, path));
        const source = sourceFolder(path, name);
        if (source !== undefined) (name === '' ? loose : found).add(source);
      }
    }
  }
  const all = [...found, ...loose];
  for (const source of loose) {
    if (!all.some((other) => source.startsWith(`${other}/`))) found.add(source);
  }
  return [...found].toSorted();
}

/** The source folder of the file at `path`, in package `name`, or none. */
function sourceFolder(path: string, name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const folder = posix.dirname(path);
  const inside = name === '' ? '' : name.replaceAll('.', '/');
  const source =
    inside === ''
      ? folder
      : folder.endsWith(`/${inside}`)
        ? folder.slice(0, -inside.length - 1)
        : '';
  return source === '' || source === '.' ? undefined : source;
}

/**
 * The package the Java file at `file` says it's in, from its start: `''` for none, or `undefined`
 * when its start can't be read, or Lo can't tell ({@link declaredPackage}).
 */
async function packageOf(file: string): Promise<string | undefined> {
  let text: string;
  try {
    const handle = await open(file, 'r');
    try {
      const buffer = Buffer.alloc(HEAD);
      const { bytesRead } = await handle.read(buffer, 0, HEAD, 0);
      text = buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
  return declaredPackage(text);
}

/** A name in Java: a letter, `_` or `$`, then those and digits. */
const NAME = /[\p{L}_$][\p{L}\p{N}_$]*/uy;

/**
 * The package `text`, a Java file's start, declares, read as Java reads it, past comments and
 * annotations, whatever their arguments hold: `''` when it declares none, or `undefined` when Lo
 * can't tell, since `text` ends first or doesn't read as Java. A file Lo can't tell names no source
 * folder, so it can't put one inside another.
 */
export function declaredPackage(text: string): string | undefined {
  let at = 0;

  /** Past whitespace and comments, or `false` when nothing follows, or a comment doesn't end. */
  function gap(): boolean {
    for (;;) {
      while (/\s/.test(text.charAt(at))) at += 1;
      const close = text.startsWith('//', at) ? '\n' : text.startsWith('/*', at) ? '*/' : undefined;
      if (close === undefined) return at < text.length;
      const end = text.indexOf(close, at + 2);
      // A comment that doesn't end leaves nothing after it to read.
      if (end === -1) return false;
      at = end + close.length;
    }
  }

  /** The name that starts at `at`, which it moves past, or `undefined`. */
  function name(): string | undefined {
    NAME.lastIndex = at;
    const found = NAME.exec(text)?.[0];
    if (found !== undefined) at += found.length;
    return found;
  }

  /** The names that start at `at`, by dots, `a.b.c`, with any gaps between them, or `undefined`. */
  function qualified(): string | undefined {
    let found = name();
    while (found !== undefined) {
      const before = at;
      if (!gap() || text[at] !== '.') {
        at = before;
        return found;
      }
      at += 1;
      const next = gap() ? name() : undefined;
      found = next === undefined ? undefined : `${found}.${next}`;
    }
    return undefined;
  }

  /** Past the string, text block or character at `at`, or `false` when it doesn't end. */
  function literal(): boolean {
    const quote = text.startsWith('"""', at) ? '"""' : text.charAt(at);
    at += quote.length;
    while (at < text.length) {
      if (text[at] === '\\') {
        at += 2;
      } else if (text.startsWith(quote, at)) {
        at += quote.length;
        return true;
      } else if (text[at] === '\n' && quote.length === 1) {
        return false;
      } else {
        at += 1;
      }
    }
    return false;
  }

  /** Past the parentheses that open at `at`, and what they hold, or `false` if they don't close. */
  function parenthesized(): boolean {
    let depth = 0;
    while (gap()) {
      const char = text[at];
      if (char === '"' || char === "'") {
        if (!literal()) return false;
        continue;
      }
      at += 1;
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (depth === 0) return true;
    }
    return false;
  }

  if (!gap()) return undefined;
  // Annotations, each a name and perhaps its arguments: `@Deprecated`, `@Value.Style(…)`.
  while (text[at] === '@') {
    at += 1;
    if (!gap() || qualified() === undefined || !gap()) return undefined;
    if (text[at] === '(' && (!parenthesized() || !gap())) return undefined;
  }
  const keyword = name();
  if (keyword === undefined) return undefined;
  if (keyword !== 'package') return '';
  const declared = gap() ? qualified() : undefined;
  return declared !== undefined && gap() && text[at] === ';' ? declared : undefined;
}

/**
 * Why JDT LS mustn't run on the checkout at `root`, or `undefined` when it may: a `.settings` at
 * its root, which JDT LS would link its project's settings to, so that it read them as its own and
 * wrote its own there. The disk may not tell names apart by case or Unicode form, so neither does
 * this ({@link foldName}). It's the reason alone, as `checkoutProblem`'s is.
 */
export async function jdtlsCheckoutProblem(root: string): Promise<string | undefined> {
  const names = await readdir(root);
  const settings = names.find((name) => foldName(name) === '.settings');
  if (settings === undefined) return undefined;
  return `The repository commits Eclipse’s ${settings} folder at its root. Java’s server would read its settings from that folder, and write to it.`;
}
