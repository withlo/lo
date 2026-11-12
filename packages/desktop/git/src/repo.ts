/** One repository's clone: fetching into it, and reading its commits. */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import {
  answerable,
  type Attribute,
  attributeFiles,
  attributeFolder,
  checkAttributeQuestion,
  MAX_ATTRIBUTE_FILES,
  parseCheckAttr,
} from './attributes.ts';
import {
  COMPARE_LIMIT,
  type Comparison,
  type ComparisonRefused,
  conflictedPaths,
  lackedObject,
  readReplay,
  REPLAYS,
  type Replayed,
  replayPinned,
  type Revision,
  withConflicts,
} from './compare.ts';
import {
  type ChangedFile,
  changedPath,
  type FileVersion,
  parseChanges,
  parseRawRecords,
  rawDiffBlobs,
} from './diff.ts';
import type { ProxySource } from './cache.ts';
import { checkoutGitDir } from './cleanup.ts';
import { removeLocksLeft, removeTemporaryPacks, removeUnfinishedPacks } from './leftovers.ts';
import { type FetchFailure, GitError } from './errors.ts';
import { type Fetching, failureMessage, type GitCommand, type Runner } from './git.ts';
import type { FetchLimits } from './limits.ts';
import type { CloneLock, Release } from './lock.ts';
import type { ObjectReader } from './objects.ts';
import { type Oid, oidFromOutput, parseOid } from './oid.ts';
import {
  type FilePatch,
  lineCount,
  MAX_PATCH_LINES,
  patchFromDiff,
  submoduleLine,
  UNCHANGED,
  wholeFilePatch,
} from './patch.ts';
import type { Activity } from './progress.ts';
import {
  baseRef,
  branchBaseRef,
  checkNumber,
  commitRef,
  pullRef,
  revisionBaseRef,
  revisionRef,
} from './refs.ts';
import type { Finished } from './spawn.ts';
import { stampUsed } from './stamp.ts';
import { Token, type TokenSource } from './token.ts';
import {
  checkPaths,
  displayPath,
  type FileMode,
  type Found,
  MAX_ENTRIES,
  tooManyEntries,
  parseListed,
  type TreeEntry,
  treeEntry,
  TreeWalk,
} from './tree.ts';
import { formatMegabytes, stoppedError, watch } from './watch.ts';

/** What a repository needs of the cache it's in. */
export interface RepoHost {
  readonly runner: Runner;
  /** Makes a bare clone at `folder`, set up to fetch from `url`. */
  create(folder: string, url: string): Promise<void>;
  /** Moves `path` aside and deletes it, and says whether it's gone: never past a link. */
  trash(path: string): Promise<boolean>;
  /** Whether `path` is in the cache with no link above it. */
  linkFree(path: string): Promise<boolean>;
  /** How long fetches may take. */
  readonly limits: FetchLimits;
  /** A new path for a temporary file, ending in `extension`. */
  temporaryPath(extension: string): string;
  /** Notes a line for the log. */
  note(line: string): void;
  /** Keeps the cache in bounds once a fetch has made a clone. */
  madeClone(): Promise<void>;
}

export interface RepoParts {
  readonly cache: RepoHost;
  /** `owner/name`, for messages. */
  readonly name: string;
  /** The clone's folder. */
  readonly folder: string;
  /** The address the clone fetches from. */
  readonly url: string;
  readonly lock: CloneLock;
  /** Lets go of the clone, and its reader, when the repository closes. */
  readonly done: Release;
  /** The clone's one long-lived reader of objects, which every repository open on it shares. */
  readonly reader: ObjectReader;
  readonly token?: TokenSource | undefined;
  readonly proxy?: ProxySource | undefined;
  readonly progress?: ((activity: Activity) => void) | undefined;
  /** The replayed trees this process has pinned in the clone, shared by every repository open on it. */
  readonly replays: Set<Oid>;
  /** The folder the clone's checkouts go in: `pull-<n>/<head>` each. */
  readonly checkouts: string;
  /** Opened to read offline: it never fetches. */
  readonly offline: boolean;
}

/** A pull request to fetch, as GitHub's API describes it. */
export interface PullRequestRefs {
  readonly number: number;
  /** `head.sha`: the head GitHub showed, which the fetched head is checked against. */
  readonly head?: Oid | undefined;
  /** `base.ref`: the branch it merges into. */
  readonly baseBranch: string;
  /** `base.sha`: the base commit GitHub showed, used when the base branch no longer exists. */
  readonly base?: Oid | undefined;
}

/**
 * Which head {@link Repo.fetchPull} chose:
 *
 * - `pullRef`: `refs/pull/<n>/head`, which held the head GitHub's API reported, or there was none
 *   to check.
 * - `api`: the API's head, fetched by ID, because `refs/pull/<n>/head` held `pullRef`. GitHub
 *   moves the ref a moment after a push, so the two can briefly differ.
 * - `pullRefNotApi`: `refs/pull/<n>/head`, because GitHub no longer has the API's head `api`.
 */
export type HeadSource =
  | { readonly kind: 'pullRef' }
  | { readonly kind: 'api'; readonly pullRef: Oid }
  | { readonly kind: 'pullRefNotApi'; readonly api: Oid };

/** What {@link Repo.fetchPull} fetched. */
export interface FetchedPull {
  /** The head to show. */
  readonly head: Oid;
  readonly headSource: HeadSource;
  /** The base branch's tip. The diff starts at its merge base with `head`. */
  readonly baseTip: Oid;
  /**
   * `branch`, or `api` when the base branch is gone, as when a lower layer of a stack merged and
   * its branch was deleted, and the API's base commit stands in for its tip.
   */
  readonly baseSource: 'branch' | 'api';
}

/**
 * The most bytes either side of a patch may hold unless the caller says otherwise: far more than a
 * file whose patch is worth reading, as GitHub leaves out a large file's.
 */
export const PATCH_LIMIT = 10 * 1024 * 1024;

/**
 * The most objects that count as a few: GitHub prepares a pack of them in seconds, so a fetch of
 * no more has the usual time to start sending, and not a first fetch's.
 */
const FEW_OBJECTS = 500;

/** How many objects a download asks for in one fetch. */
const OBJECTS_PER_FETCH = 5000;

/** The folder in a clone where each pull request's commits GitHub no longer has are noted. */
const UNAVAILABLE_FOLDER = 'lo-unavailable';

/**
 * The name every fetch gives the remote it fetches from, with its address and its being a
 * promisor on git's command line. The clone's own settings never decide where a fetch goes.
 */
const REMOTE = 'lo';

/** Which of a pull request's commits a fetch by ID pins. */
type Pins = 'revisions' | 'revisionBases';

/** A bare partial clone in the cache, from `Cache.open`. Close it when it's no longer shown. */
export class Repo {
  /** `owner/name`, for messages. */
  readonly name: string;
  /** The clone's folder. */
  readonly folder: string;
  readonly offline: boolean;
  readonly #cache: RepoHost;
  readonly #url: string;
  readonly #lock: CloneLock;
  readonly #done: Release;
  readonly #token: TokenSource | undefined;
  readonly #proxy: ProxySource | undefined;
  readonly #progress: ((activity: Activity) => void) | undefined;
  /** The clone's reader of objects, started on the first read that needs it. */
  readonly #reader: ObjectReader;
  readonly #replays: Set<Oid>;
  readonly #checkouts: string;
  /** Whether a fetch made the clone, the first to bring anything into it. */
  #madeClone = false;

  constructor(parts: RepoParts) {
    this.name = parts.name;
    this.folder = parts.folder;
    this.offline = parts.offline;
    this.#cache = parts.cache;
    this.#url = parts.url;
    this.#lock = parts.lock;
    this.#done = parts.done;
    this.#token = parts.token;
    this.#proxy = parts.proxy;
    this.#progress = parts.progress;
    this.#reader = parts.reader;
    this.#replays = parts.replays;
    this.#checkouts = parts.checkouts;
  }

  /**
   * Lets go of the clone's reader, which stops once no repository open on the clone uses it, and
   * lets cleanup take the clone again once none has it open.
   */
  close(): void {
    this.#done();
  }

