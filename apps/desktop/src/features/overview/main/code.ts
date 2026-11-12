// The code an overview names, read from the pull request's local copy at the commit its header
// names, as `@lo/artifact`'s checks read code, so `overview.check` can answer them from it:
//
// - The commit is fetched by its ID when the copy lacks it. One GitHub doesn't have, or that isn't
//   a commit, answers `noCommit` for every file.
// - Each file is read once, in the order asked, which is the order the overview first names it. A
//   file named whole is only looked for. A file named by its lines is read as the checks read it:
//   its first 8 KiB, then all of it when it's text and fits in what's left of the code they read,
//   `LIMITS.code` in all. One larger than `LIMITS.file` is judged by its size and never read.
// - Sizes come first: the copy says a file's size before anything reads it. The contents the copy
//   lacks are downloaded first, capped at what's left of `LIMITS.code`: all at once, then one at a
//   time once that's past the cap, each capped at what's left then.
// - Git writes no more than `STREAM_LIMIT` of files for one overview; past it, files are unread.
//
// Nothing here calls Electron.

import { BINARY_WINDOW, LIMITS } from '@lo/artifact';
import { displayPath, GitError, parseOid, type Oid, type Repo } from '@lo/git';

import type { LocalState } from '../../tab/contract.ts';
import type { CodeAccess, CodeAnswer, CodeReply } from '../contract.ts';
import type { CodeFile } from '../jobs.ts';

/** What the code is read through: the pull request's local copy. */
export type CodeClone = Pick<
  Repo,
  'offline' | 'hasCommit' | 'fetchCommit' | 'fileVersion' | 'download' | 'readBlob'
>;

/**
 * The most bytes of files git writes for one overview: enough for every file the checks read to be
 * read whole, four times over. Each file a target names by its lines is read whole once, though
 * only its start may count, so this bounds what a few hundred files that aren't text cost.
 */
export const STREAM_LIMIT = 4 * LIMITS.code;

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
  log: (line: string) => void = () => {},
): Promise<CodeReply> {
  const access = codeAccess(local);
  if (access === 'noGit') return { kind: 'noGit' };
  if (local.kind === 'failed') return { kind: 'failed', why: local.message };
  const opening = access === 'waiting' ? undefined : clone();
  if (!opening) return { kind: 'waiting' };
  try {
    return { kind: 'read', files: await readCode(await opening, commit, files, log) };
  } catch (error) {
    log(`reading the code of an overview: ${describe(error)}`);
    return { kind: 'failed', why: describe(error) };
  }
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
  log: (line: string) => void = () => {},
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
  const answers = await readWanted(clone, commit, wanted, log);
  return files.map(({ path }) => answers[order.get(path) ?? -1] ?? unread('It was never read.'));
}

async function readWanted(
  clone: CodeClone,
  commit: string,
  wanted: readonly CodeFile[],
  log: (line: string) => void,
): Promise<CodeAnswer[]> {
  const there = await bringCommit(clone, commit, log);
  if (typeof there !== 'string') return wanted.map(() => there);

  const places: Place[] = [];
  for (const { path } of wanted) places.push(await placeOf(clone, there, path));

  // What the copy lacks of the files named by their lines, all at once, capped at what's left of
  // the code the checks read once the files it has are counted, as if each were text.
  let oneByOne = false;
  let failed: string | undefined;
  const lacking: Oid[] = [];
  let had = 0;
  for (const [index, place] of places.entries()) {
    if (place.kind !== 'blob' || !wanted[index]?.lines) continue;
    if (place.size === undefined) lacking.push(place.oid);
    else if (place.size <= LIMITS.file) had += place.size;
  }
  if (lacking.length > 0 && clone.offline) {
    failed = 'The local copy is offline, and lacks it.';
  } else if (lacking.length > 0) {
    const cap = LIMITS.code - had;
    if (cap <= 0) {
      oneByOne = true;
    } else {
      try {
        await clone.download(lacking, DOWNLOADING, { maxBytes: cap });
      } catch (error) {
        if (pastCap(error)) {
          oneByOne = true;
        } else {
          log(`downloading the code of an overview: ${describe(error)}`);
          failed = `Lo couldn't download it: ${describe(error)}`;
        }
      }
    }
  }

  const answers: CodeAnswer[] = [];
  // What the checks have read, as they count it, and so what's left for the rest.
  let used = 0;
  // What downloads one at a time have brought, or would have when stopped.
  let spent = 0;
  let streamed = 0;
  for (const [index, { path, lines }] of wanted.entries()) {
    const place = places[index] ?? unread('It was never looked for.');
    if (place.kind !== 'blob') {
      answers.push(place);
      continue;
    }
    // A file named whole only has to be there.
    if (!lines) {
      answers.push({ kind: 'file', size: place.size ?? null, bytes: new Uint8Array() });
      continue;
    }
    const room = LIMITS.code - used;
    let size = place.size;
    if (size === undefined && failed === undefined) {
      size = await sizeOf(clone, there, path);
      if (size === undefined && oneByOne) {
        const cap = Math.min(room, LIMITS.code - spent);
        const brought = cap > 0 ? await downloadOne(clone, place.oid, cap, log) : 'pastCap';
        if (brought === 'pastCap') spent += cap;
        else size = await sizeOf(clone, there, path);
        spent += size ?? 0;
      }
    }
    if (size === undefined) {
      answers.push(unread(failed ?? "The local copy doesn't have it, and Lo didn't download it."));
      continue;
    }
    // Past what the checks read of a file: its size says it's too large.
    if (size > LIMITS.file) {
      answers.push({ kind: 'file', size, bytes: new Uint8Array() });
      continue;
    }
    if (streamed + size > STREAM_LIMIT) {
      answers.push(unread("Lo read as much of this overview's code as it reads for one."));
      continue;
    }
    streamed += size;
    let blob: Uint8Array | undefined;
    try {
      blob = await clone.readBlob(place.oid, { maxBytes: LIMITS.file });
    } catch (error) {
      log(`reading the code of an overview: ${describe(error)}`);
    }
    if (blob?.length !== size) {
      answers.push(unread("Lo couldn't read it from the local copy."));
      continue;
    }
    // As the checks read it: the start, and the rest only when it's text and fits.
    const head = blob.subarray(0, Math.min(BINARY_WINDOW, room, size));
    if (head.includes(0) || size > room) {
      answers.push({ kind: 'file', size, bytes: new Uint8Array(head) });
      used += head.length;
      continue;
    }
    answers.push({ kind: 'file', size, bytes: new Uint8Array(blob) });
    used += size;
  }
  return answers;
}

