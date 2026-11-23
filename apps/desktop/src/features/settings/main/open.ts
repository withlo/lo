// Opening the settings file in an editor, as text, so the person can fix what keeps Lo from
// reading or writing it. Like the keymap file, it's resolved, following dotfile links, and opened
// only as a plain file within the size limit, without its executable bit, which opening could run,
// with the system's app for text (`main/editor.ts`). Nothing here calls Electron, so it runs under
// unit tests.

import { realpath, stat } from 'node:fs/promises';

import {
  textEditorCommand,
  type Launch,
  type Linux,
  type OpenResult,
} from '../../../main/editor.ts';
import { errorCode, SETTINGS_SIZE_LIMIT } from './file.ts';

/**
 * Opens the settings file at `path` as text, or says why it didn't. A file that isn't there yet is
 * left so: Lo writes one only with a setting in it.
 */
export async function openSettingsFile(
  path: string,
  options: { platform: NodeJS.Platform; launch: Launch; linux: Linux; editor?: string | undefined },
): Promise<OpenResult> {
  let resolved: string;
  try {
    resolved = await realpath(path);
  } catch (error) {
    return {
      ok: false,
      reason:
        errorCode(error) === 'ENOENT'
          ? 'There’s no settings file yet.'
          : 'Lo couldn’t find the settings file.',
    };
  }
  const info = await stat(resolved).catch(() => undefined);
  if (!info?.isFile()) {
    return { ok: false, reason: 'The settings file isn’t a plain file, so Lo didn’t open it.' };
  }
  if ((info.mode & 0o111) !== 0) {
    return {
      ok: false,
      reason:
        'The settings file is executable, so Lo won’t open it, which could run it. Clear its execute permission to open it from here.',
    };
  }
  if (info.size > SETTINGS_SIZE_LIMIT) {
    return {
      ok: false,
      // A toast's line: the reason alone.
      reason: `settings.json is over ${SETTINGS_SIZE_LIMIT / 1024 ** 2} MB`,
    };
  }
  const opener = await textEditorCommand(options.platform, resolved, options);
  if (!opener) {
    const reason =
      options.platform === 'linux'
        ? 'Lo couldn’t find the app for text files (`xdg-mime query default text/plain`), so it didn’t open the settings file.'
        : 'Lo can’t open the settings file on this system.';
    return { ok: false, reason };
  }
  try {
    await options.launch(opener.command, opener.args);
  } catch {
    return { ok: false, reason: 'Lo couldn’t open the settings file in a text editor.' };
  }
  return { ok: true };
}
