// A pull request's tab's tree in main: the repository's files at the head on screen, and the files
// the pull request changes. Both come from the local copy once it's ready, and from GitHub's API
// until then; what the copy says replaces what GitHub said. Nothing here calls Electron.

import {
  changedPath,
  GitError,
  linguistBoolean,
  MAX_ENTRIES,
  type Oid,
  parseOid,
  type Repo,
} from '@lo/git';
import {
  type GithubClient,
  MAX_FILES,
  MAX_PAGES,
  PullRef,
  readPullFiles,
  RepoRef,
  repoTree,
} from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import type { Comparing, OnScreen } from '../../revisions/service.ts';
import type { Acting } from '../../tab/contract.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import {
  type Changed,
  type Folder,
  type Found,
  type Listing,
  PATH_LIMIT,
  type Source,
  type TreePath,
  type TreeState,
} from '../contract.ts';
import { githubChanged, listedAt, localChange, longAtHead } from './changes.ts';
import { find, type Searched } from './find.ts';
import { Files, fromGithub, fromLocal } from './listing.ts';
import { changeKey } from './paths.ts';

/** Requests GitHub's API keeps for the poller: the tree reads no page of files past them. */
export const KEEP_REQUESTS = 100;

/** The same, without an account. */
export const KEEP_ANONYMOUS = 10;

/**
 * How long to wait before reading again after the `failures`th failed read in a row: 5 s,
 * doubling, 5 minutes at most, as the tab waits to fetch its local copy again.
 */
export function retryWait(failures: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, failures - 1), 5 * 60_000);
}

/** What a tab's tree reads with. */
export interface TreeReads {
  /** The tab's local copy's clone, once it's opened. */
  clone(): Promise<Repo> | undefined;
  /** Runs `request` with GitHub's client for `acting`, in its turn. */
  github<T>(acting: Acting, request: (client: GithubClient) => Promise<T>): Promise<T>;
}

export interface TreeTabOptions {
  readonly id: string;
  readonly reads: TreeReads;
  /** Sends the tree to the window, each time it changes. */
  readonly publish: (state: TreeState) => void;
  readonly log: (line: string) => void;
  /** The most files sent whole: `WHOLE_LIMIT` unless said otherwise. */
  readonly wholeLimit?: number | undefined;
  /** The most bytes a listing's paths may hold: `LISTING_BYTES` unless said otherwise. */
  readonly listingBytes?: number | undefined;
  /** How long to wait to read again after failures in a row: {@link retryWait} unless said. */
  readonly retryWait?: ((failures: number) => number) | undefined;
}

/** What's known of the commit on screen. */
interface At {
  readonly head: Oid;
  /** The two revisions compared, when it isn't the whole pull request: `head` is the newer's. */
  readonly comparing: Comparing | undefined;
  /** The files that changed between them, once they're known. */
  compared: Changed[] | undefined;
  files: Files | undefined;
  listing: Listing;
  from: Source | undefined;
  changes: Changed[] | undefined;
  changesFrom: Source | undefined;
  partial: boolean;
  problem: string | undefined;
  /** Files of the listing left out, since their paths are longer than `PATH_LIMIT` bytes. */
  listedOmitted: number;
  /** What's been started for it, so nothing starts twice. */
  readonly started: Set<Read>;
  /** Whether to read from GitHub: the local copy isn't ready, or couldn't say what changed. */
  wantsGithub: boolean;
  /** Failed reads in a row, of each kind. */
  readonly failures: Record<Read, number>;
  /** Reads waiting to be tried again. */
  readonly timers: Set<ReturnType<typeof setTimeout>>;
}

/** Why the tree shows only the changed files of a repository whose paths are too much to list. */
const TOO_MANY_BYTES =
  'This repository’s file paths come to more than 32 MB, so the tree shows only the changed ones.';

