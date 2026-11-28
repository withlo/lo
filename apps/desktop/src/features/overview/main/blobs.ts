// Overviews' files in the database, by their git IDs: `artifact.md` and the figures an overview
// shows, as GitHub sent them. Each is checked against its ID as it's kept and again as it's read,
// so what's shown is always the file the commit names, and past a cap on their sizes, those used
// least recently go. Those a closed or merged pull request's kept overview holds (`SavedRefs`) are
// held apart: they never go, and don't count toward the cap, which only the rest are held to, so
// they never crowd them out. Only clearing the cache forgets them. Nothing here calls Electron.

import { createHash } from 'node:crypto';

import type { Database } from '../../../main/database.ts';

/**
 * The most bytes of files kept, past which those used least recently go: 256 MiB, not counting
 * those closed pull requests' kept overviews hold.
 */
export const BLOBS_CAP = 256 * 1024 * 1024;

/**
 * The ID git gives a file of `bytes`: the SHA-1 of `blob <size>\0` and the bytes, or their
 * SHA-256 in a repository that uses it, which a 64-digit ID says.
 */
export function blobId(bytes: Uint8Array, length: 40 | 64 = 40): string {
  return createHash(length === 64 ? 'sha256' : 'sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

/** Whether `bytes` are the file `id` names. */
export function isBlob(id: string, bytes: Uint8Array): boolean {
  return (id.length === 40 || id.length === 64) && blobId(bytes, id.length) === id;
}

/** The files no closed or merged pull request's kept overview holds, as a condition on a row. */
const UNHELD = `id NOT IN (
  SELECT files.id FROM overview_ref_files AS files
  JOIN overview_refs AS refs ON refs.repository = files.repository AND refs.number = files.number
  WHERE refs.closed = 1)`;

/** A row's integer column, as SQLite gives it back. */
function integer(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : 0;
}

export interface BlobsOptions {
  /** The most bytes kept: {@link BLOBS_CAP} unless said otherwise. */
  readonly cap?: number | undefined;
  /** The time now, in milliseconds since the Unix epoch. */
  readonly now?: (() => number) | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

export class Blobs {
  readonly #database: Database;
  readonly #cap: number;
  readonly #now: () => number;
  readonly #log: (line: string) => void;

  constructor(database: Database, options: BlobsOptions = {}) {
    this.#database = database;
    this.#cap = options.cap ?? BLOBS_CAP;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? (() => {});
  }

  /**
   * The file `id` names, if it's kept, as one it's used now. One whose bytes aren't the file's, as
   * after the database was changed outside Lo, is forgotten and reads as not kept.
   */
  get(id: string): Uint8Array | undefined {
    const row = this.#database.prepare('SELECT bytes FROM overview_blobs WHERE id = ?').get(id);
    const bytes = row?.bytes;
    if (!(bytes instanceof Uint8Array)) return undefined;
    if (!isBlob(id, bytes)) {
      this.#log(`forgot a kept file whose bytes aren't ${id}'s`);
      this.#database.prepare('DELETE FROM overview_blobs WHERE id = ?').run(id);
      return undefined;
    }
    this.#database
      .prepare('UPDATE overview_blobs SET used_at = ? WHERE id = ?')
      .run(Math.round(this.#now()), id);
    return bytes;
  }

  /** Whether the file `id` names is kept, without reading it. */
  has(id: string): boolean {
    return (
      this.#database.prepare('SELECT 1 FROM overview_blobs WHERE id = ?').get(id) !== undefined
    );
  }

  /**
   * Keeps `bytes` as the file `id` names, if they are, and says whether they are. Past the cap,
   * the files used least recently go, though never the one just kept, nor one a closed pull
   * request's kept overview holds, which the cap doesn't count.
   */
  put(id: string, bytes: Uint8Array): boolean {
    if (!isBlob(id, bytes)) return false;
    const now = Math.round(this.#now());
    this.#database.transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO overview_blobs (id, bytes, size, used_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET used_at = excluded.used_at`,
        )
        .run(id, bytes, bytes.length, now);
      this.#trim(id);
    });
    return true;
  }

  /** Forgets every file, as clearing the cache does. */
  clear(): void {
    this.#database.prepare('DELETE FROM overview_blobs').run();
  }

  /** How many bytes the kept files take. */
  size(): number {
    return integer(
      this.#database.prepare('SELECT coalesce(sum(size), 0) AS total FROM overview_blobs').get()
        ?.total,
    );
  }

  /** How many bytes the files the cap counts take: all but those closed pull requests' hold. */
  counted(): number {
    return integer(
      this.#database
        .prepare(`SELECT coalesce(sum(size), 0) AS total FROM overview_blobs WHERE ${UNHELD}`)
        .get()?.total,
    );
  }

  /**
   * Forgets the files used least recently until those the cap counts fit under it, keeping `kept`
   * and never counting those of closed pull requests' kept overviews.
   */
  #trim(kept: string): void {
    let total = this.counted();
    if (total <= this.#cap) return;
    const oldest = this.#database.prepare(
      `SELECT id, size FROM overview_blobs WHERE id != ? AND ${UNHELD}
       ORDER BY used_at, id LIMIT 64`,
    );
    const remove = this.#database.prepare('DELETE FROM overview_blobs WHERE id = ?');
    while (total > this.#cap) {
      const rows = oldest.all(kept);
      if (rows.length === 0) return;
      for (const row of rows) {
        if (total <= this.#cap) return;
        remove.run(String(row.id));
        total -= integer(row.size);
      }
    }
  }
}
