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
import type { Acting } from '../../tab/contract.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { Changed, Folder, Found, Listing, Source, TreePath, TreeState } from '../contract.ts';
import { githubChanged, listedAt, localChange } from './changes.ts';
import { find, type Searched } from './find.ts';
import { Files, fromGithub, fromLocal } from './listing.ts';
import { keyOf } from './paths.ts';

/** Requests GitHub's API keeps for the poller: the tree reads no page of files past them. */
export const KEEP_REQUESTS = 100;

/** The same, without an account. */
export const KEEP_ANONYMOUS = 10;

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
}

/** What's known of the commit on screen. */
interface At {
  readonly head: Oid;
  files: Files | undefined;
  listing: Listing;
  from: Source | undefined;
  changes: Changed[] | undefined;
  changesFrom: Source | undefined;
  partial: boolean;
  problem: string | undefined;
  /** What's been started for it, so nothing starts twice. */
  readonly started: Set<'local' | 'github'>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class TreeTab {
  readonly id: string;
  readonly #options: TreeTabOptions;
  #info: PullTabInfo | undefined;
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
    };
  }

  /**
   * Follows the tab as it is now: a new head on screen starts the tree again, a local copy ready at
   * it reads the tree from there, and until then GitHub's API does.
   */
  update(info: PullTabInfo): void {
    if (this.#closed) return;
    this.#info = info;
    const { shown } = info;
    if (shown === undefined) return;
    let head: Oid;
    try {
      head = parseOid(shown);
    } catch {
      return;
    }
    if (this.#at?.head !== head) {
      this.#at = {
        head,
        files: undefined,
        listing: { kind: 'loading' },
        from: undefined,
        changes: undefined,
        changesFrom: undefined,
        partial: false,
        problem: undefined,
        started: new Set(),
      };
      this.#publish();
    }
    const at = this.#at;
    const { local } = info;
    if (local.kind === 'ready' && local.head === head) {
      if (!at.started.has('local')) {
        at.started.add('local');
        void this.#fromLocal(at, local.mergeBase === null ? undefined : parseOid(local.mergeBase));
      }
    } else if (info.acting !== undefined && !info.provisional && !at.started.has('github')) {
      // A head Lo saved may not be GitHub's any more: GitHub is asked about the one it says.
      at.started.add('github');
      void this.#fromGithub(at, info.acting);
    }
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
    const changed = new Set(changes.map((file) => keyOf(file.path)));
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
  }

  /** Whether `at` is still the commit on screen. */
  #current(at: At): boolean {
    return !this.#closed && this.#at === at;
  }

  async #fromLocal(at: At, mergeBase: Oid | undefined): Promise<void> {
    const opening = this.#options.reads.clone();
    if (!opening) return;
    let repo: Repo;
    try {
      repo = await opening;
    } catch (error) {
      this.#options.log(`opening the local copy: ${describe(error)}`);
      return;
    }
    // The files.
    try {
      const files = new Files(
        fromLocal(await repo.tree(at.head, { maxEntries: MAX_ENTRIES })),
        this.#options.wholeLimit,
      );
      if (!this.#current(at)) return;
      at.files = files;
      at.listing = files.listing();
      at.from = 'local';
      at.problem = undefined;
    } catch (error) {
      if (!this.#current(at)) return;
      if (error instanceof GitError && error.detail.kind === 'tooLarge') {
        at.files = undefined;
        at.listing = {
          kind: 'changed',
          why: `This repository has more than ${MAX_ENTRIES.toLocaleString('en')} files, so the tree shows only the changed ones.`,
        };
        at.from = 'local';
      } else {
        this.#options.log(`listing the files at ${at.head}: ${describe(error)}`);
        at.problem = `Lo couldn't list the files in the local copy: ${describe(error)}`;
      }
    }
    this.#publish();
    // What changed, from where the head branched off the base. With no history in common, the
    // copy can't say, and GitHub's list stands.
    if (mergeBase === undefined) {
      this.#fallBackToGithub(at);
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
        return;
      }
      const files = compared.files.flatMap((file) => (file.change ? [file.change] : []));
      const generated = await this.#generated(repo, at.head, files.map(changedPath));
      if (!this.#current(at)) return;
      at.changes = files.map((file, index) => localChange(file, generated[index]));
      at.changesFrom = 'local';
      at.partial = false;
    } catch (error) {
      if (!this.#current(at)) return;
      this.#options.log(`finding what changed at ${at.head}: ${describe(error)}`);
      at.problem = `Lo couldn't read what changed from the local copy: ${describe(error)}`;
      this.#fallBackToGithub(at);
    }
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
    const acting = this.#info?.acting;
    if (acting === undefined || at.changesFrom === 'github' || at.started.has('github')) return;
    at.started.add('github');
    void this.#fromGithub(at, acting);
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
      reads.github(acting, (client) =>
        readPullFiles(client, pull, {
          maxPages: MAX_PAGES,
          // Without an account, GitHub allows 60 requests an hour, and nothing else polls.
          keepRequests: acting.kind === 'anonymous' ? KEEP_ANONYMOUS : KEEP_REQUESTS,
        }),
      ),
    ]);
    if (!this.#current(at)) return;
    // The local copy's say wins.
    if (at.from === undefined) {
      if (tree.status === 'fulfilled' && tree.value) {
        if (tree.value.truncated) {
          at.listing = {
            kind: 'changed',
            why: 'GitHub lists only part of this repository’s files, so the tree shows the changed ones until the local copy is ready.',
          };
        } else {
          at.files = new Files(fromGithub(tree.value.items), this.#options.wholeLimit);
          at.listing = at.files.listing();
        }
        at.from = 'github';
      } else if (tree.status === 'rejected') {
        this.#options.log(`reading the files from GitHub: ${describe(tree.reason)}`);
        at.listing = {
          kind: 'changed',
          why: `Lo couldn’t read the repository’s files from GitHub (${describe(tree.reason)}), so the tree shows the changed ones until the local copy is ready.`,
        };
      }
    }
    if (at.changesFrom === undefined) {
      if (files.status === 'fulfilled') {
        const listed = files.value;
        if (listedAt(listed.files, at.head)) {
          at.changes = listed.files.map(githubChanged);
          at.changesFrom = 'github';
          at.partial = listed.cutShort !== undefined || listed.files.length >= MAX_FILES;
        }
      } else {
        this.#options.log(`reading the changed files from GitHub: ${describe(files.reason)}`);
        at.problem ??= `Lo couldn’t read the changed files from GitHub: ${describe(files.reason)}`;
      }
    }
    this.#publish();
  }

  #publish(): void {
    if (this.#closed) return;
    this.#options.publish(this.state());
  }
}
