/**
 * Keeping the cache in bounds: removing what nobody used for a while, past a cap on its size the
 * least recently used checkouts and clones, and repacking busy clones. Nothing follows a symlink,
 * so nothing outside the cache is ever measured or removed, and a clone that's open or being
 * written to is never taken.
 *
 * Maintenance that can take minutes, repacking and collecting what comparisons replayed, holds
 * the clone's lock giving way: anyone who then waits for the clone gives it a few seconds to
 * finish, then stops it, and it's done again later. Closing the cache stops it at once. Repacks
 * are geometric, rolling the small packs that fetches and downloads add into one and leaving the
 * big ones be, so they usually finish in seconds: git 2.53 and later do it themselves, and for
 * older gits Lo does it with `git pack-objects --stdin-packs`. A clone whose packs piled up anyway
 * is repacked whole only while nobody has it open, loosening what nothing reaches rather than
 * dropping it, for `prune` to remove once nobody has the clone open.
 */

import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import { REPLAYS } from './compare.ts';
import type { Runner } from './git.ts';
import { removeLocksLeft, removeTemporaryPacks, removeUnfinishedPacks } from './leftovers.ts';
import type { CloneLock, Release } from './lock.ts';
import { checkName } from './refs.ts';
import { LAST_USED_FILE } from './stamp.ts';
import { compareVersions, type GitVersion } from './version.ts';

const DAY = 24 * 60 * 60 * 1000;

/** How long a clone may go unused before cleanup removes it, with its checkouts. */
export const UNUSED_FOR = 30 * DAY;

/** How long a checkout may go unused before cleanup removes it: each is a whole head's files. */
export const CHECKOUTS_UNUSED_FOR = 14 * DAY;

/**
 * How long what a crash or a stopped fetch left, a temporary clone, a trace or a partial pack,
 * stays: far longer than making a clone or a fetch takes.
 */
export const TEMPORARIES_KEPT_FOR = DAY;

/** The size the cache is kept under unless Settings says otherwise, in bytes. */
export const DEFAULT_CAP = 10 * 1024 * 1024 * 1024;

/**
 * How many packs a clone may have before a geometric repack rolls its small ones together: each
 * fetch and download adds one, and every lookup searches them all.
 */
export const GEOMETRIC_LIMIT = 8;

/**
 * How many packs a clone may have before it's repacked whole, as git's own `gc.autoPackLimit`,
 * while nobody has it open.
 */
export const PACK_LIMIT = 50;

/** How long a repack may take: far longer than a read, since a big clone's takes minutes. */
export const REPACK_LIMIT = 30 * 60 * 1000;

/** When maintenance runs besides at launch, and how it gives way. */
export interface MaintenanceTimes {
  /** How long a clone's lock goes unheld before the clone is looked at again, in milliseconds. */
  readonly idleFor: number;
  /** How long maintenance has to finish once someone waits for the clone, in milliseconds. */
  readonly grace: number;
  /** How many times maintenance starts on a clone once its lock is idle, each launch. */
  readonly attempts: number;
}

/** The times the app uses. */
export const DEFAULT_MAINTENANCE: MaintenanceTimes = {
  // Past a burst of fetches and downloads.
  idleFor: 60 * 1000,
  // A geometric repack of what a few fetches added takes a second or two.
  grace: 3 * 1000,
  attempts: 3,
};

/**
 * The first git that repacks a partial clone's promisor packs geometrically, as its release notes
 * say ("git repack --geometric" did not work with promisor packs, which has been corrected). Older
 * ones die ("cannot use internal rev list with --stdin-packs").
 */
const GEOMETRIC_WITH_PROMISORS: GitVersion = { major: 2, minor: 53, patch: 0 };

/** A clone in the cache, by its folders' names, which are lowercase. */
export interface CloneName {
  readonly owner: string;
  readonly name: string;
}

