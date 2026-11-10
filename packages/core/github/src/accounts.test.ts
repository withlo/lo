import { MemoryAccountRows, MemorySecrets } from '@lo/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { Accounts, type Account, type AccountSource, type AccountsEvent } from './accounts.ts';
import type { RepoAccount } from './choice.ts';
import type { RequestGate } from './client.ts';
import { GithubError } from './errors.ts';
import { RenewalError, type Grant } from './grant.ts';
import { RepoRef } from './refs.ts';
import { Token } from './token.ts';
import type { AuthenticatedUser } from './user.ts';

/** The waits the accounts keep, in seconds. */
const RENEW_BEFORE = 5 * 60;
const RENEW_GAP = 60;
const SAVE_GAP = 30;
const MAX_SAVE_GAP = 15 * 60;
const EIGHT_HOURS = 8 * 60 * 60;

const REPO = '/repos/acme/app';
const ACME_APP = new RepoRef('acme', 'app');

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Lets the clock run on by `seconds`, and everything that's ready run. */
async function advance(seconds: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(seconds * 1000);
}

/** Lets everything that's ready run, without the clock moving. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** The time, in seconds since the Unix epoch, by the test's clock. */
function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Any JSON, unread. */
function anything(json: unknown): unknown {
  return json;
}

/** How GitHub answers a renewal: with a new pair, which lasts 8 hours, an error, or a server error. */
type Renewal = { to: [token: string, refresh: string] } | { error: string } | 'down';

/**
 * GitHub, for the accounts: answers `GET /repos/...` with 200 for the tokens in `sees`, naming the
 * repository `fullName` when it's set, 401 for `revoked`, no answer for `unreachable`, a timeout
 * for `slow`, `answers` as given, else 404. Each renewal is answered from `renewals`, by the
 * refresh token sent; a refresh token that got a new pair is spent, and refused if sent again, as
 * GitHub does.
 */
class GitHub {
  sees: string[] = [];
  revoked: string[] = [];
  unreachable: string[] = [];
  slow: string[] = [];
  fullName: string | undefined;
  readonly answers = new Map<
    string,
    [status: number, headers: Record<string, string>, body: string]
  >();
  readonly renewals = new Map<string, Renewal>();
  /** The refresh tokens renewals sent, in order. */
  readonly refreshed: string[] = [];
  /** How many requests were sent. */
  sent = 0;
  /** Runs as each renewal is sent, with its refresh token: what another Lo process does meanwhile. */
  onRefresh: ((refresh: string) => void) | undefined;
  /** Where each request is noted, as `<method> <path> <token>`, and each renewal as `renew <refresh token>`. */
  readonly events: string[];
  readonly #held = new Map<string, Promise<void>>();

  constructor(events: string[] = []) {
    this.events = events;
  }

  /** Holds renewals with `refresh` until the returned function is called. */
  hold(refresh: string): () => void {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.#held.set(refresh, promise);
    return () => {
      resolve();
    };
  }

  readonly fetch: typeof globalThis.fetch = (input, init) =>
    Promise.resolve().then(() => this.#answer(new Request(input, init)));

  readonly renew = async (refresh: Token): Promise<Grant> => {
    const sent = refresh.expose();
    const spent = this.refreshed.includes(sent);
    this.refreshed.push(sent);
    this.events.push(`renew ${sent}`);
    this.onRefresh?.(sent);
    // Not at once, as over a network, so anything else ready runs meanwhile.
    await Promise.resolve();
    const held = this.#held.get(sent);
    if (held) await held;
    const renewal = this.renewals.get(sent);
    if (renewal === 'down') throw new RenewalError('unavailable', 'GitHub answered 502');
    if (renewal !== undefined && 'to' in renewal && !spent) {
      return expiring(renewal.to[0], renewal.to[1], EIGHT_HOURS);
    }
    const error = renewal !== undefined && 'error' in renewal ? renewal.error : 'bad_refresh_token';
    throw new RenewalError('refused', error);
  };

  #answer(request: Request): Response {
    this.sent += 1;
    const token = request.headers.get('authorization')?.replace(/^token /, '') ?? '';
    this.events.push(`${request.method} ${new URL(request.url).pathname} ${token}`.trimEnd());
    const answer = this.answers.get(token);
    if (answer) return new Response(answer[2], { status: answer[0], headers: answer[1] });
    if (this.unreachable.includes(token)) {
      const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      throw new TypeError('fetch failed', { cause: refused });
    }
    if (this.slow.includes(token)) {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }
    if (this.sees.includes(token)) {
      return Response.json(
        this.fullName === undefined ? { message: 'x' } : { full_name: this.fullName },
      );
    }
    return Response.json({ message: 'x' }, { status: this.revoked.includes(token) ? 401 : 404 });
  }
}

/** The accounts' grants, kept in memory, in a store that can lock, refuse, or write slowly. */
class Keychain extends MemorySecrets<Grant> {
  /** Logins whose grant can't be read, as from a locked keychain. */
  readonly unreadable = new Set<string>();
  /** When set, each write waits until {@link Keychain.releaseWrite} lets it through, as a slow store's do. */
  parkWrites = false;
  /** Where each write is noted, as `write <login>`, in order with what else shares it. */
  readonly events: string[];
  readonly #parked: (() => void)[] = [];

  constructor(events: string[] = []) {
    super();
    this.events = events;
  }

  override read(login: string): Promise<Grant | undefined> {
    if (!this.unreadable.has(login)) return super.read(login);
    this.calls.push(`read ${login}`);
    return Promise.reject(new Error('the keychain is locked'));
  }

  override async write(login: string, kept: Grant): Promise<void> {
    if (this.parkWrites) {
      const { promise, resolve } = Promise.withResolvers<void>();
      this.#parked.push(() => {
        resolve();
      });
      await promise;
    }
    try {
      await super.write(login, kept);
    } catch (error) {
      this.events.push(`refused write ${login}`);
      throw error;
    }
    this.events.push(`write ${login}`);
  }

  /** Lets the first write waiting go through. Whether one was waiting. */
  releaseWrite(): boolean {
    const next = this.#parked.shift();
    next?.();
    return next !== undefined;
  }

  /** The logins whose grant is kept. */
  logins(): string[] {
    return [...this.kept.keys()].toSorted();
  }

  /** The token kept for `login`. */
  token(login: string): string | undefined {
    return this.kept.get(login)?.token.expose();
  }

  /** The refresh token kept for `login`. */
  refreshToken(login: string): string | undefined {
    return this.kept.get(login)?.refresh?.token.expose();
  }
}

function user(login: string, id = 1): AuthenticatedUser {
  return {
    user: { login, id, name: `${login} name`, avatar_url: null },
    scopes: ['read:org', 'repo', 'workflow'],
  };
}

/** A token that doesn't expire. */
function grant(token: string): Grant {
  return { token: new Token(token) };
}

/** A token GitHub issued now that expires `expiresIn` seconds from now, with its refresh token. */
function expiring(token: string, refresh: string, expiresIn: number): Grant {
  return {
    token: new Token(token),
    refresh: {
      token: new Token(refresh),
      issuedAt: now(),
      expiresAt: now() + expiresIn,
      refreshTokenExpiresAt: now() + 15_638_400,
    },
  };
}

