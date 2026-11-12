// A pull request's tab's diff in main: each changed file's versions at the head on screen, and
// their texts on request. Both come from the local copy once it's ready at that head, and from
// GitHub's list of the pull request's files, with their patches, until then; what the copy says
// replaces what GitHub said, and a new head on screen starts again. Files are named by their place
// in the list, never by their paths, which can be long enough to slow any map keyed by them.
// Nothing here calls Electron.

import {
  changedPath,
  linguistBoolean,
  type ChangedFile,
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
} from '@lo/github';
import { MAX_SHOWN_BYTES, tooLargeToShow } from '@lo/review';

import { IpcError } from '../../../ipc/contract.ts';
import type { Comparing, OnScreen } from '../../revisions/service.ts';
import type { Acting } from '../../tab/contract.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { DiffState, FileText, FileVersions, Source } from '../contract.ts';
import { listedAt } from './listed.ts';
import { conflictedVersions, githubVersions, localVersions } from './versions.ts';

/** Requests GitHub's API keeps for the poller: the diff reads no page of files past them. */
export const KEEP_REQUESTS = 100;

/** The same, without an account. */
export const KEEP_ANONYMOUS = 10;

/** The most bytes one `texts` reads, both sides of every file it's asked for together. */
export const TEXTS_BYTES = 2 * MAX_SHOWN_BYTES + 16 * 1024 * 1024;

/** What a tab's diff reads with. */
export interface DiffReads {
  /** The tab's local copy's clone, once it's opened. */
  clone(): Promise<Repo> | undefined;
  /** Runs `request` with GitHub's client for `acting`, in its turn. */
  github<T>(acting: Acting, request: (client: GithubClient) => Promise<T>): Promise<T>;
}

export interface DiffTabOptions {
  readonly id: string;
  readonly reads: DiffReads;
  /** Sends the diff to the window, each time it changes. */
  readonly publish: (state: DiffState) => void;
  /** Says the window drew the diff at a head. */
  readonly drawn: (head: string) => void;
  readonly log: (line: string) => void;
}

/**
 * What's known of the comparison on screen: of the whole pull request at the head on screen, or of
 * two revisions.
 */
