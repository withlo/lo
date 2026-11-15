// Indexing one tree: list its files, pick those the index reads, nearest the pull request's own
// first, download what the local copy lacks within the tree's cap, read the blobs in batches, and
// have the background process read their symbols, a job at a time, keeping each in the store. A
// blob the store has read at the current version is never read again, so two trees that share
// blobs read each once. Offline, only what the clone has is read. Nothing here calls Electron.

import { GitError, linguistBoolean, type Oid, type Repo, type TreeEntry } from '@lo/git';

import { IpcError } from '../../../ipc/contract.ts';
import type { PartialWhy } from '../contract.ts';
import {
  BYTES_PER_JOB,
  FILE_BYTES,
  TREE_BYTES,
  TREE_FILES,
  type FileJob,
  type Tagged,
} from '../jobs.ts';
import { inJobs } from './batches.ts';
import { blobKey, candidates, nearestFirst, type Candidate } from './select.ts';
import type { Reading, TreeFile } from './store/store.ts';

/** What indexing reads of the local copy. */
export type TreeRepo = Pick<
  Repo,
  | 'offline'
  | 'treeId'
  | 'tree'
  | 'missingObjects'
  | 'download'
  | 'objectSizes'
  | 'readBlobs'
  | 'downloadAttributes'
  | 'attribute'
>;

/** What indexing keeps in the store. */
export interface TreeStore {
  fresh(version: string, blobs: readonly { oid: string; language: string }[]): Promise<number[]>;
  put(version: string, readings: readonly Reading[]): Promise<void>;
  setTree(tree: string, files: readonly TreeFile[]): Promise<void>;
}

/** Has the background process read files' symbols, as `code.symbols` does. */
export type ReadSymbols = (
  files: FileJob[],
  signal?: AbortSignal,
) => Promise<{ version: string; files: Tagged[] }>;

/** How far a tree's index has got, by blob, which a view's progress counts across its trees. */
export interface TreeProgress {
  /** The blobs it reads, by {@link blobKey}. */
  readonly all: Set<string>;
  /** Those the store has. */
  readonly done: Set<string>;
}

export interface Built {
  /** The tree's ID, which the store keeps its files by. */
  readonly tree: string;
  /**
   * How many of its files the index could read, as far as it looked for generated ones, how many it
   * reads, and how many it has.
   */
  readonly total: number;
  readonly files: number;
  readonly indexed: number;
  /** Why it isn't whole, if it isn't. */
  readonly partial: readonly PartialWhy[];
}

export interface BuildOptions {
  readonly repo: TreeRepo;
  readonly commit: Oid;
  /** The tree's listing, if it's been read already. */
  readonly entries?: readonly TreeEntry[] | undefined;
  /** The pull request's own paths, which the files nearest to are read first. */
  readonly changed: Iterable<string>;
  readonly store: TreeStore;
  readonly read: ReadSymbols;
  /** The version a reading's stamped with, as the background process last said. */
  readonly version: string;
  readonly progress: TreeProgress;
  /** Hears each time the progress moves. */
  readonly moved?: (() => void) | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly limits?: { readonly files?: number; readonly bytes?: number } | undefined;
}

