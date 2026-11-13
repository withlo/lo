import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { queryHash, readCassette, type Interaction } from './cassette.ts';
import { addAnswers, copyAnswer, queryOperation, rerecord } from './rerecord.ts';

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