interface At {
  readonly head: Oid;
  /** The two revisions compared, when it isn't the whole pull request. */
  readonly comparing: Comparing | undefined;
  from: Source | undefined;
  files: FileVersions[] | undefined;
  /** GitHub's patches, by the files' places, while the files are GitHub's. */
  patches: (string | undefined)[];
  partial: boolean;
  problem: string | undefined;
  /** What's been started for it, so nothing starts twice. */
  readonly started: Set<Source>;
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DiffTab {
  readonly id: string;
  readonly #options: DiffTabOptions;
  #info: PullTabInfo | undefined;
  #at: At | undefined;
  /** What the diff waits for before anything is drawn, if anything. */
  #waiting: string | undefined;
  #closed = false;

  constructor(options: DiffTabOptions) {
    this.#options = options;
    this.id = options.id;
  }

  /** The diff as the window gets it. */
  state(): DiffState {
    const at = this.#at;
    return {
      id: this.id,
      at: at?.head ?? null,
      comparison: at?.comparing?.key ?? null,
      waiting: this.#waiting ?? null,
      from: at?.from ?? null,
      files: at?.files ?? null,
      partial: at?.partial ?? false,
      problem: at?.problem ?? null,
    };
  }

  /**
   * Follows the tab as it is now, and what it compares: a new head on screen, or another comparison
   * of revisions, starts the diff again. The whole pull request at the head on screen is read from
   * the local copy once it's ready at that head, and from GitHub's API until then, once GitHub has
   * said the head is its own. Two revisions are compared in the local copy; until the revisions
   * feature has both, if it says to wait, nothing is drawn.
   */
  update(info: PullTabInfo, screen: OnScreen = { kind: 'head' }): void {
    if (this.#closed) return;
    this.#info = info;
    if (screen.kind === 'waiting') {
      if (this.#at !== undefined || this.#waiting !== screen.why) {
        this.#at = undefined;
        this.#waiting = screen.why;
        this.#publish();
      }
      return;
    }
    const waited = this.#waiting !== undefined;
    this.#waiting = undefined;
    if (screen.kind === 'revisions') {
      const { comparing } = screen;
      if (this.#at?.comparing?.key !== comparing.key) {
        const at = this.#newAt(comparing.new.head, comparing);
        at.started.add('local');
        void this.#fromComparing(at, comparing);
      } else if (waited) {
        this.#publish();
      }
      return;
    }
    const { shown } = info;
    if (shown === undefined) {
      if (waited) this.#publish();
      return;
    }
    let head: Oid;
    try {
      head = parseOid(shown);
    } catch {
      return;
    }
    if (this.#at?.head !== head || this.#at.comparing !== undefined) this.#newAt(head, undefined);
    else if (waited) this.#publish();
    const at = this.#at;
    if (!at) return;
    const { local } = info;
    if (local.kind === 'ready' && local.head === head) {
      if (!at.started.has('local')) {
        at.started.add('local');
        const mergeBase = local.mergeBase === null ? undefined : parseOid(local.mergeBase);
        void this.#fromLocal(at, mergeBase);
      }
    } else if (info.acting !== undefined && !info.provisional && !at.started.has('github')) {
      at.started.add('github');
      void this.#fromGithub(at, info.acting);
    }
  }

  /** Starts the diff again at `head`, of `comparing`, if it's two revisions. */
  #newAt(head: Oid, comparing: Comparing | undefined): At {
    const at: At = {
      head,
      comparing,
      from: undefined,
      files: undefined,
      patches: [],
      partial: false,
      problem: undefined,
      started: new Set(),
    };
    this.#at = at;
    this.#publish();
    return at;
  }

  /** The window drew the diff at `head`. */
  drawn(head: string): void {
    if (this.#closed || this.#at?.head !== head) return;
    this.#options.drawn(head);
  }

  /** The texts of the files at places `files` of the diff at `head`, of `comparison`, from `from`. */
  async texts(
    head: string,
    comparison: string | null,
    from: Source,
    files: readonly number[],
  ): Promise<FileText[]> {
    const at = this.#at;
    if (
      !at ||
      at.head !== head ||
      (at.comparing?.key ?? null) !== comparison ||
      at.from !== from ||
      !at.files
    ) {
      throw new IpcError('moved', 'The diff is of another head, comparison or source now.');
    }
    const list = at.files;
    const asked = files.map((place) => {
      const file = list[place];
      if (!file) throw new IpcError('invalid', `The diff has no file at place ${place}.`);
      return { place, file };
    });
    if (from === 'github') {
      return asked.map(({ place }): FileText => {
        const patch = at.patches[place];
        return patch === undefined
          ? { kind: 'missing', why: 'GitHub’s diff doesn’t show this file.' }
          : { kind: 'patch', patch };
      });
    }
    const bytes = asked.reduce(
      (sum, { file }) => sum + (file.old?.size ?? 0) + (file.new?.size ?? 0),
      0,
    );
    if (bytes > TEXTS_BYTES)
      throw new IpcError('tooLarge', 'That’s more text than Lo reads at once.');
    const opening = this.#options.reads.clone();
    if (!opening) throw new IpcError('unavailable', 'The local copy isn’t open.');
    const repo = await opening;
    const blobs = asked.flatMap(({ file }) =>
      [file.old?.blob, file.new?.blob].filter((blob) => blob !== undefined),
    );
    try {
      // What the comparison downloaded is there already; anything since removed comes again.
      if (!repo.offline) await repo.download(blobs.map((blob) => parseOid(blob)));
    } catch (error) {
      this.#options.log(`downloading the files to show: ${describe(error)}`);
    }
    const texts: FileText[] = [];
    for (const { file } of asked) {
      try {
        texts.push({
          kind: 'texts',
          old: await this.#read(repo, file.old?.blob),
          new: await this.#read(repo, file.new?.blob),
        });
      } catch (error) {
        texts.push({ kind: 'missing', why: describe(error) });
      }
    }
    return texts;
  }

  close(): void {
    this.#closed = true;
  }

  /** A blob's text, or `null` for no blob. */
  async #read(repo: Repo, blob: string | undefined): Promise<string | null> {
    if (blob === undefined) return null;
    const bytes = await repo.readBlob(parseOid(blob), { maxBytes: MAX_SHOWN_BYTES });
    if (bytes === undefined) throw new Error('The local copy doesn’t have this file’s contents.');
    // A minified bundle on one line is as slow to lay out as it is large.
    const tooLarge = tooLargeToShow(bytes.length, [bytes]);
    if (tooLarge !== undefined) throw new Error(`Lo doesn’t show this file: ${tooLarge}.`);
    return decoder.decode(bytes);
  }

  /** Whether `at` is still the comparison on screen. */
  #current(at: At): boolean {
    return !this.#closed && this.#at === at;
  }

  async #fromLocal(at: At, mergeBase: Oid | undefined): Promise<void> {
    const opening = this.#options.reads.clone();
    if (!opening) return;
    // With no history in common, the copy can't say what the pull request changes.
    if (mergeBase === undefined) {
      this.#fallBackToGithub(at);
      return;
    }
    try {
      const repo = await opening;
      const compared = await repo.compareRevisions(
        { base: mergeBase, head: mergeBase },
        { base: mergeBase, head: at.head },
      );
      if (!this.#current(at)) return;
      if ('refused' in compared) {
        at.problem = `The changed files are larger than ${Math.round(compared.limit / 2 ** 20)} MB, so the diff is GitHub’s.`;
        this.#publish();
        this.#fallBackToGithub(at);
        return;
      }
      const files = compared.files.flatMap((file) => (file.change ? [file.change] : []));
      const generated = await this.#generated(repo, at.head, files);
      if (!this.#current(at)) return;
      at.files = files.map((file, index) => localVersions(file, generated[index]));
      at.from = 'local';
      at.patches = [];
      at.partial = false;
      at.problem = undefined;
    } catch (error) {
      if (!this.#current(at)) return;
      this.#options.log(`finding what changed at ${at.head}: ${describe(error)}`);
      at.problem = `Lo couldn’t read what changed from the local copy: ${describe(error)}`;
      this.#fallBackToGithub(at);
    }
    this.#publish();
  }

  /**
   * Two revisions' diff, from the comparison the revisions feature made in the local copy: across a
   * rebase when the base moved, each file the replay conflicted on marked. GitHub has nothing to
   * stand in for it, so a comparison that can't be made says why, and shows nothing.
   */
  async #fromComparing(at: At, comparing: Comparing): Promise<void> {
    const opening = this.#options.reads.clone();
    try {
      if (!opening) throw new Error('The local copy isn’t open.');
      const repo = await opening;
      const compared = await comparing.compared();
      if (!this.#current(at)) return;
      if ('refused' in compared) {
        at.problem = `The files changed between these revisions are larger than ${Math.round(compared.limit / 2 ** 20)} MB, so Lo doesn’t compare them.`;
        this.#publish();
        return;
      }
      const changed = compared.files.flatMap((file) => (file.change ? [file.change] : []));
      const generated = await this.#generated(repo, at.head, changed);
      if (!this.#current(at)) return;
      let next = 0;
      at.files = compared.files.map((file) => {
        const conflicted = file.resolution !== undefined;
        // A file the replay conflicted on, which the author left as it was on one side, is listed
        // all the same: they resolved a conflict in it.
        if (!file.change) return conflictedVersions(file.path);
        return localVersions(file.change, generated[next++], conflicted);
      });
      at.from = 'local';
      at.problem = undefined;
    } catch (error) {
      if (!this.#current(at)) return;
      this.#options.log(`comparing the revisions: ${describe(error)}`);
      at.problem = `Lo couldn’t compare the revisions: ${describe(error)}`;
    }
    this.#publish();
  }

  /**
   * What each of `files`' `linguist-generated` attribute is in `head`, from the `.gitattributes`
   * files that apply, downloaded first. Nothing for each when they can't be read.
   */
  async #generated(
    repo: Repo,
    head: Oid,
    files: readonly ChangedFile[],
  ): Promise<(boolean | undefined)[]> {
    const paths = files.map(changedPath);
    const none = paths.map(() => undefined);
    if (paths.length === 0) return none;
    try {
      if (!repo.offline) await repo.downloadAttributes(head, paths);
      const attributes = await repo.attribute(head, 'linguist-generated', paths);
      return attributes.map((attribute) =>
        attribute === undefined ? undefined : linguistBoolean(attribute),
      );
    } catch (error) {
      this.#options.log(`reading .gitattributes at ${head}: ${describe(error)}`);
      return none;
    }
  }

  /** Reads the files from GitHub, when the local copy couldn't say, if it hasn't yet. */
  #fallBackToGithub(at: At): void {
    const acting = this.#info?.acting;
    if (acting === undefined || at.from !== undefined || at.started.has('github')) return;
    at.started.add('github');
    void this.#fromGithub(at, acting);
  }

  async #fromGithub(at: At, acting: Acting): Promise<void> {
    const info = this.#info;
    if (!info) return;
    const repository = new RepoRef(info.repository.owner, info.repository.name);
    const pull = PullRef.of(repository, info.number);
    try {
      const listed = await this.#options.reads.github(acting, (client) =>
        readPullFiles(client, pull, {
          maxPages: MAX_PAGES,
          // Without an account, GitHub allows 60 requests an hour, and nothing else polls.
          keepRequests: acting.kind === 'anonymous' ? KEEP_ANONYMOUS : KEEP_REQUESTS,
        }),
      );
      // The local copy's say wins, and a list of a newer head than the one on screen isn't its.
      if (!this.#current(at) || at.from !== undefined) return;
      if (!listedAt(listed.files, at.head)) {
        this.#options.log('GitHub listed the files of a newer head; waiting for the local copy');
        return;
      }
      at.files = listed.files.map(githubVersions);
      at.patches = listed.files.map((file) => file.patch);
      at.from = 'github';
      at.partial = listed.cutShort !== undefined || listed.files.length >= MAX_FILES;
    } catch (error) {
      if (!this.#current(at)) return;
      this.#options.log(`reading the changed files from GitHub: ${describe(error)}`);
      at.problem ??= `Lo couldn’t read the changed files from GitHub: ${describe(error)}`;
    }
    this.#publish();
  }

  #publish(): void {
    if (this.#closed) return;
    this.#options.publish(this.state());
  }
}