/** A file to read, with its blob's bytes. */
interface Item {
  readonly file: Candidate;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/** How many blobs one download asks for, so the tree's cap stops it close to where it should. */
const DOWNLOAD_BATCH = 1000;

/** Whether `error` is a download stopped for bringing more than it was allowed. */
function pastCap(error: unknown): boolean {
  return (
    error instanceof GitError &&
    error.detail.kind === 'fetch' &&
    error.detail.failure === 'tooLarge'
  );
}

function stopped(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new IpcError('cancelled', 'Indexing the tree was stopped.');
}

/**
 * The files of `commit` marked generated in its `.gitattributes`, by path, downloading those files
 * first. Nothing when they can't be read.
 */
async function generated(repo: TreeRepo, commit: Oid, files: readonly Candidate[]) {
  const marked = new Set<string>();
  if (files.length === 0) return marked;
  const paths = files.map((file) => Buffer.from(file.path, 'utf8'));
  try {
    await repo.downloadAttributes(commit, paths);
    const attributes = await repo.attribute(commit, 'linguist-generated', paths);
    for (const [index, attribute] of attributes.entries()) {
      const file = files[index];
      if (file && attribute !== undefined && linguistBoolean(attribute) === true) {
        marked.add(file.path);
      }
    }
  } catch {
    // More `.gitattributes` than Lo reads, or none it could download: nothing is marked.
  }
  return marked;
}

/** Indexes the tree at `commit`. Rejects with `cancelled` once `signal` aborts. */
export async function buildTree(options: BuildOptions): Promise<Built> {
  const { repo, commit, store, signal, progress } = options;
  const limits = { files: TREE_FILES, bytes: TREE_BYTES, ...options.limits };
  const moved = () => options.moved?.();
  const tree = await repo.treeId(commit);
  const entries = options.entries ?? (await repo.tree(commit));
  stopped(signal);
  const possible = await candidates(entries);
  const { chosen: ordered } = await nearestFirst(
    possible,
    options.changed,
    Number.POSITIVE_INFINITY,
  );
  // Files marked generated are looked for among the nearest, as many as fill the tree's files.
  const chosen: Candidate[] = [];
  let looked = 0;
  let marked = 0;
  while (chosen.length < limits.files && looked < ordered.length) {
    const next = ordered.slice(looked, looked + limits.files - chosen.length);
    const generatedPaths = await generated(repo, commit, next);
    for (const file of next) {
      if (generatedPaths.has(file.path)) marked += 1;
      else chosen.push(file);
    }
    looked += next.length;
    stopped(signal);
  }
  const partial = new Set<PartialWhy>(looked < ordered.length ? ['files'] : []);
  for (const file of chosen) progress.all.add(blobKey(file));

  // What the store has read already, and what's left, each blob once, nearest first.
  let version = options.version;
  const fresh = new Set(await store.fresh(version, chosen));
  const left = new Map<string, Candidate>();
  for (const [index, file] of chosen.entries()) {
    const key = blobKey(file);
    if (fresh.has(index)) progress.done.add(key);
    else if (!left.has(key)) left.set(key, file);
  }
  moved();
  stopped(signal);

  // Downloads what the clone lacks, nearest first, until the tree's cap.
  const unreachable = new Set<string>();
  let missing = await repo.missingObjects([...new Set([...left.values()].map((file) => file.oid))]);
  if (missing.length > 0 && repo.offline) partial.add('offline');
  else if (missing.length > 0) {
    let room = limits.bytes;
    for (let at = 0; at < missing.length; at += DOWNLOAD_BATCH) {
      if (room <= 0) break;
      stopped(signal);
      const batch = missing.slice(at, at + DOWNLOAD_BATCH);
      try {
        await repo.download(batch, 'the files to index', {
          maxBytes: room,
          signal,
          received: (bytes) => (room -= bytes),
        });
      } catch (error) {
        stopped(signal);
        if (pastCap(error)) partial.add('bytes');
        else partial.add('offline');
        break;
      }
    }
    if (room <= 0) partial.add('bytes');
    missing = await repo.missingObjects(missing);
  }
  for (const oid of missing) unreachable.add(oid);

  // Those too large to read are kept as skipped, so they're never downloaded or looked at again.
  const present = [...left.values()].filter((file) => !unreachable.has(file.oid));
  const sizes = await repo.objectSizes(present.map((file) => file.oid));
  const toRead: Candidate[] = [];
  const tooLarge: Reading[] = [];
  for (const [index, file] of present.entries()) {
    const size = sizes[index];
    if (size !== undefined && size > FILE_BYTES) {
      tooLarge.push({ oid: file.oid, language: file.language, read: { skipped: 'too-long' } });
    } else toRead.push(file);
  }
  if (tooLarge.length > 0) {
    await store.put(version, tooLarge);
    for (const reading of tooLarge) progress.done.add(blobKey(reading));
  }
  // The tree's files, so it answers from what's read as soon as it's read.
  await store.setTree(
    tree,
    chosen.filter((file) => !unreachable.has(file.oid)),
  );
  moved();

  // Each blob's languages: the same blob can be at paths read as different languages.
  const languages = new Map<Oid, Candidate[]>();
  for (const file of toRead) {
    const list = languages.get(file.oid) ?? [];
    list.push(file);
    languages.set(file.oid, list);
  }
  const keep = async (readings: Reading[], at: string) => {
    if (readings.length === 0) return;
    stopped(signal);
    await store.put(at, readings);
    for (const reading of readings) progress.done.add(blobKey(reading));
    moved();
  };
  for await (const blobs of repo.readBlobs([...languages.keys()], { maxBytes: BYTES_PER_JOB })) {
    stopped(signal);
    const files: Item[] = [];
    for (const blob of blobs) {
      // A copy of its own, as a job takes bytes.
      const bytes = new Uint8Array(blob.data);
      for (const file of languages.get(blob.oid) ?? []) files.push({ file, bytes });
    }
    version = await readAll(files, options.read, version, keep, signal);
  }
  return {
    tree,
    total: possible.length - marked,
    files: chosen.length,
    indexed: chosen.filter((file) => progress.done.has(blobKey(file))).length,
    partial: [...partial],
  };
}

/** The failures a job's files cause, as the background process names them. */
const FILES_FAULTS = new Set(['timeout', 'memory', 'failed', 'invalid']);

/**
 * Whether a job failed for something in its files: it ran past its deadline or its memory, threw,
 * or was refused. Anything else, such as the background process restarting or being too busy, or
 * the job being cancelled, says nothing of the files, which are read again later.
 */
function filesFault(error: unknown): boolean {
  return error instanceof IpcError && FILES_FAULTS.has(error.code);
}

/**
 * Has the background process read `files`, in jobs within its per-job limits, keeping what each
 * job read. A job that fails for its files is tried again in halves, and a file that fails alone is
 * kept as failed; one a job didn't get to goes in the next. Any other failure stops the tree's
 * build, leaving what wasn't read for the next. Returns the version the last job read with.
 */
async function readAll(
  files: readonly Item[],
  read: ReadSymbols,
  version: string,
  keep: (readings: Reading[], version: string) => Promise<void>,
  signal: AbortSignal | undefined,
): Promise<string> {
  let at = version;
  const queue = inJobs(files, ({ bytes }) => bytes.byteLength);
  while (queue.length > 0) {
    const batch = queue.shift() ?? [];
    if (batch.length === 0) continue;
    stopped(signal);
    let reply: Awaited<ReturnType<ReadSymbols>>;
    try {
      reply = await read(
        batch.map(({ file, bytes }) => ({ language: file.language, bytes })),
        signal,
      );
    } catch (error) {
      stopped(signal);
      if (!filesFault(error)) throw error;
      const [only] = batch;
      if (batch.length === 1 && only) {
        const { file } = only;
        await keep([{ oid: file.oid, language: file.language, read: { skipped: 'failed' } }], at);
        continue;
      }
      const half = Math.ceil(batch.length / 2);
      queue.unshift(batch.slice(0, half), batch.slice(half));
      continue;
    }
    at = reply.version;
    const readings: Reading[] = [];
    const again: typeof batch = [];
    for (const [index, item] of batch.entries()) {
      const result = reply.files[index];
      if (result === null || result === undefined) again.push(item);
      else readings.push({ oid: item.file.oid, language: item.file.language, read: result });
    }
    await keep(readings, at);
    // A job reads its first file whatever happens, so what's left is always less.
    if (again.length > 0 && again.length < batch.length) queue.unshift(again);
    else if (again.length > 0) {
      await keep(
        again.map(({ file }) => ({
          oid: file.oid,
          language: file.language,
          read: { skipped: 'failed' },
        })),
        at,
      );
    }
  }
  return at;
}
