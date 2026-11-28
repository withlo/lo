// What the reader's refresh asks of main: to read what a tab shows from GitHub again now. Whatever
// shows a part of a tab listens, and reads its part: a pull request's tab's view its pull request,
// the overview its overview, a merge queue's tab its queue. What shows the middle views on screen
// reads first, and the rest once that's in, and the refresh lasts until every part is in. Asked
// again while one of the same tab is under way, it waits on that one. Nothing here calls Electron
// or reads GitHub itself.

import type { FrontView } from '../contract.ts';

/**
 * Reads what tab `id` shows again, settling once it's in, or nothing, when it shows none of it.
 * `front` names the middle views on screen, left to right, whose parts it reads first.
 */
export type Refresher = (id: string, front: readonly FrontView[]) => Promise<unknown> | undefined;

interface Listener {
  readonly refresher: Refresher;
  /** The middle views whose parts it reads. */
  readonly shows: readonly FrontView[];
}

export class Refreshes {
  readonly #listeners = new Set<Listener>();
  /** The refreshes under way, by the id of the tab or view refreshed. */
  readonly #under = new Map<string, Promise<void>>();
  readonly #log: (line: string) => void;

  constructor(log: (line: string) => void) {
    this.#log = log;
  }

  /**
   * Calls `refresher` with each tab refreshed, until the returned function is called. `shows` names
   * the middle views whose parts it reads: it reads before the rest while one of them is on screen.
   */
  listen(refresher: Refresher, shows: readonly FrontView[] = []): () => void {
    const listener: Listener = { refresher, shows };
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Reads what tab or view `id` shows again now, what shows `front`, the middle views on screen,
   * first: settles once every part of it is in, or failed. Asked again while that's under way, it
   * waits on the same.
   */
  refresh(id: string, front: readonly FrontView[] = []): Promise<void> {
    const under = this.#under.get(id);
    if (under) return under;
    const all = [...this.#listeners];
    const leading = all.filter(({ shows }) => shows.some((view) => front.includes(view)));
    const rest = all.filter((listener) => !leading.includes(listener));
    // With nothing in front to read first, every part goes at once.
    const reading =
      leading.length === 0
        ? this.#read(id, front, rest)
        : this.#read(id, front, leading).then(() => this.#read(id, front, rest));
    const done = reading.then(() => {
      this.#under.delete(id);
    });
    this.#under.set(id, done);
    return done;
  }

  /** Reads `listeners`' parts of tab `id` all at once: settles once each is in, or failed. */
  async #read(id: string, front: readonly FrontView[], listeners: Listener[]): Promise<void> {
    await Promise.all(
      listeners.map(async ({ refresher }) => {
        try {
          await refresher(id, front);
        } catch (error) {
          this.#log(`refreshing ${id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }),
    );
  }

  /** Lo quits: nothing listens any more. */
  clear(): void {
    this.#listeners.clear();
  }
}
