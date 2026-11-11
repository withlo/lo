/**
 * Keeping the cache in bounds: removing what nobody used for a while, past a cap on its size the
 * least recently used checkouts and clones, and repacking busy clones. Nothing follows a symlink,
 * so nothing outside the cache is ever measured or removed, and a clone that's open or being
 * written to is never taken. Maintenance that can take minutes, repacking and collecting what
 * comparisons replayed, gives way: anyone who waits for the clone stops it, and it's done again at
 * the next cleanup.
 */

import { lstat, readdir, readFile, realpath, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';

import { REPLAYS } from './compare.ts';
import type { Runner } from './git.ts';
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

/** How many packs a clone may have before it's repacked, as git's own `gc.autoPackLimit`. */
export const PACK_LIMIT = 50;

/** How long a repack may take: far longer than a read, since a big clone's takes minutes. */
export const REPACK_LIMIT = 30 * 60 * 1000;

/**
 * The first git whose geometric repack keeps a partial clone's promisor packs as promisor packs.
 * Older ones repack everything into one pack, which always has.
 */
const GEOMETRIC_WITH_PROMISORS: GitVersion = { major: 2, minor: 52, patch: 0 };

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
 * if nobody holds it, and with `remove`, if nobody has it open. Anyone who then waits for the clone
 * aborts `signal`, with a {@link GaveWay} as its reason, which stops the maintenance's gits.
 */
function maintain(
  host: CleanupHost,
  clone: CloneName,
  what: string,
  remove = false,
): { release: Release; signal: AbortSignal } | undefined {
  const controller = new AbortController();
  const lock = host.cloneLock(clone.owner, clone.name);
  const giveWay = (waiter: string) => controller.abort(new GaveWay(waiter));
  const release = remove ? lock.tryRemove(what, giveWay) : lock.tryAcquire(what, giveWay);
  return release === undefined ? undefined : { release, signal: controller.signal };
}

/**
 * Whether someone waiting for the clone stopped the maintenance holding `signal`, which was doing
 * `stopped`, and if so, notes it.
 */
function gaveWay(host: CleanupHost, signal: AbortSignal, stopped: string): boolean {
  const reason: unknown = signal.reason;
  if (!(reason instanceof GaveWay)) return false;
  host.note(`stopped ${stopped} for ${reason.waiter}, to do again at the next cleanup`);
  return true;
}

/**
 * Removes the ref locks a maintenance git stopped part way may have left in `gitDir` since
 * `since`: one asked to stop removes its own, but one killed can't. Only while no other git of
 * Lo's runs there, so they're the stopped git's.
 */
async function removeLocksLeft(host: CleanupHost, gitDir: string, since: number): Promise<void> {
  if (host.runner.running(gitDir) > 0) return;
  // File systems that keep whole seconds round a time down.
  const after = Math.floor(since / 1000) * 1000;
  for (const name of ['packed-refs.lock', join('reftable', 'tables.list.lock')]) {
    const path = join(gitDir, name);
    const made = await lstat(path).catch(() => undefined);
    if (made === undefined || made.mtimeMs < after) continue;
    await rm(path, { force: true }).catch((error: unknown) => {
      host.note(`can't remove ${path}: ${String(error)}`);
    });
  }
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
 * Removes the partial packs a stopped or crashed fetch left in `clone` a day or more ago. Only
 * fetches and repacks write them, with the clone's lock, which this takes.
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
async function collectReplays(host: CleanupHost, clone: CloneName): Promise<void> {
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
    if (gaveWay(host, signal, what)) await removeLocksLeft(host, gitDir, started);
    else host.note(`can't remove ${clone.owner}/${clone.name}'s replayed trees: ${String(error)}`);
  } finally {
    held.release();
  }
}

/** Whether the clone at `gitDir` holds any loose object, in a folder such as `objects/ab`. */
async function hasLooseObjects(gitDir: string): Promise<boolean> {
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

/** How `git repack` runs with git `version`: geometrically where that keeps promisor packs. */
export function repackArguments(version: GitVersion): string[] {
  // Bitmaps need every object, which a partial clone doesn't have.
  return compareVersions(version, GEOMETRIC_WITH_PROMISORS) >= 0
    ? ['repack', '-d', '-q', '--geometric=2', '--no-write-bitmap-index']
    : ['repack', '-a', '-d', '-q', '--no-write-bitmap-index'];
}

/** How many packs the clone at `folder` has. */
async function packCount(folder: string): Promise<number> {
  const names = await readdir(join(folder, 'objects', 'pack')).catch(() => []);
  return names.filter((name) => name.endsWith('.pack')).length;
}

/**
 * Repacks every clone with more than `limit` packs, and packs its refs, holding its lock: every
 * fetch and download adds a pack, and every lookup searches them all. A clone being written to is
 * skipped, one that fails is noted and skipped, and anyone who waits for a clone being repacked
 * stops the repack, which is done again next time. Needs no network: what was downloaded stays,
 * and what wasn't stays downloadable. Returns the `owner/name` of each clone repacked.
 */
export async function repack(host: CleanupHost, limit: number): Promise<string[]> {
  const repacked: string[] = [];
  for (const clone of await clones(host)) {
    const folder = host.repoFolder(clone.owner, clone.name);
    const before = await packCount(folder);
    if (before <= limit) continue;
    const held = maintain(host, clone, 'repacking it');
    if (held === undefined) continue;
    const { signal } = held;
    const started = Date.now();
    try {
      await host.runner
        .command({ gitDir: folder })
        .arg(...repackArguments(host.runner.git.version))
        .run(undefined, { timeout: REPACK_LIMIT, signal });
      await host.runner
        .command({ gitDir: folder })
        .arg('pack-refs', '--all')
        .run(undefined, { timeout: REPACK_LIMIT, signal });
      host.note(
        `repacked ${clone.owner}/${clone.name} from ${before} packs to ` +
          `${await packCount(folder)} in ${Date.now() - started} ms`,
      );
      repacked.push(`${clone.owner}/${clone.name}`);
    } catch (error) {
      // Both are safe to stop: a pack is in place only once whole, the packs it replaces go only
      // after, and the half-written ones go before the next fetch.
      if (gaveWay(host, signal, `repacking ${clone.owner}/${clone.name}`)) {
        await removeLocksLeft(host, folder, started);
      } else {
        host.note(`can't repack ${clone.owner}/${clone.name}: ${String(error)}`);
      }
    } finally {
      held.release();
    }
  }
  return repacked;
}
