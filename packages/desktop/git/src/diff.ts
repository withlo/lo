/** What changed between two commits, from `git diff --raw --numstat -z`. */

import { GitError } from './errors.ts';
import { type Oid, parseOid } from './oid.ts';
import { splitRecords } from './records.ts';
import { displayPath, type FileMode, MAX_ENTRIES, parseMode, tooManyEntries } from './tree.ts';

/**
 * How a file changed, as git reports it. Renames are found as GitHub finds them, at 50%
 * similarity, and `similarity` is a percentage. A type change is one path changing what it is,
 * such as a symlink becoming a file.
 */
export type Change =
  | { readonly kind: 'added' | 'deleted' | 'modified' | 'typeChanged' }
  | { readonly kind: 'renamed'; readonly similarity: number };

/** One side of a changed file. */
export interface FileVersion {
  /** The path, as git stores it: bytes, usually but not always UTF-8. */
  readonly path: Buffer;
  /**
   * The blob. For a submodule, the commit it points at, which is in another repository: never
   * read it.
   */
  readonly oid: Oid;
  readonly mode: FileMode;
  /** The blob's size in bytes, once the clone has it. A submodule has none. */
  readonly size?: number | undefined;
}

export interface LineCounts {
  readonly added: number;
  readonly deleted: number;
}

/** A file that changed between two commits. */
export interface ChangedFile {
  readonly change: Change;
  /** The file before; none when it was added. */
  readonly old?: FileVersion | undefined;
  /** The file after; none when it was deleted. */
  readonly new?: FileVersion | undefined;
  /**
   * Whether git takes either side for binary, from its contents. Lo applies no `.gitattributes`,
   * so a repository can't mark a file binary or text.
   */
  readonly binary: boolean;
  /** Lines added and deleted. None for a binary file or a submodule. */
  readonly lines?: LineCounts | undefined;
}

/** The path to show: the new one, or the old one of a deleted file. */
export function changedPath(file: ChangedFile): Buffer {
  const version = file.new ?? file.old;
  if (version === undefined) throw new Error('a changed file has a side');
  return version.path;
}

/** Whether only the file's mode changed, such as being made executable. */
export function isModeChangeOnly(file: ChangedFile): boolean {
  const { old, new: now } = file;
  return (
    old !== undefined &&
    now !== undefined &&
    old.oid === now.oid &&
    old.mode !== now.mode &&
    old.path.equals(now.path)
  );
}

/** Whether either side is a submodule. */
export function isSubmodule(file: ChangedFile): boolean {
  return file.old?.mode === 'submodule' || file.new?.mode === 'submodule';
}

/**
 * The larger side's size in bytes, which caps what's worth loading, since a file of few lines can
 * still be huge. None for a submodule.
 */
export function changedSize(file: ChangedFile): number | undefined {
  const sizes = [file.old?.size, file.new?.size].filter((size) => size !== undefined);
  return sizes.length === 0 ? undefined : Math.max(...sizes);
}

function unexpected(what: string): GitError {
  return new GitError({
    kind: 'git',
    command: 'git diff --raw --numstat',
    message: `printed an unexpected ${what}`,
  });
}

/** A header of `--raw`'s: `:100644 100644 <old oid> <new oid> R087`. */
interface RawHeader {
  readonly oldMode: FileMode | undefined;
  readonly newMode: FileMode | undefined;
  readonly oldOid: Oid;
  readonly newOid: Oid;
  readonly status: string;
  readonly score: number | undefined;
}

/** A field git always writes in ASCII, such as a raw header or a count. */
function ascii(field: Buffer): string {
  const text = field.toString('latin1');
  if (!/^[\x20-\x7e]*$/.test(text)) throw unexpected(`field ${JSON.stringify(displayPath(field))}`);
  return text;
}

function parseRawHeader(header: string): RawHeader {
  const parts = header.slice(1).split(' ');
  const [oldMode, newMode, oldOid, newOid, status] = parts;
  if (
    parts.length !== 5 ||
    oldMode === undefined ||
    newMode === undefined ||
    oldOid === undefined ||
    newOid === undefined ||
    status === undefined ||
    status === ''
  ) {
    throw unexpected(header);
  }
  const score = status.slice(1);
  if (score !== '' && !/^\d+$/.test(score)) throw unexpected(header);
  const mode = (value: string) => {
    try {
      return parseMode(value);
    } catch {
      throw unexpected(`file mode ${value}`);
    }
  };
  const oid = (value: string) => {
    try {
      return parseOid(value);
    } catch {
      throw unexpected(header);
    }
  };
  return {
    oldMode: mode(oldMode),
    newMode: mode(newMode),
    oldOid: oid(oldOid),
    newOid: oid(newOid),
    status: status.charAt(0),
    score: score === '' ? undefined : Number(score),
  };
}

/**
 * Reads `git diff -z --raw --numstat --no-abbrev`: a raw record for each file, its header then
 * its path or two, then a numstat record for each, in the same order. Paths are bytes; the rest
 * is ASCII. More than `maxEntries` files is `tooLarge`.
 */
