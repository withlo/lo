// GitHub as the accounts feature provides it, on its tables and a stand-in keychain, with GitHub
// replayed from the recorded cassettes on Vitest's fake clock.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GITHUB_URLS,
  GithubError,
  PullRef,
  RepoRef,
  Token,
  type Account,
  type AccountRows,
  type AuthenticatedUser,
  type GitHubUrls,
  type Grant,
} from '@lo/github';
import { MemoryAccountRows } from '@lo/testing';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import type { Database } from '../../../main/database.ts';
import type { GithubEvent } from '../service.ts';
import { Github } from './github.ts';
import { Grants } from './grants.ts';
import { accountsDatabase, FakeStorage, replaying, TOKEN } from './test/support.ts';

/** When each test starts, in seconds since the Unix epoch: after every recorded rate limit resets. */
const START = 1_794_100_000;
const LOGIN = 'rozed-bot';
const pr = (number: number) => new PullRef('rozed-dev', 'playground', number);

function user(): AuthenticatedUser {
  return {
    user: { login: LOGIN, id: 353226052, name: null, avatar_url: null },
    scopes: ['read:org', 'repo', 'workflow'],
  };
}

/** A GitHub that refuses every token. */
const refusing: typeof globalThis.fetch = () =>
  Promise.resolve(new Response('{"message":"Bad credentials"}', { status: 401 }));

/** A GitHub where every account can see `rozed-dev/playground`. */
const seeing: typeof globalThis.fetch = () =>
  Promise.resolve(Response.json({ full_name: 'rozed-dev/playground' }));

/** A GitHub whose `/user` refuses `refused`, and whose renewals answer `renewal`. */
function renewing(
  refused: string,
  renewal: () => Response | Promise<Response>,
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/login/oauth/access_token') return renewal();
    if (request.headers.get('authorization') === `token ${refused}`) {
      return new Response('{"message":"Bad credentials"}', { status: 401 });
    }
    return Response.json(
      { login: LOGIN, id: 353226052 },
      { headers: { 'x-oauth-scopes': 'read:org, repo, workflow' } },
    );
  };
}

/** GitHub's answer to a renewal. */
const renewed = () =>
  Response.json({
    access_token: 'gho_FAKE_RENEWED',
    expires_in: 28_800,
    refresh_token: 'ghr_FAKE_RENEWED',
    refresh_token_expires_in: 15_811_200,
    token_type: 'bearer',
  });

/** A grant whose token expires. */
const expiring: Grant = {
  token: new Token(TOKEN),
  refresh: { token: new Token('ghr_FAKE_FIRST'), issuedAt: START, expiresAt: START + 28_800 },
};

/** The grant kept for rozed-bot, read as a fresh start would. */
async function kept(database: Database, storage: FakeStorage) {
  const grants = new Grants({
    database,
    storage,
    keychain: { platform: 'darwin', testRun: false, mockKeychain: false },
    github: GITHUB_URLS.api,
  });
  return (await grants.read(LOGIN))?.token.expose();
}

/** A fetch for a network that's down. */
const offline: typeof globalThis.fetch = () =>
  Promise.reject(
    new TypeError('fetch failed', {
      cause: Object.assign(new Error('down'), { code: 'ENETDOWN' }),
    }),
  );

interface Started {
  github: Github;
  database: Database;
  storage: FakeStorage;
  /** Everything it logged. */
  logged: string[];
  /** Every event it sent, briefly. */
  events: string[];
}

/** The accounts feature's GitHub on `database`, as `build`. */
function start(
  options: {
    fetch?: typeof globalThis.fetch;
    database?: Database;
    storage?: FakeStorage;
    build?: string;
    urls?: GitHubUrls;
    rows?: AccountRows;
  } = {},
): Started {
  const database = options.database ?? accountsDatabase();
  const storage = options.storage ?? new FakeStorage();
  const secrets = new Grants({
    database,
    storage,
    keychain: { platform: 'darwin', testRun: false, mockKeychain: false },
    github: GITHUB_URLS.api,
  });
  const logged: string[] = [];
  const github = new Github({
    database,
    secrets,
    fetch: options.fetch ?? offline,
    build: options.build ?? 'build-1',
    urls: options.urls,
    rows: options.rows,
    log: (message) => logged.push(message),
    poll: { jitter: 0 },
  });
  const events: string[] = [];
  github.onEvent((event) => events.push(brief(event)));
  onTestFinished(() => github.stop(0));
  return { github, database, storage, logged, events };
}