/**
 * Makes sure the copy has `commit`, as a commit, fetching it by its ID if it doesn't: its ID, or
 * what every file answers when it can't be had.
 */
async function bringCommit(
  clone: CodeClone,
  commit: string,
  log: (line: string) => void,
): Promise<Oid | CodeAnswer> {
  let oid: Oid;
  try {
    oid = parseOid(commit);
  } catch {
    return { kind: 'noCommit' };
  }
  try {
    if (await clone.hasCommit(oid)) return oid;
    if (clone.offline) return unread('The local copy is offline, and lacks the commit.');
    await clone.fetchCommit(oid);
    // Exactly that commit: not a tag, which a fetch by ID follows.
    return (await clone.hasCommit(oid)) ? oid : { kind: 'noCommit' };
  } catch (error) {
    if (error instanceof GitError && error.detail.kind === 'unavailable') {
      return { kind: 'noCommit' };
    }
    log(`fetching the commit an overview names: ${describe(error)}`);
    return unread(`Lo couldn't fetch the commit: ${describe(error)}`);
  }
}

/**
 * What's at `path` in `commit`: a file, with its size when the copy has its contents, or what the
 * checks answer. A path through a link or a file names nothing, since a link is never followed.
 */
async function placeOf(clone: CodeClone, commit: Oid, path: string): Promise<Place> {
  const bytes = new TextEncoder().encode(path);
  let found;
  try {
    found = await clone.fileVersion(commit, bytes);
  } catch (error) {
    if (isFolder(error, bytes)) return { kind: 'notFile', is: 'folder' };
    return unread(`Lo couldn't look for it in the local copy: ${describe(error)}`);
  }
  if (found === undefined) return { kind: 'missing' };
  switch (found.mode) {
    case 'symlink':
      return { kind: 'notFile', is: 'link' };
    case 'submodule':
      return { kind: 'notFile', is: 'submodule' };
    case 'regular':
    case 'executable':
      return { kind: 'blob', oid: found.oid, size: found.size };
    default:
      found.mode satisfies never;
      return unread("It's something Lo doesn't read.");
  }
}

/** The size of the file at `path` in `commit`, once the copy has its contents. */
async function sizeOf(clone: CodeClone, commit: Oid, path: string): Promise<number | undefined> {
  try {
    return (await clone.fileVersion(commit, new TextEncoder().encode(path)))?.size;
  } catch {
    return undefined;
  }
}

/** Downloads blob `oid`, bringing at most `cap` bytes, and says whether that was too few. */
async function downloadOne(
  clone: CodeClone,
  oid: Oid,
  cap: number,
  log: (line: string) => void,
): Promise<'brought' | 'pastCap' | 'failed'> {
  try {
    await clone.download([oid], DOWNLOADING, { maxBytes: cap });
    return 'brought';
  } catch (error) {
    if (pastCap(error)) return 'pastCap';
    log(`downloading the code of an overview: ${describe(error)}`);
    return 'failed';
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

/**
 * Whether `error` is what the copy says of `path` when it's a folder: `@lo/git` answers no file
 * there, naming it a tree.
 */
function isFolder(error: unknown, path: Uint8Array): boolean {
  return (
    error instanceof GitError &&
    error.detail.kind === 'git' &&
    error.detail.message === `${displayPath(path)} is a tree, not a file`
  );
}

function unread(why: string): Extract<CodeAnswer, { kind: 'unread' }> {
  return { kind: 'unread', why };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
