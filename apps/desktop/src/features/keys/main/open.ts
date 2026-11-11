// Opening the keymap file in an editor, which must never run anything. A keymap that is a script
// with its executable bit set (a dotfiles sync often leaves one) opens in Terminal and runs when
// the system is asked to "open" it, and one linked to an app launches it. So Lo resolves the path,
// refuses anything but a plain, non-executable text file within the size limit, and opens it as
// text: `open -t` on macOS, `xdg-open` on Linux, run with an argument list and no shell. Nothing
// here calls Electron, so it runs under unit tests.

import { spawn as spawnProcess } from 'node:child_process';
import { realpath } from 'node:fs/promises';

import { ensureKeymap, readKeymap } from './keymap.ts';

/** Starts a program with an argument list, with no shell. It settles once the program has. */
export type Launch = (command: string, args: readonly string[]) => Promise<void>;

/** How long the system's opener may run before Lo takes it as the editor itself, in ms. */
const OPENER_TIME = 5_000;

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
 * The program and arguments that open `path` as text on `platform`, or none where Lo has none.
 * `path` is absolute, so it can't be read as an option. A build run from source can name another
 * program with `editor`, for its tests.
 */
export function textEditorCommand(
  platform: NodeJS.Platform,
  path: string,
  editor?: string,
): { command: string; args: string[] } | undefined {
  if (editor !== undefined) return { command: editor, args: [path] };
  // The default text editor, whatever the file's name or type.
  if (platform === 'darwin') return { command: '/usr/bin/open', args: ['-t', path] };
  if (platform === 'linux') return { command: 'xdg-open', args: [path] };
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
  options: { platform: NodeJS.Platform; launch: Launch; editor?: string },
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
  const opener = textEditorCommand(options.platform, resolved, options.editor);
  if (!opener) return { ok: false, reason: "Lo can't open the keymap file on this system." };
  try {
    await options.launch(opener.command, opener.args);
  } catch {
    return { ok: false, reason: "Lo couldn't open the keymap file in a text editor." };
  }
  return { ok: true };
}
