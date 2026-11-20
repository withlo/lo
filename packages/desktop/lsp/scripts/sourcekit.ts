// SourceKit-LSP on Linux, for real, which CI's `swift` job runs on Ubuntu, and anyone can on a
// Linux one of swift.org's builds fits:
//
//   pnpm nx run lsp:sourcekit               # the check
//   pnpm nx run lsp:sourcekit -- packages   # the packages Swift needs that aren't installed
//
// The check takes the build toolchains.json pins for the distribution /etc/os-release names, as
// Lo does, and fails if any package swift.org lists for it is missing; `packages` names those, one
// a line, for `apt-get` or `dnf` to install. It installs the toolchain with Lo's own installer, in
// a folder of its own that it removes after, so it's downloaded and checked against the size and
// SHA-256 toolchains.json records, and held to what it unpacks to, as Lo checks it. It starts the
// SourceKit-LSP in it as Lo's adapter does (`launchSourceKitOnLinux`), rootless, in a home of its
// own, on the checkout the code fixture builds with `--local`, which needs no network or token. It
// asks for a hover on the Swift project's `countWords`, at its definition, where
// `testing/fixtures/code/cases.json` says, and fails unless the hover gives its signature, which
// SourceKit-LSP reads from the toolchain's standard library and the system's headers. Then it fails
// if the home of the user it runs as, by `HOME` or by the system's list of users, holds a
// `.sourcekit-lsp`, or anything it didn't before, however deep: it lists every folder in the home
// before it starts and after it stops (`home.ts`), and names the paths added, changed or removed,
// other than in the runner's own folders: its work folder, where the job's checkout is, and the
// one its logs are in. It fails too if SourceKit-LSP's logs aren't in the server's own home:
// Foundation, on Linux, takes its home folder from the system's list of users before `HOME`,
// unless `CFFIXED_USER_HOME` names one.

import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { serverGitEnvironment } from '@lo/git';
import { z } from 'zod';

import {
  Installer,
  launchSourceKitOnLinux,
  missingPackages,
  packagesNeeded,
  readOsRelease,
  type Server,
  sourceKitCheckoutProblem,
  startServer,
  type SwiftDistro,
  swiftDistroFor,
  swiftToolchainId,
  TOOLCHAINS,
  toolchainUse,
} from '../src/index.ts';
import { compare, describe, listFolder, type Listing } from './home.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', '..', 'testing', 'fixtures');

/** What `cases.json` says of the Swift project: where `countWords` is defined. */
const CASES = z.object({
  cases: z.array(
    z.object({
      language: z.string(),
      definition: z.object({ file: z.string(), line: z.number(), character: z.number() }),
    }),
  ),
});

/** What the hover on `countWords` must hold: its signature, with the standard library's types. */
const SIGNATURE = 'func countWords(_ text: String) -> Int';

/** How long SourceKit-LSP has to answer each hover, and how many it's asked before it fails. */
const DEADLINE = 120_000;
const TRIES = 6;

/** How many paths of each kind a failure names, before it says how many more there are. */
const SHOWN = 40;

if (process.platform !== 'linux') throw new Error('This checks SourceKit-LSP on Linux only.');
const release = readOsRelease();
const named = release.get('PRETTY_NAME') ?? 'This Linux';
const distro = swiftDistroFor(release);
if (distro === undefined) throw new Error(`${named} takes none of swift.org's builds.`);
const missing = await missingPackages(distro);

if (process.argv[2] === 'packages') {
  for (const name of missing) console.log(name);
} else {
  await check(distro);
}

