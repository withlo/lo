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

  it.each([
    ['a table without its prefix', 'CREATE TABLE entries (id INTEGER) STRICT;', 'touches entries'],
    [
      "another feature's table",
      'CREATE TABLE pins_extra (id INTEGER) STRICT;',
      'touches pins_extra',
    ],
    ["another feature's table, dropped", 'DROP TABLE pins_pins;', 'touches pins_pins'],
    [
      "another feature's table, changed",
      'ALTER TABLE pins_pins ADD COLUMN note TEXT;',
      'touches pins_pins',
    ],
    [
      "an index on another feature's table",
      'CREATE INDEX notes_pins ON pins_pins (id);',
      'touches notes_pins',
    ],
    [
      "a reference to another feature's table",
      'CREATE TABLE notes_pinned (pin INTEGER REFERENCES pins_pins (id)) STRICT;',
      'refer to pins_pins',
    ],
  ])('rolls back a migration that touches %s', (_case, sql, message) => {
    const db = database();
    migrate(db, pins);
    const before = tables(db);
    const files = { ...pins, '../features/notes/migrations/001-notes.sql': sql };
    expect(() => migrate(db, files)).toThrow(message);
    expect(tables(db)).toEqual(before);
    expect(
      db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'pins_pins'").get()?.sql,
    ).not.toContain('note');
    expect(recorded(db)).toEqual([{ feature: 'pins', number: 1, file: '001-pins.sql' }]);
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
