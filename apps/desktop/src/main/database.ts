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

/**
 * Something SQL asks SQLite to do, as its authorizer sees it while compiling a statement: the
 * action (`READ`, `INSERT`, `CREATE_TABLE`, `PRAGMA` and so on, SQLite's names without `SQLITE_`)
 * and its two arguments (often a table and a column), the database it's in (`main`, `temp`), and
 * the trigger or view it comes from, if any.
 */
export interface Action {
  action: string;
  first: string | null;
  second: string | null;
  database: string | null;
  source: string | null;
}

export interface Database {
  /** Runs SQL that returns nothing, which may hold several statements: a migration, say. */
  exec(sql: string): void;
  /** A prepared statement, kept for the next time the same SQL comes. */
  prepare(sql: string): Statement;
  /** Compiles SQL without running or keeping it, so whatever checks compiling apply. */
  compile(sql: string): void;
  /**
   * Runs `work` in a transaction, committed if it returns and rolled back if it throws. The work
   * must be synchronous: a transaction can't stay open across an `await`.
   */
  transaction<T>(work: () => T): T;
  /** Whether a transaction is open. */
  readonly inTransaction: boolean;
  /**
   * Runs `work` with every statement compiled meanwhile checked against `allow`: an action it
   * refuses makes the statement fail to compile.
   */
  restrict<T>(allow: (action: Action) => boolean, work: () => T): T;
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

  // SQLite's names for the authorizer's actions, by number.
  const actions = new Map<number, string>();
  for (const [name, code] of Object.entries(sqlite.constants)) {
    const action = /^SQLITE_([A-Z_]+)$/.exec(name)?.[1];
    if (action && !/^(?:OK|DENY|IGNORE|CHANGESET_.*)$/.test(action)) actions.set(code, action);
  }

  return {
    exec: (sql) => db.exec(sql),
    compile(sql) {
      db.prepare(sql);
    },
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
        if (isThenable(result)) {
          throw new TypeError(
            "A transaction's work must be synchronous: it would be committed before it finished.",
          );
        }
        db.exec('COMMIT');
        return result;
      } catch (error) {
        // Work that ended the transaction itself has nothing left to roll back.
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
    get inTransaction() {
      return db.isTransaction;
    },
    restrict(allow, work) {
      db.setAuthorizer((code, first, second, database, source) => {
        const action = actions.get(code) ?? String(code);
        const allowed = allow({ action, first, second, database, source });
        return allowed ? sqlite.constants.SQLITE_OK : sqlite.constants.SQLITE_DENY;
      });
      try {
        return work();
      } finally {
        db.setAuthorizer(null);
      }
    },
    close() {
      statements.clear();
      db.close();
    },
  };
}

function isThenable(value: unknown): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
}
