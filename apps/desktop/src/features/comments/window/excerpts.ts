// What a comment's opening says as one line of plain text, for a thread's collapsed line and the
// threads panel's rows: its Markdown read by the background process, a batch at a time, and kept in
// the window's memory under the Markdown it was read from, so a comment drawn again needn't wait. A
// comment shows no words until they're read, and its Markdown's syntax is never shown instead. What
// lists many, as the panel, waits for them (`ready`) rather than draw rows without them.

import { useEffect, useSyncExternalStore } from 'react';

import { EXCERPTS_AN_ASK, EXCERPTS_CHARACTERS } from '../jobs.ts';
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

export class ExcerptStore {
  readonly #read: Read;
  readonly #later: (run: () => void) => () => void;
  readonly #log: (line: string) => void;
  /** Each opening read, by the Markdown it was read from. */
  readonly #held = new Map<string, string>();
  /** The Markdown to read at the next ask. */
  readonly #wanted = new Set<string>();
  /** The Markdown being read now, which wanting again doesn't ask for a second time. */
  readonly #flying = new Set<string>();
  /** What waits for openings, with those it still waits for. */
  readonly #waiting = new Set<{ readonly sources: Set<string>; readonly done: () => void }>();
  readonly #listeners = new Set<() => void>();
  #version = 0;
  #asking = false;
  #scheduled: (() => void) | undefined;

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
    return this.#held.get(markdown) ?? '';
  }

  /** Whether `markdown` has an opening still to read: one with no words has none. */
  #needs(markdown: string): boolean {
    return markdown.trim() !== '' && !this.#held.has(markdown);
  }

  /** Whether the openings of all of `bodies` are read, or have nothing to read. */
  holds(bodies: Iterable<string>): boolean {
    for (const body of bodies) if (this.#needs(body)) return false;
    return true;
  }

  /**
   * Reads the openings of `bodies` soon, but those held, already wanted or being read now. Those
   * that go together, as a view's threads do, go in one ask, five hundred comments or a megabyte of
   * Markdown at most, and then the rest. An ask that fails is given up, and a comment wanted again
   * is asked for again.
   */
  want(bodies: Iterable<string>): void {
    let added = false;
    for (const body of bodies) {
      if (!this.#needs(body) || this.#wanted.has(body) || this.#flying.has(body)) continue;
      this.#wanted.add(body);
      added = true;
    }
    if (added) this.#schedule();
  }

  /**
   * Reads the openings of `bodies`, and settles once each is read, or its ask failed and was given
   * up, so what waits for them is never held back for good. Settled at once when they're held.
   */
  ready(bodies: Iterable<string>): Promise<void> {
    const sources = new Set<string>();
    for (const body of bodies) if (this.#needs(body)) sources.add(body);
    if (sources.size === 0) return Promise.resolve();
    this.want(sources);
    return new Promise((resolve) => {
      this.#waiting.add({ sources, done: resolve });
    });
  }

  /** Calls `listener` each time an opening is read, until the returned function. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #schedule(): void {
    if (this.#asking || this.#scheduled) return;
    this.#scheduled = this.#later(() => {
      this.#scheduled = undefined;
      void this.#ask();
    });
  }

  /** The next ask: what's wanted, as many as one ask reads, at least one. */
  #batch(): string[] {
    const batch: string[] = [];
    let characters = 0;
    for (const source of this.#wanted) {
      if (batch.length >= EXCERPTS_AN_ASK) break;
      if (batch.length > 0 && characters + source.length > EXCERPTS_CHARACTERS) break;
      batch.push(source);
      characters += source.length;
    }
    return batch;
  }

  async #ask(): Promise<void> {
    if (this.#asking || this.#wanted.size === 0) return;
    this.#asking = true;
    const batch = this.#batch();
    for (const source of batch) {
      this.#wanted.delete(source);
      this.#flying.add(source);
    }
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
      for (const source of batch) this.#flying.delete(source);
      this.#asking = false;
      this.#settle();
      if (this.#wanted.size > 0) this.#schedule();
    }
  }

  /** Lets go what waited for openings that are read now, or that won't be. */
  #settle(): void {
    for (const waiter of this.#waiting) {
      for (const source of waiter.sources) {
        if (this.#held.has(source) || !(this.#wanted.has(source) || this.#flying.has(source))) {
          waiter.sources.delete(source);
        }
      }
      if (waiter.sources.size > 0) continue;
      this.#waiting.delete(waiter);
      waiter.done();
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
