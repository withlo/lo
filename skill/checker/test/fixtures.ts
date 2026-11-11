/**
 * The overviews in `testing/fixtures/artifacts/`, on disk as the checker reads them, and the code
 * they point at, in a repository: so each can be checked by the built checker, and by `artifact`
 * through readers of the tests' own, and the two compared.
 */

import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CodeReader, EntryKind, FileAnswer, OverviewFiles, TreeEntry } from '@lo/artifact';
import { gitBytes } from '@lo/testing/git';

/** Where the fixtures are. */
export const FIXTURES = fileURLToPath(
  new URL('../../../testing/fixtures/artifacts/', import.meta.url),
);

/** The commit of the fixtures' code, which every fixture's header names. */
export const CODE_COMMIT = 'a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87';

/** The pull request a fixture's ref is for, unless its `fixture.json` says otherwise. */
export const PR = 4797;

/** When the fixtures' code was committed, in seconds: 2026-01-01. */
const DATE = 1_767_225_600;

const encoder = new TextEncoder();

/** An entry of the fixtures' code, by its path's bytes. */
interface Entry {
  path: Buffer;
  mode: '100644' | '120000' | '160000';
  /** A blob's contents, or the commit a submodule points at. */
  contents: Uint8Array | string;
}

/** An entry `code.json` lists, which a checkout can't hold. */
interface Listed {
  path?: string;
  bytes?: string;
  link?: string;
  submodule?: string;
  text?: string;
  repeat?: string;
  size?: number;
}

/**
 * Commits the fixtures' code into a new repository at `dir`, with the same names and dates as
 * `artifact`'s tests, so its id is the one the fixtures name. Returns the commit's id.
 */
export function commitCode(dir: string): string {
  gitBytes(dir, ['init', '-q', '--object-format=sha1', '.']);
  const root = join(FIXTURES, 'code');
  const entries: Entry[] = files(root).map((path) => ({
    path: Buffer.from(path),
    mode: '100644',
    contents: readFileSync(join(root, path)),
  }));
  const listed: { entries: Listed[] } = JSON.parse(
    readFileSync(join(FIXTURES, 'code.json'), 'utf8'),
  );
  for (const each of listed.entries) entries.push(listedEntry(each));
  const tree = writeTree(dir, entries);
  const commit = [
    `tree ${tree}`,
    `author Lo test <test@lo.invalid> ${DATE} +0000`,
    `committer Lo test <test@lo.invalid> ${DATE} +0000`,
    '',
    'The code the overviews in the fixtures point at.',
    '',
  ].join('\n');
  return gitBytes(dir, ['hash-object', '-t', 'commit', '-w', '--stdin'], commit)
    .toString('utf8')
    .trim();
}

/** The files under `root`, by their paths from it, in order. */
function files(root: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const name of readdirSync(join(root, prefix)).toSorted()) {
    const path = prefix === '' ? name : `${prefix}/${name}`;
    if (lstatSync(join(root, path)).isDirectory()) found.push(...files(root, path));
    else found.push(path);
  }
  return found;
}

function listedEntry(listed: Listed): Entry {
  const path =
    listed.bytes === undefined ? Buffer.from(listed.path ?? '') : Buffer.from(listed.bytes, 'hex');
  if (listed.link !== undefined)
    return { path, mode: '120000', contents: encoder.encode(listed.link) };
  if (listed.submodule !== undefined) return { path, mode: '160000', contents: listed.submodule };
  if (listed.repeat !== undefined && listed.size !== undefined) {
    const line = encoder.encode(listed.repeat);
    const contents = new Uint8Array(listed.size);
    for (let at = 0; at < listed.size; at += line.length) {
      contents.set(line.subarray(0, listed.size - at), at);
    }
    return { path, mode: '100644', contents };
  }
  return { path, mode: '100644', contents: encoder.encode(listed.text ?? '') };
}

