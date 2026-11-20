// Whether Lo starts with hardware acceleration, as the setting `app.gpu` says. Electron takes that
// only before `ready`, long before the settings feature has read the file, so main reads this one
// setting itself, as Lo starts, the way the settings feature reads the file: up to its size limit,
// as UTF-8 text, as JSON with comments. A change applies at the next start. Nothing here calls
// Electron, so it runs under unit tests.

import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

import { gpu } from '../features/app/settings.ts';
import { SETTINGS_SIZE_LIMIT } from '../features/settings/main/file.ts';
import { parseSettings } from '../features/settings/main/text.ts';

/**
 * The settings file's text, or nothing when there's no file or one Lo can't read: not a plain
 * file, over the size limit, or not UTF-8. It never throws, and never reads past the limit and a
 * byte, nor waits on a named pipe.
 */
export function settingsText(path: string): string | undefined {
  let handle: number | undefined;
  try {
    // Without O_NONBLOCK, opening a named pipe waits for someone to write to it.
    handle = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const info = fstatSync(handle);
    if (!info.isFile() || info.size > SETTINGS_SIZE_LIMIT) return undefined;
    // One byte past the limit, in case the file grew since `fstat`.
    const buffer = Buffer.alloc(SETTINGS_SIZE_LIMIT + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(handle, buffer, length, buffer.length - length, length);
      if (read === 0) break;
      length += read;
    }
    if (length > SETTINGS_SIZE_LIMIT) return undefined;
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      buffer.subarray(0, length),
    );
  } catch {
    return undefined;
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}

/**
 * Whether Lo uses hardware acceleration, as `app.gpu` in the settings file's `text` says: its
 * default, on, when there's no file, the file has a problem, or the value isn't true or false. The
 * settings feature reports those once it has read the file.
 */
export function hardwareAcceleration(text: string | undefined): boolean {
  if (text === undefined) return gpu.fallback;
  try {
    const parsed = parseSettings(text);
    if (parsed.kind !== 'ok' || !Object.hasOwn(parsed.values, gpu.key)) return gpu.fallback;
    const value = gpu.schema.safeParse(parsed.values[gpu.key]);
    return value.success ? value.data : gpu.fallback;
  } catch {
    return gpu.fallback;
  }
}
