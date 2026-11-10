import { describe, expect, test } from 'vitest';

import { queryHash, type Interaction } from './cassette.ts';
import { replayFetch } from './fetch.ts';
import { nearestKey, Replay } from './replay.ts';

function interaction(method: string, url: string, status: number, body: string): Interaction {
  return {
    request: { method, url },
    response: { status, headers: { etag: `"${status}"` }, body_text: body },
  };
}

async function get(
  fetch: typeof globalThis.fetch,
  url: string,
  headers: Record<string, string> = {},
): Promise<[status: number, body: string, etag: string | null]> {
  const response = await fetch(url, { headers });
  return [response.status, await response.text(), response.headers.get('etag')];
}

test('serves responses in order then repeats the last', async () => {
  const url = 'https://api.github.com/repos/o/r/pulls/1';
  const fetch = replayFetch(
    new Replay('t', [interaction('GET', url, 200, 'first'), interaction('GET', url, 304, '')]),
  );
  expect(await get(fetch, url)).toEqual([200, 'first', '"200"']);
  expect((await get(fetch, url))[0]).toBe(304);
  expect((await get(fetch, url))[0]).toBe(304);
  expect(fetch.seen).toHaveLength(3);
});

test('keeps what each request sent', async () => {
  const url = 'https://api.github.com/user';
  const fetch = replayFetch(new Replay('t', [interaction('GET', url, 200, '{}')]));
  await fetch(url, { headers: { Authorization: 'token fake' } });
  const [seen] = fetch.seen;
  expect(seen?.method).toBe('GET');
  expect(seen?.url).toBe(url);
  expect(seen?.headers.get('authorization')).toBe('token fake');
});

test('an unexpected request fails the test', async () => {
  const replay = new Replay('t', [interaction('GET', 'https://api.github.com/user', 200, '')]);
  await expect(replay.respond(new Request('https://api.github.com/other'))).rejects.toThrow(
    'has no response for\n  GET https://api.github.com/other\n' +
      'The nearest recorded request is\n  GET https://api.github.com/user',
  );
});

// The code under test may catch a failed request as it would a network error; the test fails
// anyway, once it ends.
test.fails('an unexpected request fails the test even when the code catches it', async () => {
  const fetch = replayFetch(
    new Replay('t', [interaction('GET', 'https://api.github.com/user', 200, '')]),
  );
  await fetch('https://api.github.com/other').catch(() => undefined);
  expect(fetch.seen).toHaveLength(1);
});

// Under test.concurrent, each test passes its own context, so a failure is its test's alone.
describe('under test.concurrent', () => {
  test.concurrent.fails('an unexpected request fails the test that made it', async (context) => {
    const fetch = replayFetch(
      new Replay('t', [interaction('GET', 'https://api.github.com/user', 200, '')]),
      context,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await fetch('https://api.github.com/other').catch(() => undefined);
    expect(fetch.replay.failures).toHaveLength(1);
  });

  test.concurrent('and not the test beside it', async (context) => {
    const fetch = replayFetch(
      new Replay('t', [interaction('GET', 'https://api.github.com/user', 200, '')]),
      context,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await fetch('https://api.github.com/user')).status).toBe(200);
  });
});

test('a missed write prints the body it sent', async () => {
  const replay = new Replay('t', [
    {
      request: {
        method: 'PUT',
        url: 'https://api.github.com/repos/o/r/pulls/1/merge',
        body_sha256: 'ab',
      },
      response: { status: 200, headers: {} },
    },
  ]);
  const request = new Request('https://api.github.com/repos/o/r/pulls/1/merge', {
    method: 'PUT',
    body: '{"merge_method":"squash"}',
  });
  await expect(replay.respond(request)).rejects.toThrow(
    'The nearest recorded request is\n  PUT https://api.github.com/repos/o/r/pulls/1/merge body=ab\n' +
      'The request sent the body\n  {"merge_method":"squash"}',
  );
});

