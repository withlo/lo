// What the file tree shows, worked out from what main sent: the repository's files as a tree, the
// changed ones marked and their unchanged neighbours dimmed, deleted files where they were, folders
// with one folder in them on one line, and closed folders' counts of changed files; or the changed
// files alone in review order. A pure function of its inputs, so it's tested without a window.

import { type ChangedFile, comparePaths, type FileKind, reviewRows } from '@lo/review';

import { withoutBidi } from '../../tab/window/shared.ts';
import {
  type Change,
  type Changed,
  type Entry,
  type EntryKind,
  PATH_LIMIT,
  pathBytes,
  type TreePath,
  type TreeState,
} from '../contract.ts';
import { folderText, keyOf, middleOut, nameOf, parentOf, placeOf } from './paths.ts';

/** Whether the account marked a changed file viewed, as GitHub says. */
export type Viewed = 'viewed' | 'unviewed' | 'dismissed';

/** How the panel lists the files: as the tree, or the changed ones in review order. */
export type Mode = 'tree' | 'review';

/** What the reader chose for a tab's tree. */
export interface Choices {
  readonly mode: Mode;
  /** Only the changed files, still as a tree. */
  readonly changedOnly: boolean;
  /** Folders opened by hand, by key: they stay open. */
  readonly opened: ReadonlySet<string>;
  /** Folders closed by hand, by key. The rest start open when they hold changes. */
  readonly closed: ReadonlySet<string>;
}

export const NO_CHOICES: Choices = {
  mode: 'tree',
  changedOnly: false,
  opened: new Set(),
  closed: new Set(),
};

/** A folder's row: one folder, or a chain of folders with one folder in each, on one line. */
export interface FolderRow {
  readonly kind: 'folder';
  /** The last folder of the chain's key: the one whose files show under the row. */
  readonly key: string;
  readonly path: TreePath;
  /** The chain's names, outermost first. */
  readonly names: readonly string[];
  readonly depth: number;
  readonly open: boolean;
  /** How many changed files it holds, however deep. */
  readonly changes: number;
  /** Open, but main hasn't sent what's in it yet. */
  readonly loading: boolean;
}

/** A file's row: a file, symlink or submodule. */
export interface FileRow {
  readonly kind: 'file';
  readonly key: string;
  readonly path: TreePath;
  readonly name: string;
  readonly depth: number;
  readonly entry: Exclude<EntryKind, 'folder'>;
  /** How the pull request changes it, or nothing for an unchanged file. */
  readonly change: Change | undefined;
  /** A rename's old name, or its old path when it moved to another folder. */
  readonly previous: string | undefined;
  /** Why it's generated, for a changed file that is. */
  readonly generated: Changed['generated'];
  /** Its viewed mark, for a changed file GitHub has one for. */
  readonly viewed: Viewed | undefined;
  /** In review order, the folder it's in, shown after its name. */
  readonly folder?: string | undefined;
  /** The whole path, when the name shows only part of it. */
  readonly title?: string | undefined;
}

/** A label over a group of review order's files. */
export interface GroupRow {
  readonly kind: 'group';
  readonly key: string;
  readonly label: string;
}

export type Row = FolderRow | FileRow | GroupRow;

/** What the panel shows, and what the keys need of it. */
export interface Model {
  readonly rows: readonly Row[];
  /** The changed files, by key, in the order the panel shows them: the order the diff follows. */
  readonly order: readonly string[];
  /** Every folder the tree knows of, by key, for opening or closing them all. */
  readonly folders: readonly string[];
  /** Folders open with nothing yet from main, which the window asks for. */
  readonly wanted: readonly TreePath[];
  /** Unchanged files left out, since their paths are longer than `PATH_LIMIT` bytes. */
  readonly omitted: number;
}

/** Whether `path` is short enough to key a map by: no longer than `PATH_LIMIT` bytes. */
function short(path: TreePath): boolean {
  return pathBytes(path) <= PATH_LIMIT;
}

