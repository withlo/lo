// Each feature's database migrations: `features/<feature>/migrations/001-<name>.sql` and on,
// recorded as (feature, number) with each file's SHA-256, so features number theirs without
// colliding. A feature's tables are its own: named `<feature>_…`, never touching another
// feature's, so features can apply in any order. Cleanup across features goes through main.
//
// SQLite's authorizer holds a migration to that while it runs: it may read and write only its
// feature's tables, and can't end the transaction, attach a database, set a pragma or make
// anything temporary. Its triggers and views are compiled before it's recorded, so one whose body
// reaches another feature's table fails too.

import { createHash } from 'node:crypto';

import type { Action, Database, Row } from './database.ts';
import { StartupError } from './startup.ts';

export interface Migration {
  feature: string;
  number: number;
  /** Its file's name, such as `001-notes.sql`. */
  file: string;
  sql: string;
  sha256: string;
}

const migrationPath =
  /\/features\/([a-z][a-z0-9]*)\/migrations\/((\d{3})-[a-z0-9][a-z0-9-]*\.sql)$/;

/**
 * Each feature's migrations, in order, from the files `import.meta.glob` found, keyed by path.
 * Their numbers start at 001 and have no gaps.
 */
export function readMigrations(files: Readonly<Record<string, string>>): Map<string, Migration[]> {
  const features = new Map<string, Migration[]>();
  for (const [path, sql] of Object.entries(files)) {
    const [, feature, file, number] = migrationPath.exec(path) ?? [];
    if (!feature || !file || !number) {
      throw new Error(
        `${path} isn't named like a migration: features/<feature>/migrations/001-<name>.sql.`,
      );
    }
    const migration = { feature, number: Number(number), file, sql, sha256: sha256(sql) };
    features.set(feature, [...(features.get(feature) ?? []), migration]);
  }
  for (const [feature, migrations] of features) {
    migrations.sort((a, b) => a.number - b.number);
    migrations.forEach((migration, index) => {
      if (migration.number !== index + 1) {
        throw new Error(
          `${feature}'s migrations must be numbered 001 on without gaps or repeats; ${migration.file} is out of place.`,
        );
      }
    });
  }
  return new Map([...features].toSorted(([a], [b]) => a.localeCompare(b)));
}

/**
 * Brings the database up to date with every feature's migrations, each in its own transaction,
 * and returns the ones it ran. It refuses, before changing anything, a database that holds a
 * migration this build doesn't have (a newer Lo wrote it) or one that has changed since it ran.
 * A migration that touches anything but its own feature's tables is rolled back.
 */
export function migrate(database: Database, files: Readonly<Record<string, string>>): Migration[] {
  const features = readMigrations(files);
  const known = new Map(
    [...features.values()].flat().map((migration) => [key(migration), migration]),
  );

  for (const row of appliedRows(database)) {
    const feature = String(row.feature);
    const number = Number(row.number);
    const migration = known.get(key({ feature, number }));
    if (!migration) {
      throw new StartupError(
        `Lo's database was last opened by a newer version of Lo: it holds ${feature}'s migration ` +
          `${String(number).padStart(3, '0')}, which this version doesn't have. Update Lo to open it.`,
      );
    }
    if (migration.sha256 !== row.sha256) {
      throw new StartupError(
        `${feature}'s migration ${migration.file} has changed since it ran on this database. ` +
          'Add a new migration rather than editing one that has run.',
      );
    }
    known.delete(key(migration));
  }

  database.exec(`CREATE TABLE IF NOT EXISTS migrations (
    feature TEXT NOT NULL,
    number INTEGER NOT NULL,
    file TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    PRIMARY KEY (feature, number)
  ) STRICT`);
  const record = database.prepare(
    'INSERT INTO migrations (feature, number, file, sha256, applied_at) VALUES (?, ?, ?, ?, ?)',
  );

  const ran: Migration[] = [];
  for (const migrations of features.values()) {
    for (const migration of migrations) {
      if (!known.has(key(migration))) continue;
      database.transaction(() => {
        const before = schema(database);
        const where = `${migration.feature}'s migration ${migration.file}`;
        const allowed = owns(migration.feature);
        let refused: Action | undefined;
        const allow = (action: Action) => {
          if (allowed(action)) return true;
          refused ??= action;
          return false;
        };
        database.restrict(allow, () => {
          try {
            database.exec(migration.sql);
            compileTriggersAndViews(database, migration.feature, before, schema(database));
          } catch (error) {
            if (!refused) throw error;
            const { action, first, source } = refused;
            const what = `${action}${first === null ? '' : ` on ${first}`}`;
            const from = source === null ? '' : ` in ${source}`;
            throw new Error(`${where} tried ${what}${from}, which a migration may not do.`, {
              cause: error,
            });
          }
        });
        if (!database.inTransaction) throw new Error(`${where} ended its own transaction.`);
        checkOwnership(database, migration, before, schema(database));
        record.run(
          migration.feature,
          migration.number,
          migration.file,
          migration.sha256,
          new Date().toISOString(),
        );
      });
      ran.push(migration);
    }
  }
  return ran;
}

function key({ feature, number }: { feature: string; number: number }): string {
  return `${feature} ${number}`;
}

/** The file's hash, with its line endings made LF, so a checkout's line endings don't count. */
function sha256(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n?/g, '\n')).digest('hex');
}

