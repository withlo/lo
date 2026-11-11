/**
 * The overviews in `testing/fixtures/artifacts/`, and the code they point at, read the way Lo and
 * the checker read them: a commit's files through readers that never follow a link.
 *
 * - `code/` and `code.json` are the repository's code. `code.json` lists what a checkout can't
 *   hold: links, a submodule, names differing only in case or Unicode form, a name that isn't
 *   UTF-8, and a file past the limit, made from a line repeated. They're committed with fixed
 *   names and dates, so the commit's id, which every fixture's header names, never changes.
 * - `valid/`, `invalid/` and `hostile/` hold one overview a folder: `artifact.md` and `figures/`,
 *   as its commit holds them, and `expected.json`, what checking it finds. An optional
 *   `fixture.json` gives the pull request whose ref it's on and entries a folder can't hold.
 */

import { lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitBytes } from '@lo/testing/git';

import type {
  CheckedArtifact,
  CodeReader,
  EntryKind,
  FigureState,
  FileAnswer,
  OverviewFiles,
  TreeEntry,
} from '../src/index.ts';

/** Where the fixtures are. */
export const FIXTURES = new URL('../../../../testing/fixtures/artifacts/', import.meta.url)
  .pathname;

/** The commit of the fixtures' code, which every fixture's header names. */
export const CODE_COMMIT = 'a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87';

/** The pull request a fixture's ref is for, unless its `fixture.json` says otherwise. */
export const PR = 4797;

/** When the fixtures' code was committed, in seconds: 2026-01-01. */
const DATE = 1_767_225_600;

const encoder = new TextEncoder();

/** A file or entry in a commit, by its path's bytes. */
interface Entry {
  path: Uint8Array;
  mode: '100644' | '120000' | '160000';
  /** A blob's contents, or the commit a submodule points at. */
  contents: Uint8Array | string;
}

/** An entry `code.json` lists. */
interface Listed {
  path?: string;
  /** The path as hexadecimal bytes, for one that isn't UTF-8. */
  bytes?: string;
  link?: string;
  submodule?: string;
  text?: string;
  repeat?: string;
  size?: number;
}

/** The fixtures' code, in a new bare repository: its folder, and the commit. */
export function commitCode(): { gitDir: string; commit: string; remove: () => void } {
  const gitDir = mkdtempSync(join(tmpdir(), 'lo-artifact-code-'));
  gitBytes(gitDir, ['init', '-q', '--bare', '--object-format=sha1', '.']);
  const entries: Entry[] = [];
  const root = join(FIXTURES, 'code');
  for (const path of files(root)) {
    entries.push({
      path: encoder.encode(path),
      mode: '100644',
      contents: readFileSync(join(root, path)),
    });
  }
  const listed: { entries: Listed[] } = JSON.parse(
    readFileSync(join(FIXTURES, 'code.json'), 'utf8'),
  );
  for (const entry of listed.entries) entries.push(listedEntry(entry));

  const tree = writeTree(gitDir, entries);
  const commit = [
    `tree ${tree}`,
    `author Lo test <test@lo.invalid> ${DATE} +0000`,
    `committer Lo test <test@lo.invalid> ${DATE} +0000`,
    '',
    'The code the overviews in the fixtures point at.',
    '',
  ].join('\n');
  const id = gitBytes(gitDir, ['hash-object', '-t', 'commit', '-w', '--stdin'], commit)
    .toString('utf8')
    .trim();
  return { gitDir, commit: id, remove: () => rmSync(gitDir, { recursive: true, force: true }) };
}

/** The files under `root`, by their paths from it, in order. */
function files(root: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const name of readdirSync(join(root, prefix)).toSorted()) {
    const path = prefix === '' ? name : `${prefix}/${name}`;
    const stat = lstatSync(join(root, path));
    if (stat.isDirectory()) found.push(...files(root, path));
    else if (stat.isFile()) found.push(path);
    else throw new Error(`${path} in the fixtures' code is neither a file nor a folder`);
  }
  return found;
}

function listedEntry(listed: Listed): Entry {
  const path =
    listed.bytes === undefined ? encoder.encode(listed.path) : Buffer.from(listed.bytes, 'hex');
  if (listed.link !== undefined)
    return { path, mode: '120000', contents: encoder.encode(listed.link) };
  if (listed.submodule !== undefined) return { path, mode: '160000', contents: listed.submodule };
  if (listed.repeat !== undefined && listed.size !== undefined) {
    const line = encoder.encode(listed.repeat);
    const contents = new Uint8Array(listed.size);
    for (let at = 0; at < listed.size; at += line.length)
      contents.set(line.subarray(0, listed.size - at), at);
    return { path, mode: '100644', contents };
  }
  return { path, mode: '100644', contents: encoder.encode(listed.text ?? '') };
}