  get #runner(): Runner {
    return this.#cache.runner;
  }

  /** A git command on the clone that reads, and never downloads. */
  #git() {
    return this.#runner.command({ gitDir: this.folder });
  }

  /**
   * Fetches a pull request's head and its base branch's tip in one fetch, and pins both.
   *
   * The head comes from `refs/pull/<n>/head`, which holds the head of a pull request from a fork
   * too. When GitHub's API reported another head, Lo fetches that one by ID and uses it, since
   * it's what GitHub shows. When the base branch is gone, the API's base commit stands in for
   * its tip.
   */
  async fetchPull(pull: PullRequestRefs): Promise<FetchedPull> {
    checkNumber(pull.number);
    await this.#checkBranchName(pull.baseBranch);
    const { number } = pull;
    const what = `pull request #${number}`;
    const head = pullRef(number, 'head');
    const base = pullRef(number, 'base');
    const headSpec = `+refs/pull/${number}/head:${head}`;
    const branch = `refs/heads/${pull.baseBranch}`;
    const apiBase = pull.base;
    return this.#locked(`fetching ${what}`, async () => {
      let baseSource: FetchedPull['baseSource'] = 'branch';
      try {
        await this.#fetch(what, [headSpec, `+${branch}:${base}`]);
      } catch (error) {
        const gone =
          error instanceof GitError &&
          error.detail.kind === 'fetch' &&
          error.detail.failure === 'refNotFound' &&
          error.detail.message.includes(branch);
        if (!gone || apiBase === undefined) throw error;
        this.#cache.note(
          `${this.name}: ${what}'s base branch ${pull.baseBranch} is gone, so using ${apiBase}`,
        );
        await this.#fetch(what, [headSpec, `+${apiBase}:${base}`]).catch((cause: unknown) => {
          if (isLostCommit(cause, apiBase))
            throw new GitError({ kind: 'unavailable', oid: apiBase });
          throw cause;
        });
        baseSource = 'api';
      }
      const pullHead = await this.#resolve(head);
      const baseTip = await this.#resolve(base);
      await this.#pin([
        [revisionRef(number, pullHead), pullHead],
        [baseRef(number, baseTip), baseTip],
        [branchBaseRef(number, pull.baseBranch), baseTip],
      ]);
      const api = pull.head;
      if (api === undefined || api === pullHead) {
        return { head: pullHead, headSource: { kind: 'pullRef' }, baseTip, baseSource };
      }
      try {
        await this.#fetchById(what, api, revisionRef(number, api));
        this.#cache.note(
          `${this.name}: GitHub's API says ${what}'s head is ${api}, but ` +
            `refs/pull/${number}/head is ${pullHead}; using the API's`,
        );
        return { head: api, headSource: { kind: 'api', pullRef: pullHead }, baseTip, baseSource };
      } catch (error) {
        if (!(error instanceof GitError && error.detail.kind === 'unavailable')) throw error;
        return {
          head: pullHead,
          headSource: { kind: 'pullRefNotApi', api },
          baseTip,
          baseSource,
        };
      }
    });
  }

  /**
   * Makes sure commit `oid` is in the clone, fetching it by ID if it isn't, and pins it. For a
   * revision Lo knows from GitHub's API but never fetched. Fails as `unavailable` when GitHub no
   * longer has it.
   */
  async fetchCommit(oid: Oid): Promise<void> {
    const what = `commit ${oid.slice(0, 7)}`;
    await this.#locked(`fetching ${what}`, () => this.#fetchById(what, oid, commitRef(oid)));
  }

  /**
   * Makes sure every head in `heads` is in the clone and pins each as one of pull request
   * `number`'s revisions. Those the clone lacks are fetched by ID in one fetch. Returns the ones
   * GitHub no longer has, which are left out and remembered, so they're never asked for again.
   */
  async fetchCommits(number: number, heads: readonly Oid[]): Promise<Oid[]> {
    checkNumber(number);
    return this.#locked(`fetching pull request #${number}'s revisions`, () =>
      this.#fetchPinned(number, heads, 'revisions'),
    );
  }

  /**
   * Makes sure every tip in `tips`, the base branch's tips that pull request `number`'s revisions
   * were pushed on, is in the clone, and pins each, as {@link Repo.fetchCommits} does heads. The
   * pins of tips no longer in `tips` go, so they track what the revisions need.
   */
  async fetchRevisionBases(number: number, tips: readonly Oid[]): Promise<Oid[]> {
    checkNumber(number);
    return this.#locked(`fetching the bases of pull request #${number}'s revisions`, async () => {
      const lost = await this.#fetchPinned(number, tips, 'revisionBases');
      const prefix = pullRef(number, 'revision-bases/');
      const pinned = await this.#refs(prefix);
      const stale = pinned.filter((oid) => !tips.includes(oid));
      if (stale.length > 0) {
        const input = stale.map((oid) => `delete ${prefix}${oid}\n`).join('');
        await this.#git().arg('update-ref', '--stdin').run(input);
      }
      return lost;
    });
  }

  /**
   * The heads of pull request `number` that GitHub no longer had when asked for, and that the
   * clone still lacks. Reads only the clone, so it works offline.
   */
  async unavailableRevisions(number: number): Promise<Oid[]> {
    checkNumber(number);
    const remembered = await this.#remembered(number, 'revisions');
    const present = await this.#commitsPresent(remembered);
    return remembered.filter((_, index) => !present[index]);
  }

  /** Every head of pull request `number` fetched so far, in no particular order. */
  async pullRevisions(number: number): Promise<Oid[]> {
    checkNumber(number);
    return this.#refs(pullRef(number, 'revs/'));
  }

  /** Whether `base` was ever fetched as the tip of pull request `number`'s base branch. */
  async hasBase(number: number, base: Oid): Promise<boolean> {
    checkNumber(number);
    return (await this.#refs(baseRef(number, base)))[0] === base;
  }

  /**
   * The tip of `branch` as last fetched as pull request `number`'s base, or `undefined` when the
   * pull request was never fetched against that branch. Reads only refs, so it works offline.
   */
  async branchBase(number: number, branch: string): Promise<Oid | undefined> {
    checkNumber(number);
    return (await this.#refs(branchBaseRef(number, branch)))[0];
  }

  /**
   * The commits on `head` that `base` doesn't have, oldest first and each after its parents. Both
   * must be in the clone already: a missing one is `notFetched`, and is never downloaded.
   */
  async pullCommits(base: Oid, head: Oid): Promise<Oid[]> {
    const present = await this.#commitsPresent([base, head]);
    for (const [index, oid] of [base, head].entries()) {
      if (!present[index]) throw new GitError({ kind: 'notFetched', oid });
    }
    const output = await this.#git()
      .arg('rev-list', '--topo-order', '--reverse', `${base}..${head}`, '--')
      .run();
    return lines(output).map(parseOid);
  }

  /** Whether commit `oid` is in the clone. Never downloads anything. */
  async hasCommit(oid: Oid): Promise<boolean> {
    return (await this.#commitsPresent([oid]))[0] ?? false;
  }

  /** The best common ancestor of `a` and `b`, or `undefined` when they share no history. */
  async mergeBase(a: Oid, b: Oid): Promise<Oid | undefined> {
    const command = this.#git().arg('merge-base', a, b);
    const finished = await command.finish();
    if (finished.code === 0) return oidFromOutput(finished.stdout);
    if (finished.code === 1 && finished.stderr.trim() === '') return undefined;
    throw GitError.fromGit(command.display, failureMessage(finished));
  }

  /** Whether `ancestor` is `descendant` or one of its ancestors. */
  async isAncestor(ancestor: Oid, descendant: Oid): Promise<boolean> {
    const command = this.#git().arg('merge-base', '--is-ancestor', ancestor, descendant);
    const finished = await command.finish();
    if (finished.code === 0) return true;
    if (finished.code === 1 && finished.stderr.trim() === '') return false;
    throw GitError.fromGit(command.display, failureMessage(finished));
  }

  /** Which of `oids` the clone lacks. Never downloads anything. */
  async missingObjects(oids: readonly Oid[]): Promise<Oid[]> {
    if (oids.length === 0) return [];
    const output = await this.#git()
      .arg('cat-file', '--batch-check=%(objectname)')
      .run(oids.map((oid) => `${oid}\n`).join(''));
    return lines(output)
      .filter((line) => line.endsWith(' missing'))
      .map((line) => parseOid(line.slice(0, -' missing'.length)));
  }

  /**
   * Downloads the objects in `oids` the clone lacks, such as the files a diff shows, by ID:
   * {@link OBJECTS_PER_FETCH} at a time, one fetch each. Returns the ones still missing.
   */
  async download(
    oids: readonly Oid[],
    what = 'the files to show',
    options: { maxBytes?: number } = {},
  ): Promise<Oid[]> {
    return this.#locked(`downloading ${what}`, async () => {
      const missing = await this.missingObjects([...new Set(oids)]);
      for (let at = 0; at < missing.length; at += OBJECTS_PER_FETCH) {
        const batch = missing.slice(at, at + OBJECTS_PER_FETCH);
        await this.#fetch(what, [], { objects: batch, maxBytes: options.maxBytes });
      }
      return this.missingObjects(missing);
    });
  }

  /**
   * The ID of the tree `rev` names: `rev` itself for a tree, or a commit's root tree, which any
   * other commit with the same files shares. Reads only the commit, so it downloads nothing; a
   * `rev` the clone lacks is `notFetched`.
   */
  async treeId(rev: Oid): Promise<Oid> {
    return new TreeWalk(this.#reader).root(rev);
  }

  /**
   * The files in `rev`, a commit or a tree, with its symlinks and submodules, in git's order, by
   * path; folders aren't listed. It reads only trees, which a partial clone has, so it downloads
   * nothing. A file's size is known only once the clone has its contents: list the tree again
   * after {@link Repo.downloadFiles} for the sizes of what it brought. More than `maxEntries`
   * entries, {@link MAX_ENTRIES} unless it says otherwise, is `tooLarge`.
   */
  async tree(rev: Oid, options: { maxEntries?: number | undefined } = {}): Promise<TreeEntry[]> {
    const maxEntries = options.maxEntries ?? MAX_ENTRIES;
    await this.treeId(rev);
    const entries: TreeEntry[] = [];
    // Told not to download, `-l` prints `BAD` for the size of a file the clone lacks.
    const listing = this.#git().arg('ls-tree', '-r', '-z', '-l', '--full-tree', rev, '--');
    for await (const record of listing.records()) {
      // Stopping the listing stops git.
      if (entries.length === maxEntries) throw tooManyEntries(listing.display, maxEntries);
      entries.push(treeEntry(parseListed(record)));
    }
    return entries;
  }

  /**
   * Which of `paths`, files in `rev`, the clone lacks the contents of, in the order asked, each
   * once. It downloads nothing and takes no lock, so it works offline. Submodules are skipped, and
   * a path with no file at it in `rev` is `invalid`.
   */
  async lackingFiles(rev: Oid, paths: readonly Uint8Array[]): Promise<Buffer[]> {
    const files = await this.#filesAt(rev, paths);
    const lacking = new Set(await this.missingObjects(unique(files.map((file) => file.oid))));
    return files.filter((file) => lacking.has(file.oid)).map((file) => file.path);
  }

  /**
   * Downloads the contents of the files at `paths` in `rev` that the clone lacks, so reading them
   * needs no network, and returns the paths whose contents it still lacks, in the order asked.
   *
   * - Files the clone has are never waited for: what's missing is checked without the clone's
   *   lock, which is taken only to download, and then only for what another download didn't
   *   bring meanwhile.
   * - The rest come by ID, {@link OBJECTS_PER_FETCH} at a time, one fetch each, with the limits
   *   and progress of any fetch. More than 500 at once may be a whole tree, and has a first
   *   fetch's time to start.
   * - Opened to read offline, it downloads nothing and returns every path it lacks.
   * - Submodules are another repository's, so they're skipped. A path with no file at it in `rev`
   *   is `invalid`.
   */
  async downloadFiles(rev: Oid, paths: readonly Uint8Array[]): Promise<Buffer[]> {
    const files = await this.#filesAt(rev, paths);
    const lacking = await this.#downloadMissing(files.map((file) => file.oid));
    return files.filter((file) => lacking.has(file.oid)).map((file) => file.path);
  }

  /**
   * Each of `paths`, files in `rev`, once and in order, with its blob; submodules left out. Refuses
   * an empty path, one holding a NUL, or one with no file at it in `rev`.
   */
  async #filesAt(rev: Oid, paths: readonly Uint8Array[]): Promise<{ path: Buffer; oid: Oid }[]> {
    checkPaths(paths);
    const walk = new TreeWalk(this.#reader);
    const root = await walk.root(rev);
    const seen = new Set<string>();
    const files: { path: Buffer; oid: Oid }[] = [];
    for (const path of paths) {
      const bytes = Buffer.from(path);
      const key = bytes.toString('latin1');
      if (seen.has(key)) continue;
      seen.add(key);
      const found = await walk.find(root, bytes);
      if (found?.mode === 'submodule') continue;
      if (found === undefined || found.mode === 'folder') {
        throw new GitError({
          kind: 'invalid',
          what: 'file in the commit',
          value: bytes.toString('utf8'),
        });
      }
      files.push({ path: bytes, oid: found.oid });
    }
    return files;
  }

  /**
   * Downloads the objects of `oids` the clone lacks, as {@link Repo.downloadFiles} does, and
   * returns those it still lacks. With `downloads`, they bring no more than it has left, or it
   * throws {@link PastCap}, and stop once its signal aborts.
   */
  async #downloadMissing(oids: readonly Oid[], downloads?: Downloads): Promise<Set<Oid>> {
    const wanted = unique(oids);
    const missing = await this.missingObjects(wanted);
    if (missing.length === 0 || this.offline) return new Set(missing);
    const signal = downloads?.signal;
    const work = async () => {
      // Whatever held the lock may have brought some of them, or all.
      const still = await this.missingObjects(missing);
      for (let at = 0; at < still.length; at += OBJECTS_PER_FETCH) {
        const batch = still.slice(at, at + OBJECTS_PER_FETCH);
        const what =
          batch.length < still.length
            ? `${batch.length} of ${countFiles(still.length)}`
            : countFiles(batch.length);
        if (downloads === undefined) {
          await this.#fetch(what, [], { objects: batch });
          continue;
        }
        try {
          downloads.left -= await this.#fetch(what, [], {
            objects: batch,
            maxBytes: downloads.left,
            signal,
          });
        } catch (error) {
          if (isFetchFailure(error, 'tooLarge')) throw new PastCap();
          throw error;
        }
        // One that finished before its watch saw it pass the cap is past it all the same.
        if (downloads.left < 0) throw new PastCap();
      }
      return new Set(still.length === 0 ? [] : await this.missingObjects(still));
    };
    return this.#locked(`downloading ${countFiles(missing.length)}`, work, signal);
  }

  /**
   * The blobs on both sides of every file that changed from `from` to `to`, commits or trees, but
   * submodules: what reading their diff needs, to download first. It compares trees alone, so it
   * downloads nothing.
   */
  async changedObjects(from: Oid, to: Oid): Promise<Oid[]> {
    const command = this.#git().arg(
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--no-renames',
      '-z',
      '--raw',
      '--no-abbrev',
      from,
      to,
      '--',
    );
    const finished = await command.finish();
    if (finished.code !== 0) throw await this.#readFailure(command, finished, [from, to]);
    return rawDiffBlobs(finished.stdout);
  }

  /**
   * What changed from `from` to `to`, commits or trees, in git's order, by path: renames found,
   * binary files marked, and each side's mode, blob and size. Both sides of every changed file must
   * be in the clone ({@link Repo.changedObjects} says which they are), or it's `notDownloaded`.
   * With `paths`, only files at those paths, on either side, are listed, out of every change:
   * renames are found among them all.
   */
  async changedFiles(
    from: Oid,
    to: Oid,
    options: {
      paths?: readonly Uint8Array[] | undefined;
      /** The most files to read, past which it's `tooLarge`: {@link MAX_ENTRIES} unless it says. */
      maxEntries?: number | undefined;
    } = {},
  ): Promise<ChangedFile[]> {
    const command = this.#git().arg(
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '-z',
      '-M',
      '--raw',
      '--numstat',
      '--no-abbrev',
      from,
      to,
      '--',
    );
    const finished = await command.finish();
    if (finished.code !== 0) {
      throw await this.#readFailure(command, finished, [from, to], () =>
        this.changedObjects(from, to),
      );
    }
    let files = parseChanges(finished.stdout, options.maxEntries);
    if (options.paths !== undefined) {
      checkPaths(options.paths);
      const wanted = new Set(options.paths.map((path) => Buffer.from(path).toString('latin1')));
      const listed = (version: FileVersion | undefined) =>
        version !== undefined && wanted.has(version.path.toString('latin1'));
      files = files.filter((file) => listed(file.old) || listed(file.new));
    }
    return this.#withSizes(files);
  }

  /** `files`, with each side's size but a submodule's, from what the clone has. */
  async #withSizes(files: readonly ChangedFile[]): Promise<ChangedFile[]> {
    const versions = files.flatMap((file) =>
      [file.old, file.new].filter(
        (version) => version !== undefined && version.mode !== 'submodule',
      ),
    );
    if (versions.length === 0) return [...files];
    const sizes = await this.#sizes(versions.flatMap((version) => version?.oid ?? []));
    const sized = (version: FileVersion | undefined) =>
      version === undefined || version.mode === 'submodule'
        ? version
        : { ...version, size: sizes.get(version.oid) };
    return files.map((file) => ({ ...file, old: sized(file.old), new: sized(file.new) }));
  }

  /**
   * The error for a read that failed: `notFetched` for a commit of `revs` the clone lacks, then
   * `notDownloaded` for the files of `needs()` it lacks, else git's own.
   */
  async #readFailure(
    command: GitCommand,
    finished: Finished,
    revs: readonly Oid[],
    needs?: () => Promise<Oid[]>,
  ): Promise<GitError> {
    for (const rev of revs) {
      if ((await this.#reader.info(rev)) === undefined)
        return new GitError({ kind: 'notFetched', oid: rev });
    }
    const lacking = needs === undefined ? [] : await this.missingObjects(await needs());
    if (lacking.length > 0) return new GitError({ kind: 'notDownloaded', oids: lacking });
    return GitError.fromGit(command.display, failureMessage(finished));
  }

  /**
   * The contents of blob `oid`, such as a {@link FileVersion}'s, or `undefined` when the clone
   * lacks it. It never downloads: {@link Repo.download} it first. One larger than `maxBytes` is
   * never read, and fails as `tooLarge`. A submodule's commit isn't in this repository: never read
   * one.
   */
  async readBlob(
    oid: Oid,
    options: { maxBytes?: number | undefined } = {},
  ): Promise<Buffer | undefined> {
    const object = await this.#reader.read(oid, options.maxBytes);
    if (object === undefined) return undefined;
    if (object.type !== 'blob') {
      throw new GitError({
        kind: 'git',
        command: 'git cat-file --batch-command',
        message: `${oid} is a ${object.type}, not a file`,
      });
    }
    return object.data;
  }

  /**
   * The contents of the file at `path` in `rev`, a commit or a tree, or `undefined` when there's
   * no file there. One whose contents the clone lacks is `notDownloaded`; a folder or a submodule
   * there is an error.
   */
  async readFile(
    rev: Oid,
    path: Uint8Array,
    options: { maxBytes?: number | undefined } = {},
  ): Promise<Buffer | undefined> {
    const found = await this.#fileAt(rev, path);
    if (found === undefined) return undefined;
    if (found.mode === 'submodule') throw notAFile(path, 'submodule');
    const contents = await this.readBlob(found.oid, options);
    if (contents === undefined) throw new GitError({ kind: 'notDownloaded', oids: [found.oid] });
    return contents;
  }

  /**
   * The file at `path` in `rev`, a commit or a tree, as a changed file's side has it: its blob,
   * mode, and size once the clone has its contents, or for a submodule the commit it points at.
   * `undefined` when there's no file there; a folder there is an error. Reads only trees and what
   * the clone has, so it downloads nothing.
   */
  async fileVersion(rev: Oid, path: Uint8Array): Promise<FileVersion | undefined> {
    const found = await this.#fileAt(rev, path);
    if (found === undefined) return undefined;
    const version = { path: Buffer.from(path), oid: found.oid, mode: found.mode };
    if (found.mode === 'submodule') return version;
    return { ...version, size: (await this.#reader.info(found.oid))?.size };
  }

  /**
   * What's at each of `paths` in `rev`, a commit or a tree, in the order asked: a file, symlink or
   * submodule as {@link Repo.fileVersion} gives it, `folder`, or `undefined` for nothing. One walk
   * reads each tree once, however many of the paths go through it, and the sizes come in one
   * batch, so a large tree costs its size once rather than once a path. It downloads nothing.
   */
  async fileVersions(
    rev: Oid,
    paths: readonly Uint8Array[],
  ): Promise<(FileVersion | 'folder' | undefined)[]> {
    checkPaths(paths);
    const walk = new TreeWalk(this.#reader);
    const root = await walk.root(rev);
    const found: (Found | undefined)[] = [];
    for (const path of paths) found.push(await walk.find(root, path));
    const blobs = found.flatMap((entry) =>
      entry === undefined || entry.mode === 'folder' || entry.mode === 'submodule'
        ? []
        : [entry.oid],
    );
    const sizes = await this.#sizes(blobs);
    return found.map((entry, index) => {
      if (entry === undefined) return undefined;
      if (entry.mode === 'folder') return 'folder';
      const version = { path: Buffer.from(paths[index] ?? []), oid: entry.oid, mode: entry.mode };
      return entry.mode === 'submodule' ? version : { ...version, size: sizes.get(entry.oid) };
    });
  }

  /**
   * The size of each of `oids`, in the order asked, or `undefined` for one the clone lacks: one
   * batch, which downloads nothing.
   */
  async objectSizes(oids: readonly Oid[]): Promise<(number | undefined)[]> {
    const sizes = await this.#sizes(oids);
    return oids.map((oid) => sizes.get(oid));
  }

  /** The size of each of `oids` the clone has, by ID, from one `git cat-file --batch-check`. */
  async #sizes(oids: readonly Oid[]): Promise<Map<string, number>> {
    const sizes = new Map<string, number>();
    const wanted = unique(oids);
    if (wanted.length === 0) return sizes;
    const output = await this.#git()
      .arg('cat-file', '--batch-check=%(objectname) %(objectsize)')
      .run(wanted.map((oid) => `${oid}\n`).join(''));
    for (const line of lines(output)) {
      const [oid = '', size = ''] = line.split(' ');
      if (/^\d+$/.test(size)) sizes.set(oid, Number(size));
    }
    return sizes;
  }

  /** What's at `path` in `rev`: a file, symlink or submodule, nothing, or an error for a folder. */
  async #fileAt(rev: Oid, path: Uint8Array): Promise<(Found & { mode: FileMode }) | undefined> {
    checkPaths([path]);
    const walk = new TreeWalk(this.#reader);
    const found = await walk.find(await walk.root(rev), path);
    if (found?.mode === 'folder') throw notAFile(path, 'tree');
    return found === undefined ? undefined : { ...found, mode: found.mode };
  }

  /**
   * The patch of the file at `path` from `base` to `head`, as GitHub gives a pull request's changed
   * file, so its hunks are the lines GitHub takes comments on: for a file whose patch GitHub leaves
   * out, or a revision other than the latest, whose patch it doesn't give.
   *
   * - `base` is where the diff starts: for a revision's whole diff, its merge base with the base
   *   branch, as GitHub diffs a pull request.
   * - `oldPath` is the file's path in `base` when it was renamed, as {@link Repo.changedFiles} and
   *   GitHub's `previous_filename` give it. Its two versions are compared whatever their
   *   similarity. Without one, or with one `base` has no file at, the file at `path` in `base` is.
   * - It's git's Myers diff of the two blobs, with three lines of context and the indent
   *   heuristic, and no setting of the clone's: no external diff, no text conversion and no
   *   attributes. GitHub's patch ignores attributes too, so a file `.gitattributes` calls binary
   *   still has hunks.
   * - A file added or deleted is compared with nothing, and a submodule's commits show as
   *   `Subproject commit` lines, as git shows them, never fetching either.
   * - Both versions' contents must be in the clone, or it's `notDownloaded`.
   * - Neither version may be larger than `maxBytes`, {@link PATCH_LIMIT} unless it says otherwise,
   *   and the patch may hold no more than {@link MAX_PATCH_LINES} lines, or it's `tooLarge`: a
   *   pull request's author decides how large its files are.
   */
  async patch(
    base: Oid,
    head: Oid,
    path: Uint8Array,
    oldPath?: Uint8Array,
    options: { maxBytes?: number | undefined } = {},
  ): Promise<FilePatch> {
    const maxBytes = options.maxBytes ?? PATCH_LIMIT;
    checkPaths(oldPath === undefined ? [path] : [path, oldPath]);
    const walk = new TreeWalk(this.#reader);
    const [baseTree, headTree] = [await walk.root(base), await walk.root(head)];
    const at = async (tree: Oid, where: Uint8Array) => {
      const found = await walk.find(tree, where);
      return found?.mode === 'folder' ? undefined : found;
    };
    const now = await at(headTree, path);
    let old = await at(baseTree, path);
    if (oldPath !== undefined && !Buffer.from(oldPath).equals(Buffer.from(path))) {
      const renamed = await at(baseTree, oldPath);
      const files = renamed?.mode !== 'submodule' && now !== undefined && now.mode !== 'submodule';
      if (renamed !== undefined && files) old = renamed;
    }
    if (old === undefined && now === undefined) return UNCHANGED;
    if (old !== undefined && now !== undefined && old.oid === now.oid) return UNCHANGED;
    // Each side's size first, so that a file too large is never read.
    const lacking = [];
    for (const side of [old, now]) {
      if (side === undefined || side.mode === 'submodule') continue;
      const info = await this.#reader.info(side.oid);
      if (info === undefined) lacking.push(side.oid);
      else if (info.size > maxBytes) throw patchTooLarge(maxBytes);
    }
    if (lacking.length > 0) throw new GitError({ kind: 'notDownloaded', oids: lacking });
    if (
      old?.mode === 'submodule' ||
      now?.mode === 'submodule' ||
      old === undefined ||
      now === undefined
    ) {
      // Compared with nothing, or a submodule's line: every line changed.
      const contents = async (side: Found | undefined) => {
        if (side === undefined) return undefined;
        if (side.mode === 'submodule') return submoduleLine(side.oid);
        const blob = await this.readBlob(side.oid, { maxBytes });
        if (blob === undefined) throw new GitError({ kind: 'notDownloaded', oids: [side.oid] });
        return blob;
      };
      const whole = wholeFilePatch(await contents(old), await contents(now));
      if (whole === null) throw patchTooLarge(MAX_PATCH_LINES, 'lines');
      return whole;
    }
    const output = await this.#git()
      .arg(
        // The one diff setting no option overrides: a blank unchanged line keeps its space.
        '-c',
        'diff.suppressBlankEmpty=false',
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '--unified=3',
        '--inter-hunk-context=0',
        '--diff-algorithm=myers',
        '--indent-heuristic',
        old.oid,
        now.oid,
        '--',
      )
      // Each line of both sides, with its sign, and git's header.
      .run(undefined, { maxBytes: 4 * maxBytes + 64 * 1024 });
    if (lineCount(output) > MAX_PATCH_LINES + 8) throw patchTooLarge(MAX_PATCH_LINES, 'lines');
    return patchFromDiff(output);
  }

  /**
   * The parents of commit `oid`, its first parent first: two or more for a merge, none for a root
   * commit. It must be in the clone already, or it's `notFetched`; it's never downloaded.
   */
  async parents(oid: Oid): Promise<Oid[]> {
    if (!(await this.hasCommit(oid))) throw new GitError({ kind: 'notFetched', oid });
    const output = await this.#git().arg('rev-list', '--parents', '--no-walk', oid, '--').run();
    // The commit, then its parents.
    return output.toString('utf8').trim().split(/\s+/).slice(1).map(parseOid);
  }

  /**
   * The parents of the commit that merged `head` into `tip`'s first-parent history, first parent
   * first: the oldest commit on it that has `head` in its own. For a pull request merged with a
   * merge commit, that's the merge, whose first parent is where the base branch was just before.
   * `undefined` when `tip` doesn't hold `head`, or is `head`. Both must be in the clone already, or
   * it's `notFetched`.
   */
  async mergedBy(head: Oid, tip: Oid): Promise<Oid[] | undefined> {
    for (const oid of [head, tip]) {
      if (!(await this.hasCommit(oid))) throw new GitError({ kind: 'notFetched', oid });
    }
    if (head === tip || !(await this.isAncestor(head, tip))) return undefined;
    const output = await this.#git()
      .arg(
        'rev-list',
        '--first-parent',
        '--ancestry-path',
        '--reverse',
        '--parents',
        `${head}..${tip}`,
        '--',
      )
      .run();
    const [first] = lines(output);
    return first === undefined ? undefined : first.split(' ').slice(1).map(parseOid);
  }

  /**
   * What the `.gitattributes` files in commit `rev` say about `attribute` for each of `paths`, in
   * the same order, from the files the clone has: a path that a `.gitattributes` the clone lacks
   * may apply to, in its folder or one above, gets `undefined` ({@link Repo.downloadAttributes}
   * brings them). Paths are bytes and needn't exist in `rev`: a file the commit deletes still
   * matches its patterns.
   *
   * git reads the files from the commit itself (`check-attr --source`), so the answer is the
   * commit's, never a checkout's or the user's, and patterns match case-sensitively, as on GitHub,
   * whatever the disk. One `git check-attr --stdin` answers every path. When more than
   * {@link MAX_ATTRIBUTE_FILES} files apply, it reads none: `tooManyAttributeFiles`.
   */
  async attribute(
    rev: Oid,
    attribute: string,
    paths: readonly Uint8Array[],
  ): Promise<(Attribute | undefined)[]> {
    checkAttributeQuestion(attribute, paths);
    if (paths.length === 0) return [];
    const files = await this.#attributeFilesAt(rev, paths);
    const lacking = new Set(await this.missingObjects(unique(files.map((file) => file.oid))));
    const folders = new Set(
      files.filter((file) => lacking.has(file.oid)).map((file) => attributeFolder(file.path)),
    );
    const known = paths.filter((path) => answerable(path, folders));
    const answers = known.length === 0 ? [] : await this.#checkAttr(rev, attribute, known);
    let next = 0;
    return paths.map((path) => (answerable(path, folders) ? answers[next++] : undefined));
  }

  /**
   * Downloads the `.gitattributes` files in `rev` that apply to `paths` and the clone lacks, in
   * one fetch, as {@link Repo.downloadFiles} does, and returns the ones it still lacks. When more
   * than {@link MAX_ATTRIBUTE_FILES} apply, it downloads none: `tooManyAttributeFiles`.
   */
  async downloadAttributes(rev: Oid, paths: readonly Uint8Array[]): Promise<Buffer[]> {
    checkPaths(paths);
    if (paths.length === 0) return [];
    const files = await this.#attributeFilesAt(rev, paths);
    const lacking = await this.#downloadMissing(files.map((file) => file.oid));
    return files.filter((file) => lacking.has(file.oid)).map((file) => file.path);
  }

  /**
   * The `.gitattributes` files in `rev` that apply to `paths`, in their folders and the folders
   * above, refusing more than {@link MAX_ATTRIBUTE_FILES}. Reads only trees.
   */
  async #attributeFilesAt(
    rev: Oid,
    paths: readonly Uint8Array[],
  ): Promise<{ path: Buffer; oid: Oid }[]> {
    const walk = new TreeWalk(this.#reader);
    const root = await walk.root(rev);
    const found: { path: Buffer; oid: Oid }[] = [];
    for (const path of attributeFiles(paths)) {
      const entry = await walk.find(root, path);
      if (entry !== undefined && entry.mode !== 'folder' && entry.mode !== 'submodule') {
        found.push({ path, oid: entry.oid });
      }
    }
    if (found.length > MAX_ATTRIBUTE_FILES) {
      throw new GitError({
        kind: 'tooManyAttributeFiles',
        found: found.length,
        limit: MAX_ATTRIBUTE_FILES,
      });
    }
    return found;
  }

  /** What `git check-attr` says of `attribute` for each of `paths` in `rev`. */
  async #checkAttr(
    rev: Oid,
    attribute: string,
    paths: readonly Uint8Array[],
  ): Promise<Attribute[]> {
    const input = Buffer.concat(paths.flatMap((path) => [path, Buffer.from([0])]));
    const command = this.#git().arg(
      // A Mac's clone says its disk ignores case, which would make `Dist/**` match `dist/app.js`.
      // GitHub's patterns, and the commit's paths, are case-sensitive.
      '-c',
      'core.ignorecase=false',
      'check-attr',
      `--source=${rev}`,
      '-z',
      '--stdin',
      attribute,
    );
    const finished = await command.finish(input);
    // When it can't read the commit or a `.gitattributes` file, git says so, and may answer
    // "unspecified" anyway and exit 0.
    if (finished.code !== 0 || finished.stderr.includes('fatal:')) {
      throw GitError.fromGit(command.display, failureMessage(finished));
    }
    const answers = parseCheckAttr(finished.stdout, attribute, paths);
    if (answers === undefined) {
      throw new GitError({
        kind: 'git',
        command: command.display,
        message: `printed something other than one answer for each of ${paths.length} paths`,
      });
    }
    return answers;
  }

  /**
   * Compares revision `old` of a pull request with `now`, showing only what the author changed
   * between them, even when the base moved.
   *
   * When the bases differ, as after a rebase, the old revision's changes are replayed onto the new
   * base in the clone (`git merge-tree --write-tree --merge-base=<old base> <new base> <old head>`,
   * following folders the base renamed), and the tree that makes is compared with the new head, so
   * changes that came with the new base cancel out. When the bases match, it compares the heads.
   * When the replay conflicts, it compares the heads too, and lists every file it conflicted on
   * with how the author resolved it; any other failure is an error. An unchanged head whose base
   * moved still gets the replay, which shows how its patch changed; that, and a base that moved
   * anywhere but forward, is flagged as `retargeted`.
   *
   * - Every commit must be in the clone already, or it's `notFetched`, and a base that isn't its
   *   head or one of its ancestors is `baseNotAncestor`.
   * - It downloads what it needs, as {@link Repo.downloadFiles} does: first the files both sides
   *   changed, which the replay merges, and what finding the files either side moved needs; then
   *   both sides of each file the comparison lists. A replay of changes each made on one side
   *   alone needs no file. Opened offline, it downloads nothing, and lacking anything is
   *   `notDownloaded`.
   * - Its downloads may bring `maxBytes` in all, {@link COMPARE_LIMIT} unless it says otherwise,
   *   counted as they come, compressed, past which they're stopped and the comparison is refused:
   *   never part of one. Once `signal` aborts, its downloads and its replay stop, and the
   *   comparison fails with its reason.
   * - The replay's tree, and the files merged into it, exist only in the clone. The tree is
   *   pinned, at `refs/lo/replays/<tree>`, while a repository has the clone open, so keep one open
   *   while showing a comparison; the next open of the clone with none open removes the pins.
   *   Comparing the same revisions again makes the same tree.
   * - With `paths`, only files at those paths, on either side, are listed, as
   *   {@link Repo.changedFiles} lists them.
   */
  async compareRevisions(
    old: Revision,
    now: Revision,
    options: {
      paths?: readonly Uint8Array[] | undefined;
      maxBytes?: number | undefined;
      signal?: AbortSignal | undefined;
    } = {},
  ): Promise<Comparison | ComparisonRefused> {
    options.signal?.throwIfAborted();
    const limit = options.maxBytes ?? COMPARE_LIMIT;
    const downloads: Downloads = { left: limit, signal: options.signal };
    try {
      return await this.#compare(old, now, options.paths, downloads);
    } catch (error) {
      if (!(error instanceof PastCap)) throw error;
      this.#cache.note(
        `${this.name}: comparing ${old.head.slice(0, 7)} with ${now.head.slice(0, 7)} needs ` +
          `more than ${formatMegabytes(limit)} of files, so Lo refused it`,
      );
      return { refused: 'tooLarge', limit };
    }
  }

  async #compare(
    old: Revision,
    now: Revision,
    paths: readonly Uint8Array[] | undefined,
    downloads: Downloads,
  ): Promise<Comparison> {
    // Never downloaded: git would bring a missing commit with all its history.
    for (const oid of [old.base, old.head, now.base, now.head]) {
      if (!(await this.hasCommit(oid))) throw new GitError({ kind: 'notFetched', oid });
    }
    // A base the head doesn't contain would show the changes between them as the author's.
    for (const revision of [old, now]) {
      if (!(await this.isAncestor(revision.base, revision.head))) {
        throw new GitError({ kind: 'baseNotAncestor', base: revision.base, head: revision.head });
      }
    }
    if (old.base === now.base) {
      const files = await this.#compared([[old.head, now.head]], paths, downloads);
      return {
        files: (files[0] ?? []).map((change) => ({ path: changedPath(change), change })),
        old: old.head,
        new: now.head,
        replay: { kind: 'sameBase' },
      };
    }
    // A rebase moves the base forward and the head with it. Otherwise what shows can have come
    // with the base.
    const retargeted = old.head === now.head || !(await this.isAncestor(old.base, now.base));
    const replayed = await replayPinned(
      () => this.#replay(old, now.base, downloads),
      (tree) => this.#pinReplay(tree),
      this.#replays,
      (line) => this.#cache.note(`${this.name}: ${line}`),
    );
    if (replayed.kind === 'clean') {
      const [files = []] = await this.#compared([[replayed.tree, now.head]], paths, downloads);
      return {
        files: files.map((change) => ({ path: changedPath(change), change })),
        old: replayed.tree,
        new: now.head,
        replay: { kind: retargeted ? 'retargeted' : 'clean' },
      };
    }
    const labels = [now.base, old.head];
    let conflicted = conflictedPaths(replayed.paths, labels);
    if (paths !== undefined) {
      const wanted = new Set(paths.map((path) => Buffer.from(path).toString('latin1')));
      conflicted = conflicted.filter((path) => wanted.has(path.toString('latin1')));
    }
    this.#cache.note(
      `${this.name}: replaying ${old.head.slice(0, 7)} onto ${now.base.slice(0, 7)} conflicted ` +
        `(${conflicted.length === 0 ? 'no file left conflicted' : countFiles(conflicted.length)}), ` +
        'so comparing the heads',
    );
    const [plain = [], resolutions = []] = await this.#compared(
      [
        [old.head, now.head],
        [replayed.tree, now.head],
      ],
      paths,
      downloads,
    );
    return {
      files: withConflicts(plain, conflicted, resolutions, labels),
      old: old.head,
      new: now.head,
      replay: { kind: 'conflicted', tree: replayed.tree, retargeted },
    };
  }

  /**
   * The files that changed between each pair of `pairs`, both sides of every one downloaded first
   * in one go, unless the clone was opened offline.
   */
  async #compared(
    pairs: readonly (readonly [Oid, Oid])[],
    paths: readonly Uint8Array[] | undefined,
    downloads: Downloads,
  ): Promise<ChangedFile[][]> {
    const needs: Oid[] = [];
    for (const [from, to] of pairs) needs.push(...(await this.changedObjects(from, to)));
    await this.#downloadMissing(needs, downloads);
    const lists: ChangedFile[][] = [];
    for (const [from, to] of pairs) lists.push(await this.changedFiles(from, to, { paths }));
    return lists;
  }

  /**
   * Replays `old`'s changes onto `onto`, writing the tree but no ref, with what the merge needs
   * downloaded first. A git that gives up on a file the clone lacks names it: what finding moved
   * files needs is hard to tell beforehand, so the replay is tried once more with every file
   * either side changed.
   */
  async #replay(old: Revision, onto: Oid, downloads: Downloads): Promise<Replayed> {
    await this.#downloadMissing(await this.#replayNeeds(old, onto), downloads);
    for (let attempt = 0; ; attempt++) {
      const command = this.#git().arg(
        // A file the old revision added to a folder the base renamed goes where a rebase puts it,
        // into the renamed folder, rather than conflicting. If the author put it somewhere else,
        // the comparison shows that as a rename.
        '-c',
        'merge.directoryRenames=true',
        'merge-tree',
        '--write-tree',
        '-z',
        '--name-only',
        '--no-messages',
        `--merge-base=${old.base}`,
        onto,
        old.head,
      );
      const finished = await command.finish(undefined, { signal: downloads.signal });
      downloads.signal?.throwIfAborted();
      const lacked = finished.code === 0 ? undefined : lackedObject(finished.stderr);
      if (lacked === undefined) return readReplay(command.display, finished);
      if (attempt > 0 || this.offline)
        throw new GitError({ kind: 'notDownloaded', oids: [lacked] });
      this.#cache.note(
        `${this.name}: replaying ${old.head.slice(0, 7)} needed ${lacked}, so downloading what either side changed`,
      );
      const everything = [
        ...(await this.changedObjects(old.base, onto)),
        ...(await this.changedObjects(old.base, old.head)),
      ];
      const still = await this.#downloadMissing(everything, downloads);
      if (still.size > 0) throw new GitError({ kind: 'notDownloaded', oids: [...still] });
    }
  }

  /**
   * The files replaying `old` onto `onto` reads, as git's merge finds them: the three versions of
   * each file both sides changed, which it merges; and, where one side deleted a file the other
   * changed, or emptied a folder the other added to, the files that side deleted and added, among
   * which it looks for where the file or folder went. A file moved without a change is found by
   * its ID, with no contents.
   */
  async #replayNeeds(old: Revision, onto: Oid): Promise<Oid[]> {
    const raw = async (to: Oid) => {
      const output = await this.#git()
        .arg(
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--no-color',
          '--no-renames',
          '-z',
          '--raw',
          '--no-abbrev',
          old.base,
          to,
          '--',
        )
        .run();
      return new Map(
        parseRawRecords(output).map((record) => [record.path.toString('latin1'), record]),
      );
    };
    const sides = [
      { changes: await raw(onto), tree: onto },
      { changes: await raw(old.head), tree: old.head },
    ];
    const needs = new Set<Oid>();
    const need = (mode: string | undefined, oid: Oid) => {
      if (mode !== undefined && mode !== 'submodule' && !/^0+$/.test(oid)) needs.add(oid);
    };
    const [baseSide, headSide] = sides;
    if (baseSide === undefined || headSide === undefined) return [];
    for (const [path, change] of baseSide.changes) {
      const other = headSide.changes.get(path);
      if (other === undefined) continue;
      need(change.oldMode, change.oldOid);
      need(change.newMode, change.newOid);
      need(other.newMode, other.newOid);
    }
    const walk = new TreeWalk(this.#reader);
    for (const [side, other] of [
      [baseSide, headSide],
      [headSide, baseSide],
    ] as const) {
      const records = [...side.changes.values()];
      const added = records.filter((record) => record.status === 'A');
      const addedOids = new Set(added.map((record) => record.newOid));
      const otherAdded = [...other.changes.values()]
        .filter((record) => record.status === 'A')
        .map((record) => record.path.toString('latin1'));
      const root = await walk.root(side.tree);
      const relevant = [];
      for (const record of records) {
        // Moved without a change, it's found by its ID.
        if (record.status !== 'D' || addedOids.has(record.oldOid)) continue;
        const path = record.path.toString('latin1');
        const changedThere = other.changes.get(path);
        if (changedThere !== undefined && changedThere.status !== 'D') {
          relevant.push(record);
          continue;
        }
        // A folder this side emptied, which the other side added to.
        for (let end = path.indexOf('/'); end !== -1; end = path.indexOf('/', end + 1)) {
          const folder = path.slice(0, end);
          const emptied = (await walk.find(root, Buffer.from(folder, 'latin1'))) === undefined;
          if (emptied && otherAdded.some((each) => each.startsWith(`${folder}/`))) {
            relevant.push(record);
            break;
          }
        }
      }
      if (relevant.length === 0) continue;
      for (const record of relevant) {
        need(record.oldMode, record.oldOid);
        const there = other.changes.get(record.path.toString('latin1'));
        if (there !== undefined) need(there.newMode, there.newOid);
      }
      for (const record of added) need(record.newMode, record.newOid);
    }
    return [...needs];
  }

  /**
   * Pins replayed tree `tree` at `refs/lo/replays/<tree>`, and says whether the tree is there once
   * pinned. No lock: only replays write these refs, each always to its own tree.
   */
  async #pinReplay(tree: Oid): Promise<boolean> {
    await this.#git().arg('update-ref', `${REPLAYS}${tree}`, tree).run();
    return this.hasTree(tree);
  }

  /** Whether tree `oid` is in the clone. Never downloads anything. */
  async hasTree(oid: Oid): Promise<boolean> {
    return (await this.#reader.info(oid))?.type === 'tree';
  }

  /**
   * Checks `head` out, detached, for pull request `number`, and returns its folder,
   * `<cache>/checkouts/github.com/<owner>/<repo>/pull-<n>/<head>`: a worktree of the clone. Each
   * head has a checkout of its own, so a window showing one never sees its files change to
   * another's. Checked out again, it holds only what git put there.
   *
   * Only for repositories the user trusts: a checkout is what language servers run in, and the
   * caller decides. Its files download first, in a fetch with the limits and progress of any,
   * since they may be the whole tree. No hook, filter or attribute runs or applies, symlinks
   * become plain files holding their target, so nothing in a checkout points outside it, and no
   * path a Mac's or Windows' disk would take for `.git` is written. The commit must be in the
   * clone already, or it's `notFetched`. A link anywhere on the way to the checkout's folder, in
   * the cache, is an error: nothing is written through it. git writes by path, so a link put there
   * after the look, by a program running as the user, as a language server in a checkout does,
   * would be followed. Such a program can write anywhere the user can already: the look keeps out
   * links left in the cache, not a program racing it.
   */
  async checkout(number: number, head: Oid): Promise<string> {
    checkNumber(number);
    const folder = join(this.#checkouts, `pull-${number}`, head);
    return this.#locked(`checking out pull request #${number}`, async () => {
      if (!(await this.#cache.linkFree(folder))) throw linkInTheWay(folder);
      if (!(await this.hasCommit(head))) throw new GitError({ kind: 'notFetched', oid: head });
      await this.#downloadTree(`pull request #${number}'s files`, head);
      const gitDir = await checkoutGitDir(this.folder, folder);
      if (gitDir !== undefined) {
        try {
          const there = () => this.#runner.command({ gitDir, workTree: folder });
          await there().arg('checkout', '--quiet', '--force', '--detach', head, '--').run();
          await there().arg('clean', '-ffdxq').run();
          await stampUsed(gitDir);
          return folder;
        } catch (error) {
          // One in a bad state is made again.
          this.#cache.note(
            `${this.name}: checking out ${head.slice(0, 7)} again, since ${String(error)}`,
          );
        }
      }
      if (!(await this.#cache.trash(folder))) throw linkInTheWay(folder);
      try {
        await mkdir(dirname(folder), { recursive: true });
      } catch (error) {
        throw GitError.io(`making ${dirname(folder)}`, error);
      }
      // Forget the checkouts whose folders are gone, such as this one.
      await this.#git().arg('worktree', 'prune').run();
      await this.#git()
        .arg('worktree', 'add', '--quiet', '--force', '--detach')
        .path(folder)
        .arg(head)
        .run();
      const made = await checkoutGitDir(this.folder, folder);
      if (made !== undefined) await stampUsed(made);
      return folder;
    });
  }

  /**
   * Downloads the files of `rev`'s tree the clone lacks, in fetches with the limits of any, with a
   * first fetch's time to start: a checkout's git would download them itself, with no limit but
   * curl's stall guard, which GitHub's keep-alives defeat. The lock is held.
   */
  async #downloadTree(what: string, rev: Oid): Promise<void> {
    // `--missing=print` lists what the clone lacks as `?<oid>`, and never downloads it.
    const listed = await this.#git()
      .arg('rev-list', '--objects', '--no-walk', '--no-object-names', '--missing=print', rev, '--')
      .run();
    const missing = lines(listed)
      .filter((line) => line.startsWith('?'))
      .map((line) => parseOid(line.slice(1)));
    for (let at = 0; at < missing.length; at += OBJECTS_PER_FETCH) {
      const batch = missing.slice(at, at + OBJECTS_PER_FETCH);
      await this.#fetch(what, [], { objects: batch, whole: true });
    }
  }

  /**
   * The blob ID git would give the file at `path` in `checkout`, one of this clone's checkouts,
   * hashing its bytes as they are on disk, without the conversions `.gitattributes` asks for:
   * `undefined` when there's no regular file there, as for a folder, a submodule's empty folder or
   * a link, or a link on the way to it. A path that would leave the checkout, or one holding a
   * backslash, which Windows takes as a separator, or a folder that isn't one of the clone's
   * checkouts, is `invalid`.
   *
   * A checkout's file can differ from the head's blob: changed on disk, or two names that differ
   * only in case sharing one file on a disk that folds them together. Compare before letting a
   * checkout's file stand in for git's.
   */
  async hashCheckoutFile(checkout: string, path: Uint8Array): Promise<Oid | undefined> {
    const bytes = Buffer.from(path);
    const names = bytes.toString('latin1').split('/');
    if (names.some(badCheckoutName)) {
      throw new GitError({
        kind: 'invalid',
        what: 'path in a checkout',
        value: displayPath(bytes),
      });
    }
    if ((await checkoutGitDir(this.folder, checkout)) === undefined) {
      throw new GitError({ kind: 'invalid', what: 'checkout', value: checkout });
    }
    // Every folder on the way a folder itself, never a link, looked at before the file is opened
    // and again after, below.
    const at = Buffer.concat([
      Buffer.from(checkout),
      ...names.flatMap((name) => [Buffer.from('/'), Buffer.from(name, 'latin1')]),
    ]);
    if (!(await foldersOnTheWay(checkout, names))) return undefined;
    // And the file opened without following a link, so one put there since is never read through,
    // and without waiting, so a pipe put there is never waited on.
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
    let file: FileHandle;
    try {
      file = await open(at, flags);
    } catch (error) {
      if (error instanceof Error && 'code' in error && FILE_NOT_THERE.has(String(error.code))) {
        return undefined;
      }
      throw GitError.io(`reading ${displayPath(bytes)} in ${checkout}`, error);
    }
    try {
      const found = await file.stat();
      if (!found.isFile()) return undefined;
      // Node opens by path, never relative to a folder already opened, so a folder on the way could
      // have been swapped for a link between the look and the open: the same folders, and the same
      // file at the path, afterwards say it wasn't. What's left is a hard link in the checkout to a
      // file elsewhere, which is the checkout's file as much as any.
      const there = await lstat(at).catch(() => undefined);
      const same = there?.isFile() && there.dev === found.dev && there.ino === found.ino;
      if (!same || !(await foldersOnTheWay(checkout, names))) return undefined;
      // As git hashes a blob, read a piece at a time, however large the file.
      const hash = createHash('sha1');
      hash.update(`blob ${found.size}\0`);
      const buffer = Buffer.alloc(64 * 1024);
      for (;;) {
        const { bytesRead } = await file.read(buffer, 0, buffer.length);
        if (bytesRead === 0) break;
        hash.update(buffer.subarray(0, bytesRead));
      }
      return parseOid(hash.digest('hex'));
    } catch (error) {
      throw GitError.io(`reading ${displayPath(bytes)} in ${checkout}`, error);
    } finally {
      await file.close().catch(() => undefined);
    }
  }

  /** Runs `work` holding the clone's lock, having noted that the clone was used. */
  async #locked<T>(what: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.offline) {
      throw new GitError({ kind: 'readOnly', name: this.name, what: 'fetch' });
    }
    const release = await this.#lock.acquire(what, this.#progress, { signal });
    try {
      await stampUsed(this.folder);
      return await work();
    } finally {
      release();
      // Once the lock is free: keeping the cache in bounds takes other clones' locks.
      if (this.#madeClone) {
        this.#madeClone = false;
        await this.#cache.madeClone();
      }
    }
  }

  /** Fetches commit `oid` by ID unless the clone has it, and pins it at `pin`. */
  async #fetchById(what: string, oid: Oid, pin: string): Promise<void> {
    if (!(await this.hasCommit(oid))) {
      await this.#fetch(what, [`+${oid}:${pin}`]).catch((error: unknown) => {
        if (isLostCommit(error, oid)) throw new GitError({ kind: 'unavailable', oid });
        throw error;
      });
    }
    // Also checks it's a commit.
    await this.#resolve(oid);
    await this.#pin([[pin, oid]]);
  }

  /** {@link Repo.fetchCommits} for `pins`, with the lock held. */
  async #fetchPinned(number: number, oids: readonly Oid[], pins: Pins): Promise<Oid[]> {
    const wanted = [...new Set(oids)];
    const lostBefore = await this.#remembered(number, pins);
    const present = await this.#commitsPresent(wanted);
    const unavailable: Oid[] = [];
    const missing: Oid[] = [];
    for (const [index, oid] of wanted.entries()) {
      if (present[index]) continue;
      if (lostBefore.includes(oid)) unavailable.push(oid);
      else missing.push(oid);
    }
    const what = describePins(pins, number, missing);
    // GitHub stops a fetch at the first commit it doesn't have, naming it, so each lost one costs
    // a fetch of the rest again.
    const newlyLost: Oid[] = [];
    while (missing.length > 0) {
      try {
        await this.#fetch(
          what,
          missing.map((oid) => `+${oid}:${pinRef(pins, number, oid)}`),
        );
        break;
      } catch (error) {
        const lost = missing.findIndex((oid) => isLostCommit(error, oid));
        if (lost === -1) throw error;
        newlyLost.push(...missing.splice(lost, 1));
      }
    }
    // Commits the clone has now, from another pull request's fetch say, aren't lost any more.
    const stillLost = lostBefore.filter(
      (oid) => !wanted.includes(oid) || unavailable.includes(oid),
    );
    const stillPresent = await this.#commitsPresent(stillLost);
    const lost = [...stillLost.filter((_, index) => !stillPresent[index]), ...newlyLost];
    if (lost.join('\n') !== lostBefore.join('\n')) await this.#remember(number, pins, lost);
    unavailable.push(...newlyLost);
    const pinned = wanted.filter((oid) => !unavailable.includes(oid));
    // Also checks each is a commit.
    const commits = await this.#commitsPresent(pinned);
    const notCommit = pinned.find((_, index) => !commits[index]);
    if (notCommit !== undefined) {
      throw new GitError({
        kind: 'git',
        command: 'git fetch',
        message: `${notCommit} isn't a commit`,
      });
    }
    await this.#pin(pinned.map((oid) => [pinRef(pins, number, oid), oid]));
    return unavailable;
  }

  /** The commits of pull request `number` noted as lost. A line that isn't an ID is skipped. */
  async #remembered(number: number, pins: Pins): Promise<Oid[]> {
    const path = this.#lostFile(number, pins);
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw GitError.io(`reading ${path}`, error);
    }
    const remembered: Oid[] = [];
    for (const line of text.split('\n')) {
      try {
        remembered.push(parseOid(line));
      } catch {
        // What a write cut short leaves.
      }
    }
    return remembered;
  }

  /** Notes `lost` as pull request `number`'s, replacing the file whole. The lock is held. */
  async #remember(number: number, pins: Pins, lost: readonly Oid[]): Promise<void> {
    const path = this.#lostFile(number, pins);
    const temporary = `${path}.${process.pid}`;
    try {
      await mkdir(join(this.folder, UNAVAILABLE_FOLDER), { recursive: true });
      await writeFile(temporary, lost.map((oid) => `${oid}\n`).join(''));
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw GitError.io(`writing ${path}`, error);
    }
  }

  #lostFile(number: number, pins: Pins): string {
    const name = pins === 'revisions' ? `pull-${number}` : `pull-${number}-revision-bases`;
    return join(this.folder, UNAVAILABLE_FOLDER, name);
  }

  /** Whether each of `oids` is a commit in the clone. Never downloads anything. */
  async #commitsPresent(oids: readonly Oid[]): Promise<boolean[]> {
    if (oids.length === 0) return [];
    const output = await this.#git()
      .arg('cat-file', '--batch-check=%(objectname) %(objecttype)')
      .run(oids.map((oid) => `${oid}\n`).join(''));
    const answers = lines(output);
    return oids.map((oid, index) => answers[index] === `${oid} commit`);
  }

  /** The commits pinned under `prefix`, or at exactly `prefix` when it names one ref. */
  async #refs(prefix: string): Promise<Oid[]> {
    const output = await this.#git().arg('for-each-ref', '--format=%(objectname)', prefix).run();
    return lines(output).map(parseOid);
  }

  /** The commit `rev` names. */
  async #resolve(rev: string): Promise<Oid> {
    const output = await this.#git()
      .arg('rev-parse', '--verify', '--end-of-options', `${rev}^{commit}`)
      .run();
    return oidFromOutput(output);
  }

  /** Points each reference at its commit, in one transaction. The lock is held. */
  async #pin(pins: readonly (readonly [string, Oid])[]): Promise<void> {
    if (pins.length === 0) return;
    const input = pins.map(([ref, oid]) => `update ${ref} ${oid}\n`).join('');
    await this.#git().arg('update-ref', '--stdin').run(input);
  }

  /** Fails unless `name` is a branch name git accepts, which also keeps a refspec what it says. */
  async #checkBranchName(name: string): Promise<void> {
    const valid =
      !name.startsWith('-') &&
      (await this.#runner.command('none').arg('check-ref-format', `refs/heads/${name}`).finish())
        .code === 0;
    if (!valid) throw new GitError({ kind: 'invalid', what: 'branch name', value: name });
  }

  /**
   * Fetches `refspecs`, or the objects `options.objects` names by ID, from the remote. A fetch
   * GitHub refused while the account's token was renewed is tried once more with the new token.
   * The lock is held.
   */
  async #fetch(
    what: string,
    refspecs: readonly string[],
    options: FetchOptions = {},
  ): Promise<number> {
    const token = await this.#currentToken();
    try {
      return await this.#fetchAs(what, refspecs, options, token);
    } catch (error) {
      if (!isFetchFailure(error, 'tokenRefused')) throw error;
      const renewed = await this.#currentToken();
      if (renewed === undefined || (token !== undefined && renewed.equals(token))) throw error;
      this.#cache.note(`${this.name}: the account's token was renewed while fetching ${what}`);
      return this.#fetchAs(what, refspecs, options, renewed);
    }
  }

  async #fetchAs(
    what: string,
    refspecs: readonly string[],
    options: FetchOptions,
    token: Token | undefined,
  ): Promise<number> {
    // A lock left on a ref the fetch writes would fail it every time: one a git killed from
    // outside, or in a crash, left. Only fetches and pins write these refs, under the clone's
    // lock, which is held, so such a lock is no one's. The same goes for the half-written packs
    // a fetch leaves: only fetches and repacks write packs, under the same lock.
    for (const ref of destinations(refspecs)) {
      await rm(join(this.folder, `${ref}.lock`), { force: true });
    }
    await this.#removeHalfWritten();
    const url = this.#url;
    const fetching: Fetching = { token, proxy: await this.#proxy?.(url) };
    const command = this.#runner.command({ gitDir: this.folder }, { fetching });
    // Where the fetch goes, and that it's a promisor, on the command line alone: never the clone's
    // own settings, which only Lo writes, but a fetch shouldn't have to trust.
    for (const setting of [
      `remote.${REMOTE}.url=${url}`,
      `remote.${REMOTE}.promisor=true`,
      `remote.${REMOTE}.partialclonefilter=blob:none`,
    ]) {
      command.arg('-c', setting);
    }
    if (options.objects !== undefined) {
      // As git's own downloads of what a partial clone lacks: the objects are named, so there's
      // nothing to work out with GitHub first.
      command.arg('-c', 'fetch.negotiationAlgorithm=noop');
    }
    command.arg(
      'fetch',
      '--no-tags',
      '--no-write-fetch-head',
      '--recurse-submodules=no',
      '--filter=blob:none',
      // Always: what git says is how Lo knows what a fetch is doing.
      '--progress',
    );
    command.arg(REMOTE, ...refspecs);
    if (options.objects !== undefined) command.arg('--stdin');
    // The first fetch into a clone brings the history it needs, and many files at once may be a
    // whole tree: GitHub may take as long to start sending either.
    const empty = await this.#isEmpty();
    const whole = (options.whole ?? false) || empty || (options.objects?.length ?? 0) > FEW_OBJECTS;
    const started = Date.now();
    const watched = await watch(command, {
      limits: this.#cache.limits,
      whole,
      trace: this.#cache.temporaryPath('.trace'),
      progress: this.#progress,
      input: options.objects?.map((oid) => `${oid}\n`).join(''),
      maxBytes: options.maxBytes,
      packs: join(this.folder, 'objects', 'pack'),
      afterStop: (pid) => this.#removeLeft({ pid, refspecs, started }),
      log: (line) => this.#cache.note(`${this.name}: ${line}`),
      signal: options.signal,
    });
    if (watched.kind === 'stopped') throw stoppedError(watched.stopped, what);
    const { exit, messages } = watched;
    if (exit.code !== 0) {
      // A fetch that failed part way, as when the connection dropped, leaves its pack too.
      await this.#removeHalfWritten();
      throw GitError.fromGit(command.display, failureMessage({ ...exit, stderr: messages }), what);
    }
    if (empty) this.#madeClone = true;
    return watched.received;
  }

  /** Whether nothing was ever fetched into the clone: it has no refs. */
  async #isEmpty(): Promise<boolean> {
    const output = await this.#git().arg('for-each-ref', '--count=1', '--format=%(refname)').run();
    return output.length === 0;
  }

  /**
   * Removes what git, as process `left.pid`, may have left when Lo stopped it fetching
   * `left.refspecs`, with the clone's lock held:
   *
   * - the pack it was writing, which git never removes itself, and the keep file a finished pack
   *   has until the fetch is done, which would keep the pack for good;
   * - the locks it could have taken: the refs it was writing, and the reftable stack's lock. Only
   *   those made since the fetch started, and only while no other git of Lo's runs on the
   *   repository, as {@link removeLocksLeft} checks: a comparison may be writing its own pins
   *   meanwhile, under a lock of the same name.
   */
  async #removeLeft(left: {
    pid: number;
    refspecs: readonly string[];
    started: number;
  }): Promise<void> {
    const removed = await this.#removeHalfWritten(left.pid);
    removed.push(
      ...removeLocksLeft(this.#runner, this.folder, left.started, {
        locks: [
          ...destinations(left.refspecs).map((ref) => `${ref}.lock`),
          join('reftable', 'tables.list.lock'),
        ],
      }),
    );
    if (removed.length > 0) {
      const shown = removed.map((path) => relative(this.folder, path)).join(', ');
      this.#cache.note(`${this.name}: removed what a git that was stopped left: ${shown}`);
    }
  }

  /**
   * Removes the packs a fetch was writing when it stopped, `objects/pack/tmp_*`, or
   * didn't finish, and, given the stopped git's process ID, the keep file git gives a finished
   * pack until the fetch is done. Only fetches and repacks write packs, with the clone's lock
   * held, which it is, so they're no one else's. Returns what it removed.
   */
  async #removeHalfWritten(pid?: number): Promise<string[]> {
    const removed = [...removeTemporaryPacks(this.folder), ...removeUnfinishedPacks(this.folder)];
    if (pid === undefined) return removed;
    const pack = join(this.folder, 'objects', 'pack');
    for (const name of await readdir(pack).catch(() => [])) {
      // "fetch-pack <pid> on <host>", as `git fetch` names its packs' keep files.
      if (!name.endsWith('.keep')) continue;
      const text = await readFile(join(pack, name), 'utf8').catch(() => '');
      if (text.startsWith(`fetch-pack ${pid} on `) && (await removeFile(join(pack, name)))) {
        removed.push(join(pack, name));
      }
    }
    return removed;
  }

  async #currentToken(): Promise<Token | undefined> {
    const value = await this.#token?.();
    return value === undefined ? undefined : new Token(value);
  }
}

