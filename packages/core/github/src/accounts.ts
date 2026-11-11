/**
 * The accounts Lo is signed in to: their rows and grants, signing them out, a client for each,
 * renewing the tokens that expire, and which account opens a repository.
 */

import {
  chooseAccount,
  chosenAccount,
  sameLogin,
  type AccountChoice,
  type Problem,
  type Remembered,
  type RepoAccount,
} from './choice.ts';
import { GithubClient, type GitHubUrls, type RequestGate } from './client.ts';
import { GithubError } from './errors.ts';
import { RenewalError, type Grant, type Secrets } from './grant.ts';
import { isRecord } from './graphql.ts';
import { RepoRef } from './refs.ts';
import type { Token } from './token.ts';
import type { AuthenticatedUser } from './user.ts';

/** How long before a token expires Lo renews it, in seconds. */
const RENEW_BEFORE = 5 * 60;
/**
 * The shortest wait before renewing a token by its clock, and the first wait after a renewal
 * GitHub couldn't answer, in seconds, so a token that lasts minutes, or a network that's down,
 * never makes Lo ask GitHub over and over. Each renewal GitHub can't answer doubles the wait, up
 * to {@link MAX_RENEW_GAP}.
 */
const RENEW_GAP = 60;
/** The longest wait between renewals GitHub couldn't answer, in seconds. */
const MAX_RENEW_GAP = 15 * 60;
/**
 * The first wait before saving a renewed token again after the store refused it, in seconds. It
 * doubles with each failed save, up to {@link MAX_SAVE_GAP}.
 */
const SAVE_GAP = 30;
/** The longest wait between saves of a renewed token, in seconds. */
const MAX_SAVE_GAP = 15 * 60;
/** How many saves of a renewed token fail before Lo tells the user (a `cantSave` event). */
const SAVES_BEFORE_TELLING = 2;
/** The longest wait `setTimeout` keeps, in milliseconds; longer ones fire at once. */
const MAX_TIMEOUT = 2 ** 31 - 1;

/** How an account signed in: through GitHub's device flow, or imported from the `gh` CLI. */
export type AccountSource = 'deviceFlow' | 'gh';

/** A signed-in account, as its row keeps it. */
export interface Account {
  login: string;
  userId: number;
  name?: string | undefined;
  avatarUrl?: string | undefined;
  /** The scopes GitHub said its token had when it signed in. */
  scopes: string[];
  source: AccountSource;
  /** When it was first added, in seconds since the Unix epoch. Signing in again keeps it. */
  addedAt: number;
}

/**
 * Where the accounts' rows are kept, with which of them GitHub refused and the account chosen for
 * each owner and repository: in the app, a database. Logins, owners and repository names match
 * ignoring case, as on GitHub.
 */
export interface AccountRows {
  /** Every account, oldest first, and those added in the same second by login. */
  accounts(): Promise<Account[]>;
  /** Keeps the account's row in place of the one with its login, and forgets that GitHub refused it. */
  save(account: Account): Promise<void>;
  /** Forgets the account's row, its refusal, and the owners and repositories it was chosen for. */
  delete(login: string): Promise<void>;
  /** The logins whose token GitHub refused, which stay signed out until they sign in again. */
  refused(): Promise<string[]>;
  /** Notes that GitHub refused the account's token, at `at`, in seconds since the Unix epoch. */
  setRefused(login: string, at: number): Promise<void>;
  /** The login chosen for an owner's repositories, if any. */
  ownerAccount(owner: string): Promise<string | undefined>;
  setOwnerAccount(owner: string, login: string): Promise<void>;
  /** The login chosen for one repository, if any, which wins over its owner's. */
  repoAccount(owner: string, name: string): Promise<string | undefined>;
  setRepoAccount(owner: string, name: string, login: string): Promise<void>;
}

export interface AccountsOptions {
  rows: AccountRows;
  /** Where each account's grant is kept, under its login in lower case. */
  secrets: Secrets;
  /** Asks GitHub for a new grant with a refresh token, throwing a {@link RenewalError} when it gives none. */
  renew: (refresh: Token) => Promise<Grant>;
  /** The `fetch` the accounts' clients send their requests through. */
  fetch: typeof globalThis.fetch;
  /** GitHub's addresses, if not github.com's. */
  urls?: Partial<GitHubUrls> | undefined;
  /** The time, in seconds since the Unix epoch: the computer's clock unless said otherwise. */
  now?: (() => number) | undefined;
  /**
   * Reads an account imported from `gh` from `gh` again, after GitHub refused its token: `gh`'s
   * token for the login, or nothing when `gh` has none, which signs the account out. It throws when
   * `gh` couldn't be asked, as when it timed out or Lo is quitting: the account stays signed in, and
   * `gh` is asked again after a wait, as for a renewal GitHub couldn't answer. `gh` renews its own
   * tokens, which last hours, so Lo asks it rather than renewing them. Without it, a `gh` account
   * GitHub refuses is signed out.
   */
  reread?: ((login: string) => Promise<Token | undefined>) | undefined;
}

/** Why an account is signed out: GitHub refused its token (a `401`), or its token isn't kept any more. */
export type SignedOut = 'refused' | 'tokenMissing';

/** What happened to an account, for whatever tells the user. */
export type AccountsEvent =
  /** The account was signed out. Sent once each time it's signed out. */
  | { kind: 'signedOut'; login: string; why: SignedOut }
  /**
   * The store keeps refusing the account's renewed token, as when the user denies Lo the
   * keychain. Lo uses the token all the same, and keeps trying to save it, but if Lo quits first,
   * the account is signed out. Sent once each time saving keeps failing.
   */
  | { kind: 'cantSave'; login: string }
  /**
   * What `cantSave` warned of is over: the store took the account's grant, or Lo took a newer one
   * from it, or the account was signed out or removed. Sent once for each `cantSave`.
   */
  | { kind: 'cantSaveOver'; login: string };

