// The code an overview names, read from the pull request's local copy at the commit its header
// names, as `@lo/artifact`'s checks read code, so `overview.check` can answer them from it:
//
// - The commit is fetched by its ID when the copy lacks it. One GitHub doesn't have, or an object
//   that isn't a commit, answers `noCommit` for every file.
// - Each file is read once, in the order asked, which is the order the overview first names it. A
//   file named whole is only looked for. A file named by its lines is read as the checks read it:
//   its first 8 KiB, then all of it when it's text and fits in what's left of the code they read,
//   `LIMITS.code` in all. One larger than `LIMITS.file` is judged by its size and never read.
// - Every path is looked up in one walk of the commit's trees, which reads each tree once, and the
//   copy says the size of each file it has before anything reads it.
// - What the copy lacks is downloaded: all at once, then one at a time in the order the checks
//   read them, each download stopped past `PROBE`, and `DOWNLOAD_LIMIT` in all. A file whose
//   download is stopped past `PROBE` is larger than the checks read; past `DOWNLOAD_LIMIT`, a file
//   is unread.
// - Git writes no more than `STREAM_LIMIT` of files for one overview; past it, files are unread.
// - It stops once its signal aborts, as the tab closes or the window asks again.
//
// Nothing here calls Electron.

import { BINARY_WINDOW, LIMITS } from '@lo/artifact';
import { GitError, parseOid, type FileVersion, type Oid, type Repo } from '@lo/git';

import type { LocalState } from '../../tab/contract.ts';
import type { CodeAccess, CodeAnswer, CodeReply } from '../contract.ts';
import type { CodeFile } from '../jobs.ts';

/** What the code is read through: the pull request's local copy. */
export type CodeClone = Pick<
  Repo,
  | 'offline'
  | 'hasCommit'
  | 'fetchCommit'
  | 'missingObjects'
  | 'fileVersions'
  | 'objectSizes'
  | 'download'
  | 'readBlob'
>;

/**
 * The most bytes of files git writes for one overview: enough for every file the checks read to be
 * read whole, four times over. Each file a target names by its lines is read whole once, though
 * only its start may count, so this bounds what a few hundred files that aren't text cost.
 */
export const STREAM_LIMIT = 4 * LIMITS.code;

/**
 * The most one download brings: a file as large as the checks read, compressed as badly as zlib
 * can, and the pack around it. A download of one file stopped past this is of a file larger than
 * the checks read, which they judge by its size alone.
 */
export const PROBE = LIMITS.file + Math.ceil(LIMITS.file / 2048) + 64 * 1024;

/**
 * The most downloads bring for one overview's code: twice what the checks read, for what they read
 * whole and as much again for files they read only the start of, or judge by size, and a first
 * download of everything at once that's stopped. A file is downloaded whole to know either, so
 * past this, the files left are unread rather than downloaded without end.
 */
export const DOWNLOAD_LIMIT = 2 * LIMITS.code;

/** What the downloads are, in the clone's progress and log. */
const DOWNLOADING = 'the code an overview shows';

/** Where a file is in the commit: a file, by its blob, or what the checks answer instead. */
type Place =
  { kind: 'blob'; oid: Oid; size: number | undefined } | Exclude<CodeAnswer, { kind: 'file' }>;

/**
 * Whether the code can be read, by the local copy's state: once it's there, and only what it has
 * while it's offline.
 */
export function codeAccess(local: LocalState): CodeAccess {
  switch (local.kind) {
    case 'ready':
      return local.offline ? 'offline' : 'ready';
    case 'noGit':
      return 'noGit';
    case 'failed':
      return 'failed';
    case 'waiting':
    case 'fetching':
    case 'retrying':
      return 'waiting';
    default:
      local satisfies never;
      return 'waiting';
  }
}

/**
 * What `code` replies for a tab whose local copy is `local`, opened by `clone`: `files` at
 * `commit`, read as {@link readCode} reads them, once the copy is there.
 */