interface FetchOptions {
  /** The most bytes the fetch may bring, past which it's stopped. */
  readonly maxBytes?: number | undefined;
  /** Objects to fetch by ID, which git reads on its input. */
  readonly objects?: readonly Oid[] | undefined;
  /**
   * Whether it may bring a repository's whole contents, as a checkout's files may, and so has a
   * first fetch's time to start, however few objects it names.
   */
  readonly whole?: boolean | undefined;
  /** Stops the fetch once it aborts. */
  readonly signal?: AbortSignal | undefined;
}

/** What a comparison's downloads may still bring, in bytes, and the signal that stops them. */
interface Downloads {
  left: number;
  readonly signal?: AbortSignal | undefined;
}

/** Downloads that would bring more than they may: the comparison is refused. */
class PastCap extends Error {}

/** Removes the file at `path`, and says whether it did: one that's gone already isn't an error. */
function removeFile(path: string): Promise<boolean> {
  return rm(path).then(
    () => true,
    () => false,
  );
}

/** The refs `refspecs` write: what follows each one's colon. */
function destinations(refspecs: readonly string[]): string[] {
  return refspecs.flatMap((refspec) => {
    const colon = refspec.indexOf(':');
    return colon === -1 ? [] : [refspec.slice(colon + 1)];
  });
}

