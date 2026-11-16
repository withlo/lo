// Java's server, JDT LS, as its adapter starts it on Lo's JDK: what runs, with which flags, what
// it's told where it runs, the source folders Lo finds for it, and the checkouts it refuses. No
// server runs here; `test/hostile.test.ts` starts it as Lo would, with the fake server standing in.

import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { tempFolder } from '../../test/support.ts';
import type { Installed } from '../install.ts';
import { MANIFEST } from '../manifest.ts';
import { sectionOf } from '../requests.ts';
import { LIMITS } from '../server.ts';
import { toolchainUse } from '../toolchains.ts';
import { fileUri } from '../uri.ts';
import {
  gradleProperties,
  JDTLS,
  JDTLS_HEAP,
  jdtlsCheckoutProblem,
  jdtlsSettings,
  launchJdtls,
  placeJdtls,
  SOURCE_FILES,
  SOURCE_FOLDERS,
  sourcePaths,
  TRIGGER,
} from './jdtls.ts';

const VERSION = MANIFEST.jdtls?.version ?? '';

/** JDT LS, installed as the manifest pins it. */
const INSTALLED: Installed = {
  folder: `/lo/cache/servers/jdtls/${VERSION}/files`,
  entry: `/lo/cache/servers/jdtls/${VERSION}/files/${MANIFEST.jdtls?.platforms.any?.entry ?? ''}`,
};

/** Lo's Temurin JDK, installed, and what a server gets of it. */
const JDK: Installed = {
  folder: '/lo/cache/toolchains/temurin/25/files',
  entry: '/lo/cache/toolchains/temurin/25/files/jdk-25/Contents/Home/bin/java',
};
const JAVA_HOME = '/lo/cache/toolchains/temurin/25/files/jdk-25/Contents/Home';
const USE = toolchainUse('temurin', '25', JDK);

function launch() {
  return launchJdtls(INSTALLED, JDK, USE, 'darwin-arm64');
}

/** What JDT LS hears when it asks for the setting `section`, as `settings` hold it. */
function setting(settings: unknown, section: string): unknown {
  return sectionOf(settings, section);
}

