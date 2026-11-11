/**
 * What the overview's commit may hold: `artifact.md`, a file, and figures, files directly in
 * `figures/`. Anything else is reported, and never read. The commit's size and its count of files
 * and folders are measured from its listing alone, so a commit far past either costs no more than
 * reading the listing.
 */

import { ARTIFACT, quote, type Findings } from './findings.ts';
import { LIMITS } from './limits.ts';
import type { EntryKind, TreeEntry } from './readers.ts';
import { FIGURE_TYPES, readPath } from './targets.ts';

/** The folder figures sit in. */
const FIGURES = 'figures';

/** A kind of file, for saying what makes a commit large: `artifact.md`, a figure's type or other. */
export type SizeKind = 'artifact' | (typeof FIGURE_TYPES)[number] | 'other';

/** What the commit's files take, as its listing says. */
export interface Sizes {
  /** Bytes, of every file and link whose size the listing gives. */
  bytes: number;
  /**
   * Files and folders, the folders a path passes through included. Counting stops just past the
   * limit, so past it, this is at least what's there.
   */
  entries: number;
  /** The bytes and files of each kind, the largest first. */
  kinds: { kind: SizeKind; files: number; bytes: number }[];
}

/** What the commit holds, read from its listing. */
export interface CommitContents {
  /** What `artifact.md` is, and its size, when it's there. */
  artifact: { kind: EntryKind; size: number | undefined } | undefined;
  /** What each path is, by its text, for the paths that are UTF-8. Past a limit, it's empty. */
  kinds: ReadonlyMap<string, EntryKind>;
  /** Past the limit on files and folders, these count only as far as one past it. */
  sizes: Sizes;
  /** Which of the commit's limits it's past, if any: its files and folders, or its bytes. */
  past: 'entries' | 'bytes' | undefined;
  /** A file or link the listing gives no size for, when there is one, so its bytes can't count. */
  unsized: string | undefined;
}

/** How many bytes of a long path's start and end are read, to show it and to know its type. */
const LONG_SHOWN = 48;

/** `artifact.md`'s path, as a listing holds it. */
const ARTIFACT_PATH = new TextEncoder().encode(ARTIFACT);

/**
 * Reads `entries`, the overview's commit, adding to `findings` what the commit can't hold. Past
 * the limit on files and folders, only that is reported, and only one past the limit's worth of
 * entries is read, besides looking for `artifact.md`. With a file of no size, the commit's bytes
 * aren't counted. A path longer than any target counts as one entry, however many folders it
 * passes through.
 */