/** What cleanup needs of the cache. */
export interface CleanupHost {
  readonly root: string;
  readonly runner: Runner;
  repoFolder(owner: string, name: string): string;
  checkoutsFolder(owner: string, name: string): string;
  cloneLock(owner: string, name: string): CloneLock;
  trash(path: string): Promise<boolean>;
  note(line: string): void;
  /** A new path in the cache's `tmp/`, ending in `extension`. */
  temporaryPath(extension: string): string;
  readonly maintenance: MaintenanceTimes;
  /** Aborts as the cache closes, which stops maintenance at once and starts no more. */
  readonly closing: AbortSignal;
}

/** Why maintenance stopped: someone waits for the clone, to do `waiter`. */
class GaveWay extends Error {
  readonly waiter: string;

  constructor(waiter: string) {
    super(`stopped for ${waiter}`);
    this.waiter = waiter;
  }
}

/**
 * Holds `clone`'s lock to do `what`, maintenance that can stop part way and be done again later,
 * if nobody holds it, and with `remove`, if nobody has it open. Once anyone waits for the clone,
 * the maintenance has {@link MaintenanceTimes.grace} to finish; then `signal` aborts, with a
 * {@link GaveWay} as its reason, which stops its gits. `users` is how many have the clone open.
 */
function maintain(
  host: CleanupHost,
  clone: CloneName,
  what: string,
  remove = false,
): { release: Release; signal: AbortSignal; users: number } | undefined {
  if (host.closing.aborted) return undefined;
  const controller = new AbortController();
  const lock = host.cloneLock(clone.owner, clone.name);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveWay = (waiter: string) => {
    timer = setTimeout(() => controller.abort(new GaveWay(waiter)), host.maintenance.grace);
  };
  const release = remove ? lock.tryRemove(what, giveWay) : lock.tryAcquire(what, giveWay);
  if (release === undefined) return undefined;
  // Closing the cache stops it at once.
  const close = () => controller.abort(new GaveWay('closing the cache'));
  host.closing.addEventListener('abort', close, { once: true });
  return {
    release: () => {
      clearTimeout(timer);
      host.closing.removeEventListener('abort', close);
      release();
    },
    signal: controller.signal,
    users: lock.users,
  };
}

/**
 * Whether someone waiting for the clone stopped the maintenance holding `signal`, which was doing
 * `stopped`, and if so, notes it.
 */
function gaveWay(host: CleanupHost, signal: AbortSignal, stopped: string): boolean {
  const reason: unknown = signal.reason;
  if (!(reason instanceof GaveWay)) return false;
  host.note(`stopped ${stopped} for ${reason.waiter}, to do again later`);
  return true;
}

/**
 * Removes what a maintenance git stopped part way left in `gitDir`, having started at `since`:
 * the ref locks it held, those of packing refs included, and the packs it was writing or hadn't
 * finished. The clone's lock is held.
 */
function removeLeftByMaintenance(host: CleanupHost, gitDir: string, since: number): void {
  const removed = [
    ...removeLocksLeft(host.runner, gitDir, since, {
      locks: ['packed-refs.lock', join('reftable', 'tables.list.lock')],
      refLocks: true,
    }),
    ...removeTemporaryPacks(gitDir),
    ...removeUnfinishedPacks(gitDir),
  ];
  if (removed.length > 0) host.note(`removed what a stopped git left: ${removed.join(', ')}`);
}

/** Whether `path` is a folder itself, not a link to one. */
async function isFolder(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => undefined))?.isDirectory() ?? false;
}

