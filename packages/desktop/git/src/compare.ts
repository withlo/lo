/**
 * Comparing two revisions of a pull request so that only what its author changed shows, even
 * across a rebase: the old revision's changes are replayed onto the new base, and what that makes
 * is compared with the new head.
 */

import { type ChangedFile, changedPath } from './diff.ts';
import { GitError } from './errors.ts';
import { failureMessage } from './git.ts';
import { type Oid, parseOid } from './oid.ts';
import { splitRecords } from './records.ts';
import type { Finished } from './spawn.ts';

/** Where replayed trees are pinned: `refs/lo/replays/<tree>`. */
export const REPLAYS = 'refs/lo/replays/';

/** One revision of a pull request, as git sees it: its head, and the commit its changes start from. */
export interface Revision {
  /**
   * Where the revision's changes start, which must be `head` or one of its ancestors: the merge
   * base of `head` with the base branch as it was when the revision was pushed. For a layer of a
   * stack, the newest head of the layer below that `head` contains. That's not always the lower
   * layer's head when the revision was pushed: after the lower layer is force-pushed, the upper
   * layer keeps the old one until it's restacked. Nor is it GitHub's `base.sha`, the base
   * branch's tip.
   */
  readonly base: Oid;
  readonly head: Oid;
}

/**
 * Whether the old revision was replayed onto the new base, and how that went:
 *
 * - `sameBase`: both revisions start from the same base, so the comparison is of their heads.
 * - `clean`: the old revision's changes, replayed onto the new base, are compared with the new
 *   head, so only what the author changed shows. Nothing showing means the author only rebased.
 * - `retargeted`: replayed as for `clean`, but the base changed in a way a rebase onto a newer
 *   base doesn't explain, so what shows can have come with the base rather than from the author:
 *   the new base isn't the old one or a descendant of it, as when the pull request was retargeted
 *   to another branch, its base branch was rewound, or the lower layer of a stack was amended; or
 *   the head didn't change at all.
 * - `conflicted`: the replay conflicted, so the comparison is of the heads and also shows what
 *   changed between the bases. Every file the replay conflicted on is listed too, with how the
 *   author resolved it; some conflicts leave no file conflicted. `tree` is the replay as git wrote
 *   it, conflicts and all, with git's markers in the files whose contents conflicted: what each
 *   resolution starts from. `retargeted` says whether the base changed as for `retargeted`, so
 *   the resolutions can hold what came with the base.
 */
export type Replay =
  | { readonly kind: 'sameBase' | 'clean' | 'retargeted' }
  | { readonly kind: 'conflicted'; readonly tree: Oid; readonly retargeted: boolean };

/** A file a {@link Comparison} lists. */
export interface ComparedFile {
  /**
   * The path, as bytes: the changed file's own, or the path the replay conflicted on.
   */
  readonly path: Buffer;
  /**
   * How the file changed from the comparison's old side to its new one. None only for a file the
   * replay conflicted on that's the same in both, as when the author resolved the conflict by
   * keeping their version over the base's.
   */
  readonly change?: ChangedFile | undefined;
  /**
   * For a file the replay conflicted on, how the author resolved it: the files that changed from
   * the conflicted replay to the new head, at this path and at any copy of it git set aside under
   * a name of its own (`<path>~<commit>`), as when a file became a symlink on one side and changed
   * on the other. Empty when the new head kept the conflicted replay's version. None for a file
   * the replay didn't conflict on.
   */
  readonly resolution?: readonly ChangedFile[] | undefined;
}

/** What changed between two revisions, from `Repo.compareRevisions`. */
export interface Comparison {
  /** The files that changed from `old` to `new`; after a conflicted replay, every file it conflicted on too. */
  readonly files: readonly ComparedFile[];
  /**
   * The old side: after a clean replay, the tree of the old revision's changes replayed onto the
   * new base; otherwise the old head. It reads like any revision.
   */
  readonly old: Oid;
  /** The new side: the new head. */
  readonly new: Oid;
  readonly replay: Replay;
}

/**
 * The most a comparison's downloads may bring, in bytes, unless the caller says otherwise: both
 * sides of every file it lists, and what its replay merges.
 */
export const COMPARE_LIMIT = 200 * 1024 * 1024;

/**
 * A comparison Lo refused to make, rather than show part of one: its downloads would have brought
 * more than `limit` bytes.
 */
export interface ComparisonRefused {
  readonly refused: 'tooLarge';
  readonly limit: number;
}

/** Whether the replay conflicted on `file`, so the author resolved a conflict in it. */
export function isConflicted(file: ComparedFile): boolean {
  return file.resolution !== undefined;
}

/** How a replay went: its tree, and for a conflicted one, the paths git listed. */
export type Replayed =
  | { readonly kind: 'clean'; readonly tree: Oid }
  | { readonly kind: 'conflicted'; readonly tree: Oid; readonly paths: readonly Buffer[] };

/**
 * Reads `git merge-tree --write-tree -z --name-only --no-messages`: the tree, then each conflicted
 * path, each ending in a NUL.
 */
export function parseMergeTree(output: Uint8Array): { tree: Oid; paths: Buffer[] } | undefined {
  const bytes = Buffer.from(output.buffer, output.byteOffset, output.byteLength);
  if (bytes.length === 0 || bytes.at(-1) !== 0) return undefined;
  const [first, ...paths] = splitRecords(bytes);
  if (first === undefined || paths.some((path) => path.length === 0)) return undefined;
  try {
    return { tree: parseOid(first.toString('latin1')), paths };
  } catch {
    return undefined;
  }
}