/** Writes `entries` as trees, the deepest first, and returns the root's id. */
function writeTree(gitDir: string, entries: readonly Entry[]): string {
  const lines: Buffer[] = [];
  const folders = new Map<string, Entry[]>();
  for (const entry of entries) {
    const slash = entry.path.indexOf(0x2f);
    if (slash < 0) {
      const id =
        typeof entry.contents === 'string'
          ? entry.contents
          : gitBytes(gitDir, ['hash-object', '-w', '--stdin'], entry.contents)
              .toString('utf8')
              .trim();
      const type = entry.mode === '160000' ? 'commit' : 'blob';
      lines.push(
        Buffer.concat([Buffer.from(`${entry.mode} ${type} ${id}\t`), entry.path, Buffer.from([0])]),
      );
      continue;
    }
    const name = Buffer.from(entry.path.subarray(0, slash)).toString('latin1');
    const inside = folders.get(name) ?? [];
    inside.push({ ...entry, path: entry.path.subarray(slash + 1) });
    folders.set(name, inside);
  }
  for (const [name, inside] of folders) {
    const id = writeTree(gitDir, inside);
    lines.push(
      Buffer.concat([
        Buffer.from(`040000 tree ${id}\t`),
        Buffer.from(name, 'latin1'),
        Buffer.from([0]),
      ]),
    );
  }
  // A submodule's commit isn't in this repository.
  return gitBytes(gitDir, ['mktree', '-z', '--missing'], Buffer.concat(lines))
    .toString('utf8')
    .trim();
}

/** A path's bytes as a key. */
function key(path: Uint8Array): string {
  return Buffer.from(path).toString('latin1');
}

/**
 * A code reader for the repository at `gitDir`, as the checker's works: the commit's tree read
 * whole once, a path matched by its exact bytes, a link never followed, and no file read past the
 * cap.
 */
export function gitReader(gitDir: string): CodeReader {
  const trees = new Map<string, Map<string, { mode: string; id: string }>>();
  const treeOf = (commit: string) => {
    const known = trees.get(commit);
    if (known) return known;
    let listing: Buffer;
    try {
      listing = gitBytes(gitDir, [
        'ls-tree',
        '-r',
        '-t',
        '-z',
        '--full-tree',
        `${commit}^{commit}`,
      ]);
    } catch {
      return undefined;
    }
    const tree = new Map<string, { mode: string; id: string }>();
    for (let at = 0; at < listing.length;) {
      const end = listing.indexOf(0, at);
      const record = listing.subarray(at, end);
      const tab = record.indexOf(0x09);
      const [mode = '', , id = ''] = record.subarray(0, tab).toString('utf8').split(' ');
      tree.set(key(record.subarray(tab + 1)), { mode, id });
      at = end + 1;
    }
    trees.set(commit, tree);
    return tree;
  };
  return async (commit, path, cap) => {
    const tree = treeOf(commit);
    if (!tree) return { kind: 'noCommit' };
    const found = tree.get(key(encoder.encode(path)));
    if (!found) return { kind: 'missing' };
    switch (found.mode) {
      case '120000':
        return { kind: 'notFile', is: 'link' };
      case '160000':
        return { kind: 'notFile', is: 'submodule' };
      case '040000':
        return { kind: 'notFile', is: 'folder' };
      default: {
        const size = Number(gitBytes(gitDir, ['cat-file', '-s', found.id]).toString('utf8'));
        if (cap === 0) return { kind: 'file', size, bytes: new Uint8Array() };
        const blob = gitBytes(gitDir, ['cat-file', 'blob', found.id]);
        return { kind: 'file', size, bytes: new Uint8Array(blob.subarray(0, cap)) };
      }
    }
  };
}

/** What a fixture's `fixture.json` may say. */
export interface FixtureInput {
  /** The pull request whose ref the overview is on. */
  ref?: number;
  /**
   * Entries the folder can't hold, added to its listing. A file is that many bytes of zeros, or
   * with `fails`, a file its reader fails to read.
   */
  entries?: { path?: string; bytes?: string; kind: EntryKind; size?: number; fails?: boolean }[];
  /**
   * As many files as `count`, named `prefix`, a number and `ending`, each holding `text`, or else
   * `size` bytes of zeros.
   */
  many?: { prefix: string; ending: string; count: number; size?: number; text?: string };
}

/** The files a fixture's folder holds that aren't the overview's. */
const OWN = new Set(['expected.json', 'fixture.json']);

/**
 * The overview's commit as the folder `dir` holds it, with the entries `input` adds: listed with
 * `lstat`, so a link is never followed, and read the same way.
 */
