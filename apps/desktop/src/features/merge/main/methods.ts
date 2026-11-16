// The merge method last used in each repository (`merge_methods`), which the merge panel picks
// first there.

import type { RepoRef } from '@lo/github';

import type { Database } from '../../../main/database.ts';
import type { Method } from '../contract.ts';

const METHODS: readonly string[] = ['MERGE', 'SQUASH', 'REBASE'];

function isMethod(value: unknown): value is Method {
  return typeof value === 'string' && METHODS.includes(value);
}

export class MethodStore {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  /** The method last used in `repo`, if Lo remembers one. */
  get(repo: RepoRef): Method | undefined {
    const row = this.#database
      .prepare('SELECT method FROM merge_methods WHERE repo = ?')
      .get(repo.key);
    const method = row?.['method'];
    return isMethod(method) ? method : undefined;
  }

  /** Remembers `method` as the one last used in `repo`, at `at`. */
  set(repo: RepoRef, method: Method, at: number): void {
    this.#database
      .prepare(
        `INSERT INTO merge_methods (repo, method, used_at) VALUES (?, ?, ?)
         ON CONFLICT (repo) DO UPDATE SET method = excluded.method, used_at = excluded.used_at`,
      )
      .run(repo.key, method, Math.round(at));
  }
}
