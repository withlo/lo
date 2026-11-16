// The live check, by hand only, never in CI:
//
//   pnpm nx run lsp:live [-- <id>…]
//
// It installs what servers.json pins for this system, or just the IDs given, into
// ~/.cache/lo-live/servers/, or `$LO_LIVE_CACHE/servers/`, through the same checks Lo makes, so
// each version downloads once, and the toolchains they use beside them, in `toolchains/`. gopls is
// built there, as Lo builds it. Then it runs each one's check below, one at a time. Node says its
// version. A server starts as its adapter starts it, on Lo's Node or as its own program with its
// toolchain, on the checkouts of two pull requests the code fixtures build with `--local`, so no
// network or token is needed: the code fixture's (`testing/fixtures/code.sh`) and the hostile
// fixture's (`code-hostile.sh`), which is the same with files planted to run code. On each it's
// asked what `gd`, `gr`, `K`, `gh` and `gO` ask, at the places in its languages' sample projects
// that `testing/fixtures/code/cases.json` names, printing what came back, how long it took to be
// ready, the most memory its family held and each network connection any of it opened. A server
// that's a program of its own has a folder of stand-ins on its `PATH` after its toolchain's, as
// Lo's git's folder can be Homebrew's: a `terraform`, a `gopackagesdriver`, `pkg-config` and C
// compilers, each writing a marker if run. Then the hostile checkout and that folder are searched
// for the markers its plants write if anything runs them, and the check fails if there's one, or
// if anything connected to another machine. Check the machine has memory to spare before running
// it.

import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { serverGitEnvironment } from '@lo/git';
import { z } from 'zod';

import {
  checkoutProblem,
  GOPLS,
  type Installed,
  Installer,
  type Launch,
  launchNative,
  launchOnNode,
  MANIFEST,
  type NativeServer,
  type NodeServer,
  type Pinned,
  PYRIGHT,
  TERRAFORM_LS,
  TOOLCHAINS,
  toolchainUse,
  type ToolchainUse,
  VTSLS,
} from '../src/index.ts';
import { askServer, type Place } from './ask.ts';

/** A toolchain installed, as a server's adapter gets it. */
interface Toolchain {
  readonly id: string;
  readonly version: string;
  readonly installed: Installed;
  readonly use: ToolchainUse;
}

/** What a check knows: what's pinned, and where everything it has installed is. */
interface Context {
  readonly pinned: Pinned;
  /** Installs another entry, such as the Node a JavaScript server runs on. */
  readonly install: (id: string, go?: Toolchain) => Promise<Installed>;
  /** Installs a toolchain, as `toolchains.json` pins it. */
  readonly toolchain: (id: string) => Promise<Toolchain>;
}

/** Runs what's installed, prints what it found, and throws if it's wrong. */
type Check = (installed: Installed, context: Context) => Promise<void>;

const FIXTURES = join(import.meta.dirname, '..', '..', '..', '..', 'testing', 'fixtures');

/** Where `cases.json` asks about each language's sample project. */
const CASES = z.object({
  cases: z.array(
    z.object({
      language: z.string(),
      at: z.object({ file: z.string(), line: z.number(), character: z.number() }),
    }),
  ),
});

/** The places to ask a server about, for its languages, by the protocol's id for each. */
async function placesFor(languages: Readonly<Record<string, string>>): Promise<Place[]> {
  const { cases } = CASES.parse(
    JSON.parse(await readFile(join(FIXTURES, 'code', 'cases.json'), 'utf8')),
  );
  return cases.flatMap(({ language, at }) => {
    const languageId = languages[language];
    if (languageId === undefined) return [];
    return [{ file: at.file, languageId, position: { line: at.line, character: at.character } }];
  });
}

/**
 * Builds the checkout of `script`'s pull request in `folder`, as its `--local` does, and says
 * where it is. The script writes only there, and runs nothing it plants.
 */
async function checkout(script: string, folder: string): Promise<string> {
  await promisify(execFile)('bash', [join(FIXTURES, script), '--local', folder], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: tmpdir() },
  });
  return join(folder, 'work');
}

/** The markers the hostile fixture's plants write when something runs them, under `folder`. */
async function markers(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true });
  return entries.filter((path) => path.split('/').some((part) => part.startsWith('lo-hostile-')));
}

/** The programs on the `PATH` of a server that's a program of its own, after its toolchain's. */
const STAND_INS = ['terraform', 'gopackagesdriver', 'pkg-config', 'cc', 'gcc', 'clang', 'c++'];

/** Writes {@link STAND_INS} into `folder`, each writing `lo-hostile-path-<name>` if run. */
async function standIns(folder: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  for (const name of STAND_INS) {
    const file = join(folder, name);
    const marker = `lo-hostile-path-${name.replaceAll('+', 'p')}`;
    await writeFile(file, `#!/bin/sh\n: >"$(dirname "$0")/${marker}"\nexit 1\n`);
    await chmod(file, 0o755);
  }
}

