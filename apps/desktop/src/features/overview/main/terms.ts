// The repositories' definitions in main: what `refs/lo/terms` holds in a pull request's base
// repository, a fork's pull request's included, read through GitHub's REST API as the tab's
// account, with each answer's ETag, so a read that finds nothing changed costs nothing. For a
// commit Lo hasn't read, the top of its tree and then `terms.json`, raw, by its ID, kept once it
// hashes to it: all in one turn in the account's queue, and never a file larger than the store may
// be. One read serves every tab of the repository that acts as the same account.
//
// They're read with a tab's overview, while it has one to show, in a turn after the overview's
// read went through, never ahead of what a view waits on, so nothing the overview shows waits for
// them: as the tab is shown, if they weren't read in the last 30 s, and every 5 minutes while it's
// on screen, never sooner than GitHub's `x-poll-interval` asks or a failure's wait; a public pull
// request opened without an account reads them once. What was read is kept, so they show at once
// the next time, offline too. The window reads the file in the background process. Nothing here
// calls Electron.

import { STORE_FILE, STORE_REF } from '@lo/artifact';
import {
  blobBytes,
  rootTree,
  watchRef,
  type GithubClient,
  type OverviewRef,
  type ReadPriority,
  type ReadPriorityNow,
  type RepoRef,
} from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import type { Database } from '../../../main/database.ts';
import type { Acting } from '../../tab/contract.ts';
import {
  STORE_BYTES,
  storeFound,
  type Problem,
  type StoreFound,
  type StoreState,
} from '../contract.ts';
import { isBlob } from './blobs.ts';
import { Unexpected } from './fetch.ts';
import { problemOf } from './problems.ts';

/** How often a repository's definitions are read while a tab of it is on screen. */
export const STORE_EVERY = 5 * 60_000;

/** The least time between reads as a tab is shown, or Lo comes back on screen. */
export const STORE_SHOWN = 30_000;

/**
 * The most bytes of `terms.json` kept, all repositories' together: past it, those read least
 * recently go, never the one just kept.
 */
export const STORES_CAP = 16 * 1024 * 1024;

/** How long a repository's definitions are kept without a read: 30 days. */
export const STORES_KEPT_FOR = 30 * 24 * 60 * 60_000;

/** How stale a kept read's time may grow before a read that finds it the same says so again. */
const TOUCH_EVERY = 60 * 60_000;

/** What a repository's definitions are kept as: what the ref held, and `terms.json`'s bytes. */
export interface KeptStore {
  readonly found: StoreFound;
  readonly bytes: Uint8Array | null;
}

/** Whether two things the ref was found to hold are the same. */
export function sameFound(a: StoreFound, b: StoreFound): boolean {
  switch (a.kind) {
    case 'unknown':
    case 'none':
      return b.kind === a.kind;
    case 'file':
      return b.kind === 'file' && b.commit === a.commit && b.id === a.id && b.size === a.size;
    case 'unreadable':
      return b.kind === 'unreadable' && b.object === a.object && b.why === a.why;
    default:
      a satisfies never;
      return false;
  }
}

/**
 * Each repository's definitions in the database, as main last read them, by `owner/name`: a file
 * is kept only with the bytes it names, and one that no longer reads so is forgotten. Those not
 * read for 30 days go, and past a cap on their files' sizes, those read least recently.
 */
export class KeptStores {
  readonly #database: Database;
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  readonly #cap: number;

  constructor(
    database: Database,
    options: { now?: () => number; log?: (line: string) => void; cap?: number } = {},
  ) {
    this.#database = database;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? (() => {});
    this.#cap = options.cap ?? STORES_CAP;
  }

  /**
   * What was kept of `repository`'s definitions, without reading the file: for a file, only when
   * its bytes are kept, as many as it has.
   */
  found(repository: RepoRef): StoreFound | undefined {
    const row = this.#database
      .prepare('SELECT found, length(bytes) AS size FROM overview_stores WHERE repository = ?')
      .get(repository.toString());
    if (row === undefined) return undefined;
    let found: StoreFound;
    try {
      found = storeFound.parse(JSON.parse(String(row.found)));
    } catch {
      return undefined;
    }
    const size = typeof row.size === 'bigint' ? Number(row.size) : row.size;
    return found.kind === 'file' && size !== found.size ? undefined : found;
  }

