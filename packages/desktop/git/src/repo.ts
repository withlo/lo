/** One repository's clone: fetching into it, and reading its commits. */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { GitError } from './errors.ts';
import { type Fetching, failureMessage, type Runner } from './git.ts';
import type { CloneLock, Release } from './lock.ts';
import { type Oid, oidFromOutput, parseOid } from './oid.ts';
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
import { stampUsed } from './stamp.ts';
import { Token, type TokenSource } from './token.ts';

/** What a repository needs of the cache it's in. */
export interface RepoHost {
  readonly runner: Runner;
  /** Notes a line for the log. */
  note(line: string): void;
}

export interface RepoParts {
  readonly cache: RepoHost;
  /** `owner/name`, for messages. */
  readonly name: string;
  /** The clone's folder. */
  readonly folder: string;
  readonly lock: CloneLock;
  /** Lets go of the clone when the repository closes. */
  readonly done: Release;
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

/** How many objects a download asks for in one fetch. */
const OBJECTS_PER_FETCH = 5000;

/** The folder in a clone where each pull request's commits GitHub no longer has are noted. */
const UNAVAILABLE_FOLDER = 'lo-unavailable';

/** The remote name a fork's overview is fetched through. It's never written to the clone's config. */
const FORK_REMOTE = 'lo-fork';

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
  readonly #lock: CloneLock;
  readonly #done: Release;
  readonly #token: TokenSource | undefined;
  readonly #proxy: (() => Promise<string | undefined>) | undefined;
  readonly #progress: ((activity: Activity) => void) | undefined;

  constructor(parts: RepoParts) {
    this.name = parts.name;
    this.folder = parts.folder;
    this.offline = parts.offline;
    this.#cache = parts.cache;
    this.#lock = parts.lock;
    this.#done = parts.done;
    this.#token = parts.token;
    this.#proxy = parts.proxy;
    this.#progress = parts.progress;
  }

  /** Lets cleanup take the clone again once no other repository has it open. */
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
  async download(oids: readonly Oid[], what = 'the files to show'): Promise<Oid[]> {
    return this.#locked(`downloading ${what}`, async () => {
      const missing = await this.missingObjects([...new Set(oids)]);
      for (let at = 0; at < missing.length; at += OBJECTS_PER_FETCH) {
        const batch = missing.slice(at, at + OBJECTS_PER_FETCH);
        await this.#fetch(what, [], { objects: batch });
      }
      return this.missingObjects(missing);
    });
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
      const fromBase = pullRef(number, 'overview');
      if (await this.#fetchIfThere(what, [`+${source}:${fromBase}`], {})) {
        return this.#overview(fromBase, 'base');
      }
      if (fork === undefined) return undefined;
      const fromFork = pullRef(number, 'overview-fork');
      const url = `${this.#runner.remote.base}/${fork.owner}/${fork.name}.git`;
      // The fork's address and its being a promisor go on the command line alone: written to the
      // clone's config, they'd be settings Lo doesn't otherwise write.
      const remote = [
        `remote.${FORK_REMOTE}.url=${url}`,
        `remote.${FORK_REMOTE}.promisor=true`,
        `remote.${FORK_REMOTE}.partialclonefilter=blob:none`,
      ];
      const fetched = await this.#fetchIfThere(what, [`+${source}:${fromFork}`], {
        remote: FORK_REMOTE,
        config: remote,
      });
      return fetched ? this.#overview(fromFork, 'fork') : undefined;
    });
  }

  /** {@link Repo.#fetch} of a shallow overview, or `false` when the remote has no such ref. */
  async #fetchIfThere(
    what: string,
    refspecs: string[],
    options: { remote?: string; config?: string[] },
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

  /** The overview pinned at `ref`, with its files. */
  async #overview(ref: string, source: Overview['source']): Promise<Overview> {
    const commit = await this.#resolve(ref);
    const files: OverviewFile[] = [];
    // With lazy fetching off, `-l` gives the size of each file the clone has, and no number for
    // the rest.
    const listing = await this.#git()
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
    // A lock left on a ref the fetch writes would fail it every time: one a git killed from
    // outside, or in a crash, left. Only fetches and pins write these refs, under the clone's
    // lock, which is held, so such a lock is no one's.
    for (const refspec of refspecs) {
      const colon = refspec.indexOf(':');
      if (colon !== -1)
        await rm(join(this.folder, `${refspec.slice(colon + 1)}.lock`), { force: true });
    }
    const fetching: Fetching = { token, proxy: await this.#proxy?.() };
    const command = this.#runner.command({ gitDir: this.folder }, { fetching });
    for (const setting of options.config ?? []) command.arg('-c', setting);
    if (options.objects !== undefined) {
      // As git's own downloads of what a partial clone lacks: the objects are named, so there's
      // nothing to work out with GitHub first.
      command.arg('-c', 'fetch.negotiationAlgorithm=noop');
    }
    command.arg(
      'fetch',
      '--quiet',
      '--no-tags',
      '--no-write-fetch-head',
      '--recurse-submodules=no',
      '--filter=blob:none',
    );
    if (options.shallow) command.arg('--depth=1');
    command.arg(options.remote ?? 'origin', ...refspecs);
    if (options.objects === undefined) {
      await command.run(undefined, { what });
      return;
    }
    await command.arg('--stdin').run(options.objects.map((oid) => `${oid}\n`).join(''), { what });
  }

  async #currentToken(): Promise<Token | undefined> {
    const value = await this.#token?.();
    return value === undefined ? undefined : new Token(value);
  }
}

interface FetchOptions {
  /** Objects to fetch by ID, which git reads on its input. */
  readonly objects?: readonly Oid[] | undefined;
  /** The commits alone, without their history. */
  readonly shallow?: boolean | undefined;
  /** The remote to fetch from, when not the clone's own. */
  readonly remote?: string | undefined;
  /** Settings for this fetch alone, such as another remote's. */
  readonly config?: readonly string[] | undefined;
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

/** The lines of git's text output, without the empty one after the last. */
function lines(output: Uint8Array): string[] {
  return Buffer.from(output.buffer, output.byteOffset, output.byteLength)
    .toString('utf8')
    .split('\n')
    .filter((line) => line !== '');
}
