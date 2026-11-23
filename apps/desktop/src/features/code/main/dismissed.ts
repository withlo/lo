// The repositories Lo has offered to trust, kept in the database (`code_dismissed`), so the offer
// opens by itself once a repository.

import type { Database } from '../../../main/database.ts';

export class Dismissed {
  readonly #database: Database;
  /** The names dismissed, in lowercase, read once. */
  #names: Set<string> | undefined;

  constructor(database: Database) {
    this.#database = database;
  }

  #all(): Set<string> {
    this.#names ??= new Set(
      this.#database
        .prepare('SELECT repo FROM code_dismissed')
        .all()
        .flatMap(({ repo }) => (typeof repo === 'string' ? [repo] : [])),
    );
    return this.#names;
  }

  /** Whether the banner was dismissed for `repo`, `owner/name` in any case. */
  has(repo: string): boolean {
    return this.#all().has(repo.toLowerCase());
  }

  /** Dismisses the banner for `repo`, at `at`, in milliseconds since the Unix epoch. */
  add(repo: string, at: number): void {
    const name = repo.toLowerCase();
    this.#database
      .prepare('INSERT INTO code_dismissed (repo, at) VALUES (?, ?) ON CONFLICT (repo) DO NOTHING')
      .run(name, at);
    this.#all().add(name);
  }
}