/** The folders in `folder`, links left out, or none when it isn't one. */
async function folders(folder: string): Promise<string[]> {
  if (!(await isFolder(folder))) return [];
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/** Whether `name` is safe as an owner's or a repository's folder name. */
function validName(what: string, name: string): boolean {
  try {
    checkName(what, name);
    return true;
  } catch {
    return false;
  }
}

/** The bytes `path` takes on disk: its blocks, and its folders' contents, following no link. */
export async function diskUsage(path: string): Promise<number> {
  const found = await lstat(path).catch(() => undefined);
  if (found === undefined) return 0;
  let total = found.blocks * 512;
  if (found.isDirectory()) {
    for (const name of await readdir(path).catch(() => []))
      total += await diskUsage(join(path, name));
  }
  return total;
}

/** Every clone in the cache, by owner and name. */
export async function clones(host: CleanupHost): Promise<CloneName[]> {
  const repos = join(host.root, 'repos', 'github.com');
  const found: CloneName[] = [];
  for (const owner of await folders(repos)) {
    if (!validName('repository owner', owner)) continue;
    for (const folder of await folders(join(repos, owner))) {
      const name = folder.endsWith('.git') ? folder.slice(0, -4) : '';
      if (validName('repository name', name)) found.push({ owner, name });
    }
  }
  return found.toSorted((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`));
}

/**
 * When the clone, or the checkout, whose git folder is `gitDir` was last used: its stamp, or its
 * folder's own time without one.
 */
export async function lastUsed(gitDir: string): Promise<number | undefined> {
  const stamp = await readFile(join(gitDir, LAST_USED_FILE), 'utf8').catch(() => undefined);
  const seconds = stamp === undefined ? Number.NaN : Number(stamp.trim());
  if (Number.isSafeInteger(seconds)) return seconds * 1000;
  return (await lstat(gitDir).catch(() => undefined))?.mtimeMs;
}

/**
 * The git folder of the checkout at `folder`, when it's one of the clone at `clone`'s: judged from
 * its `.git` file, a plain file naming a folder in the clone's `worktrees`, never by running git
 * there, which could find some other repository.
 */
export async function checkoutGitDir(clone: string, folder: string): Promise<string | undefined> {
  if (!(await isFolder(folder))) return undefined;
  const dotGit = join(folder, '.git');
  if (!(await lstat(dotGit).catch(() => undefined))?.isFile()) return undefined;
  const text = await readFile(dotGit, 'utf8').catch(() => '');
  if (!text.startsWith('gitdir:')) return undefined;
  const gitDir = await realpath(text.slice('gitdir:'.length).trim()).catch(() => undefined);
  const worktrees = await realpath(join(clone, 'worktrees')).catch(() => undefined);
  if (gitDir === undefined || worktrees === undefined) return undefined;
  return join(gitDir, '..') === worktrees ? gitDir : undefined;
}

/** A clone's checkouts: `pull-<n>/<head>`, with when each was last used. */
async function checkoutsOf(host: CleanupHost, clone: CloneName) {
  const root = host.checkoutsFolder(clone.owner, clone.name);
  const folder = host.repoFolder(clone.owner, clone.name);
  const found: { path: string; used: number | undefined }[] = [];
  for (const pull of await folders(root)) {
    if (!/^pull-\d+$/.test(pull)) continue;
    for (const head of await folders(join(root, pull))) {
      if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) continue;
      const path = join(root, pull, head);
      const gitDir = await checkoutGitDir(folder, path);
      const used = gitDir === undefined ? undefined : await lastUsed(gitDir);
      found.push({ path, used: used ?? (await lstat(path).catch(() => undefined))?.mtimeMs });
    }
  }
  return found;
}

/** Removes a clone and its checkouts, each moved aside first. Its lock is held. */
async function removeClone(host: CleanupHost, clone: CloneName): Promise<void> {
  await host.trash(host.checkoutsFolder(clone.owner, clone.name));
  await host.trash(host.repoFolder(clone.owner, clone.name));
  for (const folder of ['repos', 'checkouts']) {
    await rmdir(join(host.root, folder, 'github.com', clone.owner)).catch(() => undefined);
  }
}

/**
 * Removes the clones nobody opened, fetched into or checked out from for {@link UNUSED_FOR},
 * with their checkouts, and checkouts left without a clone. Of the clones kept, it removes the
 * checkouts unused for {@link CHECKOUTS_UNUSED_FOR}, the partial packs left a day or more ago and,
 * from those nobody has open, the trees comparisons replayed; and from the cache's `tmp/`,
 * whatever was left there a day or more ago. A clone open or being written to is left alone.
 * Returns the `owner/name` of each clone removed.
 */
export async function removeUnused(host: CleanupHost, now: number): Promise<string[]> {
  const removed: string[] = [];
  for (const clone of await clones(host)) {
    const folder = host.repoFolder(clone.owner, clone.name);
    const used = await lastUsed(folder);
    if (used !== undefined && now - used <= UNUSED_FOR) {
      await removeUnusedCheckouts(host, clone, now);
      await removeOldPacks(host, clone, now);
      await collectReplays(host, clone);
      continue;
    }
    const release = host.cloneLock(clone.owner, clone.name).tryRemove('removing it, unused');
    if (release === undefined) continue;
    try {
      await removeClone(host, clone);
      removed.push(`${clone.owner}/${clone.name}`);
    } finally {
      release();
    }
  }
  await removeOrphanedCheckouts(host);
  await removeOldTemporaries(host, now);
  if (removed.length > 0) host.note(`removed unused clones: ${removed.join(', ')}`);
  return removed;
}

/** Removes the checkouts of `clone` unused for {@link CHECKOUTS_UNUSED_FOR}, unless it's in use. */
async function removeUnusedCheckouts(host: CleanupHost, clone: CloneName, now: number) {
  const stale = (await checkoutsOf(host, clone)).filter(
    ({ used }) => used === undefined || now - used > CHECKOUTS_UNUSED_FOR,
  );
  if (stale.length === 0) return;
  const release = host.cloneLock(clone.owner, clone.name).tryRemove('removing unused checkouts');
  if (release === undefined) return;
  try {
    await removeCheckouts(host, clone, stale);
    host.note(`removed ${stale.length} unused checkouts of ${clone.owner}/${clone.name}`);
  } finally {
    release();
  }
}

/** Removes `checkouts` of `clone`, and has the clone forget them. Its lock is held. */
async function removeCheckouts(
  host: CleanupHost,
  clone: CloneName,
  checkouts: readonly { path: string }[],
): Promise<void> {
  for (const { path } of checkouts) {
    await host.trash(path);
    await rmdir(join(path, '..')).catch(() => undefined);
  }
  await host.runner
    .command({ gitDir: host.repoFolder(clone.owner, clone.name) })
    .arg('worktree', 'prune')
    .run();
}

/**
 * Removes the partial packs a stopped or crashed fetch left in `clone` a day or more ago, and the
 * packs git never finished, which it renamed into place but for their index. Only fetches and
 * repacks write them, with the clone's lock, which this takes.
 */
async function removeOldPacks(host: CleanupHost, clone: CloneName, now: number) {
  const packs = join(host.repoFolder(clone.owner, clone.name), 'objects', 'pack');
  if (!(await isFolder(packs))) return;
  const release = host.cloneLock(clone.owner, clone.name).tryAcquire('removing partial packs');
  if (release === undefined) return;
  try {
    for (const name of await readdir(packs).catch(() => [])) {
      if (!name.startsWith('tmp_') && !name.startsWith('.tmp-')) continue;
      const path = join(packs, name);
      const written = (await lstat(path).catch(() => undefined))?.mtimeMs;
      if (written !== undefined && now - written > TEMPORARIES_KEPT_FOR) {
        await rm(path, { force: true }).catch((error: unknown) => {
          host.note(`can't remove ${path}: ${String(error)}`);
        });
      }
    }
    const unfinished = removeUnfinishedPacks(host.repoFolder(clone.owner, clone.name));
    if (unfinished.length > 0) host.note(`removed unfinished packs: ${unfinished.join(', ')}`);
  } finally {
    release();
  }
}

