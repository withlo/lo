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
 * - Before it downloads, the disk must have room for the download and what it unpacks to at once.
 *   A download recorded with what it unpacks to may unpack to that and {@link UNPACKED_MARGIN} more;
 *   the rest are held to the limits every download shares.
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
  statfs,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

import { z } from 'zod';

import { atOnce, syncPath } from './disk.ts';
import { fetchFile, type StallLimits } from './download.ts';
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
import {
  type Unpacked,
  Unpacker,
  UNPACK_LIMITS,
  UNPACK_RULES,
  type UnpackLimits,
} from './unpack.ts';

/** How many times a download is tried before it fails. */
export const TRIES = 3;

/** How far past what it was recorded to unpack to a download may unpack: 5% more. */
export const UNPACKED_MARGIN = 0.05;

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

/** An ID, as the manifest names one, which names its folder. */
const NAME = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;

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
  /** What counts as a try that has stalled: `STALL` unless given. */
  readonly stall?: StallLimits | undefined;
  /** How many bytes the disk holding `folder` has free, or `undefined` when it can't say. */
  readonly free?: ((folder: string) => Promise<number | undefined>) | undefined;
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

/** A removal under way, and why, which an install asked for meanwhile fails with. */
interface Removal {
  readonly reason: Error;
  readonly done: Promise<void>;
}

/** A download running, and who waits for it. */
interface Job {
  /** The version it installs. */
  readonly version: string;
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
  readonly #stall: StallLimits | undefined;
  readonly #free: (folder: string) => Promise<number | undefined>;
  readonly #jobs = new Map<string, Job>();
  /**
   * Every job running for each ID until it ends, those nobody waits for any longer among them: one
   * whose waiters left can still be putting its folder in place.
   */
  readonly #running = new Map<string, Set<Job>>();
  /** The removals of each ID under way, in the order asked: installs of it fail meanwhile. */
  readonly #removing = new Map<string, Removal[]>();

