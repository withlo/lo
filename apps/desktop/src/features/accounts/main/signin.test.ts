// Signing in on GitHub's device flow, replayed from the synthetic cassettes, on Vitest's fake clock,
// so the tests also check when each poll went.

import type { AuthenticatedUser, Grant } from '@lo/github';
import { replayFetch, type ReplayFetch } from '@lo/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SignInState } from '../contract.ts';
import { NoKeychain } from './grants.ts';
import { SignIns } from './signin.ts';

const POLL = 'https://github.com/login/oauth/access_token';

beforeEach(() => {
  vi.useFakeTimers({ now: 1_800_000_000_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

const URLS = {
  api: 'https://api.github.com',
  web: 'https://github.com',
  uploads: 'https://uploads.github.com',
};

/** A sign-in on `fetch`, keeping what it's given and what it tells the window and the log. */
function signIns(
  fetch: typeof globalThis.fetch,
  options: {
    keyring?: () => Promise<string | undefined>;
    add?: (user: AuthenticatedUser, grant: Grant) => Promise<void>;
    pollEvery?: number;
  } = {},
) {
  const published: SignInState[] = [];
  const kept: { user: AuthenticatedUser; grant: Grant }[] = [];
  const logged: string[] = [];
  const running = new SignIns({
    fetch,
    urls: URLS,
    keyring: options.keyring ?? (() => Promise.resolve(undefined)),
    add:
      options.add ??
      ((user, grant) => {
        kept.push({ user, grant });
        return Promise.resolve();
      }),
    publish: (state) => published.push(state),
    log: (message) => logged.push(message),
    pollEvery: options.pollEvery,
  });
  return { running, published, kept, logged };
}

/** Runs the fake clock until the window has heard how the sign-in ended. */
async function untilEnded(published: readonly SignInState[]): Promise<SignInState> {
  for (let turns = 0; turns < 1000; turns++) {
    const last = published.at(-1);
    if (last !== undefined && last.kind !== 'checking') return last;
    await vi.advanceTimersToNextTimerAsync();
  }
  throw new Error('the sign-in never ended');
}

/** When each poll went, in seconds after the first request. */
function pollTimes(fetch: ReplayFetch, sent: readonly number[]): number[] {
  const start = sent[0] ?? 0;
  return fetch.seen
    .map((request, index) => ({ url: request.url, at: sent[index] ?? 0 }))
    .filter(({ url }) => url === POLL)
    .map(({ at }) => Math.floor((at - start) / 1000));
}

/** A replaying `fetch` that notes when each request went, on the fake clock. */
function timed(cassette: string): { fetch: ReplayFetch; sent: number[] } {
  const fetch = replayFetch(cassette);
  const sent: number[] = [];
  const noting = Object.assign(
    (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      sent.push(Date.now());
      return fetch(input, init);
    },
    { replay: fetch.replay, seen: fetch.seen },
  );
  return { fetch: noting, sent };
}

describe('signing in with GitHub', () => {
  it('signs in once the code is entered, and tells the window only the code and who it is', async () => {
    const { fetch, sent } = timed('device_flow_success');
    const { running, published, kept, logged } = signIns(fetch);
    const waiting = await running.start();
    expect(waiting).toEqual({
      kind: 'waiting',
      id: 1,
      userCode: 'FAKE-1234',
      expiresAt: 1_800_000_000_000 + 899_000,
      page: 'github.com/login/device',
    });
    expect(running.waiting(1)).toEqual({
      userCode: 'FAKE-1234',
      page: 'https://github.com/login/device',
    });
    expect(await untilEnded(published)).toEqual({
      kind: 'signedIn',
      id: 1,
      login: 'rozed-bot',
      name: null,
    });
    expect(published.map(({ kind }) => kind)).toEqual(['checking', 'signedIn']);
    // GitHub's interval, 5 s, and a little more.
    expect(pollTimes(fetch, sent)).toEqual([6, 12, 18]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.user.user.login).toBe('rozed-bot');
    expect(kept[0]?.grant.token.expose()).toBe('gho_FAKE_SIGNED_IN');
    expect(kept[0]?.grant.refresh?.token.expose()).toBe('ghr_FAKE_SIGNED_IN');
    // Done, it waits for nothing.
    expect(running.waiting(1)).toBeUndefined();
    // Neither the token nor the device code that gets it reaches the window or the log.
    const told = JSON.stringify([waiting, published, logged]);
    for (const secret of ['gho_FAKE', 'ghr_FAKE', 'FAKE-DEVICE-CODE']) {
      expect(told).not.toContain(secret);
    }
  });

  it('polls as often as a test asked, in place of GitHub’s interval', async () => {
    const { fetch, sent } = timed('device_flow_success');
    const { running, published, kept } = signIns(fetch, { pollEvery: 300 });
    await running.start();
    expect(await untilEnded(published)).toMatchObject({ kind: 'signedIn', login: 'rozed-bot' });
    const polls = fetch.seen.map((request, index) => ({ url: request.url, at: sent[index] ?? 0 }));
    const start = sent[0] ?? 0;
    expect(polls.filter(({ url }) => url === POLL).map(({ at }) => at - start)).toEqual([
      300, 600, 900,
    ]);
    expect(kept).toHaveLength(1);
  });

  it('polls as slowly as GitHub asks', async () => {
    const { fetch, sent } = timed('device_flow_slow_down');
    const { running, published } = signIns(fetch);
    await running.start();
    expect(await untilEnded(published)).toMatchObject({ kind: 'signedIn' });
    // 6 s; slow_down to 10 s, so 12 s later; slow_down without an interval adds 5 s, so 18 s
    // later; then 18 s again.
    expect(pollTimes(fetch, sent)).toEqual([6, 18, 36, 54]);
  });

  it('stops polling once cancelled, and tells the window nothing more', async () => {
    const fetch = replayFetch('device_flow_deadline');
    const { running, published, kept } = signIns(fetch);
    const { id } = await running.start();
    await vi.advanceTimersByTimeAsync(7_000);
    // The codes, and the poll at 6 s.
    expect(fetch.seen).toHaveLength(2);
    running.cancel(id);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch.seen).toHaveLength(2);
    expect(published).toEqual([]);
    expect(kept).toEqual([]);
    expect(running.waiting(id)).toBeUndefined();
  });

  it('cancels only the sign-in named, and a new sign-in stops the last', async () => {
    const fetch = replayFetch('device_flow_deadline');
    const { running } = signIns(fetch);
    const first = await running.start();
    running.cancel(first.id + 1);
    expect(running.waiting(first.id)).toBeDefined();
    await vi.advanceTimersByTimeAsync(7_000);
    const second = await running.start();
    expect(second.id).toBe(first.id + 1);
    expect(running.waiting(first.id)).toBeUndefined();
    // The first's codes and poll, then the second's codes and one poll: the first polls no more.
    await vi.advanceTimersByTimeAsync(7_000);
    expect(fetch.seen.map(({ url }) => new URL(url).pathname)).toEqual([
      '/login/device/code',
      '/login/oauth/access_token',
      '/login/device/code',
      '/login/oauth/access_token',
    ]);
    running.cancel();
  });

  it('refuses before asking GitHub anything when Lo has no keyring', async () => {
    const fetch = replayFetch('device_flow_success');
    const { running, published } = signIns(fetch, {
      keyring: () => Promise.resolve('Install or unlock a keyring, then start Lo again.'),
    });
    const refused: SignInState = {
      kind: 'failed',
      id: 1,
      why: 'noKeyring',
      message: 'Install or unlock a keyring, then start Lo again.',
    };
    expect(await running.start()).toEqual(refused);
    expect(published).toEqual([refused]);
    expect(fetch.seen).toEqual([]);
  });

  it('keeps nothing when the keyring goes before the token is kept', async () => {
    let asked = 0;
    const { running, published, kept } = signIns(replayFetch('device_flow_success'), {
      keyring: () => Promise.resolve(++asked === 1 ? undefined : 'No keyring answered.'),
    });
    await running.start();
    expect(await untilEnded(published)).toEqual({
      kind: 'failed',
      id: 1,
      why: 'noKeyring',
      message: 'No keyring answered.',
    });
    expect(kept).toEqual([]);
  });

  it('says there is no keyring when keeping the token finds none', async () => {
    const { running, published } = signIns(replayFetch('device_flow_success'), {
      add: () =>
        Promise.reject(
          new Error('storing the token: no', { cause: new NoKeychain('No keyring answered.') }),
        ),
    });
    await running.start();
    expect(await untilEnded(published)).toMatchObject({ why: 'noKeyring' });
  });

  it.each([
    ['device_flow_expired', 'expired', 'The code expired before it was entered on GitHub.'],
    ['device_flow_denied', 'denied', 'The sign-in was cancelled on GitHub.'],
    [
      'device_flow_refused',
      'refused',
      'GitHub refused the sign-in: The client_id and/or client_secret passed are incorrect.',
    ],
    ['device_flow_missing_scope', 'missingScopes', 'The token is missing the workflow scope.'],
  ])('ends without an account on %s', async (cassette, why, message) => {
    const { running, published, kept } = signIns(replayFetch(cassette));
    await running.start();
    expect(await untilEnded(published)).toEqual({ kind: 'failed', id: 1, why, message });
    expect(kept).toEqual([]);
  });

  it("says when GitHub can't be reached, or refuses the code", async () => {
    const offline = signIns(() =>
      Promise.reject(new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') })),
    );
    expect(await offline.running.start()).toMatchObject({ kind: 'failed', why: 'offline' });
    const unknown = signIns(replayFetch('device_flow_unknown_client'));
    expect(await unknown.running.start()).toMatchObject({ kind: 'failed', why: 'refused' });
  });

  it('starts nothing once Lo is quitting', async () => {
    const fetch = replayFetch('device_flow_deadline');
    const { running, published } = signIns(fetch);
    await running.start();
    running.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch.seen).toHaveLength(1);
    expect(await running.start()).toEqual({ kind: 'cancelled', id: 2 });
    expect(fetch.seen).toHaveLength(1);
    expect(published).toEqual([]);
  });

  it("logs what it can't say, and never a token", async () => {
    const { running, published, logged } = signIns(replayFetch('device_flow_success'), {
      add: () => Promise.reject(new Error('the database is locked')),
    });
    await running.start();
    expect(await untilEnded(published)).toEqual({
      kind: 'failed',
      id: 1,
      why: 'failed',
      message: "Lo couldn't keep the account. Try signing in again.",
    });
    expect(logged).toEqual(['signing in: the database is locked']);
  });
});
