// The live check, by hand only, never in CI:
//
//   pnpm nx run lsp:live [-- <id>…]
//
// It installs what servers.json pins for this system, or just the IDs given, into
// ~/.cache/lo-live/servers/, or `$LO_LIVE_CACHE/servers/`, through the same checks Lo makes, so
// each version downloads once, and the toolchains they use beside them, in `toolchains/`. gopls is
// built there, as Lo builds it. Then it runs each one's check below, one at a time. Node says its
// version. A server starts as its adapter starts it, on Lo's Node, on Lo's JDK, on Lo's .NET SDK,
// as Roslyn does, or as its own program with its toolchains, on the checkouts of two pull requests
// the code fixtures build with `--local`, so no network or token is needed: the code fixture's
// (`testing/fixtures/code.sh`) and the hostile fixture's (`code-hostile.sh`), which is the same
// with files planted to run code. On each it's asked what `gd`, `gr`, `K`, `gh` and `gO` ask, at
// the places in its languages' sample projects that `testing/fixtures/code/cases.json` names,
// printing what came back, how long it took to start, the most memory its family held, the
// programs it ran as and each network connection any of it opened. On the hostile checkout it opens
// the plants in its language too, as a reader's view would, and Roslyn is asked for each one's
// outline. A server that's a program of its own has a folder of stand-ins on its `PATH` after its
// toolchains', as Lo's git's folder can be Homebrew's: a `terraform`, a `gopackagesdriver`,
// `pkg-config` and C compilers, each writing a marker if run. rust-analyzer's check runs on a third
// checkout too, the hostile one without the files Lo refuses it for, so it meets the Cargo keys
// Lo's variables answer, with a `resolver.lockfile-path` added that names a file outside it; where
// Lo refuses a checkout (`checkoutProblem`, which the pool asks before a start), it starts nothing
// and says why. Then the hostile checkout and that folder are searched for the markers its plants
// write if anything runs them, and the check fails if there's one, if anything in a checkout
// changed, if that file was written, or if anything connected to another machine. It fails too
// if a server took the hostile checkout's settings: if it says it read code as the PHP its
// `.php-lsp.json` names, or indexed a different number of files there than on the code fixture's
// checkout, or if Roslyn's log says it loaded a project but Lo's or looked for programs, or its
// home holds NuGet's folders, which a restore writes.
//
// On macOS it checks SourceKit-LSP too, `sourcekit-lsp` among the IDs, which Lo doesn't download:
// it finds the copy in the developer folder `xcode-select -p` names, as Lo does, and starts it
// rootless on both checkouts. On the hostile one it says why Lo refuses the checkout, then starts
// it all the same, opening the Swift plants, to show none of them runs. The system starts
// `SourceKitService` for it, outside its group, which Lo takes into its family by its home, and
// that starts `swift-plugin-server`; the check watches those, the ones that appear while it runs,
// for memory and network too. Check the machine has memory to spare before running it.