/**
 * Where a changed file goes in the tree, and what it's called there: in its folder, by its name; or
 * for a path too long to key a map by, in the deepest of its folders short enough, named by the
 * rest of its path, shortened in the middle.
 */
function placed(path: TreePath): Place {
  let place = places.get(path);
  if (!place) {
    place = short(path)
      ? { folder: parentOf(path), name: nameOf(path), long: false }
      : { ...placeOf(path), long: true };
    places.set(path, place);
  }
  return place;
}

/** Where a changed file goes in the tree. */
interface Place {
  readonly folder: TreePath | undefined;
  readonly name: string;
  readonly long: boolean;
}

/** Each path's place, worked out once: a path is the same object from one build to the next. */
const places = new WeakMap<TreePath, Place>();

/** A changed file's path as review order reads it: the place it shows at, short in any case. */
function readAs(path: TreePath): string {
  const { folder, name } = placed(path);
  return folder === undefined ? name : `${folder.text}/${name}`;
}

/** A folder or file of the tree, as it's built. */
interface Node {
  readonly key: string;
  readonly path: TreePath;
  readonly name: string;
  readonly kind: EntryKind;
  readonly parent: Node | undefined;
  readonly children: Map<string, Node>;
  /** For a folder: whether main sent everything in it. */
  listed: boolean;
  change: Changed | undefined;
  /** How many changed files it holds, however deep, or 1 for a changed file. */
  changes: number;
  /** Whether its name is only the end of a path too long to show whole. */
  long: boolean;
}

function node(
  path: TreePath | undefined,
  kind: EntryKind,
  listed: boolean,
  parent?: Node,
  name?: string,
): Node {
  return {
    key: path === undefined ? '' : keyOf(path),
    path: path ?? { text: '' },
    name: name ?? (path === undefined ? '' : nameOf(path)),
    long: name !== undefined,
    kind,
    parent,
    children: new Map(),
    listed,
    change: undefined,
    changes: 0,
  };
}

/**
 * The tree of what main sent: every file listed, and each folder's entries main sent folder by
 * folder, with the changed files added where they are, deleted ones included.
 */
function build(
  state: TreeState,
  changes: readonly Changed[],
  folders: ReadonlyMap<string, readonly Entry[]>,
): { root: Node; omitted: number } {
  const { listing } = state;
  let omitted = 0;
  const whole = listing.kind === 'whole';
  const root = node(undefined, 'folder', whole || listing.kind === 'folders');
  const add = (path: TreePath, kind: EntryKind): Node => {
    const parentPath = parentOf(path);
    const parent = parentPath === undefined ? root : add(parentPath, 'folder');
    const key = keyOf(path);
    let found = parent.children.get(key);
    if (!found) {
      found = node(path, kind, whole || folders.has(key), parent);
      parent.children.set(key, found);
    }
    return found;
  };
  const list = (entry: Entry) => {
    if (short(entry.path)) add(entry.path, entry.kind);
    else omitted++;
  };
  if (listing.kind === 'whole') {
    for (const entry of listing.entries) list(entry);
  } else if (listing.kind === 'folders') {
    for (const entry of listing.root) list(entry);
    for (const entries of folders.values()) for (const entry of entries) list(entry);
  }
  for (const change of changes) {
    let file: Node;
    const place = placed(change.path);
    if (place.long) {
      // Every change shows, however long its path: by its digest, in a folder short enough.
      const parent = place.folder === undefined ? root : add(place.folder, 'folder');
      const key = keyOf(change.path);
      file = parent.children.get(key) ?? node(change.path, 'file', false, parent, place.name);
      parent.children.set(key, file);
    } else {
      file = add(change.path, 'file');
    }
    // The same path listed twice counts once.
    if (file.change) continue;
    file.change = change;
    file.changes = 1;
    for (let folder = file.parent; folder !== undefined; folder = folder.parent) folder.changes++;
  }
  // The listing's long paths the pull request changes show, so aren't left out.
  const shownLong = changes.filter((change) => change.change !== 'deleted' && !short(change.path));
  return { root, omitted: Math.max(0, omitted - shownLong.length) };
}

