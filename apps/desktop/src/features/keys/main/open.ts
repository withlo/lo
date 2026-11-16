// Opening the keymap file in an editor, which must never run anything. A keymap that is a script
// with its executable bit set (a dotfiles sync often leaves one) opens in Terminal and runs when
// the system is asked to "open" it, and one linked to an app launches it. So Lo resolves the path,
// refuses anything but a plain, non-executable text file within the size limit, and opens it as
// text, with the system's app for text (`main/editor.ts`). Nothing here calls Electron, so it runs
// under unit tests.

import { realpath } from 'node:fs/promises';

import {
  textEditorCommand,
  type Launch,
  type Linux,
  type OpenResult,
} from '../../../main/editor.ts';
import { ensureKeymap, readKeymap } from './keymap.ts';

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
