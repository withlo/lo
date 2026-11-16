/**
 * Installing what the manifest pins, in Lo's cache folder, as `<folder>/<id>/<version>/`:
 *
 * - Each file is fetched to a temporary folder beside the installed ones, and checked against
 *   the manifest's size and SHA-256 before anything reads it. Only then is it unpacked, into the
 *   same temporary folder.
 * - The entry point must be a file inside what was unpacked. A marker, written last, records which
 *   of the manifest's downloads the folder holds, under which rules it was unpacked, and what it
 *   unpacked to: each file's path and size, each folder's path, and each link's target. Everything
 *   is synced to the disk, the marker last, before the temporary folder is renamed into place in
 *   one step. A folder is used only while its marker matches the manifest and the rules, and its
 *   files, folders and links match its marker: otherwise it's removed and fetched again. So a
 *   download cut short, a version pinned again, or an install a power loss cut short, is never
 *   run.
 * - A download that fails on the way (the connection, a stall, or the server's trouble) is tried
 *   {@link TRIES} times in all, waiting longer each time. Anything else fails at once.
 * - One download per version at a time: an install asked for while one runs waits for it.
 */

import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import { z } from 'zod';

import { atOnce, syncPath } from './disk.ts';
import { fetchFile } from './download.ts';
import { isInside } from './environment.ts';
import { DownloadError } from './errors.ts';
import {
  currentPlatform,
  downloadFor,
  isPlainPath,
  partsOf,
  type Download,
  type Manifest,
  type Pinned,
  type Platform,
} from './manifest.ts';
import { type Unpacked, Unpacker, UNPACK_RULES, type UnpackLimits } from './unpack.ts';

/** How many times a download is tried before it fails. */
export const TRIES = 3;

/** How long to wait before each try after the first, in milliseconds. */
const BACKOFF = [2_000, 8_000] as const;

/** The folder downloads wait in, inside the installer's. */
const PARTIAL = '.partial';

/** Inside a version's folder: what was unpacked, and the marker that says it's whole. */
const FILES = 'files';
const MARKER = 'installed.json';

/** What a marker holds. */
const markerSchema = z.object({
  fingerprint: z.string(),
  files: z.array(z.tuple([z.string().refine(isPlainPath), z.number().int().nonnegative()])),
  folders: z.array(z.string().refine(isPlainPath)),
  links: z.array(z.tuple([z.string().refine(isPlainPath), z.string()])),
});

/** How many of an install's files are checked against its marker at once. */
const CHECKS = 64;

export interface InstallerOptions {
  /** Lo's folder for servers, in its cache: never inside a checkout. */
  readonly folder: string;
  /** Sends one request without following redirects: Chromium's, in the app. */
  readonly fetch: typeof globalThis.fetch;
  /** The platform to install for; the one Lo runs on unless given. */
  readonly platform?: Platform | undefined;
  readonly limits?: UnpackLimits | undefined;
  /** How long to wait before each try after the first, in milliseconds. */
  readonly backoff?: readonly number[] | undefined;
  /**
   * The time a try's progress is counted over, in milliseconds: `STALL` unless given. Less than
   * `LEAST` in any of it gives the try up.
   */
  readonly stall?: number | undefined;
}

export interface InstallOptions {
  /** Stops this install waiting. The download stops once nothing waits for it. */
  readonly signal?: AbortSignal | undefined;
  /** Hears how many bytes of how many have come. */
  readonly progress?: ((received: number, total: number) => void) | undefined;
}

/** A version that's installed. */
export interface Installed {
  /** The folder its files are in. */
  readonly folder: string;
  /** Its entry point's absolute path. */
  readonly entry: string;
}

/** A download running, and who waits for it. */
interface Job {
  readonly done: Promise<Installed>;
  readonly controller: AbortController;
  readonly listeners: Set<(received: number, total: number) => void>;
  /** The temporary folders it's using, which pruning leaves. */
  readonly partial: Set<string>;
  waiting: number;
}

export class Installer {
  readonly #folder: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #platform: Platform | undefined;
  readonly #limits: UnpackLimits | undefined;
  readonly #backoff: readonly number[];
  readonly #stall: number | undefined;
  readonly #jobs = new Map<string, Job>();

