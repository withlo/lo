// The syntax index's store: `<cache>/code/symbols.db`, which only the store's worker thread opens,
// so its writes and lookups never hold main's event loop. It keeps each blob's reading once, by
// its ID and the language it was read as: its definitions, the names it refers to and its imports,
// stamped with the version of the grammars and queries that read it; and each tree's paths and
// blobs, by the tree's ID. A row with another version is read again when it's needed. Past its cap,
// the trees and then the blobs no open view holds go, least recently used first. Nothing here
// calls Electron, so it runs under unit tests.

import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { openDatabase, type Database, type Row } from '../../../../main/database.ts';
import type { Definition, DefinitionKind, FileSymbols, Import, Skip } from '../../jobs.ts';

/** The most room the store's rows may take, in bytes, before it lets go of what no view holds. */
export const STORE_CAP = 1024 ** 3;

/** A blob as the index keeps it: its ID and the language it's read as. */
export interface BlobKey {
  readonly oid: string;
  readonly language: string;
}

/** A file in a tree: its path and blob. */
export interface TreeFile extends BlobKey {
  readonly path: string;
}

/** What a job said of a blob, to keep. */
export interface Reading extends BlobKey {
  readonly read: { symbols: FileSymbols } | { skipped: Skip };
}

/** Which blobs the store has read, by their places in the list asked about, and which it skipped. */
export interface Fresh {
  readonly found: number[];
  /** Those of `found` it skipped: too large to read, or failing. */
  readonly skipped: number[];
}

/** A definition found by name in a tree. */
export interface Found {
  readonly path: string;
  readonly oid: string;
  readonly name: string;
  readonly kind: DefinitionKind;
  readonly line: number;
  readonly column: number;
  readonly lastLine: number;
}

/** What the store has of a blob, at the current version. */
export interface Kept {
  readonly skipped: Skip | undefined;
  readonly definitions: Definition[];
  readonly imports: Import[];
  readonly namespace: string | undefined;
}

/** How much the cap lets go of each round, before measuring again. */
const TRIM_BATCH = 200;

