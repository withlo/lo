/**
 * Unpacking a verified download into a new, empty folder of Lo's, refusing whatever could reach
 * outside it. It runs only once the download's hash has matched, but holds each archive to these
 * rules anyway, since a pinned file can still be a hostile one:
 *
 * - Every path is relative and stays inside: no absolute path, no `..`, no backslash or control
 *   character.
 * - Files and folders only, first, so nothing is written through a link. Then the symbolic links,
 *   each with a relative target that stays inside; each must then resolve, through any other link,
 *   to something inside. Hard links, devices and pipes are refused.
 * - A file is created only where nothing is, with no set-user or set-group bit and writable only
 *   by its owner; its execute bits are the archive's.
 * - At most {@link UnpackLimits.entries} entries and {@link UnpackLimits.bytes} bytes of files in
 *   all, counted as they're written, so an archive that unpacks to far more than it is (a zip
 *   bomb) stops early.
 *
 * A refusal throws a `refused` {@link DownloadError} and leaves what was written: the caller
 * unpacks into a temporary folder and removes it. Once it's done, the unpacker says what it wrote
 * ({@link Unpacker.unpacked}), which an install's marker records, and syncs it all to the disk.
 */

import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, rename, symlink } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { pipeline, type Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

import { Parser, type ReadEntry } from 'tar';
import yauzl from 'yauzl';

import { atOnce, syncPath } from './disk.ts';
import { isInside } from './environment.ts';
import { DownloadError } from './errors.ts';

export interface UnpackLimits {
  /** The most entries in all: files, folders and links. */
  readonly entries: number;
  /** The most bytes the files may hold in all, unpacked. */
  readonly bytes: number;
}

/** The limits a download is unpacked within, far above any language server's. */
export const UNPACK_LIMITS: UnpackLimits = { entries: 100_000, bytes: 2 * 1024 ** 3 };

/**
 * The version of these rules, part of every install's fingerprint: raise it whenever they change
 * what a download unpacks to, and each install made under older rules is fetched again. The rules
 * from before it was kept are 1.
 */
export const UNPACK_RULES = 2;

/** What an unpacker wrote, each by its path inside its folder, in order. */
export interface Unpacked {
  /** Each file, with its size in bytes. */
  readonly files: readonly (readonly [path: string, size: number])[];
  /** Each symbolic link, with its target. */
  readonly links: readonly (readonly [path: string, target: string])[];
}

/** How many files or folders are synced to the disk at once. */
const SYNCS = 32;

/** The longest target a symbolic link may name. */
const LINK_TARGET_LIMIT = 1024;

/** What a tar's headers may add to the bytes of its files, per entry, before unpacking stops. */
const HEADER_BYTES = 4096;

/** The types of tar entry that are files. */
const TAR_FILES: ReadonlySet<string> = new Set(['File', 'OldFile', 'ContiguousFile']);

/** A file's type and permission bits, as a zip made on Unix records them. */
const TYPE_BITS = 0o170000;
const FILE_TYPE = 0o100000;
const FOLDER_TYPE = 0o040000;
const LINK_TYPE = 0o120000;

/** The zip "made by" value for Unix, whose external attributes hold a mode. */
const MADE_ON_UNIX = 3;

/** A file's data, as it's read from an archive. */
type Source = AsyncIterable<Uint8Array> & { destroy(): unknown };

/** Where an archive's entries go: a folder inside the unpacker's, and how much of each path to drop. */
export interface Placing {
  /** The folder inside the unpacker's to put them in, `/`-separated, or the unpacker's own. */
  readonly at?: string | undefined;
  /** How many leading folders to drop from each path, as npm's tarballs need for `package/`. */
  readonly strip?: number | undefined;
}

/**
 * Writes archives into `root`, a new, empty folder of Lo's, one after another, then makes their
 * links with {@link finish}.
 */
export class Unpacker {
  readonly #root: string;
  readonly #limits: UnpackLimits;
  readonly #signal: AbortSignal | undefined;
  /** Folders made or found, by path inside `root`. */
  readonly #folders = new Set<string>(['']);
  /** Links to make once every file is written. */
  readonly #links: { path: string; target: string }[] = [];
  /** The files written, by path inside `root`, with their sizes. */
  readonly #files = new Map<string, number>();
  #entries = 0;
  #bytes = 0;

  constructor(
    root: string,
    options: { limits?: UnpackLimits | undefined; signal?: AbortSignal | undefined } = {},
  ) {
    this.#root = root;
    this.#limits = options.limits ?? UNPACK_LIMITS;
    this.#signal = options.signal;
  }

  /** Unpacks the gzipped tar at `archive`. */
  async tarGz(archive: string, placing: Placing = {}): Promise<void> {
    const parser = new Parser({ strict: true });
    // Each entry is handled once the one before it is done, and its data waits meanwhile.
    let chain = Promise.resolve();
    let failure: unknown;
    const fail = (error: unknown) => {
      failure ??= error;
    };
    parser.on('entry', (entry: ReadEntry) => {
      chain = chain
        .then(() => (failure === undefined ? this.#tarEntry(entry, placing) : undefined))
        .catch(fail)
        .finally(() => entry.resume());
    });
    const parsed = new Promise<void>((resolve) => {
      parser.on('error', (error: Error) => {
        fail(refused(`The archive can’t be read (${error.message}).`));
        resolve();
      });
      parser.on('end', () => resolve());
    });
    // The tar inside may be larger than its files only by its headers.
    const cap = this.#limits.bytes + this.#limits.entries * HEADER_BYTES;
    let read = 0;
    try {
      for await (const chunk of gunzipped(archive) as AsyncIterable<Buffer>) {
        this.#signal?.throwIfAborted();
        if (failure !== undefined) break;
        read += chunk.length;
        if (read > cap) throw refused('The archive unpacks to more than Lo allows.');
        if (!parser.write(chunk)) await drained(parser);
      }
      if (failure === undefined) parser.end();
      else parser.abort(asError(failure));
    } catch (error) {
      fail(error instanceof DownloadError || this.#signal?.aborted ? error : unreadable(error));
      parser.abort(asError(failure));
    }
    await parsed;
    await chain;
    if (failure !== undefined) throw asError(failure);
  }

  async #tarEntry(entry: ReadEntry, placing: Placing): Promise<void> {
    this.#signal?.throwIfAborted();
    const path = this.#place(entry.path, placing);
    if (TAR_FILES.has(entry.type)) {
      if (path !== undefined) await this.#file(path, entry.mode ?? 0, entry.size ?? 0, entry);
    } else if (entry.type === 'Directory') {
      if (path !== undefined) await this.#folder(path);
    } else if (entry.type === 'SymbolicLink') {
      if (path !== undefined) this.#link(path, entry.linkpath ?? '');
    } else if (entry.type === 'Link') {
      throw refused(`${shown(entry.path)} is a hard link, which Lo doesn’t unpack.`);
    } else {
      throw refused(`${shown(entry.path)} is a ${entry.type}, which Lo doesn’t unpack.`);
    }
  }

  /** Unpacks the zip at `archive`. */
  async zip(archive: string, placing: Placing = {}): Promise<void> {
    let zip: yauzl.ZipFile;
    try {
      zip = await yauzl.openPromise(archive, {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      });
    } catch (error) {
      throw unreadable(error);
    }
    try {
      if (this.#entries + zip.entryCount > this.#limits.entries) throw tooMany();
      for await (const entry of zip.eachEntry()) {
        this.#signal?.throwIfAborted();
        await this.#zipEntry(zip, entry, placing);
      }
    } catch (error) {
      throw error instanceof DownloadError || this.#signal?.aborted ? error : unreadable(error);
    } finally {
      zip.close();
    }
  }

  async #zipEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, placing: Placing): Promise<void> {
    const name = entry.fileName;
    const mode =
      entry.versionMadeBy >> 8 === MADE_ON_UNIX ? entry.externalFileAttributes >>> 16 : 0;
    const type = mode & TYPE_BITS;
    const folder = name.endsWith('/') || type === FOLDER_TYPE;
    if (!folder && type !== 0 && type !== FILE_TYPE && type !== LINK_TYPE) {
      throw refused(
        `${shown(name)} is neither a file, a folder nor a link, so Lo doesn’t unpack it.`,
      );
    }
    if (entry.isEncrypted() || !entry.canDecodeFileData()) {
      throw refused(`${shown(name)} is stored in a way Lo doesn’t unpack.`);
    }
    const path = this.#place(name, placing);
    if (folder) {
      if (path !== undefined) await this.#folder(path);
      return;
    }
    if (type === LINK_TYPE) {
      if (entry.uncompressedSize > LINK_TARGET_LIMIT) throw badTarget(name);
      const target = await readAll(await zip.openReadStreamPromise(entry), LINK_TARGET_LIMIT);
      if (path !== undefined) this.#link(path, target.toString('utf8'));
      return;
    }
    if (path === undefined) return;
    if (this.#bytes + entry.uncompressedSize > this.#limits.bytes) throw tooLarge();
    await this.#file(path, mode, entry.uncompressedSize, await zip.openReadStreamPromise(entry));
  }

  /** Unpacks the gzipped file at `archive` as the file `name`. */
  async gunzip(archive: string, name: string): Promise<void> {
    const path = this.#place(name, {});
    if (path === undefined) throw refused('The program has no name.');
    try {
      await this.#file(path, 0o755, undefined, gunzipped(archive));
    } catch (error) {
      throw error instanceof DownloadError || this.#signal?.aborted ? error : unreadable(error);
    }
  }

  /** Moves the file at `file`, which must be on the same disk, in as the program `name`. */
  async program(file: string, name: string): Promise<void> {
    const path = this.#place(name, {});
    if (path === undefined) throw refused('The program has no name.');
    const size = (await lstat(file)).size;
    if (this.#bytes + size > this.#limits.bytes) throw tooLarge();
    this.#bytes += size;
    const to = join(this.#root, ...path.split('/'));
    if (await exists(to)) throw inTheWay(path);
    await rename(file, to);
    await chmod(to, 0o755);
    this.#files.set(path, size);
  }

  /**
   * Makes the links, once every archive is unpacked, and checks that each resolves to something
   * inside the folder.
   */
  async finish(): Promise<void> {
    for (const { path, target } of this.#links) {
      this.#signal?.throwIfAborted();
      await this.#folder(posix.dirname(path) === '.' ? '' : posix.dirname(path));
      const at = join(this.#root, ...path.split('/'));
      try {
        await symlink(target, at);
      } catch (error) {
        throw isCode(error, 'EEXIST') ? inTheWay(path) : error;
      }
    }
    const root = await realpath(this.#root);
    for (const { path } of this.#links) {
      const resolved = await realpath(join(this.#root, ...path.split('/'))).catch(() => undefined);
      if (resolved === undefined || !isInside(root, resolved)) {
        throw refused(`${shown(path)} is a link to something outside the download.`);
      }
    }
  }

  /** What it wrote: each file with its size, and each link with its target. */
  get unpacked(): Unpacked {
    return {
      files: [...this.#files].toSorted(byPath),
      links: this.#links.map(({ path, target }) => [path, target] as const).toSorted(byPath),
    };
  }

  /**
   * Syncs everything it wrote to the disk once it's {@link finish}ed: each file's data, then each
   * folder's entries, its links' among them.
   */
  async sync(): Promise<void> {
    const at = (path: string) => join(this.#root, ...path.split('/').filter((part) => part !== ''));
    await atOnce([...this.#files.keys()], SYNCS, (path) => syncPath(at(path)));
    await atOnce([...this.#folders], SYNCS, (path) => syncPath(at(path)));
  }

  /**
   * Where the entry named `name` goes, inside `root`, or `undefined` for one the placing drops.
   * It refuses a name that's absolute or leads out.
   */
  #place(name: string, placing: Placing): string | undefined {
    this.#count();
    if (/[\p{Cc}\\]/u.test(name)) {
      throw refused(`${shown(name)} has characters Lo doesn’t allow in a path.`);
    }
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
      throw refused(`${shown(name)} is an absolute path, which Lo doesn’t unpack.`);
    }
    const parts = name.split('/').filter((part) => part !== '' && part !== '.');
    if (parts.includes('..')) throw refused(`${shown(name)} leads out of its folder.`);
    const kept = parts.slice(placing.strip ?? 0);
    if (kept.length === 0) return undefined;
    return [...(placing.at === undefined ? [] : [placing.at]), ...kept].join('/');
  }

  #count(): void {
    this.#entries += 1;
    if (this.#entries > this.#limits.entries) throw tooMany();
  }

  /** Makes the folder at `path` inside `root`, and each above it, without following a link. */
  async #folder(path: string): Promise<void> {
    if (this.#folders.has(path)) return;
    let at = '';
    for (const part of path.split('/')) {
      at = at === '' ? part : `${at}/${part}`;
      if (this.#folders.has(at)) continue;
      const full = join(this.#root, ...at.split('/'));
      const found = await lstat(full).catch((error: unknown) => {
        if (isCode(error, 'ENOENT')) return undefined;
        throw error;
      });
      if (found === undefined) await mkdir(full, { mode: 0o755 });
      else if (!found.isDirectory()) throw inTheWay(at);
      this.#folders.add(at);
    }
  }

  /**
   * Writes `data` as a new file at `path` inside `root`, with `mode`'s execute bits, holding the
   * total to the limit. `size`, when known, is what the archive says it holds.
   */
  async #file(path: string, mode: number, size: number | undefined, data: Source): Promise<void> {
    if (size !== undefined && this.#bytes + size > this.#limits.bytes) throw tooLarge();
    const parent = posix.dirname(path);
    await this.#folder(parent === '.' ? '' : parent);
    const full = join(this.#root, ...path.split('/'));
    // `wx` creates the file and fails if anything is there, a link included.
    const out = await open(full, 'wx', 0o600).catch((error: unknown) => {
      throw isCode(error, 'EEXIST') ? inTheWay(path) : error;
    });
    let written = 0;
    try {
      for await (const chunk of data) {
        this.#signal?.throwIfAborted();
        this.#bytes += chunk.byteLength;
        if (this.#bytes > this.#limits.bytes) throw tooLarge();
        await out.write(chunk);
        written += chunk.byteLength;
      }
      await out.chmod((mode & 0o111) | 0o644);
      this.#files.set(path, written);
    } catch (error) {
      data.destroy();
      throw error;
    } finally {
      await out.close();
    }
  }

  /** Records a link at `path` to `target`, to be made by {@link finish}. */
  #link(path: string, target: string): void {
    if (
      target === '' ||
      target.length > LINK_TARGET_LIMIT ||
      /[\p{Cc}\\]/u.test(target) ||
      target.startsWith('/')
    ) {
      throw badTarget(path);
    }
    const resolved = posix.normalize(posix.join(posix.dirname(path), target));
    if (resolved === '..' || resolved.startsWith('../') || posix.isAbsolute(resolved)) {
      throw refused(`${shown(path)} is a link to something outside the download.`);
    }
    this.#links.push({ path, target });
  }
}

/** Orders entries by their paths. */
function byPath(a: readonly [string, unknown], b: readonly [string, unknown]): number {
  return a[0] < b[0] ? -1 : 1;
}

/** The file at `archive`, gunzipped. Destroying it closes the file. */
function gunzipped(archive: string): Readable {
  // Errors reach whoever reads the last stream.
  return pipeline(createReadStream(archive), createGunzip(), () => undefined);
}

/** Resolves once `parser` can take more, or once it fails. */
function drained(parser: Parser): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      parser.off('drain', done);
      parser.off('error', done);
      parser.off('abort', done);
      resolve();
    };
    parser.on('drain', done);
    parser.on('error', done);
    parser.on('abort', done);
  });
}

/** All of `stream`, if it's at most `limit` bytes. */
async function readAll(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) {
      stream.destroy();
      throw refused('A link in the archive names too long a target.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => undefined)) !== undefined;
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/** A path from an archive, quoted, with anything unprintable escaped. */
function shown(path: string): string {
  return JSON.stringify(path.length > 200 ? `${path.slice(0, 200)}…` : path);
}

function refused(message: string): DownloadError {
  return new DownloadError('refused', message);
}

function unreadable(error: unknown): DownloadError {
  const why = error instanceof Error ? error.message : String(error);
  return new DownloadError('refused', `The archive can’t be read (${why}).`, { cause: error });
}

function tooMany(): DownloadError {
  return refused('The archive holds more entries than Lo allows.');
}

function tooLarge(): DownloadError {
  return refused('The archive unpacks to more than Lo allows.');
}

function inTheWay(path: string): DownloadError {
  return refused(`${shown(path)} is in the archive twice, or where a folder must be.`);
}

function badTarget(path: string): DownloadError {
  return refused(`${shown(path)} is a link whose target Lo doesn’t allow.`);
}