  constructor(options: InstallerOptions) {
    if (!isAbsolute(options.folder)) throw new Error(`${options.folder} isn't an absolute path`);
    this.#folder = options.folder;
    this.#fetch = options.fetch;
    this.#platform = options.platform ?? currentPlatform();
    this.#limits = options.limits;
    this.#backoff = options.backoff ?? BACKOFF;
    this.#stall = options.stall;
  }

  /** The folder `id`'s `version` is installed in, whole or not. */
  folderOf(id: string, version: string): string {
    return join(this.#folder, id, version);
  }

  /**
   * Installs `id` as `pinned` says, unless it's installed already, and says where. It throws a
   * {@link DownloadError} with why it couldn't, or, once `options.signal` aborts, its reason.
   */
  async install(id: string, pinned: Pinned, options: InstallOptions = {}): Promise<Installed> {
    const { signal, progress } = options;
    signal?.throwIfAborted();
    const key = `${id}/${pinned.version}`;
    let job = this.#jobs.get(key);
    if (job === undefined) {
      const controller = new AbortController();
      const created: Job = {
        controller,
        listeners: new Set(),
        partial: new Set(),
        waiting: 0,
        done: Promise.resolve().then(() => this.#run(id, pinned, created)),
      };
      job = created;
      this.#jobs.set(key, job);
      const forget = () => {
        if (this.#jobs.get(key) === created) this.#jobs.delete(key);
      };
      job.done.then(forget, forget);
    }
    const joined = job;
    joined.waiting += 1;
    if (progress !== undefined) joined.listeners.add(progress);
    let leave: (() => void) | undefined;
    const left = new Promise<never>((_, reject) => {
      leave = () => reject(reasonOf(signal));
      signal?.addEventListener('abort', leave, { once: true });
    });
    try {
      return await Promise.race([joined.done, left]);
    } finally {
      if (leave !== undefined) signal?.removeEventListener('abort', leave);
      if (progress !== undefined) joined.listeners.delete(progress);
      joined.waiting -= 1;
      // Nobody waits any more: stop it, and let the next install start afresh.
      if (joined.waiting === 0 && signal?.aborted === true) {
        if (this.#jobs.get(key) === joined) this.#jobs.delete(key);
        joined.controller.abort(signal.reason);
      }
    }
  }

  /** Where `id` is installed as `pinned` says, or `undefined` if it isn't, whole. */
  async installed(id: string, pinned: Pinned): Promise<Installed | undefined> {
    const download = this.#downloadOf(pinned);
    return this.#whole(
      this.folderOf(id, pinned.version),
      fingerprint(id, pinned, download),
      download,
    );
  }

  /**
   * Removes what `manifest` no longer pins: other versions, servers it doesn't list, and
   * downloads left by a Lo that stopped halfway. It keeps the versions `running` names, which
   * servers still run from, and anything an install is using.
   */
  async prune(manifest: Manifest, running: readonly Installed[] = []): Promise<void> {
    const kept = new Set(running.map((installed) => dirname(installed.folder)));
    for (const job of this.#jobs.values()) for (const folder of job.partial) kept.add(folder);
    const remove = (folder: string) =>
      kept.has(folder) ? undefined : rm(folder, { recursive: true, force: true });
    for (const name of await readdir(this.#folder).catch(() => [])) {
      const folder = join(this.#folder, name);
      if (name === PARTIAL) {
        for (const partial of await readdir(folder).catch(() => [])) {
          await remove(join(folder, partial));
        }
        continue;
      }
      const pinned = manifest[name];
      for (const version of await readdir(folder).catch(() => [])) {
        const installing = this.#jobs.has(`${name}/${version}`);
        if (version !== pinned?.version && !installing) await remove(join(folder, version));
      }
      if ((await readdir(folder).catch(() => [])).length === 0) {
        await rm(folder, { force: true, recursive: true });
      }
    }
  }

  async #run(id: string, pinned: Pinned, job: Job): Promise<Installed> {
    const download = this.#downloadOf(pinned);
    const print = fingerprint(id, pinned, download);
    const target = this.folderOf(id, pinned.version);
    const found = await this.#whole(target, print, download);
    if (found !== undefined) return found;
    const { signal } = job.controller;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.#attempt(id, pinned, download, print, job);
      } catch (error) {
        const again =
          error instanceof DownloadError && error.problem === 'interrupted' && attempt < TRIES;
        if (!again || signal.aborted) throw signal.aborted ? signal.reason : error;
        await wait(this.#backoff[attempt - 1] ?? this.#backoff.at(-1) ?? 0, signal);
      }
    }
  }

  /** Downloads, checks and unpacks `download` once, then puts it in place. */
  async #attempt(
    id: string,
    pinned: Pinned,
    download: Download,
    print: string,
    job: Job,
  ): Promise<Installed> {
    const { signal } = job.controller;
    const partialRoot = join(this.#folder, PARTIAL);
    await mkdir(partialRoot, { recursive: true, mode: 0o700 });
    const work = await mkdtemp(join(partialRoot, `${id}-`));
    job.partial.add(work);
    try {
      const parts = partsOf(download);
      const total = parts.reduce((sum, part) => sum + part.size, 0);
      const report = (received: number) => {
        for (const listener of job.listeners) {
          try {
            listener(received, total);
          } catch {
            // Whoever listens can't stop the download.
          }
        }
      };
      report(0);
      let before = 0;
      const files: string[] = [];
      for (const [index, part] of parts.entries()) {
        const file = join(work, `download-${index}`);
        const fetched = await fetchFile(part.url, file, {
          fetch: this.#fetch,
          hosts: pinned.hosts,
          limit: part.size,
          signal,
          stall: this.#stall,
          received: (bytes) => report(before + bytes),
        });
        if (fetched.size < part.size) {
          throw new DownloadError(
            'interrupted',
            `The download stopped at ${fetched.size} of ${part.size} bytes.`,
          );
        }
        if (fetched.sha256 !== part.sha256) {
          throw new DownloadError(
            'mismatch',
            'The download isn’t the file Lo pinned: its SHA-256 is another.',
          );
        }
        before += part.size;
        files.push(file);
      }
      const into = join(work, FILES);
      await mkdir(into, { mode: 0o755 });
      const unpacker = new Unpacker(into, { limits: this.#limits, signal });
      await unpack(unpacker, download, files, into);
      for (const file of files) await rm(file, { force: true });
      signal.throwIfAborted();
      // What was unpacked is on the disk before the marker says so, and the marker before the
      // folder is in place, so a power loss leaves no folder that looks whole and isn't.
      await unpacker.sync();
      const { files: unpacked, folders, links } = unpacker.unpacked;
      const marker = {
        id,
        version: pinned.version,
        fingerprint: print,
        files: unpacked,
        folders,
        links,
      };
      await writeFile(join(work, MARKER), `${JSON.stringify(marker)}\n`, { flag: 'wx' });
      await syncPath(join(work, MARKER));
      await syncPath(work);
      return await this.#place(work, this.folderOf(id, pinned.version), print, download);
    } finally {
      await rm(work, { recursive: true, force: true });
      job.partial.delete(work);
    }
  }

  /**
   * Renames `work` into place as `target`. A folder already there is used if it's whole, as
   * another Lo may have just put it there, and otherwise moved aside and removed.
   */
  async #place(
    work: string,
    target: string,
    print: string,
    download: Download,
  ): Promise<Installed> {
    const there = await this.#whole(target, print, download);
    if (there !== undefined) return there;
    if (await lstat(target).catch(() => undefined)) {
      const aside = await mkdtemp(join(this.#folder, PARTIAL, 'old-'));
      await rename(target, join(aside, 'old'));
      await rm(aside, { recursive: true, force: true });
    }
    await mkdir(dirname(target), { recursive: true, mode: 0o755 });
    try {
      await rename(work, target);
    } catch (error) {
      const raced = await this.#whole(target, print, download);
      if (raced !== undefined) return raced;
      throw error;
    }
    // So the install outlasts a power loss, rather than being fetched again.
    await syncPath(dirname(target));
    const placed = await this.#whole(target, print, download);
    if (placed === undefined) throw new Error(`the install at ${target} isn't whole`);
    return placed;
  }

  /**
   * The install at `target`, if its marker says it holds `print`, each file, folder and link it
   * records is there as it says, and its entry point is there.
   */
  async #whole(target: string, print: string, download: Download): Promise<Installed | undefined> {
    const text = await readFile(join(target, MARKER), 'utf8').catch(() => undefined);
    if (text === undefined) return undefined;
    let said: unknown;
    try {
      said = JSON.parse(text);
    } catch {
      return undefined;
    }
    const marker = markerSchema.safeParse(said);
    if (!marker.success || marker.data.fingerprint !== print) return undefined;
    const files = join(target, FILES);
    if (!(await matches(files, marker.data))) return undefined;
    const entry = await checkEntry(files, download.entry).catch(() => undefined);
    return entry === undefined ? undefined : { folder: files, entry };
  }

  #downloadOf(pinned: Pinned): Download {
    const download = this.#platform === undefined ? undefined : downloadFor(pinned, this.#platform);
    if (download === undefined) {
      throw new DownloadError('unavailable', 'There’s no download of it for this system.');
    }
    return download;
  }
}

/**
 * What identifies `download` of `id`'s pinned version, unpacked under `rules`: any change to
 * either changes this.
 */
export function fingerprint(
  id: string,
  pinned: Pinned,
  download: Download,
  rules = UNPACK_RULES,
): string {
  const installed = { id, version: pinned.version, download, rules };
  return createHash('sha256').update(JSON.stringify(installed, sortedKeys)).digest('hex');
}

/**
 * Whether `folder` and each folder `unpacked` records in it are still folders, not links, so
 * nothing below them is reached through one, each file it records is there with its size, and
 * each link with its target. It reads only what the system knows of each, never a file's data.
 */
async function matches(folder: string, unpacked: Unpacked): Promise<boolean> {
  const at = (path: string) => join(folder, ...path.split('/'));
  try {
    if (!(await lstat(folder)).isDirectory()) return false;
    await atOnce(unpacked.folders, CHECKS, async (path) => {
      if (!(await lstat(at(path))).isDirectory()) throw new Error(`${path} isn't as unpacked`);
    });
    await atOnce(unpacked.files, CHECKS, async ([path, size]) => {
      const info = await lstat(at(path));
      if (!info.isFile() || info.size !== size) throw new Error(`${path} isn't as unpacked`);
    });
    await atOnce(unpacked.links, CHECKS, async ([path, target]) => {
      if ((await readlink(at(path))) !== target) throw new Error(`${path} isn't as unpacked`);
    });
    return true;
  } catch {
    return false;
  }
}

/** Each object's keys in order, so that the order a manifest writes them in doesn't count. */
function sortedKeys(_: string, value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * Unpacks `files`, the verified parts of `download` in order, into `into`, a new, empty folder,
 * and says where its entry point is, checked to be a file inside it.
 */
export async function unpackDownload(
  download: Download,
  files: readonly string[],
  into: string,
  options: { limits?: UnpackLimits | undefined; signal?: AbortSignal | undefined } = {},
): Promise<string> {
  return unpack(new Unpacker(into, options), download, files, into);
}

/**
 * Unpacks `files`, the parts of `download` in order, with `unpacker`, which writes into `into`,
 * makes its links, and says where its entry point is.
 */
async function unpack(
  unpacker: Unpacker,
  download: Download,
  files: readonly string[],
  into: string,
): Promise<string> {
  await unpackAll(unpacker, download, files);
  await unpacker.finish();
  return checkEntry(into, download.entry);
}

/** Unpacks `files`, the parts of `download` in order, with `unpacker`. */
async function unpackAll(
  unpacker: Unpacker,
  download: Download,
  files: readonly string[],
): Promise<void> {
  const file = (index: number) => {
    const found = files[index];
    if (found === undefined) throw new Error(`no download ${index}`);
    return found;
  };
  switch (download.kind) {
    case 'tar.gz':
      return unpacker.tarGz(file(0));
    case 'zip':
      return unpacker.zip(file(0));
    case 'gz':
      return unpacker.gunzip(file(0), download.entry);
    case 'file':
      return unpacker.program(file(0), download.entry);
    case 'npm':
      for (const [index, pkg] of download.packages.entries()) {
        await unpacker.tarGz(file(index), { at: pkg.path, strip: 1 });
      }
      return undefined;
    default:
      throw new Error(`a download Lo doesn't know: ${JSON.stringify(download satisfies never)}`);
  }
}

/** The entry point `entry`'s absolute path inside `files`, checked to be a file there. */
async function checkEntry(files: string, entry: string): Promise<string> {
  const path = join(files, ...entry.split('/'));
  const real = await realpath(path).catch(() => undefined);
  const root = await realpath(files);
  if (real === undefined || !isInside(root, real) || !(await stat(real)).isFile()) {
    throw new DownloadError('refused', `The download has no ${entry} to start from.`);
  }
  return path;
}

/** Why `signal` aborted, as an error. */
function reasonOf(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new Error(String(reason));
}

/** Resolves after `ms`, or throws once `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      reject(reasonOf(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', done);
      resolve();
    }, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}
