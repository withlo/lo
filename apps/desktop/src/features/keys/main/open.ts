// Opening the keymap file in an editor, which must never run anything. A keymap that is a script
// with its executable bit set (a dotfiles sync often leaves one) opens in Terminal and runs when
// the system is asked to "open" it, and one linked to an app launches it. So Lo resolves the path,
// refuses anything but a plain, non-executable text file within the size limit, and opens it as
// text, with the system's app for text (`main/editor.ts`). Nothing here calls Electron, so it runs
// under unit tests.

import { realpath } from 'node:fs/promises';

import { textEditorCommand, type Launch, type Linux } from '../../../main/editor.ts';
import { ensureKeymap, readKeymap } from './keymap.ts';

/**
 * What opening the keymap file came to: it opened, or why not: it couldn't be made (`create`),
 * it's a file Lo won't open (`refused`), there's no app for text (`noApp`, on Linux) or no way to
 * open one on this system (`unsupported`), or the app didn't start (`launch`). `said` is what the
 * system said, as it came.
 */
export type KeymapOpened =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly why: 'create' | 'refused' | 'noApp' | 'unsupported' | 'launch';
      readonly said?: string | undefined;
    };

function said(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Opens the keymap file at `path` as text, writing it first with a commented header if there is
 * none. The path is resolved, following dotfile links, and what it leads to is checked as the
 * file is when it is read: a plain, non-executable text file within the limit, and nothing else.
 * Anything else is refused with its reason, and nothing is started.
 */
export async function openKeymapFile(
  path: string,
  options: { platform: NodeJS.Platform; launch: Launch; linux: Linux; editor?: string | undefined },
): Promise<KeymapOpened> {
  try {
    await ensureKeymap(path);
  } catch (error) {
    return { ok: false, why: 'create', said: said(error) };
  }
  let resolved: string;
  try {
    resolved = await realpath(path);
  } catch (error) {
    // A link to nothing, or a circle of them: the window has the file's own reading, which says.
    return { ok: false, why: 'refused', said: said(error) };
  }
  const file = await readKeymap(resolved);
  if (!file.canOpen) return { ok: false, why: 'refused' };
  const opener = await textEditorCommand(options.platform, resolved, options);
  if (!opener) return { ok: false, why: options.platform === 'linux' ? 'noApp' : 'unsupported' };
  try {
    await options.launch(opener.command, opener.args);
  } catch (error) {
    return { ok: false, why: 'launch', said: said(error) };
  }
  return { ok: true };
}
