// The live check, by hand only, never in CI:
//
//   pnpm nx run lsp:live [-- <id>…]
//
// It installs what servers.json pins for this system, or just the IDs given, into
// ~/.cache/lo-live/, through the same checks Lo makes, so each version downloads once. Then it
// runs each one's check below, one at a time. Node says its version. A server starts as its
// adapter starts it, on Lo's Node or as its own program, on the checkouts of two pull requests the
// code fixtures build with `--local`, so no network or token is needed: the code fixture's
// (`testing/fixtures/code.sh`) and the hostile fixture's (`code-hostile.sh`), which is the same
// with files planted to run code. On each it's asked what `gd`, `gr`, `K`, `gh` and `gO` ask, at
// the places in its languages' sample projects that `testing/fixtures/code/cases.json` names,
// printing what came back, how long it took to start and what memory it held. Then the hostile
// checkout is searched for the markers its plants write if anything runs them, and the check fails
// if there's one, or if anything in either checkout changed. Check the machine has memory to spare
// before running it.

import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { serverGitEnvironment } from '@lo/git';
import { z } from 'zod';

import {
  type Installed,
  Installer,
  type Launch,
  launchNative,
  launchOnNode,
  MANIFEST,
  type NativeServer,
  type NodeServer,
  PHP_LSP,
  type Pinned,
  PYRIGHT,
  VTSLS,
} from '../src/index.ts';
import { askServer, type Place } from './ask.ts';

/** What a check knows: what's pinned, and where everything it has installed is. */
interface Context {
  readonly pinned: Pinned;
  /** Installs another entry, such as the Node a JavaScript server runs on. */
  readonly install: (id: string) => Promise<Installed>;
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

/** What changed under a folder between snapshots `before` and `after`. */
function changes(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path)).toSorted();
}

/**
 * The check of a server: it starts as its adapter starts it (`launch`), on each fixture's checkout,
 * and is asked about each place in its `languages`, by the protocol's id for each.
 */
function serverCheck(
  server: { readonly id: string; readonly name: string },
  launch: (installed: Installed, context: Context) => Promise<Launch>,
  languages: Readonly<Record<string, string>>,
  outlines: readonly Omit<Place, 'position'>[] = [],
): Check {
  return async (installed, context) => {
    const launched = await launch(installed, context);
    console.log(`${launched.version}: ${[launched.program, ...launched.args].join(' ')}`);
    const places = await placesFor(languages);
    const folder = await realpath(await mkdtemp(join(tmpdir(), `lo-live-${server.id}-`)));
    try {
      for (const script of ['code.sh', 'code-hostile.sh']) {
        const root = await checkout(script, join(folder, script));
        const before = await snapshot(root);
        console.log(`\n--- ${server.name} on the checkout ${script} --local makes`);
        const log = await askServer({
          spec: {
            name: server.name,
            program: launched.program,
            args: launched.args,
            root,
            home: join(folder, `home-${script}`),
            path: [],
            git: serverGitEnvironment(),
            settings: launched.settings,
            initializationOptions: launched.initializationOptions,
          },
          places,
          outlines,
        });
        // What it says of plugins, interpreters and settings it ignored, the folders' own names
        // aside.
        const said = log.filter((line) =>
          /hostile|plugin|interpreter|pythonPath|ignoring|using PHP/i.test(
            line.replaceAll(folder, '').replaceAll(script, 'the fixture'),
          ),
        );
        if (said.length > 0) console.log(`\nIts log, on those:\n${said.join('\n')}`);
        const home = await readdir(join(folder, `home-${script}`), { recursive: true });
        const top = home.filter((path) => path.split('/').length <= 3);
        console.log(`\nIts home holds ${home.length} entries: ${top.join(', ')}`);
        const found = await markers(root);
        if (found.length > 0) throw new Error(`something ran what's planted: ${found.join(', ')}`);
        const changed = changes(before, await snapshot(root));
        if (changed.length > 0) throw new Error(`the checkout changed: ${changed.join(', ')}`);
      }
      console.log(
        `\nNo marker was written, and neither checkout changed: ${server.name} ran nothing ` +
          'planted, and wrote nothing in them.',
      );
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

/** The check of a server that's a program of its own, which asks for `outlines` too. */
function native(
  server: NativeServer,
  languages: Readonly<Record<string, string>>,
  outlines: readonly Omit<Place, 'position'>[] = [],
): Check {
  const launch = (installed: Installed) => Promise.resolve(launchNative(server, installed));
  return serverCheck(server, launch, languages, outlines);
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
  'php-lsp': native(PHP_LSP, { php: 'php' }, [{ file: 'php/src/Tally.php', languageId: 'php' }]),
};

const installer = new Installer({
  folder: join(homedir(), '.cache', 'lo-live'),
  fetch: globalThis.fetch,
});

async function install(id: string): Promise<Installed> {
  const pinned = MANIFEST[id];
  if (pinned === undefined) throw new Error(`servers.json has no ${id}`);
  return installer.install(id, pinned, {
    progress: (received, total) => {
      if (received === total) console.log(`${id} ${pinned.version}: ${total} bytes, checked.`);
    },
  });
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
    await check(await install(id), { pinned, install });
  } catch (error) {
    console.error(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
  }
}
await installer.prune(MANIFEST);
process.exitCode = failed ? 1 : 0;
