// The `lo` command: a small shell script that hands its one argument, a link, to Lo. On macOS it
// asks the system to start Lo by its bundle ID with the link as its argument; a Lo already running
// takes it from the new one, which quits. Elsewhere it runs Lo's program with the link. Either way
// the link is passed as one argument and nothing else, and an argument that isn't a `lo://`,
// `https://` or `http://` link, which Lo would refuse or read as a switch, is refused before
// anything runs. Lo's Linux packages install a `lo` of their own, a link to Lo's program, which
// counts as the command installed while it leads there. Nothing here calls Electron.

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import type { CommandState, Installed } from '../contract.ts';

/** The packaged app's bundle ID, as `build/electron-builder.yml` gives it. */
export const BUNDLE_ID = 'com.scornz.lo';

/** The command's name. */
export const COMMAND = 'lo';

/**
 * The `lo` Lo's deb and rpm install: a link, made as they install, to Lo's program in
 * `/opt/Lo/lo`.
 */
export const PACKAGE_COMMAND = '/usr/bin/lo';

/** The line every `lo` Lo writes starts with, after the shebang, so Lo knows its own. */
export const MARK =
  '# lo: opens a pull request in Lo, as in `lo https://github.com/owner/repo/pull/123`.';

/** How the command starts Lo. */
export type Launch =
  /** macOS: `open` starts the app by its bundle ID, a new copy each time, with the link. */
  | { readonly kind: 'bundle'; readonly bundleId: string; readonly open?: string | undefined }
  /**
   * Runs `program` with `args`, then the link, with `env` added to its environment: what a build
   * run from source needs to reach the Lo that's running, its data folder.
   */
  | {
      readonly kind: 'program';
      readonly program: string;
      readonly args: readonly string[];
      readonly env?: Readonly<Record<string, string>> | undefined;
    };

/** `text` quoted for the shell: nothing in it is read as anything but itself. */
export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * The script `lo` is: it takes exactly one argument, refuses one that isn't a link, and passes
 * it on quoted, as one argument, to what starts Lo.
 */
export function commandScript(launch: Launch): string {
  const start =
    launch.kind === 'bundle'
      ? // `-n` starts a new copy even when Lo is running, since `open` drops the arguments it's
        // given for an app that's running. That copy hands the link to the running one and quits.
        `exec ${shellQuote(launch.open ?? '/usr/bin/open')} -n -b ${shellQuote(launch.bundleId)} --args "$1"`
      : `exec ${programLine(launch)} "$1"`;
  return [
    '#!/bin/sh',
    MARK,
    '# Lo wrote this file, and writes it again when the command is installed again.',
    'if [ "$#" -ne 1 ]; then',
    "  echo 'usage: lo <pull request link>' >&2",
    '  exit 2',
    'fi',
    // A link and nothing else, from its first character: Lo itself would read an option, even
    // after whitespace, as one of Chromium's switches.
    'case "$1" in',
    '  [Ll][Oo]://* | [Hh][Tt][Tt][Pp]://* | [Hh][Tt][Tt][Pp][Ss]://*) ;;',
    '  *)',
    "    echo 'lo: not a pull request link. Try lo https://github.com/owner/repo/pull/123' >&2",
    '    exit 2',
    '    ;;',
    'esac',
    start,
    '',
  ].join('\n');
}

/** The program, its arguments and its environment, quoted, before the link. */
function programLine({ program, args, env = {} }: Extract<Launch, { kind: 'program' }>): string {
  const set = Object.entries(env).map(([name, value]) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) throw new Error(`Not a variable's name: ${name}`);
    return `${name}=${value}`;
  });
  const words = set.length > 0 ? ['/usr/bin/env', ...set, program, ...args] : [program, ...args];
  return words.map(shellQuote).join(' ');
}

/** Whether `text` is a `lo` Lo wrote. */
export function isOurs(text: string): boolean {
  return text.split('\n', 3)[1] === MARK;
}

/** What a file holds, whether there's no file, or why Lo couldn't read it. */
async function contents(path: string): Promise<Contents> {
  try {
    return { kind: 'text', text: await readFile(path, 'utf8') };
  } catch (error) {
    // Only a file that isn't there is absent: one Lo can't read, or a folder, may be anything.
    const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
    return code === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable', why: describe(error) };
  }
}

/** What's at a path Lo might install `lo` at: nothing, a file's text, or what Lo couldn't read. */
type Contents =
  { kind: 'absent' } | { kind: 'text'; text: string } | { kind: 'unreadable'; why: string };

/** Where `lo` may be, in the order Lo installs it: the system's folder first, then the person's. */
export interface Folders {
  /** `/usr/local/bin` on macOS, where installing may take an administrator. None on Linux. */
  readonly system?: string | undefined;
  /** `~/.local/bin`. */
  readonly user: string;
  /**
   * A packaged Lo on Linux: the `lo` its package installed ({@link PACKAGE_COMMAND}), and Lo's own
   * program, which the link counts as the command for while it leads there.
   */
  readonly packaged?: { readonly link: string; readonly program: string } | undefined;
}

/**
 * The `lo` a Linux package installed, when it leads to Lo's own program, through however many
 * links (`update-alternatives` makes two): nothing when it's missing, or leads anywhere else.
 */
