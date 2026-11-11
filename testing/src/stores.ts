/** In-memory stand-ins for what the app keeps on disk, which a test can tell to fail. */

/** An answer kept with its ETag. */
export interface KeptAnswer {
  etag: string;
  body: string;
}

/** A client's store of ETags and answers, kept in memory. */
export class MemoryStore {
  readonly answers = new Map<string, KeptAnswer>();
  /** When set, every read and write fails, as a store that can't be opened does. */
  failing = false;

  get(url: string): Promise<KeptAnswer | undefined> {
    if (this.failing) return Promise.reject(new Error('the store refused the read'));
    return Promise.resolve(this.answers.get(url));
  }

  set(url: string, answer: KeptAnswer): Promise<void> {
    if (this.failing) return Promise.reject(new Error('the store refused the write'));
    this.answers.set(url, { ...answer });
    return Promise.resolve();
  }

  delete(url: string): Promise<void> {
    if (this.failing) return Promise.reject(new Error('the store refused the delete'));
    this.answers.delete(url);
    return Promise.resolve();
  }
}

/** Each account's secrets, kept in memory: whatever the code under test writes, read back as written. */
export class MemorySecrets<T> {
  readonly kept = new Map<string, T>();
  /** When set, every read fails, as a locked keychain does. */
  failingReads = false;
  /** When set, every write and delete fails, as a keychain that refuses them does. */
  failingWrites = false;
  /** Every call made, in order, as `read alice`, `write alice` or `delete alice`. */
  readonly calls: string[] = [];

  read(login: string): Promise<T | undefined> {
    this.calls.push(`read ${login}`);
    if (this.failingReads) return Promise.reject(new Error('the keychain is locked'));
    return Promise.resolve(this.kept.get(login));
  }

  write(login: string, value: T): Promise<void> {
    this.calls.push(`write ${login}`);
    if (this.failingWrites) return Promise.reject(new Error('the keychain refused the write'));
    this.kept.set(login, value);
    return Promise.resolve();
  }

  delete(login: string): Promise<void> {
    this.calls.push(`delete ${login}`);
    if (this.failingWrites) return Promise.reject(new Error('the keychain refused the delete'));
    this.kept.delete(login);
    return Promise.resolve();
  }
}

/** What {@link MemoryAccountRows} reads of an account's row. */
export interface AccountRow {
  login: string;
  /** When the account was added, in seconds since the Unix epoch. */
  addedAt: number;
}

/**
 * The accounts' rows, which of them GitHub refused, and the account chosen for each owner and
 * repository, kept in memory. Logins, owners and repositories match ignoring case, as on GitHub.
 */
export class MemoryAccountRows<T extends AccountRow> {
  /** Each account's row, by its login in lower case. */
  readonly rows = new Map<string, T>();
  /** When GitHub refused each account's token, by its login in lower case. */
  readonly refusedAt = new Map<string, number>();
  /** The login chosen for each owner, by the owner in lower case. */
  readonly owners = new Map<string, string>();
  /** The login chosen for each repository, by `owner/name` in lower case. */
  readonly repos = new Map<string, string>();
  /** When set, every read fails, as a database that can't be opened does. */
  failingReads = false;
  /** When set, every write fails, as a database that refuses them does. */
  failingWrites = false;

  /** Every row, oldest first, and those added in the same second by login. */
  accounts(): Promise<T[]> {
    if (this.failingReads) return Promise.reject(new Error('the database refused the read'));
    const rows = [...this.rows.values()].map((row) => ({ ...row }));
    return Promise.resolve(
      rows.toSorted((a, b) => a.addedAt - b.addedAt || byLowerCase(a.login, b.login)),
    );
  }

  /** Keeps `account`'s row in place of the one with its login, and forgets that GitHub refused it. */
  save(account: T): Promise<void> {
    if (this.failingWrites) return Promise.reject(new Error('the database refused the write'));
    const login = account.login.toLowerCase();
    this.rows.set(login, { ...account });
    this.refusedAt.delete(login);
    return Promise.resolve();
  }

  /** Forgets the account's row, its refusal and the owners and repositories it was chosen for. */
  delete(login: string): Promise<void> {
    if (this.failingWrites) return Promise.reject(new Error('the database refused the write'));
    const lower = login.toLowerCase();
    this.rows.delete(lower);
    this.refusedAt.delete(lower);
    for (const choices of [this.owners, this.repos]) {
      for (const [chosenFor, chosen] of choices) {
        if (chosen.toLowerCase() === lower) choices.delete(chosenFor);
      }
    }
    return Promise.resolve();
  }

