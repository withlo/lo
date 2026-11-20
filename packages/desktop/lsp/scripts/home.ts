// What `sourcekit.ts` compares of a user's home folder, before and after the language server runs:
// a listing of everything in it, every folder's contents included, with when each file last
// changed, and what differs between two of them.

import { lstat, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

/**
 * What a folder held: each path in it, relative to the folder and with `/` between names, and what
 * it was. A folder is only `folder`, since adding or removing what's in one changes its time, which
 * the entry that changed says better; anything else is when it last changed and its size.
 */
export type Listing = ReadonlyMap<string, string>;

/** What differs between two listings, each path once and in order. */
export interface Changes {
  /** Paths that weren't there: a new folder stands for what's in it. */
  readonly added: readonly string[];
  /** Files that were changed: their time or size is another. */
  readonly changed: readonly string[];
  /** Paths that are gone: a folder stands for what was in it. */
  readonly removed: readonly string[];
}

/**
 * Lists `home` and everything under it, without following a link, and without what's in
 * `ignored`, folders (absolute paths) that something other than what's checked keeps changing, such
 * as the work folder of the runner a job is on. A folder it can't read is listed without its
 * contents, and what vanishes while it lists isn't.
 */
export async function listFolder(home: string, ignored: readonly string[]): Promise<Listing> {
  const listing = new Map<string, string>();
  const skip = new Set(ignored.map((folder) => resolve(folder)));
  await visit(home);
  return listing;

  async function visit(folder: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (error) {
      if (unreadable(error)) return;
      throw error;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(folder, entry.name);
        if (skip.has(path)) return;
        const name = relative(home, path).split(sep).join('/');
        if (entry.isDirectory()) {
          listing.set(name, 'folder');
          await visit(path);
          return;
        }
        try {
          const stats = await lstat(path);
          listing.set(name, `${stats.mtimeMs} ${stats.size}`);
        } catch (error) {
          if (!unreadable(error)) throw error;
        }
      }),
    );
  }
}

/** Whether `error` says a path vanished while it was listed, or isn't this user's to read. */
function unreadable(error: unknown): boolean {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM';
}

/** What differs between `before` and `after`. */
export function compare(before: Listing, after: Listing): Changes {
  const added = [...after.keys()].filter((path) => !before.has(path));
  const removed = [...before.keys()].filter((path) => !after.has(path));
  const changed = [...after]
    .filter(([path, now]) => before.has(path) && before.get(path) !== now)
    .map(([path]) => path);
  return {
    added: outermost(added),
    changed: changed.toSorted(),
    removed: outermost(removed),
  };
}

/** `paths` without those inside another of them, sorted. */
function outermost(paths: readonly string[]): string[] {
  const all = new Set(paths);
  return paths
    .filter((path) => {
      for (let at = path.lastIndexOf('/'); at > 0; at = path.lastIndexOf('/', at - 1)) {
        if (all.has(path.slice(0, at))) return false;
      }
      return true;
    })
    .toSorted();
}

/** `changes` in words, at most `limit` paths of each kind, or `undefined` when there are none. */
export function describe(changes: Changes, limit: number): string | undefined {
  const kinds = [
    ['added', changes.added],
    ['changed', changes.changed],
    ['removed', changes.removed],
  ] as const;
  const parts = kinds
    .filter(([, paths]) => paths.length > 0)
    .map(([kind, paths]) => {
      const shown = paths.slice(0, limit).join(', ');
      const more = paths.length > limit ? ` and ${paths.length - limit} more` : '';
      return `${kind}: ${shown}${more}`;
    });
  return parts.length === 0 ? undefined : parts.join('; ');
}