async function packageCommand(folders: Folders): Promise<string | undefined> {
  if (folders.packaged === undefined) return undefined;
  const { link, program } = folders.packaged;
  try {
    const [found, own] = await Promise.all([realpath(link), realpath(program)]);
    return found === own ? link : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Each `lo` Lo wrote in `folders`, and whether it's `script`; and first, the `lo` a Linux package
 * installed, while it leads to Lo, which always counts as current.
 */
export async function findCommand(folders: Folders, script: string): Promise<CommandState> {
  const installed: CommandState['installed'] = [];
  const packaged = await packageCommand(folders);
  if (packaged !== undefined) installed.push({ path: packaged, current: true });
  for (const folder of [folders.system, folders.user]) {
    if (folder === undefined) continue;
    const path = join(folder, COMMAND);
    const found = await contents(path);
    if (found.kind === 'text' && isOurs(found.text)) {
      installed.push({ path, current: found.text === script });
    }
  }
  return { installed };
}

/** How asking for an administrator to install went: done, declined, or failed, and why. */
export type Elevated =
  { kind: 'done' } | { kind: 'declined' } | { kind: 'failed'; message: string };

export interface InstallOptions {
  readonly folders: Folders;
  readonly script: string;
  /**
   * Installs the file at `from` as `to` as an administrator, once the system's prompt allows it.
   * Without it, Lo installs where it can write, and nowhere else.
   */
  readonly elevate?: ((from: string, to: string) => Promise<Elevated>) | undefined;
  /** The folders the shell searches for commands, as `PATH` says, if Lo knows them. */
  readonly path?: string | undefined;
  readonly log?: (line: string) => void;
}

/**
 * Installs `lo`: in the system's folder, writing it there if Lo may and asking for an administrator
 * if not, and in the person's own folder when that isn't allowed or there's no system's folder. A
 * `lo` that Lo didn't write is never replaced. Where Lo's Linux package installed a `lo` that leads
 * to it, that's the command, and nothing is written.
 */
export async function installCommand(options: InstallOptions): Promise<Installed> {
  const { folders, script, elevate, log = () => undefined } = options;
  const packaged = await packageCommand(folders);
  if (packaged !== undefined) {
    return { kind: 'installed', path: packaged, onPath: onPath(dirname(packaged), options.path) };
  }
  for (const folder of [folders.system, folders.user]) {
    if (folder === undefined) continue;
    const path = join(folder, COMMAND);
    const found = await contents(path);
    if (found.kind === 'unreadable') {
      return { kind: 'failed', why: 'unreadable', details: `${path}\n${found.why}` };
    }
    if (found.kind === 'text' && !isOurs(found.text)) return { kind: 'taken', path };
  }
  const { system, user } = folders;
  if (system !== undefined) {
    const path = join(system, COMMAND);
    try {
      if (await writable(system)) {
        await writeCommand(system, script);
        return { kind: 'installed', path, onPath: true };
      }
      if (elevate) {
        const elevated = await withScript(script, (from) => elevate(from, path));
        if (elevated.kind === 'done') return { kind: 'installed', path, onPath: true };
        if (elevated.kind === 'failed') log(`installing ${path}: ${elevated.message}`);
      }
    } catch (error) {
      log(`installing ${path}: ${describe(error)}`);
    }
  }
  const path = join(user, COMMAND);
  try {
    await mkdir(user, { recursive: true, mode: 0o755 });
    await writeCommand(user, script);
  } catch (error) {
    return { kind: 'failed', why: 'unwritable', details: `${path}\n${describe(error)}` };
  }
  return { kind: 'installed', path, onPath: onPath(user, options.path) };
}

/** Whether the shell searches `folder` for commands, as `path`, the `PATH`, says, if Lo knows it. */
function onPath(folder: string, path: string | undefined): boolean {
  return path?.split(delimiter).includes(folder) ?? false;
}

/** Whether this user may write in `folder`, which exists. */
async function writable(folder: string): Promise<boolean> {
  try {
    await access(folder, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Writes `script` as `folder/lo`, all at once: a file of its own, then moved into place. */
async function writeCommand(folder: string, script: string): Promise<void> {
  const temporary = join(folder, `.${COMMAND}-${randomBytes(6).toString('hex')}`);
  try {
    await writeFile(temporary, script, { mode: 0o755, flag: 'wx' });
    await chmod(temporary, 0o755);
    await rename(temporary, join(folder, COMMAND));
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Runs `use` with `script` written to a file of Lo's own, removed after. */
async function withScript<T>(script: string, use: (file: string) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(join(tmpdir(), 'lo-command-'));
  try {
    const file = join(folder, COMMAND);
    await writeFile(file, script, { mode: 0o755 });
    return await use(file);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/**
 * Installs the file at `from` as `to` as an administrator on macOS, through the system's prompt,
 * which says why Lo asks. Both paths reach the shell only quoted, as AppleScript's arguments.
 */
export function elevateOnMac(
  osascript = '/usr/bin/osascript',
): (from: string, to: string) => Promise<Elevated> {
  const script = [
    'on run argv',
    'set source to item 1 of argv',
    'set target to item 2 of argv',
    'set folder to item 3 of argv',
    'do shell script "/bin/mkdir -p " & quoted form of folder & " && /usr/bin/install -S -m 755 " & quoted form of source & " " & quoted form of target with prompt "Installing the lo command needs an administrator’s password." with administrator privileges',
    'end run',
  ];
  return (from, to) =>
    new Promise((resolve) => {
      const folder = to.slice(0, to.lastIndexOf('/'));
      const args = [...script.flatMap((line) => ['-e', line]), from, to, folder];
      execFile(osascript, args, { timeout: 5 * 60_000 }, (error, _stdout, stderr) => {
        if (!error) resolve({ kind: 'done' });
        // -128 is AppleScript's "User canceled."
        else if (/-128\b/.test(stderr)) resolve({ kind: 'declined' });
        else resolve({ kind: 'failed', message: stderr.trim() || error.message });
      });
    });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