/** What Lo holds for an account: the grant its client uses, which grant it is, and whether the store has it. */
interface Held {
  grant: Grant;
  /** Which grant held for an account it is, so a renewal or a save can tell it was replaced meanwhile. */
  id: number;
  /**
   * Whether the store has it. A renewal's new pair is used even when the store refuses it, since
   * GitHub has revoked the old one by then, and Lo holds it here and saves it again until the
   * store takes it, and once more as Lo quits.
   */
  saved: boolean;
}

/** A renewal GitHub couldn't answer: renewing `token` again waits until `until`, in seconds since the Unix epoch. */
interface Backoff {
  token: Token;
  until: number;
  /** How long it waited, in seconds. */
  wait: number;
}

/** Why a token is being replaced: GitHub refused it, or it expires within {@link RENEW_BEFORE}. */
type Renewing = 'refused' | 'expiring';

/** What renewing a token got. */
type Renewed =
  /** A new pair GitHub issued, and whether the store took it. */
  | { kind: 'issued'; grant: Grant; saved: boolean }
  /** A grant another Lo process renewed or signed in with since, read from the store. */
  | { kind: 'stored'; grant: Grant }
  /** The account was removed, or signed in again, while GitHub answered, so the new pair wasn't stored or used. */
  | { kind: 'replaced' }
  /** GitHub refused the refresh token, or the grant is gone from the store: the account has to sign in again. */
  | { kind: 'refused' }
  /** The token doesn't expire, so nothing renews it. */
  | { kind: 'noRefreshToken' }
  /** GitHub, or the store, couldn't be asked. The refresh token may still work. With when the token expires. */
  | { kind: 'failed'; expiresAt: number | undefined }
  /** A newer token read from `gh` again, and whether the store took it. */
  | { kind: 'reread'; grant: Grant; saved: boolean };

/** A wait that can be called off. */
interface Timer {
  cancel(): void;
}

/** One account's check of a repository: the error GitHub answered with, or nothing and what GitHub calls it now. */
interface Check {
  login: string;
  error?: GithubError | undefined;
  repo?: RepoRef | undefined;
}

/**
 * Every account Lo is signed in to. Listeners hear of what happens to them
 * ({@link Accounts.onEvent}) and of any change to the list ({@link Accounts.onChange}).
 *
 * Each account's grant is kept whole in {@link AccountsOptions.secrets}, under its login in lower
 * case. Its client handles a `401` itself: GitHub refusing a token renews it, if it's one that
 * expires, or reads it from `gh` once more, for an account imported from it, and otherwise signs
 * the account out ({@link Accounts.refused}). A token that expires is also renewed shortly before
 * it does.
 */
export class Accounts {
  readonly #rows: AccountRows;
  readonly #secrets: Secrets;
  readonly #renewGrant: (refresh: Token) => Promise<Grant>;
  readonly #reread: ((login: string) => Promise<Token | undefined>) | undefined;
  readonly #fetch: typeof globalThis.fetch;
  readonly #urls: Partial<GitHubUrls> | undefined;
  readonly #now: () => number;
  #accounts: Account[];
  /** Why each account is signed out, by lowercased login. */
  readonly #signedOut = new Map<string, SignedOut>();
  /** The client for each account whose grant has been read, by lowercased login. */
  readonly #clients = new Map<string, GithubClient>();
  /** The wait until each account's token is renewed before it expires, by lowercased login. */
  readonly #renewals = new Map<string, Timer>();
  /** The grant Lo holds for each account it has read or been given one for, by lowercased login. */
  readonly #held = new Map<string, Held>();
  /** Counts the grants put in `#held`, to number them. */
  #heldCount = 0;
  /**
   * The renewal running for each account, by lowercased login. Renewing an account's token waits
   * for it, so a token is renewed once however many ask, while other accounts' renewals go ahead.
   */
  readonly #renewing = new Map<string, Promise<Token | undefined>>();
  /** Renewals GitHub couldn't answer, by lowercased login. */
  readonly #backoffs = new Map<string, Backoff>();
  /**
   * The last turn at writing or deleting each account's grant, by lowercased login, so that
   * whoever writes checks first that nothing replaced or removed the grant it writes.
   */
  readonly #writes = new Map<string, Promise<void>>();
  /** Accounts removed since they were last added, by lowercased login, so a renewal that ends after the removal leaves nothing behind. */
  readonly #removed = new Set<string>();
  /** Accounts Lo told the user it can't save a renewed token for, by lowercased login, until a save works. */
  readonly #cantSave = new Set<string>();
  readonly #listeners = new Set<(event: AccountsEvent) => void>();
  readonly #observers = new Set<() => void>();

  private constructor(options: AccountsOptions, accounts: Account[], refused: string[]) {
    this.#rows = options.rows;
    this.#secrets = options.secrets;
    this.#renewGrant = options.renew;
    this.#reread = options.reread;
    this.#fetch = options.fetch;
    this.#urls = options.urls;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.#accounts = accounts;
    // Accounts GitHub refused before stay signed out, without reading their grants.
    for (const login of refused) this.#signedOut.set(key(login), 'refused');
  }