/** Writes `files`, by their paths in `root`, each with its text. */
function write(root: string, files: Readonly<Record<string, string>>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

describe('JDT LS', () => {
  test('starts as Lo’s JDK’s java, by Equinox’s launcher, with Lo’s flags alone', () => {
    const pinned = MANIFEST.jdtls;
    expect(pinned?.hosts).toEqual(['download.eclipse.org']);
    // One archive for every platform, from Eclipse's own downloads.
    expect(Object.keys(pinned?.platforms ?? {})).toEqual(['any']);
    const download = pinned?.platforms.any;
    expect(download?.kind).toBe('tar.gz');
    expect(download?.kind === 'tar.gz' && download.url).toMatch(
      new RegExp(`^https://download\\.eclipse\\.org/jdtls/milestones/${VERSION}/`),
    );
    expect(download?.entry).toMatch(/^plugins\/org\.eclipse\.equinox\.launcher_[^/]+\.jar$/);

    const { program, args, path, variables, allowed } = launch();
    expect(program).toBe(JDK.entry);
    expect(USE.variables).toEqual({ JAVA_HOME });
    expect([path, variables]).toEqual([USE.path, { JAVA_HOME }]);
    // Gradle's home is Lo's, in the server's own.
    expect(allowed).toEqual(['GRADLE_USER_HOME']);
    expect(launch().homeFolders).toEqual({ GRADLE_USER_HOME: 'gradle' });
    // Its classes are the launcher's alone, never the folder it runs in.
    expect(args.slice(-2)).toEqual(['-jar', INSTALLED.entry]);
    expect(
      args.filter((arg) => /^-(?:cp|classpath|javaagent|agentlib|agentpath)\b/.test(arg)),
    ).toEqual([]);
    expect(args).toContain(`-Djava.library.path=${JAVA_HOME}/lib`);
    expect(args).toContain('-Xlog:all=warning:stderr');
    expect(args).toContain(`-Dosgi.sharedConfiguration.area=${INSTALLED.folder}/config_mac_arm`);
    expect(args).toContain('-Dosgi.sharedConfiguration.area.readOnly=true');
    expect(launchJdtls(INSTALLED, JDK, USE, 'linux-x64').args).toContain(
      `-Dosgi.sharedConfiguration.area=${INSTALLED.folder}/config_linux`,
    );
  });

  test('holds its heap under Lo’s cap on its group, with room for the rest of a JVM', () => {
    expect(launch().args.filter((arg) => arg.startsWith('-Xmx'))).toEqual([`-Xmx${JDTLS_HEAP}m`]);
    // A gigabyte for its classes, compiled code, threads and buffers: it held about 850 MB in all
    // on the sample projects.
    expect(JDTLS_HEAP + 1024).toBeLessThanOrEqual(LIMITS.memoryCap / 1024 ** 2);
  });

  test('uses no proxy, for Eclipse’s networking or the JVM’s, and names none', () => {
    // A proxy looks names up itself, past the hosts file: JDT LS would give Eclipse the system's.
    expect(launch().args.filter((arg) => /prox(?:y|ies)/i.test(arg))).toEqual([
      '-Djdt.ls.disableProxies=true',
      '-Djava.net.useSystemProxies=false',
    ]);
  });

  test('refuses what it can’t start', () => {
    expect(() => launchJdtls({ folder: 'jdtls', entry: 'jdtls/launcher.jar' }, JDK, USE)).toThrow(
      "jdtls isn't an absolute path",
    );
    expect(() => launchJdtls(INSTALLED, JDK, { ...USE, variables: {} }, 'darwin-arm64')).toThrow(
      'doesn’t say where its home is',
    );
    expect(() => launchJdtls(INSTALLED, JDK, USE, 'darwin-arm64', {})).toThrow('has no jdtls');
  });

  test('says what it is, and restarts rather than moves, since it finds its folders as it starts', () => {
    const started = launch();
    expect(started.version).toBe(`Eclipse JDT LS ${VERSION} · EPL-2.0`);
    expect(started.stays).toBe(true);
    expect(JDTLS.hints).toBe(true);
    // The README lists it with its version, source and license.
    const readme = readFileSync(join(import.meta.dirname, '..', '..', 'README.md'), 'utf8');
    expect(readme).toMatch(
      new RegExp(`^\\| ${JDTLS.name} +\\| ${VERSION} +\\|.*\\| EPL-2\\.0 `, 'm'),
    );
  });

  test('imports nothing, builds nothing, and keeps Gradle and Maven offline', () => {
    const settings = jdtlsSettings(['src/main/java']);
    expect(launch().settings).toEqual(jdtlsSettings([]));
    // No folder is searched for a build file, so Eclipse's import, which no setting turns off,
    // finds no `.project`, and Gradle's and Maven's find nothing either.
    expect(setting(settings, 'java.import.exclusions')).toEqual(['**']);
    expect(setting(settings, 'java.import.gradle')).toEqual({
      enabled: false,
      wrapper: { enabled: false },
      offline: { enabled: true },
      annotationProcessing: { enabled: false },
    });
    expect(setting(settings, 'java.import.maven')).toEqual({
      enabled: false,
      offline: { enabled: true },
    });
    expect(setting(settings, 'java.import.generatesMetadataFilesAtProjectRoot')).toBe(false);
    expect(setting(settings, 'java.configuration.updateBuildConfiguration')).toBe('disabled');
    expect(setting(settings, 'java.autobuild.enabled')).toBe(false);
    expect(setting(settings, 'java.maven.downloadSources')).toBe(false);
    expect(setting(settings, 'java.eclipse.downloadSources')).toBe(false);
    expect(setting(settings, 'java.telemetry.enabled')).toBe(false);
    // Its project's source folders are Lo's, and the hints `gh` shows are on.
    expect(setting(settings, 'java.project.sourcePaths')).toEqual(['src/main/java']);
    expect(setting(settings, 'java.inlayHints.parameterNames.enabled')).toBe('literals');
    expect(setting(settings, 'java.inlayHints.variableTypes.enabled')).toBe(true);
  });

  test('keeps what it writes, and Gradle’s home, in its own, and resolves no host', async () => {
    const root = tempFolder();
    const home = join(tempFolder(), 'home');
    write(root, { 'app/src/main/java/a/B.java': 'package a;\nclass B {}\n' });
    const placed = await placeJdtls({ root, home }, JAVA_HOME);
    expect(placed.args).toEqual([
      `-Duser.home=${home}`,
      `-Djava.io.tmpdir=${home}/tmp`,
      `-Dosgi.configuration.area=${home}/configuration`,
      `-Dosgi.instance.area=${home}/workspace`,
      `-Djdk.net.hosts.file=${home}/hosts`,
    ]);
    expect(placed.variables).toBeUndefined();
    expect(placed.files).toEqual({
      'gradle/gradle.properties': gradleProperties(JAVA_HOME),
      // No line that isn't a comment, so no name has an address.
      hosts: expect.stringMatching(/^#[^\n]*\n$/),
    });
    const settings = jdtlsSettings(['app/src/main/java']);
    expect(placed.settings).toEqual(settings);
    // It makes its project at once, from a file at the root, as if it had been opened.
    expect(placed.initializationOptions).toEqual({
      settings,
      triggerFiles: [fileUri(root, TRIGGER)],
    });
  });

  test('gives a Gradle that ran Lo’s JDK, and no other', () => {
    expect(gradleProperties('/lo/jdk').split('\n').slice(1)).toEqual([
      'org.gradle.java.home=/lo/jdk',
      'org.gradle.java.installations.auto-detect=false',
      'org.gradle.java.installations.auto-download=false',
      '',
    ]);
    expect(gradleProperties('C:\\lo\\jdk')).toContain('org.gradle.java.home=C:\\\\lo\\\\jdk\n');
  });
});

describe('sourcePaths', () => {
  test('finds the folder each file’s package starts from', async () => {
    const root = tempFolder();
    write(root, {
      'java/src/main/java/sample/Words.java': 'package sample;\n',
      'java/src/main/java/sample/deep/Report.java': 'package sample.deep;\n',
      'java/src/test/java/sample/WordsTest.java': '/* A test. */\npackage sample;\n',
      // Comments and annotations before the name, and in it.
      'lib/src/x/y/Z.java':
        '// x.y\n@Deprecated\n@SuppressWarnings({"all"})\npackage /* here */ x . y ;\n',
      // The default package, in a folder of its own.
      'scripts/Tool.java': 'class Tool {}\n',
    });
    expect(await sourcePaths(root)).toEqual([
      'java/src/main/java',
      'java/src/test/java',
      'lib/src',
      'scripts',
    ]);
  });

  test('takes no folder from a file that disagrees with its path, or is at the root', async () => {
    const root = tempFolder();
    write(root, {
      // Its package isn't the folders it's in.
      'src/a/B.java': 'package b;\n',
      // The root itself would make everything code.
      'Main.java': 'class Main {}\n',
      'Other.java': 'package other;\n',
      // A comment that never ends.
      'src/c/D.java': '/* package c;\n',
    });
    expect(await sourcePaths(root)).toEqual([]);
  });

  test('takes no folder of a file in no package from inside another source folder', async () => {
    const root = tempFolder();
    write(root, {
      'src/main/java/com/example/A.java': 'package com.example;\nclass A {}\n',
      // JDT LS would leave this folder out of the one around it, and com.example with it.
      'src/main/java/com/example/Scratch.java': 'class Scratch {}\n',
      'tools/Tool.java': 'class Tool {}\n',
      'tools/more/Other.java': 'class Other {}\n',
      // Around another source folder, it's one JDT LS leaves the inner one out of, as it should.
      'scripts/Run.java': 'class Run {}\n',
      'scripts/lib/x/Y.java': 'package x;\n',
    });
    expect(await sourcePaths(root)).toEqual(['scripts', 'scripts/lib', 'src/main/java', 'tools']);
  });

  test('reads past annotations whatever they hold, and takes no folder from a file it can’t read', async () => {
    const root = tempFolder();
    write(root, {
      'src/main/java/com/example/A.java': 'package com.example;\nclass A {}\n',
      // JAXB's namespace: a `//` in a string.
      'src/main/java/com/example/package-info.java':
        '@XmlSchema(namespace = "http://example.com/a", elementFormDefault = XmlNsForm.QUALIFIED)\n' +
        'package com.example;\n',
      // Immutables' style: parentheses in parentheses.
      'src/main/java/com/example/style/package-info.java':
        '@Value.Style(defaults = @Value.Immutable(copy = false), typeImmutable = "*")\n' +
        'package com.example.style;\n',
      // A text block, characters and comments, holding what would end them, or the parentheses.
      'src/main/java/com/example/odd/package-info.java':
        '@A(x = """\n  ) " // \\""" ) """, c = \')\', d = "\\")") /* ) */ @B\n' +
        'package com.example.odd;\n',
      // Parentheses that never close, and a declaration that never ends.
      'other/x/y/package-info.java': '@A(value = "x"\npackage x.y;\n',
      'other/x/z/package-info.java': '@A\npackage x.z\n',
    });
    // No folder inside another, which would break every answer in the package.
    expect(await sourcePaths(root)).toEqual(['src/main/java']);
  });

  test('looks in so many folders and reads so many files, the nearest the root first', async () => {
    const root = tempFolder();
    write(root, { 'a/src/p/A.java': 'package p;\n', 'b/src/q/B.java': 'package q;\n' });
    // The root, then a and b, a/src and b/src, then a/src/p and b/src/q.
    expect(await sourcePaths(root)).toEqual(['a/src', 'b/src']);
    expect(await sourcePaths(root, { folders: 7, files: 2 })).toEqual(['a/src', 'b/src']);
    expect(await sourcePaths(root, { folders: 6, files: 2 })).toEqual(['a/src']);
    expect(await sourcePaths(root, { folders: 7, files: 1 })).toEqual(['a/src']);
    expect([SOURCE_FOLDERS, SOURCE_FILES]).toEqual([20_000, 20_000]);
  });

  test('looks in no hidden folder or node_modules, and follows no link', async () => {
    const root = tempFolder();
    const outside = tempFolder();
    write(outside, { 'src/o/P.java': 'package o;\n' });
    write(root, {
      '.hidden/src/h/I.java': 'package h;\n',
      'node_modules/pkg/src/n/M.java': 'package n;\n',
      'real/src/r/S.java': 'package r;\n',
    });
    symlinkSync(join(outside, 'src'), join(root, 'linked'));
    symlinkSync(join(outside, 'src', 'o', 'P.java'), join(root, 'real', 'src', 'r', 'Q.java'));
    expect(await sourcePaths(root)).toEqual(['real/src']);
  });
});

describe('jdtlsCheckoutProblem', () => {
  test('refuses a checkout whose root holds a .settings, of any kind, in any case', async () => {
    const root = tempFolder();
    write(root, { 'java/.settings/org.eclipse.jdt.core.prefs': '', 'README.md': '' });
    // Anywhere but the root, it's a folder of files.
    expect(await jdtlsCheckoutProblem(root)).toBeUndefined();
    mkdirSync(join(root, '.settings'));
    // Plainly: what the repository holds, and why that keeps Java's server off it.
    expect(await jdtlsCheckoutProblem(root)).toBe(
      'The repository commits Eclipse’s .settings folder at its root. ' +
        'Java’s server would read its settings from that folder, and write to it.',
    );

    const file = tempFolder();
    writeFileSync(join(file, '.Settings'), '');
    expect(await jdtlsCheckoutProblem(file)).toMatch(
      /^The repository commits Eclipse’s \.Settings /,
    );

    const link = tempFolder();
    symlinkSync(tempFolder(), join(link, '.SETTINGS'));
    expect(await jdtlsCheckoutProblem(link)).toContain('.SETTINGS');

    // A long s, which a Mac’s disk opens as .settings.
    const long = tempFolder();
    mkdirSync(join(long, '.\u017Fettings'));
    expect(await jdtlsCheckoutProblem(long)).toContain('.\u017Fettings');
  });
});
