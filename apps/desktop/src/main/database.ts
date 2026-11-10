// Lo's database: SQLite through Node's built-in `node:sqlite`. This is the only module that uses
// it, so a change in Node's API (Node 26 renames `DatabaseSync` to `Database`) lands here alone.

import type * as NodeSqlite from 'node:sqlite';
import type { SQLInputValue, SQLOutputValue, StatementSync } from 'node:sqlite';

import { StartupError } from './startup.ts';

/** A value for one of a statement's `?` placeholders. */
export type Value = SQLInputValue;
export type Row = Record<string, SQLOutputValue>;

export interface Statement {
  run(...values: Value[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...values: Value[]): Row | undefined;
  all(...values: Value[]): Row[];
}

export interface Database {
  /** Runs SQL that returns nothing, which may hold several statements: a migration, say. */
  exec(sql: string): void;
  /** A prepared statement, kept for the next time the same SQL comes. */
  prepare(sql: string): Statement;
  /** Runs `work` in a transaction, committed if it returns and rolled back if it throws. */
  transaction<T>(work: () => T): T;
  close(): void;
}

/**
 * Opens (creating it if needed) the database at `path`, or `:memory:` for one that lives only as
 * long as it's open. It runs in WAL mode, with foreign keys enforced, and defensive, so SQL can't
 * corrupt the file on purpose (no writable schema, no `PRAGMA journal_mode=OFF` and the like).
 */
export function openDatabase(path: string): Database {
  const sqlite: typeof NodeSqlite | undefined = process.getBuiltinModule('node:sqlite');
  if (!sqlite) {
    throw new StartupError(
      "This build of Lo has no SQLite (Node's node:sqlite module), which it keeps its data in.",
    );
  }
  // Each of these is Node's default too, set here so a change of default can't loosen them.
  const db = new sqlite.DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    defensive: true,
  });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');

  const statements = new Map<string, StatementSync>();
  const statement = (sql: string): StatementSync => {
    let prepared = statements.get(sql);
    if (!prepared) {
      prepared = db.prepare(sql);
      statements.set(sql, prepared);
    }
    return prepared;
  };

  return {
    exec: (sql) => db.exec(sql),
    prepare(sql) {
      const prepared = statement(sql);
      return {
        run: (...values) => prepared.run(...values),
        get: (...values) => prepared.get(...values),
        all: (...values) => prepared.all(...values),
      };
    },
    transaction(work) {
      if (db.isTransaction) throw new Error('A transaction is already open; they don’t nest.');
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = work();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      statements.clear();
      db.close();
    },
  };
}