/**
 * How `git merge-tree`, run as `command`, went. Its exit status says whether it's clean: 0 is, 1
 * conflicted, and anything else failed. A conflict can leave no path conflicted, so the paths
 * don't say.
 */
export function readReplay(
  command: string,
  finished: Pick<Finished, 'code' | 'signal' | 'stdout' | 'stderr'>,
): Replayed {
  if (finished.code !== 0 && finished.code !== 1) {
    throw GitError.fromGit(command, failureMessage(finished));
  }
  const parsed = parseMergeTree(finished.stdout);
  if (parsed === undefined) {
    // git's message, which can say a file it needed was missing: git then exits 1, as for a
    // conflict, when it can't read a commit.
    const stderr = finished.stderr.trim();
    const message =
      stderr === ''
        ? `printed unexpected output ${JSON.stringify(finished.stdout.toString('utf8'))}`
        : stderr;
    throw GitError.fromGit(command, message);
  }
  return finished.code === 0
    ? { kind: 'clean', tree: parsed.tree }
    : { kind: 'conflicted', tree: parsed.tree, paths: parsed.paths };
}

/** The object a git with lazy fetching off gave up on, from its message, if it said. */
export function lackedObject(message: string): Oid | undefined {
  const found = /could not fetch ([0-9a-f]{40}|[0-9a-f]{64}) from promisor remote/.exec(message);
  return found?.[1] === undefined ? undefined : parseOid(found[1]);
}

/**
 * Runs `replay` and pins the tree it writes, the first time this process makes it: `pinned` holds
 * the trees it has. `pin` pins a tree and says whether the tree is there once pinned, since it can
 * be gone by then: merge-tree refreshes only a tree it finds packed, and a full repack, which
 * listed what's reachable before the pin, can delete the pack. Replaying again writes it anew, so
 * a tree that's gone is replayed once more.
 */
export async function replayPinned(
  replay: () => Promise<Replayed>,
  pin: (tree: Oid) => Promise<boolean>,
  pinned: Set<Oid>,
  log: (line: string) => void,
): Promise<Replayed> {
  let failure: GitError | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const replayed = await replay();
    const { tree } = replayed;
    if (pinned.has(tree)) return replayed;
    if (await pin(tree)) {
      pinned.add(tree);
      return replayed;
    }
    failure = new GitError({
      kind: 'git',
      command: 'git merge-tree',
      message: `the tree it wrote, ${tree}, was gone once pinned`,
    });
    log(`can't pin replayed tree ${tree}${attempt === 0 ? ', so replaying again' : ''}`);
  }
  throw failure ?? new Error('a replay that never pins fails');
}

/**
 * The path `path` was set aside from, when it's a copy git set aside in a conflict under a name of
 * its own: `<path>~<label>`, or `<path>~<label>_<n>` when that was taken, where `label` is one of
 * `labels`, the commits merge-tree was given, which name its sides.
 */
export function setAsideFrom(path: Buffer, labels: readonly string[]): Buffer | undefined {
  const tilde = path.lastIndexOf(0x7e);
  if (tilde <= 0) return undefined;
  const suffix = path.subarray(tilde + 1).toString('latin1');
  const named = labels.some((label) => {
    if (!suffix.startsWith(label)) return false;
    const rest = suffix.slice(label.length);
    return rest === '' || /^_\d+$/.test(rest);
  });
  return named ? path.subarray(0, tilde) : undefined;
}

/**
 * The paths a replay conflicted on, from the paths git `listed`, each once, in order. A copy git
 * set aside, which is in neither revision, stands for the path it came from.
 */
export function conflictedPaths(listed: readonly Buffer[], labels: readonly string[]): Buffer[] {
  const paths = listed.map((path) => setAsideFrom(path, labels) ?? path);
  paths.sort((a, b) => Buffer.compare(a, b));
  return paths.filter(
    (path, index) => index === 0 || !path.equals(paths[index - 1] ?? Buffer.alloc(0)),
  );
}

/**
 * The files that changed between the heads, `plain`, with each path in `conflicted` marked, and
 * added in path order where it didn't change, each with its part of `resolutions`, what changed
 * from the conflicted replay to the new head.
 */
export function withConflicts(
  plain: readonly ChangedFile[],
  conflicted: readonly Buffer[],
  resolutions: readonly ChangedFile[],
  labels: readonly string[],
): ComparedFile[] {
  // Whether `file` is at `path`, or at a copy of it git set aside.
  const at = (file: ChangedFile, path: Buffer) =>
    [file.old?.path, file.new?.path].some(
      (side) => side !== undefined && (setAsideFrom(side, labels) ?? side).equals(path),
    );
  const files: { path: Buffer; change?: ChangedFile; resolution?: ChangedFile[] }[] = plain.map(
    (change) => ({ path: changedPath(change), change }),
  );
  for (const path of conflicted) {
    const resolution = resolutions.filter((file) => at(file, path));
    let listed = false;
    for (const file of files) {
      if (file.change === undefined || !at(file.change, path)) continue;
      listed = true;
      file.resolution ??= [];
      for (const part of resolution) {
        if (!file.resolution.includes(part)) file.resolution.push(part);
      }
    }
    if (!listed) {
      const index = files.findIndex((file) => Buffer.compare(file.path, path) > 0);
      files.splice(index === -1 ? files.length : index, 0, { path, resolution });
    }
  }
  return files;
}
