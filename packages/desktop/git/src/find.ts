/**
 * Finding a git Lo can run: one 2.41 or newer that honors `GIT_NO_LAZY_FETCH`. Nothing is
 * remembered between calls, so asking again finds a git installed since.
 */

import { access, appendFile, mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

import { type Environment, inheritedEnvironment } from './environment.ts';
import { Git, Runner } from './git.ts';
import { Child, type Finished } from './spawn.ts';
import {
  compareVersions,
  formatVersion,
  type GitVersion,
  MINIMUM_VERSION,
  parseVersion,
} from './version.ts';

/** Whether Lo has a git, and if not, why not and how to get one. */
export type GitStatus =
  | { readonly status: 'found'; readonly git: Git }
  | {
      readonly status: 'missing';
      /** What's wrong, for the user. */
      readonly message: string;
      /** How to install git on this system. */
      readonly install: string;
    }
  | {
      readonly status: 'tooOld';
      readonly program: string;
      readonly version: GitVersion;
      /** The check it failed: its version, or whether it can be kept from downloading. */
      readonly check: 'version' | 'lazyFetch';
      readonly message: string;
      readonly install: string;
    };

/** Where git may be besides `PATH`. */
export interface Places {
  /**
   * Apple's git and the program that says where the Command Line Tools are. Without the tools,
   * Apple's git is a stub that opens their installer, so it's run only once they're there.
   */
  readonly apple?: { readonly git: string; readonly xcodeSelect: string } | undefined;
  /** Folders to look in after `PATH`: the Finder gives an app a short `PATH`. */
  readonly folders: readonly string[];
}

export interface FindOptions {
  /** Lo's environment: `PATH` says where to look, and git keeps a few of its variables. */
  readonly env: Environment;
  readonly platform: NodeJS.Platform;
  /** Where to look besides `PATH`. Each system has its own; tests point them at fakes. */
  readonly places?: Places | undefined;
}

/** Where git is on each system, besides `PATH`. */
export function defaultPlaces(platform: NodeJS.Platform): Places {
  if (platform === 'darwin') {
    return {
      apple: { git: '/usr/bin/git', xcodeSelect: '/usr/bin/xcode-select' },
      folders: ['/opt/homebrew/bin', '/usr/local/bin'],
    };
  }
  return { folders: ['/usr/local/bin', '/usr/bin'] };
}

/**
 * Finds git: on a Mac, Apple's first when the Command Line Tools are installed, then each `git` on
 * `PATH`, then the system's usual folders. The first new enough wins. Without one, it says why,
 * naming the first git that was too old if there was one.
 */
export async function findGit(options: FindOptions): Promise<GitStatus> {
  const places = options.places ?? defaultPlaces(options.platform);
  const inherited = inheritedEnvironment(options.env);
  const folders = (options.env.PATH ?? '').split(delimiter).filter((folder) => isAbsolute(folder));
  const candidates: string[] = [];
  let stub: string | undefined;
  if (places.apple !== undefined) {
    if (await hasCommandLineTools(places.apple.xcodeSelect, inherited)) {
      candidates.push(places.apple.git);
    } else {
      stub = await realpath(places.apple.git).catch(() => places.apple?.git);
    }
  }
  candidates.push(...[...folders, ...places.folders].map((folder) => join(folder, 'git')));

  const tried = new Set<string>();
  let tooOld: GitStatus | undefined;
  for (const candidate of candidates) {
    const real = await realpath(candidate).catch(() => undefined);
    if (real === undefined || real === stub || tried.has(real)) continue;
    tried.add(real);
    if (!(await isExecutableFile(candidate))) continue;
    const status = await check(candidate, inherited, options.platform);
    if (status.status === 'found') return status;
    if (status.status === 'tooOld') tooOld ??= status;
  }
  return tooOld ?? missing(options.platform);
}

/** The git at `program`, if it runs and is new enough: for a git the user named. */
export async function gitAt(
  program: string,
  options: { env: Environment; platform: NodeJS.Platform },
): Promise<GitStatus> {
  if (!isAbsolute(program) || !(await isExecutableFile(program))) return missing(options.platform);
  return check(program, inheritedEnvironment(options.env), options.platform);
}

async function check(
  program: string,
  inherited: Record<string, string>,
  platform: NodeJS.Platform,
): Promise<GitStatus> {
  const version = await readVersion(program, inherited);
  if (version === undefined) return missing(platform);
  const install = installAdvice(platform);
  if (compareVersions(version, MINIMUM_VERSION) < 0) {
    return {
      status: 'tooOld',
      program,
      version,
      check: 'version',
      message:
        `Lo needs git ${formatVersion(MINIMUM_VERSION)} or newer, and ${program} is git ` +
        `${formatVersion(version)}.`,
      install,
    };
  }
  const git = new Git(program, version, inherited);
  const lazyFetchOff = await lazyFetchIsOff(git).catch(() => undefined);
  if (lazyFetchOff === undefined) return missing(platform);
  if (!lazyFetchOff) {
    return {
      status: 'tooOld',
      program,
      version,
      check: 'lazyFetch',
      message:
        `Lo needs a git that can be kept from downloading on its own (GIT_NO_LAZY_FETCH), which ` +
        `git 2.45 and the May 2024 updates of older versions have, and ${program}, git ` +
        `${formatVersion(version)}, doesn't.`,
      install,
    };
  }
  return { status: 'found', git };
}

function missing(platform: NodeJS.Platform): GitStatus {
  return { status: 'missing', message: "Lo can't find git.", install: installAdvice(platform) };
}

/** How to install git, or a newer one, on `platform`. */
export function installAdvice(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return (
      'Install or update the Xcode Command Line Tools: run `xcode-select --install` in ' +
      'Terminal. Or install git with Homebrew: `brew install git`.'
    );
  }
  return (
    "Install or update git with your system's package manager, such as `sudo apt install git` " +
    'or `sudo dnf install git`. Where it has an older git, git-scm.com lists newer packages.'
  );
}