/** Where a tree is read from. */
type Read = 'local' | 'github';

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class TreeTab {
  readonly id: string;
  readonly #options: TreeTabOptions;
  #info: PullTabInfo | undefined;
  /** What the tab compares, as last said. */
  #screen: OnScreen = { kind: 'head' };
  #at: At | undefined;
  #closed = false;
  /** The search under way, which a newer one stops. */
  #search = 0;

  constructor(options: TreeTabOptions) {
    this.#options = options;
    this.id = options.id;
  }

  /** The tree as the window gets it. */
  state(): TreeState {
    const at = this.#at;
    return {
      id: this.id,
      at: at?.head ?? null,
      listing: at?.listing ?? { kind: 'loading' },
      from: at?.from ?? null,
      changes: at?.changes ?? null,
      changesFrom: at?.changesFrom ?? null,
      partial: at?.partial ?? false,
      problem: at?.problem ?? null,
      omitted: at === undefined ? 0 : omittedOf(at),
      compared: at?.compared ?? null,
    };
  }

  /**
   * Follows the tab as it is now, and what it compares: a new head on screen starts the tree again,
   * a local copy ready at it reads the tree from there, and until then GitHub's API does. Two
   * revisions compared are read from the local copy, at the newer, with the files that changed
   * between them; the tree already listed at that commit stays.
   */
  update(info: PullTabInfo, screen: OnScreen = this.#screen): void {
    if (this.#closed) return;
    this.#info = info;
    this.#screen = screen;
    const comparing = screen.kind === 'revisions' ? screen.comparing : undefined;
    let head: Oid;
    try {
      if (comparing) head = comparing.new.head;
      else if (info.shown === undefined) return;
      else head = parseOid(info.shown);
    } catch {
      return;
    }
    const before = this.#at;
    if (before?.head !== head || before.comparing?.key !== comparing?.key) {
      if (before) this.#stopRetries(before);
      // The same commit's files, listed from the local copy, stay.
      const kept = before?.head === head && before.from === 'local' ? before : undefined;
      this.#at = {
        head,
        comparing,
        compared: undefined,
        files: kept?.files,
        listing: kept?.listing ?? { kind: 'loading' },
        from: kept?.from,
        changes: undefined,
        changesFrom: undefined,
        partial: false,
        problem: undefined,
        listedOmitted: kept?.listedOmitted ?? 0,
        started: new Set(),
        wantsGithub: false,
        failures: { local: 0, github: 0 },
        timers: new Set(),
      };
      this.#publish();
    }
    const at = this.#at;
    if (!at) return;
    if (comparing) {
      if (!at.started.has('local')) {
        at.started.add('local');
        void this.#fromLocal(at, comparing.new.base);
      }
      return;
    }
    const { local } = info;
    if (local.kind === 'ready' && local.head === head) {
      if (!at.started.has('local')) {
        at.started.add('local');
        void this.#fromLocal(at, local.mergeBase === null ? undefined : parseOid(local.mergeBase));
      }
    } else {
      at.wantsGithub = true;
    }
    this.#fromGithubIfWanted(at);
  }

  /** The entries of the folders at `paths`, of the tree at `head`. */
  folders(head: string, paths: readonly TreePath[]): Folder[] {
    const at = this.#at;
    if (at?.head !== head) {
      throw new IpcError('moved', 'The tree is of another commit now.');
    }
    return at.files?.folders(paths) ?? [];
  }

  /** Finds files by name in the tree on screen, the changed ones first. */
  async find(query: string): Promise<{ found: Found[]; total: number; at: string | null }> {
    const search = ++this.#search;
    const at = this.#at;
    if (!at) return { found: [], total: 0, at: null };
    const changes = at.changes ?? [];
    const changed = new Set(changes.map((file) => changeKey(file.path)));
    function* paths(): Iterable<Searched> {
      for (const file of changes) yield { path: file.path, changed: true };
      for (const file of at?.files?.files ?? []) {
        if (!changed.has(file.key)) yield { path: file.path, changed: false };
      }
    }
    const results = await find(query, paths(), () =>
      this.#closed || search !== this.#search
        ? new IpcError('superseded', 'A newer search took its place.')
        : undefined,
    );
    return { ...results, at: at.head };
  }

  close(): void {
    this.#closed = true;
    this.#search++;
    if (this.#at) this.#stopRetries(this.#at);
  }

  #stopRetries(at: At): void {
    for (const timer of at.timers) clearTimeout(timer);
    at.timers.clear();
  }

  /**
   * Reads from `read` again after a wait that grows with each failure in a row, while `at` is still
   * the commit on screen.
   */
  #retry(at: At, read: Read): void {
    at.failures[read] += 1;
    const wait = (this.#options.retryWait ?? retryWait)(at.failures[read]);
    const timer = setTimeout(() => {
      at.timers.delete(timer);
      if (!this.#current(at)) return;
      at.started.delete(read);
      const info = this.#info;
      if (info) this.update(info);
    }, wait);
    at.timers.add(timer);
  }

  /** Whether `at` is still the commit on screen. */
  #current(at: At): boolean {
    return !this.#closed && this.#at === at;
  }

  /** Lists the files at `at`'s commit from the local copy. Says whether that failed. */
  async #list(repo: Repo, at: At): Promise<boolean> {
    try {
      const listed = fromLocal(
        await repo.tree(at.head, { maxEntries: MAX_ENTRIES }),
        this.#options.listingBytes,
      );
      if (!this.#current(at)) return false;
      if (listed.tooLarge) {
        at.files = undefined;
        at.listing = { kind: 'changed', why: TOO_MANY_BYTES };
      } else {
        at.files = new Files(listed.files, this.#options.wholeLimit);
        at.listing = at.files.listing();
        at.listedOmitted = listed.omitted;
      }
      at.from = 'local';
      at.problem = undefined;
      return false;
    } catch (error) {
      if (!this.#current(at)) return false;
      if (error instanceof GitError && error.detail.kind === 'tooLarge') {
        at.files = undefined;
        at.listing = {
          kind: 'changed',
          why: `This repository has more than ${MAX_ENTRIES.toLocaleString('en')} files, so the tree shows only the changed ones.`,
        };
        at.from = 'local';
        return false;
      }
      this.#options.log(`listing the files at ${at.head}: ${describe(error)}`);
      at.problem = `Lo couldn't list the files in the local copy: ${describe(error)}`;
      return true;
    }
  }

  async #fromLocal(at: At, mergeBase: Oid | undefined): Promise<void> {
    const opening = this.#options.reads.clone();
    if (!opening) return;
    let repo: Repo;
    try {
      repo = await opening;
    } catch (error) {
      this.#options.log(`opening the local copy: ${describe(error)}`);
      if (this.#current(at)) this.#retry(at, 'local');
      return;
    }
    // The files, unless they're listed already, for another comparison at the same commit.
    let failed = at.from === 'local' ? false : await this.#list(repo, at);
    if (!this.#current(at)) return;
    this.#publish();
    // What changed, from where the head branched off the base. With no history in common, the
    // copy can't say, and GitHub's list stands.
    if (mergeBase === undefined) {
      this.#fallBackToGithub(at);
      if (failed) this.#retry(at, 'local');
      return;
    }
    try {
      const compared = await repo.compareRevisions(
        { base: mergeBase, head: mergeBase },
        { base: mergeBase, head: at.head },
      );
      if (!this.#current(at)) return;
      if ('refused' in compared) {
        at.problem = `The changed files are larger than ${Math.round(compared.limit / 2 ** 20)} MB, so the tree marks them as GitHub lists them.`;
        this.#publish();
        this.#fallBackToGithub(at);
        if (failed) this.#retry(at, 'local');
        return;
      }
      const files = compared.files.flatMap((file) => (file.change ? [file.change] : []));
      // Between two revisions, what changed from one to the other.
      const between = at.comparing ? await at.comparing.compared() : undefined;
      if (!this.#current(at)) return;
      if (between && 'refused' in between) {
        throw new Error(
          `the files changed between the revisions are larger than ${Math.round(between.limit / 2 ** 20)} MB`,
        );
      }
      const betweenFiles = (between?.files ?? []).flatMap((file) =>
        file.change ? [file.change] : [],
      );
      // `.gitattributes` is asked only about paths short enough to key a map by.
      const all = [...files, ...betweenFiles];
      const short = all.filter((file) => changedPath(file).length <= PATH_LIMIT);
      const generated = await this.#generated(repo, at.head, short.map(changedPath));
      if (!this.#current(at)) return;
      const attributes = new Map(short.map((file, index) => [file, generated[index]]));
      const changes = files.map((file) => localChange(file, attributes.get(file)));
      if (between) {
        const hits = betweenFiles.map((file) => localChange(file, attributes.get(file)));
        // A file that changed between the revisions shows, though the pull request as a whole
        // doesn't change it, as when the newer revision put it back.
        const listed = new Set(changes.map((change) => changeKey(change.path)));
        changes.push(...hits.filter((change) => !listed.has(changeKey(change.path))));
        at.compared = hits;
      }
      at.changes = changes;
      at.changesFrom = 'local';
      at.partial = false;
    } catch (error) {
      if (!this.#current(at)) return;
      this.#options.log(`finding what changed at ${at.head}: ${describe(error)}`);
      at.problem = `Lo couldn't read what changed from the local copy: ${describe(error)}`;
      this.#fallBackToGithub(at);
      failed = true;
    }
    if (failed) this.#retry(at, 'local');
    else at.failures.local = 0;
    this.#publish();
  }

  /**
   * What each of `paths`' `linguist-generated` attribute is in `head`, from the `.gitattributes`
   * files that apply, downloaded first. Nothing for each when they can't be read.
   */
  async #generated(
    repo: Repo,
    head: Oid,
    paths: readonly Uint8Array[],
  ): Promise<(boolean | undefined)[]> {
    const none = paths.map(() => undefined);
    if (paths.length === 0) return none;
    try {
      await repo.downloadAttributes(head, paths);
      const attributes = await repo.attribute(head, 'linguist-generated', paths);
      return attributes.map((attribute) =>
        attribute === undefined ? undefined : linguistBoolean(attribute),
      );
    } catch (error) {
      this.#options.log(`reading .gitattributes at ${head}: ${describe(error)}`);
      return none;
    }
  }

  /** Reads what changed from GitHub, when the local copy couldn't say, if it hasn't yet. */
  #fallBackToGithub(at: At): void {
    // GitHub has nothing to stand in for a comparison of revisions.
    if (at.changesFrom !== undefined || at.comparing) return;
    at.wantsGithub = true;
    this.#fromGithubIfWanted(at);
  }

  /**
   * Reads from GitHub what's still wanted of `at`, unless it's under way: once the tab knows who
   * it acts as, and only of the head GitHub gave, never one Lo saved, which it may replace.
   */
  #fromGithubIfWanted(at: At): void {
    const info = this.#info;
    if (!info || !at.wantsGithub || at.started.has('github')) return;
    if (info.acting === undefined || info.provisional) return;
    at.started.add('github');
    void this.#fromGithub(at, info.acting);
  }

  async #fromGithub(at: At, acting: Acting): Promise<void> {
    const info = this.#info;
    if (!info) return;
    const { reads } = this.#options;
    const repository = new RepoRef(info.repository.owner, info.repository.name);
    const pull = PullRef.of(repository, info.number);
    const [tree, files] = await Promise.allSettled([
      at.from === undefined
        ? reads.github(acting, (client) => repoTree(client, repository, at.head))
        : Promise.resolve(undefined),
      at.changesFrom === undefined
        ? reads.github(acting, (client) =>
            readPullFiles(client, pull, {
              maxPages: MAX_PAGES,
              // Without an account, GitHub allows 60 requests an hour, and nothing else polls.
              keepRequests: acting.kind === 'anonymous' ? KEEP_ANONYMOUS : KEEP_REQUESTS,
            }),
          )
        : Promise.resolve(undefined),
    ]);
    if (!this.#current(at)) return;
    let failed = false;
    // The local copy's say wins.
    if (at.from === undefined) {
      if (tree.status === 'fulfilled' && tree.value) {
        if (tree.value.truncated) {
          at.listing = {
            kind: 'changed',
            why: 'GitHub lists only part of this repository’s files, so the tree shows the changed ones until the local copy is ready.',
          };
        } else {
          const listed = fromGithub(tree.value.items, this.#options.listingBytes);
          if (listed.tooLarge) {
            at.listing = { kind: 'changed', why: TOO_MANY_BYTES };
          } else {
            at.files = new Files(listed.files, this.#options.wholeLimit);
            at.listing = at.files.listing();
            at.listedOmitted = listed.omitted;
          }
        }
        at.from = 'github';
      } else if (tree.status === 'rejected') {
        this.#options.log(`reading the files from GitHub: ${describe(tree.reason)}`);
        at.listing = {
          kind: 'changed',
          why: `Lo couldn’t read the repository’s files from GitHub (${describe(tree.reason)}), so the tree shows the changed ones until the local copy is ready.`,
        };
        failed = true;
      }
    }
    if (at.changesFrom === undefined) {
      if (files.status === 'fulfilled' && files.value) {
        const listed = files.value;
        if (listedAt(listed.files, at.head)) {
          at.changes = listed.files.map(githubChanged);
          at.changesFrom = 'github';
          at.partial = listed.cutShort !== undefined || listed.files.length >= MAX_FILES;
          if (at.problem?.startsWith('Lo couldn’t read the changed files from GitHub')) {
            at.problem = undefined;
          }
        }
      } else if (files.status === 'rejected') {
        this.#options.log(`reading the changed files from GitHub: ${describe(files.reason)}`);
        at.problem ??= `Lo couldn’t read the changed files from GitHub: ${describe(files.reason)}`;
        failed = true;
      }
    }
    if (failed) this.#retry(at, 'github');
    else at.failures.github = 0;
    this.#publish();
  }

  #publish(): void {
    if (this.#closed) return;
    this.#options.publish(this.state());
  }
}

/**
 * How many files the tree leaves out, since their paths are too long to key a map by: the
 * listing's, but those the pull request changes, which it shows all the same.
 */
function omittedOf(at: At): number {
  if (at.files === undefined) return 0;
  return Math.max(0, at.listedOmitted - longAtHead(at.changes ?? []));
}
