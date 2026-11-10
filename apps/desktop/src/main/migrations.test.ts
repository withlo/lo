import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, type Database } from './database.ts';
import { migrate, readMigrations } from './migrations.ts';
import { StartupError } from './startup.ts';

// Made-up features' migrations, keyed by path as import.meta.glob finds them.
const notes = {
  '../features/notes/migrations/001-notes.sql':
    'CREATE TABLE notes_entries (id INTEGER PRIMARY KEY, text TEXT NOT NULL) STRICT;',
  '../features/notes/migrations/002-tags.sql':
    'CREATE TABLE notes_tags (entry INTEGER NOT NULL REFERENCES notes_entries (id), tag TEXT NOT NULL) STRICT;',
};
const pins = {
  '../features/pins/migrations/001-pins.sql':
    'CREATE TABLE pins_pins (id INTEGER PRIMARY KEY) STRICT; CREATE INDEX pins_by_id ON pins_pins (id);',
};

const open: Database[] = [];
function database(): Database {
  const made = openDatabase(':memory:');
  open.push(made);
  return made;
}
afterEach(() => {
  for (const made of open.splice(0)) made.close();
});

const tables = (db: Database) =>
  db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);
const recorded = (db: Database) =>
  db.prepare('SELECT feature, number, file FROM migrations ORDER BY feature, number').all();

describe('readMigrations', () => {
  it("orders each feature's migrations by number", () => {
    const read = readMigrations({
      ...pins,
      ...Object.fromEntries(Object.entries(notes).toReversed()),
    });
    expect([...read.keys()]).toEqual(['notes', 'pins']);
    expect(read.get('notes')?.map((migration) => migration.file)).toEqual([
      '001-notes.sql',
      '002-tags.sql',
    ]);
  });

  it.each([
    ['a misnamed file', { '../features/notes/migrations/notes.sql': '' }, "isn't named like"],
    ['a gap', { '../features/notes/migrations/002-tags.sql': '' }, 'without gaps or repeats'],
    [
      'a repeat',
      {
        '../features/notes/migrations/001-a.sql': '',
        '../features/notes/migrations/001-b.sql': '',
      },
      'without gaps or repeats',
    ],
  ])('refuses %s', (_case, files, message) => {
    expect(() => readMigrations(files)).toThrow(message);
  });
});

