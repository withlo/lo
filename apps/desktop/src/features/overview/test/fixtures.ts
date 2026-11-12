// The overviews in `testing/fixtures/artifacts/`, read two ways: as `@lo/artifact`'s and the
// checker's tests read them, through readers of a folder and a repository; and as the app reads
// them, as GitHub would list each one's commit, with its code on a server standing in for
// GitHub. `@lo/artifact`'s tests describe the fixtures, and this follows them.

import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

import {
  SIZE_ONLY,
  type CheckedArtifact,
  type CodeReader,
  type EntryKind,
  type FigureState,
  type FileAnswer,
  type OverviewFiles,
  type TreeEntry,
} from '@lo/artifact';
import type { TreeItem } from '@lo/github';
import { fixturesDir } from '@lo/testing';
import { git, gitBytes } from '@lo/testing/git';

import type { OverviewFile } from '../contract.ts';

/** Where the fixtures are. */
export const FIXTURES = join(fixturesDir, '..', 'artifacts');

/** The commit of the fixtures' code, which every fixture's header names. */
export const CODE_COMMIT = 'a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87';

/** The pull request a fixture's ref is for, unless its `fixture.json` says otherwise. */
export const PR = 4797;

/** When the fixtures' code was committed, in seconds: 2026-01-01. */
const DATE = 1_767_225_600;

const encoder = new TextEncoder();

