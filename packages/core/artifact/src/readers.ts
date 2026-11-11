/**
 * How the checks read what they check: the overview's own commit, and the repository's code at the
 * commit its header names. The caller passes both, so the checks touch no git, file system or
 * network themselves: Lo reads through its local copy, and the checker through the repository and
 * folder it runs in. Each reader answers the same way, and the checks hold every answer to it.
 */

/** What a path in a commit is. A link is a symbolic link, never followed. */
export type EntryKind = 'file' | 'link' | 'folder' | 'submodule';

/** One of the files and folders in the overview's commit. */
export interface TreeEntry {
  /** Its path from the commit's root, as the commit stores it: bytes, usually but not always UTF-8. */
  path: Uint8Array;
  kind: EntryKind;
  /** Its size in bytes, when it's known: a file's contents, or the path a link holds. */
  size?: number | undefined;
}

/**
 * What reading a file at a commit gave.
 *
 * - `bytes`: the file's contents, at most the cap.
 * - `missing`: nothing is at the path. That includes a path through a link or a file, as where a
 *   folder should be: a link is never followed.
 * - `notFile`: the path is a link, a folder or a submodule.
 * - `tooLarge`: the file is larger than the cap, so it wasn't read.
 * - `noCommit`: the repository doesn't have the commit.
 */
export type FileAnswer =
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'missing' }
  | { kind: 'notFile'; is: Exclude<EntryKind, 'file'> }
  | { kind: 'tooLarge' }
  | { kind: 'noCommit' };

/**
 * Reads the file at `path` in `commit`, a commit of the repository the pull request is in, reading
 * no more than `cap` bytes. `path` is a target's path as the overview writes it: it names the file
 * whose path is its UTF-8 bytes, compared exactly, with no case folding, Unicode normalization or
 * percent decoding. Once `signal` aborts, the answer is no longer wanted. A reader may throw or
 * never answer: the check treats that as the code not read.
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
 * otherwise undefined. A file read past the cap is taken as too large, not trusted to be short.
 */
export function checkedAnswer(answer: unknown, cap: number): FileAnswer | undefined {
  if (typeof answer !== 'object' || answer === null || !('kind' in answer)) return undefined;
  switch (answer.kind) {
    case 'bytes': {
      const bytes = 'bytes' in answer ? answer.bytes : undefined;
      if (!(bytes instanceof Uint8Array)) return undefined;
      return bytes.length > cap ? { kind: 'tooLarge' } : { kind: 'bytes', bytes };
    }
    case 'notFile': {
      const is = 'is' in answer ? answer.is : undefined;
      return is === 'link' || is === 'folder' || is === 'submodule'
        ? { kind: 'notFile', is }
        : undefined;
    }
    case 'missing':
    case 'tooLarge':
    case 'noCommit':
      return { kind: answer.kind };
    default:
      return undefined;
  }
}
