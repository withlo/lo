import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { queryHash, readCassette, type Interaction } from './cassette.ts';
import { addAnswers, addRestAnswers, copyAnswer, queryOperation, rerecord } from './rerecord.ts';

const FAKE_TOKEN = 'fake-token-for-the-rerecord-test';
const OLD = 'query Layers($ids: [ID!]!) { nodes(ids: $ids) { id } }';
const NEW = 'query Layers($ids: [ID!]!) { nodes(ids: $ids) { id ... on PullRequest { number } } }';

/** A cassette in a folder of its own, removed when the test ends: a GraphQL query and a REST read. */
function cassette(status = 200): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'lo-rerecord-')), 'c');
  onTestFinished(() => rmSync(join(dir, '..'), { recursive: true, force: true }));
  mkdirSync(dir);
  const info = { description: 'test', recorded_at: '2026-11-07T00:00:00Z' };
  const layers: Interaction = {
    request: {
      method: 'POST',
      url: 'https://api.github.com/graphql',
      operation: 'Layers',
      variables: { ids: ['PR_1'] },
      query_sha256: queryHash(OLD),
    },
    response: { status, headers: {}, body: { data: { nodes: [{ id: 'PR_1' }] } } },
  };
  const user: Interaction = {
    request: { method: 'GET', url: 'https://api.github.com/user' },
    response: { status: 200, headers: {}, body: { login: 'rozed-bot' } },
  };
  writeFileSync(join(dir, 'cassette.json'), JSON.stringify(info));
  writeFileSync(join(dir, '001-GET-user.json'), JSON.stringify(user));
  writeFileSync(join(dir, '002-POST-graphql-Layers.json'), JSON.stringify(layers));
  return dir;
}

/** A `fetch` answering `body`, which keeps what it was sent. */
function answering(body: string) {
  const sent: Request[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    sent.push(new Request(input, init));
    return Promise.resolve(
      new Response(body, { headers: { 'content-type': 'application/json', 'set-cookie': 'x' } }),
    );
  };
  return { fetch, sent };
}

test('records the query again in place, with its variables, and leaves the rest', async () => {
  const dir = cassette();
  const user = readFileSync(join(dir, '001-GET-user.json'), 'utf8');
  const { fetch, sent } = answering('{"data":{"nodes":[{"id":"PR_1","number":1}]}}');
  const counts = await rerecord({
    fetch,
    token: FAKE_TOKEN,
    query: NEW,
    cassettes: [{ dir }],
    at: 'now',
  });
  expect(counts.get(dir)).toBe(1);

  const [request] = sent;
  expect(request?.url).toBe('https://api.github.com/graphql');
  expect(request?.headers.get('authorization')).toBe(`token ${FAKE_TOKEN}`);
  expect(await request?.json()).toEqual({
    query: NEW,
    operationName: 'Layers',
    variables: { ids: ['PR_1'] },
  });

  const { info, interactions } = readCassette(dir);
  expect(info).toEqual({
    description: 'test',
    recorded_at: '2026-11-07T00:00:00Z',
    rerecorded: { Layers: 'now' },
  });
  expect(readFileSync(join(dir, '001-GET-user.json'), 'utf8')).toBe(user);
  const layers = interactions[1]?.interaction;
  expect(layers?.request.query_sha256).toBe(queryHash(NEW));
  expect(layers?.response).toEqual({
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { data: { nodes: [{ id: 'PR_1', number: 1 }] } },
  });
});

test('writes nothing when an answer differs in kind or would hold a token', async () => {
  const dir = cassette();
  const before = readFileSync(join(dir, '002-POST-graphql-Layers.json'), 'utf8');
  const failing = answering('{"data":null,"errors":[{"message":"gone"}]}');
  await expect(
    rerecord({
      fetch: failing.fetch,
      token: FAKE_TOKEN,
      query: NEW,
      cassettes: [{ dir }],
      at: 'now',
    }),
  ).rejects.toThrow('with errors');
  const leaking = answering(`{"data":{"nodes":[{"id":"${FAKE_TOKEN}"}]}}`);
  await expect(
    rerecord({
      fetch: leaking.fetch,
      token: FAKE_TOKEN,
      query: NEW,
      cassettes: [{ dir }],
      at: 'now',
    }),
  ).rejects.toThrow('nothing was written');
  // A file named must hold the query.
  await expect(
    rerecord({
      fetch: failing.fetch,
      token: FAKE_TOKEN,
      query: NEW,
      cassettes: [{ dir, files: ['001-GET-user.json'] }],
      at: 'now',
    }),
  ).rejects.toThrow('holds no Layers in 001-GET-user.json');
  expect(readFileSync(join(dir, '002-POST-graphql-Layers.json'), 'utf8')).toBe(before);
  expect(readCassette(dir).info.rerecorded).toBeUndefined();
});

test('only a named query is recorded again', () => {
  expect(queryOperation(NEW)).toBe('Layers');
  expect(() => queryOperation('mutation M { a }')).toThrow('only a named query');
  expect(() => queryOperation(`${NEW} query Other { a }`)).toThrow('exactly one operation');
});