/** {@link expiring}, issued `later` seconds after now, for 8 hours. */
function issuedLater(token: string, refresh: string, later: number): Grant {
  const issued = expiring(token, refresh, later + EIGHT_HOURS);
  if (issued.refresh) issued.refresh.issuedAt = now() + later;
  return issued;
}

/** Renewing `gho_OLD` gives `gho_NEW`, and renewing that gives `gho_NEWER`. GitHub revokes `gho_OLD` as it issues `gho_NEW`. */
function renewingTwice(): GitHub {
  const github = new GitHub();
  github.sees = ['gho_NEW', 'gho_NEWER'];
  github.revoked = ['gho_OLD'];
  github.renewals.set('ghr_OLD', { to: ['gho_NEW', 'ghr_NEW'] });
  github.renewals.set('ghr_NEW', { to: ['gho_NEWER', 'ghr_NEWER'] });
  return github;
}

interface Setup {
  accounts: Accounts;
  store: Keychain;
  rows: MemoryAccountRows<Account>;
  github: GitHub;
}

async function setup(
  github = new GitHub(),
  store = new Keychain(),
  rows = new MemoryAccountRows<Account>(),
): Promise<Setup> {
  return { accounts: await load({ github, store, rows }), store, rows, github };
}

/** The accounts as Lo reads them as it starts. */
function load({ github, store, rows }: Omit<Setup, 'accounts'>): Promise<Accounts> {
  return Accounts.load({ rows, secrets: store, renew: github.renew, fetch: github.fetch });
}

function add(
  accounts: Accounts,
  login: string,
  token: string | Grant,
  source: AccountSource = 'deviceFlow',
): Promise<Account> {
  return accounts.add(user(login), typeof token === 'string' ? grant(token) : token, source);
}

/** Every event the accounts send, from now on. */
function heard(accounts: Accounts): AccountsEvent[] {
  const seen: AccountsEvent[] = [];
  accounts.onEvent((event) => {
    seen.push(event);
  });
  return seen;
}

function logins(accounts: Accounts): string[] {
  return accounts.accounts.map((account) => account.login);
}

/** A request's result, once it's settled: whether it worked. */
function outcome(request: Promise<unknown>): { done: boolean; ok: boolean | undefined } {
  const result: { done: boolean; ok: boolean | undefined } = { done: false, ok: undefined };
  void request.then(
    () => Object.assign(result, { done: true, ok: true }),
    () => Object.assign(result, { done: true, ok: false }),
  );
  return result;
}

const UNAUTHORIZED = { detail: { kind: 'unauthorized' } };

test('adding stores the token and the account', async () => {
  const { accounts, store, rows, github } = await setup();
  const account = await accounts.add(user('rozed-bot', 7), grant('gho_FAKE'), 'deviceFlow');
  expect(account.login).toBe('rozed-bot');
  expect(account.scopes).toEqual(['read:org', 'repo', 'workflow']);
  expect(store.token('rozed-bot')).toBe('gho_FAKE');
  expect(accounts.accounts).toEqual([account]);

  // After a restart the account is still there, and its token is read from the store.
  const restarted = await load({ github, store, rows });
  expect(restarted.accounts).toEqual([account]);
  const client = await restarted.client('ROZED-BOT');
  expect(client.token?.expose()).toBe('gho_FAKE');
});

test('adding the same login again replaces its token', async () => {
  const { accounts, store } = await setup();
  for (const token of ['gho_OLD', 'gho_NEW']) await add(accounts, 'a', token, 'gh');
  expect(accounts.accounts).toHaveLength(1);
  expect(store.token('a')).toBe('gho_NEW');
});

test('removing deletes the token and the account', async () => {
  const { accounts, store, rows } = await setup();
  await accounts.add(user('a', 1), grant('gho_FAKE'), 'deviceFlow');
  await accounts.add(user('b', 2), grant('gho_FAKE'), 'deviceFlow');
  await accounts.remove('a');
  expect(logins(accounts)).toEqual(['b']);
  expect(store.logins()).toEqual(['b']);
  expect(await rows.accounts()).toHaveLength(1);
});

test('a failed row write leaves no token behind', async () => {
  const { accounts, store, rows } = await setup();
  rows.failingWrites = true;
  await expect(add(accounts, 'a', 'gho_FAKE')).rejects.toThrow('saving the account');
  expect(store.logins()).toEqual([]);
  expect(await rows.accounts()).toEqual([]);
});

test('dropping the add still finishes it', async () => {
  const { accounts, store, rows } = await setup();
  // Hold the token write, and stop waiting for the add, as the dialog does when escape closes it.
  store.parkWrites = true;
  void add(accounts, 'a', 'gho_FAKE');
  await settle();
  store.parkWrites = false;
  expect(store.releaseWrite()).toBe(true);
  await settle();
  // Both the token and the row are there, never just one of them.
  expect(store.logins()).toEqual(['a']);
  expect(await rows.accounts()).toHaveLength(1);
  expect(accounts.accounts).toHaveLength(1);
});

test('a case only rename keeps one token', async () => {
  const { accounts, store } = await setup();
  await add(accounts, 'rozed-bot', 'gho_FAKE');
  await add(accounts, 'Rozed-Bot', 'gho_FAKE');
  expect(store.logins()).toEqual(['rozed-bot']);
  await accounts.remove('ROZED-BOT');
  expect(store.logins()).toEqual([]);
});

test('accounts added in the same second keep their order after a restart', async () => {
  const { store, rows, github } = await setup();
  // Two accounts added in the same second, whose logins differ in case.
  for (const login of ['B', 'a']) {
    await rows.save({ login, userId: 1, scopes: ['repo'], source: 'deviceFlow', addedAt: 1 });
  }

  // Signing in to one again sorts the accounts in memory; a restart reads the rows' order. Both
  // ignore case.
  const accounts = await load({ github, store, rows });
  await add(accounts, 'B', 'gho_FAKE');
  expect(logins(accounts)).toEqual(['a', 'B']);
  expect(logins(await load({ github, store, rows }))).toEqual(['a', 'B']);
});

test('an account whose token is gone can still be removed', async () => {
  const { accounts, store, rows } = await setup();
  await add(accounts, 'a', 'gho_FAKE');
  // Deleted by another Lo process, say.
  store.kept.clear();
  await accounts.remove('a');
  expect(accounts.accounts).toEqual([]);
  expect(await rows.accounts()).toEqual([]);
});

test('removing forgets the account even when its token cant be deleted', async () => {
  const { accounts, store, rows } = await setup();
  await add(accounts, 'a', 'gho_FAKE');
  store.failingWrites = true;
  // The account is gone, and the error says the token wasn't.
  await expect(accounts.remove('a')).rejects.toThrow("couldn't delete its token");
  expect(accounts.accounts).toEqual([]);
  expect(await rows.accounts()).toEqual([]);
});