describe('migrate', () => {
  it("runs every feature's migrations in order and records each with its hash", () => {
    const db = database();
    const ran = migrate(db, { ...notes, ...pins });
    expect(ran.map(({ feature, file }) => `${feature}/${file}`)).toEqual([
      'notes/001-notes.sql',
      'notes/002-tags.sql',
      'pins/001-pins.sql',
    ]);
    expect(tables(db)).toEqual(['migrations', 'notes_entries', 'notes_tags', 'pins_pins']);
    expect(recorded(db)).toEqual([
      { feature: 'notes', number: 1, file: '001-notes.sql' },
      { feature: 'notes', number: 2, file: '002-tags.sql' },
      { feature: 'pins', number: 1, file: '001-pins.sql' },
    ]);
    expect(db.prepare('SELECT sha256 FROM migrations LIMIT 1').get()?.sha256).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('runs only the migrations that are new', () => {
    const db = database();
    migrate(db, {
      '../features/notes/migrations/001-notes.sql':
        notes['../features/notes/migrations/001-notes.sql'],
    });
    expect(migrate(db, { ...notes, ...pins }).map((migration) => migration.file)).toEqual([
      '002-tags.sql',
      '001-pins.sql',
    ]);
    expect(migrate(db, { ...notes, ...pins })).toEqual([]);
  });

  it('works with no migrations at all, as Lo starts', () => {
    const db = database();
    expect(migrate(db, {})).toEqual([]);
    expect(tables(db)).toEqual(['migrations']);
  });

  it('refuses a migration that changed after it ran, before changing anything', () => {
    const db = database();
    migrate(db, notes);
    const edited = { ...notes, '../features/notes/migrations/002-tags.sql': '-- edited' };
    expect(() => migrate(db, { ...edited, ...pins })).toThrow(StartupError);
    expect(() => migrate(db, { ...edited, ...pins })).toThrow(
      "notes's migration 002-tags.sql has changed since it ran",
    );
    expect(tables(db)).not.toContain('pins_pins');
  });

  it('refuses a database a newer Lo wrote, before changing anything', () => {
    const db = database();
    migrate(db, { ...notes, ...pins });
    const older = {
      '../features/notes/migrations/001-notes.sql':
        notes['../features/notes/migrations/001-notes.sql'],
    };
    expect(() => migrate(db, older)).toThrow(StartupError);
    expect(() => migrate(db, older)).toThrow(
      "a newer version of Lo: it holds notes's migration 002",
    );
    expect(recorded(db)).toHaveLength(3);
  });

  // Each run as notes' first migration, on a database where pins' table holds a row.
  it.each([
    [
      'a table without its prefix',
      'CREATE TABLE entries (id INTEGER) STRICT;',
      'tried CREATE_TABLE on entries',
    ],
    [
      'a table named for another feature',
      'CREATE TABLE pins_extra (id INTEGER) STRICT;',
      'tried CREATE_TABLE on pins_extra',
    ],
    ["another feature's table, dropped", 'DROP TABLE pins_pins;', 'tried DROP_TABLE on pins_pins'],
    [
      "another feature's table, changed",
      'ALTER TABLE pins_pins ADD COLUMN note TEXT;',
      'tried ALTER_TABLE',
    ],
    [
      "an index on another feature's table",
      'CREATE INDEX notes_pins ON pins_pins (id);',
      'tried CREATE_INDEX on notes_pins',
    ],
    [
      "a foreign key to another feature's table",
      'CREATE TABLE notes_pinned (pin INTEGER REFERENCES pins_pins (id)) STRICT;',
      'refer to pins_pins',
    ],
    [
      'a rename to a name it doesn’t own',
      'CREATE TABLE notes_a (id INTEGER) STRICT; ALTER TABLE notes_a RENAME TO pins_a;',
      'touches pins_a',
    ],
    [
      'a commit, to escape its transaction',
      'COMMIT; DROP TABLE pins_pins;',
      'tried TRANSACTION on COMMIT',
    ],
    ['a savepoint', 'SAVEPOINT here; RELEASE here;', 'tried SAVEPOINT'],
    ['the record of migrations', 'DELETE FROM migrations;', 'tried DELETE on migrations'],
    [
      "a row in another feature's table",
      'INSERT INTO pins_pins DEFAULT VALUES;',
      'tried INSERT on pins_pins',
    ],
    [
      "a copy of another feature's table",
      'CREATE TABLE notes_copy AS SELECT * FROM pins_pins;',
      'tried READ on pins_pins',
    ],
    [
      "a trigger that reaches another feature's table",
      'CREATE TABLE notes_entries (id INTEGER PRIMARY KEY) STRICT; CREATE TRIGGER notes_t AFTER INSERT ON notes_entries BEGIN DELETE FROM pins_pins; END;',
      'tried DELETE on pins_pins in notes_t',
    ],
    [
      "a view over another feature's table",
      'CREATE VIEW notes_v AS SELECT * FROM pins_pins;',
      'tried READ on pins_pins in notes_v',
    ],
    [
      'a temporary trigger',
      'CREATE TEMP TRIGGER notes_t AFTER INSERT ON pins_pins BEGIN SELECT 1; END;',
      'tried CREATE_TEMP_TRIGGER',
    ],
    [
      'a temporary table',
      'CREATE TEMP TABLE notes_scratch (id INTEGER);',
      'tried INSERT on sqlite_temp_master',
    ],
    ['another database', "ATTACH ':memory:' AS other;", 'tried ATTACH'],
    [
      'a pragma that changes the connection',
      'PRAGMA ignore_check_constraints = ON;',
      'tried PRAGMA on ignore_check_constraints',
    ],
    [
      'a pragma that turns off foreign keys',
      'PRAGMA foreign_keys = OFF;',
      'tried PRAGMA on foreign_keys',
    ],
  ])('rolls back a migration that tries %s', (_case, sql, message) => {
    const db = database();
    migrate(db, pins);
    db.prepare('INSERT INTO pins_pins DEFAULT VALUES').run();
    const before = {
      tables: tables(db),
      schema: db.prepare('SELECT sql FROM sqlite_schema ORDER BY name').all(),
    };
    const files = { ...pins, '../features/notes/migrations/001-notes.sql': sql };
    expect(() => migrate(db, files)).toThrow(message);
    expect(db.inTransaction).toBe(false);
    expect(tables(db)).toEqual(before.tables);
    expect(db.prepare('SELECT sql FROM sqlite_schema ORDER BY name').all()).toEqual(before.schema);
    expect(db.prepare('SELECT count(*) AS rows FROM pins_pins').get()).toEqual({ rows: 1 });
    expect(recorded(db)).toEqual([{ feature: 'pins', number: 1, file: '001-pins.sql' }]);
    expect(db.prepare('PRAGMA ignore_check_constraints').get()).toEqual({
      ignore_check_constraints: 0,
    });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    // SQLite opens its temp schema itself when a table is renamed; nothing else is attached.
    const attached = db
      .prepare('PRAGMA database_list')
      .all()
      .map((row) => row.name);
    expect(attached.filter((name) => name !== 'temp')).toEqual(['main']);
  });

  it('lets a migration do whatever it likes with its own tables', () => {
    const db = database();
    const own = {
      '../features/notes/migrations/001-notes.sql': `
        CREATE TABLE notes_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL DEFAULT (lower('X'))) STRICT;
        CREATE INDEX notes_by_text ON notes_entries (text);
        INSERT INTO notes_entries (text) VALUES ('first'), ('second');
        UPDATE notes_entries SET text = upper(text) WHERE id = 1;
        DELETE FROM notes_entries WHERE id = 2;
        ALTER TABLE notes_entries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE notes_entries RENAME COLUMN pinned TO starred;
        CREATE TABLE notes_counts (total INTEGER NOT NULL) STRICT;
        INSERT INTO notes_counts VALUES (0);
        CREATE TRIGGER notes_count AFTER INSERT ON notes_entries BEGIN
          UPDATE notes_counts SET total = total + 1;
        END;
        CREATE VIEW notes_starred AS SELECT * FROM notes_entries WHERE starred = 1;
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 3)
          INSERT INTO notes_entries (text) SELECT 'row ' || i FROM n;
        PRAGMA table_info(notes_entries);
        DROP INDEX notes_by_text;
        REINDEX notes_entries;
      `,
    };
    expect(migrate(db, own).map((migration) => migration.file)).toEqual(['001-notes.sql']);
    expect(db.prepare('SELECT total FROM notes_counts').get()).toEqual({ total: 3 });
    expect(db.prepare('SELECT text FROM notes_entries ORDER BY id').all()).toEqual([
      { text: 'FIRST' },
      { text: 'row 1' },
      { text: 'row 2' },
      { text: 'row 3' },
    ]);
  });

  it('hashes a migration with its line endings made LF', () => {
    const db = database();
    const lf = {
      '../features/notes/migrations/001-notes.sql':
        'CREATE TABLE notes_a (id INTEGER);\nCREATE TABLE notes_b (id INTEGER);\n',
    };
    const crlf = {
      '../features/notes/migrations/001-notes.sql':
        'CREATE TABLE notes_a (id INTEGER);\r\nCREATE TABLE notes_b (id INTEGER);\r\n',
    };
    migrate(db, lf);
    expect(migrate(db, crlf)).toEqual([]);
  });

  it('rolls back a migration that fails, keeping the ones before it', () => {
    const db = database();
    const broken = {
      ...notes,
      '../features/notes/migrations/002-tags.sql': 'CREATE TABLE notes_tags (',
    };
    expect(() => migrate(db, broken)).toThrow('incomplete input');
    expect(tables(db)).toEqual(['migrations', 'notes_entries']);
    expect(recorded(db)).toEqual([{ feature: 'notes', number: 1, file: '001-notes.sql' }]);
  });
});