/**
 * Removes the trees comparisons replayed in `clone`, and the files merged into them, which exist
 * only in the clone, as loose objects: with no repository open on it, no comparison is shown
 * from it, so neither their pins nor anything else needs them. What the clone fetched is all in
 * packs, which this leaves alone.
 */
export async function collectReplays(host: CleanupHost, clone: CloneName): Promise<void> {
  if (!(await hasLooseObjects(host.repoFolder(clone.owner, clone.name)))) return;
  const held = maintain(host, clone, 'removing replayed trees', true);
  if (held === undefined) return;
  const { signal } = held;
  const gitDir = host.repoFolder(clone.owner, clone.name);
  const started = Date.now();
  try {
    const deletes = await host.runner
      .command({ gitDir })
      .arg('for-each-ref', '--format=delete %(refname)', REPLAYS)
      .run(undefined, { signal });
    if (deletes.length > 0) {
      await host.runner.command({ gitDir }).arg('update-ref', '--stdin').run(deletes, { signal });
    }
    await host.runner
      .command({ gitDir })
      .arg('prune', '--expire=now')
      .run(undefined, { timeout: REPACK_LIMIT, signal });
  } catch (error) {
    const what = `removing ${clone.owner}/${clone.name}'s replayed trees`;
    if (gaveWay(host, signal, what)) removeLeftByMaintenance(host, gitDir, started);
    else host.note(`can't remove ${clone.owner}/${clone.name}'s replayed trees: ${String(error)}`);
  } finally {
    held.release();
  }
}