test('a 401 from any request signs only that account out', async () => {
  const github = new GitHub();
  github.sees = ['gho_B', 'gho_NEW'];
  github.revoked = ['gho_A'];
  const { accounts } = await setup(github);
  await add(accounts, 'a', 'gho_A');
  await add(accounts, 'b', 'gho_B');
  const a = await accounts.client('A');
  const b = await accounts.client('b');

  await expect(a.get(REPO, anything)).rejects.toMatchObject(UNAUTHORIZED);
  await b.get(REPO, anything);
  expect(accounts.signedOut('a')).toBe('refused');
  expect(accounts.signedOut('b')).toBeUndefined();
  await expect(accounts.client('a')).rejects.toThrow('signed out');

  // Signing in again clears it, and clients made before pick up the new token.
  await add(accounts, 'a', 'gho_NEW');
  expect(accounts.isSignedOut('a')).toBe(false);
  await a.get(REPO, anything);
  expect(a.token?.expose()).toBe('gho_NEW');
});

test('a missing token signs the account out', async () => {
  const { accounts, store, rows, github } = await setup();
  await add(accounts, 'a', 'gho_FAKE');
  store.kept.clear();
  // A restart, so the client is made from what's stored.
  const restarted = await load({ github, store, rows });
  await expect(restarted.client('a')).rejects.toThrow('missing');
  expect(restarted.signedOut('a')).toBe('tokenMissing');
});

test('a kept token that can never work signs the account out', async () => {
  const { accounts, store, rows, github } = await setup();
  await add(accounts, 'a', 'gho_FAKE');
  // The store turns what it kept back into a token, and a carriage return got into it.
  const garbled = new (class extends Keychain {
    override read(login: string): Promise<Grant | undefined> {
      return super.read(login).then(() => ({ token: new Token('gho_FA\rKE') }));
    }
  })();
  const restarted = await load({ github, store: garbled, rows });
  const error = await restarted.client('a').catch((thrown: unknown) => thrown);
  expect(error).toMatchObject(UNAUTHORIZED);
  expect(restarted.signedOut('a')).toBe('tokenMissing');
  expect(String(error)).not.toContain('gho_FA');
  expect(store.token('a')).toBe('gho_FAKE');
});

test('signing in stores the refresh token beside the token', async () => {
  const { accounts, store } = await setup();
  await add(accounts, 'a', expiring('gho_A', 'ghr_A', EIGHT_HOURS));
  expect(store.token('a')).toBe('gho_A');
  expect(store.refreshToken('a')).toBe('ghr_A');
  expect(store.kept.get('a')?.refresh?.expiresAt).toBeGreaterThan(now() + EIGHT_HOURS - 60);

  // A token that doesn't expire, such as one imported from gh, drops it.
  await add(accounts, 'a', 'gho_GH', 'gh');
  expect(store.logins()).toEqual(['a']);
  expect(store.kept.get('a')?.refresh).toBeUndefined();

  // So does removing the account.
  await add(accounts, 'a', expiring('gho_A', 'ghr_A', EIGHT_HOURS));
  await accounts.remove('a');
  expect(store.logins()).toEqual([]);
});

test('a refused token that expires is renewed and the request sent again', async () => {
  const github = new GitHub();
  github.sees = ['gho_NEW'];
  github.revoked = ['gho_OLD'];
  github.renewals.set('ghr_OLD', { to: ['gho_NEW', 'ghr_NEW'] });
  const { accounts, store } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const a = await accounts.client('a');

  await a.get(REPO, anything);
  expect(github.refreshed).toEqual(['ghr_OLD']);
  expect(a.token?.expose()).toBe('gho_NEW');
  expect(accounts.isSignedOut('a')).toBe(false);
  // Both new tokens are stored, for the next launch.
  expect(store.token('a')).toBe('gho_NEW');
  expect(store.refreshToken('a')).toBe('ghr_NEW');
  expect(store.kept.get('a')?.refresh?.expiresAt).toBeGreaterThan(now() + EIGHT_HOURS - 60);
});

test('the new refresh token is stored before the new token is used', async () => {
  const shared: string[] = [];
  const github = new GitHub(shared);
  github.sees = ['gho_NEW'];
  github.revoked = ['gho_OLD'];
  github.renewals.set('ghr_OLD', { to: ['gho_NEW', 'ghr_NEW'] });
  const { accounts } = await setup(github, new Keychain(shared));
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const a = await accounts.client('a');
  shared.length = 0;

  await a.get(REPO, anything);
  expect(shared).toEqual([
    `GET ${REPO} gho_OLD`,
    'renew ghr_OLD',
    'write a',
    `GET ${REPO} gho_NEW`,
  ]);
});

test('requests refused together renew the token once', async () => {
  const github = new GitHub();
  github.sees = ['gho_NEW'];
  github.revoked = ['gho_OLD'];
  github.renewals.set('ghr_OLD', { to: ['gho_NEW', 'ghr_NEW'] });
  const { accounts } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const a = await accounts.client('a');

  await Promise.all([a.get(REPO, anything), a.get('/repos/acme/other', anything)]);
  // A second renewal would have used the spent refresh token, and been refused.
  expect(github.refreshed).toEqual(['ghr_OLD']);
});

test('a token is renewed before it expires', async () => {
  const github = new GitHub();
  github.sees = ['gho_OLD', 'gho_NEW'];
  github.renewals.set('ghr_OLD', { to: ['gho_NEW', 'ghr_NEW'] });
  github.renewals.set('ghr_NEW', { to: ['gho_NEWER', 'ghr_NEWER'] });
  const { accounts } = await setup(github);
  // It expires in 7 minutes, so it's renewed in 2.
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', 7 * 60));
  const a = await accounts.client('a');

  await advance(115);
  expect(github.refreshed).toEqual([]);
  await advance(10);
  expect(github.refreshed).toEqual(['ghr_OLD']);
  expect(a.token?.expose()).toBe('gho_NEW');
  // No request was refused on the way.
  await a.get(REPO, anything);
  // The new token is renewed 5 minutes before its own 8 hours are up.
  await advance(EIGHT_HOURS - RENEW_BEFORE - 60);
  expect(github.refreshed).toEqual(['ghr_OLD']);
  await advance(120);
  expect(github.refreshed).toEqual(['ghr_OLD', 'ghr_NEW']);
});

test('an expiring token github wont renew is used until its refused', async () => {
  const github = new GitHub();
  github.sees = ['gho_OLD'];
  github.renewals.set('ghr_OLD', { error: 'bad_refresh_token' });
  const { accounts } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', 7 * 60));
  const a = await accounts.client('a');

  await advance(125);
  expect(github.refreshed).toEqual(['ghr_OLD']);
  expect(accounts.isSignedOut('a')).toBe(false);
  await a.get(REPO, anything);
  // It isn't asked again by the clock.
  await advance(EIGHT_HOURS);
  expect(github.refreshed).toEqual(['ghr_OLD']);
});

test('a token another lo renewed is used without renewing again', async () => {
  const github = new GitHub();
  github.sees = ['gho_NEW'];
  github.revoked = ['gho_OLD'];
  const { accounts, store } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const a = await accounts.client('a');
  // Another Lo process renewed it, using up the refresh token this one knew.
  store.kept.set('a', issuedLater('gho_NEW', 'ghr_NEW', 60));

  await a.get(REPO, anything);
  expect(a.token?.expose()).toBe('gho_NEW');
  expect(github.refreshed).toEqual([]);
});

