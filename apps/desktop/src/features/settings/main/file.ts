// The settings file on disk: reading it, writing it and noticing when it changes. Nothing here
// calls Electron, so it runs under unit tests.
//
// The file is the person's own, and text from outside Lo, so it is read as such: anything that
// isn't a plain file of UTF-8 text within the limit holding one JSON object is left unread, and
// said so in words for the person. It is written whole, to a new file that then replaces the old
// one, so a crash or a full disk never leaves half a file, and an editor open on it sees it
// change in one step. It is replaced only if it hasn't changed since it was read, so an edit saved
// meanwhile isn't lost.

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';

/** The most Lo reads of the settings file, in bytes. A longer file is left unread. */
export const SETTINGS_SIZE_LIMIT = 1024 * 1024;

/** What reading the settings file came to. */
export type Read =
  /** There's no file, which is no settings and no problem. */
  | { readonly kind: 'missing' }
  /** The file's object: one entry for each key in it, whether or not any feature knows it. */
  | { readonly kind: 'ok'; readonly values: Readonly<Record<string, unknown>> }
  /** The file can't be used, and why, for the person who wrote it. */
  | { readonly kind: 'problem'; readonly problem: string };

function problem(text: string): Read {
  return { kind: 'problem', problem: text };
}

/** The first `length` characters of `text`, with an ellipsis when it was cut. */
export function shorten(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

/**
 * The settings in `text`: one JSON object, or nothing at all (a file with only white space is no
 * settings). Anything else is a problem that says what was wrong.
 */
export function parseSettings(text: string): Read {
  if (text.trim() === '') return { kind: 'ok', values: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const why = error instanceof Error ? error.message : 'it is not JSON';
    return problem(
      `The settings file isn't valid JSON (${shorten(why, 160)}). Fix it, and Lo applies it as soon as you save.`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return problem(
      'The settings file should hold one JSON object, such as { "theme": "dark" }. Fix it, and Lo applies it as soon as you save.',
    );
  }
  return { kind: 'ok', values: Object.fromEntries(Object.entries(parsed)) };
}

/**
 * Reads the settings file at `path`, following links. It never throws, and never reads more than
 * the limit and a byte. A file that isn't there is no settings; one that is there and can't be
 * used (a folder, a pipe, over the limit, not text, not readable, not JSON) is a problem.
 */
export async function readSettings(path: string): Promise<Read> {
  let handle;
  try {
    // Without O_NONBLOCK, opening a named pipe waits for someone to write to it.
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    return failure(error, path);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile())
      return problem("The settings file isn't a plain file, so Lo didn't read it.");
    const tooBig = problem(
      `The settings file is over ${SETTINGS_SIZE_LIMIT / 1024 ** 2} MiB, so Lo didn't read it.`,
    );
    if (info.size > SETTINGS_SIZE_LIMIT) return tooBig;
    // One byte past the limit, in case the file grew since `stat`.
    const buffer = Buffer.alloc(SETTINGS_SIZE_LIMIT + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > SETTINGS_SIZE_LIMIT) return tooBig;
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
    } catch {
      return problem("The settings file isn't UTF-8 text, so Lo didn't read it.");
    }
    return parseSettings(text);
  } catch (error) {
    return await failure(error, path);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** A failed open or read: no file is no settings, anything else a problem. */
async function failure(error: unknown, path: string): Promise<Read> {
  const code = errorCode(error);
  if (code === 'ENOENT') {
    // A link to nothing is there, though nothing is at the end of it.
    const link = await lstat(path).then(
      () => true,
      () => false,
    );
    return link
      ? problem("The settings file is a link to a file that isn't there.")
      : { kind: 'missing' };
  }
  if (code === 'ENOTDIR') return { kind: 'missing' };
  if (code === 'EACCES' || code === 'EPERM') {
    return problem("Lo isn't allowed to read the settings file.");
  }
  if (code === 'ELOOP') return problem('The settings file is a link that leads back to itself.');
  return problem(`Lo couldn't read the settings file${code ? ` (${code})` : ''}.`);
}

/** The code on an error from the file system, if it has one. */
export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/** The settings file changed after it was read, so a write made from what was read wasn't made. */
export class SettingsChanged extends Error {
  override name = 'SettingsChanged';

  constructor() {
    super('The settings file changed while Lo was writing it.');
  }
}

/**
 * Writes `text` as the settings file at `path`: to a new file beside it, which then replaces it in
 * one step, so the file is always the whole of the old one or of the new one. A link (to a file in
 * a dotfiles folder, say) stays a link, and the file it leads to is the one replaced, with the
 * permissions it had. The folder is made if there is none. Fails if the file can't be written,
 * leaving the old one as it was.
 *
 * With `read`, the file's {@link signature} when what `text` was made from was read, it fails with
 * {@link SettingsChanged}, writing nothing, if the file has changed since: looked at last, just
 * before it's replaced, so an edit saved while `text` was being written is kept.
 */
export async function writeSettings(path: string, text: string, read?: string): Promise<void> {
  const target = await place(path);
  const folder = dirname(target);
  await mkdir(folder, { recursive: true });
  let mode = 0o644;
  try {
    mode = (await stat(target)).mode & 0o777;
  } catch {
    // A new file: the usual permissions.
  }
  const temporary = join(folder, `.${basename(target)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
  try {
    try {
      await handle.chmod(mode);
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (read !== undefined && (await signature(path)) !== read) throw new SettingsChanged();
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await syncFolder(folder);
}

/**
 * Syncs `folder`, so a file renamed into it is there after a crash or a power cut, not the one it
 * replaced. The file has been replaced either way, so a file system that can't sync a folder is no
 * failure.
 */
async function syncFolder(folder: string): Promise<void> {
  let handle;
  try {
    handle = await open(folder, constants.O_RDONLY | constants.O_DIRECTORY);
    await handle.sync();
  } catch {
    // Some file systems refuse to sync a folder.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** The file `path` leads to, or `path` itself when there is nothing there yet. */
async function place(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
    // A link to nothing would be replaced by a file of its own, and its owner's setup undone.
    const info = await lstat(path).catch(() => undefined);
    if (info?.isSymbolicLink()) throw error;
    return path;
  }
}

/** What a poll saw of the file: changes whenever it was replaced, edited or removed. */
export async function signature(path: string): Promise<string> {
  try {
    // `stat` follows links: a file that links into a dotfiles folder is watched there.
    const info = await stat(path, { bigint: true });
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  } catch (error) {
    const code = errorCode(error);
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : `error:${code ?? 'unknown'}`;
  }
}

/** `path` as a person would write it: the home folder as `~`. */
export function written(path: string, home: string): string {
  const prefix = home.endsWith(sep) ? home : `${home}${sep}`;
  return home !== '' && path.startsWith(prefix) ? `~${sep}${path.slice(prefix.length)}` : path;
}