/** Where pull request `number`'s commit `oid` is pinned, as `pins`. */
function pinRef(pins: Pins, number: number, oid: Oid): string {
  return pins === 'revisions' ? revisionRef(number, oid) : revisionBaseRef(number, oid);
}

/** What a fetch of `missing` is called in messages. */
function describePins(pins: Pins, number: number, missing: readonly Oid[]): string {
  const [only] = missing;
  if (pins === 'revisions') {
    return missing.length === 1 && only !== undefined
      ? `pull request #${number}'s revision ${only.slice(0, 7)}`
      : `${missing.length} of pull request #${number}'s revisions`;
  }
  return missing.length === 1 && only !== undefined
    ? `a base of pull request #${number}'s revisions, ${only.slice(0, 7)}`
    : `${missing.length} bases of pull request #${number}'s revisions`;
}

/** Whether every folder on the way to `names` in `checkout` is a folder itself, not a link. */
async function foldersOnTheWay(checkout: string, names: readonly string[]): Promise<boolean> {
  let at = Buffer.from(checkout);
  for (const name of names.slice(0, -1)) {
    at = Buffer.concat([at, Buffer.from('/'), Buffer.from(name, 'latin1')]);
    if (!(await lstat(at).catch(() => undefined))?.isDirectory()) return false;
  }
  return true;
}