/** Folders first, then files, each by name in git's order. */
function byName(a: Node, b: Node): number {
  const folders = Number(b.kind === 'folder') - Number(a.kind === 'folder');
  return folders || comparePaths(a.name, b.name);
}

/** A rename's old path as its row shows it: the old name in the same folder, else the old path. */
function previousOf(change: Changed): string | undefined {
  const { previous } = change;
  if (previous === null) return undefined;
  if (!short(previous)) return middleOut(withoutBidi(previous.text));
  return withoutBidi(
    short(change.path) && folderText(previous) === folderText(change.path)
      ? nameOf(previous)
      : previous.text,
  );
}

/** The viewed mark of `change`, from GitHub's marks by path: a rename's by its old path too. */
function viewedOf(
  change: Changed | undefined,
  viewed: ReadonlyMap<string, Viewed>,
): Viewed | undefined {
  if (!change) return undefined;
  // GitHub's marks are kept only for paths short enough to key a map by.
  const mark = short(change.path) ? viewed.get(change.path.text) : undefined;
  const { previous } = change;
  return mark ?? (previous === null || !short(previous) ? undefined : viewed.get(previous.text));
}

function fileRow(
  file: Node,
  depth: number,
  viewed: ReadonlyMap<string, Viewed>,
  folder?: string,
): FileRow {
  const { change } = file;
  return {
    kind: 'file',
    key: file.key,
    path: file.path,
    name: withoutBidi(file.name),
    depth,
    entry: file.kind === 'folder' ? 'file' : file.kind,
    change: change?.change,
    previous: change ? previousOf(change) : undefined,
    generated: change?.generated ?? null,
    viewed: viewedOf(change, viewed),
    ...(folder === undefined ? {} : { folder }),
    ...(file.long ? { title: file.path.text } : {}),
  };
}

/** The group label of each kind of file in review order. */
const GROUPS: Record<FileKind, string> = {
  source: 'Source and tests',
  test: 'Source and tests',
  config: 'Config',
  generated: 'Generated',
};

/** The changed files in review order, under their groups' labels. */
function reviewModel(
  changes: readonly Changed[],
  viewed: ReadonlyMap<string, Viewed>,
): Pick<Model, 'rows' | 'order'> {
  const files: ChangedFile[] = changes.map((change) => ({
    // A path too long to key a map by is read as the short place it shows at.
    path: readAs(change.path),
    previousPath: change.previous === null ? undefined : readAs(change.previous),
    additions: 0,
    deletions: 0,
    binary: false,
    // Main has worked out whether it's generated.
    linguistGenerated: change.generated !== null,
  }));
  const rows: Row[] = [];
  const order: string[] = [];
  let group: string | undefined;
  for (const { index, kind, follows } of reviewRows(files)) {
    const change = changes[index];
    if (!change) continue;
    const label = GROUPS[kind];
    if (label !== group) {
      rows.push({ kind: 'group', key: `\0group:${label}`, label });
      group = label;
    }
    const place = placed(change.path);
    const file = node(change.path, 'file', false, undefined, place.long ? place.name : undefined);
    file.change = change;
    rows.push(
      fileRow(file, follows === undefined ? 0 : 1, viewed, withoutBidi(place.folder?.text ?? '')),
    );
    order.push(file.key);
  }
  return { rows, order };
}

/**
 * What the panel shows of `state`, with each folder's entries main sent so far, GitHub's viewed
 * marks by path, and what the reader chose.
 */
