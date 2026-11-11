/**
 * How the checks read what they check: the overview's own commit, and the repository's code at the
 * commit its header names. The caller passes both, so the checks touch no git, file system or
 * network themselves: Lo reads through its local copy, and the checker through the repository and
 * folder it runs in. Each reader answers the same way, and the checks hold every answer to it.
 */

import { LIMITS } from './limits.ts';

/**
 * The size past which a reader may answer a file with its size alone, and none of its bytes. Every
 * limit on a file that's read is no larger, so no check looks at the bytes of a file this large: it's
 * too large by its size. A reader can ask for a file's size first, then, and never read such a file.
 */
export const SIZE_ONLY: number = LIMITS.file;

/** What a path in a commit is. A link is a symbolic link, never followed. */
export type EntryKind = 'file' | 'link' | 'folder' | 'submodule';

/**
 * One of the files and folders in the overview's commit, with its path as the commit stores it:
 * bytes, usually but not always UTF-8. A file or a link has a size, in bytes: a file's contents, or
 * the path a link holds. Without it, the commit's size can't be checked, so the overview is refused.
 */
export type TreeEntry =
  | { path: Uint8Array; kind: 'file' | 'link'; size: number }
  | { path: Uint8Array; kind: 'folder' | 'submodule'; size?: undefined };

/**
 * What reading a file at a commit gave.
 *
 * - `file`: its size, and its first bytes, up to the cap: all of it when it's no larger. A file
 *   larger than {@link SIZE_ONLY} may come with no bytes at all.
 * - `missing`: nothing is at the path. That includes a path through a link or a file, as where a
 *   folder should be: a link is never followed.
 * - `notFile`: the path is a link, a folder or a submodule.
 * - `noCommit`: the repository doesn't have the commit.
 */
export type FileAnswer =
  | { kind: 'file'; size: number; bytes: Uint8Array }
  | { kind: 'missing' }
  | { kind: 'notFile'; is: Exclude<EntryKind, 'file'> }
  | { kind: 'noCommit' };

/**
 * Reads the file at `path` in `commit`, a commit of the repository the pull request is in: its
 * size, and no more than its first `cap` bytes. `path` is a target's path as the overview writes
 * it: it names the file whose path is its UTF-8 bytes, compared exactly, with no case folding,
 * Unicode normalization or percent decoding. Once `signal` aborts, the answer is no longer wanted.
 * A reader may throw or never answer: the check treats that as the code not read.
 */
export type CodeReader = (
  commit: string,
  path: string,
  cap: number,
  signal: AbortSignal,
) => Promise<FileAnswer>;

/** The overview's own commit: what it holds, and a way to read its files. */
export interface OverviewFiles {
  /**
   * Every file in it, and its folders if the reader lists them: what isn't listed is worked out
   * from the files' paths. A file is listed once.
   */
  entries: readonly TreeEntry[];
  /**
   * Reads the file at `path`, such as `artifact.md` or a figure, as {@link CodeReader} reads code:
   * the same answers, the same exact paths, never following a link.
   */
  read(path: string, cap: number, signal: AbortSignal): Promise<FileAnswer>;
}

/**
 * `answer`, from a reader, if it's one of the answers {@link FileAnswer} lists and keeps to `cap`;
 * otherwise undefined. Bytes that aren't the file's first `cap`, by its size, aren't trusted, unless
 * there are none of a file larger than {@link SIZE_ONLY}. Never throws, whatever the answer is made
 * of.
 */
export function checkedAnswer(answer: unknown, cap: number): FileAnswer | undefined {
  try {
    return checked(answer, cap);
  } catch {
    // A getter or a proxy that throws.
    return undefined;
  }
}

function checked(answer: unknown, cap: number): FileAnswer | undefined {
  if (typeof answer !== 'object' || answer === null || !('kind' in answer)) return undefined;
  switch (answer.kind) {
    case 'file': {
      const size = 'size' in answer ? answer.size : undefined;
      const bytes = 'bytes' in answer ? answer.bytes : undefined;
      // A view of a real array of bytes, never a proxy, which could say anything of its length.
      if (!ArrayBuffer.isView(bytes) || !(bytes instanceof Uint8Array)) return undefined;
      if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return undefined;
      const sizeOnly = size > SIZE_ONLY && bytes.length === 0;
      if (bytes.length !== Math.min(size, cap) && !sizeOnly) return undefined;
      return { kind: 'file', size, bytes };
    }
    case 'notFile': {
      const is = 'is' in answer ? answer.is : undefined;
      return is === 'link' || is === 'folder' || is === 'submodule'
        ? { kind: 'notFile', is }
        : undefined;
    }
    case 'missing':
    case 'noCommit':
      return { kind: answer.kind };
    default:
      return undefined;
  }
}

/** Why a file wasn't read: its reader failed, or was stopped, before it answered. */
export type Unread = { kind: 'unread'; why: 'failed' | 'stopped' };

/**
 * What `read()` answers, held to `cap`; or, when it throws, fails, gives something that isn't an
 * answer or hasn't answered when `signal` aborts, why it's unread.
 */
export async function answered(
  read: () => Promise<unknown>,
  cap: number,
  signal: AbortSignal,
): Promise<FileAnswer | Unread> {
  if (signal.aborted) return { kind: 'unread', why: 'stopped' };
  return new Promise((resolve) => {
    const stop = (): void => resolve({ kind: 'unread', why: 'stopped' });
    signal.addEventListener('abort', stop, { once: true });
    const settle = (answer: FileAnswer | undefined): void => {
      signal.removeEventListener('abort', stop);
      resolve(answer ?? { kind: 'unread', why: 'failed' });
    };
    let reading: Promise<unknown>;
    try {
      reading = Promise.resolve(read());
    } catch {
      settle(undefined);
      return;
    }
    reading.then(
      (value: unknown) => settle(checkedAnswer(value, cap)),
      () => settle(undefined),
    );
  });
}
