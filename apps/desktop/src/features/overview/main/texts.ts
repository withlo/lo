// The files an overview's blocks show, read from the pull request's local copy: each file's text at
// the commit the overview's header names, and for a code block, the file where that commit
// branched off the base branch, so the block can show what the pull request changed in it, as
// GitHub diffs a pull request.
//
// - Where the diff starts is the commit's merge base with the base branch: see `baseOf`. For a
//   stack's overview, it's the commit's merge base with where the stack's bottom layer's changes
//   start, which the copy fetches first when it doesn't have it: see `startOf`.
// - What the pull request changed there, renames found, is worked out once for each commit and
//   base, from the local copy, which downloads both sides of each changed file as the diff does.
//   Past what's left to download, or when it fails, a file is looked for at the same path in the
//   base.
// - Each file is read whole, up to `LIMITS.file`, the most the overview's checks read of one, and
//   must be text. What the copy lacks of it is downloaded alone, stopped past `PROBE`.
// - Every download for one commit, the comparison's and each file's, counts against
//   `DOWNLOAD_LIMIT`, as the checks' reads do: past it, nothing more is downloaded for the commit.
// - It stops once the tab closes.
//
// Nothing here calls Electron.

import { BINARY_WINDOW, LIMITS } from '@lo/artifact';
import { parseOid, type ChangedFile, type FileVersion, type Oid, type Repo } from '@lo/git';

import type { LocalState } from '../../tab/contract.ts';
import type { BaseText, BlockText, CodeCause } from '../contract.ts';
import { DOWNLOAD_LIMIT, pastCap, PROBE } from './code.ts';

/** What the files are read through: the pull request's local copy. */
export type TextsClone = Pick<
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

/** The local copy once it's there: the head it was fetched for, the base branch's tip, and where they branched. */
export type ReadyLocal = Extract<LocalState, { kind: 'ready' }>;

/** What the downloads are, in the clone's progress and log. */
const DOWNLOADING = 'the code an overview shows';

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const encoder = new TextEncoder();

/**
 * Where the pull request's diff at `commit` starts: the commit's merge base with the base branch, as
 * GitHub diffs a pull request, from the local copy `local` says is there.
 *
 * - At the head the copy was fetched for, it's the copy's own merge base, which already allows for
 *   a pull request merged into its base branch.
 * - At another commit, such as an earlier push, it's the commit's merge base with the base
 *   branch's tip, never the tip itself: what the base branch gained after the commit branched off
 *   isn't the pull request's.
 * - A commit the base branch holds already, as once the pull request is merged, branched off where
 *   the head did: it's the commit's merge base with that.
 * - With no history in common, there's none.
 */
export async function baseOf(
  clone: Pick<Repo, 'mergeBase'>,
  local: ReadyLocal,
  commit: Oid,
): Promise<Oid | undefined> {
  const forked = local.mergeBase === null ? undefined : parseOid(local.mergeBase);
  if (commit === parseOid(local.head)) return forked;
  const base = await clone.mergeBase(commit, parseOid(local.base));
  if (base !== commit || forked === undefined) return base;
  return clone.mergeBase(commit, forked);
}

/**
 * Where a stack's diff at `commit` starts: the commit's merge base with `start`, where the stack's
 * bottom layer's changes start, so the stack's diff holds every layer's changes and none of what's
 * below it. The copy fetches `start` first when it doesn't have it, as it does a commit an overview
 * names. With no history in common, there's none.
 */
export async function startOf(
  clone: Pick<Repo, 'offline' | 'hasCommit' | 'fetchCommit' | 'mergeBase'>,
  commit: Oid,
  start: Oid,
): Promise<Oid | undefined> {
  if (!(await clone.hasCommit(start)) && !clone.offline) await clone.fetchCommit(start);
  return clone.mergeBase(commit, start);
}

/** What's left to download for one commit's files, in bytes. */
export interface Budget {
  left: number;
}

