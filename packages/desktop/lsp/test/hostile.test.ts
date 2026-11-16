// Each server Lo runs, started as its adapter starts it on the hostile fixture's checkout
// (`testing/fixtures/code-hostile.sh --local`), with the fake server standing in for it: Node with
// the server's flags, or as its program, with its toolchain's variables, its settings, its
// initialization options and what it's given where it runs. The fake server reports what it got,
// and asks for every setting the checkout's plants would set.
// Nothing the fixture plants runs: the fake server runs nothing, and the plants are read as text,
// from the bare repository.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { git, testGitEnvironment } from '@lo/testing/git';
import { FAKE_SERVER, fakeServer, readReport, type Seen } from '@lo/testing/lsp';
import { afterAll, beforeAll, expect, onTestFinished, test } from 'vitest';

import {
  checkoutProblem,
  GOPLS,
  type Installed,
  JDTLS,
  jdtlsCheckoutProblem,
  jdtlsSettings,
  type Launch,
  launchJdtls,
  launchNative,
  launchOnNode,
  type NativeServer,
  NO_NETWORK,
  NO_PYTHON,
  NO_TERRAFORM,
  type NodeServer,
  PHP_LSP,
  PHP_VERSION,
  PYRIGHT,
  startServer,
  TERRAFORM_LS,
  toolchainUse,
  type ToolchainUse,
  TRIGGER,
  VTSLS,
} from '../src/index.ts';
import { fileUri } from '../src/uri.ts';
import { eventually, GIT, tempFolder } from './support.ts';

const SCRIPT = fileURLToPath(
  new URL('../../../../testing/fixtures/code-hostile.sh', import.meta.url),
);

/** PHP's tools the fixture plants in `vendor/bin`. */
const PHP_TOOLS = [
  'phpcs',
  'phpcbf',
  'phpstan',
  'phpmd',
  'mago',
  'pint',
  'php-cs-fixer',
  'phpunit',
];

let folder = '';
/** The hostile pull request's checkout, as the system resolves it. */
let checkout = '';
let bare = '';

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), 'lo-hostile-'));
  execFileSync('bash', [SCRIPT, '--local', folder], {
    env: testGitEnvironment(),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  checkout = realpathSync(join(folder, 'work'));
  bare = join(folder, 'rozed-dev', 'e2e.git');
  goFolder = join(realpathSync(folder), 'toolchains', 'go');
  mkdirSync(join(goFolder, 'go', 'bin'), { recursive: true });
  jdkFolder = join(realpathSync(folder), 'toolchains', 'temurin');
  mkdirSync(join(jdkFolder, 'jdk', 'bin'), { recursive: true });
});

afterAll(() => {
  if (folder !== '') rmSync(folder, { recursive: true, force: true });
});

/** The text of `path` in the hostile pull request, from the bare repository. */
function planted(path: string): string {
  return git(bare, 'show', `code/hostile:${path}`);
}

/** Every setting the checkout's `.vscode/settings.json` sets, by its name. */
function editorSettings(): Record<string, unknown> {
  const settings: unknown = JSON.parse(planted('.vscode/settings.json'));
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    throw new Error('the planted editor settings aren’t an object');
  }
  return Object.fromEntries(Object.entries(settings));
}

/** Lo's Go, as the tests stand it in: a folder beside the checkout, with nothing in it. */
let goFolder = '';

/** Lo's Go, as `toolchainUse` gives it, installed in {@link goFolder}. */
function goUse(): ToolchainUse {
  return toolchainUse('go', '1.27.4', { folder: goFolder, entry: `${goFolder}/go/bin/go` });
}

/** Lo's JDK, as the tests stand it in: a folder beside the checkout, with nothing in it. */
let jdkFolder = '';

/** Lo's JDK, as installed in {@link jdkFolder}. */
function jdk(): Installed {
  return { folder: jdkFolder, entry: `${jdkFolder}/jdk/bin/java` };
}

/** Whether `server` is JDT LS, which runs on Lo's JDK. */
function isJdtls(server: NodeServer | NativeServer | typeof JDTLS): server is typeof JDTLS {
  return server === JDTLS;
}