/** Whether the clone at `gitDir` holds any loose object, in a folder such as `objects/ab`. */
export async function hasLooseObjects(gitDir: string): Promise<boolean> {
  const objects = join(gitDir, 'objects');
  for (const name of await folders(objects)) {
    if (
      /^[0-9a-f]{2}$/.test(name) &&
      (await readdir(join(objects, name)).catch(() => [])).length > 0
    ) {
      return true;
    }
  }
  return false;
}

/** Removes the checkouts of clones that are gone. */
async function removeOrphanedCheckouts(host: CleanupHost): Promise<void> {
  const root = join(host.root, 'checkouts', 'github.com');
  for (const owner of await folders(root)) {
    if (!validName('repository owner', owner)) continue;
    for (const name of await folders(join(root, owner))) {
      if (!validName('repository name', name)) continue;
      if (await lstat(host.repoFolder(owner, name)).catch(() => undefined)) continue;
      const release = host.cloneLock(owner, name).tryAcquire('removing orphaned checkouts');
      if (release === undefined) continue;
      try {
        await host.trash(join(root, owner, name));
      } finally {
        release();
      }
    }
    await rmdir(join(root, owner)).catch(() => undefined);
  }
}

/**
 * Removes what was left in the cache's `tmp/` a day or more ago: clones a crash left half made,
 * trash, and fetches' traces. One that can't be removed is noted and left.
 */
async function removeOldTemporaries(host: CleanupHost, now: number): Promise<void> {
  const tmp = join(host.root, 'tmp');
  if (!(await isFolder(tmp))) return;
  for (const name of await readdir(tmp).catch(() => [])) {
    const path = join(tmp, name);
    const found = await lstat(path).catch(() => undefined);
    if (found === undefined || now - found.mtimeMs <= TEMPORARIES_KEPT_FOR) continue;
    // A link is removed itself, never what it points at.
    await rm(path, { recursive: true, force: true }).catch((error: unknown) => {
      host.note(`can't remove ${path}: ${String(error)}`);
    });
  }
}

/**
 * Removes every clone and checkout that isn't open or being written to, for Settings' "Clear
 * cache", each moved aside before it's deleted. Clones being made, in `tmp/`, are left alone.
 * Returns the `owner/name` of each clone it had to leave.
 */
export async function clear(host: CleanupHost): Promise<string[]> {
  const left: string[] = [];
  for (const clone of await clones(host)) {
    const release = host.cloneLock(clone.owner, clone.name).tryRemove('clearing the cache');
    if (release === undefined) {
      left.push(`${clone.owner}/${clone.name}`);
      continue;
    }
    try {
      await removeClone(host, clone);
    } finally {
      release();
    }
  }
  await removeOrphanedCheckouts(host);
  return left;
}

/**
 * Keeps the cache under `cap` bytes, removing only as much as gets it there: first the checkouts
 * of clones nobody has open, least recently used first, then those clones themselves, least
 * recently used first, each only while the cache is still over. A clone that's open or being
 * written to is never touched, nor are its checkouts, and the most recently used clone always
 * stays, so the cache is never emptied: a clone over the cap alone loses its checkouts and stays.
 * Returns the `owner/name` of each clone removed.
 */