export function model(
  state: TreeState,
  folders: ReadonlyMap<string, readonly Entry[]>,
  viewed: ReadonlyMap<string, Viewed>,
  choices: Choices,
): Model {
  const changes = state.changes ?? [];
  const { root, omitted } = build(state, changes, folders);
  const allFolders: string[] = [];
  const collect = (folder: Node) => {
    for (const child of folder.children.values()) {
      if (child.kind !== 'folder') continue;
      allFolders.push(child.key);
      collect(child);
    }
  };
  collect(root);
  if (choices.mode === 'review') {
    return {
      ...reviewModel(changes, viewed),
      folders: allFolders,
      wanted: [],
      omitted,
    };
  }
  // Only the changed files show while the reader asks, or main has nothing else.
  const changedOnly = choices.changedOnly || state.listing.kind === 'changed';
  const visible = (folder: Node): Node[] =>
    [...folder.children.values()]
      .filter((child) => !changedOnly || child.changes > 0)
      .toSorted(byName);
  /**
   * Whether everything in `folder` that shows is known, so it can join a chain: only folder by
   * folder can a folder's entries still be on their way.
   */
  const known = (folder: Node) => folder.listed || changedOnly || state.listing.kind !== 'folders';
  const isOpen = (folder: Node) =>
    choices.opened.has(folder.key) || (!choices.closed.has(folder.key) && folder.changes > 0);
  const rows: Row[] = [];
  const wanted: TreePath[] = [];
  const walk = (folder: Node, depth: number) => {
    for (const child of visible(folder)) {
      if (child.kind !== 'folder') {
        rows.push(fileRow(child, depth, viewed));
        continue;
      }
      const chain = [child];
      let last = child;
      for (;;) {
        if (!known(last)) break;
        const inside = visible(last);
        const [only] = inside;
        if (inside.length !== 1 || only?.kind !== 'folder') break;
        chain.push(only);
        last = only;
      }
      const open = isOpen(last);
      const loading = open && !known(last);
      rows.push({
        kind: 'folder',
        key: last.key,
        path: last.path,
        names: chain.map((link) => withoutBidi(link.name)),
        depth,
        open,
        changes: last.changes,
        loading,
      });
      if (loading) wanted.push(last.path);
      if (open) walk(last, depth + 1);
    }
  };
  walk(root, 0);
  return {
    rows,
    order: panelOrder(changes, 'tree'),
    folders: allFolders,
    wanted,
    omitted,
  };
}

/**
 * The changed files, by key, in the order the panel lists them, which is the order the diff shows
 * them in: the tree's (each folder's folders, then its files, by name) or review order.
 */
export function panelOrder(changes: readonly Changed[], mode: Mode): readonly string[] {
  if (mode === 'review') {
    return reviewModel(changes, new Map()).order;
  }
  // Each by the place it shows at, which for a path too long to key a map by is short.
  const split = changes.map((change) => {
    const { folder, name } = placed(change.path);
    return { key: keyOf(change.path), names: [...(folder?.text.split('/') ?? []), name] };
  });
  return split
    .toSorted((a, b) => {
      const length = Math.min(a.names.length, b.names.length);
      for (let at = 0; at < length; at++) {
        const x = a.names[at] ?? '';
        const y = b.names[at] ?? '';
        if (x === y) continue;
        // A folder before a file, at the first name they differ in.
        const folders = Number(at < b.names.length - 1) - Number(at < a.names.length - 1);
        return folders || comparePaths(x, y);
      }
      return a.names.length - b.names.length;
    })
    .map(({ key }) => key);
}

/** The row `key` names, and where it is. */
export function rowAt(rows: readonly Row[], key: string | undefined): number {
  return key === undefined ? -1 : rows.findIndex((row) => row.key === key);
}

/** The row of the folder `index`'s row is in, if it shows. */
export function parentRow(rows: readonly Row[], index: number): number {
  const row = rows[index];
  if (!row || row.kind === 'group') return -1;
  for (let at = index - 1; at >= 0; at--) {
    const above = rows[at];
    if (above?.kind === 'folder' && above.depth < row.depth) return at;
  }
  return -1;
}

/**
 * The keys of the folders holding `path`, outermost first, as the tree has them: what to open to
 * show it. A chain's folders are all named, so whichever is the chain's last opens.
 */
export function foldersOf(path: TreePath): string[] {
  const keys: string[] = [];
  for (let parent = placed(path).folder; parent !== undefined; parent = parentOf(parent)) {
    keys.unshift(keyOf(parent));
  }
  return keys;
}