/**
 * How `server`'s adapter starts it from its install in `own`, with `toolchains`, and with the fake
 * server, on `scenario`, in its place. Lo's Node is the one running the tests: a server on Lo's
 * Node has the fake server's script as its entry point, and a program of its own, or JDT LS on
 * Lo's JDK, is Node with that script. JDT LS is given what it would be where it runs, but the
 * JVM's flags, which Node would refuse.
 */
function standIn(
  server: NodeServer | NativeServer | typeof JDTLS,
  own: string,
  scenario: string,
  toolchains: readonly ToolchainUse[],
): Launch {
  const node = { folder: own, entry: process.execPath };
  if (isJdtls(server)) {
    const use = toolchains[0] ?? toolchainUse('temurin', '25', jdk());
    const launch = launchJdtls({ folder: own, entry: `${own}/launcher.jar` }, jdk(), use);
    const { place } = launch;
    return {
      ...launch,
      program: process.execPath,
      args: [FAKE_SERVER, scenario],
      place: async (where) => ({ ...(place === undefined ? {} : await place(where)), args: [] }),
    };
  }
  return 'node' in server
    ? launchOnNode({ ...server, args: [scenario] }, node, { folder: own, entry: FAKE_SERVER })
    : launchNative({ ...server, args: [FAKE_SERVER, scenario] }, node, toolchains);
}

/**
 * Starts `server` as its adapter would on the checkout, with `toolchains` and the fake server in
 * its place, asking for the settings `sections` once it's initialized, and says what it saw once
 * it has.
 */
async function startAs(
  server: NodeServer | NativeServer | typeof JDTLS,
  sections: readonly string[],
  toolchains: readonly ToolchainUse[] = [],
) {
  const own = tempFolder();
  const fake = fakeServer(own, {
    requests: [
      {
        method: 'workspace/configuration',
        params: { items: sections.map((section) => ({ section })) },
      },
    ],
  });
  const launch = standIn(server, own, fake.args.at(-1) ?? '', toolchains);
  const running = startServer({
    name: server.name,
    program: launch.program,
    args: launch.args,
    root: checkout,
    home: join(own, 'home'),
    path: launch.path ?? [],
    variables: launch.variables,
    allowed: launch.allowed,
    homeFolders: launch.homeFolders,
    git: GIT,
    settings: launch.settings,
    initializationOptions: launch.initializationOptions,
    place: launch.place,
    stays: launch.stays,
  });
  onTestFinished(async () => {
    if (running.pid !== undefined) {
      try {
        process.kill(-running.pid, 'SIGKILL');
      } catch {
        // It's gone.
      }
    }
    await running.stop();
  });
  expect(await running.ready).toBe(true);
  const reply = await eventually(() =>
    readReport(fake.report).find(
      (seen): seen is Extract<Seen, { event: 'reply' }> =>
        seen.event === 'reply' && seen.method === 'workspace/configuration',
    ),
  );
  const seen = readReport(fake.report);
  const started = seen.find((each) => each.event === 'started');
  const initialize = seen.find((each) => each.event === 'initialize');
  if (started?.event !== 'started' || initialize?.event !== 'initialize') {
    throw new Error('the fake server didn’t report its start');
  }
  const answers = Array.isArray(reply.result) ? (reply.result as unknown[]) : [];
  return {
    home: realpathSync(join(own, 'home')),
    started,
    initialize: initialize.params,
    heard: Object.fromEntries(sections.map((section, at) => [section, answers[at]])),
  };
}

/**
 * Starts `server` as Lo would on the checkout, asking for each setting the checkout's editor
 * settings set and for `ours`, and checks what holds for every server: it runs in the checkout with
 * an environment of Lo's alone, its toolchain's `own` aside, and hears nothing the checkout says.
 */
