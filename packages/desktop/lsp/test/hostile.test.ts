// Each server Lo runs on its Node, started as its adapter starts it on the hostile fixture's
// checkout (`testing/fixtures/code-hostile.sh --local`), with the fake server standing in for it:
// Node with the server's flags, its settings and its initialization options. The fake server
// reports what it got, and asks for every setting the checkout's plants would set. Nothing the
// fixture plants runs: the fake server runs nothing, and the plants are read as text, from the
// bare repository.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { git, testGitEnvironment } from '@lo/testing/git';
import { FAKE_SERVER, fakeServer, readReport, type Seen } from '@lo/testing/lsp';
import { afterAll, beforeAll, expect, onTestFinished, test } from 'vitest';

import {
  INTELEPHENSE,
  launchOnNode,
  NO_PYTHON,
  type NodeServer,
  PYRIGHT,
  startServer,
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

/**
 * Starts `server` as its adapter would on the checkout, with the fake server in its place, asking
 * for the settings `sections` once it's initialized, and says what it saw once it has.
 */
async function startAs(server: NodeServer, sections: readonly string[]) {
  const own = tempFolder();
  const fake = fakeServer(own, {
    requests: [
      {
        method: 'workspace/configuration',
        params: { items: sections.map((section) => ({ section })) },
      },
    ],
  });
  const scenario = fake.args.at(-1) ?? '';
  // Lo's Node is the one running the tests, and the fake server's script is the entry point.
  const launch = launchOnNode(
    { ...server, args: [scenario] },
    { folder: own, entry: process.execPath },
    { folder: own, entry: FAKE_SERVER },
  );
  const running = startServer({
    name: server.name,
    program: launch.program,
    args: launch.args,
    root: checkout,
    home: join(own, 'home'),
    path: [],
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
 * an environment of Lo's alone, and hears nothing the checkout says.
 */
async function heardBy(server: NodeServer, ours: readonly string[]) {
  const plants = editorSettings();
  const seen = await startAs(server, [...Object.keys(plants), ...ours]);
  const { started, initialize, heard, home } = seen;
  expect(started.cwd).toBe(checkout);
  // Its own home and the system's folders, git's settings, and nothing of the checkout's. macOS
  // sets its text encoding in a process itself, as the process loads CoreFoundation.
  const { __CF_USER_TEXT_ENCODING: _system, ...env } = started.env;
  expect(env).toEqual({
    ...GIT,
    HOME: home,
    TMPDIR: join(home, 'tmp'),
    PATH: '/usr/bin:/bin',
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

test('Intelephense gets no license key, and no telemetry', async () => {
  const { heard, initialize } = await heardBy(INTELEPHENSE, [
    'intelephense.licenceKey',
    'intelephense.telemetry.enabled',
  ]);
  expect(heard).toMatchObject({
    'intelephense.licenceKey': null,
    'intelephense.telemetry.enabled': false,
  });
  expect(initialize.initializationOptions).toBeUndefined();
});