export async function keepUnder(host: CleanupHost, cap: number): Promise<string[]> {
  let total = await diskUsage(host.root);
  if (total <= cap) return [];
  const byUse = (
    await Promise.all(
      (await clones(host)).map(async (clone) => ({
        clone,
        used: (await lastUsed(host.repoFolder(clone.owner, clone.name))) ?? 0,
      })),
    )
  ).toSorted((a, b) => a.used - b.used);
  const newest = byUse.at(-1)?.clone;
  const checkouts = (
    await Promise.all(
      byUse.map(async ({ clone }) =>
        (await checkoutsOf(host, clone)).map((checkout) => ({ clone, ...checkout })),
      ),
    )
  )
    .flat()
    .toSorted((a, b) => (a.used ?? 0) - (b.used ?? 0));
  let trimmed = 0;
  for (const checkout of checkouts) {
    if (total <= cap) break;
    const { owner, name } = checkout.clone;
    const release = host.cloneLock(owner, name).tryRemove('keeping the cache small');
    if (release === undefined) continue;
    try {
      const size = await diskUsage(checkout.path);
      await removeCheckouts(host, checkout.clone, [checkout]);
      total -= size;
      trimmed += 1;
    } finally {
      release();
    }
  }
  const removed: string[] = [];
  for (const { clone } of byUse) {
    if (total <= cap) break;
    if (clone === newest) continue;
    const release = host.cloneLock(clone.owner, clone.name).tryRemove('keeping the cache small');
    if (release === undefined) continue;
    try {
      const size =
        (await diskUsage(host.repoFolder(clone.owner, clone.name))) +
        (await diskUsage(host.checkoutsFolder(clone.owner, clone.name)));
      await removeClone(host, clone);
      total -= size;
      removed.push(`${clone.owner}/${clone.name}`);
    } finally {
      release();
    }
  }
  if (trimmed > 0) host.note(`removed ${trimmed} checkouts past the cache's cap`);
  if (removed.length > 0) {
    host.note(`removed the least recently used clones past the cache's cap: ${removed.join(', ')}`);
  }
  if (total > cap) host.note(`the cache is still over its cap of ${cap} bytes, at ${total}`);
  return removed;
}

/**
 * How a clone is repacked: its small promisor packs, `roll`, rolled into one, leaving the big
 * ones, `keep`, be, as git's geometric repack does; or everything into one.
 */
export type RepackPlan =
  | {
      readonly kind: 'geometric';
      readonly roll: readonly string[];
      readonly keep: readonly string[];
    }
  | { readonly kind: 'full' };

/**
 * How `git repack` runs for `plan`. A whole repack loosens what nothing reaches any more rather
 * than dropping it (`-A`): a comparison may have just pinned a tree it found already there, which
 * only `prune` removes once nobody has the clone open. A geometric one keeps everything in the
 * packs it rolls.
 */
export function repackArguments(plan: RepackPlan): string[] {
  // Bitmaps need every object, which a partial clone doesn't have.
  const base = ['repack', '-d', '-q', '--no-write-bitmap-index'];
  return plan.kind === 'full' ? [...base, '-A'] : [...base, '--geometric=2'];
}

/** Whether git `version` repacks a partial clone geometrically itself. */
export function repacksGeometrically(version: GitVersion): boolean {
  return compareVersions(version, GEOMETRIC_WITH_PROMISORS) >= 0;
}

/**
 * Where a geometric repack with a factor of 2 splits packs holding `objects` objects each, fewest
 * first, as git works it out: those before the split roll into one, and the rest, each at least
 * twice the size of everything smaller, stay.
 */
export function geometricSplit(objects: readonly number[]): number {
  if (objects.length === 0) return 0;
  let split = objects.length - 1;
  for (; split > 0; split--) {
    if ((objects[split] ?? 0) < 2 * (objects[split - 1] ?? 0)) break;
  }
  if (split > 0) split += 1;
  let rolled = objects.slice(0, split).reduce((sum, count) => sum + count, 0);
  while (split < objects.length && (objects[split] ?? 0) < 2 * rolled) {
    rolled += objects[split] ?? 0;
    split += 1;
  }
  return split;
}

