/** One repository's clone: fetching into it, and reading its commits. */

import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import {
  answerable,
  type Attribute,
  attributeFiles,
  attributeFolder,
  checkAttributeQuestion,
  MAX_ATTRIBUTE_FILES,
  parseCheckAttr,
} from './attributes.ts';
import { type ChangedFile, type FileVersion, parseChanges, rawDiffBlobs } from './diff.ts';
import { GitError } from './errors.ts';
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
import { splitRecords } from './records.ts';
import {
  baseRef,
  branchBaseRef,
  checkName,
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
import { distrust } from './trust.ts';
import { stoppedError, watch } from './watch.ts';

/** What a repository needs of the cache it's in. */
export interface RepoHost {
  readonly runner: Runner;
  /** Makes a bare clone at `folder`, set up to fetch from `url`. */
  create(folder: string, url: string): Promise<void>;
  /** Moves `path` aside and deletes it. */
  trash(path: string): Promise<void>;
  /** How long fetches may take. */
  readonly limits: FetchLimits;
  /** A new path for a temporary file, ending in `extension`. */
  temporaryPath(extension: string): string;
  /** Notes a line for the log. */
  note(line: string): void;
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
  readonly proxy?: (() => Promise<string | undefined>) | undefined;
  readonly progress?: ((activity: Activity) => void) | undefined;
  /** Opened to read offline: it never writes. */
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

/** A file in an overview's tree. */
export interface OverviewFile {
  /** The path from the tree's root, as git stores it: bytes, usually but not always UTF-8. */
  readonly path: Buffer;
  readonly oid: Oid;
  /** git's mode, such as `100644`. */
  readonly mode: string;
  /** Its size in bytes once the clone has it; unknown, not small, until then. */
  readonly size?: number | undefined;
}

/** A pull request's overview: the commit `refs/lo/pr/<n>` held, and its files. */
export interface Overview {
  readonly commit: Oid;
  /** Whether it came from the base repository or from the fork the pull request's head is in. */
  readonly source: 'base' | 'fork';
  readonly files: readonly OverviewFile[];
}

/**
 * The most bytes either side of a patch may hold unless the caller says otherwise: far more than a
 * file whose patch is worth reading, as GitHub leaves out a large file's.
 */
export const PATCH_LIMIT = 10 * 1024 * 1024;

/** The most an overview may hold, in bytes. */
export const OVERVIEW_LIMIT = 50 * 1024 * 1024;

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

/**
 * The bare repository, inside each clone, that holds its pull requests' overviews. They're
 * fetched without their history, which in the clone of code would cut short every commit's that
 * an overview's ref names.
 */
const OVERVIEWS = 'lo-overviews.git';

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
  readonly #proxy: (() => Promise<string | undefined>) | undefined;
  readonly #progress: ((activity: Activity) => void) | undefined;
  /** The clone's reader of objects, started on the first read that needs it. */
  readonly #reader: ObjectReader;

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
    return this.#missingIn(this.folder, oids);
  }

  /** Which of `oids` the repository at `gitDir` lacks. Never downloads anything. */
  async #missingIn(gitDir: string, oids: readonly Oid[]): Promise<Oid[]> {
    if (oids.length === 0) return [];
    const output = await this.#runner
      .command({ gitDir })
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
   * returns those it still lacks.
   */
  async #downloadMissing(oids: readonly Oid[]): Promise<Set<Oid>> {
    const wanted = unique(oids);
    const missing = await this.missingObjects(wanted);
    if (missing.length === 0 || this.offline) return new Set(missing);
    return this.#locked(`downloading ${countFiles(missing.length)}`, async () => {
      // Whatever held the lock may have brought some of them, or all.
      const still = await this.missingObjects(missing);
      for (let at = 0; at < still.length; at += OBJECTS_PER_FETCH) {
        const batch = still.slice(at, at + OBJECTS_PER_FETCH);
        const what =
          batch.length < still.length
            ? `${batch.length} of ${countFiles(still.length)}`
            : countFiles(batch.length);
        await this.#fetch(what, [], { objects: batch });
      }
      return new Set(still.length === 0 ? [] : await this.missingObjects(still));
    });
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
    const output = await this.#git()
      .arg('cat-file', '--batch-check=%(objectname) %(objectsize)')
      .run(versions.map((version) => `${version?.oid}\n`).join(''));
    const sizes = new Map<string, number>();
    for (const line of lines(output)) {
      const [oid = '', size = ''] = line.split(' ');
      if (/^\d+$/.test(size)) sizes.set(oid, Number(size));
    }
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
   * Downloads the files of pull request `number`'s `overview` the repository of overviews lacks,
   * in one fetch, refusing one over {@link OVERVIEW_LIMIT} in all: a blobless clone can't tell
   * their sizes before they come, so the download stops once more than that has come in, and the
   * sizes are checked once it's done. Returns the files still missing.
   */
  async downloadOverview(number: number, overview: Overview): Promise<Oid[]> {
    checkNumber(number);
    const what = `pull request #${number}'s overview`;
    // A submodule's entry is a commit in another repository.
    const oids = [
      ...new Set(overview.files.filter((file) => file.mode !== '160000').map((file) => file.oid)),
    ];
    return this.#locked(`downloading ${what}`, async () => {
      const overviews = await this.#overviews();
      const missing = await this.#missingIn(overviews, oids);
      const packs = await packNames(overviews);
      try {
        if (missing.length > 0) {
          await this.#fetch(what, [], {
            objects: missing,
            gitDir: overviews,
            maxBytes: OVERVIEW_LIMIT,
          });
        }
        const lacking = await this.#missingIn(overviews, missing);
        const present = oids.filter((oid) => !lacking.includes(oid));
        const sizes = await this.#runner
          .command({ gitDir: overviews })
          .arg('cat-file', '--batch-check=%(objectsize)')
          .run(present.map((oid) => `${oid}\n`).join(''));
        const total = lines(sizes).reduce((sum, size) => sum + Number(size), 0);
        if (total > OVERVIEW_LIMIT) {
          throw stoppedError({ reason: 'size', limit: OVERVIEW_LIMIT, doing: '', pid: 0 }, what);
        }
        return lacking;
      } catch (error) {
        const tooLarge =
          error instanceof GitError &&
          error.detail.kind === 'fetch' &&
          error.detail.failure === 'tooLarge';
        // What came of an overview refused for its size goes: its files stay on GitHub.
        if (tooLarge) await this.#removePacksSince(overviews, packs);
        throw error;
      }
    });
  }

  /**
   * Removes the packs in the repository at `gitDir` that aren't among `before`, the names of its
   * packs before a download, with all their files. The clone's lock is held.
   */
  async #removePacksSince(gitDir: string, before: ReadonlySet<string>): Promise<void> {
    const folder = join(gitDir, 'objects', 'pack');
    const added = [...(await packNames(gitDir))].filter((name) => !before.has(name));
    if (added.length === 0) return;
    for (const name of await readdir(folder).catch(() => [])) {
      if (added.some((pack) => name.startsWith(`${pack}.`))) {
        await rm(join(folder, name), { force: true });
      }
    }
    this.#cache.note(`${this.name}: removed what came of an overview refused for its size`);
  }

  /**
   * Fetches pull request `number`'s overview: `refs/lo/pr/<n>` from the base repository, else
   * from `fork`, the repository its head is in. Only the commit and its trees come, with none of
   * their history and no file's contents. A pull request without one has `undefined`.
   */
  async fetchOverview(
    number: number,
    fork?: { readonly owner: string; readonly name: string },
  ): Promise<Overview | undefined> {
    checkNumber(number);
    if (fork !== undefined) {
      checkName('repository owner', fork.owner);
      checkName('repository name', fork.name);
    }
    const what = `pull request #${number}'s overview`;
    const source = `refs/lo/pr/${number}`;
    return this.#locked(`fetching ${what}`, async () => {
      const overviews = await this.#overviews();
      const fromBase = pullRef(number, 'overview');
      if (await this.#fetchIfThere(what, [`+${source}:${fromBase}`], { gitDir: overviews })) {
        return this.#overview(overviews, fromBase, 'base');
      }
      if (fork === undefined) return undefined;
      const fromFork = pullRef(number, 'overview-fork');
      const url = `${this.#runner.remote.base}/${fork.owner}/${fork.name}.git`;
      const fetched = await this.#fetchIfThere(what, [`+${source}:${fromFork}`], {
        gitDir: overviews,
        url,
      });
      return fetched ? this.#overview(overviews, fromFork, 'fork') : undefined;
    });
  }

  /**
   * The repository of overviews inside the clone, made on first use, and made again when it
   * fails the trust check. The lock is held.
   */
  async #overviews(): Promise<string> {
    const folder = join(this.folder, OVERVIEWS);
    const present = await lstat(join(folder, 'HEAD')).catch(() => undefined);
    if (present !== undefined) {
      const reason = await distrust(this.#runner, folder, { shallow: true });
      if (reason === undefined) return folder;
      this.#cache.note(`${this.name}: making its overviews again, since ${reason}`);
    }
    await this.#cache.trash(folder);
    await this.#cache.create(folder, this.#url);
    return folder;
  }

  /** {@link Repo.#fetch} of a shallow overview, or `false` when the remote has no such ref. */
  async #fetchIfThere(
    what: string,
    refspecs: string[],
    options: { gitDir: string; url?: string },
  ): Promise<boolean> {
    try {
      await this.#fetch(what, refspecs, { ...options, shallow: true });
      return true;
    } catch (error) {
      const missing =
        error instanceof GitError &&
        error.detail.kind === 'fetch' &&
        error.detail.failure === 'refNotFound';
      if (missing) return false;
      throw error;
    }
  }

  /** The overview pinned at `ref` in the repository of overviews, with its files. */
  async #overview(overviews: string, ref: string, source: Overview['source']): Promise<Overview> {
    const resolved = await this.#runner
      .command({ gitDir: overviews })
      .arg('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`)
      .run();
    const commit = oidFromOutput(resolved);
    const files: OverviewFile[] = [];
    // With lazy fetching off, `-l` gives the size of each file the clone has, and no number for
    // the rest.
    const listing = await this.#runner
      .command({ gitDir: overviews })
      .arg('ls-tree', '-r', '-z', '-l', '--full-tree', commit, '--')
      .run();
    for (const record of splitRecords(listing)) {
      const tab = record.indexOf(0x09);
      const [mode = '', , oid = '', size = ''] = record
        .subarray(0, tab)
        .toString('utf8')
        .split(/ +/);
      files.push({
        path: record.subarray(tab + 1),
        oid: parseOid(oid),
        mode,
        size: /^\d+$/.test(size) ? Number(size) : undefined,
      });
    }
    return { commit, source, files };
  }

  /** Runs `work` holding the clone's lock, having noted that the clone was used. */
  async #locked<T>(what: string, work: () => Promise<T>): Promise<T> {
    if (this.offline) {
      throw new GitError({ kind: 'readOnly', name: this.name, what: 'fetch' });
    }
    const release = await this.#lock.acquire(what, this.#progress);
    try {
      await stampUsed(this.folder);
      return await work();
    } finally {
      release();
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
  ): Promise<void> {
    const token = await this.#currentToken();
    try {
      await this.#fetchAs(what, refspecs, options, token);
    } catch (error) {
      const refused =
        error instanceof GitError &&
        error.detail.kind === 'fetch' &&
        error.detail.failure === 'tokenRefused';
      if (!refused) throw error;
      const renewed = await this.#currentToken();
      if (renewed === undefined || (token !== undefined && renewed.equals(token))) throw error;
      this.#cache.note(`${this.name}: the account's token was renewed while fetching ${what}`);
      await this.#fetchAs(what, refspecs, options, renewed);
    }
  }

  async #fetchAs(
    what: string,
    refspecs: readonly string[],
    options: FetchOptions,
    token: Token | undefined,
  ): Promise<void> {
    const gitDir = options.gitDir ?? this.folder;
    // A lock left on a ref the fetch writes would fail it every time: one a git killed from
    // outside, or in a crash, left. Only fetches and pins write these refs, under the clone's
    // lock, which is held, so such a lock is no one's. The same goes for the half-written packs
    // a fetch leaves, which only fetches write.
    for (const ref of destinations(refspecs)) {
      await rm(join(gitDir, `${ref}.lock`), { force: true });
    }
    if (options.shallow) await rm(join(gitDir, 'shallow.lock'), { force: true });
    await this.#removeHalfWritten(gitDir);
    const fetching: Fetching = { token, proxy: await this.#proxy?.() };
    const command = this.#runner.command({ gitDir }, { fetching });
    // Where the fetch goes, and that it's a promisor, on the command line alone: never the clone's
    // own settings, which only Lo writes, but a fetch shouldn't have to trust.
    for (const setting of [
      `remote.${REMOTE}.url=${options.url ?? this.#url}`,
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
    if (options.shallow) command.arg('--depth=1');
    command.arg(REMOTE, ...refspecs);
    if (options.objects !== undefined) command.arg('--stdin');
    // The first fetch into a clone brings the history it needs, and many files at once may be a
    // whole tree: GitHub may take as long to start sending either.
    const whole = (await this.#isEmpty(gitDir)) || (options.objects?.length ?? 0) > FEW_OBJECTS;
    const started = Date.now();
    const watched = await watch(command, {
      limits: this.#cache.limits,
      whole,
      trace: this.#cache.temporaryPath('.trace'),
      progress: this.#progress,
      input: options.objects?.map((oid) => `${oid}\n`).join(''),
      maxBytes: options.maxBytes,
      packs: join(gitDir, 'objects', 'pack'),
      afterStop: (pid) =>
        this.#removeLeft(gitDir, { pid, refspecs, shallow: options.shallow ?? false, started }),
      log: (line) => this.#cache.note(`${this.name}: ${line}`),
    });
    if (watched.kind === 'stopped') throw stoppedError(watched.stopped, what);
    const { exit, messages } = watched;
    if (exit.code !== 0) {
      // A fetch that failed part way, as when the connection dropped, leaves its pack too.
      await this.#removeHalfWritten(gitDir);
      throw GitError.fromGit(command.display, failureMessage({ ...exit, stderr: messages }), what);
    }
  }

  /** Whether nothing was ever fetched into the repository at `gitDir`: it has no refs. */
  async #isEmpty(gitDir: string): Promise<boolean> {
    const output = await this.#runner
      .command({ gitDir })
      .arg('for-each-ref', '--count=1', '--format=%(refname)')
      .run();
    return output.length === 0;
  }

  /**
   * Removes what git, as process `left.pid`, may have left when Lo stopped it fetching
   * `left.refspecs` into `gitDir`, with the clone's lock held:
   *
   * - the pack it was writing, which git never removes itself, and the keep file a finished pack
   *   has until the fetch is done, which would keep the pack for good;
   * - the locks it could have taken: the refs it was writing, `shallow.lock` for a fetch without
   *   history, and the reftable stack's lock. Only those made since the fetch started, and only
   *   while no other git of Lo's runs on the repository: a comparison may be writing its own pins
   *   meanwhile, under a lock of the same name.
   */
  async #removeLeft(
    gitDir: string,
    left: { pid: number; refspecs: readonly string[]; shallow: boolean; started: number },
  ): Promise<void> {
    const removed = await this.#removeHalfWritten(gitDir, left.pid);
    if (this.#runner.running(gitDir) === 0) {
      const locks = [
        ...destinations(left.refspecs).map((ref) => `${ref}.lock`),
        ...(left.shallow ? ['shallow.lock'] : []),
        join('reftable', 'tables.list.lock'),
      ];
      // File systems that keep whole seconds round a time down.
      const since = Math.floor(left.started / 1000) * 1000;
      for (const lock of locks.map((name) => join(gitDir, name))) {
        const made = await lstat(lock).catch(() => undefined);
        if (made === undefined || made.mtimeMs < since) continue;
        if (await removeFile(lock)) removed.push(lock);
      }
    }
    if (removed.length > 0) {
      const shown = removed.map((path) => relative(this.folder, path)).join(', ');
      this.#cache.note(`${this.name}: removed what a git that was stopped left: ${shown}`);
    }
  }

  /**
   * Removes the packs a fetch into `gitDir` was writing when it stopped, `objects/pack/tmp_*`, and,
   * given the stopped git's process ID, the keep file git gives a finished pack until the fetch is
   * done. Only fetches write packs, with the clone's lock held, which it is, so they're no one
   * else's. Returns what it removed.
   */
  async #removeHalfWritten(gitDir: string, pid?: number): Promise<string[]> {
    const pack = join(gitDir, 'objects', 'pack');
    const left: string[] = [];
    for (const name of await readdir(pack).catch(() => [])) {
      if (name.startsWith('tmp_') || name.startsWith('.tmp-')) left.push(join(pack, name));
      // "fetch-pack <pid> on <host>", as `git fetch` names its packs' keep files.
      if (pid !== undefined && name.endsWith('.keep')) {
        const text = await readFile(join(pack, name), 'utf8').catch(() => '');
        if (text.startsWith(`fetch-pack ${pid} on `)) left.push(join(pack, name));
      }
    }
    const removed: string[] = [];
    for (const path of left) {
      if (await removeFile(path)) removed.push(path);
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
  /** The commits alone, without their history. */
  readonly shallow?: boolean | undefined;
  /** The repository to fetch into, when not the clone: the overviews'. */
  readonly gitDir?: string | undefined;
  /** The address to fetch from, when not the clone's: a fork's. */
  readonly url?: string | undefined;
}

/** The names of the packs in the repository at `gitDir`, such as `pack-<hash>`, without extensions. */
async function packNames(gitDir: string): Promise<Set<string>> {
  const names = await readdir(join(gitDir, 'objects', 'pack')).catch(() => []);
  return new Set(names.filter((name) => name.endsWith('.pack')).map((name) => name.slice(0, -5)));
}

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