async function heardBy(
  server: NodeServer | NativeServer | typeof JDTLS,
  ours: readonly string[],
  own: {
    toolchains?: ToolchainUse[];
    path?: string[];
    env?: (home: string) => Record<string, string>;
  } = {},
) {
  const plants = editorSettings();
  const seen = await startAs(server, [...Object.keys(plants), ...ours], own.toolchains);
  const { started, initialize, heard, home } = seen;
  expect(started.cwd).toBe(checkout);
  // Its own home and the system's folders, git's settings, a proxy that leads nowhere, and nothing
  // of the checkout's. macOS sets its text encoding in a process itself, as the process loads
  // CoreFoundation.
  const { __CF_USER_TEXT_ENCODING: _system, ...env } = started.env;
  expect(env).toEqual({
    ...GIT,
    ...own.env?.(home),
    HOME: home,
    TMPDIR: join(home, 'tmp'),
    PATH: [...(own.path ?? []), '/usr/bin', '/bin'].join(':'),
    HTTPS_PROXY: NO_NETWORK,
    https_proxy: NO_NETWORK,
    HTTP_PROXY: NO_NETWORK,
    http_proxy: NO_NETWORK,
    ALL_PROXY: NO_NETWORK,
    all_proxy: NO_NETWORK,
    LANG: 'C.UTF-8',
  });
  // It asks Lo for its settings, so it reads none from the checkout's files, and no setting it
  // hears names a file of the checkout, or is what the checkout's editor settings say. The one
  // path JDT LS is told is the file it starts its project from, at the checkout's root, which no
  // checkout has.
  expect(initialize).toMatchObject({ capabilities: { workspace: { configuration: true } } });
  const options: unknown = initialize.initializationOptions ?? null;
  const told =
    typeof options === 'object' && options !== null && 'triggerFiles' in options
      ? { ...options, triggerFiles: null }
      : options;
  expect(JSON.stringify([heard, told])).not.toContain(checkout);
  for (const [name, value] of Object.entries(plants)) {
    expect({ [name]: heard[name] }).not.toEqual({ [name]: value });
  }
  return { ...seen, plants };
}

test('vtsls runs its own TypeScript, with no plugin, whatever the checkout plants', async () => {
  // The checkout has a TypeScript and a plugin of its own, a tsconfig.json naming the plugin, and
  // a registry for npm.
  expect(planted('node_modules/typescript/lib/tsserver.js')).toContain('lo-hostile-tsserver');
  expect(planted('typescript/tsconfig.json')).toContain('hostile-plugin');
  expect(planted('typescript/.npmrc')).toContain('npm.lo-hostile.invalid');
  const { heard, plants } = await heardBy(VTSLS, [
    'vtsls.autoUseWorkspaceTsdk',
    'vtsls.tsserver.globalPlugins',
    'typescript.disableAutomaticTypeAcquisition',
    'typescript.npm',
    'typescript.tsserver.nodePath',
  ]);
  expect(plants['typescript.tsdk']).toBe('node_modules/typescript/lib');
  expect(heard).toMatchObject({
    'typescript.tsdk': null,
    'vtsls.autoUseWorkspaceTsdk': false,
    'typescript.tsserver.pluginPaths': [],
    'vtsls.tsserver.globalPlugins': [],
    'typescript.disableAutomaticTypeAcquisition': true,
    'typescript.npm': null,
    'typescript.tsserver.nodePath': null,
  });
});

test('Pyright gets no interpreter, whatever the checkout names', async () => {
  // A version for a version manager's `python`, and an interpreter for an editor's.
  expect(planted('python/.python-version')).not.toBe('');
  const { heard, plants } = await heardBy(PYRIGHT, ['python.pythonPath', 'python.venvPath']);
  expect(plants['python.defaultInterpreterPath']).toContain('lo-server.sh');
  expect(heard).toMatchObject({
    'python.defaultInterpreterPath': null,
    'python.pythonPath': NO_PYTHON,
    'python.venvPath': null,
  });
});

