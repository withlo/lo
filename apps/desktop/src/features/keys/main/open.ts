// Opening the keymap file in an editor, which must never run anything. A keymap that is a script
// with its executable bit set (a dotfiles sync often leaves one) opens in Terminal and runs when
// the system is asked to "open" it, and one linked to an app launches it. So Lo resolves the path,
// refuses anything but a plain, non-executable text file within the size limit, and opens it as
// text, with the system's app for text, whatever the file's name or contents: `open -t` on macOS,
// and on Linux the app `xdg-mime` names for `text/plain`, launched with `gio launch`. `xdg-open`
// would choose by the name and contents of what a link leads to, and open a keymap linked to
// `x.desktop` as a launcher, or to `x.html` in a browser. Every program runs with an argument list
// and no shell. Nothing here calls Electron, so it runs under unit tests.

import { execFile, spawn as spawnProcess } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { ensureKeymap, readKeymap } from './keymap.ts';

/** Starts a program with an argument list, with no shell. It settles once the program has. */
export type Launch = (command: string, args: readonly string[]) => Promise<void>;

/** Runs a program with an argument list, with no shell, and gives what it printed. */
export type Query = (command: string, args: readonly string[]) => Promise<string>;

/** The variables of the environment Lo runs in. */
type Environment = Readonly<Record<string, string | undefined>>;

/** How long the system's opener may run before Lo takes it as the editor itself, in ms. */
const OPENER_TIME = 5_000;

/** How long a program Lo asks something of may take to answer, in ms. */
const QUERY_TIME = 5_000;

/**
 * Runs `command` with `args` and no shell, apart from Lo: it resolves when the program exits with
 * 0 or, for an opener that stays until the editor closes, after a few seconds; it rejects when the
 * program can't start or exits with an error.
 */
