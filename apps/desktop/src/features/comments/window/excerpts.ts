// What a comment's opening says as one line of plain text, for a thread's collapsed line and the
// threads panel's rows: its Markdown read by the background process, a batch at a time, and kept in
// the window's memory under the Markdown it was read from, so a comment drawn again needn't wait. A
// comment shows no words until they're read, and its Markdown's syntax is never shown instead.

import { useEffect, useSyncExternalStore } from 'react';

import { EXCERPT_SOURCE, EXCERPTS_AN_ASK } from '../jobs.ts';
import { commentsJobs } from './main.ts';

/** How many openings the window keeps: the longest kept go first. */
export const KEPT = 2_000;

/** Reads comments' openings: each of `bodies` as one line of plain text, in order. */
export type Read = (bodies: string[]) => Promise<readonly string[]>;

export interface ExcerptStoreOptions {
  readonly read: Read;
  /** Runs `run` soon, and returns what cancels it. */
  readonly later?: ((run: () => void) => () => void) | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

/** The part of a comment's Markdown its opening is read from. */
function sourceOf(markdown: string): string {
  return markdown.slice(0, EXCERPT_SOURCE);
}

export class ExcerptStore {
  readonly #read: Read;
  readonly #later: (run: () => void) => () => void;
  readonly #log: (line: string) => void;
  /** Each opening read, by the Markdown it was read from. */
  readonly #held = new Map<string, string>();
  /** The Markdown to read at the next ask. */
  readonly #wanted = new Set<string>();
  readonly #listeners = new Set<() => void>();
  #version = 0;
  #asking = false;
  #waiting: (() => void) | undefined;

  constructor({ read, later, log }: ExcerptStoreOptions) {
    this.#read = read;
    this.#later =
      later ??
      ((run) => {
        const timer = setTimeout(run, 0);
        return () => clearTimeout(timer);
      });
    this.#log = log ?? ((line) => console.error(line));
  }

  /** How many times what the store holds has changed. */
  get version(): number {
    return this.#version;
  }

  /** The opening of `markdown` as one line of plain text, or nothing while it's still being read. */
  of(markdown: string): string {
    return this.#held.get(sourceOf(markdown)) ?? '';
  }

  /**
   * Reads the openings of `bodies` soon, but those held or already wanted. Those that go together,
   * as a view's threads do, go in one ask, five hundred at most, and then the rest. An ask that
   * fails is given up, and a comment wanted again is asked for again.
   */
  want(bodies: Iterable<string>): void {
    let added = false;
    for (const body of bodies) {
      const source = sourceOf(body);
      if (source.trim() === '' || this.#held.has(source) || this.#wanted.has(source)) continue;
      this.#wanted.add(source);
      added = true;
    }
    if (added) this.#schedule();
  }

  /** Calls `listener` each time an opening is read, until the returned function. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #schedule(): void {
    if (this.#asking || this.#waiting) return;
    this.#waiting = this.#later(() => {
      this.#waiting = undefined;
      void this.#ask();
    });
  }

  async #ask(): Promise<void> {
    if (this.#asking || this.#wanted.size === 0) return;
    this.#asking = true;
    const batch = [...this.#wanted].slice(0, EXCERPTS_AN_ASK);
    for (const source of batch) this.#wanted.delete(source);
    try {
      const lines = await this.#read(batch);
      batch.forEach((source, index) => this.#keep(source, lines[index] ?? ''));
      this.#version += 1;
      for (const listener of this.#listeners) listener();
    } catch (error) {
      this.#log(
        `Lo couldn't read comments' openings: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.#asking = false;
      if (this.#wanted.size > 0) this.#schedule();
    }
  }

  #keep(source: string, line: string): void {
    this.#held.delete(source);
    this.#held.set(source, line);
    for (const old of this.#held.keys()) {
      if (this.#held.size <= KEPT) break;
      this.#held.delete(old);
    }
  }
}

/** The window's openings, read by the comments' job in the background process. */
export const excerpts = new ExcerptStore({
  read: (bodies) => commentsJobs().excerpts({ bodies }),
});

const subscribe = (listener: () => void): (() => void) => excerpts.subscribe(listener);

/** The opening of `markdown` as one line of plain text: nothing until it's read. */
export function excerptOf(markdown: string): string {
  return excerpts.of(markdown);
}

/**
 * The opening of comment `markdown` as one line of plain text, drawn again once it's read. It's
 * only asked for while `wanted`, as for a thread that shows it.
 */
export function useExcerpt(markdown: string | undefined, wanted = true): string {
  useEffect(() => {
    if (wanted && markdown !== undefined) excerpts.want([markdown]);
  }, [markdown, wanted]);
  return useSyncExternalStore(subscribe, () =>
    markdown === undefined ? '' : excerpts.of(markdown),
  );
}

/**
 * Asks for the openings of `bodies`, and draws again as they're read, for a list that shows many.
 * Returns how many times they changed.
 */
export function useExcerpts(bodies: readonly string[]): number {
  useEffect(() => {
    excerpts.want(bodies);
  }, [bodies]);
  return useSyncExternalStore(subscribe, () => excerpts.version);
}