/** Writes `entries` as trees, the deepest first, and returns the root's id. */
function writeTree(dir: string, entries: readonly Entry[]): string {
  const lines: Buffer[] = [];
  const folders = new Map<string, Entry[]>();
  for (const entry of entries) {
    const slash = entry.path.indexOf(0x2f);
    if (slash === -1) {
      const id =
        typeof entry.contents === 'string'
          ? entry.contents
          : gitBytes(dir, ['hash-object', '-w', '--stdin'], entry.contents).toString('utf8').trim();
      const type = entry.mode === '160000' ? 'commit' : 'blob';
      lines.push(
        Buffer.concat([Buffer.from(`${entry.mode} ${type} ${id}\t`), entry.path, Buffer.from([0])]),
      );
      continue;
    }
    const name = entry.path.subarray(0, slash).toString('latin1');
    folders.set(name, [
      ...(folders.get(name) ?? []),
      { ...entry, path: entry.path.subarray(slash + 1) },
    ]);
  }
  for (const [name, inside] of folders) {
    const id = writeTree(dir, inside);
    lines.push(
      Buffer.concat([
        Buffer.from(`040000 tree ${id}\t`),
        Buffer.from(name, 'latin1'),
        Buffer.from([0]),
      ]),
    );
  }
  return gitBytes(dir, ['mktree', '-z', '--missing'], Buffer.concat(lines)).toString('utf8').trim();
}

/** What a fixture's `fixture.json` may say. */
export interface FixtureInput {
  ref?: number;
  entries?: { path?: string; bytes?: string; kind: EntryKind; size?: number; fails?: boolean }[];
  many?: { prefix: string; ending: string; count: number; size?: number; text?: string };
}

/** The files in a fixture's folder that aren't the overview's. */
const OWN = new Set(['expected.json', 'fixture.json']);

/**
 * Writes the overview in the fixture at `fixture` to the folder `to`, with the entries its
 * `fixture.json` adds made real: a file of that many zeros, sparse when large; a link holding a
 * path of that length; a file no one may read. Returns whether all of it could be made: a file
 * without a size or a submodule can't be, and some disks refuse a name that isn't UTF-8 or that
 * differs from another only in case.
 */
export function materialize(fixture: string, input: FixtureInput, to: string): boolean {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(fixture)) {
    if (!OWN.has(name))
      cpSync(join(fixture, name), join(to, name), { recursive: true, verbatimSymlinks: true });
  }
  let whole = true;
  const make = (path: Buffer, write: (at: Buffer) => void): void => {
    const at = Buffer.concat([Buffer.from(`${to}/`), path]);
    const folder = at.subarray(0, at.lastIndexOf(0x2f));
    const name = at.subarray(at.lastIndexOf(0x2f) + 1);
    try {
      mkdirSync(folder, { recursive: true });
      // A disk that ignores case would take the name for one already there.
      const lower = name.toString('utf8').toLowerCase();
      if (
        readdirSync(folder, { encoding: 'buffer' }).some(
          (each) => each.toString('utf8').toLowerCase() === lower,
        )
      ) {
        whole = false;
        return;
      }
      write(at);
    } catch {
      whole = false;
    }
  };
  for (const entry of input.entries ?? []) {
    const path =
      entry.bytes === undefined ? Buffer.from(entry.path ?? '') : Buffer.from(entry.bytes, 'hex');
    switch (entry.kind) {
      case 'file':
        if (entry.size === undefined) {
          whole = false;
          break;
        }
        make(path, (at) => {
          writeFileSync(at, '');
          truncateSync(at, entry.size);
          if (entry.fails) chmodSync(at, 0o000);
        });
        break;
      case 'link':
        make(path, (at) =>
          symlinkSync(entry.size === 11 ? '/etc/passwd' : 'x'.repeat(entry.size ?? 1), at),
        );
        break;
      case 'folder':
        make(path, (at) => mkdirSync(at));
        break;
      case 'submodule':
        whole = false;
        break;
      default:
        entry.kind satisfies never;
        throw new Error(`Unknown entry ${JSON.stringify(entry)}`);
    }
  }
  if (input.many) {
    const { prefix, ending, count, size, text } = input.many;
    for (let n = 0; n < count; n++) {
      make(Buffer.from(`${prefix}${n}${ending}`), (at) => {
        writeFileSync(at, text ?? new Uint8Array(size ?? 0));
      });
    }
  }
  return whole;
}