/** What a server is, how it starts, and what it uses, for {@link checkOn}. */
interface Started {
  readonly server: { readonly id: string; readonly name: string };
  readonly launch: Launch;
  /** Its PATH's folders, before the system's. */
  readonly path: readonly string[];
  /** The toolchains it uses, whose checks of a checkout it's held to. */
  readonly toolchains: readonly string[];
  /** A folder of stand-ins on its PATH, searched for markers, if it has one. */
  readonly standIns?: string | undefined;
  /** The hostile fixture's files it opens besides, in its language, as a reader's view would. */
  readonly plants?: readonly string[] | undefined;
}

/**
 * Starts `started`'s server on each fixture's checkout in `folder`, asks it about each place in
 * `languages`, and prints what it did. It throws if anything ran what's planted, or reached
 * another machine.
 */
async function checkOn(
  started: Started,
  folder: string,
  languages: Readonly<Record<string, string>>,
): Promise<void> {
  const { server, launch } = started;
  console.log(`${launch.version}: ${[launch.program, ...launch.args].join(' ')}`);
  const places = await placesFor(languages);
  for (const script of ['code.sh', 'code-hostile.sh']) {
    const root = await checkout(script, join(folder, script));
    console.log(`\n--- ${server.name} on the checkout ${script} --local makes`);
    for (const id of started.toolchains) {
      const problem = await checkoutProblem(id, root);
      if (problem !== undefined) throw new Error(`it wouldn't start: ${problem}`);
    }
    const home = join(folder, `home-${script}`);
    const asked = await askServer({
      spec: {
        name: server.name,
        program: launch.program,
        args: launch.args,
        root,
        home,
        path: started.path,
        variables: launch.variables,
        allowed: launch.allowed,
        homeFolders: launch.homeFolders,
        git: serverGitEnvironment(),
        settings: launch.settings,
        initializationOptions: launch.initializationOptions,
      },
      places,
      opened:
        script === 'code-hostile.sh'
          ? (started.plants ?? []).map((file) => ({
              file,
              languageId: places[0]?.languageId ?? '',
            }))
          : [],
    });
    // What it says of plugins, interpreters, programs and the network, the folders' names aside.
    const said = asked.log.filter(
      (line) =>
        // The folders it walks, named after the fixture's, and the jobs it queues and finishes
        // without an error, say nothing of what it did.
        !/walker\.go|discover\.go|Enqueueing new job|Dispatching next job|err = %!s\(<nil>\)/.test(
          line,
        ) &&
        /hostile|plugin|interpreter|pythonPath|terraform\b.*(?:exec|path|version)|registry|proxy|dial|toolchain|generate|cgo|driver|telemetry/i.test(
          line.replaceAll(folder, '').replaceAll(script, 'the fixture'),
        ),
    );
    if (said.length > 0) console.log(`\nIts log, on those:\n${said.slice(-20).join('\n')}`);
    const entries = await readdir(home, { recursive: true });
    const top = entries.filter((path) => path.split('/').length <= 3);
    console.log(`\nIts home holds ${entries.length} entries: ${top.slice(0, 30).join(', ')}`);
    console.log(
      `Ready in ${seconds(asked.ready)}, indexed in ${seconds(asked.indexed)}; at most ` +
        `${Math.round(asked.peak / 1024 ** 2)} MB resident.`,
    );
    const away = asked.connections.filter((line) => !/->(?:127\.0\.0\.1|\[::1\]):/.test(line));
    console.log(
      asked.connections.length === 0
        ? 'Its family opened no network connection.'
        : `Its family's network connections:\n${asked.connections.join('\n')}`,
    );
    if (away.length > 0) throw new Error(`it connected to another machine: ${away.join('; ')}`);
    const found = [
      ...(await markers(root)),
      ...(started.standIns === undefined ? [] : await markers(started.standIns)),
    ];
    if (found.length > 0) throw new Error(`something ran what's planted: ${found.join(', ')}`);
  }
  console.log(`\nNo marker was written: nothing ${server.name} ran was planted.`);
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The check of a server on Lo's Node: it starts as its adapter starts it, on each fixture's
 * checkout, and is asked about each place in its `languages`, by the protocol's id for each.
 */
function onNode(server: NodeServer, languages: Readonly<Record<string, string>>): Check {
  return async (installed, context) => {
    const launch = launchOnNode(server, await context.install('node'), installed);
    const folder = await realpath(await mkdtemp(join(tmpdir(), `lo-live-${server.id}-`)));
    try {
      await checkOn({ server, launch, path: [], toolchains: [] }, folder, languages);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  };
}

/**
 * The check of a server that's a program of its own, using `toolchains`: it starts as its adapter
 * starts it, with stand-ins on its `PATH` after its toolchains' folders. For Go, a `go.work` put
 * in a folder above a checkout then keeps it from starting there.
 */
function native(
  server: NativeServer,
  languages: Readonly<Record<string, string>>,
  options: { readonly toolchains?: readonly string[]; readonly plants?: readonly string[] } = {},
): Check {
  const { toolchains = [], plants } = options;
  return async (installed, context) => {
    const used: Toolchain[] = [];
    for (const id of toolchains) used.push(await context.toolchain(id));
    const launch = launchNative(
      server,
      installed,
      used.map((each) => each.use),
    );
    const folder = await realpath(await mkdtemp(join(tmpdir(), `lo-live-${server.id}-`)));
    try {
      const path = join(folder, 'path');
      await standIns(path);
      const started = {
        server,
        launch,
        path: [...(launch.path ?? []), path],
        toolchains,
        standIns: path,
        plants,
      };
      await checkOn(started, folder, languages);
      if (toolchains.includes('go')) {
        await writeFile(join(folder, 'code.sh', 'go.work'), 'go 1.24\n\nuse ./work/go\n');
        const problem = await checkoutProblem('go', join(folder, 'code.sh', 'work'));
        console.log(`With a go.work above the checkout: ${problem ?? 'it would start'}`);
        if (problem === undefined) throw new Error('a go.work above the checkout went unseen');
      }
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  };
}

/** Each ID's check. */
const CHECKS: Record<string, Check> = {
  node: async (installed, { pinned }) => {
    const { stdout } = await promisify(execFile)(installed.entry, ['--version'], {
      env: { PATH: '/usr/bin:/bin' },
    });
    if (stdout.trim() !== `v${pinned.version}`) {
      throw new Error(`Node says it's ${stdout.trim()}, not v${pinned.version}`);
    }
    console.log(`Node ${stdout.trim()} runs.`);
  },
  vtsls: onNode(VTSLS, { typescript: 'typescript', javascript: 'javascript' }),
  pyright: onNode(PYRIGHT, { python: 'python' }),
  gopls: native(
    GOPLS,
    { go: 'go' },
    { toolchains: ['go'], plants: ['go/cgo.go', 'go/generate.go'] },
  ),
  'terraform-ls': native(
    TERRAFORM_LS,
    { terraform: 'terraform' },
    {
      // The module that calls one from the Registry, and the provider whose plugin is in .terraform.
      plants: ['hostile/terraform/main.tf', 'hostile/terraform-provider/main.tf'],
    },
  ),
};

const CACHE = process.env.LO_LIVE_CACHE ?? join(homedir(), '.cache', 'lo-live');
const installer = new Installer({ folder: join(CACHE, 'servers'), fetch: globalThis.fetch });
const toolchainInstaller = new Installer({
  folder: join(CACHE, 'toolchains'),
  fetch: globalThis.fetch,
});

async function install(id: string, go?: Toolchain): Promise<Installed> {
  const pinned = MANIFEST[id];
  if (pinned === undefined) throw new Error(`servers.json has no ${id}`);
  const started = performance.now();
  const installed = await installer.install(id, pinned, {
    progress: (received, total) => {
      if (received === total) console.log(`${id} ${pinned.version}: ${total} bytes, checked.`);
    },
    go: go && { version: go.version, installed: go.installed },
  });
  const took = performance.now() - started;
  if (took > 1000) console.log(`${id} ${pinned.version} installed in ${seconds(took)}.`);
  return installed;
}

async function toolchain(id: string): Promise<Toolchain> {
  const pinned = TOOLCHAINS[id];
  if (pinned === undefined) throw new Error(`toolchains.json has no ${id}`);
  const installed = await toolchainInstaller.install(id, pinned);
  return {
    id,
    version: pinned.version,
    installed,
    use: toolchainUse(id, pinned.version, installed),
  };
}

const asked = process.argv.slice(2);
const ids = asked.length > 0 ? asked : Object.keys(MANIFEST);
let failed = false;
for (const id of ids) {
  const pinned = MANIFEST[id];
  const check = CHECKS[id];
  if (pinned === undefined || check === undefined) {
    console.error(
      `${id}: ${pinned === undefined ? 'servers.json has no such entry' : 'no check yet'}.`,
    );
    failed = true;
    continue;
  }
  try {
    console.log(`\n=== ${id} ${pinned.version}`);
    // A Go program is built with Lo's Go, which installs first.
    const built = Object.values(pinned.platforms).some((download) => download.kind === 'go');
    const go = built ? await toolchain('go') : undefined;
    await check(await install(id, go), { pinned, install, toolchain });
  } catch (error) {
    console.error(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
  }
}
await installer.prune(MANIFEST);
await toolchainInstaller.prune(TOOLCHAINS);
process.exitCode = failed ? 1 : 0;
