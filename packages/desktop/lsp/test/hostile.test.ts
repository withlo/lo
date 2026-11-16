// Each server Lo runs, started as its adapter starts it on the hostile fixture's checkout
// (`testing/fixtures/code-hostile.sh --local`), with the fake server standing in for it: Node with
// the server's flags, or the server's own program, with its toolchain's variables, its settings and
// its initialization options. The fake server reports what it got, and asks for every setting the
// checkout's plants would set. Nothing the fixture plants runs: the fake server runs nothing, and
// the plants are read as text, from the bare repository.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { git, testGitEnvironment } from '@lo/testing/git';
import { FAKE_SERVER, fakeServer, readReport, type Seen } from '@lo/testing/lsp';
import { afterAll, beforeAll, expect, onTestFinished, test } from 'vitest';

import {
  checkoutProblem,
  GOPLS,
  type Launch,
  launchNative,
  launchOnNode,
  NO_NETWORK,
  NO_PYTHON,
  NO_TERRAFORM,
  type NativeServer,
  type NodeServer,
  PYRIGHT,
  startServer,
  TERRAFORM_LS,
  toolchainUse,
  VTSLS,
} from '../src/index.ts';
import { eventually, GIT, tempFolder } from './support.ts';

const SCRIPT = fileURLToPath(
  new URL('../../../../testing/fixtures/code-hostile.sh', import.meta.url),
);

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

/** A server, and how its adapter would start it, with the fake server in its place. */
type Subject =
  | { readonly kind: 'node'; readonly server: NodeServer }
  | { readonly kind: 'native'; readonly server: NativeServer; readonly toolchains?: string[] };

/** How `subject` starts, the fake server's `scenario` in place of the server's own. */
function launchOf(subject: Subject, own: string, scenario: string): Launch {
  if (subject.kind === 'node') {
    // Lo's Node is the one running the tests, and the fake server's script is the entry point.
    return launchOnNode(
      { ...subject.server, args: [scenario] },
      { folder: own, entry: process.execPath },
      { folder: own, entry: FAKE_SERVER },
    );
  }
  const toolchains = (subject.toolchains ?? []).map((id) =>
    toolchainUse(id, '1.27.4', { folder: goFolder, entry: `${goFolder}/go/bin/go` }),
  );
  // The server's program is the Node running the tests, its arguments the fake server's.
  const launch = launchNative(subject.server, { folder: own, entry: process.execPath }, toolchains);
  return { ...launch, args: [FAKE_SERVER, scenario] };
}

/**
 * Starts `subject`'s server as its adapter would on the checkout, with the fake server in its
 * place, asking for the settings `sections` once it's initialized, and says what it saw once it
 * has.
 */
async function startAs(subject: Subject, sections: readonly string[]) {
  const own = tempFolder();
  const fake = fakeServer(own, {
    requests: [
      {
        method: 'workspace/configuration',
        params: { items: sections.map((section) => ({ section })) },
      },
    ],
  });
  const launch = launchOf(subject, own, fake.args.at(-1) ?? '');
  const running = startServer({
    name: subject.server.name,
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
  server: Subject,
  ours: readonly string[],
  own: { path?: string[]; env?: (home: string) => Record<string, string> } = {},
) {
  const plants = editorSettings();
  const seen = await startAs(server, [...Object.keys(plants), ...ours]);
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
  // hears names a file of the checkout, or is what the checkout's editor settings say.
  expect(initialize).toMatchObject({ capabilities: { workspace: { configuration: true } } });
  expect(JSON.stringify([heard, initialize.initializationOptions ?? null])).not.toContain(checkout);
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
  const { heard, plants } = await heardBy({ kind: 'node', server: VTSLS }, [
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
  const { heard, plants } = await heardBy({ kind: 'node', server: PYRIGHT }, [
    'python.pythonPath',
    'python.venvPath',
  ]);
  expect(plants['python.defaultInterpreterPath']).toContain('lo-server.sh');
  expect(heard).toMatchObject({
    'python.defaultInterpreterPath': null,
    'python.pythonPath': NO_PYTHON,
    'python.venvPath': null,
  });
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
    { kind: 'native', server: GOPLS, toolchains: ['go'] },
    ['gopls.build.env', 'gopls.build.buildFlags', 'gopls.vulncheck'],
    {
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
  const { initialize, plants } = await heardBy({ kind: 'native', server: TERRAFORM_LS }, []);
  expect(plants['terraform.languageServer.terraform.path']).toContain('lo-server.sh');
  expect(initialize.initializationOptions).toMatchObject({ terraform: { path: NO_TERRAFORM } });
});
