// The live check, by hand only, never in CI:
//
//   pnpm nx run lsp:live [-- <id>…]
//
// It installs what servers.json pins for this system, or just the IDs given, into
// ~/.cache/lo-live/servers/, or `$LO_LIVE_CACHE/servers/`, through the same checks Lo makes, so
// each version downloads once, and the toolchains they use beside them, in `toolchains/`. gopls is
// built there, as Lo builds it. Then it runs each one's check below, one at a time. Node says its
// version. A server starts as its adapter starts it, on Lo's Node, as its own program with its
// toolchains, or on Lo's .NET SDK, as Roslyn does, on the checkouts of two pull requests the code
// fixtures build with `--local`, so no network or token is needed: the code fixture's
// (`testing/fixtures/code.sh`) and the hostile fixture's (`code-hostile.sh`), which is the same
// with files planted to run code. On each it's asked what `gd`, `gr`, `K`, `gh` and `gO` ask, at
// the places in its languages' sample projects that `testing/fixtures/code/cases.json` names,
// printing what came back, how long it took to start, the most memory its family held and each
// network connection any of it opened. On the hostile checkout it opens the plants in its language
// too, as a reader's view would. A server that's a program of its own has a folder of stand-ins on
// its `PATH` after its toolchains', as Lo's git's folder can be Homebrew's: a `terraform`, a
// `gopackagesdriver`, `pkg-config` and C compilers, each writing a marker if run. Then the hostile
// checkout and that folder are searched for the markers its plants write if anything runs them, and
// the check fails if there's one, if anything in either checkout changed, or if anything connected
// to another machine. It fails too if a server took the hostile checkout's settings: if it says it
// read code as the PHP its `.php-lsp.json` names, or indexed a different number of files there than
// on the code fixture's checkout. Check the machine has memory to spare before running it.

import { execFile } from 'node:child_process';
import {
  chmod,
  lstat,
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
  launchRoslyn,
  MANIFEST,
  type NativeServer,
  type NodeServer,
  PHP_LSP,
  type Pinned,
  PYRIGHT,
  ROSLYN,
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

/** Every entry under `folder`, by its path there, with its size and when it last changed. */
async function snapshot(folder: string): Promise<Map<string, string>> {
  const entries = await readdir(folder, { recursive: true });
  const stats = await Promise.all(entries.map((path) => lstat(join(folder, path))));
  return new Map(entries.map((path, at) => [path, `${stats[at]?.size}:${stats[at]?.mtimeMs}`]));
}

/** What a server's log says it indexed, as php-lsp's "indexed 2 files in 0.1 s" does. */
const INDEXED = /\bindexed (\d+) files?\b/;

/** The PHP the checkout's `.php-lsp.json` names, if it names one. */
async function plantedPhp(root: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(join(root, '.php-lsp.json'), 'utf8');
  } catch {
    return undefined;
  }
  const settings = z.object({ phpVersion: z.string() }).safeParse(JSON.parse(text));
  return settings.success ? settings.data.phpVersion : undefined;
}

/** The programs on the `PATH` of a server that's a program of its own, after its toolchains'. */
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

/** What changed under a folder between snapshots `before` and `after`. */
function changes(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path)).toSorted();
}

/** What a server's check does besides asking it about its places. */
interface CheckOptions {
  /** Files whose outline it's asked for besides the places'. */
  readonly outlines?: readonly Omit<Place, 'position'>[] | undefined;
  /** The hostile fixture's files it opens besides, in its language, as a reader's view would. */
  readonly plants?: readonly string[] | undefined;
  /** Whether a folder of {@link STAND_INS} goes on its `PATH`, after its toolchains'. */
  readonly standIns?: boolean | undefined;
  /** The toolchains it uses, whose checks of a checkout (`checkoutProblem`) it's held to. */
  readonly toolchains?: readonly string[] | undefined;
  /** What else in its log to print, besides what any server says of plugins, settings and more. */
  readonly said?: RegExp | undefined;
}

/**
 * The check of a server: it starts as its adapter starts it (`launch`), on each fixture's checkout,
 * and is asked about each place in its `languages`, by the protocol's id for each.
 */