/** A name as an SQL identifier. */
function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** SQLite's own schema tables, which it reads and writes itself while a migration changes it. */
const schemaTables = new Set(['sqlite_master', 'sqlite_schema', 'sqlite_temp_master']);

/** Pragmas that only read: the schema, or (SQLite checks a column it adds) the data. */
const readOnlyPragmas = new Set([
  'quick_check',
  'table_info',
  'table_xinfo',
  'index_list',
  'index_info',
  'index_xinfo',
  'foreign_key_list',
]);

/** What a feature's migration may do: anything to its own objects, and nothing else. */
function owns(feature: string): (action: Action) => boolean {
  const prefix = `${feature}_`;
  const own = (name: string | null) => name !== null && name.startsWith(prefix);
  return ({ action, first, second, database }) => {
    const main = database === null || database === 'main';
    switch (action) {
      case 'SELECT':
      case 'FUNCTION':
      case 'RECURSIVE':
        return true;
      case 'READ':
        return (
          (main && own(first)) ||
          (first !== null && schemaTables.has(first)) ||
          // A read-only pragma used as a table, such as pragma_quick_check.
          (first !== null && readOnlyPragmas.has(first.replace(/^pragma_/, '')))
        );
      case 'UPDATE':
        return (main && own(first)) || (first !== null && schemaTables.has(first));
      case 'INSERT':
      case 'DELETE':
        return (main && own(first)) || first === 'sqlite_master';
      case 'CREATE_TABLE':
        // SQLite makes sqlite_sequence for the first AUTOINCREMENT table.
        return main && (own(first) || first === 'sqlite_sequence');
      case 'DROP_TABLE':
      case 'CREATE_VIEW':
      case 'DROP_VIEW':
      case 'REINDEX':
        return main && own(first);
      case 'CREATE_INDEX':
      case 'DROP_INDEX':
      case 'CREATE_TRIGGER':
      case 'DROP_TRIGGER':
        return main && own(first) && own(second);
      case 'ALTER_TABLE':
        return first === 'main' && own(second);
      case 'PRAGMA':
        return first !== null && readOnlyPragmas.has(first.toLowerCase());
      default:
        // Transactions and savepoints, ATTACH and DETACH, anything temporary, virtual tables,
        // ANALYZE, and whatever SQLite adds later.
        return false;
    }
  };
}

/**
 * Compiles a statement that would fire each trigger the migration made or changed, and a query of
 * each such view, so their bodies meet the authorizer: SQLite checks them when they're used, not
 * when they're made.
 */
function compileTriggersAndViews(
  database: Database,
  feature: string,
  before: Map<string, SchemaObject>,
  after: Map<string, SchemaObject>,
): void {
  const fired = new Set<string>();
  for (const [name, object] of after) {
    if (before.get(name)?.sql === object.sql || !name.startsWith(`${feature}_`)) continue;
    if (object.type === 'view') database.compile(`SELECT * FROM ${quote(name)} LIMIT 0`);
    if (object.type === 'trigger') fired.add(object.table);
  }
  for (const table of fired) {
    const columns = database
      .prepare(`PRAGMA table_info(${quote(table)})`)
      .all()
      .map((row) => quote(String(row.name)));
    database.compile(`INSERT INTO ${quote(table)} DEFAULT VALUES`);
    database.compile(`DELETE FROM ${quote(table)}`);
    if (columns.length > 0) {
      const set = columns.map((column) => `${column} = ${column}`).join(', ');
      database.compile(`UPDATE ${quote(table)} SET ${set}`);
    }
  }
}

function appliedRows(database: Database): Row[] {
  const exists = database
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'migrations'")
    .get();
  return exists ? database.prepare('SELECT feature, number, sha256 FROM migrations').all() : [];
}

interface SchemaObject {
  type: string;
  table: string;
  sql: string;
}

/** Every object in the schema SQLite doesn't keep for itself, by name. */
function schema(database: Database): Map<string, SchemaObject> {
  const rows = database
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
    )
    .all();
  return new Map(
    rows.map((row) => [
      String(row.name),
      { type: String(row.type), table: String(row.tbl_name), sql: String(row.sql) },
    ]),
  );
}

/** Throws unless every object the migration added, changed or dropped is its feature's own. */
function checkOwnership(
  database: Database,
  migration: Migration,
  before: Map<string, SchemaObject>,
  after: Map<string, SchemaObject>,
): void {
  const prefix = `${migration.feature}_`;
  const where = `${migration.feature}'s migration ${migration.file}`;
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(name);
    const is = after.get(name);
    if (was?.sql === is?.sql) continue;
    const object = is ?? was;
    if (!name.startsWith(prefix) || !object?.table.startsWith(prefix)) {
      throw new Error(
        `${where} touches ${name}. A feature's tables, indexes, views and triggers are named ${prefix}….`,
      );
    }
  }
  for (const [name, object] of after) {
    if (object.type !== 'table' || !name.startsWith(prefix)) continue;
    const references = database
      .prepare('SELECT "table" FROM pragma_foreign_key_list(?)')
      .all(name)
      .map((row) => String(row.table));
    const elsewhere = references.find((table) => !table.startsWith(prefix));
    if (elsewhere) {
      throw new Error(`${where} makes ${name} refer to ${elsewhere}, another feature's table.`);
    }
  }
}