test('php-lsp runs no tool, and keeps its cache in its home, whatever the checkout plants', async () => {
  // PHP's tools, where Composer installs them, a package's class committed in `vendor/`, and
  // php-lsp's settings for the repository, which turn two of the tools on, put its cache in the
  // checkout, read code as another PHP and index `vendor/`.
  for (const tool of PHP_TOOLS) {
    expect(planted(`vendor/bin/${tool}`)).toContain(`lo-hostile-${tool}`);
  }
  expect(planted('vendor/acme/planted/src/Planted.php')).toContain('class Planted');
  expect(JSON.parse(planted('.php-lsp.json'))).toEqual({
    externalTools: {
      phpstan: { enabled: true, binPath: 'vendor/bin/phpstan' },
      phpcs: { enabled: true, binPath: 'vendor/bin/phpcs' },
    },
    cachePath: 'lo-hostile-php-lsp-cache',
    phpVersion: '7.4',
    indexVendor: true,
  });
  const { started, heard, initialize, home } = await heardBy(PHP_LSP, ['php-lsp']);
  // Each of Lo's is set, and wins over the repository's file key by key: a PHP, so it runs no
  // `php` to ask, `vendor/` skipped, and the tools off.
  const told = {
    phpVersion: PHP_VERSION,
    indexVendor: false,
    externalTools: { phpstan: { enabled: false }, phpcs: { enabled: false } },
  };
  expect(initialize.initializationOptions).toEqual(told);
  // It hears the same if it asks again, as it does once its settings change.
  expect(heard['php-lsp']).toEqual(told);
  // Named no `cachePath`, it keeps its cache in `$XDG_CACHE_HOME`, or else in `.cache` in its
  // `HOME`. It gets no `XDG_CACHE_HOME`, and its `HOME` is its own folder, outside the checkout.
  expect(started.env).not.toHaveProperty('XDG_CACHE_HOME');
  expect(started.env.HOME).toBe(home);
  expect(home.startsWith(`${checkout}/`)).toBe(false);
});

test('gopls runs with Lo’s Go alone, whatever the checkout plants for Go', async () => {
  // A workspace and a module asking for another Go, a generator, a cgo file, a package driver
  // where direnv would put it on PATH, and editor settings that would add flags and a driver.
  expect(planted('go.work')).toContain('toolchain go1.99.9');
  expect(planted('go/go.mod')).toContain('toolchain go1.99.9');
  expect(planted('go/generate.go')).toContain('//go:generate');
  expect(planted('go/cgo.go')).toContain('#cgo pkg-config');
  expect(planted('.envrc')).toContain('hostile/bin');
  expect(planted('hostile/bin/gopackagesdriver')).toContain('lo-hostile-gopackagesdriver');
  // The checkout's go.work names only its own folder, so the server starts on it.
  expect(await checkoutProblem('go', checkout)).toBeUndefined();
  const { heard, plants } = await heardBy(
    GOPLS,
    ['gopls.build.env', 'gopls.build.buildFlags', 'gopls.vulncheck'],
    {
      toolchains: [goUse()],
      path: [`${goFolder}/go/bin`],
      env: (home) => ({
        GOROOT: `${goFolder}/go`,
        GOTOOLCHAIN: 'local',
        GOENV: 'off',
        GOPROXY: 'off',
        GOFLAGS: '',
        CGO_ENABLED: '0',
        GOPACKAGESDRIVER: 'off',
        GOMEMLIMIT: '3072MiB',
        GOPATH: join(home, 'go'),
        GOMODCACHE: join(home, 'go', 'pkg', 'mod'),
        GOCACHE: join(home, 'cache', 'go-build'),
      }),
    },
  );
  expect(plants.gopls).toMatchObject({ 'build.env': { GOPACKAGESDRIVER: expect.any(String) } });
  expect(heard).toMatchObject({
    'gopls.build.env': null,
    'gopls.build.buildFlags': null,
    'gopls.vulncheck': 'Off',
  });
});

