/**
 * Reading a commit from its objects, for the workflow: its header, and its tree listed as an
 * overview's commit is, every file, link, folder and submodule with its path and, for a file or a
 * link, its size. Objects are asked for by id alone, through `git cat-file`, so nothing a commit
 * holds reaches git's command line. What's read is bounded: a commit's header, not its message,
 * and a listing stops once it's past what any overview holds.
 */

import type { TreeEntry } from '@lo/artifact';

import { GitError, isId, type Objects } from './git.ts';

/** A commit's header: its tree, its parents and its author. */
export interface CommitHeader {
  id: string;
  tree: string;
  parents: string[];
  /** Its author's name and address, as the commit writes them, which may say anything. */
  author: { name: string; email: string };
}

/** A commit isn't one an overview's commit could be, and why, in words. */
export class NotOverview extends Error {
  override name = 'NotOverview';
}

/** The most of a commit read for its header: its message is never needed. */
const HEADER_LIMIT = 64 * 1024;

/** The largest tree listed. An overview's, of at most 500 short names, is far smaller. */
const TREE_LIMIT = 1024 * 1024;

const decoder = new TextDecoder('utf-8', { fatal: false });

/** The header of the commit `id`, or undefined when the repository has no such commit. */
export async function commitHeader(
  objects: Objects,
  id: string,
): Promise<CommitHeader | undefined> {
  const info = await objects.info(id);
  if (info?.type !== 'commit' || info.id !== id) return undefined;
  const bytes = await objects.read(info, HEADER_LIMIT);
  const end = indexOfBlank(bytes);
  const lines = decoder.decode(bytes.subarray(0, end === -1 ? bytes.length : end)).split('\n');
  let tree: string | undefined;
  const parents: string[] = [];
  let author: { name: string; email: string } | undefined;
  for (const line of lines) {
    const space = line.indexOf(' ');
    const key = line.slice(0, space);
    const value = line.slice(space + 1);
    if (key === 'tree' && tree === undefined && isId(value)) tree = value;
    else if (key === 'parent' && isId(value)) parents.push(value);
    else if (key === 'author' && author === undefined) {
      // `Name <address> time zone`, the name and address as anything but their brackets.
      const match = /^([^<>]*)<([^<>]*)> \d+ [+-]\d{4}$/.exec(value);
      if (match) author = { name: match[1]!.trim(), email: match[2]!.trim() };
    }
  }
  if (tree === undefined) throw new GitError(`Commit ${id} names no tree.`);
  return { id, tree, parents, author: author ?? { name: '', email: '' } };
}

/** Where the line that ends a commit's header is, or -1 when it's past what was read. */
function indexOfBlank(bytes: Uint8Array): number {
  for (let at = 0; at < bytes.length - 1; at++) {
    if (bytes[at] === 0x0a && bytes[at + 1] === 0x0a) return at;
  }
  return -1;
}

/**
 * Every entry in the tree `id` and the trees inside it, with its path from there: one past `most`
 * at most, where listing stops, so a listing past it says so. Throws {@link NotOverview} for an
 * entry of a mode no overview's commit holds, or a tree larger than one could be.
 */
export async function listTree(objects: Objects, id: string, most: number): Promise<TreeEntry[]> {
  const listed: TreeEntry[] = [];
  const pending: { id: string; path: Uint8Array }[] = [{ id, path: new Uint8Array() }];
  while (pending.length > 0 && listed.length <= most) {
    const tree = pending.shift()!;
    const info = await objects.info(tree.id);
    if (info?.type !== 'tree') throw new GitError(`The repository lacks tree ${tree.id}.`);
    if (info.size > TREE_LIMIT) {
      throw new NotOverview(
        `It holds a folder of ${info.size} bytes, more than an overview's could be.`,
      );
    }
    const data = await objects.read(info, info.size);
    for (const entry of entriesOf(data, tree.id.length / 2)) {
      if (listed.length > most) break;
      const path = tree.path.length === 0 ? entry.name : join(tree.path, entry.name);
      switch (entry.mode) {
        case '40000':
          listed.push({ path, kind: 'folder' });
          pending.push({ id: entry.id, path });
          break;
        case '160000':
          listed.push({ path, kind: 'submodule' });
          break;
        case '100644':
        case '100755':
        case '100664':
        case '120000': {
          const blob = await objects.info(entry.id);
          if (blob?.type !== 'blob') throw new GitError(`The repository lacks blob ${entry.id}.`);
          listed.push({ path, kind: entry.mode === '120000' ? 'link' : 'file', size: blob.size });
          break;
        }
        default:
          throw new NotOverview(
            `It holds an entry of mode ${JSON.stringify(entry.mode.slice(0, 8))}, which git doesn't write.`,
          );
      }
    }
  }
  return listed;
}

/** The entries of a tree object, in order: each a mode, a space, a name, a NUL and an id. */
function* entriesOf(
  data: Uint8Array,
  idLength: number,
): Generator<{ mode: string; name: Uint8Array; id: string }> {
  for (let at = 0; at < data.length;) {
    const space = data.indexOf(0x20, at);
    const nul = space === -1 ? -1 : data.indexOf(0, space + 1);
    if (space === -1 || nul === -1 || space - at > 7 || nul + 1 + idLength > data.length) {
      throw new GitError('A tree in the repository is damaged.');
    }
    yield {
      mode: Buffer.from(data.subarray(at, space)).toString('latin1'),
      name: data.slice(space + 1, nul),
      id: Buffer.from(data.subarray(nul + 1, nul + 1 + idLength)).toString('hex'),
    };
    at = nul + 1 + idLength;
  }
}

function join(folder: Uint8Array, name: Uint8Array): Uint8Array {
  const path = new Uint8Array(folder.length + 1 + name.length);
  path.set(folder);
  path[folder.length] = 0x2f;
  path.set(name, folder.length + 1);
  return path;
}