/** An event, briefly. */
function brief(event: GithubEvent): string {
  switch (event.kind) {
    case 'seen':
      return `seen ${event.pull.toString()} by ${event.login}: ${event.heads.join(', ')}`;
    case 'signedOut':
      return `signedOut ${event.login}: ${event.why}`;
    case 'removed':
    case 'cantSave':
    case 'cantSaveOver':
      return `${event.kind} ${event.login}`;
    default:
      throw new Error(`an event the test doesn't know: ${JSON.stringify(event satisfies never)}`);
  }
}

function rows(database: Database, sql: string): unknown[] {
  return database.prepare(sql).all();
}

/** Runs what's ready now on the fake clock. */
const run = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ now: START * 1000 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('accounts', () => {
  it('adds the account in a token file once GitHub says whose it is', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'lo-accounts-'));
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
    const file = join(folder, 'token');
    writeFileSync(file, `${TOKEN}\n`);
    const { github, database, logged } = start({ fetch: replaying('user') });
    await github.addFromFile(file);
    expect(await github.accounts()).toMatchObject([
      {
        account: { login: LOGIN, userId: 353226052, source: 'deviceFlow' },
        signedOut: undefined,
        cantSave: false,
      },
    ]);
    expect(rows(database, 'SELECT login FROM accounts_grants')).toEqual([{ login: LOGIN }]);
    expect((await github.client(LOGIN)).token?.expose()).toBe(TOKEN);
    expect(logged).toEqual([]);
  });

  it("refuses a token file's token without repeating it", async () => {
    const folder = mkdtempSync(join(tmpdir(), 'lo-accounts-'));
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
    const file = join(folder, 'token');
    writeFileSync(file, `${TOKEN} and more`);
    const { github } = start();
    const error: unknown = await github.addFromFile(file).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(GithubError);
    expect(String(error)).not.toContain(TOKEN);
    expect(await github.accounts()).toEqual([]);
  });

  it('says an account is signed out when GitHub refuses its token, after a restart too', async () => {
    const { github, database, events } = start({ fetch: refusing });
    await github.add(user(), { token: new Token(TOKEN) }, 'deviceFlow');
    const changes = vi.fn<() => void>();
    github.onChange(changes);
    const client = await github.client(LOGIN);
    await expect(client.user()).rejects.toBeInstanceOf(GithubError);
    expect(events).toEqual(['signedOut rozed-bot: refused']);
    expect(changes).toHaveBeenCalled();
    expect(await github.accounts()).toMatchObject([{ signedOut: 'refused' }]);
    // The refused token is gone, and the account stays signed out until it signs in again.
    expect(rows(database, 'SELECT login FROM accounts_grants')).toEqual([]);
    const again = start({ database });
    expect(await again.github.accounts()).toMatchObject([
      { account: { login: LOGIN }, signedOut: 'refused' },
    ]);
  });

  it('removes an account and everything kept for it, stops its poller, and says so', async () => {
    const { github, database, events } = start({ fetch: replaying('poll_playground') });
    await github.add(user(), { token: new Token(TOKEN) }, 'deviceFlow');
    const poller = await github.poller(LOGIN);
    void poller.setOpen(pr(1));
    await run();
    await github.rememberAccountForOwner('rozed-dev', LOGIN);
    expect(rows(database, 'SELECT count(*) AS n FROM accounts_answers')).not.toEqual([{ n: 0 }]);
    expect(github.recent()).toHaveLength(1);

    await github.remove('ROZED-BOT');
    expect(events).toContain('removed rozed-bot');
    expect(await github.accounts()).toEqual([]);
    for (const table of ['accounts', 'grants', 'answers', 'recent', 'owners']) {
      expect(rows(database, `SELECT count(*) AS n FROM accounts_${table}`)).toEqual([{ n: 0 }]);
    }
    await expect(github.poller(LOGIN)).rejects.toThrow("Lo isn't signed in to rozed-bot");
    // A stopped poller asks GitHub nothing more.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
  });

  it('gives the anonymous client no token, and polls nothing for it', () => {
    const { github } = start();
    expect(github.anonymous.token).toBeUndefined();
    expect(github.anonymous.urls).toEqual(GITHUB_URLS);
  });
});