test('a renewal github refuses signs the account out once', async () => {
  const github = new GitHub();
  github.revoked = ['gho_OLD'];
  github.renewals.set('ghr_OLD', { error: 'bad_refresh_token' });
  const { accounts, store, rows } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const signOuts = heard(accounts);
  const a = await accounts.client('a');

  const [first, second] = await Promise.allSettled([
    a.get(REPO, anything),
    a.get('/repos/acme/other', anything),
  ]);
  expect(first).toMatchObject({ status: 'rejected', reason: UNAUTHORIZED });
  expect(second).toMatchObject({ status: 'rejected', reason: UNAUTHORIZED });
  await settle();
  expect(github.refreshed).toEqual(['ghr_OLD']);
  expect(signOuts).toEqual([{ kind: 'signedOut', login: 'a', why: 'refused' }]);
  // Marking it signed out again, for the same reason, says nothing more.
  accounts.markSignedOut('a', 'refused');
  expect(signOuts).toHaveLength(1);
  expect(accounts.signedOut('a')).toBe('refused');
  // The refused tokens are gone; the account, and what's kept for it, stay.
  expect(store.logins()).toEqual([]);
  expect(await rows.accounts()).toHaveLength(1);

  // After a restart it's still signed out.
  const restarted = await load({ github, store, rows });
  expect(restarted.signedOut('a')).toBe('refused');
  // Until it signs in again.
  await add(restarted, 'a', expiring('gho_NEW', 'ghr_NEW', EIGHT_HOURS));
  expect(restarted.isSignedOut('a')).toBe(false);
  expect((await load({ github, store, rows })).isSignedOut('a')).toBe(false);
});

test('a refused token that doesnt expire is deleted', async () => {
  const github = new GitHub();
  github.revoked = ['gho_A'];
  const { accounts, store, rows } = await setup(github);
  await add(accounts, 'a', 'gho_A');
  const a = await accounts.client('a');

  await expect(a.get(REPO, anything)).rejects.toMatchObject(UNAUTHORIZED);
  await settle();
  expect(github.refreshed).toEqual([]);
  expect(store.logins()).toEqual([]);
  expect(await rows.refused()).toEqual(['a']);
});

test('a token stored since isnt deleted with the refused one', async () => {
  const github = new GitHub();
  github.revoked = ['gho_A'];
  const { accounts, store } = await setup(github);
  await add(accounts, 'a', 'gho_A');
  const a = await accounts.client('a');
  // Another Lo process signs it in again just as this one signs it out.
  accounts.onEvent((event) => {
    if (event.kind === 'signedOut') store.kept.set('a', grant('gho_ELSEWHERE'));
  });

  // Nothing renews the token, so it's signed out here, but the new token stays.
  await expect(a.get(REPO, anything)).rejects.toMatchObject(UNAUTHORIZED);
  await settle();
  expect(accounts.signedOut('a')).toBe('refused');
  expect(store.token('a')).toBe('gho_ELSEWHERE');
});

test('a renewal github cant answer keeps the account', async () => {
  const github = new GitHub();
  github.revoked = ['gho_OLD'];
  github.renewals.set('ghr_OLD', 'down');
  const { accounts, store } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const a = await accounts.client('a');

  await expect(a.get(REPO, anything)).rejects.toMatchObject(UNAUTHORIZED);
  await settle();
  expect(accounts.isSignedOut('a')).toBe(false);
  expect(store.token('a')).toBe('gho_OLD');
  expect(store.refreshToken('a')).toBe('ghr_OLD');
  // A refusal a minute later asks again.
  await advance(RENEW_GAP);
  await expect(a.get(REPO, anything)).rejects.toMatchObject(UNAUTHORIZED);
  expect(github.refreshed).toEqual(['ghr_OLD', 'ghr_OLD']);
});

test('a renewed token the store refuses is used and saved later', async () => {
  const github = renewingTwice();
  const { accounts, store } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const seen = heard(accounts);
  const a = await accounts.client('a');
  // The user denies Lo the store.
  store.failingWrites = true;

  // GitHub revoked the old pair as it issued the new one, so the new one is used all the same.
  await a.get(REPO, anything);
  expect(a.token?.expose()).toBe('gho_NEW');
  expect(store.token('a')).toBe('gho_OLD');
  expect(seen).toEqual([]);
  // Saving it again fails too, so Lo says so, once.
  await advance(SAVE_GAP);
  expect(seen).toEqual([{ kind: 'cantSave', login: 'a' }]);
  // Once the store takes it, it's saved, and Lo says so, once.
  store.failingWrites = false;
  await advance(SAVE_GAP * 2);
  expect(store.token('a')).toBe('gho_NEW');
  expect(store.refreshToken('a')).toBe('ghr_NEW');
  expect(seen).toEqual([
    { kind: 'cantSave', login: 'a' },
    { kind: 'cantSaveOver', login: 'a' },
  ]);
  expect(accounts.isSignedOut('a')).toBe(false);
});

test('an unsaved renewal is renewed with the refresh token lo kept', async () => {
  const github = renewingTwice();
  const { accounts, store } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const a = await accounts.client('a');
  store.failingWrites = true;
  await a.get(REPO, anything);
  expect(a.token?.expose()).toBe('gho_NEW');

  // Before the new token expires, it's renewed with the refresh token Lo kept. The store still
  // has the old pair, which isn't taken for a newer one.
  await advance(EIGHT_HOURS);
  expect(github.refreshed).toEqual(['ghr_OLD', 'ghr_NEW']);
  expect(a.token?.expose()).toBe('gho_NEWER');
  await a.get(REPO, anything);
  expect(accounts.isSignedOut('a')).toBe(false);
});

test('a renewal the store refused is saved as lo quits', async () => {
  const github = renewingTwice();
  const { accounts, store, rows } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const a = await accounts.client('a');
  store.failingWrites = true;
  await a.get(REPO, anything);

  // By the time Lo quits, before it tries again, the store takes it.
  store.failingWrites = false;
  const quitting = accounts.saveBeforeQuitting();
  expect(quitting).toBeDefined();
  await quitting;
  expect(store.token('a')).toBe('gho_NEW');
  // After a restart, the account works without renewing again.
  const restarted = await load({ github, store, rows });
  const again = await restarted.client('a');
  expect(again.token?.expose()).toBe('gho_NEW');
  await again.get(REPO, anything);
  expect(github.refreshed).toEqual(['ghr_OLD']);
});

test('a renewal the store never took signs out cleanly after a restart', async () => {
  const github = renewingTwice();
  const { accounts, store, rows } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const a = await accounts.client('a');
  store.failingWrites = true;
  await a.get(REPO, anything);

  // Lo quits without saving it. The store has only the old pair, which GitHub revoked, so the
  // restarted Lo signs the account out once, and says so, rather than running on.
  store.failingWrites = false;
  const restarted = await load({ github, store, rows });
  const seen = heard(restarted);
  const again = await restarted.client('a');
  await expect(again.get(REPO, anything)).rejects.toMatchObject(UNAUTHORIZED);
  await settle();
  expect(github.refreshed).toEqual(['ghr_OLD', 'ghr_OLD']);
  expect(seen).toEqual([{ kind: 'signedOut', login: 'a', why: 'refused' }]);
  expect(store.logins()).toEqual([]);
});

