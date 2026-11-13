import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { readCassette } from './cassette.ts';
import { startRecordingProxy } from './proxy.ts';
import { Replay } from './replay.ts';

/** A stand-in for the bot's token: shaped like one, so the recorder's checks see it. */
const TOKEN = 'gho_FAKEBOTTOKENFAKEBOTTOKENFAKEBOTTOKEN';

/** A folder for one test, removed when it ends. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lo-proxy-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'cassette');
}

/** GitHub as the proxy reaches it: each request it got, answered by `answer`. */
function upstream(answer: (request: Request) => Response) {
  const got: { url: string; authorization: string | null; host: string | null }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    got.push({
      url: request.url,
      authorization: request.headers.get('authorization'),
      host: request.headers.get('host'),
    });
    return Promise.resolve(answer(request));
  };
  return { fetch, got };
}

test('forwards what the app asks to GitHub as the bot, records it, and writes the cassette', async () => {
  const dir = scratch();
  const github = upstream(
    () =>
      new Response(JSON.stringify({ login: 'rozed-bot', id: 353226052 }), {
        headers: { 'content-type': 'application/json', etag: 'W/"1"', 'set-cookie': 'no' },
      }),
  );
  const proxy = await startRecordingProxy({ dir, token: TOKEN, fetch: github.fetch });

  const response = await fetch(`${proxy.urls.api}/user`, {
    headers: { authorization: 'token gho_FAKE_APP_ACCOUNT' },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ login: 'rozed-bot', id: 353226052 });
  // An anonymous request stays one.
  await fetch(`${proxy.urls.api}/repos/rozed-dev/e2e`);
  await proxy.finish({ description: 'A test.', repo: 'rozed-dev/e2e' });

  expect(github.got).toEqual([
    { url: 'https://api.github.com/user', authorization: `token ${TOKEN}`, host: null },
    { url: 'https://api.github.com/repos/rozed-dev/e2e', authorization: null, host: null },
  ]);
  const cassette = readCassette(dir);
  expect(cassette.info).toMatchObject({ description: 'A test.', repo: 'rozed-dev/e2e' });
  expect(cassette.interactions.map(({ interaction }) => interaction.request.url)).toEqual([
    'https://api.github.com/user',
    'https://api.github.com/repos/rozed-dev/e2e',
  ]);
  // What it recorded replays, and holds neither token nor cookie.
  const replay = Replay.fromDir(dir);
  const replayed = await replay.respond(new Request('https://api.github.com/user'));
  expect(await replayed.json()).toEqual({ login: 'rozed-bot', id: 353226052 });
  for (const file of readdirSync(dir)) {
    const text = readFileSync(join(dir, file), 'utf8');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('gho_FAKE_APP_ACCOUNT');
    expect(text).not.toContain('set-cookie');
  }
});

test('hands a redirect back for the app to follow, at the proxy’s address', async () => {
  const github = upstream((request) =>
    request.url.endsWith('/repos/rozed-dev/old')
      ? new Response(null, {
          status: 301,
          headers: { location: 'https://api.github.com/repositories/1' },
        })
      : new Response('{}', { headers: { 'content-type': 'application/json' } }),
  );
  const proxy = await startRecordingProxy({ dir: scratch(), token: TOKEN, fetch: github.fetch });
  const response = await fetch(`${proxy.urls.api}/repos/rozed-dev/old`, { redirect: 'manual' });
  expect(response.status).toBe(301);
  expect(response.headers.get('location')).toBe(`${proxy.urls.api}/repositories/1`);
  expect(github.got).toHaveLength(1);
  await proxy.finish({ description: 'A test.', repo: 'rozed-dev/e2e' });
});

test('refuses to send anything that writes to GitHub, and records nothing then', async () => {
  const dir = scratch();
  const github = upstream(() => new Response('{}'));
  const proxy = await startRecordingProxy({ dir, token: TOKEN, fetch: github.fetch });
  const response = await fetch(`${proxy.urls.api}/repos/rozed-dev/e2e/issues/1/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: 'hello' }),
  });
  expect(response.status).toBe(502);
  expect(github.got).toEqual([]);
  expect(proxy.failures).toHaveLength(1);
  await expect(proxy.finish({ description: 'A test.', repo: 'rozed-dev/e2e' })).rejects.toThrow(
    /refused to record/,
  );
});

test('sends and records a write once it may, as LO_RECORD_WRITES=1 says', async () => {
  const dir = scratch();
  const github = upstream(
    () =>
      new Response(JSON.stringify({ number: 84, base: { ref: 'stack/b' } }), {
        headers: { 'content-type': 'application/json' },
      }),
  );
  const proxy = await startRecordingProxy({ dir, token: TOKEN, fetch: github.fetch, writes: true });
  const body = JSON.stringify({ base: 'stack/b' });
  const response = await fetch(`${proxy.urls.api}/repos/rozed-dev/e2e/pulls/84`, {
    method: 'PATCH',
    headers: { authorization: 'token gho_FAKE_APP_ACCOUNT' },
    body,
  });
  expect(response.status).toBe(200);
  expect(github.got).toEqual([
    {
      url: 'https://api.github.com/repos/rozed-dev/e2e/pulls/84',
      authorization: `token ${TOKEN}`,
      host: null,
    },
  ]);
  await proxy.finish({ description: 'A test.', repo: 'rozed-dev/e2e' });
  // Replayed, the same write gets the same answer.
  const replay = Replay.fromDir(dir);
  const answer = replay.answer({
    method: 'PATCH',
    url: 'https://api.github.com/repos/rozed-dev/e2e/pulls/84',
    headers: new Headers(),
    body: new TextEncoder().encode(body),
  });
  expect(await answer.json()).toEqual({ number: 84, base: { ref: 'stack/b' } });
});