export async function codeReply(
  local: LocalState,
  clone: () => Promise<CodeClone> | undefined,
  commit: string,
  files: readonly CodeFile[],
  options: Options = {},
): Promise<CodeReply> {
  const access = codeAccess(local);
  if (access === 'noGit') return { kind: 'noGit' };
  if (local.kind === 'failed') return { kind: 'failed', why: local.message };
  const opening = access === 'waiting' ? undefined : clone();
  if (!opening) return { kind: 'waiting' };
  try {
    return { kind: 'read', files: await readCode(await opening, commit, files, options) };
  } catch (error) {
    if (options.signal?.aborted) return { kind: 'failed', why: 'The read was stopped.' };
    options.log?.(`reading the code of an overview: ${describe(error)}`);
    return { kind: 'failed', why: describe(error) };
  }
}

/** How the code is read: stopped once `signal` aborts, with what goes wrong written to `log`. */
export interface Options {
  signal?: AbortSignal | undefined;
  log?: ((line: string) => void) | undefined;
}

/**
 * One code read at a time for each tab: a read asked for the same way as the one under way, as when
 * two ask at once, waits for it; any other starts in its place, stopping it, as
 * when the window checks again once the local copy changes. A tab's read stops as the tab closes.
 */
export class CodeReads {
  readonly #running = new Map<
    string,
    { key: string; controller: AbortController; reading: Promise<CodeReply> }
  >();