/** The most names kept in memory, by their row's ID, so writing a file looks few up. */
const NAMES_KEPT = 200_000;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS names (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE) STRICT;
  CREATE TABLE IF NOT EXISTS blobs (
    id INTEGER PRIMARY KEY,
    oid TEXT NOT NULL,
    language TEXT NOT NULL,
    version TEXT NOT NULL,
    skipped TEXT,
    imports TEXT NOT NULL,
    namespace TEXT,
    used INTEGER NOT NULL,
    UNIQUE (oid, language)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS definitions (
    blob INTEGER NOT NULL REFERENCES blobs (id) ON DELETE CASCADE,
    place INTEGER NOT NULL,
    name INTEGER NOT NULL,
    kind TEXT NOT NULL,
    line INTEGER NOT NULL,
    col INTEGER NOT NULL,
    last_line INTEGER NOT NULL,
    parent INTEGER,
    PRIMARY KEY (blob, place)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS definitions_name ON definitions (name);
  CREATE TABLE IF NOT EXISTS refs (
    name INTEGER NOT NULL,
    blob INTEGER NOT NULL REFERENCES blobs (id) ON DELETE CASCADE,
    PRIMARY KEY (name, blob)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS refs_blob ON refs (blob);
  CREATE TABLE IF NOT EXISTS trees (
    id INTEGER PRIMARY KEY,
    tree TEXT NOT NULL UNIQUE,
    used INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS files (
    tree INTEGER NOT NULL REFERENCES trees (id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    oid TEXT NOT NULL,
    language TEXT NOT NULL,
    PRIMARY KEY (tree, path)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS files_blob ON files (oid, language, tree);
`;

const kinds: readonly DefinitionKind[] = [
  'class',
  'constant',
  'enum',
  'field',
  'function',
  'interface',
  'macro',
  'method',
  'module',
  'property',
  'type',
  'variable',
];

const skips: readonly Skip[] = [
  'too-long',
  'binary',
  'minified',
  'too-deep',
  'too-many',
  'timed-out',
  'out-of-memory',
  'failed',
  'language',
];

/** A definition's kind as the store wrote it, or `variable` for one it doesn't know. */
function kindOf(value: string): DefinitionKind {
  return kinds.find((kind) => kind === value) ?? 'variable';
}

/** Why a blob was skipped, as the store wrote it. */
function skipOf(value: unknown): Skip | undefined {
  return typeof value === 'string' ? (skips.find((skip) => skip === value) ?? 'failed') : undefined;
}

function text(row: Row | undefined, column: string): string {
  const value = row?.[column];
  return typeof value === 'string' ? value : '';
}

function count(row: Row | undefined, column: string): number {
  const value = row?.[column];
  return typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : 0;
}

export class Store {
  readonly #path: string;
  #db: Database;
  /** Names' row IDs, as far as they're known. */
  #names = new Map<string, number>();
  readonly #now: () => number;

  /** Opens the store at `path`, or `:memory:`; one that can't be read is made again from nothing. */
  constructor(path: string, now: () => number = Date.now) {
    this.#path = path;
    this.#now = now;
    this.#db = this.#open();
  }

  #open(): Database {
    if (this.#path !== ':memory:') mkdirSync(dirname(this.#path), { recursive: true });
    try {
      return prepare(openDatabase(this.#path));
    } catch {
      // A store that can't be read holds nothing that can't be read again.
      this.#remove();
      return prepare(openDatabase(this.#path));
    }
  }

  #remove(): void {
    if (this.#path === ':memory:') return;
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${this.#path}${suffix}`, { force: true });
  }

  close(): void {
    this.#db.close();
  }

  /** Lets go of everything, as clearing the cache does, and starts again from nothing. */
  clear(): void {
    this.#db.close();
    this.#names.clear();
    this.#remove();
    this.#db = this.#open();
  }

  /**
   * Which of `blobs` the store has read at `version`, by their places in the list, and which of
   * those it skipped, too large to read or failing; each is marked used now.
   */
  fresh(version: string, blobs: readonly BlobKey[]): Fresh {
    const find = this.#db.prepare(
      'SELECT id, skipped FROM blobs WHERE oid = ? AND language = ? AND version = ?',
    );
    const touch = this.#db.prepare('UPDATE blobs SET used = ? WHERE id = ?');
    const now = this.#now();
    return this.#db.transaction(() => {
      const found: number[] = [];
      const skipped: number[] = [];
      for (const [index, blob] of blobs.entries()) {
        const row = find.get(blob.oid, blob.language, version);
        if (!row) continue;
        touch.run(now, count(row, 'id'));
        found.push(index);
        if (skipOf(row.skipped) !== undefined) skipped.push(index);
      }
      return { found, skipped };
    });
  }

  /** Keeps what jobs read of blobs, at `version`, in place of anything kept of them before. */
  put(version: string, readings: readonly Reading[]): void {
    const db = this.#db;
    const upsert = db.prepare(
      `INSERT INTO blobs (oid, language, version, skipped, imports, namespace, used)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (oid, language) DO UPDATE SET version = excluded.version,
         skipped = excluded.skipped, imports = excluded.imports, namespace = excluded.namespace,
         used = excluded.used
       RETURNING id`,
    );
    const dropDefinitions = db.prepare('DELETE FROM definitions WHERE blob = ?');
    const dropRefs = db.prepare('DELETE FROM refs WHERE blob = ?');
    const define = db.prepare(
      `INSERT INTO definitions (blob, place, name, kind, line, col, last_line, parent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const refer = db.prepare('INSERT OR IGNORE INTO refs (name, blob) VALUES (?, ?)');
    const now = this.#now();
    db.transaction(() => {
      for (const { oid, language, read } of readings) {
        const symbols = 'symbols' in read ? read.symbols : undefined;
        const row = upsert.get(
          oid,
          language,
          version,
          'skipped' in read ? read.skipped : null,
          JSON.stringify(symbols?.imports ?? []),
          symbols?.namespace ?? null,
          now,
        );
        const blob = count(row, 'id');
        dropDefinitions.run(blob);
        dropRefs.run(blob);
        if (!symbols) continue;
        for (const [place, definition] of symbols.definitions.entries()) {
          define.run(
            blob,
            place,
            this.#nameId(definition.name),
            definition.kind,
            definition.line,
            definition.column,
            definition.lastLine,
            definition.parent ?? null,
          );
        }
        for (const name of symbols.references) refer.run(this.#nameId(name), blob);
      }
    });
  }

  /** The row ID of `name`, added if it's new. */
  #nameId(name: string): number {
    const known = this.#names.get(name);
    if (known !== undefined) return known;
    const row = this.#db
      .prepare(
        `INSERT INTO names (name) VALUES (?)
         ON CONFLICT (name) DO UPDATE SET name = excluded.name RETURNING id`,
      )
      .get(name);
    const id = count(row, 'id');
    if (this.#names.size >= NAMES_KEPT) this.#names.clear();
    this.#names.set(name, id);
    return id;
  }

  /** Keeps tree `tree`'s files, in place of any it had, and marks it used now. */
  setTree(tree: string, files: readonly TreeFile[]): void {
    const db = this.#db;
    const now = this.#now();
    db.transaction(() => {
      const row = db
        .prepare(
          `INSERT INTO trees (tree, used) VALUES (?, ?)
           ON CONFLICT (tree) DO UPDATE SET used = excluded.used RETURNING id`,
        )
        .get(tree, now);
      const id = count(row, 'id');
      db.prepare('DELETE FROM files WHERE tree = ?').run(id);
      const add = db.prepare(
        'INSERT OR IGNORE INTO files (tree, path, oid, language) VALUES (?, ?, ?, ?)',
      );
      for (const file of files) add.run(id, file.path, file.oid, file.language);
    });
  }

  /** The files kept of tree `tree`, if it's kept. */
  tree(tree: string): TreeFile[] | undefined {
    const row = this.#db.prepare('SELECT id FROM trees WHERE tree = ?').get(tree);
    if (!row) return undefined;
    return this.#db
      .prepare('SELECT path, oid, language FROM files WHERE tree = ? ORDER BY path')
      .all(count(row, 'id'))
      .map((file) => ({
        path: text(file, 'path'),
        oid: text(file, 'oid'),
        language: text(file, 'language'),
      }));
  }

  /** The definitions of `name` in tree `tree`'s blobs read at `version`, `limit` at most. */
  definitions(version: string, tree: string, name: string, limit: number): Found[] {
    return this.#db
      .prepare(
        `SELECT f.path, b.oid, d.kind, d.line, d.col, d.last_line
         FROM names n
         JOIN definitions d ON d.name = n.id
         JOIN blobs b ON b.id = d.blob AND b.version = ?
         JOIN files f ON f.oid = b.oid AND f.language = b.language
         JOIN trees t ON t.id = f.tree AND t.tree = ?
         WHERE n.name = ?
         ORDER BY f.path, d.place
         LIMIT ?`,
      )
      .all(version, tree, name, limit)
      .map((row) => ({
        path: text(row, 'path'),
        oid: text(row, 'oid'),
        name,
        kind: kindOf(text(row, 'kind')),
        line: count(row, 'line'),
        column: count(row, 'col'),
        lastLine: count(row, 'last_line'),
      }));
  }

  /** The files of tree `tree` whose blobs, read at `version`, refer to `name`, in path order. */
  referrers(version: string, tree: string, name: string, limit: number): TreeFile[] {
    return this.#db
      .prepare(
        `SELECT f.path, b.oid, b.language
         FROM names n
         JOIN refs r ON r.name = n.id
         JOIN blobs b ON b.id = r.blob AND b.version = ?
         JOIN files f ON f.oid = b.oid AND f.language = b.language
         JOIN trees t ON t.id = f.tree AND t.tree = ?
         WHERE n.name = ?
         ORDER BY f.path
         LIMIT ?`,
      )
      .all(version, tree, name, limit)
      .map((row) => ({
        path: text(row, 'path'),
        oid: text(row, 'oid'),
        language: text(row, 'language'),
      }));
  }

  /** What the store has of a blob, read at `version`, if it has it. */
  kept(version: string, blob: BlobKey): Kept | undefined {
    const row = this.#db
      .prepare(
        'SELECT id, skipped, imports, namespace FROM blobs WHERE oid = ? AND language = ? AND version = ?',
      )
      .get(blob.oid, blob.language, version);
    if (!row) return undefined;
    const definitions = this.#db
      .prepare(
        `SELECT n.name, d.kind, d.line, d.col, d.last_line, d.parent
         FROM definitions d JOIN names n ON n.id = d.name
         WHERE d.blob = ? ORDER BY d.place`,
      )
      .all(count(row, 'id'))
      .map((definition): Definition => {
        const parent = definition.parent;
        return {
          name: text(definition, 'name'),
          kind: kindOf(text(definition, 'kind')),
          line: count(definition, 'line'),
          column: count(definition, 'col'),
          lastLine: count(definition, 'last_line'),
          ...(typeof parent === 'number' ? { parent } : {}),
        };
      });
    const namespace = row.namespace;
    return {
      skipped: skipOf(row.skipped),
      definitions,
      imports: parseImports(text(row, 'imports')),
      namespace: typeof namespace === 'string' ? namespace : undefined,
    };
  }

  /** How many bytes the store's rows take. */
  used(): number {
    const pages = count(this.#db.prepare('PRAGMA page_count').get(), 'page_count');
    const free = count(this.#db.prepare('PRAGMA freelist_count').get(), 'freelist_count');
    const size = count(this.#db.prepare('PRAGMA page_size').get(), 'page_size');
    return (pages - free) * size;
  }

  /**
   * Keeps the store under `cap` bytes: past it, the trees no open view shows go, least recently
   * used first, then the blobs no open view's tree holds, each only while it's still over. What an
   * open view's trees hold always stays. Returns how many trees and blobs went.
   */
  trim(open: readonly string[], cap = STORE_CAP): { trees: number; blobs: number } {
    const db = this.#db;
    const gone = { trees: 0, blobs: 0 };
    if (this.used() <= cap) return gone;
    const kept = JSON.stringify(open);
    const trees = db.prepare(
      `SELECT id FROM trees WHERE tree NOT IN (SELECT value FROM json_each(?))
       ORDER BY used LIMIT ?`,
    );
    while (this.used() > cap) {
      const ids = trees.all(kept, TRIM_BATCH).map((row) => count(row, 'id'));
      if (ids.length === 0) break;
      db.transaction(() => {
        for (const id of ids) db.prepare('DELETE FROM trees WHERE id = ?').run(id);
      });
      gone.trees += ids.length;
    }
    const blobs = db.prepare(
      `SELECT b.id FROM blobs b
       WHERE NOT EXISTS (
         SELECT 1 FROM files f JOIN trees t ON t.id = f.tree
         WHERE f.oid = b.oid AND f.language = b.language
           AND t.tree IN (SELECT value FROM json_each(?)))
       ORDER BY b.used LIMIT ?`,
    );
    while (this.used() > cap) {
      const ids = blobs.all(kept, TRIM_BATCH).map((row) => count(row, 'id'));
      if (ids.length === 0) break;
      db.transaction(() => {
        for (const id of ids) db.prepare('DELETE FROM blobs WHERE id = ?').run(id);
      });
      gone.blobs += ids.length;
    }
    if (gone.blobs > 0) {
      // Names no blob uses any more.
      db.exec(
        `DELETE FROM names WHERE NOT EXISTS (SELECT 1 FROM refs WHERE refs.name = names.id)
         AND NOT EXISTS (SELECT 1 FROM definitions WHERE definitions.name = names.id)`,
      );
      this.#names.clear();
    }
    // The file gives back the room it no longer uses.
    db.exec('PRAGMA incremental_vacuum');
    return gone;
  }
}

/** Makes a newly opened database the store's: pages that free up can go back, then the tables. */
function prepare(db: Database): Database {
  try {
    // Only takes before the first table is made, so a store made earlier keeps its own.
    db.exec('PRAGMA auto_vacuum = INCREMENTAL');
    db.exec(SCHEMA);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Whether a value is an import, as the store wrote it. */
function isImport(value: unknown): value is Import {
  if (typeof value !== 'object' || value === null) return false;
  if (!('line' in value) || typeof value.line !== 'number') return false;
  if (!('module' in value) || typeof value.module !== 'string') return false;
  if (!('names' in value)) return false;
  const { names } = value;
  return (
    names === 'all' ||
    (Array.isArray(names) &&
      names.every(
        (name: unknown) =>
          typeof name === 'object' &&
          name !== null &&
          'name' in name &&
          typeof name.name === 'string',
      ))
  );
}

function parseImports(json: string): Import[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter(isImport) : [];
  } catch {
    return [];
  }
}
