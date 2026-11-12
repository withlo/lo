// What Lo saw of each pull request's revisions on this computer, in the database: every head an
// account's poller saw, and when it first saw it, one of the sources revisions are built from; and
// "last seen here", the head of the newest revision on screen when an account last left a pull
// request. Neither is a saved answer, so clearing the cache keeps them. An account's rows go with
// it, and a pull request's once it has been closed a while. Nothing here calls Electron.

import type { PullRef } from '@lo/github';
import type { SeenHead } from '@lo/review';

import type { Database } from '../../../main/database.ts';

/** How long a pull request's rows are kept after it closed, in milliseconds: 30 days. */
export const KEPT_AFTER_CLOSING = 30 * 24 * 60 * 60 * 1000;

/** A row's integer column, as SQLite gives it back. */
function integer(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : 0;
}

export class Marks {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  /**
   * Every head any account's poller saw on `pull`, with when one first saw it, earliest first. A
   * head is a fact about the pull request, whichever account saw it.
   */
  seen(pull: PullRef): SeenHead[] {
    return this.#database
      .prepare(
        `SELECT head, min(first_seen) AS first_seen FROM revisions_seen WHERE pull = ?
         GROUP BY head ORDER BY first_seen, head`,
      )
      .all(pull.key)
      .map((row) => ({ head: String(row.head), firstSeen: integer(row.first_seen) }));
  }

  /** Notes that `login`'s poller saw `heads` on `pull` at `at`. Seeing one again keeps the earliest time. */
  noteSeen(login: string, pull: PullRef, heads: readonly string[], at: number): void {
    const insert = this.#database.prepare(
      `INSERT INTO revisions_seen (login, pull, head, first_seen) VALUES (?, ?, ?, ?)
       ON CONFLICT (login, pull, head) DO UPDATE SET
         first_seen = min(revisions_seen.first_seen, excluded.first_seen)`,
    );
    this.#database.transaction(() => {
      for (const head of heads) insert.run(login, pull.key, head, Math.round(at));
    });
  }

  /** The head of the newest revision on screen when `login` last left `pull`, if it ever did. */
  lastSeen(login: string, pull: PullRef): string | undefined {
    const row = this.#database
      .prepare('SELECT head FROM revisions_lastseen WHERE login = ? AND pull = ?')
      .get(login, pull.key);
    return row === undefined ? undefined : String(row.head);
  }

  /** Notes that `login` left `pull` at `at` with `head` the newest revision on screen. */
  setLastSeen(login: string, pull: PullRef, head: string, at: number): void {
    this.#database
      .prepare(
        `INSERT INTO revisions_lastseen (login, pull, head, seen_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (login, pull) DO UPDATE SET head = excluded.head, seen_at = excluded.seen_at`,
      )
      .run(login, pull.key, head, Math.round(at));
  }

  /** Notes when `pull` closed or merged, or that it's open, as after it was reopened. */
  noteClosed(pull: PullRef, closedAt: number | undefined): void {
    if (closedAt === undefined) {
      this.#database.prepare('DELETE FROM revisions_closed WHERE pull = ?').run(pull.key);
      return;
    }
    this.#database
      .prepare(
        `INSERT INTO revisions_closed (pull, closed_at) VALUES (?, ?)
         ON CONFLICT (pull) DO UPDATE SET closed_at = excluded.closed_at`,
      )
      .run(pull.key, Math.round(closedAt));
  }

  /**
   * Forgets the rows of every pull request that closed more than {@link KEPT_AFTER_CLOSING} before
   * `now`, but those noted since then, as when it was seen here after it closed. A pull request Lo
   * never saw closed keeps its rows.
   */
  prune(now: number): void {
    const cutoff = now - KEPT_AFTER_CLOSING;
    this.#database.transaction(() => {
      this.#database
        .prepare(
          `DELETE FROM revisions_seen WHERE first_seen < ? AND pull IN (
             SELECT pull FROM revisions_closed WHERE closed_at < ?)`,
        )
        .run(cutoff, cutoff);
      this.#database
        .prepare(
          `DELETE FROM revisions_lastseen WHERE seen_at < ? AND pull IN (
             SELECT pull FROM revisions_closed WHERE closed_at < ?)`,
        )
        .run(cutoff, cutoff);
      this.#database
        .prepare(
          `DELETE FROM revisions_closed WHERE closed_at < ?
             AND pull NOT IN (SELECT pull FROM revisions_seen)
             AND pull NOT IN (SELECT pull FROM revisions_lastseen)`,
        )
        .run(cutoff);
    });
  }

  /** Forgets everything noted for `login`, as its account is removed. */
  forget(login: string): void {
    this.#database.transaction(() => {
      this.#database.prepare('DELETE FROM revisions_seen WHERE login = ?').run(login);
      this.#database.prepare('DELETE FROM revisions_lastseen WHERE login = ?').run(login);
    });
  }
}
