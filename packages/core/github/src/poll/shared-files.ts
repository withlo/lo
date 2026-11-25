// A pull request's files as GitHub lists them, read once for everyone who asks: the diff and the
// tree each ask as a tab opens.

import type { RequestGate } from '../client.ts';
import type { PullFiles, ReadFiles } from '../files.ts';
import type { PullRef } from '../refs.ts';
import type { ReadPriority, ReadPriorityNow, RequestQueue } from './queue.ts';

/** How long a pull request's files are kept once read, for another feature that asks for them. */
export const PULL_FILES_KEPT_FOR = 30_000;

/** Someone who asks for a pull request's files ({@link SharedPullFiles}). */
export interface FilesAsker {
  /** Whether they still want the files: once nobody does as a page's turn comes, the read stops. */
  readonly wanted: () => boolean;
  /**
   * How soon they want the files now: the pages go in the queue as the soonest of those who still
   * want them says, ahead of the reads someone waits on while one wants them `foreground`, as the
   * diff on screen does, or right after those, ahead of polls, while one wants them `next`, as the
   * Files panel beside another view does.
   */
  readonly priority?: ReadPriorityNow | undefined;
}

/** Why a read of a pull request's files stopped: nobody wanted them any more. */
export class FilesUnwanted extends Error {
  constructor(pull: PullRef) {
    super(`nobody wants ${pull.toString()}'s files any more`);
    this.name = 'FilesUnwanted';
  }
}

/** Reads a pull request's files within `limits`, each request waiting for `gate` first. */
export type FilesRead = (pull: PullRef, limits: ReadFiles, gate: RequestGate) => Promise<PullFiles>;

/**
 * A pull request's files at a head, read once for everyone who asks while they're read, and kept
 * {@link PULL_FILES_KEPT_FOR} after. Each page takes a turn in the queue, if there's one, as soon
 * as an asker wants it ({@link FilesAsker.priority}); and goes only while an asker still wants the
 * files, so a tab closed, or a head no longer on screen, reads no more of them. A read that fails
 * isn't kept, so the next ask reads them again.
 */
export class SharedPullFiles {
  readonly #read: FilesRead;
  readonly #queue: RequestQueue | undefined;
  readonly #over: (() => void) | undefined;
  readonly #reads = new Map<string, Shared>();

  /** Reads with `read`, each page in its turn in `queue`, calling `over` as each read ends. */
  constructor(read: FilesRead, queue?: RequestQueue, over?: () => void) {
    this.#read = read;
    this.#queue = queue;
    this.#over = over;
  }

  /** `pull`'s files at `head`, within `limits`, for `asker`. */
  read(pull: PullRef, head: string, limits: ReadFiles, asker: FilesAsker): Promise<PullFiles> {
    const key = `${pull.key}@${head}`;
    const kept = this.#reads.get(key);
    if (kept) {
      kept.askers.add(asker);
      return kept.files;
    }
    const askers = new Set([asker]);
    const wanting = () => [...askers].filter((each) => each.wanted());
    // As soon as the soonest of those who still want them wants them.
    const priority = (): ReadPriority => {
      const wanted = new Set(
        wanting().map((each) =>
          each.priority === undefined ? 'background' : priorityNow(each.priority),
        ),
      );
      return wanted.has('foreground') ? 'foreground' : wanted.has('next') ? 'next' : 'background';
    };
    const turn = this.#queue?.gate(priority);
    const gate: RequestGate = async () => {
      const release = turn ? await turn() : () => {};
      if (wanting().length === 0) {
        release();
        throw new FilesUnwanted(pull);
      }
      return release;
    };
    const files = this.#read(pull, limits, gate);
    const entry: Shared = { files, askers, priority, reading: true };
    this.#reads.set(key, entry);
    const forget = () => {
      if (this.#reads.get(key) === entry) this.#reads.delete(key);
    };
    // Once it's over, the reads that gave way to it may go.
    const over = () => {
      entry.reading = false;
      this.#queue?.recheck();
      this.#over?.();
    };
    files.then(
      () => {
        over();
        setTimeout(forget, PULL_FILES_KEPT_FOR);
      },
      () => {
        over();
        forget();
      },
    );
    return files;
  }

  /**
   * Whether a read is under way that someone waits on, which frees the queue between its pages:
   * the queue's background reads give way to it ({@link RequestQueue.giveWayWhile}).
   */
  leads(): boolean {
    for (const shared of this.#reads.values()) {
      if (shared.reading && shared.priority() === 'foreground') return true;
    }
    return false;
  }

  /**
   * Whether a read is under way that someone wants soon, `foreground` or `next`: polls, which hold
   * the queue for many requests, wait for it rather than start between its pages.
   */
  wanted(): boolean {
    for (const shared of this.#reads.values()) {
      if (shared.reading && shared.priority() !== 'background') return true;
    }
    return false;
  }
}

/** A read of a pull request's files at a head, and who asked for it. */
interface Shared {
  readonly files: Promise<PullFiles>;
  readonly askers: Set<FilesAsker>;
  /** Its priority in the queue now. */
  readonly priority: () => ReadPriority;
  /** Whether it's under way. */
  reading: boolean;
}

function priorityNow(priority: ReadPriorityNow): ReadPriority {
  return typeof priority === 'function' ? priority() : priority;
}
