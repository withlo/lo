// What changed in a pull request since the commit its overview describes, up to the head on
// screen, read from the pull request's local copy, for the window to say how far the overview is
// out of date and to map its lines onto the head.
//
// - What the pushes since changed is compared once, as the revisions feature compares two
//   revisions: each from where it branched off the base branch, the older one's changes replayed
//   onto the newer base when the base moved, so what a rebase brought with the base doesn't count
//   as the pushes'. That gives how many files the pushes changed, and whether they changed a file.
// - A file still at its path is that file, as git compares them. Where one that's gone from its
//   path went is found from everything that changed from the commit to the head, the base
//   branch's changes too, renames found, compared once as a file first needs it. Past what Lo
//   downloads for them, Lo can't tell a file that moved from one that was deleted, and says so.
//   A file with the same blob at its path needs neither comparison.
// - The overview's commit is fetched by its ID when the copy lacks it, as the overview's checks
//   fetch it, once for every read that needs it.
// - When a file's blob differs, both its texts are read whole, as a block's are (`readWhole`).
// - Every download for one commit and head, the comparisons' and each file's, counts against
//   `DOWNLOAD_LIMIT`: past it, nothing more is downloaded for them.
// - It stops once the tab closes.
//
// Nothing here calls Electron.

import {
  GitError,
  parseOid,
  type ChangedFile,
  type ComparedFile,
  type FileVersion,
  type Oid,
  type Repo,
  type Revision,
} from '@lo/git';

import type { LocalState } from '../../tab/contract.ts';
import type { FileSinceText, SinceReply } from '../contract.ts';
import { DOWNLOAD_LIMIT } from './code.ts';
import { baseOf, readWhole, type Budget, type ReadyLocal } from './texts.ts';

/** What the comparisons and files are read through: the pull request's local copy. */
export type SinceClone = Pick<
  Repo,
  | 'offline'
  | 'hasCommit'
  | 'fetchCommit'
  | 'mergeBase'
  | 'compareRevisions'
  | 'fileVersions'
  | 'objectSizes'
  | 'download'
  | 'readBlob'
>;

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const encoder = new TextEncoder();

/**
 * What the pushes since the overview's commit changed, up to the head: how many files comparing
 * the two lists, and each change, renames found; none when they couldn't be compared.
 */
interface Compared {
  readonly count: number;
  readonly changes: readonly ChangedFile[];
}

/** One commit compared with one head, worked out once. */
interface Comparing {
  /** The two, and the local copy's base branch tip and merge base they were worked out from. */
  readonly key: string;
  readonly budget: Budget;
  /** What the pushes since changed, replayed across a rebase. */
  readonly pushes: Promise<Compared | undefined>;
  /** Everything that changed from the commit to the head, the base's changes too, once asked. */
  whole: Promise<readonly ChangedFile[] | undefined> | undefined;
}

/** Why the local copy can't be read for what changed now, as `since` says it. */
type NotReady = Exclude<SinceReply, { kind: 'read' }>;

/**
 * A tab's reads of what changed since its overview's commit: any number at once, sharing one
 * comparison of the commit with the head, until `stop`, as the tab closes, stops them.
 */
export class SinceReads {
  readonly #log: (line: string) => void;
  readonly #stopped = new AbortController();
  #comparing: Comparing | undefined;
  /** The overview's commit, fetched once for every read that needs it. */
  #fetching: { readonly commit: Oid; readonly done: Promise<NotReady | undefined> } | undefined;

  constructor(options: { log?: ((line: string) => void) | undefined } = {}) {
    this.#log = options.log ?? (() => {});
  }

  /** How many files the pushes since `commit` changed, up to `head`. */
  async count(
    local: LocalState,
    clone: () => Promise<SinceClone> | undefined,
    commit: string,
    head: string,
  ): Promise<SinceReply> {
    const ready = await this.#open(local, clone, commit, head);
    if ('kind' in ready) return ready;
    try {
      const compared = await this.#comparingAt(ready.clone, ready.local, ready.commit, ready.head)
        .pushes;
      return { kind: 'read', files: compared?.count ?? null };
    } catch (error) {
      return this.#failed(error);
    }
  }

