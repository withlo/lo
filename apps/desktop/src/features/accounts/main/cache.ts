// What each account's poller keeps between runs of Lo, in Lo's database: what it read, so a pull
// request opened again shows at once and its first poll can still be free, and the pull requests
// opened most recently. Each row is written by one build of Lo, and another build's rows read as
// missing, since what the poller keeps is its own shape and changes with it. Clearing the cache
// forgets what the pollers read, but never the accounts or the recent pull requests.

import { PullRef, type CacheEntry, type PollCache, type RecentPull } from '@lo/github';

import type { Database } from '../../../main/database.ts';
import { integer, text, textOrNothing } from './columns.ts';

/** How many recent pull requests are kept. */
export const RECENT_PULLS = 100;

export class AnswerCache implements PollCache {
  readonly #database: Database;
  readonly #build: string;

  /** The cache in `database`, reading and writing the rows of `build`, this build of Lo. */
  constructor(database: Database, build: string) {
    this.#database = database;
    this.#build = build;
  }

  async get(login: string, target: string, name: string): Promise<CacheEntry | undefined> {
    const row = this.#database
      .prepare(
        `SELECT value, fetched_at, stamp FROM accounts_answers
         WHERE login = ? AND target = ? AND name = ? AND build = ?`,
      )
      .get(login, target, name, this.#build);
    if (!row) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(text(row, 'value'));
    } catch {
      // What can't be read is fetched again, as if it had never been kept.
      return undefined;
    }
    const stamp = textOrNothing(row, 'stamp');
    return {
      value,
      fetchedAt: integer(row, 'fetched_at'),
      ...(stamp === undefined ? {} : { stamp }),
    };
  }

  async put(
    login: string,
    target: string,
    entries: readonly { name: string; entry: CacheEntry }[],
  ): Promise<void> {
    const insert = this.#database.prepare(
      `INSERT INTO accounts_answers (login, target, name, build, value, fetched_at, stamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (login, target, name) DO UPDATE SET
         build = excluded.build, value = excluded.value, fetched_at = excluded.fetched_at,
         stamp = excluded.stamp`,
    );
    this.#database.transaction(() => {
      for (const { name, entry } of entries) {
        const value = JSON.stringify(entry.value) ?? 'null';
        insert.run(login, target, name, this.#build, value, entry.fetchedAt, entry.stamp ?? null);
      }
    });
  }

  async touch(
    login: string,
    target: string,
    name: string,
    fetchedAt: number,
    stamp?: { stamp: string | undefined },
  ): Promise<void> {
    const where = 'WHERE login = ? AND target = ? AND name = ? AND build = ?';
    if (stamp) {
      this.#database
        .prepare(`UPDATE accounts_answers SET fetched_at = ?, stamp = ? ${where}`)
        .run(fetchedAt, stamp.stamp ?? null, login, target, name, this.#build);
    } else {
      this.#database
        .prepare(`UPDATE accounts_answers SET fetched_at = ? ${where}`)
        .run(fetchedAt, login, target, name, this.#build);
    }
  }

  async remove(login: string, target: string, name: string): Promise<void> {
    this.#database
      .prepare('DELETE FROM accounts_answers WHERE login = ? AND target = ? AND name = ?')
      .run(login, target, name);
  }

  /**
   * Notes that a pull request was opened, moving it to the top of the recent ones under the name
   * given, and forgets all but the newest {@link RECENT_PULLS}. With no title, it keeps the one it
   * had.
   */
  async recordRecent(recent: RecentPull): Promise<void> {
    const { pull } = recent;
    this.#database.transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO accounts_recent (owner, repo, number, title, login, opened_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (owner, repo, number) DO UPDATE SET
             owner = excluded.owner, repo = excluded.repo,
             title = coalesce(excluded.title, accounts_recent.title),
             login = excluded.login, opened_at = excluded.opened_at`,
        )
        .run(
          pull.repo.owner,
          pull.repo.name,
          pull.number,
          recent.title ?? null,
          recent.login,
          recent.openedAt,
        );
      this.#database
        .prepare(
          `DELETE FROM accounts_recent WHERE rowid NOT IN (
             SELECT rowid FROM accounts_recent ORDER BY opened_at DESC, rowid DESC LIMIT ?
           )`,
        )
        .run(RECENT_PULLS);
    });
  }

  /** The pull requests opened most recently, newest first: `limit` of them at most. */
  recent(limit = RECENT_PULLS): RecentPull[] {
    return this.#database
      .prepare(
        `SELECT owner, repo, number, title, login, opened_at FROM accounts_recent
         ORDER BY opened_at DESC, rowid DESC LIMIT ?`,
      )
      .all(limit)
      .map((row) => ({
        pull: new PullRef(text(row, 'owner'), text(row, 'repo'), integer(row, 'number')),
        title: textOrNothing(row, 'title'),
        login: text(row, 'login'),
        openedAt: integer(row, 'opened_at'),
      }));
  }

  /**
   * Forgets that `pull` was opened under that name, once GitHub names its repository otherwise:
   * after a rename or a transfer, the pull request is listed once, by its name now.
   */
  forgetRecent(pull: PullRef): void {
    this.#database
      .prepare('DELETE FROM accounts_recent WHERE owner = ? AND repo = ? AND number = ?')
      .run(pull.repo.owner, pull.repo.name, pull.number);
  }

  /** Forgets everything the pollers read, for every account and build. */
  clear(): void {
    this.#database.exec('DELETE FROM accounts_answers');
  }
}