export function readCommit(entries: readonly TreeEntry[], findings: Findings): CommitContents {
  const artifact = artifactEntry(entries);
  const kinds = new Map<string, EntryKind>();
  const listed: { text: string; utf8: boolean; kind: EntryKind; long: boolean }[] = [];
  const twice = new Set<string>();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const loose = new TextDecoder('utf-8', { ignoreBOM: true });
  const totals = new Map<SizeKind, { files: number; bytes: number }>();
  let bytes = 0;
  let unsized: string | undefined;
  const read = entries.length > LIMITS.entries ? entries.slice(0, LIMITS.entries + 1) : entries;
  for (const entry of read) {
    // A path longer than any target is never one an overview holds, so only its start and its
    // ending are read: as a key, a long one would cost as much to compare as it is long.
    const long = entry.path.length > LIMITS.argument;
    const path = long ? entry.path.subarray(0, LONG_SHOWN) : entry.path;
    let text: string;
    let utf8 = !long;
    try {
      text = decoder.decode(path);
    } catch {
      text = loose.decode(path);
      utf8 = false;
    }
    const size = sizeOf(entry);
    if (size === undefined) unsized ??= text;
    bytes += size ?? 0;
    if (entry.kind === 'file') {
      const kind = sizeKind(long ? loose.decode(entry.path.subarray(-LONG_SHOWN)) : text);
      const total = totals.get(kind) ?? { files: 0, bytes: 0 };
      totals.set(kind, { files: total.files + 1, bytes: total.bytes + (size ?? 0) });
    }
    const earlier = utf8 ? kinds.get(text) : undefined;
    if (earlier !== undefined) twice.add(text);
    if (utf8) kinds.set(text, earlier === undefined ? entry.kind : either(earlier, entry.kind));
    listed.push({ text, utf8, kind: entry.kind, long });
  }

  const count =
    read === entries
      ? entryCount(listed.filter(({ long }) => !long).map(({ text }) => text)) +
        listed.filter(({ long }) => long).length
      : read.length;
  const sizes: Sizes = {
    bytes,
    entries: count,
    kinds: [...totals]
      .map(([kind, total]) => ({ kind, ...total }))
      .toSorted((a, b) => b.bytes - a.bytes || compare(a.kind, b.kind)),
  };
  if (count > LIMITS.entries) {
    findings.add(
      'tree-count',
      undefined,
      `The overview's commit holds more than ${LIMITS.entries} files and folders, the most an overview may hold.`,
    );
    return { artifact, kinds: new Map(), sizes, past: 'entries', unsized: undefined };
  }
  if (unsized === undefined && bytes > LIMITS.commit) {
    findings.add(
      'tree-size',
      undefined,
      `The overview's commit is ${mebibytes(bytes)}, past the ${mebibytes(LIMITS.commit)} an overview may be.${largest(sizes)}`,
    );
    return { artifact, kinds: new Map(), sizes, past: 'bytes', unsized };
  }

  // In the order of their paths, so a listing in any order reports the same.
  const reported = new Set<string>();
  for (const { text, utf8, kind, long } of listed.toSorted((a, b) => compare(a.text, b.text))) {
    const extra = long
      ? {
          path: `${text}…`,
          message: `A path in the overview's commit is longer than ${LIMITS.argument.toLocaleString('en-US')} bytes, which no overview holds.`,
        }
      : extraEntry(text, utf8, kind, twice.has(text));
    if (!extra || reported.has(extra.path)) continue;
    reported.add(extra.path);
    findings.add('tree-extra', undefined, extra.message, quote(extra.path));
  }
  return { artifact, kinds, sizes, past: undefined, unsized };
}

/**
 * What `artifact.md` is in `entries`, however many there are: each is only compared with its name,
 * byte for byte.
 */
function artifactEntry(entries: readonly TreeEntry[]): CommitContents['artifact'] {
  let found: CommitContents['artifact'];
  for (const entry of entries) {
    const { path } = entry;
    if (
      path.length !== ARTIFACT_PATH.length ||
      !path.every((byte, at) => byte === ARTIFACT_PATH[at])
    ) {
      continue;
    }
    const size = sizeOf(entry);
    found =
      found === undefined
        ? { kind: entry.kind, size }
        : { kind: either(found.kind, entry.kind), size: found.size === size ? size : undefined };
  }
  return found;
}

/**
 * Paths that differ only in case, by their text in lower case: the first of them in order, for
 * saying which a path was likely meant to be. Made once, however many paths are looked up.
 */
export function caseIndex(kinds: ReadonlyMap<string, EntryKind>): Map<string, string> {
  const index = new Map<string, string>();
  for (const path of kinds.keys()) {
    const lower = path.toLowerCase();
    const known = index.get(lower);
    if (known === undefined || compare(path, known) < 0) index.set(lower, path);
  }
  return index;
}

/**
 * What a path listed twice, as `a` and as `b`, is taken for, whichever order they're listed in: a
 * file only if it's a file both times.
 */
function either(a: EntryKind, b: EntryKind): EntryKind {
  if (a === 'file') return b;
  if (b === 'file') return a;
  return compare(a, b) <= 0 ? a : b;
}

/** The order of `a` and `b` by their code units, which is the same everywhere. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * An entry's size: 0 for a folder or a submodule, which take none of their own, and undefined for a
 * file or a link the listing gives no size a file could have.
 */
