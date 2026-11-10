import { MemoryStore, Replay, replayFetch, type Interaction, type Json } from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient, USER_AGENT, type OnUnauthorized } from './client.ts';
import { GithubError } from './errors.ts';
import { unchecked } from './json.ts';
import { Token } from './token.ts';

/** A response to replay: method, URL, status, headers and body. */
type Canned = [
  method: string,
  url: string,
  status: number,
  headers: Record<string, string>,
  body: string,
];

function replay(...canned: Canned[]) {
  const interactions: Interaction[] = canned.map(([method, url, status, headers, body]) => ({
    request: { method, url },
    response: { status, headers, body: parse(body) },
  }));
  return replayFetch(new Replay('test', interactions));
}

function parse(body: string): Json | undefined {
  try {
    return unchecked<Json>(JSON.parse(body));
  } catch {
    return undefined;
  }
}

function client(fetch: typeof globalThis.fetch, options: { onUnauthorized?: OnUnauthorized } = {}) {
  return new GithubClient({ fetch, token: new Token('gho_FAKE'), ...options });
}

const json = unchecked<Json>;
const BAD_CREDENTIALS = '{"message":"Bad credentials","status":"401"}';

test('sends githubs headers', async () => {
  const fetch = replay(['GET', 'https://api.github.com/user', 200, {}, '{}']);
  await client(fetch).get('/user', json);
  const [seen] = fetch.seen;
  expect(seen?.headers.get('authorization')).toBe('token gho_FAKE');
  expect(seen?.headers.get('accept')).toBe('application/vnd.github+json');
  expect(seen?.headers.get('x-github-api-version')).toBe('2022-11-28');
  expect(seen?.headers.get('user-agent')).toBe(USER_AGENT);
  expect(seen?.headers.get('if-none-match')).toBeNull();

  // The app names its version.
  const named = replay(['GET', 'https://api.github.com/user', 200, {}, '{}']);
  await new GithubClient({ fetch: named, token: new Token('gho_FAKE'), userAgent: 'lo/1.2.3' }).get(
    '/user',
    json,
  );
  expect(named.seen[0]?.headers.get('user-agent')).toBe('lo/1.2.3');
});

test('a get modified since a time sends it', async () => {
  const date = 'Fri, 06 Nov 2026 08:15:07 GMT';
  const fetch = replayFetch(
    new Replay('test', [
      {
        request: {
          method: 'GET',
          url: 'https://api.github.com/repos/o/r/pulls/1',
          if_modified_since: date,
        },
        response: { status: 304, headers: {} },
      },
    ]),
  );
  const answer = await client(fetch).getModifiedSince('/repos/o/r/pulls/1', date, json);
  expect(answer).toEqual({ notModified: true });
  expect(fetch.seen[0]?.headers.get('if-modified-since')).toBe(date);
  expect(fetch.seen[0]?.headers.get('if-none-match')).toBeNull();
});

test('only a client made without a token sends none', async () => {
  const fetch = replay(
    ['GET', 'https://api.github.com/user', 401, {}, BAD_CREDENTIALS],
    ['GET', 'https://api.github.com/user', 401, {}, BAD_CREDENTIALS],
  );
  // An account whose stored token is empty still sends it, so GitHub refuses it and the account
  // is signed out, rather than reading as nobody.
  const empty = new GithubClient({ fetch, token: new Token('  ') });
  const error = await empty.get('/user', json).catch((thrown: unknown) => thrown);
  expect(error instanceof GithubError && error.isUnauthorized()).toBe(true);
  expect(fetch.seen[0]?.headers.has('authorization')).toBe(true);
  expect(empty.token).toBeDefined();

  const anonymous = new GithubClient({ fetch });
  await expect(anonymous.get('/user', json)).rejects.toThrow(GithubError);
  expect(fetch.seen[1]?.headers.get('authorization')).toBeNull();
  expect(anonymous.token).toBeUndefined();
});

test('errors keep githubs message', async () => {
  const fetch = replay([
    'GET',
    'https://api.github.com/user',
    401,
    {},
    '{"message":"Bad credentials","documentation_url":"https://docs.github.com/rest","status":"401"}',
  ]);
  const error = await client(fetch)
    .get('/user', json)
    .catch((thrown: unknown) => thrown);
  expect(error instanceof GithubError && error.isUnauthorized()).toBe(true);
  expect(String(error)).toContain('Bad credentials');
});

