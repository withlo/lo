// GitHub as the accounts feature provides it: the accounts on their rows and grants, a poller for
// each on the database's cache, and a client for public repositories. Nothing here calls Electron,
// so it runs under unit tests with a `fetch` that replays GitHub.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  Accounts,
  checkToken,
  GITHUB_URLS,
  GithubClient,
  Poller,
  refreshGrant,
  Token,
  type AccountRows,
  type AccountSource,
  type AccountsEvent,
  type AuthenticatedUser,
  type Grant,
  type GitHubUrls,
  type PollConfig,
  type PullRef,
  type RecentPull,
  type RepoAccount,
  type RepoRef,
  type Secrets,
} from '@lo/github';

import type { Database } from '../../../main/database.ts';
import type { AccountState, GithubAccess, GithubEvent } from '../service.ts';
import { AnswerCache } from './cache.ts';
import { NoKeychain } from './grants.ts';
import { AccountTable } from './rows.ts';

export interface GithubOptions {
  database: Database;
  /** Where each account's grant is kept. */
  secrets: Secrets;
  /** The `fetch` every request to GitHub goes through: in the app, Chromium's (`main/fetch.ts`). */
  fetch: typeof globalThis.fetch;
  /** GitHub's addresses, if not github.com's. */
  urls?: GitHubUrls | undefined;
  /** This build of Lo, whose answers the pollers read back. */
  build: string;
  /** Where to report what went wrong, never with a token in it. */
  log: (message: string) => void;
  /** The pollers' settings, for tests. */
  poll?: Partial<PollConfig> | undefined;
  /** Where the accounts' rows are, for tests: the database's tables unless said otherwise. */
  rows?: AccountRows | undefined;
}

/** The {@link GithubAccess} the accounts feature provides, with what only the feature itself does. */
export class Github implements GithubAccess {
  readonly urls: GitHubUrls;
  readonly anonymous: GithubClient;
  readonly #cache: AnswerCache;
  readonly #fetch: typeof globalThis.fetch;
  readonly #log: (message: string) => void;
  readonly #poll: Partial<PollConfig> | undefined;
  readonly #loaded: Promise<Accounts>;
  /** Each account's poller, by lowercased login. */
  readonly #pollers = new Map<string, Poller>();
  /** Accounts whose renewed token the keychain keeps refusing, by lowercased login. */
  readonly #cantSave = new Set<string>();
  /**
   * Accounts whose grant was last refused for want of a keychain to read or keep it with, by
   * lowercased login, until one is read or kept again.
   */
  readonly #needsKeyring = new Set<string>();
  readonly #listeners = new Set<(event: GithubEvent) => void>();
  readonly #observers = new Set<() => void>();
  readonly #unsubscribe: (() => void)[] = [];
  #foreground = true;
  #stopped = false;