  /** Says `repository`'s definitions were read again, and found as they were kept. */
  touch(repository: RepoRef): void {
    const now = Math.round(this.#now());
    this.#database
      .prepare('UPDATE overview_stores SET seen_at = ? WHERE repository = ? AND seen_at < ?')
      .run(now, repository.toString(), now - TOUCH_EVERY);
  }

  /** What was kept of `repository`'s definitions, if anything. */
  get(repository: RepoRef): KeptStore | undefined {
    const row = this.#database
      .prepare('SELECT found, bytes FROM overview_stores WHERE repository = ?')
      .get(repository.toString());
    if (row === undefined) return undefined;
    let found: StoreFound | undefined;
    try {
      found = storeFound.parse(JSON.parse(String(row.found)));
    } catch {
      found = undefined;
    }
    const bytes = row.bytes instanceof Uint8Array ? row.bytes : null;
    if (
      found === undefined ||
      found.kind === 'unknown' ||
      (found.kind === 'file' && (bytes === null || !isBlob(found.id, bytes)))
    ) {
      this.#log(
        `forgot what Lo kept of ${repository.toString()}'s definitions, which no longer reads`,
      );
      this.forget(repository);
      return undefined;
    }
    return { found, bytes: found.kind === 'file' ? bytes : null };
  }

