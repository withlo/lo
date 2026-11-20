// Opening the file of licenses, `licenses.txt`, which the build writes: Lo's own, and those of the
// packages and files it ships. Like the keymap file, it's opened as text with the system's app for
// text (`main/editor.ts`), never run. It's Lo's own file, in the app's resources or the build's
// output, so unlike the keymap it needs no check but that it's there. Nothing here calls Electron,
// so it runs under unit tests.

import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  textEditorCommand,
  type Launch,
  type Linux,
  type OpenResult,
} from '../../../main/editor.ts';

/**
 * Where the licenses file is: in the app's resources, outside the asar, once packaged, so the
 * system's editor can open it; in the build's output in a build run from source.
 */
export function licensesPath(options: {
  packaged: boolean;
  /** The folder of the app's resources, where electron-builder puts the file. */
  resources: string;
  /** The app's own folder, `apps/desktop` when run from source. */
  app: string;
}): string {
  return options.packaged
    ? join(options.resources, 'licenses.txt')
    : join(options.app, 'dist', 'licenses.txt');
}

/** Opens the licenses file at `path` as text, or says why it didn't. */
export async function openLicenses(
  path: string,
  options: { platform: NodeJS.Platform; launch: Launch; linux: Linux; editor?: string | undefined },
): Promise<OpenResult> {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return { ok: false, reason: "Lo couldn't find its licenses file." };
  const opener = await textEditorCommand(options.platform, path, options);
  if (!opener) {
    const reason =
      options.platform === 'linux'
        ? "Lo couldn't find the app for text files (`xdg-mime query default text/plain`), so it didn't open the licenses file."
        : "Lo can't open the licenses file on this system.";
    return { ok: false, reason };
  }
  try {
    await options.launch(opener.command, opener.args);
  } catch {
    return { ok: false, reason: "Lo couldn't open the licenses file in a text editor." };
  }
  return { ok: true };
}
