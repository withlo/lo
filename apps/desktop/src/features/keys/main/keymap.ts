// The keymap file in main: reading it, writing the first copy and watching it for changes. Nothing
// here calls Electron, so it runs under unit tests.
//
// The file is the person's own, but it is text from outside Lo, so it is read as such: a file that
// isn't a plain file, or is over the limit, is left unread, and nothing in it is ever run. Main
// sends the window its text; the window parses it. The checks that decide whether the file is read
// also decide whether Lo may open it in an editor (`canOpen`), so what key help offers and what
// main will do agree.

import { constants } from 'node:fs';
import { lstat, mkdir, open, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { KEYMAP_SIZE_LIMIT, type KeymapFile } from '../contract.ts';

/** What a new keymap file says: only comments, so a copy of it changes no key. */
export const keymapHeader = `# Lo's keymap. Lo applies a change as soon as you save the file.
#
#   bind <keys> <command>              add keys to a command: bind x diff.markViewed
#   unbind <keys> [<command>]          take keys away: unbind e
#   vim <mode> <keys> <what they do>   map Vim's keys in code views: vim normal Y y$
#
# <keys> are written like ctrl+o, cmd+shift+p and ] f (a space between the keys of a sequence).
# Press ? in Lo to see every key and the name of each command.
`;

/** The file as it is when there is none: the empty keymap, which opening the file makes. */
const MISSING: KeymapFile = { text: '', canOpen: true };

/** A file Lo reads and opens for nothing: no text, and why. */
function refused(problem: string): KeymapFile {
  return { text: '', problem, canOpen: false };
}

/**
 * Reads the keymap file at `path`, following links. A file that isn't there is the empty keymap;
 * one that is there and can't be used (a folder or an app, a pipe, over the size limit, not text,
 * or not readable) is no text and a `problem` to show. It never throws, and never reads more than
 * the limit and a byte.
 *
 * `canOpen` says whether Lo will open the file in an editor: only a plain file of text within the
 * limit that isn't executable. An executable file is read, since reading runs nothing, but opening
 * it could run it (in Terminal, say), so it has a problem and can't be opened.
 */
export async function readKeymap(path: string): Promise<KeymapFile> {
  let handle;
  try {
    // Without O_NONBLOCK, opening a named pipe waits for someone to write to it.
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    return failure(error, path);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      return refused("The keymap file isn't a plain file, so Lo doesn't read or open it.");
    }
    const tooBig = refused(
      `The keymap file is over ${KEYMAP_SIZE_LIMIT / 1024 ** 2} MiB, so Lo didn't read it.`,
    );
    if (info.size > KEYMAP_SIZE_LIMIT) return tooBig;
    // One byte past the limit, in case the file grew since `stat`.
    const buffer = Buffer.alloc(KEYMAP_SIZE_LIMIT + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > KEYMAP_SIZE_LIMIT) return tooBig;
    const text = new TextDecoder('utf-8').decode(buffer.subarray(0, length));
    if (text.includes('\0')) return refused("The keymap file isn't text.");
    // Any of the owner's, group's or others' execute bits.
    if ((info.mode & 0o111) !== 0) {
      return {
        text,
        problem:
          "The keymap file is executable, so Lo won't open it, which could run it. Clear its execute permission to open it from here.",
        canOpen: false,
      };
    }
    return { text, canOpen: true };
  } catch (error) {
    return await failure(error, path);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** A failed read or open: no file is the empty keymap, anything else a problem. */
async function failure(error: unknown, path: string): Promise<KeymapFile> {
  const code = errorCode(error);
  if (code === 'ENOENT') {
    // A link to nothing is there, though nothing is at the end of it.
    const link = await lstat(path).then(
      () => true,
      () => false,
    );
    return link ? refused("The keymap file is a link to a file that isn't there.") : MISSING;
  }
  if (code === 'ENOTDIR') return MISSING;
  if (code === 'EACCES' || code === 'EPERM') {
    return refused("Lo isn't allowed to read the keymap file.");
  }
  return refused(`Lo couldn't read the keymap file${code ? ` (${code})` : ''}.`);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/**
 * Makes sure there is a keymap file at `path` for the person to edit: writes `keymapHeader` there,
 * and the folder it sits in, if there is nothing. Never changes a file that exists, whatever it
 * holds, or follows a link to make one.
 */
export async function ensureKeymap(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, keymapHeader, { flag: 'wx' });
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error;
  }
}

/** What a poll saw of the file: changes whenever it was replaced, edited or removed. */
async function signature(path: string): Promise<string> {
  try {
    // `stat` follows links: a keymap that links to a file in a dotfiles folder is watched there.
    const info = await stat(path, { bigint: true });
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  } catch (error) {
    const code = errorCode(error);
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : `error:${code ?? 'unknown'}`;
  }
}

function same(a: KeymapFile, b: KeymapFile | undefined): boolean {
  return b !== undefined && a.text === b.text && a.problem === b.problem && a.canOpen === b.canOpen;
}

export interface KeymapWatch {
  /** The file as the watch has it: the first read, or the last change reported. */
  latest(): Promise<KeymapFile>;
  /** Looks at the file once. The watch does it by itself every `interval`; tests call it. */
  check(): Promise<void>;
  /** Stops watching. */
  stop(): void;
}

/**
 * Watches the keymap file at `path`, and calls `onChange` with the file each time what it says
 * changes (not for a save that leaves it the same).
 *
 * It looks at the file's `stat` every `interval` ms rather than listening for events, since a
 * listener on the file or its folder misses what people do to keymaps: an editor that saves by
 * writing a new file and renaming it over the old one, a file that is a link to a dotfiles
 * folder's, and a folder that doesn't exist yet. A change is read once it has held still for a
 * whole interval, so a save in the middle of being written is never read.
 */
export function watchKeymap(
  path: string,
  onChange: (file: KeymapFile) => void,
  options: { interval?: number; log?: (message: string, error: unknown) => void } = {},
): KeymapWatch {
  const interval = options.interval ?? 400;
  const log = options.log ?? (() => undefined);
  let last: KeymapFile | undefined;
  /** The signature of the file `last` was read from. */
  let seen: string | undefined;
  /** A change the last poll saw, waiting to hold still. */
  let waiting: string | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Polls run one after another, never at once. */
  let queue: Promise<void> = Promise.resolve();

  const first = (async () => {
    seen = await signature(path);
    last = await readKeymap(path);
    return last;
  })();

  const poll = async (): Promise<void> => {
    await first;
    if (stopped) return;
    const now = await signature(path);
    if (now === seen) {
      waiting = undefined;
      return;
    }
    if (now !== waiting) {
      waiting = now;
      return;
    }
    const file = await readKeymap(path);
    if (stopped) return;
    seen = now;
    waiting = undefined;
    if (!same(file, last)) {
      last = file;
      onChange(file);
    }
  };

  const check = (): Promise<void> => {
    queue = queue.then(poll).catch((error: unknown) => {
      log("Lo couldn't look at the keymap file:", error);
    });
    return queue;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      void check().finally(schedule);
    }, interval);
    // Watching the file never keeps Lo running.
    timer.unref();
  };
  first.then(schedule, (error: unknown) => {
    log("Lo couldn't read the keymap file:", error);
    schedule();
  });

  return {
    latest: async () => last ?? (await first),
    check,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