  /**
   * Keeps `found` as what `repository`'s definitions are, with `terms.json`'s bytes for a file,
   * then forgets those not read for 30 days, and past the cap, those read least recently.
   */
  set(repository: RepoRef, found: StoreFound, bytes: Uint8Array | null): void {
    const now = Math.round(this.#now());
    const name = repository.toString();
    this.#database.transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO overview_stores (repository, found, bytes, seen_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (repository) DO UPDATE SET
             found = excluded.found, bytes = excluded.bytes, seen_at = excluded.seen_at`,
        )
        .run(name, JSON.stringify(found), found.kind === 'file' ? bytes : null, now);
      this.#database
        .prepare('DELETE FROM overview_stores WHERE seen_at < ? AND repository != ?')
        .run(now - STORES_KEPT_FOR, name);
      this.#trim(name);
    });
  }

  /** Forgets those read least recently until the files kept fit under the cap, keeping `kept`'s. */
  #trim(kept: string): void {
    const total = this.#database
      .prepare('SELECT coalesce(sum(length(bytes)), 0) AS total FROM overview_stores')
      .get()?.total;
    let left = typeof total === 'bigint' ? Number(total) : typeof total === 'number' ? total : 0;
    if (left <= this.#cap) return;
    const oldest = this.#database
      .prepare(
        `SELECT repository, length(bytes) AS size FROM overview_stores
         WHERE repository != ? AND bytes IS NOT NULL ORDER BY seen_at, repository`,
      )
      .all(kept);
    const remove = this.#database.prepare('DELETE FROM overview_stores WHERE repository = ?');
    for (const row of oldest) {
      if (left <= this.#cap) return;
      remove.run(String(row.repository));
      left -= typeof row.size === 'bigint' ? Number(row.size) : Number(row.size ?? 0);
    }
  }

  forget(repository: RepoRef): void {
    this.#database
      .prepare('DELETE FROM overview_stores WHERE repository = ?')
      .run(repository.toString());
  }

  /** Forgets every repository's, as clearing the cache does. */
  clear(): void {
    this.#database.prepare('DELETE FROM overview_stores').run();
  }
}

/** What a tab's definitions read with. */
export interface StoreReads {
  /** Runs `request` with GitHub's client for `acting`, in its turn, as `priority` says. */
  github<T>(
    acting: Acting,
    request: (client: GithubClient) => Promise<T>,
    priority?: ReadPriorityNow,
  ): Promise<T>;
  readonly kept: KeptStores;
  readonly log: (line: string) => void;
  /** The time now, in milliseconds since the Unix epoch. */
  readonly now?: (() => number) | undefined;
}

/** What one account last heard of the ref: the ETag, what it held, and the poll interval asked. */
interface Heard {
  readonly etag: string;
  readonly ref: OverviewRef;
  readonly pollInterval: number | undefined;
}

/** A repository's definitions as one account reads them, shared by the tabs that follow them. */
class RepoStore {
  readonly acting: Acting | undefined;
  readonly repository: RepoRef;
  found: StoreFound;
  /** Whether `found` is what was kept, and GitHub hasn't said since. */
  saved: boolean;
  checkedAt: number | undefined;
  problem: Problem | undefined;
  failures = 0;
  retryAt = 0;
  heard: Heard | undefined;
  /** The read under way. */
  reading: Promise<void> | undefined;
  /** When it was last read through. */
  readAt: number | undefined;
  /** The least time between reads GitHub's `x-poll-interval` asked for, in milliseconds. */
  floor = 0;
  /** Whether it's been read without an account, which is done once. */
  readOnce = false;
  readonly listeners = new Set<() => void>();

  constructor(acting: Acting | undefined, repository: RepoRef, kept: KeptStore | undefined) {
    this.acting = acting;
    this.repository = repository;
    this.found = kept?.found ?? { kind: 'unknown' };
    this.saved = kept !== undefined;
  }

  changed(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Who reads, for a key: an account, whatever its case, nobody, or not known yet. */
function askerOf(acting: Acting | undefined): string {
  if (acting === undefined) return '?';
  return acting.kind === 'account' ? `@${acting.login.toLowerCase()}` : 'nobody';
}

/**
 * Every repository's definitions main follows, each as one account reads them: read once for all
 * the tabs that follow them, and kept.
 */
export class Stores {
  readonly #reads: StoreReads;
  readonly #now: () => number;
  readonly #entries = new Map<string, RepoStore>();

  constructor(reads: StoreReads) {
    this.#reads = reads;
    this.#now = reads.now ?? Date.now;
  }

  /**
   * Follows `repository`'s definitions as `acting` reads them, or as kept while that's not known:
   * `listener` is called each time they change. Returns a function that stops following them.
   */
  follow(acting: Acting | undefined, repository: RepoRef, listener: () => void): () => void {
    const entry = this.#entry(acting, repository);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0 && !entry.reading) {
        this.#entries.delete(this.#key(acting, repository));
      }
    };
  }

  /** What `acting` has of `repository`'s definitions now. */
  state(
    acting: Acting | undefined,
    repository: RepoRef,
  ): Pick<StoreState, 'found' | 'saved' | 'checkedAt' | 'problem'> {
    const entry = this.#entry(acting, repository);
    return {
      found: entry.found,
      saved: entry.saved,
      checkedAt: entry.checkedAt ?? null,
      problem: entry.problem ?? null,
    };
  }

  /** The bytes of `terms.json`, the file `id` names, kept as `repository`'s definitions. */
  file(repository: RepoRef, id: string): Uint8Array | undefined {
    const kept = this.#reads.kept.get(repository);
    return kept?.found.kind === 'file' && kept.found.id === id
      ? (kept.bytes ?? undefined)
      : undefined;
  }

  /**
   * Reads `repository`'s definitions as `acting` if they're due: as a tab is shown (`shown`), if
   * they weren't read in the last 30 s; else every 5 minutes, never sooner than GitHub asked; after
   * a failure, once its wait is over; and without an account, once. `force` reads them now, as
   * Retry does. Settles once the read is done, however it went; a read under way is joined.
   */
  read(
    acting: Acting,
    repository: RepoRef,
    options: { priority?: ReadPriorityNow; shown?: boolean; force?: boolean } = {},
  ): Promise<void> {
    const entry = this.#entry(acting, repository);
    if (entry.reading) return entry.reading;
    if (!options.force && !this.#due(entry, options.shown ?? false)) return Promise.resolve();
    const reading = this.#readNow(entry, options.priority).finally(() => {
      entry.reading = undefined;
      if (entry.listeners.size === 0) this.#entries.delete(this.#key(acting, repository));
    });
    entry.reading = reading;
    return reading;
  }

  /**
   * Says the overview's read, as `acting`, of a pull request of `repository` failed for `problem`,
   * so its definitions weren't read either: that's why, until a read goes through, and they're read
   * as soon as the overview's next read does. Nothing changes while they're being read.
   */
  failed(acting: Acting, repository: RepoRef, problem: Problem): void {
    const entry = this.#entry(acting, repository);
    if (entry.reading) return;
    // A wait their own failure asked for stays.
    if (entry.problem === undefined) entry.retryAt = 0;
    entry.problem = problem;
    entry.changed();
  }

  /** Forgets every repository's, as clearing the cache does: each is read afresh next time. */
  clear(): void {
    this.#reads.kept.clear();
    for (const entry of this.#entries.values()) {
      entry.found = { kind: 'unknown' };
      entry.saved = false;
      entry.heard = undefined;
      entry.readAt = undefined;
      entry.changed();
    }
  }

  #key(acting: Acting | undefined, repository: RepoRef): string {
    return `${askerOf(acting)} ${repository.key}`;
  }

  #entry(acting: Acting | undefined, repository: RepoRef): RepoStore {
    const key = this.#key(acting, repository);
    let entry = this.#entries.get(key);
    if (!entry) {
      let kept: KeptStore | undefined;
      try {
        kept = this.#reads.kept.get(repository);
      } catch (error) {
        this.#reads.log(`reading what was kept of the definitions: ${describe(error)}`);
      }
      entry = new RepoStore(acting, repository, kept);
      this.#entries.set(key, entry);
    }
    return entry;
  }

  #due(entry: RepoStore, shown: boolean): boolean {
    if (entry.acting?.kind === 'anonymous' && entry.readOnce) return false;
    const now = this.#now();
    if (entry.problem !== undefined) {
      // Shown again, it reads at once, unless GitHub asked Lo to wait.
      return (shown && entry.problem.kind !== 'rateLimited') || now >= entry.retryAt;
    }
    if (entry.readAt === undefined) return true;
    const since = now - entry.readAt;
    return shown ? since >= STORE_SHOWN : since >= Math.max(STORE_EVERY, entry.floor);
  }

  async #readNow(entry: RepoStore, priority: ReadPriorityNow | undefined): Promise<void> {
    const { acting, repository } = entry;
    if (!acting) return;
    try {
      await this.#reads.github(acting, (client) => this.#turn(entry, client), priority);
      entry.failures = 0;
      entry.problem = undefined;
      entry.readAt = this.#now();
      entry.checkedAt = entry.readAt;
      entry.saved = false;
      if (acting.kind === 'anonymous') entry.readOnce = true;
    } catch (error) {
      entry.failures += 1;
      const now = this.#now();
      const { problem, wait } = problemOf(error, acting, entry.failures, now, repository.owner);
      entry.problem = problem;
      entry.retryAt = now + wait;
      this.#reads.log(`reading ${repository.toString()}'s definitions: ${describe(error)}`);
    }
    entry.changed();
  }

