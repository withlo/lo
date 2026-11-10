import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { openDatabase, type Database } from './database.ts';
import { StartupError } from './startup.ts';

describe('openDatabase', () => {
  const open: Database[] = [];
  const folders: string[] = [];
  const memory = () => {
    const database = openDatabase(':memory:');
    open.push(database);
    return database;
  };

  afterEach(async () => {
    for (const database of open.splice(0)) database.close();
    for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
  });

  it('says so plainly when Node has no SQLite', () => {
    const missing = vi.spyOn(process, 'getBuiltinModule').mockReturnValue(undefined);
    try {
      expect(() => openDatabase(':memory:')).toThrow(StartupError);
      expect(() => openDatabase(':memory:')).toThrow('This build of Lo has no SQLite');
    } finally {
      missing.mockRestore();
    }
  });

  it('keeps a file in WAL mode', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'lo-database-'));
    folders.push(folder);
    const database = openDatabase(join(folder, 'lo.db'));
    open.push(database);
    expect(database.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
  });

  it('enforces foreign keys', () => {
    const database = memory();
    database.exec(`
      CREATE TABLE parents (id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE children (parent INTEGER NOT NULL REFERENCES parents (id)) STRICT;
    `);
    expect(() => database.prepare('INSERT INTO children (parent) VALUES (?)').run(1)).toThrow(
      'FOREIGN KEY constraint failed',
    );
  });

  it("won't let SQL write the schema by hand", () => {
    const database = memory();
    database.exec('CREATE TABLE things (id INTEGER PRIMARY KEY) STRICT');
    database.exec('PRAGMA writable_schema = ON');
    expect(() => database.exec("UPDATE sqlite_schema SET sql = 'garbage'")).toThrow(
      'may not be modified',
    );
  });

  it('runs statements with values for their placeholders', () => {
    const database = memory();
    database.exec('CREATE TABLE things (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT');
    const insert = database.prepare('INSERT INTO things (name) VALUES (?)');
    expect(insert.run('one')).toEqual({ changes: 1, lastInsertRowid: 1 });
    insert.run('two');
    expect(database.prepare('SELECT name FROM things WHERE id = ?').get(2)).toEqual({
      name: 'two',
    });
    expect(database.prepare('SELECT name FROM things ORDER BY id').all()).toEqual([
      { name: 'one' },
      { name: 'two' },
    ]);
  });

  it('commits a transaction that returns, and rolls back one that throws', () => {
    const database = memory();
    database.exec('CREATE TABLE things (name TEXT NOT NULL) STRICT');
    const insert = database.prepare('INSERT INTO things (name) VALUES (?)');
    expect(database.transaction(() => insert.run('kept').changes)).toBe(1);
    expect(() =>
      database.transaction(() => {
        insert.run('dropped');
        throw new Error('Stop.');
      }),
    ).toThrow('Stop.');
    expect(database.prepare('SELECT name FROM things').all()).toEqual([{ name: 'kept' }]);
  });

  it('refuses work that returns a promise, and rolls it back', () => {
    const database = memory();
    database.exec('CREATE TABLE things (name TEXT NOT NULL) STRICT');
    expect(() =>
      database.transaction(() => {
        database.prepare('INSERT INTO things (name) VALUES (?)').run('dropped');
        return Promise.resolve();
      }),
    ).toThrow('must be synchronous');
    expect(database.inTransaction).toBe(false);
    expect(database.prepare('SELECT count(*) AS rows FROM things').get()).toEqual({ rows: 0 });
  });

  it('checks statements compiled while restricted, and only then', () => {
    const database = memory();
    database.exec('CREATE TABLE things (name TEXT) STRICT');
    const seen: string[] = [];
    database.restrict(
      ({ action, first }) => {
        seen.push(`${action} ${first}`);
        return action !== 'INSERT';
      },
      () => {
        database.compile('SELECT name FROM things');
        expect(() => database.compile("INSERT INTO things VALUES ('x')")).toThrow('not authorized');
      },
    );
    expect(seen).toContain('READ things');
    expect(seen).toContain('INSERT things');
    database.compile("INSERT INTO things VALUES ('x')");
  });

  it("refuses a transaction inside another, since they don't nest", () => {
    const database = memory();
    expect(() => database.transaction(() => database.transaction(() => 1))).toThrow('already open');
  });
});