/**
 * Whether `name`, one step of a path in a checkout, would leave the checkout, isn't a name, or holds
 * a backslash, which Windows takes as a separator.
 */
function badCheckoutName(name: string): boolean {
  return name === '' || name === '.' || name === '..' || name.includes('\0') || name.includes('\\');
}

/**
 * Why opening a checkout's file can fail when there's no plain file there: nothing at the path, a
 * link (`O_NOFOLLOW`'s `ELOOP`, or `EMLINK` on some BSDs), or a folder on the way that isn't one.
 */
const FILE_NOT_THERE = new Set(['ENOENT', 'ELOOP', 'EMLINK', 'ENOTDIR']);

/** The error for a checkout's folder that a link on the way would put outside the cache. */
function linkInTheWay(folder: string): GitError {
  return new GitError({
    kind: 'io',
    context: `checking out into ${folder}`,
    message: 'a link on the way leads out of the cache, so Lo writes nothing there',
  });
}

/** Whether `error` is a fetch that failed as `failure`. */
function isFetchFailure(error: unknown, failure: FetchFailure): boolean {
  return (
    error instanceof GitError && error.detail.kind === 'fetch' && error.detail.failure === failure
  );
}

/** Whether `error` is a fetch that failed because the server doesn't have commit `oid`. */
function isLostCommit(error: unknown, oid: Oid | undefined): boolean {
  if (oid === undefined || !(error instanceof GitError) || error.detail.kind !== 'fetch') {
    return false;
  }
  const { message } = error.detail;
  return (
    (message.includes('not our ref') || message.includes('unadvertised object')) &&
    message.includes(oid)
  );
}

/** `oids`, each once, in order. */
function unique(oids: readonly Oid[]): Oid[] {
  return [...new Set(oids)];
}

/** The error for a patch past `limit` bytes, or lines. */
function patchTooLarge(limit: number, unit?: 'lines'): GitError {
  return new GitError({ kind: 'tooLarge', command: 'git diff', limit, unit });
}

/** "1 file", or "2 files". */
function countFiles(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

/** The error for reading `path`, which is a `what`, as a file. */
function notAFile(path: Uint8Array, what: string): GitError {
  const shown = displayPath(path);
  return new GitError({
    kind: 'git',
    command: 'git cat-file --batch-command',
    message: `${shown} is a ${what}, not a file`,
  });
}

/** The lines of git's text output, without the empty one after the last. */
function lines(output: Uint8Array): string[] {
  return Buffer.from(output.buffer, output.byteOffset, output.byteLength)
    .toString('utf8')
    .split('\n')
    .filter((line) => line !== '');
}