test('a refused renewal uses a pair another lo stored meanwhile', async () => {
  const github = new GitHub();
  github.sees = ['gho_ELSEWHERE'];
  github.revoked = ['gho_OLD'];
  const { accounts, store } = await setup(github);
  // Another Lo process renewed with the same refresh token a moment before, so GitHub refuses it
  // here. That Lo has stored its new pair.
  github.onRefresh = () => {
    store.kept.set('a', issuedLater('gho_ELSEWHERE', 'ghr_ELSEWHERE', 60));
  };
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const seen = heard(accounts);
  const a = await accounts.client('a');

  await a.get(REPO, anything);
  expect(a.token?.expose()).toBe('gho_ELSEWHERE');
  expect(github.refreshed).toEqual(['ghr_OLD']);
  expect(seen).toEqual([]);
  expect(store.refreshToken('a')).toBe('ghr_ELSEWHERE');
});

test('a refresh token that cant be read isnt taken for none', async () => {
  const github = renewingTwice();
  const { accounts, store, rows } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const a = await accounts.client('a');
  const seen = heard(accounts);
  // The store can't be read just then, as from a locked keychain.
  store.unreadable.add('a');

  await expect(a.get(REPO, anything)).rejects.toMatchObject(UNAUTHORIZED);
  await settle();
  // The account stays signed in, with its tokens, for when they can be read.
  expect(accounts.isSignedOut('a')).toBe(false);
  expect(seen).toEqual([]);
  expect(github.refreshed).toEqual([]);
  expect(store.refreshToken('a')).toBe('ghr_OLD');
  expect(await rows.refused()).toEqual([]);
});

test('a sign out that cant read the store leaves it', async () => {
  const github = new GitHub();
  github.revoked = ['gho_A'];
  const { accounts, store, rows } = await setup(github);
  await add(accounts, 'a', 'gho_A');
  const a = await accounts.client('a');
  // The store locks just as the account is signed out.
  accounts.onEvent((event) => {
    if (event.kind === 'signedOut') store.unreadable.add('a');
  });

  await expect(a.get(REPO, anything)).rejects.toMatchObject(UNAUTHORIZED);
  await settle();
  expect(accounts.signedOut('a')).toBe('refused');
  // Lo can't tell whether the store holds a newer token, so it leaves the store, and the rows, as
  // they are.
  expect(store.token('a')).toBe('gho_A');
  expect(await rows.refused()).toEqual([]);
});

test('a renewal github cant answer waits longer each time', async () => {
  const github = new GitHub();
  github.revoked = ['gho_OLD'];
  github.renewals.set('ghr_OLD', 'down');
  const { accounts } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const a = await accounts.client('a');
  const request = () => expect(a.get(REPO, anything)).rejects.toMatchObject(UNAUTHORIZED);

  await request();
  expect(github.refreshed).toHaveLength(1);
  // The next refusals wait a minute before GitHub is asked again.
  await request();
  expect(github.refreshed).toHaveLength(1);
  await advance(RENEW_GAP);
  await request();
  expect(github.refreshed).toHaveLength(2);
  // Then two.
  await advance(RENEW_GAP);
  await request();
  expect(github.refreshed).toHaveLength(2);
  await advance(RENEW_GAP);
  await request();
  expect(github.refreshed).toHaveLength(3);
  expect(accounts.isSignedOut('a')).toBe(false);
});

test('one accounts renewal doesnt hold up anothers', async () => {
  const github = new GitHub();
  github.sees = ['gho_A2', 'gho_B2'];
  github.revoked = ['gho_A1', 'gho_B1'];
  github.renewals.set('ghr_A1', { to: ['gho_A2', 'ghr_A2'] });
  github.renewals.set('ghr_B1', { to: ['gho_B2', 'ghr_B2'] });
  const release = github.hold('ghr_A1');
  const { accounts } = await setup(github);
  await add(accounts, 'a', expiring('gho_A1', 'ghr_A1', EIGHT_HOURS));
  await add(accounts, 'b', expiring('gho_B1', 'ghr_B1', EIGHT_HOURS));
  const a = await accounts.client('a');
  const b = await accounts.client('b');

  // a's renewal waits on GitHub; b's goes ahead meanwhile.
  const aRequest = outcome(a.get(REPO, anything));
  await settle();
  const bRequest = outcome(b.get(REPO, anything));
  await settle();
  expect(bRequest).toEqual({ done: true, ok: true });
  expect(aRequest.done).toBe(false);
  release();
  await settle();
  expect(aRequest).toEqual({ done: true, ok: true });
});

test('removing an account while its token renews leaves nothing behind', async () => {
  const github = renewingTwice();
  const release = github.hold('ghr_OLD');
  const { accounts, store } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const a = await accounts.client('a');
  const request = outcome(a.get(REPO, anything));
  await settle();
  expect(github.refreshed).toEqual(['ghr_OLD']);

  await accounts.remove('a');
  release();
  await settle();
  // The renewal's new pair isn't written back for an account the user removed, nor used.
  expect(store.logins()).toEqual([]);
  expect(request).toEqual({ done: true, ok: false });
  await advance(EIGHT_HOURS);
  expect(github.refreshed).toEqual(['ghr_OLD']);
});

test('removing an account while github refuses its renewal says nothing', async () => {
  const github = new GitHub();
  github.revoked = ['gho_OLD'];
  github.renewals.set('ghr_OLD', { error: 'bad_refresh_token' });
  const release = github.hold('ghr_OLD');
  const { accounts, store, rows } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const seen = heard(accounts);
  const a = await accounts.client('a');
  const request = outcome(a.get(REPO, anything));
  await settle();
  expect(github.refreshed).toEqual(['ghr_OLD']);

  await accounts.remove('a');
  release();
  await settle();
  // GitHub refusing the renewal of an account the user removed signs nothing out, and says
  // nothing.
  expect(request).toEqual({ done: true, ok: false });
  expect(seen).toEqual([]);
  expect(accounts.signedOut('a')).toBeUndefined();
  expect(store.logins()).toEqual([]);
  expect(await rows.refused()).toEqual([]);
});

test('signing in again while github refuses a renewal keeps the sign in', async () => {
  const github = new GitHub();
  github.sees = ['gho_GH'];
  github.revoked = ['gho_OLD'];
  github.renewals.set('ghr_OLD', { error: 'bad_refresh_token' });
  const release = github.hold('ghr_OLD');
  const { accounts, store } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const seen = heard(accounts);
  const a = await accounts.client('a');
  const request = outcome(a.get(REPO, anything));
  await settle();

  // The user imports the account from gh meanwhile: a token with no refresh token.
  await add(accounts, 'a', 'gho_GH', 'gh');
  release();
  await settle();
  // The sign-in stands, and the request goes again with its token.
  expect(request).toEqual({ done: true, ok: true });
  expect(a.token?.expose()).toBe('gho_GH');
  expect(seen).toEqual([]);
  expect(accounts.isSignedOut('a')).toBe(false);
  expect(store.token('a')).toBe('gho_GH');
});

