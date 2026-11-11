/**
 * What a git Lo stopped can leave in a clone, and removing it.
 *
 * A git asked to stop removes its own lock files and temporary files; one killed can't. Lo is the
 * only process that runs git on a cache, and fetches, repacks and packing refs hold the clone's
 * lock, but a comparison writes its pins without it. So a lock left on a ref is taken to be the
 * stopped git's only while no other git of Lo's runs on the clone, and only if it was made since
 * that git started. The check and the removal run without a pause, so no git of Lo's can start
 * between them and take a lock this would then remove: Lo starts its gits from this same thread.
 */

import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { Runner } from './git.ts';

/** The files git writes beside a pack, by extension. The index comes last, so a pack without one was never finished. */
const PACK_SIDES = ['.pack', '.rev', '.mtimes', '.bitmap', '.promisor'];

/**
 * Removes the locks `locks`, paths in `gitDir`, and any lock on a loose ref under `refs/` when
 * `refLocks` says, that were made since `since`, provided no git of Lo's runs on `gitDir`. Returns
 * what it removed.
 */
export function removeLocksLeft(
  runner: Runner,
  gitDir: string,
  since: number,
  options: { locks: readonly string[]; refLocks?: boolean },
): string[] {
  if (runner.running(gitDir) > 0) return [];
  // File systems that keep whole seconds round a time down.
  const after = Math.floor(since / 1000) * 1000;
  const candidates = options.locks.map((name) => join(gitDir, name));
  if (options.refLocks) candidates.push(...refLocks(join(gitDir, 'refs')));
  const removed: string[] = [];
  for (const path of candidates) {
    const made = lstatSync(path, { throwIfNoEntry: false });
    if (made === undefined || !made.isFile() || made.mtimeMs < after) continue;
    try {
      rmSync(path, { force: true });
      removed.push(path);
    } catch {
      // Left for the next look.
    }
  }
  return removed;
}

/** The `.lock` files under `folder`, following no link. */
function refLocks(folder: string): string[] {
  const found: string[] = [];
  let listed;
  try {
    listed = readdirSync(folder, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of listed) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...refLocks(path));
    else if (entry.isFile() && entry.name.endsWith('.lock')) found.push(path);
  }
  return found;
}

/**
 * Removes the packs git was writing in `gitDir` when it stopped, `objects/pack/tmp_*` as a fetch
 * names them and `.tmp-*` as a repack does. Only fetches and repacks write them, holding the
 * clone's lock, which the caller holds, so they're no one's. Returns what it removed.
 */
export function removeTemporaryPacks(gitDir: string): string[] {
  const folder = join(gitDir, 'objects', 'pack');
  return remove(
    folder,
    entries(folder).filter((name) => name.startsWith('tmp_') || name.startsWith('.tmp-')),
  );
}

/**
 * Removes the packs in `gitDir` that git never finished: a `.pack`, or the files beside one, with
 * no `.idx`, which git renames into place last, so nothing reads them. Only fetches and repacks
 * write packs, holding the clone's lock, which the caller holds, so they're no one's. Returns what
 * it removed.
 */
export function removeUnfinishedPacks(gitDir: string): string[] {
  const folder = join(gitDir, 'objects', 'pack');
  const names = entries(folder);
  const indexed = new Set(
    names.filter((name) => name.endsWith('.idx')).map((name) => name.slice(0, -'.idx'.length)),
  );
  return remove(
    folder,
    names.filter((name) => {
      const side = PACK_SIDES.find((extension) => name.endsWith(extension));
      return (
        side !== undefined && name.startsWith('pack-') && !indexed.has(name.slice(0, -side.length))
      );
    }),
  );
}

/** The names in `folder`, or none when it can't be read. */
function entries(folder: string): string[] {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
}

/** Removes the files `names` in `folder` that are files, not folders or links' targets. Returns what it removed. */
function remove(folder: string, names: readonly string[]): string[] {
  const removed: string[] = [];
  for (const name of names) {
    const path = join(folder, name);
    try {
      if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory()) continue;
      rmSync(path, { force: true });
      removed.push(path);
    } catch {
      // Left for the next look.
    }
  }
  return removed;
}