/** A finished pack of a clone: `pack-<hash>.pack`, how many objects it holds, and whether it's a promisor pack. */
interface Pack {
  readonly name: string;
  readonly objects: number;
  readonly promisor: boolean;
  /** Whether it has a `.keep`, which tells git to leave it be: no repack rewrites it. */
  readonly kept: boolean;
}

/** The finished packs of the clone at `folder`, fewest objects first. */
async function packsOf(folder: string): Promise<Pack[]> {
  const pack = join(folder, 'objects', 'pack');
  const names: string[] = await readdir(pack).catch(() => []);
  const found: Pack[] = [];
  for (const name of names) {
    if (!name.startsWith('pack-') || !name.endsWith('.pack')) continue;
    const base = name.slice(0, -'.pack'.length);
    const objects = await indexedObjects(join(pack, `${base}.idx`));
    if (objects !== undefined) {
      found.push({
        name,
        objects,
        promisor: names.includes(`${base}.promisor`),
        kept: names.includes(`${base}.keep`),
      });
    }
  }
  return found.toSorted((a, b) => a.objects - b.objects);
}

/**
 * How many objects the pack index at `path` lists: the last entry of its fan-out table, after a
 * version 2 index's header. `undefined` when there's no index, so no finished pack.
 */
async function indexedObjects(path: string): Promise<number | undefined> {
  const file = await open(path, 'r').catch(() => undefined);
  if (file === undefined) return undefined;
  try {
    const head = Buffer.alloc(8 + 256 * 4);
    const { bytesRead } = await file.read(head, 0, head.length, 0);
    const v2 = head.readUInt32BE(0) === 0xff_74_4f_63;
    const at = (v2 ? 8 : 0) + 255 * 4;
    return bytesRead >= at + 4 ? head.readUInt32BE(at) : undefined;
  } finally {
    await file.close();
  }
}

/**
 * What repacking a clone with `packs` would do, when it has more than `limit`: whole, when they're
 * more than {@link PACK_LIMIT} and nobody has the clone open (`users`); otherwise geometrically,
 * when that rolls two promisor packs or more, the packs fetches and downloads add. A pack of Lo's
 * own replays, which a whole repack writes, isn't a promisor pack, and stays as it is. `undefined`
 * when it needs neither.
 */
function planRepack(packs: readonly Pack[], limit: number, users: number): RepackPlan | undefined {
  if (packs.length <= limit) return undefined;
  if (packs.length > PACK_LIMIT && users === 0) return { kind: 'full' };
  // A pack with a `.keep` is never rolled, as git's own repack leaves it be, and keeps its `.keep`.
  const promisor = packs.filter((pack) => pack.promisor && !pack.kept);
  const split = geometricSplit(promisor.map((pack) => pack.objects));
  if (split < 2) return undefined;
  const names = promisor.map((pack) => pack.name);
  const kept = packs.filter((pack) => pack.kept).map((pack) => pack.name);
  return { kind: 'geometric', roll: names.slice(0, split), keep: [...names.slice(split), ...kept] };
}

/**
 * Rolls the promisor packs `plan.roll` of the clone at `folder` into one, leaving `plan.keep` be,
 * as git 2.53 and later's geometric repack does, for older gits: their geometric repack dies on a
 * partial clone, and their whole repack rewrites even the packs it's told to keep.
 * `git pack-objects --stdin-packs` writes everything in the rolled packs that the kept ones lack
 * into a new pack, outside the clone, without walking history or downloading anything. It goes in
 * as git puts a pack in place: marked as a promisor pack first and its index last, so it's never
 * seen as anything else; and only then do the rolled packs go, each's index first, so no reader
 * finds part of one. Stopped part way, it leaves the clone as it was, or with objects in two packs.
 */
