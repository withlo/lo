// What the reader's refresh asks of main: to read what a tab shows from GitHub again now. Whatever
// shows a part of a tab listens, and reads its part: a pull request's tab's view its pull request,
// the overview its overview, a merge queue's tab its queue. The refresh lasts until every part is
// in. Asked again while one of the same tab is under way, it waits on that one. Nothing here calls
// Electron or reads GitHub itself.

/** Reads what tab `id` shows again, settling once it's in; or nothing, when it shows none of it. */
export type Refresher = (id: string) => Promise<unknown> | undefined;

export class Refreshes {
  readonly #listeners = new Set<Refresher>();
  /** The refreshes under way, by the id of the tab or view refreshed. */
  readonly #under = new Map<string, Promise<void>>();
  readonly #log: (line: string) => void;

  constructor(log: (line: string) => void) {
    this.#log = log;
  }

  /** Calls `refresher` with each tab refreshed, until the returned function is called. */
  listen(refresher: Refresher): () => void {
    this.#listeners.add(refresher);
    return () => {
      this.#listeners.delete(refresher);
    };
  }

  /**
   * Reads what tab or view `id` shows again now: settles once every part of it is in, or failed.
   * Asked again while that's under way, it waits on the same.
   */
  refresh(id: string): Promise<void> {
    const under = this.#under.get(id);
    if (under) return under;
    const parts = [...this.#listeners].map(async (refresher) => {
      try {
        await refresher(id);
      } catch (error) {
        this.#log(`refreshing ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    const done = Promise.all(parts).then(() => {
      this.#under.delete(id);
    });
    this.#under.set(id, done);
    return done;
  }

  /** Lo quits: nothing listens any more. */
  clear(): void {
    this.#listeners.clear();
  }
}