test('terraform-ls gets no Terraform it can run, whatever the checkout names or holds', async () => {
  // A provider's plugin with the lock file that takes it as installed, and a `terraform` where
  // direnv would put it on PATH.
  const provider = 'hostile/terraform-provider/.terraform/providers/registry.terraform.io';
  expect(
    planted(`${provider}/hashicorp/null/9.9.9/linux_amd64/terraform-provider-null_v9.9.9`),
  ).toContain('lo-hostile-terraform-provider');
  expect(planted('hostile/terraform-provider/.terraform.lock.hcl')).toContain('hashicorp/null');
  expect(planted('hostile/bin/terraform')).toContain('lo-hostile-terraform');
  const { initialize, plants } = await heardBy(TERRAFORM_LS, []);
  expect(plants['terraform.languageServer.terraform.path']).toContain('lo-server.sh');
  expect(initialize.initializationOptions).toMatchObject({ terraform: { path: NO_TERRAFORM } });
});

test('JDT LS imports nothing and builds nothing, on Lo’s JDK, whatever the checkout plants', async () => {
  // Gradle's wrapper, a settings script that runs a program, properties naming a JDK in the
  // checkout; Maven's build, extensions and launcher's options; Eclipse's project, with a builder,
  // annotation processing and settings; and the JVM's own options file.
  expect(planted('java/gradlew')).toContain('lo-hostile-gradlew');
  expect(planted('java/settings.gradle')).toContain('lo-gradle-settings.sh');
  expect(planted('java/gradle.properties')).toContain('org.gradle.java.home=jdk');
  expect(planted('java/jdk/bin/java')).toContain('lo-hostile-gradle-java');
  expect(planted('java/pom.xml')).toContain('maven.lo-hostile.invalid');
  expect(planted('java/.mvn/extensions.xml')).toContain('core-extension');
  expect(planted('java/.project')).toContain('ExternalToolBuilder');
  expect(planted('java/.factorypath')).toContain('lo-processor.jar');
  expect(planted('java/.settings/org.eclipse.jdt.apt.core.prefs')).toContain('aptEnabled=true');
  expect(planted('.hotspotrc')).toContain('lo-hostile-hotspotrc');
  // Its settings are in java/, not at the root, where JDT LS would take them as its project's.
  expect(await checkoutProblem('temurin', checkout)).toBeUndefined();
  expect(await jdtlsCheckoutProblem(checkout)).toBeUndefined();
  // Lo's JDK alone, first on its `PATH`, and Gradle's home in its own.
  const javaHome = `${jdkFolder}/jdk`;
  const { heard, initialize, home, plants } = await heardBy(
    JDTLS,
    [
      'java.import.exclusions',
      'java.import.gradle',
      'java.import.maven',
      'java.autobuild.enabled',
      'java.project.sourcePaths',
    ],
    {
      toolchains: [toolchainUse('temurin', '25', jdk())],
      path: [`${javaHome}/bin`],
      env: (own) => ({ JAVA_HOME: javaHome, GRADLE_USER_HOME: join(own, 'gradle') }),
    },
  );
  expect(plants['java.jdt.ls.java.home']).toBe('${workspaceFolder}/java/jdk');
  // No folder is searched for a build file, nothing is imported or compiled, and its project's
  // source folders are the ones Lo found from the files' packages.
  expect(heard).toMatchObject({
    'java.jdt.ls.java.home': null,
    'java.configuration.runtimes': null,
    'java.import.exclusions': ['**'],
    'java.import.gradle': { enabled: false, wrapper: { enabled: false } },
    'java.import.maven': { enabled: false },
    'java.autobuild.enabled': false,
    'java.project.sourcePaths': ['java/src/main/java'],
  });
  expect(initialize.initializationOptions).toEqual({
    settings: jdtlsSettings(['java/src/main/java']),
    triggerFiles: [fileUri(checkout, TRIGGER)],
  });
  // What it's given to read is in its home: a Gradle held to Lo's JDK, and the hosts file its JVM
  // looks names up in, which has none. A JVM takes no proxy from the environment.
  expect(readFileSync(join(home, 'gradle', 'gradle.properties'), 'utf8')).toContain(
    `org.gradle.java.home=${javaHome}\n`,
  );
  expect(readFileSync(join(home, 'hosts'), 'utf8')).toMatch(/^#[^\n]*\n$/);
});
