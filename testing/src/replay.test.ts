import { beforeAll, describe, expect, test } from 'vitest';

import { queryHash, type Interaction } from './cassette.ts';
import { replayFetch, type ReplayFetch } from './fetch.ts';
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

// Made at the top of a module, outside any test.
const atTop = replayFetch(
  new Replay('t', [interaction('GET', 'https://api.github.com/user', 200, '')]),
);

test.fails(
  'an unexpected request fails the test running it, from a fetch made at the top',
  async () => {
    await atTop('https://api.github.com/other').catch(() => undefined);
    expect(atTop.replay.failures).toHaveLength(1);
  },
);

describe('from a fetch made in a beforeAll', () => {
  let shared: ReplayFetch;
  beforeAll(() => {
    shared = replayFetch(
      new Replay('t', [interaction('GET', 'https://api.github.com/user', 200, '')]),
    );
  });

  test.fails('an unexpected request fails the test running it', async () => {
    await shared('https://api.github.com/other').catch(() => undefined);
    expect(shared.replay.failures).toHaveLength(1);
  });

  test('and not the next test', async () => {
    expect((await shared('https://api.github.com/user')).status).toBe(200);
  });
});

test.fails('a request still being answered when its test ends fails the test', () => {
  const fetch = replayFetch(
    new Replay('t', [interaction('GET', 'https://api.github.com/user', 200, '')]),
  );
  void fetch('https://api.github.com/other').catch(() => undefined);
  expect(fetch.replay.failures).toHaveLength(0);
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

const RESOURCE = 'https://api.github.com/repos/o/r/pulls/1';
const FIRST = 'Fri, 06 Nov 2026 08:15:07 GMT';
const LATER = 'Sat, 07 Nov 2026 01:04:21 GMT';

/** A state of the resource: its response, with validators, headers a `304` leaves out, and a body. */
const state = (etag: string, modified: string, body: string): Interaction['response'] => ({
  status: 200,
  headers: {
    'content-type': 'application/json',
    etag,
    'last-modified': modified,
    link: '<https://api.github.com/repos/o/r/pulls?page=2>; rel="next"',
    location: 'https://api.github.com/elsewhere',
    'x-github-api-version-selected': '2022-11-28',
    'x-ratelimit-remaining': '4990',
    'x-served-by': 'a server',
  },
  body_text: body,
});

/**
 * A resource's recording: read, asked again with the first state's validator and told it hasn't
 * changed, then asked again the same way and told it has, with new validators. Asked with a time
 * (`poll`), with an ETag, or never.
 */
function changed(poll: 'time' | 'etag' | 'never'): Replay {
  const request: Interaction['request'] = { method: 'GET', url: RESOURCE };
  const asked: Interaction['request'] =
    poll === 'time'
      ? { ...request, if_modified_since: FIRST }
      : poll === 'etag'
        ? { ...request, if_none_match: '"a"' }
        : request;
  return new Replay('t', [
    { request, response: state('"a"', FIRST, 'first') },
    { request: asked, response: { status: 304, headers: { etag: '"a"' } } },
    { request: asked, response: state('"b"', LATER, 'later') },
  ]);
}

test('a poll the recording ended before gets a 304 for the state it left, by its time', async () => {
  const fetch = replayFetch(changed('time'));
  expect(await get(fetch, RESOURCE)).toEqual([200, 'first', '"a"']);
  expect((await get(fetch, RESOURCE, { 'If-Modified-Since': FIRST }))[0]).toBe(304);
  expect(await get(fetch, RESOURCE, { 'If-Modified-Since': FIRST })).toEqual([200, 'later', '"b"']);
  // Never sent while recording: a poll after the answer that gave the new time.
  for (let poll = 0; poll < 2; poll++) {
    const response = await fetch(RESOURCE, { headers: { 'If-Modified-Since': LATER } });
    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
  }
});

test('a poll the recording ended before gets a 304 for the state it left, by its etag', async () => {
  const fetch = replayFetch(changed('etag'));
  // Weak or strong, and among others.
  for (const sent of ['"b"', 'W/"b"', '"a", W/"b"']) {
    expect((await get(fetch, RESOURCE, { 'If-None-Match': sent }))[0]).toBe(304);
  }
});

test('that 304 has the headers of one from GitHub', async () => {
  const response = await replayFetch(changed('time'))(RESOURCE, {
    headers: { 'If-Modified-Since': LATER },
  });
  expect(Object.fromEntries(response.headers)).toEqual({
    etag: '"b"',
    'last-modified': LATER,
    'x-github-api-version-selected': '2022-11-28',
    'x-ratelimit-remaining': '4990',
  });
});

const sends = (replay: Replay, headers: Record<string, string>) =>
  replay.respond(new Request(RESOURCE, { headers }));

test('a poll the recording never sent that way still fails the test', async () => {
  // An ETag where it only polled by time, a time where it only polled by ETag, and any poll of a
  // resource it only read.
  await expect(sends(changed('time'), { 'If-None-Match': '"b"' })).rejects.toThrow(
    'has no response for',
  );
  await expect(sends(changed('etag'), { 'If-Modified-Since': LATER })).rejects.toThrow(
    'has no response for',
  );
  await expect(sends(changed('never'), { 'If-None-Match': '"b"' })).rejects.toThrow(
    'has no response for',
  );
  await expect(sends(changed('never'), { 'If-Modified-Since': LATER })).rejects.toThrow(
    'has no response for',
  );
  await expect(sends(changed('etag'), { 'If-None-Match': '*' })).rejects.toThrow(
    'has no response for',
  );
});

test('a validator of any other state still fails the test', async () => {
  // The first state's, as the recording never sent it, a made-up one, and an old time.
  await expect(sends(changed('etag'), { 'If-None-Match': 'W/"a"' })).rejects.toThrow(
    'has no response for',
  );
  await expect(sends(changed('etag'), { 'If-None-Match': '"c"' })).rejects.toThrow(
    'has no response for',
  );
  await expect(
    sends(changed('time'), { 'If-Modified-Since': 'Thu, 05 Nov 2026 00:00:00 GMT' }),
  ).rejects.toThrow('has no response for');
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