/** How long a git may take to say its version. */
const VERSION_LIMIT = 10_000;

/** `program --version`, if it runs and says it's git. */
async function readVersion(
  program: string,
  inherited: Record<string, string>,
): Promise<GitVersion | undefined> {
  const finished = await runLimited(program, ['--version'], {
    ...inherited,
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: devNull,
  });
  if (finished?.code !== 0) return undefined;
  return parseVersion(finished.stdout.toString('utf8'));
}

/** Runs `program` with `args` for at most {@link VERSION_LIMIT}, or `undefined` if it can't. */
async function runLimited(
  program: string,
  args: string[],
  env: Record<string, string>,
): Promise<Finished | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const child = new Child(program, {
      args,
      env,
      cwd: '/',
      input: false,
      display: [program, ...args].join(' '),
    });
    timer = setTimeout(() => child.stop(), VERSION_LIMIT);
    return await child.finish();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** An object ID no repository has. */
const MISSING_OBJECT = `${'0'.repeat(39)}1`;

/**
 * Whether `git` honors `GIT_NO_LAZY_FETCH`, which git 2.45 added and May 2024's maintenance
 * releases brought to older lines, so asking beats reading its version. It asks a throwaway clone,
 * whose promisor remote doesn't exist, for an object it lacks: a git that honors the variable just
 * says the object is missing, and one that doesn't tries to download it and fails loudly. Neither
 * reaches the network: the remote is a folder, which git may not fetch from.
 */
export async function lazyFetchIsOff(git: Git): Promise<boolean> {
  const folder = await mkdtemp(join(tmpdir(), 'lo-git-'));
  try {
    const home = join(folder, 'home');
    const clone = join(folder, 'probe.git');
    await mkdir(home);
    const runner = new Runner(git, { home, ceiling: folder });
    await runner.command('none').arg('init', '--bare', '--quiet', '--template=').path(clone).run();
    const missingRemote = `file://${join(folder, 'missing')}`.replaceAll(/["\\]/g, '\\$&');
    await appendFile(
      join(clone, 'config'),
      '[core]\n\trepositoryformatversion = 1\n[extensions]\n\tpartialclone = origin\n' +
        `[remote "origin"]\n\turl = "${missingRemote}"\n\tpromisor = true\n`,
    );
    const finished = await runner
      .command({ gitDir: clone })
      .arg('cat-file', '-e', MISSING_OBJECT)
      .finish();
    return finished.code === 1 && finished.stderr.trim() === '';
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/**
 * Whether the Command Line Tools, or Xcode, are installed: `xcode-select -p` names a folder that
 * holds git.
 */
async function hasCommandLineTools(
  xcodeSelect: string,
  inherited: Record<string, string>,
): Promise<boolean> {
  if (!(await isExecutableFile(xcodeSelect))) return false;
  const finished = await runLimited(xcodeSelect, ['-p'], { ...inherited, LC_ALL: 'C' });
  const folder = finished?.stdout.toString('utf8').trim() ?? '';
  if (finished?.code !== 0 || !isAbsolute(folder)) return false;
  return isExecutableFile(join(folder, 'usr', 'bin', 'git'));
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