  /** Reads the accounts from their rows. */
  static async load(options: AccountsOptions): Promise<Accounts> {
    const [accounts, refused] = await Promise.all([
      options.rows.accounts(),
      options.rows.refused(),
    ]);
    return new Accounts(options, accounts, refused);
  }

  /** Calls `listener` with what happens to each account, until the returned function is called. */
  onEvent(listener: (event: AccountsEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Calls `listener` when an account is added, removed or signed out, until the returned function is called. */
  onChange(listener: () => void): () => void {
    this.#observers.add(listener);
    return () => this.#observers.delete(listener);
  }

  /** The accounts, oldest first, and those added in the same second by login. */
  get accounts(): readonly Account[] {
    return this.#accounts;
  }

  /** The account whose login is `login`, in any case. */
  account(login: string): Account | undefined {
    return this.#accounts.find((account) => sameLogin(account.login, login));
  }

  isSignedOut(login: string): boolean {
    return this.#signedOut.has(key(login));
  }

  /** Why the account is signed out, if it is. */
  signedOut(login: string): SignedOut | undefined {
    return this.#signedOut.get(key(login));
  }

  /**
   * Keeps the grant and adds the account, replacing any account with the same login and signing
   * it in again if it was signed out. The grant and the row are both written or, when the row
   * can't be written for a new account, neither.
   */
  async add(user: AuthenticatedUser, grant: Grant, source: AccountSource): Promise<Account> {
    const existing = this.account(user.user.login);
    const account: Account = {
      login: user.user.login,
      userId: user.user.id,
      name: user.user.name ?? undefined,
      avatarUrl: user.user.avatar_url ?? undefined,
      scopes: [...user.scopes],
      source,
      addedAt: existing?.addedAt ?? this.#now(),
    };
    const login = key(account.login);
    this.#removed.delete(login);
    // A renewal running meanwhile stores nothing over the new grant.
    return this.#locked(login, async () => {
      try {
        await this.#secrets.write(login, grant);
      } catch (error) {
        throw new Error(`storing the token: ${describeError(error)}`, { cause: error });
      }
      try {
        await this.#rows.save(account);
      } catch (error) {
        // A login Lo already had keeps its row, which the new grant still fits.
        if (!existing) await this.#secrets.delete(login).catch(() => undefined);
        throw new Error(`saving the account: ${describeError(error)}`, { cause: error });
      }
      this.#accounts = [
        ...this.#accounts.filter((each) => key(each.login) !== login),
        account,
      ].toSorted(byAdded);
      this.#signedOut.delete(login);
      this.#backoffs.delete(login);
      this.#hold(login, grant, true);
      this.#cantSaveOver(account.login);
      // The account's client switches to the new token, and so does every client sharing it,
      // including any handed out before a sign-out.
      const client = this.#clients.get(login);
      if (client) client.setToken(grant.token);
      else this.#clients.set(login, this.#newClient(account.login, grant.token));
      this.#renewBy(account.login, expiryToRenew(account, grant));
      this.#changed();
      return account;
    });
  }

  /**
   * Deletes the account's grant and forgets the account. The account is forgotten even when its
   * grant can't be deleted; the error then says the token is left. A renewal of its token that's
   * running stores nothing: it waits for the grant to be deleted, then finds the account gone.
   */
  async remove(login: string): Promise<void> {
    const lower = key(login);
    this.#removed.add(lower);
    this.#held.delete(lower);
    this.#cancelRenewal(lower);
    this.#backoffs.delete(lower);
    this.#cantSaveOver(login);
    const left = await this.#locked(lower, async () => {
      try {
        await this.#secrets.delete(lower);
        return undefined;
      } catch (error) {
        return { error };
      }
    });
    try {
      await this.#rows.delete(login);
    } catch (error) {
      throw new Error(`removing the account: ${describeError(error)}`, { cause: error });
    }
    this.#accounts = this.#accounts.filter((account) => key(account.login) !== lower);
    this.#signedOut.delete(lower);
    this.#clients.delete(lower);
    this.#cancelRenewal(lower);
    this.#changed();
    if (left !== undefined) {
      const message = `removed ${login}, but couldn't delete its token: ${describeError(left.error)}`;
      throw new Error(message, { cause: left.error });
    }
  }

  /**
   * Marks an account signed out: its token was refused, or is missing. Its tabs ask the user to
   * sign in again; other accounts keep working. Tells listeners once, not again while it stays
   * signed out for the same reason.
   *
   * Its client stays, though {@link Accounts.client} hands it out no more, so that whatever holds
   * it takes the token of a sign-in again ({@link Accounts.add}).
   */
  markSignedOut(login: string, why: SignedOut): void {
    const lower = key(login);
    this.#cancelRenewal(lower);
    this.#held.delete(lower);
    this.#backoffs.delete(lower);
    this.#cantSaveOver(login);
    if (this.#signedOut.get(lower) === why) return;
    this.#signedOut.set(lower, why);
    this.#emit({ kind: 'signedOut', login: this.#display(login), why });
    this.#changed();
  }

  /**
   * GitHub refused `token`, the account's token: the token to try again with, or nothing.
   *
   * Every client {@link Accounts.client} hands out calls this on a `401`. A token that has been
   * replaced since, by signing in again, by an earlier call or by another Lo process, is answered
   * with the new one. A token that expires is renewed with its refresh token. An account imported
   * from `gh` gets its token from `gh` once more ({@link AccountsOptions.reread}), since `gh`'s
   * tokens expire within hours and `gh` renews them. If none of that gives a token, the account is
   * signed out, and its grant deleted. If GitHub couldn't be asked for a renewal, the account
   * stays signed in, and a later refusal asks again, after a wait that grows each time GitHub
   * can't be asked.
   */
  refused(login: string, token: Token): Promise<Token | undefined> {
    return this.#renew(login, token, 'refused');
  }

  /**
   * A client for the account, reading its grant from the store the first time. A token that
   * expires is renewed shortly before it does, from then on. Throws a {@link GithubError}:
   * `unauthorized` for an account that's signed out, or unknown, or whose grant is missing, which
   * signs it out; `tokenUnavailable` when its grant can't be read just now.
   */
  async client(login: string): Promise<GithubClient> {
    const lower = key(login);
    if (this.#signedOut.has(lower)) {
      throw new GithubError({
        kind: 'unauthorized',
        message: `${this.#display(login)} is signed out`,
      });
    }
    const existing = this.#clients.get(lower);
    if (existing) return existing;
    const account = this.account(login);
    if (!account) {
      throw new GithubError({ kind: 'unauthorized', message: `Lo isn't signed in to ${login}` });
    }
    let stored: Grant | undefined;
    try {
      stored = await this.#secrets.read(lower);
    } catch (error) {
      if (!unusable(error)) {
        throw new GithubError(
          { kind: 'tokenUnavailable', message: describeError(error) },
          { cause: error },
        );
      }
      // A kept token that can never work, such as one garbled on disk, is no token at all.
      stored = undefined;
    }
    if (stored === undefined) {
      this.markSignedOut(account.login, 'tokenMissing');
      throw new GithubError({
        kind: 'unauthorized',
        message: `${account.login}'s token is missing`,
      });
    }
    const made = this.#clients.get(lower);
    if (made) return made;
    // What Lo holds wins over the store, which may lack a renewal it refused.
    const { grant } = this.#held.get(lower) ?? this.#hold(lower, stored, true);
    const client = this.#newClient(account.login, grant.token);
    this.#clients.set(lower, client);
    this.#renewBy(account.login, expiryToRenew(account, grant));
    return client;
  }

  /**
   * Picks the account to open `repo` with: the one that can see it; if several can, the one
   * remembered for it, its own before its owner's; else ask. The accounts are checked at once,
   * each waiting at its gate when `gateFor` gives one (its poller's queue, so a check waits behind
   * that account's polls rather than adding to them).
   *
   * The choices are read under the name GitHub gives the repository now, from its `full_name`, so
   * a link to a renamed or transferred repository uses its current owner's choice.
   *
   * Only GitHub's "not found" counts as an account not seeing the repository; any other answer is
   * a problem to show. An account whose check got no answer might see it, so unless the chosen
   * account can see it, the check fails with the network error that says most plainly GitHub
   * can't be reached, whatever the accounts' order, to try again later. The remembered account is
   * never swapped for another: if it's signed out, its token can't be read or GitHub gave it any
   * answer but yes or "not found", the choice is `unavailable`, with a problem that says why.
   */
  async accountForRepo(
    repo: RepoRef,
    gateFor?: (login: string) => RequestGate | undefined,
  ): Promise<RepoAccount> {
    if (!isRepoName(repo.owner, repo.name)) {
      throw new Error(`${repo.toString()} isn't a GitHub repository`);
    }
    const path = `/repos/${repo.owner}/${repo.name}`;
    const logins = this.#accounts
      .map((account) => account.login)
      .filter((login) => !this.isSignedOut(login));
    const checks = await Promise.all(
      logins.map((login) => this.#check(login, path, gateFor?.(login))),
    );
    const current = checks.find((check) => check.repo !== undefined)?.repo ?? repo;
    const remembered = await this.remembered(current);
    const chosen = chosenAccount(remembered);
    const isChosen = (login: string) => chosen !== undefined && sameLogin(chosen, login);
    const visible: string[] = [];
    const problems: Problem[] = [];
    const unanswered: Problem[] = [];
    for (const check of checks) {
      const { login, error } = check;
      if (error === undefined) {
        visible.push(login);
      } else if (error.detail.kind === 'network') {
        unanswered.push({ login, error });
      } else if (
        error.detail.kind !== 'notFound' &&
        // A missing token signed the account out, as signing out before the check would have, so
        // it doesn't count as checked; unless it's the chosen one.
        !(error.detail.kind === 'tokenUnavailable' && this.isSignedOut(login) && !isChosen(login))
      ) {
        // A refused token has signed the account out (see `refused`).
        problems.push({ login, error });
      }
    }
    // A signed-out account isn't checked, so the chosen one is a problem by itself.
    if (
      chosen !== undefined &&
      this.isSignedOut(chosen) &&
      !problems.some((p) => isChosen(p.login))
    ) {
      problems.push({
        login: chosen,
        error: new GithubError({
          kind: 'unauthorized',
          message: `${chosen} is signed out; sign in to it again`,
        }),
      });
    }
    const unavailable = problems.find((problem) => isChosen(problem.login));
    let choice: AccountChoice;
    if (unavailable) {
      choice = { kind: 'unavailable', login: unavailable.login };
    } else {
      // An account that got no answer might see the repository, which could change the choice,
      // unless the chosen account can see it: so it isn't made yet, and the check fails to be
      // tried again, never quietly opening as another account.
      const [first, ...rest] = unanswered;
      if (first !== undefined && !visible.some(isChosen)) {
        throw noAnswer([first, ...rest], checks.length);
      }
      choice = chooseAccount(visible, remembered);
    }
    return { repo: current, choice, visible, remembered, problems };
  }

  /**
   * The accounts remembered for `repo`: its own and its owner's. An account that's since been
   * removed isn't remembered any more.
   */
  async remembered(repo: RepoRef): Promise<Remembered> {
    const [forRepo, forOwner] = await Promise.all([
      this.#rows.repoAccount(repo.owner, repo.name),
      this.#rows.ownerAccount(repo.owner),
    ]);
    return { repo: this.#present(forRepo), owner: this.#present(forOwner) };
  }

  /**
   * The account remembered for `owner`'s repositories, by its login. An account that's since been
   * removed isn't remembered any more.
   */
  async rememberedAccount(owner: string): Promise<string | undefined> {
    return this.#present(await this.#rows.ownerAccount(owner));
  }

  /** Remembers the account to use for an owner's repositories. */
  rememberAccountForOwner(owner: string, login: string): Promise<void> {
    return this.#rows.setOwnerAccount(owner, login);
  }

  /**
   * Remembers the account to use for one repository, whose owner's account can't see it. The
   * owner's choice stays for its other repositories.
   */
  rememberAccountForRepo(repo: RepoRef, login: string): Promise<void> {
    return this.#rows.setRepoAccount(repo.owner, repo.name, login);
  }

  /**
   * Stores once more each renewed grant the store refused, as Lo quits, since nothing else holds
   * it, then lets each renewal that's out finish, since GitHub revokes the old pair as it answers,
   * and stores what it got if the store refused that too. Each is whatever the account holds once
   * its turn to write comes, so never an older pair over a renewal's. Nothing when there's nothing
   * to store or wait for.
   */
  saveBeforeQuitting(): Promise<void> | undefined {
    const renewing = [...this.#renewing.values()];
    if (renewing.length === 0 && [...this.#held.values()].every((held) => held.saved)) {
      return undefined;
    }
    return (async () => {
      // Before the renewals, which may not get an answer in time.
      await this.#saveUnsaved();
      await Promise.allSettled(renewing);
      await this.#saveUnsaved();
    })();
  }

  /** A client for the account, whose refused tokens come back to {@link Accounts.refused}. */
  #newClient(login: string, token: Token): GithubClient {
    return new GithubClient({
      fetch: this.#fetch,
      token,
      urls: this.#urls,
      onUnauthorized: (refused) => this.#renew(login, refused, 'refused'),
    });
  }

  /** Checks whether the account can see the repository at `path`. */
  async #check(login: string, path: string, gate: RequestGate | undefined): Promise<Check> {
    let client: GithubClient;
    try {
      client = await this.client(login);
    } catch (error) {
      const unavailable =
        error instanceof GithubError && error.detail.kind === 'tokenUnavailable'
          ? error
          : new GithubError(
              { kind: 'tokenUnavailable', message: describeError(error) },
              { cause: error },
            );
      return { login, error: unavailable };
    }
    try {
      return { login, repo: await (gate ? client.gated(gate) : client).get(path, readFullName) };
    } catch (error) {
      if (error instanceof GithubError) return { login, error };
      throw error;
    }
  }

  /** The login of the account `login` names, as GitHub spells it, or nothing for an account that's gone. */
  #present(login: string | undefined): string | undefined {
    return login === undefined ? undefined : this.account(login)?.login;
  }

  /** The account's login as GitHub spells it, for `login` in any case. */
  #display(login: string): string {
    return this.account(login)?.login ?? login;
  }

  #emit(event: AccountsEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  #changed(): void {
    for (const observer of this.#observers) observer();
  }

  /** Holds `grant` for the account, in place of what it held. */
  #hold(login: string, grant: Grant, saved: boolean): Held {
    this.#heldCount += 1;
    const held: Held = { grant, id: this.#heldCount, saved };
    this.#held.set(key(login), held);
    return held;
  }

  /** Whether held grant `id` is still the account's: nothing replaced it, a sign-in or a renewal, and the account wasn't removed. */
  #isCurrent(login: string, id: number | undefined): boolean {
    return this.#held.get(key(login))?.id === id && !this.#removed.has(key(login));
  }

  /** Runs `run` in the account's turn at writing its grant, once every earlier turn is over. */
  async #locked<T>(login: string, run: () => Promise<T>): Promise<T> {
    const lower = key(login);
    const earlier = this.#writes.get(lower) ?? Promise.resolve();
    const { promise: done, resolve: finish } = Promise.withResolvers<void>();
    this.#writes.set(lower, done);
    await earlier;
    try {
      return await run();
    } finally {
      finish();
      if (this.#writes.get(lower) === done) this.#writes.delete(lower);
    }
  }

  /**
   * Replaces `token`, the account's token, because GitHub refused it or it expires soon. An
   * expiring token that can't be renewed is used until GitHub refuses it, and while GitHub can't
   * be asked, renewing it is tried again later, until it expires.
   *
   * An account's renewals run one at a time: one asked for while another runs waits for it, then
   * usually just takes the token it got. Other accounts' renewals don't wait.
   */
  async #renew(login: string, token: Token, why: Renewing): Promise<Token | undefined> {
    const account = this.account(login);
    const lower = key(login);
    if (!account || this.isSignedOut(login) || this.#removed.has(lower)) return undefined;
    const current = this.#clients.get(lower)?.token;
    if (current !== undefined && !current.equals(token)) return current;
    const running = this.#renewing.get(lower);
    if (running) {
      await running;
      if (this.#renewing.get(lower) === running) this.#renewing.delete(lower);
      return this.#renew(account.login, token, why);
    }
    // GitHub couldn't renew this token a moment ago, so it isn't asked again yet.
    const backoff = this.#backoffs.get(lower);
    if (backoff?.token.equals(token)) {
      const left = backoff.until - this.#now();
      if (left > 0) {
        if (why === 'expiring') this.#renewAfter(account.login, left);
        return undefined;
      }
    }
    let renewal: Promise<Token | undefined>;
    if (account.source === 'gh') {
      // gh renews its own tokens, and Lo never uses a refresh token of gh's.
      if (why === 'expiring') return undefined;
      renewal = this.#rereadFromGh(account.login, token);
    } else {
      renewal = this.#renewWithRefresh(account.login, token, why);
    }
    this.#renewing.set(lower, renewal);
    try {
      return await renewal;
    } finally {
      if (this.#renewing.get(lower) === renewal) this.#renewing.delete(lower);
    }
  }

  /**
   * Renews `stale`, the account's token, with its refresh token, and stores the new pair before
   * anything uses it, unless the account was removed or signed in again meanwhile.
   */
  async #renewWithRefresh(login: string, stale: Token, why: Renewing): Promise<Token | undefined> {
    const held = this.#held.get(key(login));
    const id = held?.id;
    const answer = await this.#ask(login, stale, held && { grant: held.grant, saved: held.saved });
    if (answer.kind !== 'new') return this.#renewed(login, stale, why, id, answer);
    // A new pair is stored, then held, in the account's turn at writing, so whatever writes the
    // account's grant next, such as a save of the grant the pair replaces, finds the pair held.
    return this.#locked(login, async () => {
      if (!this.#isCurrent(login, id)) {
        return this.#renewed(login, stale, why, id, { kind: 'replaced' });
      }
      const saved = await this.#secrets.write(key(login), answer.grant).then(
        () => true,
        () => false,
      );
      return this.#renewed(login, stale, why, id, { kind: 'issued', grant: answer.grant, saved });
    });
  }

  /**
   * Reads `stale`, a `gh` account's token, from `gh` again, after GitHub refused it, and stores a
   * newer one before anything uses it, unless the account was removed or signed in again
   * meanwhile. The account is signed out when `gh` has nothing newer, and left signed in, to ask
   * again later, when `gh` couldn't be asked.
   */
  async #rereadFromGh(login: string, stale: Token): Promise<Token | undefined> {
    const id = this.#held.get(key(login))?.id;
    let token: Token | undefined;
    try {
      token = await this.#reread?.(login);
    } catch {
      return this.#renewed(login, stale, 'refused', id, { kind: 'failed', expiresAt: undefined });
    }
    if (token === undefined || token.isEmpty || token.equals(stale)) {
      return this.#renewed(login, stale, 'refused', id, { kind: 'refused' });
    }
    const grant: Grant = { token };
    return this.#locked(login, async () => {
      if (!this.#isCurrent(login, id)) {
        return this.#renewed(login, stale, 'refused', id, { kind: 'replaced' });
      }
      const saved = await this.#secrets.write(key(login), grant).then(
        () => true,
        () => false,
      );
      return this.#renewed(login, stale, 'refused', id, { kind: 'reread', grant, saved });
    });
  }

  /**
   * Asks for a new token for `stale`, the account's token. Lo holds its grant as `held`, with
   * whether the store has it. The refresh token Lo holds renews it, else the one stored, and the
   * caller stores the new pair. If the store holds a newer grant by now ({@link isNewer}), which
   * another Lo process renewed or signed in with, that one is used instead, without asking
   * GitHub.
   *
   * A held pair the store never took is renewed without reading the store first. It was renewed
   * from what the store holds, so nothing there is newer, and a store that can't be read just
   * then doesn't stop a renewal Lo can do.
   */
  async #ask(
    login: string,
    stale: Token,
    held: { grant: Grant; saved: boolean } | undefined,
  ): Promise<Renewed | { kind: 'new'; grant: Grant }> {
    const lower = key(login);
    const heldGrant: Grant = held?.grant ?? { token: stale };
    let refresh = held?.saved === false ? heldGrant.refresh : undefined;
    if (refresh === undefined) {
      let stored: Grant | undefined;
      try {
        stored = await this.#secrets.read(lower);
      } catch (error) {
        // A kept token that can never work is refused, as GitHub refuses a bad one.
        if (unusable(error)) return { kind: 'refused' };
        return { kind: 'failed', expiresAt: heldGrant.refresh?.expiresAt };
      }
      // Signed out by another Lo process.
      if (stored === undefined) return { kind: 'refused' };
      if (isNewer(stored, heldGrant)) return { kind: 'stored', grant: stored };
      refresh = heldGrant.refresh ?? stored.refresh;
      if (refresh === undefined) return { kind: 'noRefreshToken' };
    }
    try {
      return { kind: 'new', grant: await this.#renewGrant(refresh.token) };
    } catch (error) {
      if (!(error instanceof RenewalError && error.kind === 'refused')) {
        return { kind: 'failed', expiresAt: refresh.expiresAt };
      }
    }
    // Another Lo process may have used the refresh token first, storing a new pair, or signed in
    // again meanwhile.
    const newer = await this.#secrets.read(lower).catch(() => undefined);
    const renewedSince =
      newer !== undefined &&
      !newer.token.equals(stale) &&
      (newer.refresh === undefined ||
        (!newer.refresh.token.equals(refresh.token) &&
          (newer.refresh.issuedAt ?? 0) >= (refresh.issuedAt ?? 0)));
    return renewedSince ? { kind: 'stored', grant: newer } : { kind: 'refused' };
  }

  /**
   * Acts on what renewing `stale`, the account's token, got, starting from held grant `id`: the
   * client switches to a new token and the next renewal is set, or the account is signed out, or
   * renewing is tried again later.
   */
  async #renewed(
    login: string,
    stale: Token,
    why: Renewing,
    id: number | undefined,
    renewed: Renewed,
  ): Promise<Token | undefined> {
    const lower = key(login);
    // A sign-in or a removal replaced the grant meanwhile, which decides whatever GitHub said:
    // the client uses what replaced it, and nothing is signed out, held or set.
    if (!this.#isCurrent(login, id)) {
      const current = this.#clients.get(lower)?.token;
      return current?.equals(stale) === false ? current : undefined;
    }
    switch (renewed.kind) {
      case 'replaced':
        return undefined;
      case 'issued': {
        if (renewed.saved) this.#cantSaveOver(login);
        const held = this.#hold(login, renewed.grant, renewed.saved);
        // The old pair doesn't work any more, so the new one is used all the same, and saved later.
        if (!renewed.saved) this.#saveFailed(login, held.id, 1);
        return this.#use(login, renewed.grant);
      }
      case 'reread':
        // gh holds the token too, and gives it again at the next refusal, so a token the store
        // refused is saved again only as Lo quits, not on a timer, and nothing warns about it.
        this.#hold(login, renewed.grant, renewed.saved);
        if (renewed.saved) this.#cantSaveOver(login);
        return this.#use(login, renewed.grant);
      case 'stored':
        this.#hold(login, renewed.grant, true);
        this.#cantSaveOver(login);
        return this.#use(login, renewed.grant);
      case 'refused':
      case 'noRefreshToken':
        // A token that's only expiring may still work: GitHub refusing it decides.
        if (why === 'refused') await this.#signOutRefused(login, stale);
        return undefined;
      case 'failed': {
        const backoff = this.#backoffs.get(lower);
        const wait = backoff?.token.equals(stale)
          ? Math.min(backoff.wait * 2, MAX_RENEW_GAP)
          : RENEW_GAP;
        this.#backoffs.set(lower, { token: stale, until: this.#now() + wait, wait });
        // Past its expiry, a request's refusal asks again.
        const { expiresAt } = renewed;
        if (why === 'expiring' && (expiresAt === undefined || this.#now() < expiresAt)) {
          this.#renewAfter(login, wait);
        }
        return undefined;
      }
      default:
        throw new Error(`a renewal Lo doesn't know: ${JSON.stringify(renewed satisfies never)}`);
    }
  }

  /** Switches the account's client to `grant`'s token, and sets its next renewal. */
  #use(login: string, grant: Grant): Token {
    this.#backoffs.delete(key(login));
    this.#clients.get(key(login))?.setToken(grant.token);
    const account = this.account(login);
    this.#renewBy(login, account && expiryToRenew(account, grant));
    return grant.token;
  }

  /**
   * Signs the account out because GitHub refused `refused`, its token: deletes its grant, unless
   * the store holds a newer one ({@link isNewer}), and notes the refusal, so the account shows as
   * signed out after a restart too. When the store can't be read, it's left as it is, since it may
   * hold a newer grant. The account's row, and everything kept for it, stay for when it signs in
   * again.
   */
  async #signOutRefused(login: string, refused: Token): Promise<void> {
    if (this.signedOut(login) === 'refused') return;
    const lower = key(login);
    // What was refused, with its refresh token, to tell a newer grant from it.
    const held = this.#held.get(lower)?.grant;
    const refusedGrant = held?.token.equals(refused) ? held : { token: refused };
    this.markSignedOut(login, 'refused');
    // The turn at writing keeps this process's writes out from the read to the delete, but not
    // another Lo process's. A pair its renewal writes in between is deleted with the refused one,
    // and one it writes after is left beside a row that says the account was refused. Either way
    // the account is signed out at that Lo's next refusal or launch, and the user signs in again.
    // It takes two Lo processes sharing one store, and a write slow or refused just then.
    await this.#locked(lower, async () => {
      let stored: Grant | undefined;
      try {
        stored = await this.#secrets.read(lower);
      } catch {
        return;
      }
      if (stored !== undefined) {
        if (isNewer(stored, refusedGrant)) return;
        await this.#secrets.delete(lower).catch(() => undefined);
      }
      await this.#rows.setRefused(login, this.#now()).catch(() => undefined);
    });
  }

  /** Renews the account's token at `expiresAt` less {@link RENEW_BEFORE}, or, for nothing, never. Replaces any earlier wait. */
  #renewBy(login: string, expiresAt: number | undefined): void {
    if (expiresAt === undefined) {
      this.#cancelRenewal(key(login));
      return;
    }
    this.#renewAfter(login, Math.max(expiresAt - RENEW_BEFORE - this.#now(), 0));
  }

  /** Renews the account's token after `wait` seconds, or {@link RENEW_GAP} if that's longer. Replaces any earlier wait. */
  #renewAfter(login: string, wait: number): void {
    const lower = key(login);
    this.#cancelRenewal(lower);
    const timer = after(Math.max(wait, RENEW_GAP), () => {
      if (this.#renewals.get(lower) === timer) this.#renewals.delete(lower);
      const token = this.#clients.get(lower)?.token;
      if (token !== undefined) void this.#renew(login, token, 'expiring');
    });
    this.#renewals.set(lower, timer);
  }

  #cancelRenewal(lower: string): void {
    this.#renewals.get(lower)?.cancel();
    this.#renewals.delete(lower);
  }

  /**
   * The store refused held grant `id`, the account's renewed token, `failures` times in a row:
   * tries again later, waiting longer each time, and tells the user once it keeps failing.
   */
  #saveFailed(login: string, id: number, failures: number): void {
    const held = this.#held.get(key(login));
    // Unless a sign-in, a renewal, a sign-out or a removal replaced it while it was written.
    if (held?.id !== id || held.saved) return;
    if (failures === SAVES_BEFORE_TELLING) {
      this.#cantSave.add(key(login));
      this.#emit({ kind: 'cantSave', login: this.#display(login) });
    }
    const wait = Math.min(SAVE_GAP * 2 ** Math.min(failures - 1, 16), MAX_SAVE_GAP);
    after(wait, () => {
      void this.#saveHeld(login, id).then((saved) => {
        if (saved === false) this.#saveFailed(login, id, failures + 1);
      });
    });
  }

  /**
   * Stores the grant Lo holds for the account, which the store refused before: held grant `id`,
   * or for nothing, whichever it holds by then. It's checked, and stored, in the account's turn at
   * writing, so it's never an older grant than one stored meanwhile. Whether the store took it,
   * or nothing when there's nothing to store: a sign-in, a renewal or a removal replaced it, or
   * it's stored.
   */
  async #saveHeld(login: string, id: number | undefined): Promise<boolean | undefined> {
    const lower = key(login);
    return this.#locked(lower, async () => {
      const held = this.#held.get(lower);
      if (held === undefined || held.saved || (id !== undefined && held.id !== id))
        return undefined;
      try {
        await this.#secrets.write(lower, held.grant);
      } catch {
        return false;
      }
      if (this.#held.get(lower)?.id === held.id) held.saved = true;
      this.#cantSaveOver(login);
      return true;
    });
  }

  /** Stores each renewed grant the store refused ({@link Accounts.saveBeforeQuitting}). */
  async #saveUnsaved(): Promise<void> {
    const unsaved = [...this.#held].filter(([, held]) => !held.saved).map(([login]) => login);
    await Promise.all(unsaved.map((login) => this.#saveHeld(this.#display(login), undefined)));
  }

  /** The store has the account's grant, or nothing is left to save: if Lo told the user it couldn't save it, it says that's over. */
  #cantSaveOver(login: string): void {
    if (this.#cantSave.delete(key(login))) {
      this.#emit({ kind: 'cantSaveOver', login: this.#display(login) });
    }
  }
}

