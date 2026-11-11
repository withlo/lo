// The accounts' rows in Lo's database: each account, which of them GitHub refused, and the account
// chosen for each owner and repository. Removing an account's row removes everything else kept
// for it, through the tables' foreign keys.

import type { Account, AccountRows, AccountSource } from '@lo/github';

import type { Database, Row } from '../../../main/database.ts';
import { integer, text, textOrNothing } from './columns.ts';

export class AccountTable implements AccountRows {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async accounts(): Promise<Account[]> {
    const rows = this.#database
      .prepare(
        `SELECT login, user_id, name, avatar_url, scopes, source, added_at FROM accounts_accounts
         ORDER BY added_at, lower(login)`,
      )
      .all();
    return rows.map(readAccount);
  }

  async save(account: Account): Promise<void> {
    this.#database.transaction(() => {
      // Signing in again keeps when the account was first added.
      this.#database
        .prepare(
          `INSERT INTO accounts_accounts (login, user_id, name, avatar_url, scopes, source, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (login) DO UPDATE SET
             login = excluded.login, user_id = excluded.user_id, name = excluded.name,
             avatar_url = excluded.avatar_url, scopes = excluded.scopes, source = excluded.source`,
        )
        .run(
          account.login,
          account.userId,
          account.name ?? null,
          account.avatarUrl ?? null,
          JSON.stringify(account.scopes),
          account.source,
          account.addedAt,
        );
      this.#database.prepare('DELETE FROM accounts_refused WHERE login = ?').run(account.login);
    });
  }

  async delete(login: string): Promise<void> {
    this.#database.prepare('DELETE FROM accounts_accounts WHERE login = ?').run(login);
  }

  async refused(): Promise<string[]> {
    const rows = this.#database
      .prepare(
        `SELECT accounts.login FROM accounts_refused AS refused
         JOIN accounts_accounts AS accounts ON accounts.login = refused.login
         ORDER BY lower(accounts.login)`,
      )
      .all();
    return rows.map((row) => text(row, 'login'));
  }

  async setRefused(login: string, at: number): Promise<void> {
    // Only for an account Lo has: one removed meanwhile stays removed.
    this.#database
      .prepare(
        `INSERT INTO accounts_refused (login, at)
         SELECT login, ? FROM accounts_accounts WHERE login = ?
         ON CONFLICT (login) DO UPDATE SET at = excluded.at`,
      )
      .run(at, login);
  }

  async ownerAccount(owner: string): Promise<string | undefined> {
    const row = this.#database
      .prepare('SELECT login FROM accounts_owners WHERE owner = ?')
      .get(owner);
    return row && text(row, 'login');
  }

  async setOwnerAccount(owner: string, login: string): Promise<void> {
    this.#database
      .prepare(
        `INSERT INTO accounts_owners (owner, login) VALUES (?, ?)
         ON CONFLICT (owner) DO UPDATE SET owner = excluded.owner, login = excluded.login`,
      )
      .run(owner, login);
  }

  async repoAccount(owner: string, name: string): Promise<string | undefined> {
    const row = this.#database
      .prepare('SELECT login FROM accounts_repos WHERE owner = ? AND name = ?')
      .get(owner, name);
    return row && text(row, 'login');
  }

  async setRepoAccount(owner: string, name: string, login: string): Promise<void> {
    this.#database
      .prepare(
        `INSERT INTO accounts_repos (owner, name, login) VALUES (?, ?, ?)
         ON CONFLICT (owner, name) DO UPDATE SET
           owner = excluded.owner, name = excluded.name, login = excluded.login`,
      )
      .run(owner, name, login);
  }
}

function readAccount(row: Row): Account {
  const name = textOrNothing(row, 'name');
  const avatarUrl = textOrNothing(row, 'avatar_url');
  return {
    login: text(row, 'login'),
    userId: integer(row, 'user_id'),
    ...(name === undefined ? {} : { name }),
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
    scopes: readScopes(text(row, 'scopes')),
    source: readSource(text(row, 'source')),
    addedAt: integer(row, 'added_at'),
  };
}

function readScopes(json: string): string[] {
  const scopes: unknown = JSON.parse(json);
  if (!Array.isArray(scopes)) throw new TypeError("scopes isn't a list");
  return scopes.map((scope: unknown) => {
    if (typeof scope !== 'string') throw new TypeError("scopes isn't a list of strings");
    return scope;
  });
}

function readSource(source: string): AccountSource {
  if (source === 'deviceFlow' || source === 'gh') return source;
  throw new TypeError("source isn't one Lo knows");
}