/** A file or entry of the fixtures' code, by its path's bytes. */
interface CodeEntry {
  path: Uint8Array;
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
 * Commits the fixtures' code into the bare repository at `gitDir`, with the names and dates
 * `@lo/artifact`'s tests give it, so its ID is the one the fixtures' headers name, and points
 * `ref` at it. Returns the commit's ID.
 */
export function commitCode(gitDir: string, ref = 'refs/heads/trunk'): string {
  const root = join(FIXTURES, 'code');
  const entries: CodeEntry[] = files(root).map((path) => ({
    path: encoder.encode(path),
    mode: '100644',
    contents: readFileSync(join(root, path)),
  }));
  const listed: { entries: Listed[] } = JSON.parse(
    readFileSync(join(FIXTURES, 'code.json'), 'utf8'),
  );
  for (const each of listed.entries) entries.push(listedEntry(each));
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
  git(gitDir, 'update-ref', ref, id);
  return id;
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

function listedEntry(listed: Listed): CodeEntry {
  const path =
    listed.bytes === undefined ? encoder.encode(listed.path) : Buffer.from(listed.bytes, 'hex');
  if (listed.link !== undefined) {
    return { path, mode: '120000', contents: encoder.encode(listed.link) };
  }
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

/** Writes `entries` as trees, the deepest first, and returns the root's ID. */
function writeTree(gitDir: string, entries: readonly CodeEntry[]): string {
  const lines: Buffer[] = [];
  const folders = new Map<string, CodeEntry[]>();
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
 * A code reader for the bare repository at `gitDir`, as `@lo/artifact`'s tests read it: the
 * commit's tree read whole once, a path matched by its exact bytes, a link never followed, and no
 * file read past the cap.
 */
export function gitReader(gitDir: string): CodeReader {
  const trees = new Map<string, Map<string, { mode: string; id: string }> | undefined>();
  const treeOf = (commit: string) => {
    if (trees.has(commit)) return trees.get(commit);
    let listing: Buffer | undefined;
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
      listing = undefined;
    }
    let tree: Map<string, { mode: string; id: string }> | undefined;
    if (listing) {
      tree = new Map();
      for (let at = 0; at < listing.length;) {
        const end = listing.indexOf(0, at);
        const record = listing.subarray(at, end);
        const tab = record.indexOf(0x09);
        const [mode = '', , id = ''] = record.subarray(0, tab).toString('utf8').split(' ');
        tree.set(key(record.subarray(tab + 1)), { mode, id });
        at = end + 1;
      }
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

/** One of a fixture's files and folders: its path's bytes, what it is, its size and contents. */
interface FixtureEntry {
  path: Uint8Array;
  kind: EntryKind;
  size: number | undefined;
  /** A file's bytes, or none for one its reader fails to read. */
  bytes: Uint8Array | undefined;
}

/**
 * The overview's commit as the fixture in `dir` holds it, with the entries `input` adds: listed
 * with `lstat`, so a link is never followed.
 */
export function fixtureEntries(dir: string, input: FixtureInput): FixtureEntry[] {
  const entries: FixtureEntry[] = [];
  const walk = (prefix: string): void => {
    for (const name of readdirSync(join(dir, prefix)).toSorted()) {
      if (prefix === '' && OWN.has(name)) continue;
      const path = prefix === '' ? name : `${prefix}/${name}`;
      const stat = lstatSync(join(dir, path));
      if (stat.isSymbolicLink()) {
        const target = encoder.encode(readlinkSync(join(dir, path)));
        entries.push({
          path: encoder.encode(path),
          kind: 'link',
          size: target.length,
          bytes: target,
        });
      } else if (stat.isDirectory()) {
        entries.push({
          path: encoder.encode(path),
          kind: 'folder',
          size: undefined,
          bytes: undefined,
        });
        walk(path);
      } else {
        const bytes = new Uint8Array(readFileSync(join(dir, path)));
        entries.push({ path: encoder.encode(path), kind: 'file', size: bytes.length, bytes });
      }
    }
  };
  walk('');
  for (const entry of input.entries ?? []) {
    const path =
      entry.bytes === undefined ? encoder.encode(entry.path) : Buffer.from(entry.bytes, 'hex');
    const size = entry.size;
    const bytes =
      entry.fails || entry.kind !== 'file' || size === undefined ? undefined : new Uint8Array(size);
    entries.push({ path: new Uint8Array(path), kind: entry.kind, size, bytes });
  }
  if (input.many) {
    const { prefix, ending, count } = input.many;
    const text = input.many.text === undefined ? undefined : encoder.encode(input.many.text);
    for (let n = 0; n < count; n++) {
      const bytes = text ?? new Uint8Array(input.many.size ?? 0);
      entries.push({
        path: encoder.encode(`${prefix}${n}${ending}`),
        kind: 'file',
        size: bytes.length,
        bytes,
      });
    }
  }
  return entries;
}

/**
 * `entries` as the fixtures' own reader of a folder gives them to the checks, and reads them: by
 * their exact bytes, never following a link, failing a file whose reader fails.
 */
export function folderFiles(entries: readonly FixtureEntry[]): OverviewFiles {
  const byPath = new Map(entries.map((entry) => [key(entry.path), entry]));
  return {
    entries: entries.map(({ path, kind, size }): TreeEntry => {
      // As listed: a file or a link without a size has none.
      const listed: TreeEntry = JSON.parse('{}');
      return Object.assign(listed, { path, kind, size });
    }),
    read: async (path, cap): Promise<FileAnswer> => {
      // Each part looked at in turn, so a link on the way is never followed.
      const parts = path.split('/');
      for (let at = 1; at < parts.length; at++) {
        const above = byPath.get(key(encoder.encode(parts.slice(0, at).join('/'))));
        if (above && above.kind !== 'folder') return { kind: 'missing' };
      }
      const entry = byPath.get(key(encoder.encode(path)));
      if (!entry) return { kind: 'missing' };
      if (entry.kind !== 'file') return { kind: 'notFile', is: entry.kind };
      if (!entry.bytes) throw new Error(`${path} can't be read`);
      return { kind: 'file', size: entry.bytes.length, bytes: entry.bytes.slice(0, cap) };
    },
  };
}

/** A fake object ID for an entry GitHub lists, from its place in the listing. */
function fakeId(index: number): string {
  return index.toString(16).padStart(40, '0');
}

/**
 * The overview's commit as GitHub's REST API lists it, recursively: each of `entries`, in order,
 * with a folder's type and a blob's size, but its path as text, with U+FFFD for bytes that aren't
 * UTF-8. The folders are those the fixture lists, so both readers count the same entries.
 */
export function githubListing(entries: readonly FixtureEntry[]): TreeItem[] {
  const loose = new TextDecoder('utf-8', { ignoreBOM: true });
  return entries.map(({ path, kind, size }, index): TreeItem => {
    const text = loose.decode(path);
    const sha = fakeId(index + 1);
    switch (kind) {
      case 'folder':
        return { path: text, mode: '040000', type: 'tree', sha };
      case 'submodule':
        return { path: text, mode: '160000', type: 'commit', sha };
      case 'link':
      case 'file':
        return {
          path: text,
          mode: kind === 'link' ? '120000' : '100644',
          type: 'blob',
          sha,
          ...(size === undefined ? {} : { size }),
        };
      default:
        kind satisfies never;
        throw new Error(`Unknown kind ${String(kind)}`);
    }
  });
}

/**
 * What main's `files` gives of the file at `path`, read from the fixture's `entries`, as it gives
 * one GitHub sent: its bytes, or its size alone past what any check reads.
 */
export function mainFile(entries: readonly FixtureEntry[], path: string): OverviewFile {
  const entry = entries.find((each) => key(each.path) === key(encoder.encode(path)));
  if (!entry) return { kind: 'missing' };
  if (entry.kind !== 'file') return { kind: 'notFile', is: entry.kind };
  if (entry.size === undefined)
    return { kind: 'unread', why: "GitHub didn't say how large it is." };
  if (entry.size > SIZE_ONLY) return { kind: 'file', size: entry.size, bytes: null };
  if (!entry.bytes) return { kind: 'unread', why: 'GitHub failed to send it.' };
  return { kind: 'file', size: entry.bytes.length, bytes: entry.bytes };
}

/** What `expected.json` holds: what checking a fixture finds. */
export interface Expected {
  outcome: CheckedArtifact['outcome']['kind'];
  what?: string;
  findings: { code: string; line?: number; file?: string }[];
  code?: { line: number; state: string; why?: string }[];
  figures?: ({ line: number } & ExpectedFigure)[];
}

type ExpectedFigure =
  | { state: 'kept'; type: string; width?: number; height?: number; parts?: string[] }
  | { state: string; why: string };

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