export function folderFiles(dir: string, input: FixtureInput): OverviewFiles {
  const entries: TreeEntry[] = [];
  const declared = new Map<
    string,
    { kind: EntryKind; size: number; fails: boolean; text?: Uint8Array }
  >();
  const walk = (prefix: string): void => {
    for (const name of readdirSync(join(dir, prefix)).toSorted()) {
      if (prefix === '' && OWN.has(name)) continue;
      const path = prefix === '' ? name : `${prefix}/${name}`;
      const stat = lstatSync(join(dir, path));
      const kind: EntryKind = stat.isSymbolicLink()
        ? 'link'
        : stat.isDirectory()
          ? 'folder'
          : 'file';
      const size =
        kind === 'link' ? encoder.encode(readlinkSync(join(dir, path))).length : stat.size;
      entries.push(
        kind === 'folder'
          ? { path: encoder.encode(path), kind }
          : { path: encoder.encode(path), kind, size },
      );
      if (kind === 'folder') walk(path);
    }
  };
  walk('');
  for (const entry of input.entries ?? []) {
    const path =
      entry.bytes === undefined ? encoder.encode(entry.path) : Buffer.from(entry.bytes, 'hex');
    // As given: a file or a link without a size is listed so.
    const listed: TreeEntry = JSON.parse('{}');
    entries.push(Object.assign(listed, { path, kind: entry.kind, size: entry.size }));
    declared.set(key(path), {
      kind: entry.kind,
      size: entry.size ?? 0,
      fails: entry.fails ?? false,
    });
  }
  if (input.many) {
    const { prefix, ending, count } = input.many;
    const text = input.many.text === undefined ? undefined : encoder.encode(input.many.text);
    const size = text?.length ?? input.many.size ?? 0;
    for (let n = 0; n < count; n++) {
      const path = encoder.encode(`${prefix}${n}${ending}`);
      entries.push({ path, kind: 'file', size });
      declared.set(key(path), { kind: 'file', size, fails: false, ...(text ? { text } : {}) });
    }
  }
  return {
    entries,
    read: async (path, cap): Promise<FileAnswer> => {
      const listed = declared.get(key(encoder.encode(path)));
      if (listed) {
        if (listed.fails) throw new Error(`${path} can't be read`);
        if (listed.kind !== 'file') return { kind: 'notFile', is: listed.kind };
        return {
          kind: 'file',
          size: listed.size,
          bytes: listed.text?.slice(0, cap) ?? new Uint8Array(Math.min(listed.size, cap)),
        };
      }
      // Each part looked at in turn, so a link on the way is never followed.
      const parts = path.split('/');
      for (const [index, part] of parts.entries()) {
        const at = join(dir, ...parts.slice(0, index + 1));
        let stat;
        try {
          stat = lstatSync(at);
        } catch {
          return { kind: 'missing' };
        }
        const last = index === parts.length - 1;
        if (index === 0 && OWN.has(part)) return { kind: 'missing' };
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

/** What `expected.json` holds: what checking a fixture finds. */
export interface Expected {
  outcome: CheckedArtifact['outcome']['kind'];
  /** Which limit a commit too large is past. */
  what?: string;
  /** Each finding, with its line, and its file when that isn't `artifact.md`. */
  findings: { code: string; line?: number; file?: string }[];
  /** For an overview shown, each target's code, by the line it's on. */
  code?: { line: number; state: string; why?: string }[];
  /**
   * For an overview shown, each figure, by the line its block is on: kept, as its type and, for an
   * image, its size, or for an SVG, the parts it links; or left out or unread, and why.
   */
  figures?: ({ line: number } & ExpectedFigure)[];
}

type ExpectedFigure =
  | { state: 'kept'; type: string; width?: number; height?: number; parts?: string[] }
  | { state: string; why: string };

/** `figure`, as `expected.json` writes it: an SVG without its tree. */
function expectedFigure(figure: FigureState): ExpectedFigure {
  switch (figure.state) {
    case 'kept':
      return figure.type === 'svg' ? { state: 'kept', type: 'svg', parts: figure.parts } : figure;
    case 'leftOut':
    case 'unread':
      return figure;
    default:
      figure satisfies never;
      throw new Error(`Unknown figure ${JSON.stringify(figure)}`);
  }
}

/** `checked`, as `expected.json` writes it. */
export function expectedOf(checked: CheckedArtifact): Expected {
  const { outcome } = checked;
  return {
    outcome: outcome.kind,
    ...(outcome.kind === 'tooLarge' ? { what: outcome.what } : {}),
    findings: checked.findings.map(({ code, line, file }) => ({
      code,
      ...(line === undefined ? {} : { line }),
      ...(file === 'artifact.md' ? {} : { file }),
    })),
    ...(outcome.kind === 'shown'
      ? {
          code: outcome.code.map(({ reference, code }) => ({ line: reference.line, ...code })),
          figures: outcome.figures.map(({ reference, figure }) => ({
            line: reference.line,
            ...expectedFigure(figure),
          })),
        }
      : {}),
  };
}