test('adds a query’s answers after the rest, each with its variables, and leaves the rest', async () => {
  const dir = cassette();
  const user = readFileSync(join(dir, '001-GET-user.json'), 'utf8');
  const { fetch, sent } = answering('{"data":{"nodes":[{"id":"PR_2","number":2}]}}');
  const counts = await addAnswers({
    fetch,
    token: FAKE_TOKEN,
    query: NEW,
    variables: [{ ids: ['PR_2'] }],
    dirs: [dir],
    at: 'now',
  });
  expect(counts.get(dir)).toBe(1);
  expect(await sent[0]?.json()).toEqual({
    query: NEW,
    operationName: 'Layers',
    variables: { ids: ['PR_2'] },
  });

  const { info, interactions } = readCassette(dir);
  expect(info.added).toEqual({ Layers: 'now' });
  expect(interactions.map(({ file }) => file)).toEqual([
    '001-GET-user.json',
    '002-POST-graphql-Layers.json',
    '003-POST-graphql-Layers.json',
  ]);
  expect(readFileSync(join(dir, '001-GET-user.json'), 'utf8')).toBe(user);
  const added = interactions[2]?.interaction;
  expect(added?.request).toMatchObject({
    operation: 'Layers',
    variables: { ids: ['PR_2'] },
    query_sha256: queryHash(NEW),
  });
  expect(added?.response.body).toEqual({ data: { nodes: [{ id: 'PR_2', number: 2 }] } });
});

test('adds nothing the cassette holds already, nor an answer with errors', async () => {
  const dir = cassette();
  const { fetch } = answering('{"data":{"nodes":[]}}');
  await expect(
    addAnswers({
      fetch,
      token: FAKE_TOKEN,
      query: NEW,
      variables: [{ ids: ['PR_1'] }],
      dirs: [dir],
      at: 'now',
    }),
  ).rejects.toThrow('holds Layers with {"ids":["PR_1"]} already');
  const failing = answering('{"data":null,"errors":[{"message":"gone"}]}');
  await expect(
    addAnswers({
      fetch: failing.fetch,
      token: FAKE_TOKEN,
      query: NEW,
      variables: [{ ids: ['PR_2'] }],
      dirs: [dir],
      at: 'now',
    }),
  ).rejects.toThrow('with errors');
  expect(readCassette(dir).interactions).toHaveLength(2);
  expect(readCassette(dir).info.added).toBeUndefined();
});

test('copies an answer another cassette recorded after the rest, once', () => {
  const dir = cassette();
  const other = cassette();
  const avatar: Interaction = {
    request: { method: 'GET', url: 'https://avatars.githubusercontent.com/rozed-bot?s=40' },
    response: { status: 200, headers: { 'content-type': 'image/png' }, body_base64: 'iVBORw==' },
  };
  const from = join(other, '003-GET-rozed-bot.json');
  writeFileSync(from, JSON.stringify(avatar));
  copyAnswer({ from, dirs: [dir], at: 'now' });

  const { info, interactions } = readCassette(dir);
  expect(info.added).toEqual({ 'GET https://avatars.githubusercontent.com/rozed-bot?s=40': 'now' });
  expect(interactions.map(({ file }) => file)).toEqual([
    '001-GET-user.json',
    '002-POST-graphql-Layers.json',
    '003-GET-rozed-bot.json',
  ]);
  expect(interactions[2]?.interaction).toEqual(avatar);
  expect(() => copyAnswer({ from, dirs: [dir], at: 'later' })).toThrow('holds GET');
  expect(readCassette(dir).interactions).toHaveLength(3);
});

const RULES = '/repos/rozed-dev/e2e/rules/branches/e4/gated?per_page=100';
const ETAG = '"a1b2c3"';

/**
 * A `fetch` answering a REST read as GitHub does: `200` with an ETag, then `304` to the same read
 * asked again with it, or `200` again when `moved`. It keeps what it was sent.
 */
function restAnswering(moved = false, body = '[{"type":"pull_request"}]') {
  const sent: Request[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    sent.push(request);
    if (!moved && request.headers.get('if-none-match') === ETAG) {
      return Promise.resolve(new Response(null, { status: 304, headers: { etag: ETAG } }));
    }
    return Promise.resolve(
      new Response(body, {
        headers: { 'content-type': 'application/json', etag: ETAG, 'set-cookie': 'x' },
      }),
    );
  };
  return { fetch, sent };
}