  constructor(options: GithubOptions) {
    const { database, fetch, log } = options;
    this.urls = options.urls ?? GITHUB_URLS;
    // What a poller read is GitHub's at this address, and only this build reads it back.
    this.#cache = new AnswerCache(database, stampOf(options.build, this.urls.api));
    this.#fetch = fetch;
    this.#log = log;
    this.#poll = options.poll;
    this.anonymous = new GithubClient({ fetch, urls: this.urls });
    const web = { fetch, urls: this.urls };
    this.#loaded = Accounts.load({
      rows: options.rows ?? new AccountTable(database),
      secrets: this.#watching(options.secrets),
      renew: (refresh) => refreshGrant(web, refresh),
      fetch,
      urls: this.urls,
    }).then((accounts) => {
      if (this.#stopped) return accounts;
      this.#unsubscribe.push(
        accounts.onEvent((event) => this.#heard(event)),
        accounts.onChange(() => {
          this.#follow(accounts);
          this.#changed();
        }),
      );
      this.#follow(accounts);
      return accounts;
    });
    this.#loaded.catch((error: unknown) => log(`Lo couldn't read its accounts: ${String(error)}`));
  }

  async accounts(): Promise<AccountState[]> {
    const accounts = await this.#loaded;
    return accounts.accounts.map((account) => ({
      account,
      signedOut: accounts.signedOut(account.login),
      cantSave: this.#cantSave.has(account.login.toLowerCase()),
      needsKeyring: this.#needsKeyring.has(account.login.toLowerCase()),
    }));
  }

  async client(login: string): Promise<GithubClient> {
    return (await this.#loaded).client(login);
  }

  async poller(login: string): Promise<Poller> {
    await this.#loaded;
    const poller = this.#pollers.get(login.toLowerCase());
    if (!poller) throw new Error(`Lo isn't signed in to ${login}`);
    return poller;
  }

  async accountForRepo(repo: RepoRef): Promise<RepoAccount> {
    const accounts = await this.#loaded;
    return accounts.accountForRepo(repo, (login) =>
      this.#pollers.get(login.toLowerCase())?.queue.gate(),
    );
  }

  async rememberAccountForOwner(owner: string, login: string): Promise<void> {
    await (await this.#loaded).rememberAccountForOwner(owner, login);
  }

  async rememberAccountForRepo(repo: RepoRef, login: string): Promise<void> {
    await (await this.#loaded).rememberAccountForRepo(repo, login);
  }

  recent(limit?: number): RecentPull[] {
    return this.#cache.recent(limit);
  }

  forgetRecent(pull: PullRef): void {
    this.#cache.forgetRecent(pull);
  }

  clearAnswers(): void {
    this.#cache.clear();
  }

  onEvent(listener: (event: GithubEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Calls `listener` when an account is added, removed or signed out, or how one is changes. */
  onChange(listener: () => void): () => void {
    this.#observers.add(listener);
    return () => this.#observers.delete(listener);
  }

  /**
   * Adds an account with `grant`, or signs it in again, keeping the grant before the row. Throws
   * when either can't be kept, as when there's no keychain.
   */
  async add(user: AuthenticatedUser, grant: Grant, source: AccountSource): Promise<void> {
    await (await this.#loaded).add(user, grant, source);
  }

  /**
   * Adds the account whose token `file` holds, once GitHub says whose it is and that it has the
   * scopes Lo needs, for tests. The token is never repeated, in an error or anywhere else.
   */
  async addFromFile(file: string): Promise<void> {
    const token = new Token(await readFile(file, 'utf8'));
    const user = await checkToken({ fetch: this.#fetch, urls: this.urls }, token);
    await this.add(user, { token }, 'deviceFlow');
  }

  /**
   * Removes an account: its grant, its row and everything kept for it, and stops its poller. Other
   * features hear `removed`, and forget what they kept for it. Throws when its row can't be
   * removed, or when its grant couldn't be deleted, after removing the rest.
   */
  async remove(login: string): Promise<void> {
    const accounts = await this.#loaded;
    const account = accounts.account(login);
    if (!account) throw new Error(`Lo isn't signed in to ${login}`);
    try {
      await accounts.remove(account.login);
    } finally {
      if (!accounts.account(account.login)) {
        this.#cantSave.delete(account.login.toLowerCase());
        this.#needsKeyring.delete(account.login.toLowerCase());
        this.#emit({ kind: 'removed', login: account.login });
      }
    }
  }

  /** Says whether Lo is in the foreground: each poller polls faster while it is. */
  setForeground(foreground: boolean): void {
    this.#foreground = foreground;
    for (const poller of this.#pollers.values()) poller.setForeground(foreground);
  }

  /**
   * Stops every poller, then saves each renewed grant the keychain refused, and waits for renewals
   * GitHub is answering, to save what they bring: for `within` milliseconds at most, so the
   * database is still open for the last save. Run once, as Lo quits.
   */
  async stop(within: number): Promise<void> {
    // The limit counts from now, the accounts' loading included.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((resolve) => {
      timer = setTimeout(() => resolve('late'), within);
    });
    try {
      this.#stopped = true;
      for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
      for (const poller of this.#pollers.values()) poller.stop();
      this.#pollers.clear();
      const loaded = await Promise.race([this.#loaded.catch(() => undefined), late]);
      if (loaded === 'late') {
        this.#log(`the accounts were still loading after ${within} ms, so nothing was saved`);
        return;
      }
      const saving = loaded?.saveBeforeQuitting();
      if (!saving) return;
      const saved = await Promise.race([saving.then(() => 'saved' as const), late]);
      if (saved === 'late') {
        this.#log(`a renewal was still out after ${within} ms, so its token may not be saved`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * `secrets`, noting each account whose grant it refuses for want of a keychain
   * ({@link NoKeychain}), until it reads or keeps one for it again.
   */
  #watching(secrets: Secrets): Secrets {
    const noting = async <T>(login: string, run: () => Promise<T>): Promise<T> => {
      try {
        const value = await run();
        this.#noteKeyring(login, false);
        return value;
      } catch (error) {
        if (error instanceof NoKeychain) this.#noteKeyring(login, true);
        throw error;
      }
    };
    return {
      read: (login) => noting(login, () => secrets.read(login)),
      write: (login, grant) => noting(login, () => secrets.write(login, grant)),
      delete: (login) => secrets.delete(login),
    };
  }

  #noteKeyring(login: string, needed: boolean): void {
    const lower = login.toLowerCase();
    if (this.#needsKeyring.has(lower) === needed) return;
    if (needed) this.#needsKeyring.add(lower);
    else this.#needsKeyring.delete(lower);
    this.#changed();
  }

  /** Gives each account a poller, and stops the poller of each account that's gone. */
  #follow(accounts: Accounts): void {
    if (this.#stopped) return;
    const logins = new Set(accounts.accounts.map((account) => account.login.toLowerCase()));
    for (const [login, poller] of this.#pollers) {
      if (!logins.has(login)) {
        poller.stop();
        this.#pollers.delete(login);
      }
    }
    for (const { login } of accounts.accounts) {
      if (this.#pollers.has(login.toLowerCase())) continue;
      const poller = new Poller({
        accounts,
        login,
        cache: this.#cache,
        config: this.#poll,
        seen: (seenBy, pull, heads, at) => {
          // A poll that ends after its account was removed sees nothing anyone keeps.
          if (accounts.account(seenBy))
            this.#emit({ kind: 'seen', login: seenBy, pull, heads, at });
          return Promise.resolve();
        },
        log: (message) => this.#log(`polling as ${login}: ${message}`),
      });
      poller.setForeground(this.#foreground);
      this.#pollers.set(login.toLowerCase(), poller);
    }
  }

  #heard(event: AccountsEvent): void {
    const lower = event.login.toLowerCase();
    switch (event.kind) {
      case 'signedOut':
        this.#emit({ kind: 'signedOut', login: event.login, why: event.why });
        break;
      case 'cantSave':
        this.#cantSave.add(lower);
        this.#emit({ kind: 'cantSave', login: event.login });
        this.#changed();
        break;
      case 'cantSaveOver':
        this.#cantSave.delete(lower);
        this.#emit({ kind: 'cantSaveOver', login: event.login });
        this.#changed();
        break;
      default:
        throw new Error(
          `an accounts event Lo doesn't know: ${JSON.stringify(event satisfies never)}`,
        );
    }
  }

  #emit(event: GithubEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        this.#log(`a listener failed on ${event.kind}: ${String(error)}`);
      }
    }
  }

  #changed(): void {
    for (const observer of this.#observers) {
      try {
        observer();
      } catch (error) {
        this.#log(`a listener failed on a change to the accounts: ${String(error)}`);
      }
    }
  }
}

/** What the cache's rows are stamped with: this build of Lo, and the GitHub its answers are from. */
function stampOf(build: string, api: string): string {
  return createHash('sha256').update(`${build}\n${api}`).digest('hex').slice(0, 16);
}