async function rollUp(
  host: CleanupHost,
  folder: string,
  plan: Extract<RepackPlan, { kind: 'geometric' }>,
  signal: AbortSignal,
): Promise<void> {
  const scratch = host.temporaryPath('.repack');
  await mkdir(scratch, { recursive: true });
  try {
    const input = [...plan.roll, ...plan.keep.map((name) => `^${name}`)].join('\n');
    const written = await host.runner
      .command({ gitDir: folder })
      .arg('pack-objects', '--stdin-packs', '--delta-base-offset', '-q')
      .path(join(scratch, 'pack'))
      .run(`${input}\n`, { timeout: REPACK_LIMIT, signal });
    const hash = written.toString('utf8').trim();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(hash)) {
      throw new Error(`git pack-objects printed ${JSON.stringify(hash)} for the pack it wrote`);
    }
    const made = `pack-${hash}`;
    const packs = join(folder, 'objects', 'pack');
    await writeFile(join(packs, `${made}.promisor`), '');
    for (const extension of ['.pack', '.rev', '.idx']) {
      await rename(join(scratch, `${made}${extension}`), join(packs, `${made}${extension}`)).catch(
        (error: unknown) => {
          // Older gits write no reverse index.
          if (extension !== '.rev') throw error;
        },
      );
    }
    for (const name of plan.roll) {
      const base = name.slice(0, -'.pack'.length);
      // The same objects as the new pack's, which took its name.
      if (base === made) continue;
      for (const extension of ['.idx', '.pack', '.rev', '.mtimes', '.bitmap', '.promisor']) {
        await rm(join(packs, `${base}${extension}`), { force: true });
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Repacks every clone with more than `limit` packs that needs it, as {@link repackClone} does.
 * Returns the `owner/name` of each clone repacked.
 */
export async function repack(host: CleanupHost, limit: number): Promise<string[]> {
  const repacked: string[] = [];
  for (const clone of await clones(host)) {
    if (await repackClone(host, clone, limit)) repacked.push(`${clone.owner}/${clone.name}`);
  }
  return repacked;
}

/**
 * Repacks `clone` if it has more than `limit` packs, geometrically, or whole once they piled past
 * {@link PACK_LIMIT} while nobody has it open, then packs its refs, holding its lock giving way. A
 * clone being written to is skipped, one that fails is noted and skipped, and one whose repack
 * gave way is left for later. Needs no network: what was downloaded stays, and what wasn't stays
 * downloadable. Returns whether it repacked.
 */
export async function repackClone(
  host: CleanupHost,
  clone: CloneName,
  limit: number,
): Promise<boolean> {
  const folder = host.repoFolder(clone.owner, clone.name);
  if ((await packCount(folder)) <= limit) return false;
  const held = maintain(host, clone, 'repacking it');
  if (held === undefined) return false;
  const { signal } = held;
  const started = Date.now();
  try {
    const packs = await packsOf(folder);
    const plan = planRepack(packs, limit, held.users);
    if (plan === undefined) return false;
    if (plan.kind === 'full' || repacksGeometrically(host.runner.git.version)) {
      await host.runner
        .command({ gitDir: folder })
        .arg(...repackArguments(plan))
        .run(undefined, { timeout: REPACK_LIMIT, signal });
    } else {
      await rollUp(host, folder, plan, signal);
    }
    await host.runner
      .command({ gitDir: folder })
      .arg('pack-refs', '--all')
      .run(undefined, { timeout: REPACK_LIMIT, signal });
    host.note(
      `repacked ${clone.owner}/${clone.name} ${plan.kind === 'full' ? 'whole' : 'geometrically'} ` +
        `from ${packs.length} packs to ${await packCount(folder)} in ${Date.now() - started} ms`,
    );
    return true;
  } catch (error) {
    // Both are safe to stop: a pack is in place only once whole, the packs it replaces go only
    // after, and what it was writing is removed.
    if (gaveWay(host, signal, `repacking ${clone.owner}/${clone.name}`)) {
      removeLeftByMaintenance(host, folder, started);
    } else {
      host.note(`can't repack ${clone.owner}/${clone.name}: ${String(error)}`);
    }
    return false;
  } finally {
    held.release();
  }
}

/** How many packs the clone at `folder` has. */
async function packCount(folder: string): Promise<number> {
  const names = await readdir(join(folder, 'objects', 'pack')).catch(() => []);
  return names.filter((name) => name.endsWith('.pack')).length;
}
