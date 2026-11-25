// The stacks' offers the reader dismissed for one stack or one layer, kept in the database
// (`stacks_dismissed`) by pull request, so each stays away through restarts.

import type { Database } from '../../../main/database.ts';
import type { Notice } from '../contract.ts';

export class Dismissed {
  readonly #database: Database;
  /** What's dismissed, as `<notice> <repo> <number>`, the repo in lowercase, read once. */
  #keys: Set<string> | undefined;

  constructor(database: Database) {
    this.#database = database;
  }

  #all(): Set<string> {
    this.#keys ??= new Set(
      this.#database
        .prepare('SELECT notice, repo, number FROM stacks_dismissed')
        .all()
        .flatMap(({ notice, repo, number }) =>
          typeof notice === 'string' && typeof repo === 'string' && typeof number === 'number'
            ? [keyOf(notice, repo, number)]
            : [],
        ),
    );
    return this.#keys;
  }

  /** Whether `notice` was dismissed for any of `numbers`, pull requests of `repo` (`owner/name`). */
  has(notice: Notice, repo: string, numbers: readonly number[]): boolean {
    const all = this.#all();
    return numbers.some((number) => all.has(keyOf(notice, repo, number)));
  }

  /** Dismisses `notice` for `numbers`, pull requests of `repo`, at `at`, in ms since the epoch. */
  add(notice: Notice, repo: string, numbers: readonly number[], at: number): void {
    const name = repo.toLowerCase();
    const insert = this.#database.prepare(
      'INSERT INTO stacks_dismissed (notice, repo, number, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
    );
    for (const number of numbers) {
      insert.run(notice, name, number, at);
      this.#all().add(keyOf(notice, name, number));
    }
  }
}

function keyOf(notice: string, repo: string, number: number): string {
  return `${notice} ${repo.toLowerCase()} ${String(number)}`;
}