export const launch: Launch = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      shell: false,
      stdio: 'ignore',
      detached: true,
    });
    const timer = setTimeout(resolve, OPENER_TIME);
    timer.unref();
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${String(code)}.`));
    });
    // Whatever opens the file goes on without Lo.
    child.unref();
  });

/**
 * Runs `command` with `args` and no shell, and resolves with what it printed once it exits with 0.
 * It rejects when the program can't start, fails, takes over a few seconds or prints too much.
 */
export const query: Query = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { shell: false, timeout: QUERY_TIME, maxBuffer: 64 * 1024, encoding: 'utf8' },
      (error, printed) => {
        if (error) reject(new Error(`${command} failed: ${error.message}`, { cause: error }));
        else resolve(printed);
      },
    );
  });

/** What Lo needs to find the system's app for text on Linux. */
export interface Linux {
  /** Asks `xdg-mime` which app opens text. */
  readonly query: Query;
  /** The environment, for the folders apps are listed in (`XDG_DATA_HOME`, `XDG_DATA_DIRS`). */
  readonly env: Environment;
  /** The home folder, where those folders are when the environment doesn't say. */
  readonly home: string;
}

/** A desktop file's ID as Lo takes it: a file name, with nothing that reads as a path or an option. */
const DESKTOP_ID = /^[A-Za-z0-9_][\w.+-]{0,254}\.desktop$/;

/** The most `-` in an ID whose every reading as folders is looked for; past it, only the ID itself. */
const MOST_FOLDERS = 6;

/**
 * The folders apps are listed in, most important first, as the XDG base directory spec has them:
 * `$XDG_DATA_HOME/applications`, then each of `$XDG_DATA_DIRS`. A folder that isn't absolute is
 * ignored, as the spec says.
 */
export function applicationFolders(env: Environment, home: string): string[] {
  const dataHome =
    env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME)
      ? env.XDG_DATA_HOME
      : join(home, '.local', 'share');
  const dataDirs = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share')
    .split(':')
    .filter((folder) => isAbsolute(folder));
  return [dataHome, ...dataDirs].map((folder) => join(folder, 'applications'));
}

/**
 * Where in a folder of apps the desktop file `id` can be: `id` itself, then, as an ID stands for a
 * file in a folder by joining them with `-` (`kde4-kate.desktop` for `kde4/kate.desktop`), each
 * reading of its `-` as `/`.
 */
export function desktopPaths(id: string): string[] {
  const parts = id.split('-');
  if (parts.length - 1 > MOST_FOLDERS) return [id];
  let paths = [parts[0] ?? ''];
  for (const part of parts.slice(1)) {
    paths = paths.flatMap((path) => [`${path}-${part}`, `${path}/${part}`]);
  }
  // A reading with a folder named `.`, `..` or nothing would lead out of the folder of apps.
  return paths.filter((path) =>
    path.split('/').every((name) => name !== '' && name !== '.' && name !== '..'),
  );
}

/**
 * The desktop file of the app the system opens text with, or none when it can't be found: `xdg-mime`
 * names it for `text/plain`, and it's looked for in the folders apps are listed in.
 */
export async function textApp(linux: Linux): Promise<string | undefined> {
  let printed: string;
  try {
    printed = await linux.query('xdg-mime', ['query', 'default', 'text/plain']);
  } catch {
    return undefined;
  }
  const [id] = printed.split(/[;\s]+/).filter((each) => each !== '');
  if (id === undefined || !DESKTOP_ID.test(id)) return undefined;
  for (const folder of applicationFolders(linux.env, linux.home)) {
    for (const path of desktopPaths(id)) {
      const file = join(folder, path);
      const found = await stat(file).then(
        (info) => info.isFile(),
        () => false,
      );
      if (found) return file;
    }
  }
  return undefined;
}

/**
 * The program and arguments that open `path` as text on `platform`, or none where Lo has none.
 * `path` is absolute, so it can't be read as an option. A build run from source can name another
 * program with `editor`, for its tests.
 */
export async function textEditorCommand(
  platform: NodeJS.Platform,
  path: string,
  options: { editor?: string | undefined; linux: Linux },
): Promise<{ command: string; args: string[] } | undefined> {
  if (options.editor !== undefined) return { command: options.editor, args: [path] };
  // The default text editor, whatever the file's name or type.
  if (platform === 'darwin') return { command: '/usr/bin/open', args: ['-t', path] };
  if (platform === 'linux') {
    const app = await textApp(options.linux);
    return app === undefined ? undefined : { command: 'gio', args: ['launch', app, path] };
  }
  return undefined;
}

/** What opening the keymap file came to: it did, or why it didn't, in words to show. */
export type OpenResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Opens the keymap file at `path` as text, writing it first with a commented header if there is
 * none. The path is resolved, following dotfile links, and what it leads to is checked as the
 * file is when it is read: a plain, non-executable text file within the limit, and nothing else.
 * Anything else is refused with its reason, and nothing is started.
 */
export async function openKeymapFile(
  path: string,
  options: { platform: NodeJS.Platform; launch: Launch; linux: Linux; editor?: string | undefined },
): Promise<OpenResult> {
  try {
    await ensureKeymap(path);
  } catch {
    return { ok: false, reason: "Lo couldn't create the keymap file." };
  }
  let resolved: string;
  try {
    resolved = await realpath(path);
  } catch {
    // A link to nothing, or a circle of them: the file's own reading says which.
    const file = await readKeymap(path);
    return { ok: false, reason: file.problem ?? "Lo couldn't find the keymap file." };
  }
  const file = await readKeymap(resolved);
  if (!file.canOpen) return { ok: false, reason: file.problem ?? "Lo won't open the keymap file." };
  const opener = await textEditorCommand(options.platform, resolved, options);
  if (!opener) {
    const reason =
      options.platform === 'linux'
        ? "Lo couldn't find the app for text files (`xdg-mime query default text/plain`), so it didn't open the keymap file."
        : "Lo can't open the keymap file on this system.";
    return { ok: false, reason };
  }
  try {
    await options.launch(opener.command, opener.args);
  } catch {
    return { ok: false, reason: "Lo couldn't open the keymap file in a text editor." };
  }
  return { ok: true };
}