export function parseChanges(output: Uint8Array, maxEntries = MAX_ENTRIES): ChangedFile[] {
  const fields = splitRecords(output);
  let at = 0;
  const files: {
    change: Change;
    old: FileVersion | undefined;
    new: FileVersion | undefined;
    binary: boolean;
    lines: LineCounts | undefined;
  }[] = [];
  for (;;) {
    const field = fields[at];
    if (field === undefined || field[0] !== 0x3a) break;
    if (files.length === maxEntries) throw tooManyEntries('git diff --raw --numstat', maxEntries);
    at++;
    const header = ascii(field);
    const raw = parseRawHeader(header);
    const path = () => {
      const next = fields[at++];
      if (next === undefined || next.length === 0) throw unexpected(`${header} without a path`);
      return next;
    };
    const two = raw.status === 'R' || raw.status === 'C';
    const oldPath = path();
    const newPath = two ? path() : oldPath;
    let change: Change;
    switch (raw.status) {
      case 'A':
        change = { kind: 'added' };
        break;
      case 'D':
        change = { kind: 'deleted' };
        break;
      case 'M':
        change = { kind: 'modified' };
        break;
      case 'T':
        change = { kind: 'typeChanged' };
        break;
      // Copies are off, but a copy reads best as an added file.
      case 'C':
        change = { kind: 'added' };
        break;
      case 'R':
        change = { kind: 'renamed', similarity: raw.score ?? 100 };
        break;
      default:
        throw unexpected(`file status ${JSON.stringify(raw.status)}`);
    }
    const old = change.kind === 'added' ? undefined : side(oldPath, raw.oldMode, raw.oldOid);
    const now = change.kind === 'deleted' ? undefined : side(newPath, raw.newMode, raw.newOid);
    if (old === undefined && now === undefined) throw unexpected(header);
    files.push({ change, old, new: now, binary: false, lines: undefined });
  }

  let index = 0;
  while (at < fields.length) {
    const field = fields[at++];
    if (field === undefined) break;
    const first = field.indexOf(0x09);
    const second = first === -1 ? -1 : field.indexOf(0x09, first + 1);
    if (second === -1) {
      throw unexpected(`--numstat line ${JSON.stringify(displayPath(field))}`);
    }
    const added = ascii(field.subarray(0, first));
    const deleted = ascii(field.subarray(first + 1, second));
    let path = field.subarray(second + 1);
    if (path.length === 0) {
      // A rename: its old and new paths follow as fields of their own.
      at++;
      const renamed = fields[at++];
      if (renamed === undefined) {
        throw unexpected(`--numstat rename ${JSON.stringify(displayPath(field))}`);
      }
      path = renamed;
    }
    const shown = displayPath(path);
    const file = files[index];
    if (file === undefined) throw unexpected(`--numstat line for ${shown} without a raw line`);
    const expected = (file.new ?? file.old)?.path;
    if (expected === undefined || !expected.equals(path)) {
      throw unexpected(
        `--numstat line for ${shown} where ${displayPath(expected ?? Buffer.alloc(0))} was expected`,
      );
    }
    if (added === '-' && deleted === '-') {
      file.binary = true;
    } else if (file.old?.mode !== 'submodule' && file.new?.mode !== 'submodule') {
      // git counts the "Subproject commit" lines it makes up for a submodule.
      const count = (value: string) => {
        if (!/^\d+$/.test(value)) throw unexpected(`--numstat count ${value} for ${shown}`);
        return Number(value);
      };
      file.lines = { added: count(added), deleted: count(deleted) };
    }
    index++;
  }
  if (index !== files.length) {
    throw unexpected(`${files.length} --raw lines and ${index} --numstat lines`);
  }
  return files;
}

/** One side of a raw record: none for a side that isn't there. */
function side(path: Buffer, mode: FileMode | undefined, oid: Oid): FileVersion | undefined {
  return mode === undefined ? undefined : { path, oid, mode };
}

/**
 * The blobs on both sides of `git diff --raw -z --no-renames` output, without submodules' commits
 * or the zeros of a side that isn't there. Each entry is its header, then its path, so a path
 * that starts with `:` is never taken for an entry.
 */
export function rawDiffBlobs(output: Uint8Array): Oid[] {
  const fields = splitRecords(output).filter((field) => field.length > 0);
  if (fields.length > 2 * MAX_ENTRIES) throw tooManyEntries('git diff --raw', MAX_ENTRIES);
  const blobs: Oid[] = [];
  for (let at = 0; at < fields.length; at += 2) {
    const field = fields[at];
    if (field === undefined) break;
    const header = field.toString('latin1');
    if (!header.startsWith(':')) {
      throw new GitError({
        kind: 'git',
        command: 'git diff --raw',
        message: `printed an unexpected entry ${JSON.stringify(displayPath(field))}`,
      });
    }
    const [oldMode, newMode, oldOid, newOid] = header.slice(1).split(' ');
    for (const [mode, oid] of [
      [oldMode, oldOid],
      [newMode, newOid],
    ]) {
      if (mode === undefined || oid === undefined || mode === '160000' || /^0+$/.test(oid)) {
        continue;
      }
      blobs.push(parseOid(oid));
    }
  }
  return blobs;
}