test('tracks the rate limit and sso header per account', async () => {
  const fetch = replay([
    'GET',
    'https://api.github.com/user/repos',
    200,
    {
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4321',
      'x-ratelimit-used': '679',
      'x-ratelimit-reset': '1762419600',
      'x-ratelimit-resource': 'core',
      'x-github-sso': 'partial-results; organizations=1,2',
    },
    '[]',
  ]);
  const account = client(fetch);
  const other = new GithubClient({ fetch, token: new Token('gho_OTHER') });
  await account.get('/user/repos', json);
  expect(account.rateLimits().core()?.remaining).toBe(4321);
  expect(account.state().sso?.organizations).toEqual([1, 2]);
  expect(other.rateLimits().core()).toBeUndefined();
  // A gated client shares them.
  expect(
    account
      .gated(() => Promise.resolve(() => undefined))
      .rateLimits()
      .core()?.used,
  ).toBe(679);
});

/** A hook that hands out `next`, noting each token it was given. */
function hook(next: string | undefined): [OnUnauthorized, string[]] {
  const refused: string[] = [];
  const onUnauthorized: OnUnauthorized = (token) => {
    refused.push(token.expose());
    return Promise.resolve(next === undefined ? undefined : new Token(next));
  };
  return [onUnauthorized, refused];
}

test('a 401 asks the hook and retries once with its token', async () => {
  const fetch = replay(
    ['GET', 'https://api.github.com/user', 401, {}, BAD_CREDENTIALS],
    ['GET', 'https://api.github.com/user', 200, {}, '{}'],
  );
  const [onUnauthorized, refused] = hook('gho_NEW');
  const account = client(fetch, { onUnauthorized });
  const other = account.gated(() => Promise.resolve(() => undefined));
  await account.get('/user', json);
  expect(refused).toEqual(['gho_FAKE']);
  expect(fetch.seen[0]?.headers.get('authorization')).toBe('token gho_FAKE');
  expect(fetch.seen[1]?.headers.get('authorization')).toBe('token gho_NEW');
  // Every client sharing the token uses the new one from now on.
  expect(other.token?.expose()).toBe('gho_NEW');
});

test('without a new token the 401 is returned', async () => {
  const fetch = replay(['GET', 'https://api.github.com/user', 401, {}, BAD_CREDENTIALS]);
  const [onUnauthorized, refused] = hook(undefined);
  const error = await client(fetch, { onUnauthorized })
    .get('/user', json)
    .catch((thrown: unknown) => thrown);
  expect(error instanceof GithubError && error.isUnauthorized()).toBe(true);
  expect(refused).toHaveLength(1);
  expect(fetch.seen).toHaveLength(1);
});

test('a 401 on the retry is returned without asking again', async () => {
  const fetch = replay(['GET', 'https://api.github.com/user', 401, {}, BAD_CREDENTIALS]);
  const [onUnauthorized, refused] = hook('gho_NEW');
  const error = await client(fetch, { onUnauthorized })
    .get('/user', json)
    .catch((thrown: unknown) => thrown);
  expect(error instanceof GithubError && error.isUnauthorized()).toBe(true);
  expect(refused).toEqual(['gho_FAKE']);
  expect(fetch.seen).toHaveLength(2);
});

test('the token goes only to githubs api hosts', async () => {
  const fetch = replay();
  const account = client(fetch);
  for (const url of [
    'https://evil.example/x',
    'https://api.github.com.evil.example/x',
    'https://github.com/login',
    'http://api.github.com/user',
    'https://api.github.com:8443/user',
    'https://someone@api.github.com/user',
    'file:///etc/passwd',
  ]) {
    const error = await account.get(url, json).catch((thrown: unknown) => thrown);
    expect(error instanceof GithubError ? error.detail.kind : error).toBe('refusedUrl');
    expect(String(error)).not.toContain('/x');
  }
  expect(fetch.seen).toHaveLength(0);
});

test('a full url is used as is', async () => {
  const fetch = replay(['GET', 'https://uploads.github.com/x', 200, {}, '{}']);
  await client(fetch).get('https://uploads.github.com/x', json);
  expect(fetch.seen[0]?.url).toBe('https://uploads.github.com/x');
});

test('other addresses stand in for GitHub, and the token goes only to them', async () => {
  const fetch = replay(['GET', 'http://127.0.0.1:5000/api/user', 200, {}, '{"login":"rozed-bot"}']);
  const account = new GithubClient({
    fetch,
    token: new Token('gho_FAKE'),
    urls: { api: 'http://127.0.0.1:5000/api', uploads: 'http://127.0.0.1:5000/uploads' },
  });
  expect((await account.user()).user.login).toBe('rozed-bot');
  await expect(account.get('https://api.github.com/user', json)).rejects.toThrow(
    "Lo sends GitHub requests only to GitHub's API",
  );
  await expect(account.get('http://127.0.0.1:5000/web/login', json)).rejects.toThrow(GithubError);
});