  constructor(options: InstallerOptions) {
    if (!isAbsolute(options.folder)) throw new Error(`${options.folder} isn't an absolute path`);
    this.#folder = options.folder;
    this.#fetch = options.fetch;
    this.#platform = options.platform ?? currentPlatform();
    this.#limits = options.limits;
    this.#backoff = options.backoff ?? BACKOFF;
    this.#stall = options.stall;
    this.#free = options.free ?? freeSpace;
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
    // Nothing installs it while it's being removed, so nothing gets the folder that goes.
    const removing = this.#removing.get(id)?.at(-1);
    if (removing !== undefined) throw removing.reason;
    const key = `${id}/${pinned.version}`;
    let job = this.#jobs.get(key);
    if (job === undefined) {
      const controller = new AbortController();
      const created: Job = {
        version: pinned.version,
        controller,
        listeners: new Set(),
        partial: new Set(),
        waiting: 0,
        // A job stopped once it's done gives no folder: a removal may be deleting it.
        done: Promise.resolve()
          .then(() => this.#run(id, pinned, created))
          .then((installed) => {
            controller.signal.throwIfAborted();
            return installed;
          }),
      };
      job = created;
      this.#jobs.set(key, job);
      const running = this.#running.get(id) ?? new Set();
      running.add(created);
      this.#running.set(id, running);
      const forget = () => {
        if (this.#jobs.get(key) === created) this.#jobs.delete(key);
        running.delete(created);
        if (running.size === 0 && this.#running.get(id) === running) this.#running.delete(id);
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
   * How many bytes `id`'s files take as `pinned` says, by what its marker records, or `undefined`
   * when no marker says it holds them. It reads the marker alone, for Settings to show, and
   * doesn't check the files against it, as an install does before it's used.
   */
  async recorded(id: string, pinned: Pinned): Promise<number | undefined> {
    const download = this.#downloadOf(pinned);
    const marker = await readMarker(this.folderOf(id, pinned.version));
    if (marker?.fingerprint !== fingerprint(id, pinned, download)) return undefined;
    return marker.files.reduce((sum, [, bytes]) => sum + bytes, 0);
  }

  /**
   * Removes every version of `id`, as Settings' "Remove" asks. From the moment it's asked, an
   * install of it fails with `reason`, and every install under way stops, those nobody waits for
   * any longer included. Then `first` runs, such as stopping the servers that use it, and once it
   * has and each install has ended, the folder is renamed aside, then deleted, so nothing finds it
   * half gone.
   */
  async remove(
    id: string,
    reason: Error = new Error(`${id} was removed`),
    first?: () => Promise<void>,
  ): Promise<void> {
    if (!NAME.test(id)) throw new Error(`${id} isn't an ID`);
    const removals = this.#removing.get(id) ?? [];
    this.#removing.set(id, removals);
    const before = removals.at(-1)?.done;
    for (const key of this.#jobs.keys()) if (key.startsWith(`${id}/`)) this.#jobs.delete(key);
    const stopping = [...(this.#running.get(id) ?? [])];
    for (const job of stopping) job.controller.abort(reason);
    // Installs of it are refused before anything else runs, `first` included.
    const { promise: done, resolve, reject } = Promise.withResolvers<void>();
    const removal: Removal = { reason, done };
    removals.push(removal);
    (async () => {
      await first?.();
      // One removal of it at a time.
      await before?.catch(() => undefined);
      await Promise.all(stopping.map((job) => job.done.catch(() => undefined)));
      const folder = join(this.#folder, id);
      if (!(await lstat(folder).catch(() => undefined))) return;
      await mkdir(join(this.#folder, PARTIAL), { recursive: true, mode: 0o700 });
      const aside = await mkdtemp(join(this.#folder, PARTIAL, 'removed-'));
      await rename(folder, join(aside, id));
      await rm(aside, { recursive: true, force: true });
    })().then(resolve, reject);
    try {
      await done;
    } finally {
      removals.splice(removals.indexOf(removal), 1);
      if (removals.length === 0 && this.#removing.get(id) === removals) this.#removing.delete(id);
    }
  }

  /**
   * Removes what `manifest` no longer pins: other versions, servers it doesn't list, and
   * downloads left by a Lo that stopped halfway. It keeps the versions `running` names, which
   * servers still run from, and anything an install is using.
   */
  async prune(manifest: Manifest, running: readonly Installed[] = []): Promise<void> {
    const kept = new Set(running.map((installed) => dirname(installed.folder)));
    for (const jobs of this.#running.values()) {
      for (const job of jobs) for (const folder of job.partial) kept.add(folder);
    }
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
        const installing = [...(this.#running.get(name) ?? [])].some(
          (job) => job.version === version,
        );
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
    await this.#checkRoom(download);
    signal.throwIfAborted();
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
      const limits = this.#limits ?? limitsFor(download);
      const unpacker = new Unpacker(into, { limits, signal });
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
    // A link, or anything else, where the version's folders go is removed itself, first, so
    // nothing is removed through it.
    const above = await lstat(dirname(target)).catch(() => undefined);
    if (above !== undefined && !above.isDirectory()) await this.#discard(dirname(target));
    if (await lstat(target).catch(() => undefined)) await this.#discard(target);
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

  /** Moves `path` aside, into the folder for downloads, and removes it there. */
  async #discard(path: string): Promise<void> {
    const aside = await mkdtemp(join(this.#folder, PARTIAL, 'old-'));
    await rename(path, join(aside, 'old'));
    await rm(aside, { recursive: true, force: true });
  }

  /**
   * Refuses `download` when the disk hasn't room for it: its files and what they unpack to, which
   * are both there until the files are removed.
   */
  async #checkRoom(download: Download): Promise<void> {
    const files = partsOf(download).reduce((sum, part) => sum + part.size, 0);
    const needed = files + (download.unpacked ?? 0);
    await mkdir(this.#folder, { recursive: true, mode: 0o755 });
    const free = await this.#free(this.#folder).catch(() => undefined);
    if (free === undefined || free >= needed) return;
    throw new DownloadError(
      'space',
      `Lo needs ${megabytes(needed)} free for it, and the disk has ${megabytes(free)}.`,
    );
  }

  /**
   * The install at `target`, if each folder from the installer's own down to it is a folder, not a
   * link, its marker says it holds `print`, each file, folder and link it records is there as it
   * says, and its entry point is there.
   */
  async #whole(target: string, print: string, download: Download): Promise<Installed | undefined> {
    let folder = this.#folder;
    for (const part of relative(this.#folder, target).split(sep)) {
      folder = join(folder, part);
      if ((await lstat(folder).catch(() => undefined))?.isDirectory() !== true) return undefined;
    }
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

/** What the marker in the version's folder `target` says, if it's one Lo reads. */
async function readMarker(target: string): Promise<z.output<typeof markerSchema> | undefined> {
  const text = await readFile(join(target, MARKER), 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    const marker = markerSchema.safeParse(JSON.parse(text));
    return marker.success ? marker.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The limits `download` unpacks within: what it was recorded to unpack to and
 * {@link UNPACKED_MARGIN} more, or, where that isn't recorded, those every download shares.
 */
export function limitsFor(download: Download): UnpackLimits {
  if (download.unpacked === undefined) return UNPACK_LIMITS;
  return { ...UNPACK_LIMITS, bytes: Math.ceil(download.unpacked * (1 + UNPACKED_MARGIN)) };
}

/** How many bytes the disk holding `folder` has free for Lo. */
async function freeSpace(folder: string): Promise<number | undefined> {
  const found = await statfs(folder).catch(() => undefined);
  return found === undefined ? undefined : found.bavail * found.bsize;
}

/** `bytes` in MB, rounded up, in the binary units Settings and the status bar count in. */
function megabytes(bytes: number): string {
  return `${Math.ceil(bytes / 1024 ** 2).toLocaleString('en-US')} MB`;
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
 * {@link unpackDownload}, saying too how many bytes its files hold in all: what `pin.ts` records
 * it unpacks to.
 */
export async function unpackMeasured(
  download: Download,
  files: readonly string[],
  into: string,
  options: { limits?: UnpackLimits | undefined; signal?: AbortSignal | undefined } = {},
): Promise<{ entry: string; bytes: number }> {
  const unpacker = new Unpacker(into, options);
  const entry = await unpack(unpacker, download, files, into);
  const bytes = unpacker.unpacked.files.reduce((sum, [, size]) => sum + size, 0);
  return { entry, bytes };
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
    case 'layers':
      for (const [index, layer] of download.layers.entries()) {
        await unpacker.tarGz(file(index), { from: layer.from });
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