function sizeOf(entry: TreeEntry): number | undefined {
  if (entry.kind !== 'file' && entry.kind !== 'link') return 0;
  const { size } = entry;
  return typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 ? size : undefined;
}

function sizeKind(path: string): SizeKind {
  if (path === ARTIFACT) return 'artifact';
  const ending = path.slice(path.lastIndexOf('.') + 1);
  return FIGURE_TYPES.find((type) => type === ending) ?? 'other';
}

/**
 * How many files and folders `paths` make, counting each folder a path passes through, listed or
 * not. It stops counting just past the limit, so a path of a million folders costs no more than
 * the limit's worth of them.
 */
function entryCount(paths: readonly string[]): number {
  const seen = new Set(paths);
  for (const path of paths) {
    for (let at = path.indexOf('/'); at > 0; at = path.indexOf('/', at + 1)) {
      seen.add(path.slice(0, at));
      if (seen.size > LIMITS.entries) return seen.size;
    }
  }
  return seen.size;
}

/**
 * What's wrong with an entry at `text`, when it isn't one an overview holds: the path to report it
 * at, the outermost that isn't, and why.
 */
function extraEntry(
  text: string,
  utf8: boolean,
  kind: EntryKind,
  twice: boolean,
): { path: string; message: string } | undefined {
  const only = 'An overview holds only artifact.md and figures in figures/.';
  if (!utf8) {
    return { path: text, message: `A path in the overview's commit isn't UTF-8. ${only}` };
  }
  if (!readPath(text).ok) {
    return { path: text, message: `No overview can hold a path written so. ${only}` };
  }
  if (twice) return { path: text, message: `${quote(text)} is in the overview's commit twice.` };
  const parts = text.split('/');
  const [top = '', name, deeper] = parts;
  if (text === ARTIFACT) return undefined;
  if (top !== FIGURES) {
    return { path: top, message: `${quote(top)} isn't part of an overview. ${only}` };
  }
  if (name === undefined) {
    if (kind === 'folder') return undefined;
    return {
      path: text,
      message: `figures is ${article(kind)}. It's the folder the figures sit directly in.`,
    };
  }
  const shown = quote(`${FIGURES}/${name}`);
  if (deeper !== undefined) {
    return {
      path: `${FIGURES}/${name}`,
      message: `${shown} is a folder. Figures sit directly in figures/.`,
    };
  }
  if (kind !== 'file') {
    return { path: text, message: `${shown} is ${article(kind)}. figures/ holds only files.` };
  }
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || !FIGURE_TYPES.some((type) => type === name.slice(dot + 1))) {
    return {
      path: text,
      message: `${shown} isn't a figure. A figure is an .svg, .png, .jpg, .jpeg, .gif or .webp file.`,
    };
  }
  return undefined;
}

/** `kind`, with "a" or "an", as a sentence names it. */
export function article(kind: EntryKind): string {
  switch (kind) {
    case 'file':
      return 'a file';
    case 'link':
      return 'a link';
    case 'folder':
      return 'a folder';
    case 'submodule':
      return 'a submodule';
    default:
      kind satisfies never;
      return 'something other than a file';
  }
}

/** `bytes` in MiB, to a tenth, rounded up so a size just past a limit never reads as at it. */
function mebibytes(bytes: number): string {
  return `${(Math.ceil(bytes / ((1024 * 1024) / 10)) / 10).toLocaleString('en-US')} MiB`;
}

/** What takes the most of a large commit, in a sentence: its largest kind of file. */
function largest(sizes: Sizes): string {
  const [first] = sizes.kinds;
  if (!first || first.bytes * 2 < sizes.bytes) return '';
  const what =
    first.kind === 'artifact'
      ? 'artifact.md'
      : `${first.files.toLocaleString('en-US')} .${first.kind} file${first.files === 1 ? '' : 's'}`;
  return ` Most of it is ${what}, ${mebibytes(first.bytes)} in all.`;
}