describe('polling', () => {
  it("polls what's open through the account's poller, keeping what it read in the database", async () => {
    const fetch = replaying('poll_playground');
    const { github, database, events, logged } = start({ fetch });
    await github.add(user(), { token: new Token(TOKEN) }, 'deviceFlow');
    const poller = await github.poller(LOGIN);
    const polled: string[] = [];
    poller.onEvent((event) => polled.push(event.kind));
    expect(await poller.setOpen(pr(1))).toBeUndefined();
    await run();

    expect(polled).toEqual(['summary', 'check', 'details', 'trunkRules', 'openPullRequests']);
    expect(poller.pullRequest(pr(1))?.details.title).toBe('feat: stack layer A');
    // Every request carried the account's token, and only to GitHub's API.
    expect(
      fetch.seen.every((request) => request.headers.get('authorization') === `token ${TOKEN}`),
    ).toBe(true);
    expect(
      rows(database, 'SELECT login, target, name FROM accounts_answers ORDER BY target, name'),
    ).toEqual([
      { login: LOGIN, target: 'rozed-dev/playground', name: 'ListedPulls' },
      { login: LOGIN, target: 'rozed-dev/playground', name: 'OpenPullRequests' },
      { login: LOGIN, target: 'rozed-dev/playground', name: 'TrunkRules' },
      { login: LOGIN, target: 'rozed-dev/playground#1', name: 'PullRequest' },
      { login: LOGIN, target: 'rozed-dev/playground#1', name: 'PullRequestCheck' },
      { login: LOGIN, target: 'rozed-dev/playground#1', name: 'PullSummary' },
    ]);
    expect(events.filter((event) => event.startsWith('seen'))).toHaveLength(1);
    expect(events[0]).toMatch(/^seen rozed-dev\/playground#1 by rozed-bot: [0-9a-f]{40}/);
    expect(github.recent()).toMatchObject([
      { pull: pr(1), title: 'feat: stack layer A', login: LOGIN, openedAt: START * 1000 },
    ]);
    expect(logged).toEqual([]);
  });

  it('shows a pull request opened again at once after a restart, from the database', async () => {
    const first = start({ fetch: replaying('poll_playground') });
    await first.github.add(user(), { token: new Token(TOKEN) }, 'deviceFlow');
    void (await first.github.poller(LOGIN)).setOpen(pr(1));
    await run();
    await first.github.stop(0);

    // Lo starts again, offline, and the same build reads back what the poller kept.
    const again = start({ database: first.database, storage: first.storage });
    const shown = await (await again.github.poller(LOGIN)).setOpen(pr(1));
    expect(shown?.details.title).toBe('feat: stack layer A');
    expect(shown?.fetchedAt).toBe(START * 1000);

    // Another build doesn't, nor the same build talking to another GitHub.
    const other = start({ database: first.database, storage: first.storage, build: 'build-2' });
    expect(await (await other.github.poller(LOGIN)).setOpen(pr(1))).toBeUndefined();
    const local = start({
      database: first.database,
      storage: first.storage,
      urls: {
        api: 'http://127.0.0.1:4567/api',
        web: 'http://127.0.0.1:4567/web',
        uploads: 'http://127.0.0.1:4567/uploads',
      },
    });
    expect(await (await local.github.poller(LOGIN)).setOpen(pr(1))).toBeUndefined();
  });

  it('polls faster while Lo is in the foreground', async () => {
    const fetch = replaying('poll_playground');
    const { github } = start({ fetch });
    await github.add(user(), { token: new Token(TOKEN) }, 'deviceFlow');
    github.setForeground(false);
    const poller = await github.poller(LOGIN);
    expect(poller.foreground).toBe(false);
    github.setForeground(true);
    expect(poller.foreground).toBe(true);
    // A poller for an account added later starts as Lo is.
    github.setForeground(false);
    await github.add(
      { user: { login: 'other', id: 2 }, scopes: ['repo', 'read:org', 'workflow'] },
      { token: new Token('gho_FAKE_OTHER') },
      'deviceFlow',
    );
    expect((await github.poller('other')).foreground).toBe(false);
  });

  it("checks each account's access to a repository in its poller's queue", async () => {
    const { github } = start({ fetch: seeing });
    await github.add(user(), { token: new Token(TOKEN) }, 'deviceFlow');
    const poller = await github.poller(LOGIN);
    const gate = vi.spyOn(poller.queue, 'gate');
    const found = await github.accountForRepo(new RepoRef('Rozed-Dev', 'Playground'));
    expect(found).toMatchObject({ choice: { kind: 'account', login: LOGIN }, visible: [LOGIN] });
    expect(found.repo.toString()).toBe('rozed-dev/playground');
    expect(gate).toHaveBeenCalledOnce();
  });

  it('remembers the account chosen for an owner and for a repository', async () => {
    const { github, database } = start();
    await github.add(user(), { token: new Token(TOKEN) }, 'deviceFlow');
    await github.rememberAccountForOwner('rozed-dev', LOGIN);
    await github.rememberAccountForRepo(new RepoRef('acme', 'app'), LOGIN);
    expect(rows(database, 'SELECT owner, login FROM accounts_owners')).toEqual([
      { owner: 'rozed-dev', login: LOGIN },
    ]);
    expect(rows(database, 'SELECT owner, name, login FROM accounts_repos')).toEqual([
      { owner: 'acme', name: 'app', login: LOGIN },
    ]);
  });
});

describe('saving before quitting', () => {
  it('saves a renewed token the keychain refused, as Lo quits', async () => {
    const storage = new FakeStorage();
    const { github, database, events } = start({ fetch: renewing(TOKEN, renewed), storage });
    await github.add(user(), expiring, 'deviceFlow');
    // The keychain refuses the renewed pair, which Lo uses all the same.
    storage.refusingWrites = true;
    const client = await github.client(LOGIN);
    await client.user();
    expect(client.token?.expose()).toBe('gho_FAKE_RENEWED');
    expect(await kept(database, storage)).toBe(TOKEN);

    storage.refusingWrites = false;
    await github.stop(4_000);
    expect(await kept(database, storage)).toBe('gho_FAKE_RENEWED');
    expect(events).toEqual([]);
  });

  it("waits for a renewal GitHub is answering, but no longer than it's given", async () => {
    const storage = new FakeStorage();
    const answered = Promise.withResolvers<Response>();
    const { github, database, logged } = start({
      fetch: renewing(TOKEN, () => answered.promise),
      storage,
    });
    await github.add(user(), expiring, 'deviceFlow');
    const client = await github.client(LOGIN);
    const asking = client.user().catch(() => undefined);
    await run();

    // A renewal that's answered in time is saved.
    const stopping = github.stop(4_000);
    await vi.advanceTimersByTimeAsync(3_000);
    answered.resolve(renewed());
    await stopping;
    await asking;
    expect(await kept(database, storage)).toBe('gho_FAKE_RENEWED');
    expect(logged).toEqual([]);
  });

  it('gives up on a renewal that runs past its limit, so the database can close', async () => {
    const storage = new FakeStorage();
    const { github, logged } = start({
      fetch: renewing(TOKEN, () => new Promise<never>(() => {})),
      storage,
    });
    await github.add(user(), expiring, 'deviceFlow');
    void (await github.client(LOGIN)).user().catch(() => undefined);
    await run();
    let done = false;
    void github.stop(4_000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(3_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(logged).toEqual([
      'a renewal was still out after 4000 ms, so its token may not be saved',
    ]);
  });

  it('counts its limit from when it starts stopping, the accounts still loading included', async () => {
    const slow = new MemoryAccountRows<Account>();
    const loading = Promise.withResolvers<Account[]>();
    slow.accounts = () => loading.promise;
    const { github, logged } = start({ rows: slow });
    let done = false;
    void github.stop(4_000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(3_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(logged).toEqual(['the accounts were still loading after 4000 ms, so nothing was saved']);
    loading.resolve([]);
  });

  it('has nothing to wait for when every grant is saved', async () => {
    const { github } = start();
    await github.add(user(), expiring, 'deviceFlow');
    let done = false;
    void github.stop(4_000).then(() => (done = true));
    await run();
    expect(done).toBe(true);
  });
});
