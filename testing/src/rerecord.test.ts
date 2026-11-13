import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { queryHash, readCassette, type Interaction } from './cassette.ts';
import { queryOperation, rerecord } from './rerecord.ts';

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
