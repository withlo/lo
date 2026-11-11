// The file tree of a pull request's tab: the repository's files at the commit on screen, which of
// them the pull request changes and how, and finding a file by name. Main reads them from the local
// copy, or from GitHub until the copy is ready, and tells the window each time they change.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';
import { oid, tabId } from '../tab/contract.ts';

/**
 * The longest path the tree shows, in bytes. Lo never keys a map by a longer one: V8 hashes a long
 * string by its length alone, so a repository of many long paths of one length would make every
 * lookup compare them all. A longer path is left out of the tree, and counted.
 */
export const PATH_LIMIT = 1_024;

/** How many bytes `path` holds. */
export function pathBytes(path: TreePath): number {
  if (path.hex !== undefined) return path.hex.length / 2;
  let bytes = 0;
  for (let at = 0; at < path.text.length; at++) {
    const unit = path.text.charCodeAt(at);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    // A surrogate pair is four bytes, two for each half.
    else if (unit >= 0xd800 && unit <= 0xdfff) bytes += 2;
    else bytes += 3;
  }
  return bytes;
}

/**
 * A path in the repository, from its root, `/`-separated: its text as Lo shows it, and its bytes
 * in hex beside it when they aren't UTF-8, since git stores a path as bytes. The text then holds
 * U+FFFD for the bytes it can't show, so two such paths can read the same; their bytes tell them
 * apart.
 */
export const treePath = z.strictObject({
  text: z.string().min(1).max(PATH_LIMIT),
  hex: z
    .string()
    .regex(/^(?:[0-9a-f]{2})+$/)
    .max(PATH_LIMIT * 2)
    .optional(),
});
export type TreePath = z.output<typeof treePath>;

/** What an entry is: a file, a symlink, a submodule (another repository's commit) or a folder. */
export const entryKind = z.enum(['file', 'symlink', 'submodule', 'folder']);
export type EntryKind = z.output<typeof entryKind>;

/** An entry of the repository's tree. */
export const entry = z.strictObject({ path: treePath, kind: entryKind });
export type Entry = z.output<typeof entry>;

/**
 * How the pull request changes a file. `typeChanged` is a path that changed what it is, such as a
 * symlink becoming a file.
 */
export const change = z.enum(['added', 'deleted', 'modified', 'renamed', 'typeChanged']);
export type Change = z.output<typeof change>;

/**
 * A file the pull request changes: its path in the head (a deleted file's in the base), how it
 * changed, a rename's old path, and why it counts as generated, if it does: the repository marks it
 * `linguist-generated`, or it's a package manager's lockfile.
 */
export const changed = z.strictObject({
  path: treePath,
  change,
  previous: treePath.nullable(),
  generated: z.enum(['attribute', 'lockfile']).nullable(),
});
export type Changed = z.output<typeof changed>;

/**
 * The repository's files, as main has them:
 *
 * - `loading` until it has any;
 * - `whole`: every file, symlink and submodule, whose folders the paths imply;
 * - `folders`: too many to send at once, so the root's entries, folders included, and each other
 *   folder's from `tree.folder` as it's opened;
 * - `changed`: none, so the tree shows only the changed files, with why.
 */
export const listing = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('loading') }),
  z.strictObject({ kind: z.literal('whole'), entries: z.array(entry) }),
  z.strictObject({ kind: z.literal('folders'), root: z.array(entry) }),
  z.strictObject({ kind: z.literal('changed'), why: z.string() }),
]);
export type Listing = z.output<typeof listing>;

/** Where what the tree shows came from: the local copy, or GitHub's API until it's ready. */
export const source = z.enum(['local', 'github']);
export type Source = z.output<typeof source>;

/**
 * A pull request's tab's tree, sent each time it changes: the commit it's of (the head on screen),
 * the files and where they came from, and the changed files and where they came from: none until
 * they're known. `partial` when GitHub listed only some of the changed files, as it lists 3,000 at
 * most. `problem` says what couldn't be read, if anything.
 */
export const treeState = z.strictObject({
  id: tabId,
  at: oid.nullable(),
  listing,
  from: source.nullable(),
  changes: z.array(changed).nullable(),
  changesFrom: source.nullable(),
  partial: z.boolean(),
  problem: z.string().nullable(),
  /** How many files it leaves out, since their paths are longer than {@link PATH_LIMIT} bytes. */
  omitted: z.number().int().nonnegative(),
});
export type TreeState = z.output<typeof treeState>;

/** A folder's entries, as `tree.folder` replies. */
export interface Folder {
  path: TreePath;
  entries: Entry[];
}

/** A file `tree.find` found: its path, whether the pull request changes it, and where it matched. */
export interface Found {
  path: TreePath;
  changed: boolean;
  /** The places in the path's text, by UTF-16 index, that the query's characters matched. */
  matched: number[];
}

/** The most results `tree.find` gives. */
export const FIND_LIMIT = 100;

/** The most folders one `tree.folder` asks for. */
export const FOLDERS_LIMIT = 500;

export const contract = defineContract('tree', {
  requests: {
    /** What main has of a pull request's tab's tree now, which `state` then keeps up to date. */
    current: { input: z.strictObject({ id: tabId }), reply: reply<TreeState | undefined>() },
    /**
     * The entries of folders of the tree at `at`, while main sends the files folder by folder:
     * those it has, each folder once. A folder the commit doesn't have is left out.
     */
    folder: {
      input: z.strictObject({
        id: tabId,
        at: oid,
        paths: z.array(treePath).min(1).max(FOLDERS_LIMIT),
      }),
      reply: reply<Folder[]>(),
    },
    /**
     * Finds files by name in the tree on screen: the changed ones first, then the rest, as many as
     * {@link FIND_LIMIT}, the best matches first. `total` counts every match. A newer search for
     * the same tab stops this one, which fails as `superseded`.
     */
    find: {
      input: z.strictObject({ id: tabId, query: z.string().max(1000) }),
      reply: reply<{ query: string; at: string | null; found: Found[]; total: number }>(),
    },
  },
  topics: {
    /** A pull request's tab's tree, each time it changes. */
    state: treeState,
  },
});