test('adds a REST read’s first answer and its 304 after the rest, and leaves the rest', async () => {
  const dir = cassette();
  const user = readFileSync(join(dir, '001-GET-user.json'), 'utf8');
  const { fetch, sent } = restAnswering();
  const counts = await addRestAnswers({
    fetch,
    token: FAKE_TOKEN,
    path: RULES,
    dirs: [dir],
    at: 'now',
  });
  expect(counts.get(dir)).toBe(2);
  expect(sent.map((request) => [request.url, request.headers.get('if-none-match')])).toEqual([
    [`https://api.github.com${RULES}`, null],
    [`https://api.github.com${RULES}`, ETAG],
  ]);
  expect(sent[0]?.headers.get('authorization')).toBe(`token ${FAKE_TOKEN}`);

  const { info, interactions } = readCassette(dir);
  const url = `https://api.github.com${RULES}`;
  expect(info.added).toEqual({ [`GET ${url}`]: 'now' });
  expect(interactions.map(({ file }) => file)).toEqual([
    '001-GET-user.json',
    '002-POST-graphql-Layers.json',
    '003-GET-repos_rozed-dev_e2e_rules_branches_e4_gated.json',
    '004-GET-repos_rozed-dev_e2e_rules_branches_e4_gated.json',
  ]);
  expect(readFileSync(join(dir, '001-GET-user.json'), 'utf8')).toBe(user);
  expect(interactions[2]?.interaction).toEqual({
    request: { method: 'GET', url },
    response: {
      status: 200,
      headers: { 'content-type': 'application/json', etag: ETAG },
      body: [{ type: 'pull_request' }],
    },
  });
  expect(interactions[3]?.interaction).toEqual({
    request: { method: 'GET', url, if_none_match: ETAG },
    response: { status: 304, headers: { etag: ETAG } },
  });
  // Once there, it isn't added again.
  await expect(
    addRestAnswers({ fetch, token: FAKE_TOKEN, path: RULES, dirs: [dir], at: 'later' }),
  ).rejects.toThrow('holds GET');
});

test('adds only the 304 to a REST read a cassette holds but never asked again', async () => {
  const dir = cassette();
  const url = `https://api.github.com${RULES}`;
  const read: Interaction = {
    request: { method: 'GET', url },
    response: { status: 200, headers: { etag: ETAG }, body: [] },
  };
  writeFileSync(join(dir, '003-GET-rules.json'), JSON.stringify(read));
  const { fetch, sent } = restAnswering();
  const counts = await addRestAnswers({
    fetch,
    token: FAKE_TOKEN,
    path: RULES,
    dirs: [dir],
    at: 'now',
  });
  expect(counts.get(dir)).toBe(1);
  expect(sent.map((request) => request.headers.get('if-none-match'))).toEqual([ETAG]);
  const { info, interactions } = readCassette(dir);
  expect(info.added).toEqual({ [`GET ${url}`]: 'now' });
  expect(interactions.map(({ file }) => file)).toEqual([
    '001-GET-user.json',
    '002-POST-graphql-Layers.json',
    '003-GET-rules.json',
    '004-GET-repos_rozed-dev_e2e_rules_branches_e4_gated.json',
  ]);
  expect(interactions[2]?.interaction).toEqual(read);
  expect(interactions[3]?.interaction).toEqual({
    request: { method: 'GET', url, if_none_match: ETAG },
    response: { status: 304, headers: { etag: ETAG } },
  });
  await expect(
    addRestAnswers({ fetch, token: FAKE_TOKEN, path: RULES, dirs: [dir], at: 'later' }),
  ).rejects.toThrow('holds GET');
});

test('adds no 304 to a REST read a cassette holds without an ETag', async () => {
  const dir = cassette();
  const read: Interaction = {
    request: { method: 'GET', url: `https://api.github.com${RULES}` },
    response: { status: 200, headers: {}, body: [] },
  };
  writeFileSync(join(dir, '003-GET-rules.json'), JSON.stringify(read));
  const { fetch, sent } = restAnswering();
  await expect(
    addRestAnswers({ fetch, token: FAKE_TOKEN, path: RULES, dirs: [dir], at: 'now' }),
  ).rejects.toThrow('without an ETag');
  expect(sent).toEqual([]);
  expect(readCassette(dir).interactions).toHaveLength(3);
});

test('adds no REST read whose ETag GitHub doesn’t answer 304, nor one off GitHub’s API', async () => {
  const dir = cassette();
  const { fetch } = restAnswering(true);
  await expect(
    addRestAnswers({ fetch, token: FAKE_TOKEN, path: RULES, dirs: [dir], at: 'now' }),
  ).rejects.toThrow('not 304');
  await expect(
    addRestAnswers({ fetch, token: FAKE_TOKEN, path: '//example.com/x', dirs: [dir], at: 'now' }),
  ).rejects.toThrow('isn’t a path');
  expect(readCassette(dir).interactions).toHaveLength(2);
  expect(readCassette(dir).info.added).toBeUndefined();
});

test('writes no REST read whose answer holds the token, in any cassette', async () => {
  const [first, second] = [cassette(), cassette()];
  const before = [first, second].map((dir) => readdirSync(dir).toSorted());
  const json = readFileSync(join(second, 'cassette.json'), 'utf8');
  // GitHub echoing the token back, as an error page might.
  const { fetch } = restAnswering(false, `[{"note":"token ${FAKE_TOKEN}"}]`);
  await expect(
    addRestAnswers({ fetch, token: FAKE_TOKEN, path: RULES, dirs: [first, second], at: 'now' }),
  ).rejects.toThrow('nothing was written');
  expect([first, second].map((dir) => readdirSync(dir).toSorted())).toEqual(before);
  expect(readFileSync(join(second, 'cassette.json'), 'utf8')).toBe(json);
});
