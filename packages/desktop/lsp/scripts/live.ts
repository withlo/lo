// The live check, by hand only, never in CI:
//
//   pnpm nx run lsp:live [-- <id>…]
//
// It installs what servers.json pins for this system, or just the IDs given, into
// ~/.cache/lo-live/, through the same checks Lo makes, so each version downloads once; a server
// that uses a toolchain (rust-analyzer, Lo's Rust) downloads that too, from toolchains.json. Then
// it runs each one's check below, one at a time. Node says its version. A server starts as its
// adapter starts it, on the checkouts of two pull requests the code fixtures build with `--local`,
// so no network or token is needed: the code fixture's (`testing/fixtures/code.sh`) and the hostile
// fixture's (`code-hostile.sh`), which is the same with files planted to run code. On each it's
// asked what `gd`, `gr`, `K`, `gh` and `gO` ask, at the places in its languages' sample projects
// that `testing/fixtures/code/cases.json` names, printing what came back; a checkout a server
// mustn't run on (`checkoutProblem`, which the pool asks before a start) starts nothing and says
// why. Then the hostile checkout is searched for the markers its plants write if anything runs
// them, and the check fails if there's one. Check the machine has memory to spare before running
// it.

import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { serverGitEnvironment } from '@lo/git';
import { z } from 'zod';

import {
  checkoutProblem,
  type Installed,
  Installer,
  type InstalledToolchain,
  launchOnNode,
  launchRustAnalyzer,
  MANIFEST,
  type NodeServer,
  type Pinned,
  PYRIGHT,
  RUST_ANALYZER,
  TOOLCHAINS,
  toolchainUse,
  VTSLS,
} from '../src/index.ts';
import { askServer, type Place } from './ask.ts';

/** What a check knows: what's pinned, and where everything it has installed is. */
interface Context {
  readonly pinned: Pinned;
  /** Installs another entry, such as the Node a JavaScript server runs on. */
  readonly install: (id: string) => Promise<Installed>;
  /** Installs a toolchain, as `toolchains.json` pins it, and says what a server gets of it. */
  readonly installToolchain: (id: string) => Promise<InstalledToolchain>;
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

/**
 * The check of a server on Lo's Node: it starts as its adapter starts it, on each fixture's
 * checkout, and is asked about each place in its `languages`, by the protocol's id for each.
 */
function onNode(server: NodeServer, languages: Readonly<Record<string, string>>): Check {
  return async (installed, context) => {
    const launch = launchOnNode(server, await context.install('node'), installed);
    console.log(`${launch.version}: ${[launch.program, ...launch.args].join(' ')}`);
    const places = await placesFor(languages);
    const folder = await realpath(await mkdtemp(join(tmpdir(), `lo-live-${server.id}-`)));
    try {
      for (const script of ['code.sh', 'code-hostile.sh']) {
        const root = await checkout(script, join(folder, script));
        console.log(`\n--- ${server.name} on the checkout ${script} --local makes`);
        const log = await askServer({
          spec: {
            name: server.name,
            program: launch.program,
            args: launch.args,
            root,
            home: join(folder, `home-${script}`),
            path: [],
            git: serverGitEnvironment(),
            settings: launch.settings,
            initializationOptions: launch.initializationOptions,
          },
          places,
        });
        // What it says of plugins and interpreters, the folders' own names aside.
        const said = log.filter((line) =>
          /hostile|plugin|interpreter|pythonPath/i.test(
            line.replaceAll(folder, '').replaceAll(script, 'the fixture'),
          ),
        );
        if (said.length > 0) console.log(`\nIts log, on those:\n${said.join('\n')}`);
        const home = await readdir(join(folder, `home-${script}`), { recursive: true });
        const top = home.filter((path) => path.split('/').length <= 3);
        console.log(`\nIts home holds ${home.length} entries: ${top.join(', ')}`);
        const found = await markers(root);
        if (found.length > 0) throw new Error(`something ran what's planted: ${found.join(', ')}`);
      }
      console.log(`\nNo marker was written: nothing ${server.name} ran was planted.`);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  };
}

/**
 * The check of rust-analyzer: it starts on Lo's Rust toolchain, on each fixture's checkout, unless
 * {@link checkoutProblem} refuses the checkout, in which case nothing runs and it says why. On a
 * checkout it may run, it's asked each place in its `languages`.
 */
function onRustAnalyzer(languages: Readonly<Record<string, string>>): Check {
  return async (installed, context) => {
    const toolchain = await context.installToolchain('rust');
    const launch = launchRustAnalyzer(installed, toolchain);
    console.log(`${launch.version}: ${[launch.program, ...launch.args].join(' ')}`);
    const places = await placesFor(languages);
    const folder = await realpath(await mkdtemp(join(tmpdir(), `lo-live-${RUST_ANALYZER.id}-`)));
    try {
      for (const script of ['code.sh', 'code-hostile.sh']) {
        const root = await checkout(script, join(folder, script));
        console.log(`\n--- ${RUST_ANALYZER.name} on the checkout ${script} --local makes`);
        // The pool asks this before a server starts or moves; the live check does the same, so a
        // checkout a Rust server mustn't run on never starts one.
        const refusal = await checkoutProblem('rust', root);
        if (refusal !== undefined) {
          console.log(`Refused, so nothing runs: ${refusal.replaceAll(`${root}/`, '')}`);
          const found = await markers(root);
          if (found.length > 0)
            throw new Error(`something ran what's planted: ${found.join(', ')}`);
          continue;
        }
        const log = await askServer({
          spec: {
            name: RUST_ANALYZER.name,
            program: launch.program,
            args: launch.args,
            root,
            home: join(folder, `home-${script}`),
            path: toolchain.path,
            variables: toolchain.variables,
            allowed: toolchain.allowed,
            git: serverGitEnvironment(),
            settings: launch.settings,
            initializationOptions: launch.initializationOptions,
          },
          places,
        });
        const said = log.filter((line) =>
          /hostile|rustc|wrapper|proc.?macro|sysroot|offline/i.test(
            line.replaceAll(folder, '').replaceAll(script, 'the fixture'),
          ),
        );
        if (said.length > 0) console.log(`\nIts log, on those:\n${said.join('\n')}`);
        const home = await readdir(join(folder, `home-${script}`), { recursive: true });
        const top = home.filter((path) => path.split('/').length <= 3);
        console.log(`\nIts home holds ${home.length} entries: ${top.join(', ')}`);
        const found = await markers(root);
        if (found.length > 0) throw new Error(`something ran what's planted: ${found.join(', ')}`);
      }
      console.log(`\nNo marker was written: nothing ${RUST_ANALYZER.name} ran was planted.`);
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
  'rust-analyzer': onRustAnalyzer({ rust: 'rust' }),
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

async function installToolchain(id: string): Promise<InstalledToolchain> {
  const pinned = TOOLCHAINS[id];
  if (pinned === undefined) throw new Error(`toolchains.json has no ${id}`);
  const installed = await installer.install(id, pinned, {
    progress: (received, total) => {
      if (received === total) console.log(`${id} ${pinned.version}: ${total} bytes, checked.`);
    },
  });
  return { installed, ...toolchainUse(id, pinned.version, installed) };
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
    await check(await install(id), { pinned, install, installToolchain });
  } catch (error) {
    console.error(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
  }
}
// Keep the toolchains a check installed, so a later run downloads them once too.
await installer.prune({ ...MANIFEST, ...TOOLCHAINS });
process.exitCode = failed ? 1 : 0;