function serverCheck(
  server: { readonly id: string; readonly name: string },
  launch: (installed: Installed, context: Context) => Promise<Launch>,
  languages: Readonly<Record<string, string>>,
  options: CheckOptions = {},
): Check {
  const { outlines = [], plants = [], toolchains = [] } = options;
  return async (installed, context) => {
    const launched = await launch(installed, context);
    console.log(`${launched.version}: ${[launched.program, ...launched.args].join(' ')}`);
    const places = await placesFor(languages);
    const folder = await realpath(await mkdtemp(join(tmpdir(), `lo-live-${server.id}-`)));
    const stand = join(folder, 'path');
    if (options.standIns === true) await standIns(stand);
    // How many files it says it indexed on each checkout, if it says.
    const indexed = new Map<string, string>();
    try {
      for (const script of ['code.sh', 'code-hostile.sh']) {
        const root = await checkout(script, join(folder, script));
        const before = await snapshot(root);
        console.log(`\n--- ${server.name} on the checkout ${script} --local makes`);
        for (const id of toolchains) {
          const problem = await checkoutProblem(id, root);
          if (problem !== undefined) throw new Error(`it wouldn't start: ${problem}`);
        }
        const languageId = places[0]?.languageId ?? '';
        const { log, peak, connections } = await askServer({
          spec: {
            name: server.name,
            program: launched.program,
            args: launched.args,
            root,
            home: join(folder, `home-${script}`),
            path: [...(launched.path ?? []), ...(options.standIns === true ? [stand] : [])],
            variables: launched.variables,
            allowed: launched.allowed,
            homeFolders: launched.homeFolders,
            git: serverGitEnvironment(),
            settings: launched.settings,
            initializationOptions: launched.initializationOptions,
            workspace: launched.workspace,
          },
          places,
          outlines,
          opened: script === 'code-hostile.sh' ? plants.map((file) => ({ file, languageId })) : [],
        });
        // What it says of plugins, interpreters, settings it ignored, what it indexed, and the
        // programs and network it would use, the folders' own names aside. The folders it walks,
        // named after the fixture's, and the jobs it queues and finishes without an error, say
        // nothing of what it did.
        const said = log.filter((line) => {
          const plain = line.replaceAll(folder, '').replaceAll(script, 'the fixture');
          return (
            !/walker\.go|discover\.go|Enqueueing new job|Dispatching next job|err = %!s\(<nil>\)/.test(
              line,
            ) &&
            (/hostile|plugin|interpreter|pythonPath|ignoring|using PHP|indexed|registry|proxy|dial|toolchain|generate|cgo|driver|telemetry/i.test(
              plain,
            ) ||
              (options.said?.test(plain) ?? false))
          );
        });
        if (said.length > 0) console.log(`\nIts log, on those:\n${said.slice(-30).join('\n')}`);
        console.log(`\nIts family held at most ${Math.round(peak / 1024 ** 2)} MB at once.`);
        console.log(
          connections.length === 0
            ? 'Its family opened no network connection.'
            : `Its family's network connections:\n${connections.join('\n')}`,
        );
        const away = connections.filter((line) => !/->(?:127\.0\.0\.1|\[::1\]):/.test(line));
        if (away.length > 0) throw new Error(`it connected to another machine: ${away.join('; ')}`);
        const php = await plantedPhp(root);
        if (php !== undefined && log.some((line) => line.includes(`using PHP ${php} (`))) {
          throw new Error(`it read code as PHP ${php}, which the checkout's .php-lsp.json names`);
        }
        const count = log.map((line) => INDEXED.exec(line)?.[1]).findLast((n) => n !== undefined);
        if (count !== undefined) indexed.set(script, count);
        const home = await readdir(join(folder, `home-${script}`), { recursive: true });
        const top = home.filter((path) => path.split('/').length <= 3);
        console.log(`\nIts home holds ${home.length} entries: ${top.join(', ')}`);
        const found = [
          ...(await markers(root)),
          ...(options.standIns === true ? await markers(stand) : []),
        ];
        if (found.length > 0) throw new Error(`something ran what's planted: ${found.join(', ')}`);
        const changed = changes(before, await snapshot(root));
        if (changed.length > 0) throw new Error(`the checkout changed: ${changed.join(', ')}`);
      }
      // The hostile checkout is the code fixture's with a package's class in `vendor/`, and
      // settings that index it, so a server that took them indexes one more file there.
      const [code, hostile] = [indexed.get('code.sh'), indexed.get('code-hostile.sh')];
      if (code !== hostile) {
        throw new Error(
          `it indexed ${hostile ?? 'no'} files on the hostile checkout, and ${code ?? 'no'} on ` +
            "the code fixture's: it indexed what the hostile checkout's settings asked for",
        );
      }
      console.log(
        `\nNo marker was written, and neither checkout changed: ${server.name} ran nothing ` +
          'planted, and wrote nothing in them.',
      );
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

/** The check of a server on Lo's Node, which installs first. */
function onNode(server: NodeServer, languages: Readonly<Record<string, string>>): Check {
  const launch = async (installed: Installed, context: Context) =>
    launchOnNode(server, await context.install('node'), installed);
  return serverCheck(server, launch, languages);
}

/**
 * The check of a server that's a program of its own, using `options.toolchains`, with stand-ins on
 * its `PATH` after their folders. For Go, a `go.work` put in a folder above a checkout then keeps
 * it from starting there.
 */
function native(
  server: NativeServer,
  languages: Readonly<Record<string, string>>,
  options: Omit<CheckOptions, 'standIns'> = {},
): Check {
  const launch = async (installed: Installed, context: Context) => {
    const used: ToolchainUse[] = [];
    for (const id of options.toolchains ?? []) used.push((await context.toolchain(id)).use);
    return launchNative(server, installed, used);
  };
  return serverCheck(server, launch, languages, { ...options, standIns: true });
}

/** How Roslyn starts, on Lo's .NET SDK, which installs first. */
async function launchOnDotnet(installed: Installed, context: Context): Promise<Launch> {
  const dotnet = await context.toolchain('dotnet');
  return launchRoslyn(installed, { installed: dotnet.installed, ...dotnet.use });
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
  // PHP's project has a file for each class, and `Tally` is in one of its own.
  'php-lsp': native(
    PHP_LSP,
    { php: 'php' },
    { outlines: [{ file: 'php/src/Tally.php', languageId: 'php' }] },
  ),
  // The files that import "C" and run a generator.
  gopls: native(
    GOPLS,
    { go: 'go' },
    { toolchains: ['go'], plants: ['go/cgo.go', 'go/generate.go'] },
  ),
  // The module that calls one from the Registry, and the provider whose plugin is in .terraform.
  'terraform-ls': native(
    TERRAFORM_LS,
    { terraform: 'terraform' },
    { plants: ['hostile/terraform/main.tf', 'hostile/terraform-provider/main.tf'] },
  ),
  // The project Lo writes in its home: what it loaded, whether anything was unresolved, restored
  // or an analyzer, and the file-based program and a project's program the hostile checkout plants.
  roslyn: serverCheck(
    ROSLYN,
    launchOnDotnet,
    { csharp: 'csharp' },
    {
      toolchains: ['dotnet'],
      plants: ['hostile/app/app.cs', 'hostile/dotnet/Program.cs'],
      said: /msbuild|restore|\bload|unresolved|sdk|analyzer|file-based|global\.json|Directory\./i,
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
  const took = (performance.now() - started) / 1000;
  if (took > 1) console.log(`${id} ${pinned.version} installed in ${took.toFixed(1)} s.`);
  return installed;
}

async function toolchain(id: string): Promise<Toolchain> {
  const pinned = TOOLCHAINS[id];
  if (pinned === undefined) throw new Error(`toolchains.json has no ${id}`);
  const installed = await toolchainInstaller.install(id, pinned);
  const use = toolchainUse(id, pinned.version, installed);
  return { id, version: pinned.version, installed, use };
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