/** The key an account's state is kept under: its login in lower case, since GitHub's logins ignore case. */
function key(login: string): string {
  return login.toLowerCase();
}

/** When the account's token expires, to renew it before then: never for one from `gh`, which renews its own. */
function expiryToRenew(account: Account, grant: Grant): number | undefined {
  return account.source === 'gh' ? undefined : grant.refresh?.expiresAt;
}

/** Orders accounts by when they were added, then by login ignoring case. */
function byAdded(a: Account, b: Account): number {
  if (a.addedAt !== b.addedAt) return a.addedAt - b.addedAt;
  const [x, y] = [key(a.login), key(b.login)];
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Whether `stored`, read from the store, is newer than `held`, which Lo holds: renewed by another
 * Lo process, or a sign-in since. Of two pairs, the one GitHub issued later is newer, so a pair
 * Lo couldn't save is never swapped for the older one still stored. A token without a pair, on
 * either side, never changes but by signing in, so a different one is newer.
 */
function isNewer(stored: Grant, held: Grant): boolean {
  if (stored.token.equals(held.token)) return false;
  if (stored.refresh && held.refresh) {
    return (stored.refresh.issuedAt ?? 0) > (held.refresh.issuedAt ?? 0);
  }
  return true;
}

/** Runs `run` after `seconds`, waiting in steps `setTimeout` keeps for a wait longer than it can. */
function after(seconds: number, run: () => void): Timer {
  let left = seconds * 1000;
  let handle: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    const wait = Math.min(left, MAX_TIMEOUT);
    left -= wait;
    handle = setTimeout(() => {
      if (left > 0) arm();
      else run();
    }, wait);
  };
  arm();
  return { cancel: () => clearTimeout(handle) };
}