  /** Where the file at `path` at `commit` is at `head`, with both texts when it changed. */
  async file(
    local: LocalState,
    clone: () => Promise<SinceClone> | undefined,
    commit: string,
    head: string,
    path: string,
  ): Promise<FileSinceText> {
    const ready = await this.#open(local, clone, commit, head);
    if ('kind' in ready) {
      switch (ready.kind) {
        case 'waiting':
          return { kind: 'waiting' };
        case 'noGit':
          return { kind: 'unread', why: 'Lo needs git to read the code.' };
        case 'failed':
          return { kind: 'unread', why: ready.why };
        default:
          ready satisfies never;
          return { kind: 'unread', why: 'Lo couldn’t read the local copy.' };
      }
    }
    try {
      return await this.#file(ready.clone, ready.local, ready.commit, ready.head, path);
    } catch (error) {
      const failed = this.#failed(error);
      return { kind: 'unread', why: failed.why };
    }
  }

  /** Stops every read, as the tab closes. */
  stop(): void {
    this.#stopped.abort();
  }

  /** The local copy, opened, once it has both commits; or why it can't be read now. */
  async #open(
    local: LocalState,
    clone: () => Promise<SinceClone> | undefined,
    commit: string,
    head: string,
  ): Promise<{ clone: SinceClone; local: ReadyLocal; commit: Oid; head: Oid } | NotReady> {
    switch (local.kind) {
      case 'ready':
        break;
      case 'noGit':
        return { kind: 'noGit' };
      case 'failed':
        return {
          kind: 'failed',
          why: `The pull request’s local copy couldn’t be fetched: ${local.message}`,
        };
      case 'waiting':
      case 'fetching':
      case 'retrying':
        return { kind: 'waiting' };
      default:
        local satisfies never;
        return { kind: 'waiting' };
    }
    const opening = clone();
    if (!opening) return { kind: 'waiting' };
    try {
      const opened = await opening;
      const ids = { commit: parseOid(commit), head: parseOid(head) };
      // The head arrives with the copy's next fetch, as after a newer push is loaded.
      if (!(await opened.hasCommit(ids.head))) return { kind: 'waiting' };
      const lacking = await this.#fetched(opened, ids.commit);
      if (lacking) return lacking;
      return { clone: opened, local, ...ids };
    } catch (error) {
      return this.#failed(error);
    }
  }

  /** Fetches `commit` by its ID when the copy lacks it, once; or why it can't be read without. */
  async #fetched(clone: SinceClone, commit: Oid): Promise<NotReady | undefined> {
    if (await clone.hasCommit(commit)) return undefined;
    // Offline, it's fetched once the copy is online again, which reads it all again.
    if (clone.offline) return { kind: 'waiting' };
    if (this.#fetching?.commit !== commit) {
      const done = clone.fetchCommit(commit).then(
        () => undefined,
        (error: unknown): NotReady => {
          if (error instanceof GitError && error.detail.kind === 'unavailable') {
            return {
              kind: 'failed',
              why: 'GitHub no longer has the commit the overview describes.',
            };
          }
          // Asked again by the next read.
          if (this.#fetching?.done === done) this.#fetching = undefined;
          return this.#failed(error);
        },
      );
      this.#fetching = { commit, done };
    }
    const failed = await this.#fetching.done;
    if (failed) return failed;
    return (await clone.hasCommit(commit)) ? undefined : { kind: 'waiting' };
  }

  async #file(
    clone: SinceClone,
    local: ReadyLocal,
    commit: Oid,
    head: Oid,
    path: string,
  ): Promise<FileSinceText> {
    const bytes = encoder.encode(path);
    const [was] = await clone.fileVersions(commit, [bytes]);
    if (was === undefined || was === 'folder') {
      return { kind: 'unread', why: 'There’s no file at that path at the overview’s commit.' };
    }
    if (commit === head) return { kind: 'same', path };
    const [found] = await clone.fileVersions(head, [bytes]);
    const there = found === 'folder' ? undefined : found;
    // The same blob at the same path: nothing to compare.
    if (there?.oid === was.oid) return { kind: 'same', path };
    const comparing = this.#comparingAt(clone, local, commit, head);
    // Still at its path, it's that file, as git compares them: only one that's gone from its path
    // was renamed, or deleted, by the pushes or the base branch, which only everything that
    // changed tells apart.
    let now: FileVersion | undefined = there;
    if (now === undefined) {
      const whole = await this.#wholeOf(clone, commit, head, comparing);
      if (whole === undefined) {
        return { kind: 'unread', why: 'Lo couldn’t tell where the file went since.' };
      }
      now = whole.find((each) => each.old?.path.equals(bytes))?.new;
      if (now === undefined) return { kind: 'deleted' };
    }
    const at = decoder.decode(now.path);
    if (now.oid === was.oid) return { kind: 'same', path: at };
    // The pushes changed it when their comparison lists it where it is now; without that
    // comparison, every change might be the pushes'.
    const pushes = await comparing.pushes;
    const moved = now.path;
    const pushed =
      pushes === undefined || pushes.changes.some((each) => each.new?.path.equals(moved));
    const signal = this.#stopped.signal;
    const old = await readWhole(clone, was, comparing.budget, signal);
    if (typeof old !== 'string') return { kind: 'changed', path: at, pushed, texts: old };
    const text = await readWhole(clone, now, comparing.budget, signal);
    if (typeof text !== 'string') return { kind: 'changed', path: at, pushed, texts: text };
    return { kind: 'changed', path: at, pushed, texts: { old, new: text } };
  }

  /** What the pushes since `commit` changed up to `head`, worked out once for the two and the copy's base. */
  #comparingAt(clone: SinceClone, local: ReadyLocal, commit: Oid, head: Oid): Comparing {
    const key = [commit, head, local.base, local.mergeBase ?? ''].join(' ');
    if (this.#comparing?.key === key) return this.#comparing;
    const budget: Budget = { left: DOWNLOAD_LIMIT };
    const pushes = (async (): Promise<Compared | undefined> => {
      if (commit === head) return { count: 0, changes: [] };
      const [from, to] = await Promise.all([
        baseOf(clone, local, commit),
        baseOf(clone, local, head),
      ]);
      if (from === undefined || to === undefined) return undefined;
      const files = await this.#compare(
        clone,
        { base: from, head: commit },
        { base: to, head },
        budget,
      );
      return files && { count: files.length, changes: changesIn(files) };
    })().catch((error: unknown) => this.#notCompared(error));
    this.#comparing = { key, budget, pushes, whole: undefined };
    return this.#comparing;
  }

  /**
   * Everything that changed from `commit` to `head`, the base branch's changes too, renames found:
   * compared once it's first asked for, after the pushes' comparison, whose downloads it uses.
   */
  #wholeOf(
    clone: SinceClone,
    commit: Oid,
    head: Oid,
    comparing: Comparing,
  ): Promise<readonly ChangedFile[] | undefined> {
    comparing.whole ??= comparing.pushes
      .then(async () => {
        // From the history the two share, so the two trees are compared as they are.
        const shared = await clone.mergeBase(commit, head);
        if (shared === undefined) return undefined;
        const files = await this.#compare(
          clone,
          { base: shared, head: commit },
          { base: shared, head },
          comparing.budget,
        );
        return files && changesIn(files);
      })
      .catch((error: unknown) => this.#notCompared(error));
    return comparing.whole;
  }

  /** `old` compared with `now`, as revisions are, within `budget`; none past it. */
  async #compare(
    clone: SinceClone,
    old: Revision,
    now: Revision,
    budget: Budget,
  ): Promise<readonly ComparedFile[] | undefined> {
    if (budget.left <= 0) return undefined;
    const made = await clone.compareRevisions(old, now, {
      maxBytes: budget.left,
      signal: this.#stopped.signal,
      received: (bytes) => {
        budget.left -= bytes;
      },
    });
    if ('refused' in made) {
      this.#log('what changed since an overview’s commit is past what Lo downloads for it');
      return undefined;
    }
    return made.files;
  }

  /** A comparison that failed, logged unless it was stopped: none. */
  #notCompared(error: unknown): undefined {
    if (!this.#stopped.signal.aborted) {
      this.#log(`comparing an overview’s commit with the head: ${describe(error)}`);
    }
    return undefined;
  }

  /** A read that failed, logged, unless it was stopped. */
  #failed(error: unknown): Extract<SinceReply, { kind: 'failed' }> {
    if (this.#stopped.signal.aborted) return { kind: 'failed', why: 'The read was stopped.' };
    this.#log(`reading what changed since an overview’s commit: ${describe(error)}`);
    return { kind: 'failed', why: `Lo couldn’t read it from the local copy: ${describe(error)}` };
  }
}

/** The changes a comparison lists. */
function changesIn(files: readonly ComparedFile[]): ChangedFile[] {
  return files.flatMap((file) => (file.change ? [file.change] : []));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