async function check(taken: SwiftDistro): Promise<void> {
  console.log(`${named} takes the build for ${taken.name}.`);
  if (missing.length > 0) {
    const needed = packagesNeeded(taken, missing);
    throw new Error(`Swift needs ${needed.needs}, which \`${needed.install}\` installs.`);
  }
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'lo-sourcekit-')));
  let server: Server | undefined;
  try {
    // The user's home, as `HOME` names it and as the system's list of users does, listed before
    // anything is installed or started.
    const homes = [...new Set([homedir(), userInfo().homedir])];
    const ignored = [folder, ...runnerFolders(homes)];
    const before = new Map<string, Listing>();
    for (const home of homes) {
      if (await exists(join(home, '.sourcekit-lsp'))) {
        throw new Error(`${home} holds a .sourcekit-lsp already, so the check can't tell.`);
      }
      before.set(home, await listFolder(home, ignored));
    }
    const id = swiftToolchainId(taken);
    const pinned = TOOLCHAINS[id];
    if (pinned === undefined) throw new Error(`toolchains.json has no ${id}.`);
    const started = performance.now();
    const installer = new Installer({
      folder: join(folder, 'toolchains'),
      fetch: globalThis.fetch,
    });
    const installed = await installer.install(id, pinned);
    console.log(`Installed ${id} ${pinned.version} in ${seconds(performance.now() - started)}.`);
    const launch = launchSourceKitOnLinux(
      { installed, ...toolchainUse(id, pinned.version, installed) },
      pinned.version,
    );
    console.log(`${launch.version}: ${launch.program}`);

    const fixture = join(folder, 'fixture');
    await promisify(execFile)('bash', [join(FIXTURES, 'code.sh'), '--local', fixture], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: tmpdir() },
    });
    const root = join(fixture, 'work');
    const refused = await sourceKitCheckoutProblem(root);
    if (refused !== undefined)
      throw new Error(`Lo refuses the code fixture's checkout: ${refused}`);

    const home = join(folder, 'home');
    const starting = performance.now();
    server = startServer({
      name: 'SourceKit-LSP',
      program: launch.program,
      args: launch.args,
      root,
      rootless: launch.rootless,
      services: launch.services,
      home,
      path: launch.path ?? [],
      variables: launch.variables,
      allowed: launch.allowed,
      homeFolders: launch.homeFolders,
      git: serverGitEnvironment(),
      settings: launch.settings,
      initializationOptions: launch.initializationOptions,
      place: launch.place,
    });
    if (!(await server.ready)) throw new Error(`It didn't start: ${server.state.kind}.`);
    console.log(
      `It answered initialize ${seconds(performance.now() - starting)} after it started.`,
    );
    const { file, position } = await definition();
    server.open(file, 'swift', await readFile(join(root, ...file.split('/')), 'utf8'));
    const said = await hover(server, file, position);
    console.log(`Its hover on countWords in ${file}: ${JSON.stringify(said)}`);
    await server.stop();

    const logs = join(home, '.sourcekit-lsp', 'logs');
    if (!(await exists(logs))) throw new Error(`Its home holds no .sourcekit-lsp/logs.`);
    console.log("Its logs are in its own home's .sourcekit-lsp/logs.");
    for (const each of homes) {
      if (await exists(join(each, '.sourcekit-lsp'))) {
        throw new Error(`It wrote ${join(each, '.sourcekit-lsp')}, in the user's home.`);
      }
      const changes = compare(before.get(each) ?? new Map(), await listFolder(each, ignored));
      const differs = describe(changes, SHOWN);
      if (differs !== undefined) {
        throw new Error(`The user's home, ${each}, holds what it didn't: ${differs}.`);
      }
    }
    console.log(`Nothing appeared in ${homes.join(' or ')}, and none holds a .sourcekit-lsp.`);
  } catch (error) {
    const log = server?.log.slice(-40) ?? [];
    if (log.length > 0) console.log(`The last of its log:\n${log.join('\n')}`);
    throw error;
  } finally {
    await server?.stop();
    await rm(folder, { recursive: true, force: true });
  }
}

/**
 * The folders of the user's `homes` that the runner this runs on keeps changing, which none of
 * what's checked has a hand in: its work folder, which holds the job's checkout, its temporary
 * folder and the actions it downloaded, and the one GitHub's images install the runner in, whose
 * logs it writes as the job runs. GitHub names the first through two variables; anywhere that's
 * not a runner, there are none.
 */
function runnerFolders(homes: readonly string[]): string[] {
  const { RUNNER_TEMP: temp, GITHUB_WORKSPACE: checkout } = process.env;
  const folders: string[] = [];
  if (temp !== undefined && temp !== '') {
    folders.push(dirname(temp), ...homes.map((home) => join(home, 'actions-runner')));
  }
  if (checkout !== undefined && checkout !== '') folders.push(checkout);
  return folders;
}

/** Where `cases.json` says `countWords` is defined in the Swift project, as the protocol puts it. */
async function definition() {
  const { cases } = CASES.parse(
    JSON.parse(await readFile(join(FIXTURES, 'code', 'cases.json'), 'utf8')),
  );
  const swift = cases.find((each) => each.language === 'swift');
  if (swift === undefined) throw new Error('cases.json has no Swift case.');
  const { file, line, character } = swift.definition;
  return { file, position: { line, character } };
}

/**
 * The text of `server`'s hover at `position` in `file`, once it holds {@link SIGNATURE}: it's asked
 * again, a few seconds apart, while it gives none.
 */
async function hover(
  server: Server,
  file: string,
  position: { line: number; character: number },
): Promise<string> {
  let last = 'nothing';
  for (let tries = 1; tries <= TRIES; tries++) {
    const answer = await server.request(
      'textDocument/hover',
      { path: file, position },
      { deadline: DEADLINE },
    );
    if (answer.ok) {
      const text = hoverText(answer.value);
      if (text.includes(SIGNATURE)) return text;
      last = JSON.stringify(text);
    } else {
      last = `no answer (${answer.why}${answer.message === undefined ? '' : `: ${answer.message}`})`;
    }
    console.log(`Hover ${tries} of ${TRIES} gave ${last}.`);
    if (tries < TRIES) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Its hover on countWords never held "${SIGNATURE}": the last gave ${last}.`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A hover's text, its parts joined. */
function hoverText(value: unknown): string {
  const contents = isObject(value) ? value.contents : undefined;
  const parts: unknown[] = Array.isArray(contents) ? contents : [contents];
  return parts
    .map((part) => (typeof part === 'string' ? part : isObject(part) ? String(part.value) : ''))
    .join('\n');
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)} s`;
}