  /** The logins, as their rows spell them, whose token GitHub refused. */
  refused(): Promise<string[]> {
    if (this.failingReads) return Promise.reject(new Error('the database refused the read'));
    const logins = [...this.refusedAt.keys()].flatMap((login) => this.rows.get(login)?.login ?? []);
    return Promise.resolve(logins.toSorted(byLowerCase));
  }

  /** Notes when GitHub refused the account's token. */
  setRefused(login: string, at: number): Promise<void> {
    if (this.failingWrites) return Promise.reject(new Error('the database refused the write'));
    const lower = login.toLowerCase();
    if (this.rows.has(lower)) this.refusedAt.set(lower, at);
    return Promise.resolve();
  }

  ownerAccount(owner: string): Promise<string | undefined> {
    if (this.failingReads) return Promise.reject(new Error('the database refused the read'));
    return Promise.resolve(this.owners.get(owner.toLowerCase()));
  }

  setOwnerAccount(owner: string, login: string): Promise<void> {
    if (this.failingWrites) return Promise.reject(new Error('the database refused the write'));
    this.owners.set(owner.toLowerCase(), login);
    return Promise.resolve();
  }

  repoAccount(owner: string, name: string): Promise<string | undefined> {
    if (this.failingReads) return Promise.reject(new Error('the database refused the read'));
    return Promise.resolve(this.repos.get(`${owner}/${name}`.toLowerCase()));
  }

  setRepoAccount(owner: string, name: string, login: string): Promise<void> {
    if (this.failingWrites) return Promise.reject(new Error('the database refused the write'));
    this.repos.set(`${owner}/${name}`.toLowerCase(), login);
    return Promise.resolve();
  }
}

function byLowerCase(a: string, b: string): number {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return x < y ? -1 : x > y ? 1 : 0;
}

/** What {@link MemoryPollCache} keeps of something the poller read. */
export interface PollCacheEntry {
  value: unknown;
  fetchedAt: number;
  stamp?: string | undefined;
}

/** A pull request noted as opened, as {@link MemoryPollCache} keeps it. */
export interface RecentEntry {
  pull: { key: string };
  title: string | undefined;
  login: string;
  openedAt: number;
}

/**
 * What a poller keeps between runs, in memory: each account's entries by target and name, each
 * value copied through JSON as a store on disk would, and the pull requests opened.
 */
export class MemoryPollCache {
  readonly entries = new Map<string, PollCacheEntry>();
  /** The pull requests opened, newest first. */
  readonly recent: RecentEntry[] = [];
  /** When set, every read and write fails, as a database that can't be opened does. */
  failing = false;

  #key(login: string, target: string, name: string): string {
    return `${login.toLowerCase()} ${target} ${name}`;
  }

  get(login: string, target: string, name: string): Promise<PollCacheEntry | undefined> {
    if (this.failing) return Promise.reject(new Error('the cache refused the read'));
    const entry = this.entries.get(this.#key(login, target, name));
    return Promise.resolve(entry && copy(entry));
  }

  put(
    login: string,
    target: string,
    entries: readonly { name: string; entry: PollCacheEntry }[],
  ): Promise<void> {
    if (this.failing) return Promise.reject(new Error('the cache refused the write'));
    for (const { name, entry } of entries)
      this.entries.set(this.#key(login, target, name), copy(entry));
    return Promise.resolve();
  }

  touch(
    login: string,
    target: string,
    name: string,
    fetchedAt: number,
    stamp?: { stamp: string | undefined },
  ): Promise<void> {
    if (this.failing) return Promise.reject(new Error('the cache refused the write'));
    const entry = this.entries.get(this.#key(login, target, name));
    if (entry) {
      entry.fetchedAt = fetchedAt;
      if (stamp) entry.stamp = stamp.stamp;
    }
    return Promise.resolve();
  }

  remove(login: string, target: string, name: string): Promise<void> {
    if (this.failing) return Promise.reject(new Error('the cache refused the write'));
    this.entries.delete(this.#key(login, target, name));
    return Promise.resolve();
  }

  recordRecent(recent: RecentEntry): Promise<void> {
    if (this.failing) return Promise.reject(new Error('the cache refused the write'));
    const at = this.recent.findIndex((known) => known.pull.key === recent.pull.key);
    if (at >= 0) this.recent.splice(at, 1);
    this.recent.unshift({ ...recent });
    return Promise.resolve();
  }
}

/** `entry`, with its value copied through JSON. */
function copy(entry: PollCacheEntry): PollCacheEntry {
  const value: unknown =
    entry.value === undefined ? undefined : JSON.parse(JSON.stringify(entry.value));
  return { value, fetchedAt: entry.fetchedAt, stamp: entry.stamp };
}
