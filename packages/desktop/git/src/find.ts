/**
 * Finding a git Lo can run: one 2.41 or newer that reads a partial clone without downloading what
 * it lacks, as `GIT_NO_LAZY_FETCH` asks. Nothing is remembered between calls, so asking again finds
 * a git installed since.
 */

import { access, appendFile, lstat, mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';

import { type Environment, inheritedEnvironment } from './environment.ts';
import { Git, Runner } from './git.ts';
import { oidFromOutput } from './oid.ts';
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
  /**
   * The groups that may write to git and its folders: root's, and on a Mac `admin`, whose members
   * can become root, and which Homebrew's folders belong to.
   */
  readonly groups: readonly number[];
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
      groups: [0, 80],
    };
  }
  return { folders: ['/usr/local/bin', '/usr/bin'], groups: [0] };
}

/**
 * Finds git: on a Mac, Apple's first when the Command Line Tools are installed, then each `git` on
 * `PATH`, then the system's usual folders. The first new enough wins. A git that someone besides
 * this user or root could change is passed over. Without one, it says why: the first git that was
 * too old, else the first passed over, else that there's none.
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
  // A git that others could change, which is passed over, and said so when it's the only one.
  let passedOver: GitStatus | undefined;
  for (const candidate of candidates) {
    const real = await realpath(candidate).catch(() => undefined);
    if (real === undefined || real === stub || tried.has(real)) continue;
    tried.add(real);
    if (!(await isExecutableFile(candidate))) continue;
    const distrusted = await distrustProgram(candidate, real, places.groups);
    if (distrusted !== undefined) {
      passedOver ??= {
        status: 'missing',
        message: `Lo found git at ${candidate}, but ${distrusted}, so Lo won't run it.`,
        install: installAdvice(options.platform),
      };
      continue;
    }
    const status = await check(candidate, inherited, options.platform);
    if (status.status === 'found') return status;
    if (status.status === 'tooOld') tooOld ??= status;
  }
  return tooOld ?? passedOver ?? missing(options.platform);
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
        `Lo needs a git that can be kept from downloading on its own (GIT_NO_LAZY_FETCH), as ` +
        `git 2.45 and newer can, and ${program}, git ${formatVersion(version)}, can't.`,
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

/**
 * What a git that honors `GIT_NO_LAZY_FETCH` may say, once, when the variable stops it downloading
 * a missing object.
 */
const LAZY_FETCH_WARNING = 'warning: lazy fetching disabled; some objects may not be available';

/**
 * Whether `git` reads a partial clone without downloading, and says a file the clone lacks is
 * missing, so asking beats reading its version. It asks a throwaway clone, whose promisor remote
 * doesn't exist, about a file one of its trees names but it lacks, as a blobless fetch leaves
 * them. A git that honors `GIT_NO_LAZY_FETCH` just says the file is missing; one that doesn't
 * tries to download it and fails loudly; and the May 2024 updates of 2.41 to 2.44, which honor the
 * variable, give up on such a file with a fatal error, which would fail every read of a clone.
 * None reaches the network: the remote is a folder, which git may not fetch from.
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
    const inClone = () => runner.command({ gitDir: clone });
    const file = oidFromOutput(await inClone().arg('hash-object', '--stdin').run('probe\n'));
    // A tree that names the file, in a pack from the promisor remote, without the file.
    const tree = oidFromOutput(
      await inClone().arg('mktree', '--missing').run(`100644 blob ${file}\tprobe\n`),
    );
    const packs = join(clone, 'objects', 'pack');
    const written = await inClone()
      .arg('pack-objects', '--quiet')
      .path(join(packs, 'pack'))
      .run(`${tree}\n`);
    const pack = written.toString('utf8').trim();
    if (!/^[0-9a-f]+$/.test(pack)) return false;
    await appendFile(join(packs, `pack-${pack}.promisor`), '');
    const finished = await inClone().arg('cat-file', '-e', file).finish();
    const said = finished.stderr.trim();
    return finished.code === 1 && (said === '' || said === LAZY_FETCH_WARNING);
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

/**
 * Why someone besides this user and root could change the git at `candidate`, which is `real` once
 * links are followed, or `undefined` when nobody else can. The file, the link to it and every
 * folder above either must be owned by root or this user. None may be writable by everyone, and
 * none by its group unless the group is one of `groups`, whose members can become root anyway,
 * as Homebrew's folders are its `admin` group's. A folder further up may be writable by others
 * only when it's sticky, as `/tmp` is, so that nobody else can move what's in it.
 */
async function distrustProgram(
  candidate: string,
  real: string,
  groups: readonly number[],
): Promise<string | undefined> {
  const user = process.getuid?.();
  const ours = (uid: number) => uid === 0 || uid === user;
  // Whether someone besides the owner, root and the trusted groups may write to it.
  const othersMayWrite = (info: { mode: number; gid: number }) =>
    (info.mode & 0o002) !== 0 || ((info.mode & 0o020) !== 0 && !groups.includes(info.gid));
  try {
    const file = await stat(real);
    if (!ours(file.uid)) return 'another user owns it';
    if (othersMayWrite(file)) return 'other users can change it';
    for (const path of new Set([
      real,
      join(await realpath(dirname(candidate)), basename(candidate)),
    ])) {
      let child = path;
      for (let folder = dirname(path); ; folder = dirname(folder)) {
        const info = await stat(folder);
        if (!ours(info.uid)) return `another user owns ${folder}`;
        if (othersMayWrite(info)) {
          const nearest = child === path;
          const sticky = (info.mode & 0o1000) !== 0;
          const childOwner = (await lstat(child)).uid;
          if (nearest || !sticky || !ours(childOwner)) {
            return `other users can change ${folder}`;
          }
        }
        if (folder === dirname(folder)) break;
        child = folder;
      }
    }
    return undefined;
  } catch (error) {
    return `it can't be checked (${error instanceof Error ? error.message : String(error)})`;
  }
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
