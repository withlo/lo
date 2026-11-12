// The overview commit each pull request's ref last held, in the database, as main read it: its
// byline and listing, so a pull request's overview shows at once when its tab opens, offline too,
// from these and the files kept by their IDs. Nothing here calls Electron.

import type { Database } from '../../../main/database.ts';
import { overviewCommit, type OverviewCommit } from '../contract.ts';

/** A pull request, by its repository, `owner/name`, and its number. */
export interface PullKey {
  readonly repository: string;
  readonly number: number;
}

export class SavedRefs {
  readonly #database: Database;
  readonly #now: () => number;
  readonly #log: (line: string) => void;

  constructor(
    database: Database,
    options: { now?: () => number; log?: (line: string) => void } = {},
  ) {
    this.#database = database;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? (() => {});
  }

  /**
   * The commit `pull`'s overview ref held when Lo last read it, if it held one. One that no longer
   * reads as the window takes it, as from another build of Lo, is forgotten.
   */
  get(pull: PullKey): OverviewCommit | undefined {
    const row = this.#database
      .prepare('SELECT overview FROM overview_refs WHERE repository = ? AND number = ?')
      .get(pull.repository, pull.number);
    if (row === undefined) return undefined;
    let parsed: OverviewCommit | undefined;
    try {
      parsed = overviewCommit.parse(JSON.parse(String(row.overview)));
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined) {
      this.#log(
        `forgot what Lo kept of ${pull.repository}#${pull.number}'s overview, which no longer reads`,
      );
      this.forget(pull);
    }
    return parsed;
  }

  /** Keeps `commit` as what `pull`'s overview ref holds. */
  set(pull: PullKey, commit: OverviewCommit): void {
    this.#database
      .prepare(
        `INSERT INTO overview_refs (repository, number, overview, seen_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (repository, number) DO UPDATE SET
           overview = excluded.overview, seen_at = excluded.seen_at`,
      )
      .run(pull.repository, pull.number, JSON.stringify(commit), Math.round(this.#now()));
  }

  /** Forgets `pull`'s, as when its ref holds no overview any more. */
  forget(pull: PullKey): void {
    this.#database
      .prepare('DELETE FROM overview_refs WHERE repository = ? AND number = ?')
      .run(pull.repository, pull.number);
  }

  /** Forgets every pull request's, as clearing the cache does. */
  clear(): void {
    this.#database.prepare('DELETE FROM overview_refs').run();
  }
}