/**
 * The error for accounts whose checks got no answer, out of `checked` accounts checked: the one
 * that says most plainly that GitHub can't be reached, whichever account it was, and which account
 * it was when others got an answer.
 */
function noAnswer(unanswered: [Problem, ...Problem[]], checked: number): Error {
  const plainest =
    unanswered.find(({ error }) => error.isUnreachable()) ??
    unanswered.find(({ error }) => error.isRetryable()) ??
    unanswered[0];
  if (unanswered.length === checked) return plainest.error;
  return new Error(
    `${plainest.login}'s check got no answer, so Lo can't tell yet which account to use: ${plainest.error.message}`,
    { cause: plainest.error },
  );
}

/** The repository a `/repos/{owner}/{repo}` answer's `full_name` names. */
function readFullName(json: unknown): RepoRef | undefined {
  const fullName = isRecord(json) ? json['full_name'] : undefined;
  if (typeof fullName !== 'string') return undefined;
  const repo = RepoRef.parse(fullName);
  return repo && isRepoName(repo.owner, repo.name) ? repo : undefined;
}

/** Whether `owner/name` could be a GitHub repository's, so it can go into a path. */
function isRepoName(owner: string, name: string): boolean {
  return (
    /^[A-Za-z0-9_-]+$/.test(owner) &&
    /^[A-Za-z0-9_.-]+$/.test(name) &&
    name !== '.' &&
    name !== '..'
  );
}

/** What was thrown, in a few words. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether the store's error says the kept grant can never work, such as a token garbled on disk. */
function unusable(error: unknown): boolean {
  return error instanceof GithubError && error.isUnauthorized();
}