  /** Reads for tab `id` with `read`, asked for as `key` says. */
  run(
    id: string,
    key: string,
    read: (signal: AbortSignal) => Promise<CodeReply>,
  ): Promise<CodeReply> {
    const running = this.#running.get(id);
    if (running?.key === key) return running.reading;
    running?.controller.abort();
    const controller = new AbortController();
    const reading = read(controller.signal).finally(() => {
      if (this.#running.get(id)?.controller === controller) this.#running.delete(id);
    });
    this.#running.set(id, { key, controller, reading });
    return reading;
  }

  /** Stops tab `id`'s read, as the tab closes. */
  stop(id: string): void {
    this.#running.get(id)?.controller.abort();
    this.#running.delete(id);
  }

  /** Stops every read, as Lo quits. */
  stopAll(): void {
    for (const { controller } of this.#running.values()) controller.abort();
    this.#running.clear();
  }
}

/** How a read is asked for: the copy's state, the commit and the files, each as asked. */
export function readKey(local: LocalState, commit: string, files: readonly CodeFile[]): string {
  return JSON.stringify([codeAccess(local), commit, files.map(({ path, lines }) => [path, lines])]);
}

/**
 * Reads `files` at `commit` from `clone`, as the overview's checks read them, and answers each, in
 * the order asked. A path asked for twice is read once, by its first place, naming its lines if
 * either does.
 */
export async function readCode(
  clone: CodeClone,
  commit: string,
  files: readonly CodeFile[],
  options: Options = {},
): Promise<CodeAnswer[]> {
  // Each path once, in order: no path asked for is long, so each can be a key.
  const order = new Map<string, number>();
  const wanted: CodeFile[] = [];
  for (const { path, lines } of files) {
    const at = order.get(path);
    if (at === undefined) {
      order.set(path, wanted.length);
      wanted.push({ path, lines });
    } else {
      const known = wanted[at];
      if (known) known.lines ||= lines;
    }
  }
  const answers = await new Reading(clone, options).read(commit, wanted);
  return files.map(({ path }) => answers[order.get(path) ?? -1] ?? unread('It was never read.'));
}

/** One overview's code, read: what's been downloaded and read so far, and what's left. */
class Reading {
  readonly #clone: CodeClone;
  readonly #signal: AbortSignal | undefined;
  readonly #log: (line: string) => void;
  /** What downloads have brought, or would have when stopped. */
  #downloaded = 0;
  /** What git has written of files. */
  #streamed = 0;
  /** What the checks have read, as they count it. */
  #used = 0;
  /** Why the copy can't download, when it can't. */
  #cannot: string | undefined;

  constructor(clone: CodeClone, options: Options) {
    this.#clone = clone;
    this.#signal = options.signal;
    this.#log = options.log ?? (() => {});
  }

  async read(commit: string, wanted: readonly CodeFile[]): Promise<CodeAnswer[]> {
    const there = await this.#bringCommit(commit);
    if (typeof there !== 'string') return wanted.map(() => there);
    const places = await this.#placesOf(there, wanted);
    this.#stopIfAsked();

    // What the copy lacks of the files named by their lines, all at once.
    const lacking = new Set<Oid>();
    for (const [index, place] of places.entries()) {
      if (place.kind === 'blob' && place.size === undefined && wanted[index]?.lines) {
        lacking.add(place.oid);
      }
    }
    if (lacking.size > 0 && this.#clone.offline) {
      this.#cannot = 'The local copy is offline, and lacks it.';
    } else if (lacking.size > 1) {
      // One alone is downloaded as it's read.
      const oids = [...lacking];
      if ((await this.#download(oids)) === 'brought') {
        const sized = await this.#clone.objectSizes(oids);
        const sizes = new Map(oids.map((oid, at) => [oid, sized[at]]));
        for (const size of sized) this.#downloaded += size ?? 0;
        for (const place of places) {
          if (place.kind === 'blob' && place.size === undefined) place.size = sizes.get(place.oid);
        }
      }
    }

    const answers: CodeAnswer[] = [];
    for (const [index, { lines }] of wanted.entries()) {
      this.#stopIfAsked();
      const place = places[index] ?? unread('It was never looked for.');
      if (place.kind !== 'blob') {
        answers.push(place);
      } else if (lines) {
        answers.push(await this.#readLines(place));
      } else {
        // A file named whole only has to be there.
        answers.push({ kind: 'file', size: place.size ?? null, bytes: new Uint8Array() });
      }
    }
    return answers;
  }

  /** A file named by its lines, read as the checks read it, downloading it first if need be. */
  async #readLines(place: Extract<Place, { kind: 'blob' }>): Promise<CodeAnswer> {
    let { size } = place;
    // Another path may have brought it.
    if (size === undefined) [size] = await this.#clone.objectSizes([place.oid]);
    if (size === undefined) {
      const brought = this.#cannot === undefined ? await this.#download([place.oid]) : 'failed';
      switch (brought) {
        case 'brought':
          [size] = await this.#clone.objectSizes([place.oid]);
          if (size === undefined) return unread("The local copy doesn't have it.");
          this.#downloaded += size;
          break;
        case 'pastProbe':
          return { kind: 'tooLarge' };
        case 'failed':
          return unread(this.#cannot ?? "Lo couldn't download it.");
        case 'pastCap':
        case 'spent':
          return unread('Lo downloaded as much of this overview’s code as it downloads for one.');
        default:
          brought satisfies never;
          return unread("Lo couldn't download it.");
      }
    }
    // Past what the checks read of a file: its size says it's too large.
    if (size > LIMITS.file) return { kind: 'file', size, bytes: new Uint8Array() };
    if (this.#streamed + size > STREAM_LIMIT) {
      return unread("Lo read as much of this overview's code as it reads for one.");
    }
    this.#streamed += size;
    let blob: Uint8Array | undefined;
    try {
      blob = await this.#clone.readBlob(place.oid, { maxBytes: LIMITS.file });
    } catch (error) {
      this.#log(`reading the code of an overview: ${describe(error)}`);
    }
    if (blob?.length !== size) return unread("Lo couldn't read it from the local copy.");
    // As the checks read it: the start, and the rest only when it's text and fits.
    const room = LIMITS.code - this.#used;
    const head = blob.subarray(0, Math.min(BINARY_WINDOW, room, size));
    if (head.includes(0) || size > room) {
      this.#used += head.length;
      return { kind: 'file', size, bytes: new Uint8Array(head) };
    }
    this.#used += size;
    return { kind: 'file', size, bytes: new Uint8Array(blob) };
  }

  /**
   * Downloads `oids`, stopped past `PROBE` or what's left of `DOWNLOAD_LIMIT`, whichever is less,
   * and says how it went: `brought`; stopped, past `PROBE` or past what was left; not started, with
   * nothing left; or `failed`, which no other download tries again.
   */
  async #download(
    oids: readonly Oid[],
  ): Promise<'brought' | 'pastProbe' | 'pastCap' | 'spent' | 'failed'> {
    const cap = Math.min(PROBE, DOWNLOAD_LIMIT - this.#downloaded);
    if (cap <= 0) return 'spent';
    this.#stopIfAsked();
    try {
      await this.#clone.download(oids, DOWNLOADING, { maxBytes: cap });
      return 'brought';
    } catch (error) {
      if (!pastCap(error)) {
        this.#log(`downloading the code of an overview: ${describe(error)}`);
        this.#cannot = `Lo couldn't download it: ${describe(error)}`;
        return 'failed';
      }
      this.#downloaded += cap;
      return cap === PROBE ? 'pastProbe' : 'pastCap';
    }
  }

  /**
   * Makes sure the copy has `commit`, as a commit, fetching it by its ID if it doesn't: its ID, or
   * what every file answers when it can't be had.
   */
  async #bringCommit(commit: string): Promise<Oid | CodeAnswer> {
    let oid: Oid;
    try {
      oid = parseOid(commit);
    } catch {
      return { kind: 'noCommit' };
    }
    const clone = this.#clone;
    try {
      if (await clone.hasCommit(oid)) return oid;
      if (!clone.offline) await clone.fetchCommit(oid);
    } catch (error) {
      if (error instanceof GitError && error.detail.kind === 'unavailable') {
        return { kind: 'noCommit' };
      }
      // GitHub has the object, but it isn't a commit.
      if (!(await isOther(clone, oid))) {
        this.#log(`fetching the commit an overview names: ${describe(error)}`);
        return unread(`Lo couldn't fetch the commit: ${describe(error)}`);
      }
    }
    // Exactly that commit: not a tag, which a fetch by ID follows, nor a tree or a file.
    if (await clone.hasCommit(oid)) return oid;
    if (clone.offline && !(await isOther(clone, oid))) {
      return unread('The local copy is offline, and lacks the commit.');
    }
    return { kind: 'noCommit' };
  }

  /**
   * What's at each of the paths in `commit`, from one walk of its trees: a file, with its size when
   * the copy has its contents, or what the checks answer. A path through a link or a file names
   * nothing, since a link is never followed.
   */
  async #placesOf(commit: Oid, wanted: readonly CodeFile[]): Promise<Place[]> {
    const encoder = new TextEncoder();
    const paths = wanted.map(({ path }) => encoder.encode(path));
    // No file has an empty name or a NUL in it, and git takes no such path.
    const looked = paths.filter((path) => path.length > 0 && !path.includes(0));
    let found: (FileVersion | 'folder' | undefined)[];
    try {
      found = await this.#clone.fileVersions(commit, looked);
    } catch (error) {
      this.#log(`looking for the code of an overview: ${describe(error)}`);
      const why = unread(`Lo couldn't look for it in the local copy: ${describe(error)}`);
      return wanted.map(() => why);
    }
    let at = 0;
    return paths.map((path): Place => {
      if (path.length === 0 || path.includes(0)) return { kind: 'missing' };
      const version = found[at++];
      if (version === undefined) return { kind: 'missing' };
      if (version === 'folder') return { kind: 'notFile', is: 'folder' };
      switch (version.mode) {
        case 'symlink':
          return { kind: 'notFile', is: 'link' };
        case 'submodule':
          return { kind: 'notFile', is: 'submodule' };
        case 'regular':
        case 'executable':
          return { kind: 'blob', oid: version.oid, size: version.size };
        default:
          version.mode satisfies never;
          return unread("It's something Lo doesn't read.");
      }
    });
  }

  /** Stops the read once its signal aborts. */
  #stopIfAsked(): void {
    this.#signal?.throwIfAborted();
  }
}

/** Whether the copy has `oid` as something other than a commit: a tag, a tree or a file. */
async function isOther(clone: CodeClone, oid: Oid): Promise<boolean> {
  try {
    return (await clone.missingObjects([oid])).length === 0 && !(await clone.hasCommit(oid));
  } catch {
    return false;
  }
}

/** Whether `error` is a download Lo stopped for bringing more than it may. */
function pastCap(error: unknown): boolean {
  return (
    error instanceof GitError &&
    error.detail.kind === 'fetch' &&
    error.detail.failure === 'tooLarge'
  );
}

function unread(why: string): Extract<CodeAnswer, { kind: 'unread' }> {
  return { kind: 'unread', why };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