test('the nearest recorded request is one for the same operation, then the same path', () => {
  const graphql = 'POST https://api.github.com/graphql';
  const recorded = [
    `${graphql} PullRequest variables={"number":1}`,
    `${graphql} PullRequestCheck variables={"number":2}`,
    'GET https://api.github.com/repos/o/r/pulls/1',
    'GET https://api.github.com/repos/o/r/pulls/2?per_page=100',
  ];
  expect(nearestKey(`${graphql} PullRequestCheck variables={"number":1}`, recorded)).toBe(
    recorded[1],
  );
  expect(nearestKey('GET https://api.github.com/repos/o/r/pulls/2', recorded)).toBe(recorded[3]);
  expect(nearestKey('GET https://api.github.com/user', [])).toBeUndefined();
});

function conditional(etag: string): Interaction {
  const recorded = interaction('GET', 'https://api.github.com/repos/o/r', 304, '');
  recorded.request.if_none_match = etag;
  return recorded;
}

test('a conditional request gets the 304 recorded for its etag', async () => {
  const fetch = replayFetch(
    new Replay('t', [
      interaction('GET', 'https://api.github.com/repos/o/r', 200, '{}'),
      conditional('W/"abc"'),
    ]),
  );
  expect((await get(fetch, 'https://api.github.com/repos/o/r'))[0]).toBe(200);
  expect(
    (await get(fetch, 'https://api.github.com/repos/o/r', { 'If-None-Match': 'W/"abc"' }))[0],
  ).toBe(304);
});

test('a wrong etag fails the test', async () => {
  const replay = new Replay('t', [conditional('W/"abc"')]);
  const request = new Request('https://api.github.com/repos/o/r', {
    headers: { 'If-None-Match': 'W/"wrong"' },
  });
  await expect(replay.respond(request)).rejects.toThrow(
    'has no response for\n  GET https://api.github.com/repos/o/r if-none-match=W/"wrong"',
  );
});

function modifiedSince(date: string): Interaction {
  const recorded = interaction('GET', 'https://api.github.com/repos/o/r', 304, '');
  recorded.request.if_modified_since = date;
  return recorded;
}

test('a request modified since gets the 304 recorded for its date', async () => {
  const date = 'Fri, 06 Nov 2026 08:15:07 GMT';
  const fetch = replayFetch(
    new Replay('t', [
      interaction('GET', 'https://api.github.com/repos/o/r', 200, '{}'),
      modifiedSince(date),
    ]),
  );
  expect((await get(fetch, 'https://api.github.com/repos/o/r'))[0]).toBe(200);
  expect(
    (await get(fetch, 'https://api.github.com/repos/o/r', { 'If-Modified-Since': date }))[0],
  ).toBe(304);
});

test('a wrong date fails the test', async () => {
  const replay = new Replay('t', [modifiedSince('Fri, 06 Nov 2026 08:15:07 GMT')]);
  const request = new Request('https://api.github.com/repos/o/r', {
    headers: { 'If-Modified-Since': 'Thu, 05 Nov 2026 00:00:00 GMT' },
  });
  await expect(replay.respond(request)).rejects.toThrow(
    'has no response for\n  GET https://api.github.com/repos/o/r if-modified-since=Thu, 05 Nov 2026 00:00:00 GMT',
  );
});

test('a changed query asks for a new recording', async () => {
  const recorded = interaction('POST', 'https://api.github.com/graphql', 200, '{}');
  recorded.request.operation = 'A';
  recorded.request.variables = {};
  recorded.request.query_sha256 = queryHash('query A { old }');
  const replay = new Replay('t', [recorded]);
  const request = new Request('https://api.github.com/graphql', {
    method: 'POST',
    body: '{"query":"query A { new }","operationName":"A","variables":{}}',
  });
  await expect(replay.respond(request)).rejects.toThrow(
    're-record cassette t: the A query changed',
  );
});

test('a recorded cassette replays from its folder', async () => {
  const fetch = replayFetch('rest_pull_conditional');
  const url = 'https://api.github.com/repos/rozed-dev/playground/pulls/1';
  const [status, body, etag] = await get(fetch, url);
  expect(status).toBe(200);
  expect(JSON.parse(body)).toMatchObject({ number: 1 });
  expect(etag).not.toBeNull();
  expect((await get(fetch, url, { 'If-None-Match': etag! }))[0]).toBe(304);
});