test('a redirect is followed only to where the token may go', async () => {
  const fetch = replay(
    [
      'GET',
      'https://api.github.com/repos/old/r',
      301,
      { location: 'https://api.github.com/repositories/1' },
      '',
    ],
    ['GET', 'https://api.github.com/repositories/1', 200, {}, '{"id":1}'],
    [
      'GET',
      'https://api.github.com/repos/o/away',
      302,
      { location: 'https://evil.example/steal' },
      '',
    ],
  );
  const account = client(fetch);
  expect(await account.get('/repos/old/r', json)).toEqual({ id: 1 });
  await expect(account.get('/repos/o/away', json)).rejects.toThrow('not evil.example');
  expect(fetch.seen.map(({ url }) => url)).toEqual([
    'https://api.github.com/repos/old/r',
    'https://api.github.com/repositories/1',
    'https://api.github.com/repos/o/away',
  ]);
});

test("a stored ETag's 304 is answered from the store", async () => {
  const url = 'https://api.github.com/repos/o/r/pulls/1';
  const fetch = replayFetch(
    new Replay('test', [
      {
        request: { method: 'GET', url },
        response: { status: 200, headers: { etag: 'W/"1"' }, body: { n: 1 } },
      },
      {
        request: { method: 'GET', url, if_none_match: 'W/"1"' },
        response: { status: 304, headers: { etag: 'W/"1"' } },
      },
    ]),
  );
  const store = new MemoryStore();
  const account = new GithubClient({ fetch, token: new Token('gho_FAKE'), store });
  expect(await account.getStored('/repos/o/r/pulls/1', json)).toEqual({
    value: { n: 1 },
    changed: true,
  });
  expect(await account.getStored('/repos/o/r/pulls/1', json)).toEqual({
    value: { n: 1 },
    changed: false,
  });
  expect(store.answers.get(url)).toEqual({ etag: 'W/"1"', body: '{"n":1}' });
});

test('a store that fails is gone around', async () => {
  const url = 'https://api.github.com/repos/o/r/pulls/1';
  const fetch = replay(['GET', url, 200, { etag: 'W/"1"' }, '{"n":1}']);
  const store = new MemoryStore();
  store.failing = true;
  const account = new GithubClient({ fetch, token: new Token('gho_FAKE'), store });
  expect(await account.getStored('/repos/o/r/pulls/1', json)).toEqual({
    value: { n: 1 },
    changed: true,
  });
  expect(await account.getStored('/repos/o/r/pulls/1', json)).toEqual({
    value: { n: 1 },
    changed: true,
  });
  expect(fetch.seen.every((request) => !request.headers.has('if-none-match'))).toBe(true);
});

test("fetch's failures say whether GitHub was reached", async () => {
  const refused = Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }),
  });
  const offline = new GithubClient({
    fetch: () => Promise.reject(refused),
    token: new Token('gho_FAKE'),
  });
  const error = await offline.get('/user', json).catch((thrown: unknown) => thrown);
  expect(error instanceof GithubError && error.isUnreachable()).toBe(true);
  expect(error instanceof GithubError && error.mayHavePosted()).toBe(false);

  const reset = Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
  });
  const lost = new GithubClient({
    fetch: () => Promise.reject(reset),
    token: new Token('gho_FAKE'),
  });
  const lostError = await lost.get('/user', json).catch((thrown: unknown) => thrown);
  expect(lostError instanceof GithubError && lostError.isRetryable()).toBe(true);
  expect(lostError instanceof GithubError && lostError.mayHavePosted()).toBe(true);
  // What the client was given decides, when it knows better.
  const custom = new GithubClient({
    fetch: () => Promise.reject(new Error('net::ERR_SOMETHING_NEW')),
    token: new Token('gho_FAKE'),
    classify: () => 'offline',
  });
  const customError = await custom.get('/user', json).catch((thrown: unknown) => thrown);
  expect(customError instanceof GithubError && customError.isUnreachable()).toBe(true);
});

test('a redirect is not followed when the request says so', async () => {
  const fetch = replayFetch(
    new Replay('test', [
      {
        request: { method: 'POST', url: 'https://uploads.github.com/x', body: 'file' },
        response: { status: 307, headers: { location: 'https://uploads.github.com/y' } },
      },
    ]),
  );
  const response = await client(fetch).send('POST', 'https://uploads.github.com/x', {
    body: 'file',
    answers: [307],
    followRedirects: false,
  });
  expect(response.status).toBe(307);
  expect(fetch.seen).toHaveLength(1);
});