  /** Reads the ref, and for a commit not read yet, its `terms.json`, in a turn held. */
  async #turn(entry: RepoStore, client: GithubClient): Promise<void> {
    const { repository } = entry;
    const ref = await this.#ask(entry, client);
    if (ref.kind === 'none') {
      this.#take(entry, { kind: 'none' }, null);
      return;
    }
    if (ref.kind === 'other') {
      this.#take(
        entry,
        { kind: 'unreadable', object: ref.sha, why: 'notCommit', size: null },
        null,
      );
      return;
    }
    const known = entry.found;
    if (known.kind === 'unreadable' && known.object === ref.sha) {
      this.#take(entry, known, null);
      return;
    }
    if (known.kind === 'file' && known.commit === ref.sha) {
      // Kept as read unless another account's older read, a write that failed or the cap took it
      // since: then the file is read again.
      if (this.#keeps(entry, known)) return;
      await this.#readFile(entry, client, ref.sha, known.id);
      return;
    }
    const tree = await rootTree(client, repository, ref.sha);
    const items = tree.items.filter(({ path }) => path === STORE_FILE);
    const item = items.length === 1 ? items[0] : undefined;
    const unreadable = (why: 'missing' | 'notFile' | 'tooLarge', size: number | null) =>
      this.#take(entry, { kind: 'unreadable', object: ref.sha, why, size }, null);
    if (!item) {
      unreadable('missing', null);
      return;
    }
    if (item.type !== 'blob' || item.mode === '120000') {
      unreadable('notFile', null);
      return;
    }
    if (item.size === undefined || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(item.sha)) {
      throw new Unexpected('GitHub’s listing of the definitions named no file Lo can read.');
    }
    if (item.size > STORE_BYTES) {
      unreadable('tooLarge', item.size);
      return;
    }
    await this.#readFile(entry, client, ref.sha, item.sha);
  }

  /** Takes `terms.json`, the file `id` in `commit`: kept, or else read from GitHub by its ID. */
  async #readFile(
    entry: RepoStore,
    client: GithubClient,
    commit: string,
    id: string,
  ): Promise<void> {
    const kept = this.#reads.kept.get(entry.repository);
    const bytes =
      kept?.found.kind === 'file' && kept.found.id === id && kept.bytes
        ? kept.bytes
        : await blobBytes(client, entry.repository, id);
    if (!isBlob(id, bytes)) {
      throw new Unexpected('GitHub sent a terms.json that isn’t the one its ID names.');
    }
    this.#take(entry, { kind: 'file', commit, id, size: bytes.length }, bytes);
  }

  /** Whether what's kept is `found`, which a read found again: if so, it's kept as read now. */
  #keeps(entry: RepoStore, found: StoreFound): boolean {
    let kept: StoreFound | undefined;
    try {
      kept = this.#reads.kept.found(entry.repository);
      if (kept === undefined || !sameFound(kept, found)) return false;
      this.#reads.kept.touch(entry.repository);
    } catch (error) {
      this.#reads.log(`reading what was kept of the definitions: ${describe(error)}`);
      return false;
    }
    return true;
  }

  /** The ref, asked with the ETag of the last answer. */
  async #ask(entry: RepoStore, client: GithubClient): Promise<OverviewRef> {
    const heard = entry.heard;
    const answer = await watchRef(client, entry.repository, STORE_REF, heard?.etag);
    if (answer.notModified) {
      if (!heard) throw new Error('GitHub said nothing changed, with nothing asked before.');
      entry.floor = (answer.pollInterval ?? heard.pollInterval ?? 0) * 1000;
      return heard.ref;
    }
    const { pollInterval } = answer;
    entry.floor = (pollInterval ?? 0) * 1000;
    entry.heard =
      answer.etag === undefined
        ? undefined
        : { etag: answer.etag, ref: answer.value, pollInterval };
    return answer.value;
  }

  #take(entry: RepoStore, found: StoreFound, bytes: Uint8Array | null): void {
    entry.found = found;
    // A file is kept whole: its bytes are written again unless they're kept.
    if (found.kind !== 'file' && this.#keeps(entry, found)) return;
    try {
      this.#reads.kept.set(entry.repository, found, bytes);
    } catch (error) {
      this.#reads.log(`keeping the definitions: ${describe(error)}`);
    }
  }
}

