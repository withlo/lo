// The overview commit each pull request's ref last held, in the database, as main read it: its
// byline and listing, so a pull request's overview shows at once when its tab opens, offline too,
// from these and the files kept by their IDs. Each is kept with whether its pull request was
// closed or merged, and the IDs of the files it holds that Lo reads, so the files of a closed pull
// request's overview are never forgotten to make room: once GitHub has none, it's what shows. A
// stack's overview is kept the same way, by its stack's id, in a table of its own, and is never
// held. Nothing here calls Electron.

import type { Database } from '../../../main/database.ts';
import { overviewCommit, type OverviewCommit } from '../contract.ts';
import { isReadable } from './listing.ts';

/**
 * A pull request, by its repository, `owner/name`, and its number; or, for a stack's overview, its
 * stack, by its id.
 */
export interface PullKey {
  readonly repository: string;
  readonly number: number;
}

export class SavedRefs {
  readonly #database: Database;
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  /** The table: pull requests' overviews, or stacks'. */
  readonly #table: 'overview_refs' | 'overview_stack_refs';

  constructor(
    database: Database,
    options: {
      now?: () => number;
      log?: (line: string) => void;
      /** Whose overviews it keeps: pull requests' unless said. */
      of?: 'pull' | 'stack';
    } = {},
  ) {
    this.#database = database;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? (() => {});
    this.#table = options.of === 'stack' ? 'overview_stack_refs' : 'overview_refs';
  }

  /**
   * The commit `pull`'s overview ref held when Lo last read it, if it held one. One that no longer
   * reads as the window takes it, as from another build of Lo, is forgotten.
   */
  get(pull: PullKey): OverviewCommit | undefined {
    const row = this.#database
      .prepare(`SELECT overview FROM ${this.#table} WHERE repository = ? AND number = ?`)
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

  /**
   * Keeps `commit` as what `pull`'s overview ref holds, with the files it holds that Lo reads, and
   * whether the pull request is `closed` or merged, as far as that's known: otherwise as it was.
   */
  set(pull: PullKey, commit: OverviewCommit, closed?: boolean): void {
    // A stack is never closed.
    const flag = closed === undefined || this.#table !== 'overview_refs' ? null : closed ? 1 : 0;
    this.#database.transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO ${this.#table} (repository, number, overview, seen_at, closed)
           VALUES (?, ?, ?, ?, coalesce(?, 0))
           ON CONFLICT (repository, number) DO UPDATE SET
             overview = excluded.overview, seen_at = excluded.seen_at,
             closed = coalesce(?, closed)`,
        )
        .run(
          pull.repository,
          pull.number,
          JSON.stringify(commit),
          Math.round(this.#now()),
          flag,
          flag,
        );
      this.#hold(pull, commit);
    });
  }

  /**
   * Says whether `pull` is closed or merged: the files of its kept overview, if it has one, are
   * then never forgotten to make room, until it's open again.
   */
  close(pull: PullKey, closed: boolean): void {
    if (this.#table !== 'overview_refs') return;
    const kept = this.get(pull);
    if (!kept) return;
    this.#database.transaction(() => {
      this.#database
        .prepare('UPDATE overview_refs SET closed = ? WHERE repository = ? AND number = ?')
        .run(closed ? 1 : 0, pull.repository, pull.number);
      // A commit kept before Lo kept the IDs of its files.
      this.#hold(pull, kept);
    });
  }

  /** Forgets `pull`'s. */
  forget(pull: PullKey): void {
    this.#database.transaction(() => {
      this.#database
        .prepare(`DELETE FROM ${this.#table} WHERE repository = ? AND number = ?`)
        .run(pull.repository, pull.number);
      if (this.#table !== 'overview_refs') return;
      this.#database
        .prepare('DELETE FROM overview_ref_files WHERE repository = ? AND number = ?')
        .run(pull.repository, pull.number);
    });
  }

  /** Forgets every one, as clearing the cache does. */
  clear(): void {
    this.#database.transaction(() => {
      this.#database.prepare(`DELETE FROM ${this.#table}`).run();
      if (this.#table === 'overview_refs') {
        this.#database.prepare('DELETE FROM overview_ref_files').run();
      }
    });
  }

  /** Keeps the IDs of the files `commit`, `pull`'s kept overview, holds that Lo reads. */
  #hold(pull: PullKey, commit: OverviewCommit): void {
    // A stack's are never held.
    if (this.#table !== 'overview_refs') return;
    this.#database
      .prepare('DELETE FROM overview_ref_files WHERE repository = ? AND number = ?')
      .run(pull.repository, pull.number);
    const insert = this.#database.prepare(
      'INSERT OR IGNORE INTO overview_ref_files (repository, number, id) VALUES (?, ?, ?)',
    );
    for (const entry of commit.entries) {
      if (entry.kind === 'file' && isReadable(entry.path)) {
        insert.run(pull.repository, pull.number, entry.id);
      }
    }
  }
}