import { execFile } from 'node:child_process';
import {
  appendFile,
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
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import { defaultPlaces, serverGitEnvironment, whyDistrusted } from '@lo/git';
import { z } from 'zod';

import {
  checkoutProblem,
  developerFolder,
  findCopy,
  findSourceKit,
  GOPLS,
  type Installed,
  Installer,
  JDTLS,
  jdtlsCheckoutProblem,
  type Launch,
  launchJdtls,
  launchNative,
  launchOnNode,
  launchRoslyn,
  launchRustAnalyzer,
  launchSourceKit,
  MANIFEST,
  type NativeServer,
  type NodeServer,
  PHP_LSP,
  type Pinned,
  PYRIGHT,
  ROSLYN,
  RUST_ANALYZER,
  sourceKitCheckoutProblem,
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
  /** Whether it's asked for each plant's outline too: a server may read a file only when asked. */
  readonly plantOutlines?: boolean | undefined;
  /** Whether a folder of {@link STAND_INS} goes on its `PATH`, after its toolchains'. */
  readonly standIns?: boolean | undefined;
  /** The toolchains it uses, whose checks of a checkout (`checkoutProblem`) it's held to. */
  readonly toolchains?: readonly string[] | undefined;
  /** What else in its log to print, besides what any server says of plugins, settings and more. */
  readonly said?: RegExp | undefined;
  /**
   * What its log must say on each checkout: a line `ever` matches, which shows it says the like at
   * all, and none `never` matches.
   */
  readonly heard?: { readonly ever: RegExp; readonly never: RegExp } | undefined;
  /** What its home must hold none of afterwards, by path in it. */
  readonly unwritten?: RegExp | undefined;
  /** Why its adapter wouldn't start it on a checkout, by what the server alone reads there. */
  readonly checkout?: ((root: string) => Promise<string | undefined>) | undefined;
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
        const refused = await options.checkout?.(root);
        if (refused !== undefined) throw new Error(`it wouldn't start: ${refused}`);
        const languageId = places[0]?.languageId ?? '';
        const opened =
          script === 'code-hostile.sh' ? plants.map((file) => ({ file, languageId })) : [];
        const { log, peak, programs, connections } = await askServer({
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
            place: launched.place,
            stays: launched.stays,
            workspace: launched.workspace,
          },
          places,
          outlines: [...outlines, ...(options.plantOutlines === true ? opened : [])],
          opened,
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
        if (options.heard !== undefined) {
          const { ever, never } = options.heard;
          const wrong = log.filter((line) => never.test(line));
          if (wrong.length > 0)
            throw new Error(`its log says what it mustn't: ${wrong.join('; ')}`);
          if (!log.some((line) => ever.test(line)))
            throw new Error(`its log has no line like ${ever}`);
          console.log(`\nIts log has a line like ${ever}, and none like ${never}.`);
        }
        console.log(`\nIts family held at most ${Math.round(peak / 1024 ** 2)} MB at once.`);
        console.log(`It ran as: ${programs.join(', ')}`);
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
        if (options.unwritten !== undefined) {
          const { unwritten } = options;
          const wrote = home.filter((path) => unwritten.test(path));
          if (wrote.length > 0) throw new Error(`it wrote in its home ${wrote.join(', ')}`);
          console.log(`Nothing in its home is like ${unwritten}.`);
        }
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

/**
 * The checkouts rust-analyzer's check runs on: each fixture's, and the hostile one again without
 * the files Lo refuses it for, so the Cargo keys Lo's variables answer meet a running server. That
 * one's Cargo config also names a lock file outside the checkout (`resolver.lockfile-path`), where
 * `cargo metadata` would write one for the workspace, which has none.
 */
const RUST_CHECKOUTS = [
  { name: 'code.sh', script: 'code.sh', without: [], lockfile: false },
  { name: 'code-hostile.sh', script: 'code-hostile.sh', without: [], lockfile: false },
  {
    name: 'code-hostile-cargo',
    script: 'code-hostile.sh',
    without: ['rust/rust-analyzer.toml', '.cargo/config.toml'],
    lockfile: true,
  },
] as const;

/** What rustc is run with, as the check's stand-in for `RUSTC` writes it, a line a run. */
const RUSTC_STAND_IN = (log: string, rustc: string) => `#!/bin/sh
printf '%s\\n' "$*" >>'${log}'
exec '${rustc}' "$@"
`;

/**
 * The check of rust-analyzer: it starts on Lo's Rust toolchain, on each of {@link RUST_CHECKOUTS},
 * unless {@link checkoutProblem} refuses the checkout, in which case nothing runs and it says why.
 * On a checkout it may run, it's asked each place in its `languages`, with a stand-in for Lo's
 * rustc, outside the checkout, that notes what it's run with, so the check fails if a flag a
 * checkout's config names reached it. It fails too if the checkout changed, as it would if cargo
 * wrote the workspace's lock file there, or if cargo wrote the one its config names.
 */
function onRustAnalyzer(languages: Readonly<Record<string, string>>): Check {
  return async (installed, context) => {
    const rust = await context.toolchain('rust');
    const rustUse = { installed: rust.installed, ...rust.use };
    const launch = launchRustAnalyzer(installed, rustUse);
    console.log(`${launch.version}: ${[launch.program, ...launch.args].join(' ')}`);
    const places = await placesFor(languages);
    const folder = await realpath(await mkdtemp(join(tmpdir(), `lo-live-${RUST_ANALYZER.id}-`)));
    try {
      for (const { name: script, script: fixture, without, lockfile } of RUST_CHECKOUTS) {
        const root = await checkout(fixture, join(folder, script));
        for (const path of without) await rm(join(root, path));
        const elsewhere = join(folder, `lockfile-${script}`, 'Cargo.lock');
        if (lockfile) {
          const config = join(root, 'rust', '.cargo', 'config.toml');
          await appendFile(config, `\n[resolver]\nlockfile-path = ${JSON.stringify(elsewhere)}\n`);
        }
        const less = without.length > 0 ? `, less ${without.join(' and ')}` : '';
        const more = lockfile ? ', its Cargo config naming a lock file outside it' : '';
        console.log(
          `\n--- ${RUST_ANALYZER.name} on the checkout ${fixture} --local makes${less}${more}`,
        );
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
        const ran = join(folder, `rustc-${script}.log`);
        const standIn = join(folder, `rustc-${script}.sh`);
        const rustc = rustUse.variables.RUSTC ?? '';
        await writeFile(standIn, RUSTC_STAND_IN(ran, rustc), { mode: 0o755 });
        await writeFile(ran, '');
        const before = await snapshot(root);
        const { log, peak, connections } = await askServer({
          spec: {
            name: RUST_ANALYZER.name,
            program: launch.program,
            args: launch.args,
            root,
            home: join(folder, `home-${script}`),
            path: rustUse.path,
            variables: { ...rustUse.variables, RUSTC: standIn },
            allowed: rustUse.allowed,
            homeFolders: launch.homeFolders,
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
        console.log(`\nIts family held at most ${Math.round(peak / 1024 ** 2)} MB at once.`);
        console.log(
          connections.length === 0
            ? 'Its family opened no network connection.'
            : `Its family's network connections:\n${connections.join('\n')}`,
        );
        const away = connections.filter((line) => !/->(?:127\.0\.0\.1|\[::1\]):/.test(line));
        if (away.length > 0) throw new Error(`it connected to another machine: ${away.join('; ')}`);
        const home = await readdir(join(folder, `home-${script}`), { recursive: true });
        const top = home.filter((path) => path.split('/').length <= 3);
        console.log(`\nIts home holds ${home.length} entries: ${top.join(', ')}`);
        const found = await markers(root);
        if (found.length > 0) throw new Error(`something ran what's planted: ${found.join(', ')}`);
        const runs = (await readFile(ran, 'utf8')).split('\n').filter((line) => line !== '');
        console.log(`\nLo's rustc ran ${runs.length} times, through cargo:\n${runs.join('\n')}`);
        const flagged = runs.filter((line) => line.includes('lo_hostile_rustflags'));
        if (flagged.length > 0) {
          throw new Error(
            `a flag the checkout's config names reached rustc: ${flagged.join('; ')}`,
          );
        }
        const changed = changes(before, await snapshot(root));
        if (changed.length > 0) throw new Error(`the checkout changed: ${changed.join(', ')}`);
        const wrote = await lstat(elsewhere).then(
          () => true,
          () => false,
        );
        if (wrote) throw new Error("cargo wrote the lock file the checkout's config names");
      }
      console.log(
        `\nNo marker was written, no flag of the checkout's reached rustc, and nothing was written ` +
          `in a checkout or as its config names: nothing ${RUST_ANALYZER.name} ran was planted.`,
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  };
}

/** The system's processes a server starts through it, outside its group, by their programs' names. */
const OUTSIDE = ['SourceKitService', 'swift-plugin-server'];

/** Each running process whose program is named one of `names`, with its resident memory. */
async function processesNamed(names: readonly string[]) {
  const { stdout } = await promisify(execFile)('/bin/ps', ['-A', '-o', 'pid=,rss=,comm='], {
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.split('\n').flatMap((line) => {
    const [, pid, rss, program = ''] = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line) ?? [];
    return names.includes(basename(program))
      ? [{ pid: Number(pid), resident: Number(rss) * 1024, name: basename(program) }]
      : [];
  });
}

/**
 * Watches the processes named `names` that appear from now on, every half second, until stopped:
 * the most resident memory they held at once, what they were, and every network connection any had
 * open, as `lsof` lists them.
 */
async function watchOutside(names: readonly string[]) {
  const before = new Set((await processesNamed(names)).map((each) => each.pid));
  const seen = new Set<string>();
  const connections = new Set<string>();
  let peak = 0;
  const stopped = new AbortController();
  const looping = (async () => {
    while (!stopped.signal.aborted) {
      const fresh = (await processesNamed(names)).filter((each) => !before.has(each.pid));
      for (const each of fresh) seen.add(`${each.name} ${each.pid}`);
      peak = Math.max(
        peak,
        fresh.reduce((sum, each) => sum + each.resident, 0),
      );
      if (fresh.length > 0) {
        const pids = fresh.map((each) => each.pid).join(',');
        const listed = await promisify(execFile)(
          '/usr/sbin/lsof',
          ['-nP', '-a', '-i', '-p', pids],
          { env: { PATH: '/usr/bin:/bin' } },
        ).catch(() => ({ stdout: '' }));
        for (const line of listed.stdout.split('\n').slice(1)) {
          if (line.trim() !== '') connections.add(line);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  })();
  return {
    stop: async () => {
      stopped.abort();
      await looping;
      return { peak, seen: [...seen], connections: [...connections] };
    },
    /** Whether any of those that appeared still runs. */
    running: async () =>
      (await processesNamed(names)).filter((each) => !before.has(each.pid)).map((each) => each.pid),
  };
}

/**
 * The check of SourceKit-LSP, on macOS: the copy in the developer folder, found as Lo finds it,
 * started rootless as its adapter starts it on each fixture's checkout, the hostile one included,
 * though Lo refuses that one, and asked each place in its `languages`. It opens `plants` on the
 * hostile checkout, as a reader's view would.
 */
async function onSourceKit(
  languages: Readonly<Record<string, string>>,
  plants: readonly string[],
): Promise<void> {
  const developer = await developerFolder();
  const { groups } = defaultPlaces(process.platform);
  const found = await findSourceKit(developer, async (candidates) => {
    const copy = await findCopy(candidates, {
      distrust: (program) => whyDistrusted(program, groups),
      outside: [CACHE],
      home: homedir(),
    });
    for (const { path, why } of copy.skipped) console.log(`Not ${path}: ${why}.`);
    return copy.program;
  });
  if (found === undefined) {
    throw new Error(`there's no SourceKit-LSP in the developer folder, ${developer ?? 'none'}`);
  }
  const launch = launchSourceKit(found);
  console.log(`${launch.version}: ${launch.program}, in ${developer}, with ${found.sdk}`);
  const places = await placesFor(languages);
  const languageId = places[0]?.languageId ?? 'swift';
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'lo-live-sourcekit-lsp-')));
  try {
    for (const script of ['code.sh', 'code-hostile.sh']) {
      const root = await checkout(script, join(folder, script));
      const before = await snapshot(root);
      console.log(`\n--- SourceKit-LSP on the checkout ${script} --local makes`);
      const refusal = await sourceKitCheckoutProblem(root);
      if (script === 'code.sh' && refusal !== undefined)
        throw new Error(`Lo refuses it: ${refusal}`);
      if (refusal !== undefined) {
        console.log(
          `Lo refuses it: ${refusal} Started all the same, to show nothing planted runs.`,
        );
      }
      const outside = await watchOutside(OUTSIDE);
      const { peak, connections } = await askServer({
        spec: {
          name: 'SourceKit-LSP',
          program: launch.program,
          args: launch.args,
          root,
          rootless: launch.rootless,
          services: launch.services,
          home: join(folder, `home-${script}`),
          path: [],
          git: serverGitEnvironment(),
          place: launch.place,
        },
        places,
        outlines: [{ file: 'swift/Sources/Sample/Words.swift', languageId }],
        opened: script === 'code-hostile.sh' ? plants.map((file) => ({ file, languageId })) : [],
      });
      const system = await outside.stop();
      console.log(`\nIts family held at most ${Math.round(peak / 1024 ** 2)} MB at once.`);
      console.log(
        `What the system started for it (${system.seen.join(', ') || 'nothing'}) held at most ` +
          `${Math.round(system.peak / 1024 ** 2)} MB at once.`,
      );
      // Lo stops SourceKitService with the server, and what it started ends with it.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const left = await outside.running();
      if (left.length > 0) {
        throw new Error(`still running 2 s after the server stopped: ${left.join(', ')}`);
      }
      console.log('None of it was still running 2 s after the server stopped.');
      const all = [...connections, ...system.connections];
      console.log(
        all.length === 0
          ? 'Neither opened a network connection.'
          : `Network connections:\n${all.join('\n')}`,
      );
      const away = all.filter((line) => !/->(?:127\.0\.0\.1|\[::1\]):/.test(line));
      if (away.length > 0) throw new Error(`it connected to another machine: ${away.join('; ')}`);
      const home = await readdir(join(folder, `home-${script}`), { recursive: true });
      const top = home.filter((path) => path.split('/').length <= 2);
      console.log(`\nIts home holds ${home.length} entries: ${top.join(', ')}`);
      // Its generated files and its module cache, which follow neither `HOME` nor `TMPDIR`, are in
      // its home, as its options and arguments say.
      const unplaced = ['generated', join('cache', 'modules')].filter(
        (path) => !home.includes(path),
      );
      if (unplaced.length > 0) throw new Error(`its home holds no ${unplaced.join(' or ')}`);
      const markersFound = await markers(root);
      if (markersFound.length > 0) {
        throw new Error(`something ran what's planted: ${markersFound.join(', ')}`);
      }
      const changed = changes(before, await snapshot(root));
      if (changed.length > 0) throw new Error(`the checkout changed: ${changed.join(', ')}`);
    }
    console.log(
      '\nNo marker was written, and neither checkout changed: SourceKit-LSP ran nothing ' +
        'planted, and wrote nothing in them.',
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** The checks of servers Lo doesn't download, by their IDs: SourceKit-LSP's, on macOS. */
const SYSTEM_CHECKS: Record<string, () => Promise<void>> =
  process.platform === 'darwin'
    ? {
        // A macro whose plugin compile commands name, a package's build tool plugin, and a
        // package's manifest, which SwiftPM would compile and run.
        'sourcekit-lsp': () =>
          onSourceKit({ swift: 'swift' }, [
            'hostile/swift-commands/Lo.swift',
            'hostile/swift-plugin/Plugins/plugin.swift',
            'hostile/swift-plugin/Sources/main.swift',
            'hostile/swift/Package.swift',
          ]),
      }
    : {};

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

/** How Java's server starts from `installed`, on Lo's JDK, which installs first. */
async function launchOnJdk(installed: Installed, context: Context): Promise<Launch> {
  const jdk = await context.toolchain('temurin');
  return launchJdtls(installed, jdk.installed, jdk.use);
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
  // The program's copy in `obj`, which Lo's project doesn't list, gets no project of its own when
  // it's asked about, which would restore with NuGet, writing its folders in the home; nor does it
  // look for programs, which its log would say.
  roslyn: serverCheck(
    ROSLYN,
    launchOnDotnet,
    { csharp: 'csharp' },
    {
      toolchains: ['dotnet'],
      plants: ['hostile/app/app.cs', 'hostile/app/obj/app.cs', 'hostile/dotnet/Program.cs'],
      plantOutlines: true,
      said: /msbuild|restore|\bload|unresolved|sdk|analyzer|file-based|global\.json|Directory\./i,
      heard: {
        ever: /Successfully completed load of \/\S*\/project\/checkout\.csproj$/,
        never:
          /(?:load of|loading project|loading|loaded) (?!\S*\/project\/checkout\.csproj\b)\/|file-based app|Finished discovery/i,
      },
      unwritten: /^(?:\.nuget|\.local\/share\/NuGet|tmp\/NuGetScratch)(?:\/|$)/,
    },
  ),
  // Java's `Tally` is a class inside `Words`, whose file the pull request leaves alone. The JDK is
  // held to its checks of a checkout, and JDT LS to its own.
  jdtls: serverCheck(
    JDTLS,
    launchOnJdk,
    { java: 'java' },
    {
      outlines: [{ file: 'java/src/main/java/sample/Words.java', languageId: 'java' }],
      toolchains: ['temurin'],
      checkout: jdtlsCheckoutProblem,
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
const ids = asked.length > 0 ? asked : [...Object.keys(MANIFEST), ...Object.keys(SYSTEM_CHECKS)];
let failed = false;
for (const id of ids) {
  const system = Object.hasOwn(SYSTEM_CHECKS, id) ? SYSTEM_CHECKS[id] : undefined;
  if (system !== undefined) {
    try {
      console.log(`\n=== ${id}, the system's`);
      await system();
    } catch (error) {
      console.error(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      failed = true;
    }
    continue;
  }
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