test('an unsaved renewal is renewed while the store cant be read', async () => {
  const github = renewingTwice();
  const { accounts, store } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const a = await accounts.client('a');
  store.failingWrites = true;
  await a.get(REPO, anything);
  expect(a.token?.expose()).toBe('gho_NEW');
  // Then the store can't be read either, as from a locked keychain.
  store.failingReads = true;

  // Lo still renews the pair it holds before the token expires: only it has that pair.
  await advance(EIGHT_HOURS);
  expect(github.refreshed).toEqual(['ghr_OLD', 'ghr_NEW']);
  expect(a.token?.expose()).toBe('gho_NEWER');
  await a.get(REPO, anything);
  expect(accounts.isSignedOut('a')).toBe(false);
});

test('saving as lo quits never writes an older pair over a renewal', async () => {
  const github = renewingTwice();
  const { accounts, store } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const a = await accounts.client('a');
  store.failingWrites = true;
  await a.get(REPO, anything);
  expect(a.token?.expose()).toBe('gho_NEW');

  // The store takes writes again, slowly. The new token is renewed too, and GitHub's answer is
  // being stored as Lo quits.
  store.failingWrites = false;
  store.parkWrites = true;
  const renewal = accounts.refused('a', new Token('gho_NEW'));
  await settle();
  expect(github.refreshed).toEqual(['ghr_OLD', 'ghr_NEW']);
  const quitting = accounts.saveBeforeQuitting();
  expect(quitting).toBeDefined();
  await settle();
  while (store.releaseWrite()) await settle();
  await quitting;
  expect((await renewal)?.expose()).toBe('gho_NEWER');

  // The store has the renewal's pair, not the one it replaced, which GitHub revoked.
  expect(store.token('a')).toBe('gho_NEWER');
  expect(store.refreshToken('a')).toBe('ghr_NEWER');
});

test('lo says once the store takes a token it couldnt save', async () => {
  const github = new GitHub();
  github.sees = ['gho_A2', 'gho_A3', 'gho_B2', 'gho_B3'];
  github.revoked = ['gho_A1', 'gho_B1'];
  github.renewals.set('ghr_A1', { to: ['gho_A2', 'ghr_A2'] });
  github.renewals.set('ghr_A2', { to: ['gho_A3', 'ghr_A3'] });
  github.renewals.set('ghr_B1', { to: ['gho_B2', 'ghr_B2'] });
  const { accounts, store } = await setup(github);
  await add(accounts, 'a', expiring('gho_A1', 'ghr_A1', EIGHT_HOURS));
  await add(accounts, 'b', expiring('gho_B1', 'ghr_B1', EIGHT_HOURS));
  const seen = heard(accounts);
  const a = await accounts.client('a');
  const b = await accounts.client('b');
  store.failingWrites = true;
  await a.get(REPO, anything);
  await b.get(REPO, anything);
  await advance(SAVE_GAP);
  expect(seen.toSorted((x, y) => x.login.localeCompare(y.login))).toEqual([
    { kind: 'cantSave', login: 'a' },
    { kind: 'cantSave', login: 'b' },
  ]);
  seen.length = 0;

  // The store takes a's next renewal before the save is tried again, which ends it too.
  store.failingWrites = false;
  const renewed = await accounts.refused('a', new Token('gho_A2'));
  expect(renewed?.expose()).toBe('gho_A3');
  expect(seen).toEqual([{ kind: 'cantSaveOver', login: 'a' }]);
  // So does b signing in again.
  await add(accounts, 'b', expiring('gho_B3', 'ghr_B3', EIGHT_HOURS));
  expect(seen).toEqual([
    { kind: 'cantSaveOver', login: 'a' },
    { kind: 'cantSaveOver', login: 'b' },
  ]);
  // And nothing more is said once the saves come round again.
  await advance(MAX_SAVE_GAP);
  expect(seen).toHaveLength(2);
});

test('a token signed in while a renewal is refused is used', async () => {
  const github = new GitHub();
  github.sees = ['gho_SIGNED_IN'];
  github.revoked = ['gho_OLD'];
  const { accounts, store } = await setup(github);
  // Another Lo process signs in again, with a token that doesn't expire, while the renewal, which
  // GitHub refuses, is out.
  github.onRefresh = () => {
    store.kept.set('a', grant('gho_SIGNED_IN'));
  };
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const seen = heard(accounts);
  const a = await accounts.client('a');

  await a.get(REPO, anything);
  expect(a.token?.expose()).toBe('gho_SIGNED_IN');
  expect(github.refreshed).toEqual(['ghr_OLD']);
  expect(seen).toEqual([]);
  expect(store.token('a')).toBe('gho_SIGNED_IN');
});

test('signing out keeps a token github hasnt refused', async () => {
  const { accounts, store, rows } = await setup();
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  // Another Lo process signs in again after the renewal last read the store, just as this one
  // signs the account out.
  accounts.onEvent((event) => {
    if (event.kind === 'signedOut') store.kept.set('a', grant('gho_SIGNED_IN'));
  });

  expect(await accounts.refused('a', new Token('gho_OLD'))).toBeUndefined();
  await settle();
  expect(store.token('a')).toBe('gho_SIGNED_IN');
  expect(await rows.refused()).toEqual([]);
});

test('quitting lets a renewal waiting on github store its pair', async () => {
  const github = renewingTwice();
  const release = github.hold('ghr_OLD');
  const { accounts, store } = await setup(github);
  // It expires in 7 minutes, so it's renewed in 2.
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', 7 * 60));
  await accounts.client('a');
  await advance(125);
  expect(github.refreshed).toEqual(['ghr_OLD']);

  // The user quits while GitHub's answer, which revokes the old pair, is on its way.
  const quitting = accounts.saveBeforeQuitting();
  expect(quitting).toBeDefined();
  const quit = outcome(quitting ?? Promise.resolve());
  await settle();
  expect(quit.done).toBe(false);
  release();
  await quitting;
  expect(store.token('a')).toBe('gho_NEW');
  expect(store.refreshToken('a')).toBe('ghr_NEW');
});

