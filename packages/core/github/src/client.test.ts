import { MemoryStore, Replay, replayFetch, type Interaction, type Json } from '@lo/testing';
import { expect, test, vi } from 'vitest';

import {
  ANSWER_START_MS,
  GithubClient,
  USER_AGENT,
  type FetchInit,
  type OnUnauthorized,
} from './client.ts';
import { GithubError } from './errors.ts';
import { AddCommentDocument, ViewerDocument } from './generated/graphql.ts';
import { unchecked } from './json.ts';
import { RequestQueue } from './poll/queue.ts';
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

test('GitHub’s clock is read from its answers’ dates, for every client sharing the state', async () => {
  const fetch = replay(
    ['GET', 'https://api.github.com/user', 200, {}, '{}'],
    ['GET', 'https://api.github.com/user', 200, { date: 'Fri, 13 Nov 2026 12:00:00 GMT' }, '{}'],
  );
  const account = client(fetch);
  await account.get('/user', json);
  expect(account.githubAhead()).toBeUndefined();
  const before = Date.now();
  await account.get('/user', json);
  const ahead = account.githubAhead();
  expect(ahead).toBeLessThanOrEqual(Date.parse('2026-11-13T12:00:00Z') - before);
  expect(ahead).toBeGreaterThanOrEqual(Date.parse('2026-11-13T12:00:00Z') - Date.now());
  expect(account.gated(() => Promise.resolve(() => {})).githubAhead()).toBe(ahead);
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

test('a header that cannot be sent is refused without saying what it held', async () => {
  const fetch = replay();
  const account = new GithubClient({
    fetch,
    token: new Token('gho_FAKE'),
    userAgent: 'lo\r\nx-secret: gho_SECRET',
  });
  const error = await account.get('/user', json).catch((thrown: unknown) => thrown);
  expect(error instanceof GithubError && error.detail.kind).toBe('decode');
  const said = error instanceof Error ? [error.message, error.stack, String(error.cause)] : [];
  expect(said.filter((text) => text?.includes('gho_SECRET'))).toEqual([]);
  expect(fetch.seen).toHaveLength(0);
});

/** A redirect from `/r<from>` to the next one. */
function hop(from: number): Canned {
  return [
    'GET',
    `https://api.github.com/r${from}`,
    301,
    { location: `https://api.github.com/r${from + 1}` },
    '',
  ];
}

test('no more than three redirects are followed', async () => {
  const fetch = replay(hop(0), hop(1), hop(2), hop(3), [
    'GET',
    'https://api.github.com/r4',
    200,
    {},
    '{}',
  ]);
  const error = await client(fetch)
    .get('/r0', json)
    .catch((thrown: unknown) => thrown);
  expect(error instanceof GithubError && error.detail).toMatchObject({ kind: 'api', status: 301 });
  expect(fetch.seen.map(({ url }) => url)).toEqual([
    'https://api.github.com/r0',
    'https://api.github.com/r1',
    'https://api.github.com/r2',
    'https://api.github.com/r3',
  ]);
});

test('a store that throws, or keeps an answer that no longer reads, is gone around', async () => {
  const url = 'https://api.github.com/repos/o/r/pulls/1';
  const fetch = replayFetch(
    new Replay('test', [
      {
        request: { method: 'GET', url, if_none_match: 'W/"1"' },
        response: { status: 304, headers: { etag: 'W/"1"' } },
      },
      {
        request: { method: 'GET', url },
        response: { status: 200, headers: { etag: 'W/"2"' }, body: { n: 2 } },
      },
    ]),
  );
  const store = new MemoryStore();
  store.answers.set(url, { etag: 'W/"1"', body: 'not JSON' });
  const account = new GithubClient({ fetch, token: new Token('gho_FAKE'), store });
  expect(await account.getStored('/repos/o/r/pulls/1', json)).toEqual({
    value: { n: 2 },
    changed: true,
  });
  expect(store.answers.get(url)).toEqual({ etag: 'W/"2"', body: '{"n":2}' });

  const throwing = new GithubClient({
    fetch: replay(['GET', url, 200, {}, '{"n":3}']),
    token: new Token('gho_FAKE'),
    store: {
      get: () => {
        throw new Error('the store is gone');
      },
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
  });
  expect(await throwing.getStored('/repos/o/r/pulls/1', json)).toEqual({
    value: { n: 3 },
    changed: true,
  });
});

test('a kept ETag that cannot go in a header is dropped, and the read made in full', async () => {
  const url = 'https://api.github.com/repos/o/r/pulls/1';
  for (const etag of ['W/"a\u0000b"', 'W/"é…"', 'W/"a\r\nb"']) {
    const fetch = replay(['GET', url, 200, { etag: 'W/"2"' }, '{"n":2}']);
    const store = new MemoryStore();
    store.answers.set(url, { etag, body: '{"n":1}' });
    const account = new GithubClient({ fetch, token: new Token('gho_FAKE'), store });
    expect(await account.getStored('/repos/o/r/pulls/1', json)).toEqual({
      value: { n: 2 },
      changed: true,
    });
    expect(store.answers.get(url)?.etag).toBe('W/"2"');
  }
});

test('an upload hands its fetch where to report progress, which plain fetch ignores', async () => {
  const heard: [number, number][] = [];
  let given: FetchInit | undefined;
  const fetch: typeof globalThis.fetch = (_input, init?: FetchInit) => {
    given = init;
    init?.uploadProgress?.(3, 4);
    return Promise.resolve(new Response('{}', { status: 201 }));
  };
  await client(fetch).send('POST', 'https://uploads.github.com/user-attachments/assets', {
    body: new Uint8Array(4),
    uploadProgress: (sent, total) => heard.push([sent, total]),
  });
  expect(heard).toEqual([[3, 4]]);
  expect(given?.signal).toBeInstanceOf(AbortSignal);

  // A fetch that can't tell, as the replayer's, which makes a `Request` of what it's given.
  const plain = replayFetch(
    new Replay('test', [
      {
        request: { method: 'POST', url: 'https://uploads.github.com/x', body: 'abcd' },
        response: { status: 201, headers: {}, body: {} },
      },
    ]),
  );
  const answered = await client(plain).send('POST', 'https://uploads.github.com/x', {
    body: 'abcd',
    uploadProgress: (sent, total) => heard.push([sent, total]),
  });
  expect(answered.status).toBe(201);
  expect(heard).toHaveLength(1);
});

test('a write is sent at most once, and a read, a GraphQL query too, may go again', async () => {
  const once: string[] = [];
  const fetch: typeof globalThis.fetch = (input, init?: FetchInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (init?.once === true) once.push(`${init.method} ${url}`);
    return Promise.resolve(new Response('{"data":{}}', { status: 200 }));
  };
  const github = client(fetch);

  await github.get('/user', json);
  await github.graphqlPartial(ViewerDocument, {});
  await github.send('POST', '/graphql', { body: '{}', once: false });
  await github.graphqlPartial(AddCommentDocument, { subjectId: 'PR_1', body: 'Looks good' });
  await github.write('PATCH', '/repos/o/r/pulls/1', '{}', json);
  await github.delete('/repos/o/r/issues/comments/1');

  expect(once).toEqual([
    'POST https://api.github.com/graphql',
    'PATCH https://api.github.com/repos/o/r/pulls/1',
    'DELETE https://api.github.com/repos/o/r/issues/comments/1',
  ]);
});

test('a request given up fails with the reason, and one given up first is never sent', async () => {
  const sent: string[] = [];
  const hanging: typeof globalThis.fetch = (input, init) => {
    sent.push(new Request(input, init).url);
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  };
  const github = client(hanging);
  const controller = new AbortController();
  const request = github.send('POST', 'https://uploads.github.com/user-attachments/assets', {
    body: new Uint8Array(4),
    signal: controller.signal,
  });
  const cancelled = new Error('cancelled');
  controller.abort(cancelled);
  // Not the network failing: the reason it was given up.
  await expect(request).rejects.toBe(cancelled);

  await expect(github.send('GET', '/user', { signal: AbortSignal.abort(cancelled) })).rejects.toBe(
    cancelled,
  );
  expect(sent).toEqual(['https://uploads.github.com/user-attachments/assets']);
});

/**
 * A `fetch` that never answers, as over a connection that stalled, until its request is given up;
 * one whose answer begins, given `begins`, though its body never comes. It notes what it was sent.
 */
function stalled(sent: string[], begins = false): typeof globalThis.fetch {
  return (input, init?: FetchInit) => {
    sent.push(new Request(input, init).url);
    if (begins) init?.answerBegan?.();
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener(
        'abort',
        () => {
          const reason: unknown = signal.reason;
          reject(reason instanceof Error ? reason : new Error('given up'));
        },
        { once: true },
      );
    });
  };
}

/** What `promise` settled with, or nothing yet. */
function settled<T>(promise: Promise<T>): { error?: unknown; value?: T; done: boolean } {
  const state: { error?: unknown; value?: T; done: boolean } = { done: false };
  promise.then(
    (value) => Object.assign(state, { value, done: true }),
    (error: unknown) => Object.assign(state, { error, done: true }),
  );
  return state;
}

test('a request whose answer never begins is given up as lost, and the queue goes on', async () => {
  vi.useFakeTimers();
  try {
    const sent: string[] = [];
    const answers = replay(['GET', 'https://api.github.com/user', 200, {}, '{}']);
    const queue = new RequestQueue(0);
    const fetch: typeof globalThis.fetch = (input, init) =>
      new Request(input, init).url.endsWith('/hangs')
        ? stalled(sent)(input, init)
        : answers(input, init);
    const github = client(fetch).gated(queue.gate());
    const hung = settled(github.get('/hangs', json));
    const next = settled(github.get('/user', json));
    await vi.advanceTimersByTimeAsync(ANSWER_START_MS - 1);
    // Still waiting, and everything behind it with it.
    expect([hung.done, next.done]).toEqual([false, false]);
    expect(answers.seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(hung.error).toBeInstanceOf(GithubError);
    const error = hung.error instanceof GithubError ? hung.error : undefined;
    expect(error?.detail).toEqual({
      kind: 'network',
      failure: 'lost',
      message: "the answer didn't begin within 15 s",
    });
    // A read tries again later; a write may have been done, so it's never sent again by itself.
    expect(error?.isRetryable()).toBe(true);
    expect(error?.mayHavePosted()).toBe(true);
    expect(next).toEqual({ value: {}, done: true });
    expect(sent).toEqual(['https://api.github.com/hangs']);
  } finally {
    vi.useRealTimers();
  }
});

test('an answer that has begun, or a request with a limit of its own, waits as long as that', async () => {
  vi.useFakeTimers();
  try {
    const sent: string[] = [];
    // Its headers came, but its body never does: the whole answer's 30 s.
    const begun = settled(client(stalled(sent, true)).get('/user', json));
    // An upload's answer begins only once its body has gone: its own limit alone.
    const upload = settled(
      client(stalled(sent)).send('POST', 'https://uploads.github.com/user-attachments/assets', {
        body: new Uint8Array(4),
        timeoutMs: 60_000,
      }),
    );
    await vi.advanceTimersByTimeAsync(30_000 - 1);
    expect([begun.done, upload.done]).toEqual([false, false]);
    await vi.advanceTimersByTimeAsync(1);
    expect(begun.error).toMatchObject({
      detail: {
        kind: 'network',
        failure: 'lost',
        message: "the whole answer didn't come within 30 s",
      },
    });
    await vi.advanceTimersByTimeAsync(30_000 - 1);
    expect(upload.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(upload.error).toMatchObject({ detail: { kind: 'network', failure: 'lost' } });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
