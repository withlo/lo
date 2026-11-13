import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { readCassette } from './cassette.ts';
import { startRecordingProxy } from './proxy.ts';
import { Replay } from './replay.ts';
import { serveReplay } from './server.ts';

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

/** A 1x1 PNG, as GitHub's attachment store serves one. */
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
);
const SIGNED =
  'https://github-production-user-asset-6210df.s3.amazonaws.com/1/a.png?X-Amz-Credential=AKIA%2F1&X-Amz-Signature=abc123&X-Amz-Expires=300';
/** An attachment's id, as GitHub names one. */
const ID = '08c730b3-f0b0-4c7d-93a2-95f8d167d0d9';

/** The status the server at `origin` answers `path` with, sent as it is, which `fetch` won't. */
function statusOf(origin: string, path: string, headers: Record<string, string> = {}) {
  const { hostname, port } = new URL(origin);
  return new Promise<number | undefined>((resolve, reject) => {
    const asked = httpRequest({ hostname, port, path, headers }, (answer) => {
      answer.resume();
      answer.on('end', () => resolve(answer.statusCode));
    });
    asked.on('error', reject);
    asked.end();
  });
}

test('records the image hosts under /images/, with the token for an attachment alone, signatures redacted', async () => {
  const dir = scratch();
  const github = upstream((request) =>
    request.url.startsWith('https://github.com/user-attachments/assets/')
      ? new Response(null, { status: 302, headers: { location: SIGNED } })
      : new Response(PNG, { headers: { 'content-type': 'image/png' } }),
  );
  const proxy = await startRecordingProxy({ dir, token: TOKEN, fetch: github.fetch });
  const origin = new URL(proxy.urls.api).origin;
  const signedIn = { authorization: 'token gho_FAKE_APP_ACCOUNT' };

  const attachment = await fetch(`${origin}/images/github.com/user-attachments/assets/${ID}`, {
    headers: signedIn,
    redirect: 'manual',
  });
  expect(attachment.status).toBe(302);
  // The redirect goes back as it was, signature and all, for the app to read against GitHub.
  const location = attachment.headers.get('location');
  expect(location).toBe(SIGNED);
  const stored = new URL(location ?? '');
  const bytes = await fetch(`${origin}/images/${stored.host}${stored.pathname}${stored.search}`, {
    headers: signedIn,
  });
  expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(PNG);
  // An app that sent its token anywhere but an attachment's address has it go no further.
  await fetch(`${origin}/images/avatars.githubusercontent.com/rozed-bot?s=56`, {
    headers: signedIn,
  });
  expect((await fetch(`${origin}/images/example.com/a.png`)).status).toBe(502);
  expect(github.got.map(({ url, authorization }) => [url, authorization])).toEqual([
    [`https://github.com/user-attachments/assets/${ID}`, `token ${TOKEN}`],
    [SIGNED, null],
    ['https://avatars.githubusercontent.com/rozed-bot?s=56', null],
  ]);
  await proxy.finish({ description: 'A test.', repo: 'rozed-dev/e2e' });

  const files = readdirSync(dir).map((file) => readFileSync(join(dir, file), 'utf8'));
  for (const text of files) expect(text).not.toMatch(/abc123|AKIA/);
  const recorded = readCassette(dir).interactions.map(({ interaction }) => interaction);
  expect(recorded[1]?.request.url).toBe(
    'https://github-production-user-asset-6210df.s3.amazonaws.com/1/a.png?X-Amz-Credential=REDACTED&X-Amz-Signature=REDACTED&X-Amz-Expires=300',
  );
  expect(recorded[1]?.response.body_base64).toBe(Buffer.from(PNG).toString('base64'));

  // The replay server answers the same, redirect as recorded and bytes as they were.
  const server = await serveReplay(Replay.fromDir(dir));
  onTestFinished(() => server.close());
  const served = new URL(server.urls.api).origin;
  const redirect = await fetch(`${served}/images/github.com/user-attachments/assets/${ID}`, {
    redirect: 'manual',
  });
  const replayed = new URL(redirect.headers.get('location') ?? '');
  expect(replayed.host).toBe(stored.host);
  const image = await fetch(
    `${served}/images/${replayed.host}${replayed.pathname}${replayed.search}`,
  );
  expect(image.headers.get('content-type')).toBe('image/png');
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);
});

test("sends the token to no image address that steps out of an attachment's", async () => {
  const github = upstream(() => new Response(PNG, { headers: { 'content-type': 'image/png' } }));
  const proxy = await startRecordingProxy({ dir: scratch(), token: TOKEN, fetch: github.fetch });
  const origin = new URL(proxy.urls.api).origin;
  const signedIn = { authorization: 'token gho_FAKE_APP_ACCOUNT' };
  const assets = '/images/github.com/user-attachments/assets';
  for (const path of [
    `${assets}/../../settings/tokens`,
    `${assets}/%2e%2e/%2E%2E/settings/tokens`,
    `${assets}/${ID}/../../../x`,
    '/images/github.com/./user-attachments/assets/' + ID,
  ]) {
    expect(await statusOf(origin, path, signedIn)).toBe(502);
  }
  // Under the attachments, but no attachment's id: forwarded as nobody.
  expect(await statusOf(origin, `${assets}/..%2F..%2Fsettings%2Ftokens`, signedIn)).toBe(200);
  expect(github.got).toEqual([
    {
      url: 'https://github.com/user-attachments/assets/..%2F..%2Fsettings%2Ftokens',
      authorization: null,
      host: null,
    },
  ]);
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