/**
 * A pull request's tab's repository's definitions: those of its base repository, as the tab acts,
 * or as they were kept until the tab knows who that is. Sent each time they change.
 */
export class TabStore {
  readonly id: string;
  readonly #stores: Stores;
  readonly #publish: (state: StoreState) => void;
  #acting: Acting | undefined;
  #repository: RepoRef | undefined;
  #stop: (() => void) | undefined;
  #said: string | undefined;
  #closed = false;

  constructor(options: { id: string; stores: Stores; publish: (state: StoreState) => void }) {
    this.id = options.id;
    this.#stores = options.stores;
    this.#publish = options.publish;
  }

  /** Follows the definitions of `repository`, the tab's base repository, as `acting` reads them. */
  update(acting: Acting | undefined, repository: RepoRef): void {
    if (this.#closed) return;
    const same =
      this.#repository?.equals(repository) === true && askerOf(this.#acting) === askerOf(acting);
    if (same) return;
    this.#stop?.();
    this.#acting = acting;
    this.#repository = repository;
    this.#stop = this.#stores.follow(acting, repository, () => this.#send());
    this.#send();
  }

  /**
   * Reads them, if they're due, in a turn as `priority`, the overview's read's, says, though never
   * ahead of what a view waits on: one the overview's took at once goes next. `shown` as the tab is
   * shown, which reads ones older than 30 s.
   */
  read(priority: ReadPriorityNow, shown: boolean): void {
    const [acting, repository] = [this.#acting, this.#repository];
    if (this.#closed || !acting || !repository) return;
    const soon = (): ReadPriority => {
      const now = typeof priority === 'function' ? priority() : priority;
      return now === 'background' ? 'background' : 'next';
    };
    void this.#stores.read(acting, repository, { priority: soon, shown });
  }

  /** Says the overview's read failed for `problem`, so they weren't read either. */
  failed(problem: Problem): void {
    const [acting, repository] = [this.#acting, this.#repository];
    if (this.#closed || !acting || !repository) return;
    this.#stores.failed(acting, repository, problem);
  }

  /** Reads them again now, and settles once that read is done, however it went. */
  async retry(): Promise<void> {
    const [acting, repository] = [this.#acting, this.#repository];
    if (this.#closed || !acting || !repository) return;
    await this.#stores.read(acting, repository, { priority: 'foreground', force: true });
  }

  /** What the tab has of them now. */
  state(): StoreState | undefined {
    const repository = this.#repository;
    if (!repository) return undefined;
    return {
      id: this.id,
      repository: { owner: repository.owner, name: repository.name },
      ...this.#stores.state(this.#acting, repository),
    };
  }

  /** The bytes of `terms.json`, the file `id` names, as the tab has it now: else `moved`. */
  file(id: string): Uint8Array {
    const state = this.state();
    const bytes =
      state?.found.kind === 'file' && state.found.id === id && this.#repository
        ? this.#stores.file(this.#repository, id)
        : undefined;
    if (!bytes) throw new IpcError('moved', 'That isn’t the file the definitions are in now.');
    return bytes;
  }

  close(): void {
    this.#closed = true;
    this.#stop?.();
    this.#stop = undefined;
  }

  #send(): void {
    if (this.#closed) return;
    const state = this.state();
    if (!state) return;
    const said = JSON.stringify(state);
    if (said === this.#said) return;
    this.#said = said;
    this.#publish(state);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