/** The overview in the folder `dir`, listed with `lstat` and read without following a link. */
export function referenceFolder(dir: string): OverviewFiles {
  const entries: TreeEntry[] = [];
  const walk = (prefix: Buffer | undefined): void => {
    const at = prefix ? Buffer.concat([Buffer.from(`${dir}/`), prefix]) : Buffer.from(dir);
    for (const name of readdirSync(at, { encoding: 'buffer' })) {
      const path = prefix ? Buffer.concat([prefix, Buffer.from('/'), name]) : name;
      const disk = Buffer.concat([Buffer.from(`${dir}/`), path]);
      const stat = lstatSync(disk);
      if (stat.isSymbolicLink()) {
        entries.push({
          path,
          kind: 'link',
          size: readlinkSync(disk, { encoding: 'buffer' }).length,
        });
      } else if (stat.isDirectory()) {
        entries.push({ path, kind: 'folder' });
        walk(path);
      } else {
        entries.push({ path, kind: 'file', size: stat.size });
      }
    }
  };
  walk(undefined);
  return {
    entries,
    read: async (path, cap): Promise<FileAnswer> => {
      const parts = path.split('/');
      for (const [index, part] of parts.entries()) {
        const at = join(dir, ...parts.slice(0, index + 1));
        // The name exactly, as the folder holds it.
        if (!readdirSync(dirname(at)).includes(part)) return { kind: 'missing' };
        const stat = lstatSync(at);
        const last = index === parts.length - 1;
        if (stat.isSymbolicLink())
          return last ? { kind: 'notFile', is: 'link' } : { kind: 'missing' };
        if (!last && !stat.isDirectory()) return { kind: 'missing' };
        if (last && stat.isDirectory()) return { kind: 'notFile', is: 'folder' };
        if (last) {
          const bytes = cap === 0 ? new Uint8Array() : new Uint8Array(readFileSync(at));
          return { kind: 'file', size: stat.size, bytes: bytes.subarray(0, cap) };
        }
      }
      return { kind: 'missing' };
    },
  };
}

/**
 * Code from the repository at `dir`, read through `git ls-tree` and `git cat-file blob`: the
 * commit's tree listed whole, a path matched by its exact bytes, a link never followed.
 */
export function referenceCode(dir: string): CodeReader {
  return async (commit, path, cap) => {
    let listing: Buffer;
    try {
      listing = gitBytes(dir, ['ls-tree', '-r', '-t', '-z', '--full-tree', `${commit}^{commit}`]);
    } catch {
      return { kind: 'noCommit' };
    }
    const wanted = Buffer.from(path);
    for (let at = 0; at < listing.length;) {
      const end = listing.indexOf(0, at);
      const record = listing.subarray(at, end);
      at = end + 1;
      const tab = record.indexOf(0x09);
      if (!record.subarray(tab + 1).equals(wanted)) continue;
      const [mode = '', , id = ''] = record.subarray(0, tab).toString('utf8').split(' ');
      if (mode === '120000') return { kind: 'notFile', is: 'link' };
      if (mode === '160000') return { kind: 'notFile', is: 'submodule' };
      if (mode === '040000') return { kind: 'notFile', is: 'folder' };
      const blob = gitBytes(dir, ['cat-file', 'blob', id]);
      return { kind: 'file', size: blob.length, bytes: new Uint8Array(blob.subarray(0, cap)) };
    }
    return { kind: 'missing' };
  };
}
