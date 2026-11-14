// Which lines GitHub takes a comment on, in main: a file's hunks in the pull request's diff at the
// revision in the newer column, which `@lo/review`'s `CommentableLines` reads in the window. They
// come from GitHub's patch of the file when that revision is the latest head, read once for each
// view and head, and otherwise, or where GitHub gave none, from the local copy's, from where that
// revision branched off, as GitHub diffs a pull request. With neither, Lo can't tell, and only a
// comment on the file is offered. Nothing here calls Electron.

import type { Repo } from '@lo/git';
import { parseOid } from '@lo/git';
import {
  fileHead,
  type Hunk,
  parsePatch,
  type Poller,
  type PullFile,
  PullRef,
  readPullFiles,
} from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { Commentable, HunkRow } from '../contract.ts';

/** The most pages of a pull request's files read: GitHub lists no more than 3,000. */
const MAX_PAGES = 30;

/** Pages of files not read while so few of the rate limit's requests are left. */
const KEEP_REQUESTS = 200;

/** What the commentable lines use of an account's poller. */
export type CommentablePoller = Pick<Poller, 'readOnce' | 'pullRequest'>;

export interface CommentableOptions {
  readonly view: (id: string) => PullTabInfo | undefined;
  readonly poller: (login: string) => Promise<CommentablePoller>;
  /** View `id`'s local copy, once it's been fetched. */
  readonly clone: (id: string) => Promise<Repo> | undefined;
  /**
   * The revision in view `id`'s newer column, and where it branched off, while two revisions are
   * compared: nothing for the whole pull request.
   */
  readonly comparing: (id: string) => { head: string; base: string } | undefined;
  readonly log: (line: string) => void;
}

/** A hunk as the window takes it. */
export function hunkRow(hunk: Hunk): HunkRow {
  const kind = { unchanged: ' ', deleted: '-', added: '+' } as const;
  return {
    old: hunk.old.start,
    new: hunk.new.start,
    kinds: hunk.lines.map((line) => kind[line.kind]).join(''),
  };
}

/** A path as git takes it: its bytes. */
function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * What GitHub's listing says of the file at `path`: its hunks, nothing in the diff, or nothing Lo
 * can use, for a patch GitHub left out of a file with changed lines, or a listing cut short.
 */
export function fromListing(
  files: readonly PullFile[],
  complete: boolean,
  path: string,
): Commentable | undefined {
  const file = files.find((each) => each.filename === path);
  if (!file) return complete ? { kind: 'notInDiff' } : undefined;
  // A binary file, a pure rename or a change of mode has no hunks: a comment on the file only.
  if (file.patch === undefined) return file.changes === 0 ? { kind: 'diff', hunks: [] } : undefined;
  try {
    return { kind: 'diff', hunks: parsePatch(file.patch).hunks.map(hunkRow) };
  } catch {
    return undefined;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CommentableReads {
  readonly #options: CommentableOptions;
  /** GitHub's listing of each view's pull request's files, by the view and the head listed. */
  readonly #listed = new Map<
    string,
    Promise<{ files: PullFile[]; complete: boolean } | undefined>
  >();

  constructor(options: CommentableOptions) {
    this.#options = options;
  }

  /**
   * Which comments GitHub takes on the file at `path` (`previous` in the base) at revision
   * `commit`, as view `id` shows it.
   */
  async read(
    id: string,
    commit: string,
    path: string,
    previous: string | null,
  ): Promise<Commentable> {
    const info = this.#options.view(id);
    if (!info) throw new IpcError('missing', "There's no pull request's tab with that id.");
    if (info.run) throw new IpcError('refused', 'A run of layers takes no comments.');
    if (info.acting?.kind !== 'account') throw new IpcError('refused', 'Sign in to comment.');
    const { login } = info.acting;
    const pull = new PullRef(info.repository.owner, info.repository.name, info.number);
    const poller = await this.#options.poller(login);
    const latest = poller.pullRequest(pull)?.details.headRefOid ?? info.latest;
    if (commit === latest) {
      const listed = await this.#listing(id, poller, pull, commit);
      const said = listed && fromListing(listed.files, listed.complete, path);
      if (said) return said;
    }
    return this.#local(id, info, commit, path, previous);
  }

  /** Forgets what was read for views that have closed. */
  forgetClosed(): void {
    for (const key of this.#listed.keys()) {
      if (!this.#options.view(key.slice(0, key.lastIndexOf('|')))) this.#listed.delete(key);
    }
  }

  /** GitHub's listing of the pull request's files at `head`, read once for the view. */
  #listing(id: string, poller: CommentablePoller, pull: PullRef, head: string) {
    const key = `${id}|${head}`;
    let listing = this.#listed.get(key);
    if (!listing) {
      listing = poller
        .readOnce((client) =>
          readPullFiles(client, pull, { maxPages: MAX_PAGES, keepRequests: KEEP_REQUESTS }),
        )
        .then((read) => {
          // GitHub listed them at another head: a push since.
          const at = read.head ?? read.files.map(fileHead).find((each) => each !== undefined);
          if (at !== undefined && at !== head) return undefined;
          return { files: read.files, complete: read.cutShort === undefined };
        })
        .catch((error: unknown) => {
          this.#options.log(`reading the pull request's files: ${describe(error)}`);
          this.#listed.delete(key);
          return undefined;
        });
      this.#listed.set(key, listing);
    }
    return listing;
  }

  /** The file's hunks from the local copy, from where revision `commit` branched off. */
  async #local(
    id: string,
    info: PullTabInfo,
    commit: string,
    path: string,
    previous: string | null,
  ): Promise<Commentable> {
    const comparing = this.#options.comparing(id);
    let base: string | undefined;
    if (comparing?.head === commit) base = comparing.base;
    else if (commit === info.shown && info.local.kind === 'ready') {
      base = info.local.mergeBase ?? undefined;
    }
    const opening = this.#options.clone(id);
    if (base === undefined || !opening) return { kind: 'unknown' };
    try {
      const repo = await opening;
      const patch = await repo.patch(
        parseOid(base),
        parseOid(commit),
        encode(path),
        previous === null ? undefined : encode(previous),
      );
      if (patch.binary) return { kind: 'diff', hunks: [] };
      // The file's the same there as where the revision branched off.
      if (patch.hunks.length === 0) return { kind: 'notInDiff' };
      return { kind: 'diff', hunks: parsePatch(patch.hunks.toString('utf8')).hunks.map(hunkRow) };
    } catch (error) {
      this.#options.log(`working out which lines take comments: ${describe(error)}`);
      return { kind: 'unknown' };
    }
  }
}