test('saving as lo quits keeps the logins case', async () => {
  const github = renewingTwice();
  const { accounts, store } = await setup(github);
  await add(accounts, 'Rozed-Bot', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const a = await accounts.client('Rozed-Bot');
  store.failingWrites = true;
  await a.get(REPO, anything);
  store.failingWrites = false;

  await accounts.saveBeforeQuitting();
  // The grant is kept under the login in lower case, where a restart reads it.
  expect(store.logins()).toEqual(['rozed-bot']);
  expect(store.token('rozed-bot')).toBe('gho_NEW');
});

/** Lo couldn't save `a`'s renewed token, and said so. The events since. */
async function cantSave({ accounts, store }: Setup): Promise<AccountsEvent[]> {
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const seen = heard(accounts);
  const a = await accounts.client('a');
  store.failingWrites = true;
  await a.get(REPO, anything);
  await advance(SAVE_GAP);
  expect(seen).toEqual([{ kind: 'cantSave', login: 'a' }]);
  seen.length = 0;
  return seen;
}

test('taking a newer pair from the store ends cant save', async () => {
  const github = new GitHub();
  github.sees = ['gho_NEW', 'gho_ELSEWHERE'];
  github.revoked = ['gho_OLD'];
  github.renewals.set('ghr_OLD', { to: ['gho_NEW', 'ghr_NEW'] });
  const set = await setup(github);
  // Another Lo signs in while the unsaved pair's renewal, which GitHub refuses, is out.
  github.onRefresh = (sent) => {
    if (sent === 'ghr_NEW')
      set.store.kept.set('a', issuedLater('gho_ELSEWHERE', 'ghr_ELSEWHERE', 60));
  };
  const seen = await cantSave(set);

  const renewed = await set.accounts.refused('a', new Token('gho_NEW'));
  // The pair taken from the store is stored, so quitting signs nothing out.
  expect(renewed?.expose()).toBe('gho_ELSEWHERE');
  expect(seen).toEqual([{ kind: 'cantSaveOver', login: 'a' }]);
});

test('signing out ends cant save', async () => {
  const set = await setup(renewingTwice());
  const seen = await cantSave(set);
  set.accounts.markSignedOut('a', 'refused');
  expect(seen).toContainEqual({ kind: 'cantSaveOver', login: 'a' });
});

test('removing ends cant save', async () => {
  const set = await setup(renewingTwice());
  const seen = await cantSave(set);
  // The store lets Lo delete the grant, though it refused the save.
  set.store.failingWrites = false;
  await set.accounts.remove('a');
  expect(seen).toEqual([{ kind: 'cantSaveOver', login: 'a' }]);
});

test('a failed save of a pair since replaced says nothing', async () => {
  const github = renewingTwice();
  const { accounts, store } = await setup(github);
  await add(accounts, 'a', expiring('gho_OLD', 'ghr_OLD', EIGHT_HOURS));
  const a = await accounts.client('a');
  // The store refuses the renewed pair, so its save is tried again later.
  store.failingWrites = true;
  await a.get(REPO, anything);
  store.failingWrites = false;
  // A sign-in replaces it first.
  await add(accounts, 'a', expiring('gho_SIGNED_IN', 'ghr_SIGNED_IN', EIGHT_HOURS));
  const seen = heard(accounts);

  store.events.length = 0;
  await advance(MAX_SAVE_GAP);
  expect(seen).toEqual([]);
  expect(store.events).toEqual([]);
  expect(store.token('a')).toBe('gho_SIGNED_IN');
});

test('a client from before a sign out takes the token of a sign in again', async () => {
  const { accounts } = await setup();
  await add(accounts, 'a', 'gho_OLD');
  const a = await accounts.client('a');
  accounts.markSignedOut('a', 'refused');
  // Whatever holds the client follows the sign-in, without a request GitHub refuses first.
  await add(accounts, 'a', 'gho_NEW');
  expect(a.token?.expose()).toBe('gho_NEW');
});

/** Each problem as `[login, kind of error]`. */
function problems(found: RepoAccount): [string, string][] {
  return found.problems.map(({ login, error }) => {
    const { detail } = error;
    return [login, detail.kind === 'api' ? String(detail.status) : detail.kind];
  });
}

test('the account that can see the repo opens it', async () => {
  const github = new GitHub();
  github.sees = ['gho_WORK', 'gho_HOME'];
  github.revoked = ['gho_REVOKED'];
  const { accounts } = await setup(github);
  // In login order, so the accounts' order (when added, then login) doesn't depend on which
  // second each one is added in.
  for (const [login, token] of [
    ['home', 'gho_HOME'],
    ['old', 'gho_REVOKED'],
    ['other', 'gho_OTHER'],
    ['work', 'gho_WORK'],
  ] as const) {
    await add(accounts, login, token);
  }
  let found = await accounts.accountForRepo(ACME_APP);
  expect(found.choice).toEqual({ kind: 'ask', logins: ['home', 'work'] });
  // The revoked token's account is now signed out, which is worth saying.
  expect(accounts.isSignedOut('old')).toBe(true);
  expect(problems(found)).toEqual([['old', 'unauthorized']]);

  await accounts.rememberAccountForOwner('ACME', 'home');
  found = await accounts.accountForRepo(ACME_APP);
  expect(found.choice).toEqual({ kind: 'account', login: 'home' });
});

test('only not found means an account cant see a repo', async () => {
  const github = new GitHub();
  github.sees = ['gho_HOME'];
  github.answers.set('gho_WORK', [
    403,
    { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1762419600' },
    '{"message":"API rate limit exceeded"}',
  ]);
  github.answers.set('gho_SSO', [
    403,
    { 'x-github-sso': 'required; url=https://github.com/orgs/acme/sso?authorization_request=X' },
    '{"message":"Resource protected by organization SAML enforcement."}',
  ]);
  github.answers.set('gho_DOWN', [502, {}, 'Bad gateway']);
  const { accounts } = await setup(github);
  // In login order, so the accounts' order (when added, then login) doesn't depend on which
  // second each one is added in.
  for (const [login, token] of [
    ['down', 'gho_DOWN'],
    ['elsewhere', 'gho_ELSEWHERE'],
    ['home', 'gho_HOME'],
    ['sso', 'gho_SSO'],
    ['work', 'gho_WORK'],
  ] as const) {
    await add(accounts, login, token);
  }

  // Only home can see it, and the others' problems come along, in the accounts' order.
  let found = await accounts.accountForRepo(ACME_APP);
  expect(found.choice).toEqual({ kind: 'account', login: 'home' });
  expect(problems(found)).toEqual([
    ['down', '502'],
    ['sso', 'ssoRequired'],
    ['work', 'rateLimited'],
  ]);
  expect(found.problems[1]?.error.helpLink()?.url).toBe(
    'https://github.com/orgs/acme/sso?authorization_request=X',
  );

  // When the owner's account is the one that can't check, Lo doesn't quietly open the
  // repository with another.
  await accounts.rememberAccountForOwner('acme', 'work');
  found = await accounts.accountForRepo(ACME_APP);
  expect(found.choice).toEqual({ kind: 'unavailable', login: 'work' });
});

test('a remembered account thats signed out or unreadable is unavailable', async () => {
  const github = new GitHub();
  github.sees = ['gho_WORK', 'gho_HOME'];
  const { accounts, store, rows } = await setup(github);
  await add(accounts, 'home', 'gho_HOME');
  await add(accounts, 'work', 'gho_WORK');
  await accounts.rememberAccountForOwner('acme', 'work');
  let found = await accounts.accountForRepo(ACME_APP);
  expect(found.choice).toEqual({ kind: 'account', login: 'work' });

  // Signed out, work isn't swapped for home, which can see the repository too.
  accounts.markSignedOut('work', 'refused');
  found = await accounts.accountForRepo(ACME_APP);
  expect(found.choice).toEqual({ kind: 'unavailable', login: 'work' });
  expect(problems(found)).toEqual([['work', 'unauthorized']]);

  // After a restart, with work's token unreadable, as from a locked keychain.
  const restarted = await load({ github, store, rows });
  store.unreadable.add('work');
  found = await restarted.accountForRepo(ACME_APP);
  expect(found.choice).toEqual({ kind: 'unavailable', login: 'work' });
  expect(problems(found)).toEqual([['work', 'tokenUnavailable']]);
  expect(restarted.isSignedOut('work')).toBe(false);
});

test('the choice is read under the repositorys current owner', async () => {
  // alice/tool was transferred to bigorg, and GitHub answers for it by its name now.
  const github = new GitHub();
  github.sees = ['gho_WORK', 'gho_HOME'];
  github.fullName = 'BigOrg/tool';
  const { accounts } = await setup(github);
  await add(accounts, 'home', 'gho_HOME');
  await add(accounts, 'work', 'gho_WORK');
  await accounts.rememberAccountForOwner('alice', 'home');
  await accounts.rememberAccountForOwner('bigorg', 'work');

  const found = await accounts.accountForRepo(new RepoRef('alice', 'tool'));

  expect([found.repo.owner, found.repo.name]).toEqual(['BigOrg', 'tool']);
  expect(found.choice).toEqual({ kind: 'account', login: 'work' });
  expect(found.remembered.owner).toBe('work');
});

test('a repositorys own account is used where its owners cant see it', async () => {
  const github = new GitHub();
  github.sees = ['gho_HOME', 'gho_PERSONAL'];
  github.fullName = 'acme/secret';
  const { accounts } = await setup(github);
  for (const [login, token] of [
    ['home', 'gho_HOME'],
    ['personal', 'gho_PERSONAL'],
    ['work', 'gho_WORK'],
  ] as const) {
    await add(accounts, login, token);
  }
  await accounts.rememberAccountForOwner('acme', 'work');
  const secret = new RepoRef('acme', 'secret');

  // work, the owner's account, can't see it, and two others can.
  let found = await accounts.accountForRepo(secret);
  expect(found.choice).toEqual({ kind: 'ask', logins: ['home', 'personal'] });
  expect(found.remembered.owner).toBe('work');
  expect(found.remembered.repo).toBeUndefined();

  await accounts.rememberAccountForRepo(secret, 'personal');
  found = await accounts.accountForRepo(secret);
  expect(found.choice).toEqual({ kind: 'account', login: 'personal' });
  // The owner's choice stays for its other repositories.
  expect(await accounts.rememberedAccount('acme')).toBe('work');
  expect(await accounts.remembered(ACME_APP)).toEqual({ repo: undefined, owner: 'work' });

  // Signed out, the repository's own account isn't swapped for the other.
  accounts.markSignedOut('personal', 'refused');
  found = await accounts.accountForRepo(secret);
  expect(found.choice).toEqual({ kind: 'unavailable', login: 'personal' });
  expect(problems(found)).toEqual([['personal', 'unauthorized']]);
});

test('only when no account gets an answer is github out of reach', async () => {
  const github = new GitHub();
  github.sees = ['gho_HOME'];
  github.unreachable = ['gho_DOWN'];
  const { accounts } = await setup(github);
  await add(accounts, 'down', 'gho_DOWN');

  // The one account's check got no answer.
  const alone: unknown = await accounts.accountForRepo(ACME_APP).catch((error: unknown) => error);
  expect(alone).toBeInstanceOf(GithubError);
  expect(alone instanceof GithubError && alone.isUnreachable()).toBe(true);

  // Another account can see it, but down might too, so nothing is chosen yet, rather than
  // quietly opening as home.
  await add(accounts, 'home', 'gho_HOME');
  const either: unknown = await accounts.accountForRepo(ACME_APP).catch((error: unknown) => error);
  expect(either).toBeInstanceOf(Error);
  expect(either instanceof Error && either.message).toMatch(/^down's check got no answer/);
  expect(either instanceof Error && either.cause).toBeInstanceOf(GithubError);

  // Once home is the owner's account, down's answer can't change anything.
  await accounts.rememberAccountForOwner('acme', 'home');
  const found = await accounts.accountForRepo(ACME_APP);
  expect(found.choice).toEqual({ kind: 'account', login: 'home' });
  expect(found.visible).toEqual(['home']);

  // When down is the owner's account, it's tried again rather than refused.
  await accounts.rememberAccountForOwner('acme', 'down');
  await expect(accounts.accountForRepo(ACME_APP)).rejects.toThrow("down's check got no answer");
});

test('with no answer from any account the verdict doesnt depend on their order', async () => {
  for (const [slow, down] of [
    ['aslow', 'zdown'],
    ['zslow', 'adown'],
  ] as const) {
    const github = new GitHub();
    github.slow = ['gho_SLOW'];
    github.unreachable = ['gho_DOWN'];
    const { accounts } = await setup(github);
    await add(accounts, slow, 'gho_SLOW');
    await add(accounts, down, 'gho_DOWN');

    const error: unknown = await accounts
      .accountForRepo(ACME_APP)
      .catch((thrown: unknown) => thrown);

    expect(error instanceof GithubError && error.isUnreachable(), `${slow}, ${down}`).toBe(true);
  }
});

test('an account whose token cant be read is a problem', async () => {
  const github = new GitHub();
  github.sees = ['gho_HOME'];
  const { accounts, store, rows } = await setup(github);
  await add(accounts, 'home', 'gho_HOME');
  await add(accounts, 'work', 'gho_WORK');
  const restarted = await load({ github, store, rows });
  store.unreadable.add('work');

  const found = await restarted.accountForRepo(ACME_APP);

  expect(found.choice).toEqual({ kind: 'account', login: 'home' });
  expect(problems(found)).toEqual([['work', 'tokenUnavailable']]);
});

test('each check waits for its accounts queue', async () => {
  const github = new GitHub();
  github.sees = ['gho_HOME'];
  const { accounts } = await setup(github);
  await add(accounts, 'home', 'gho_HOME');
  await add(accounts, 'work', 'gho_WORK');
  // work's queue is busy with a poll.
  const { promise: busy, resolve: done } = Promise.withResolvers<void>();
  const queue: RequestGate = async () => {
    await busy;
    return () => undefined;
  };

  const check = accounts.accountForRepo(ACME_APP, (login) =>
    login === 'work' ? queue : undefined,
  );
  await settle();
  // home's check went ahead; work's waits its turn.
  expect(github.sent).toBe(1);

  done();
  const found = await check;
  expect(github.sent).toBe(2);
  expect(found.choice).toEqual({ kind: 'account', login: 'home' });
});

test('names that arent githubs are refused', async () => {
  const github = new GitHub();
  github.sees = ['gho_A'];
  const { accounts } = await setup(github);
  await add(accounts, 'a', 'gho_A');
  for (const [owner, name] of [
    ['acme', 'app/../../user'],
    ['acme/app', 'x'],
    ['acme', '..'],
    ['acme', 'app?x=1'],
    ['', 'app'],
  ] as const) {
    await expect(
      accounts.accountForRepo(new RepoRef(owner, name)),
      `${owner}/${name}`,
    ).rejects.toThrow("isn't a GitHub repository");
  }
  for (const [owner, name] of [
    ['acme', 'app.rs'],
    ['some_emu', 'a-b_c.d'],
  ] as const) {
    await expect(accounts.accountForRepo(new RepoRef(owner, name))).resolves.toBeDefined();
  }
});