/** What the pull request changed at one commit, from where it branched off, worked out once. */
interface Changes {
  /** The commit, and the local copy's base branch tip and merge base it was worked out from. */
  readonly key: string;
  /** What's left to download for the commit, which the comparison and every file count against. */
  readonly budget: Budget;
  /** Whether a read asked where the diff starts, so the rest was set going. */
  readonly started: boolean;
  readonly base: Promise<Oid | undefined>;
  /** Every file that changed, renames found; none when that couldn't be worked out. */
  readonly files: Promise<readonly ChangedFile[] | undefined>;
}

/** What a commit's changes are before a read asks where its diff starts: never awaited. */
const NOT_ASKED: Promise<never> = new Promise(() => {});

/**
 * A tab's reads of the files its overview's blocks show: any number at once, sharing what the pull
 * request changed at the commit, until `stop`, as the tab closes, stops them.
 */
export class BlockTexts {
  readonly #log: (line: string) => void;
  readonly #stopped = new AbortController();
  #changes: Changes | undefined;

  constructor(options: { log?: ((line: string) => void) | undefined } = {}) {
    this.#log = options.log ?? (() => {});
  }

  /**
   * The file at `path` at `commit`, from the tab's local copy as `local` says it is, opened by
   * `clone`; with `withBase`, where its diff starts too: where the commit branched off the base
   * branch, or with `from`, a stack's start, where it branched off that.
   */
  async read(
    local: LocalState,
    clone: () => Promise<TextsClone> | undefined,
    commit: string,
    path: string,
    withBase: boolean,
    from?: string,
  ): Promise<BlockText> {
    switch (local.kind) {
      case 'ready':
        break;
      case 'noGit':
        return unread('noGit');
      case 'failed':
        return unread('notFetched');
      case 'waiting':
      case 'fetching':
      case 'retrying':
        return unread('notReady');
      default:
        local satisfies never;
        return unread('notReady');
    }
    const opening = clone();
    if (!opening) return unread('notReady');
    try {
      const start = from === undefined ? undefined : parseOid(from);
      return await this.#read(await opening, local, parseOid(commit), path, withBase, start);
    } catch (error) {
      if (this.#stopped.signal.aborted) return unread('unknown');
      this.#log(`reading the code a block of the overview shows: ${describe(error)}`);
      return unread('unknown');
    }
  }

  /** Stops every read, as the tab closes. */
  stop(): void {
    this.#stopped.abort();
  }

  async #read(
    clone: TextsClone,
    local: ReadyLocal,
    commit: Oid,
    path: string,
    withBase: boolean,
    start: Oid | undefined,
  ): Promise<BlockText> {
    if (!(await clone.hasCommit(commit))) {
      return unread('noCommit');
    }
    const bytes = encoder.encode(path);
    const [found] = await clone.fileVersions(commit, [bytes]);
    if (found === undefined || found === 'folder') {
      return unread('noFile');
    }
    const changes = this.#changesAt(clone, local, commit, withBase, start);
    const text = await readWhole(clone, found, changes.budget, this.#stopped.signal);
    if (typeof text !== 'string') return unread(text.why);
    if (!withBase) return { kind: 'text', text, base: null };
    return { kind: 'text', text, base: await this.#base(clone, commit, bytes, found, changes) };
  }

  /** How the file `version`, at `path` in `commit`, was where its diff starts. */
  async #base(
    clone: TextsClone,
    commit: Oid,
    path: Uint8Array,
    version: FileVersion,
    changes: Changes,
  ): Promise<BaseText> {
    let base: Oid | undefined;
    try {
      base = await changes.base;
    } catch (error) {
      this.#log(`finding where an overview's commit branched off: ${describe(error)}`);
      return unknown('unknown');
    }
    if (base === undefined) return unknown('unrelated');
    if (base === commit) return { kind: 'same' };
    const files = await changes.files;
    let old: FileVersion | undefined;
    if (files) {
      const change = files.find((file) => file.new?.path.equals(path));
      if (!change) return { kind: 'same' };
      old = change.old;
    } else {
      const [there] = await clone.fileVersions(base, [path]);
      old = there === 'folder' ? undefined : there;
    }
    if (old === undefined) return { kind: 'added' };
    // Only its mode changed, such as being made executable.
    if (old.oid === version.oid && old.path.equals(path)) return { kind: 'same' };
    const text = await readWhole(clone, old, changes.budget, this.#stopped.signal);
    if (typeof text !== 'string') return unknown(text.why);
    return { kind: 'changed', path: decoder.decode(old.path), text };
  }

  /**
   * What the pull request changed at `commit`, worked out once for each commit and base, once a
   * read asks for where a diff starts (`withBase`); and what's left to download for the commit.
   */
  #changesAt(
    clone: TextsClone,
    local: ReadyLocal,
    commit: Oid,
    withBase: boolean,
    start: Oid | undefined,
  ): Changes {
    const key = [commit, local.base, local.mergeBase ?? '', start ?? ''].join(' ');
    const known = this.#changes?.key === key ? this.#changes : undefined;
    if (known && (known.started || !withBase)) return known;
    const budget = known?.budget ?? { left: DOWNLOAD_LIMIT };
    if (!withBase) {
      this.#changes = { key, budget, started: false, base: NOT_ASKED, files: NOT_ASKED };
      return this.#changes;
    }
    const signal = this.#stopped.signal;
    const base = start === undefined ? baseOf(clone, local, commit) : startOf(clone, commit, start);
    const files = base
      .then(async (from) => {
        if (from === undefined || from === commit) return [];
        if (budget.left <= 0) return undefined;
        const compared = await clone.compareRevisions(
          { base: from, head: from },
          { base: from, head: commit },
          {
            maxBytes: budget.left,
            signal,
            received: (bytes) => {
              budget.left -= bytes;
            },
          },
        );
        if ('refused' in compared) {
          this.#log('what an overview’s commit changed is past what Lo downloads for it');
          return undefined;
        }
        return compared.files.flatMap((file) => (file.change ? [file.change] : []));
      })
      .catch((error: unknown) => {
        if (!signal.aborted) {
          this.#log(`finding what an overview's commit changed: ${describe(error)}`);
        }
        return undefined;
      });
    this.#changes = { key, budget, started: true, base, files };
    return this.#changes;
  }
}

/**
 * The text of the file `version`, read whole, downloading it first when the copy lacks it, its
 * download counted against `budget` and stopped once `signal` aborts; or why it can't be: it isn't
 * a file, or text, it's larger than the most Lo reads of a file, or the budget is spent.
 */
export async function readWhole(
  clone: Pick<Repo, 'offline' | 'download' | 'objectSizes' | 'readBlob'>,
  version: FileVersion,
  budget: Budget,
  signal: AbortSignal,
): Promise<string | { why: CodeCause }> {
  if (version.mode !== 'regular' && version.mode !== 'executable') {
    return { why: 'notFile' };
  }
  let { size } = version;
  if (size === undefined) {
    if (clone.offline) return { why: 'offline' };
    const cap = Math.min(PROBE, budget.left);
    if (cap <= 0) return { why: 'spent' };
    try {
      await clone.download([version.oid], DOWNLOADING, {
        maxBytes: cap,
        signal,
        received: (bytes) => {
          budget.left -= bytes;
        },
      });
    } catch (error) {
      if (pastCap(error)) return { why: cap === PROBE ? 'tooLarge' : 'spent' };
      throw error;
    }
    [size] = await clone.objectSizes([version.oid]);
    if (size === undefined) return { why: 'notDownloaded' };
  }
  if (size > LIMITS.file) return { why: 'tooLarge' };
  const bytes = await clone.readBlob(version.oid, { maxBytes: LIMITS.file });
  if (bytes?.length !== size) return { why: 'unknown' };
  if (bytes.subarray(0, BINARY_WINDOW).includes(0)) return { why: 'binary' };
  return decoder.decode(bytes);
}

function unread(why: CodeCause): Extract<BlockText, { kind: 'unread' }> {
  return { kind: 'unread', why };
}

function unknown(why: CodeCause | 'unrelated'): Extract<BaseText, { kind: 'unknown' }> {
  return { kind: 'unknown', why };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
