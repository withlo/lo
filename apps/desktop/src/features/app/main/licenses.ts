// Opening the file of licenses, `licenses.txt`, which the build writes: Lo's own, and those of the
// packages and files it ships. Like the keymap file, it's opened as text with the system's app for
// text (`main/editor.ts`), never run. It's Lo's own file, in the app's resources or the build's
// output, so unlike the keymap it needs no check but that it's there. Nothing here calls Electron,
// so it runs under unit tests.

import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { textEditorCommand, type Launch, type Linux } from '../../../main/editor.ts';

/**
 * What opening the licenses came to: they opened, or why not: the file isn't in this copy of Lo
 * (`missing`), there's no app for text (`noApp`, on Linux) or no way to open one on this system
 * (`unsupported`), or the app didn't start (`launch`), with what the system said.
 */
export type LicensesOpened =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly why: 'missing' | 'noApp' | 'unsupported' | 'launch';
      readonly said?: string | undefined;
    };

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
): Promise<LicensesOpened> {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return { ok: false, why: 'missing' };
  const opener = await textEditorCommand(options.platform, path, options);
  if (!opener) return { ok: false, why: options.platform === 'linux' ? 'noApp' : 'unsupported' };
  try {
    await options.launch(opener.command, opener.args);
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    return { ok: false, why: 'launch', said };
  }
  return { ok: true };
}
