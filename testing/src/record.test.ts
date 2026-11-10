import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { queryHash, readCassette } from './cassette.ts';
import { replayFetch } from './fetch.ts';
import {
  checkRecordingAccount,
  fileName,
  isWrite,
  Recorder,
  recordedRequest,
  recordedResponse,
  redactSignedUrls,
} from './record.ts';
import { Replay } from './replay.ts';
import { findSecret, unblankedCredential } from './secrets.ts';

/** A `fetch` that answers every request with the same response. */
function fixed(body: string, status = 200): typeof globalThis.fetch {
  return () =>
    Promise.resolve(
      new Response(body, {
        status,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          etag: 'W/"abc"',
          'x-ratelimit-remaining': '4999',
          'set-cookie': '_gh_sess=secret',
          'x-github-request-id': 'ABCD:1234',
        },
      }),
    );
}

/** A folder for one test, removed when it ends. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lo-record-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const FAKE_TOKEN = 'fake-token-for-the-recorder-test';

test('records a replayable cassette without request headers', async () => {
  const cassette = join(scratch(), 'c');
  const recorder = new Recorder({
    fetch: fixed('{"login":"rozed-bot"}'),
    dir: cassette,
    secrets: [FAKE_TOKEN],
  });
  const response = await recorder.fetch('https://api.github.com/user', {
    headers: {
      Authorization: `token ${FAKE_TOKEN}`,
      'If-None-Match': 'W/"old"',
      'If-Modified-Since': 'Fri, 06 Nov 2026 08:15:07 GMT',
    },
  });
  expect(await response.text()).toBe('{"login":"rozed-bot"}');
  recorder.finish({ description: 'test' });

  const { interactions } = readCassette(cassette);
  expect(interactions).toHaveLength(1);
  const { file, interaction } = interactions[0]!;
  expect(file).toBe('001-GET-user.json');
  expect(interaction.request.if_none_match).toBe('W/"old"');
  expect(interaction.request.if_modified_since).toBe('Fri, 06 Nov 2026 08:15:07 GMT');
  expect(Object.keys(interaction.response.headers)).toEqual([
    'content-type',
    'etag',
    'x-ratelimit-remaining',
  ]);
  const text = readFileSync(join(cassette, file), 'utf8');
  expect(text).not.toContain('token');
  expect(text).not.toContain('secret');

  const replayed = await replayFetch(Replay.fromDir(cassette))('https://api.github.com/user', {
    headers: {
      'If-None-Match': 'W/"old"',
      'If-Modified-Since': 'Fri, 06 Nov 2026 08:15:07 GMT',
    },
  });
  expect(replayed.headers.get('etag')).toBe('W/"abc"');
});

test('refuses a response holding the token and deletes the cassette', async () => {
  const cassette = join(scratch(), 'leak');
  const recorder = new Recorder({
    fetch: fixed(`{"echo":"${FAKE_TOKEN}"}`),
    dir: cassette,
    secrets: [FAKE_TOKEN],
  });
  await expect(recorder.fetch('https://api.github.com/echo')).rejects.toThrow(
    'the recording token',
  );
  expect(() => recorder.finish({ description: '' })).toThrow('refused');
  expect(existsSync(cassette)).toBe(false);
});

test('refuses anything shaped like a token', async () => {
  const cassette = join(scratch(), 'shaped');
  const otherToken = `ghp_${'x'.repeat(36)}`;
  const recorder = new Recorder({
    fetch: fixed(`{"echo":"${otherToken}"}`),
    dir: cassette,
    secrets: [FAKE_TOKEN],
  });
  await expect(recorder.fetch('https://api.github.com/x')).rejects.toThrow(
    'something shaped like a GitHub token',
  );
  expect(() => recorder.finish({ description: '' })).toThrow('refused');
  expect(existsSync(cassette)).toBe(false);
});

// A private repository's answer holds a temporary clone token, as GitHub hands one to an account
// that can read it: the recording keeps the field, blank, and every other credential field, at
// any depth.
test("blanks credential fields such as a private repository's clone token", () => {
  const url = new URL('https://api.github.com/repos/o/private');
  const body =
    '{"id":1,"temp_clone_token":"CUG42RBWQ6AA2KVHIGO5G4LK6FOJM","owner":{"login":"o","refresh_token":"r1"},"items":[{"client_secret":"s"}],"token_count":3}';
  const response = recordedResponse(url, 200, new Headers(), new TextEncoder().encode(body));
  expect(response.body).toEqual({
    id: 1,
    temp_clone_token: '',
    owner: { login: 'o', refresh_token: '' },
    items: [{ client_secret: '' }],
    token_count: 3,
  });
  expect(unblankedCredential(response.body ?? null)).toBeUndefined();
  // And the check before writing refuses one that's left.
  expect(findSecret(body, [])).toBeDefined();
});

test("keeps the token's scopes only for get user", () => {
  const headers = new Headers({
    'x-oauth-scopes': 'delete_repo, repo',
    'x-accepted-oauth-scopes': 'repo',
    'x-ratelimit-remaining': '4999',
  });
  const kept = (url: string) =>
    Object.keys(
      recordedResponse(new URL(url), 200, headers, new TextEncoder().encode('{}')).headers,
    );
  expect(kept('https://api.github.com/user')).toEqual(['x-oauth-scopes', 'x-ratelimit-remaining']);
  expect(kept('https://api.github.com/repos/o/r/activity')).toEqual(['x-ratelimit-remaining']);
});

test("drops every header it doesn't keep, cookies included", () => {
  const headers = new Headers({
    'set-cookie': '_gh_sess=secret',
    'x-github-request-id': 'A:1',
    etag: 'W/"x"',
  });
  const response = recordedResponse(
    new URL('https://api.github.com/x'),
    200,
    headers,
    new Uint8Array(),
  );
  expect(response.headers).toEqual({ etag: 'W/"x"' });
});

test('redacts signed urls', () => {
  const response = recordedResponse(
    new URL('https://api.github.com/x'),
    302,
    new Headers({
      location:
        'https://b.s3.amazonaws.com/x?X-Amz-Credential=AKIA%2F1&X-Amz-Signature=abc123&X-Amz-Expires=300',
    }),
    new Uint8Array(),
  );
  expect(response.headers['location']).toBe(
    'https://b.s3.amazonaws.com/x?X-Amz-Credential=REDACTED&X-Amz-Signature=REDACTED&X-Amz-Expires=300',
  );
});

test('redacts signed query values', () => {
  const redacted = redactSignedUrls(
    [
      'https://raw.githubusercontent.com/o/r/main/a.txt?token=GHSAT0AAAAA ',
      'https://private-user-images.githubusercontent.com/1/x.png?jwt=eyJhbGciOi.x.y ',
      'https://productionresultssa1.blob.core.windows.net/logs/1.txt?sv=2021-08-06&se=2026-11-06T10%3A00Z&sr=b&sp=r&sig=abc%2Bdef ',
      'required; url=https://github.com/orgs/acme/sso?authorization_request=ABCDEF ',
      '<a href="https://codeload.github.com/o/r/zip/main?x=1&amp;token=AAAA">',
    ].join(''),
  );
  expect(redacted).toBe(
    [
      'https://raw.githubusercontent.com/o/r/main/a.txt?token=REDACTED ',
      'https://private-user-images.githubusercontent.com/1/x.png?jwt=REDACTED ',
      'https://productionresultssa1.blob.core.windows.net/logs/1.txt?sv=REDACTED&se=REDACTED&sr=b&sp=r&sig=REDACTED ',
      'required; url=https://github.com/orgs/acme/sso?authorization_request=REDACTED ',
      '<a href="https://codeload.github.com/o/r/zip/main?x=1&amp;token=REDACTED">',
    ].join(''),
  );
});

test('a kept sso header is redacted', () => {
  const response = recordedResponse(
    new URL('https://api.github.com/x'),
    403,
    new Headers({
      'x-github-sso': 'required; url=https://github.com/orgs/acme/sso?authorization_request=SECRET',
    }),
    new TextEncoder().encode('{}'),
  );
  expect(response.headers['x-github-sso']).toBe(
    'required; url=https://github.com/orgs/acme/sso?authorization_request=REDACTED',
  );
});

test('file names never leave the cassette', () => {
  const request = {
    method: 'POST',
    url: 'https://api.github.com/graphql',
    operation: '../../../evil/Name',
  };
  expect(fileName(1, request)).toBe('001-POST-graphql-_________evil_Name.json');
});

test('graphql requests record their operation', () => {
  const body =
    '{"query":"query Viewer { viewer { login } }","operationName":"Viewer","variables":{}}';
  const request = recordedRequest('POST', new URL('https://api.github.com/graphql'), body);
  expect(request.operation).toBe('Viewer');
  expect(request.variables).toEqual({});
  // The normalized query's hash, which formatting and comments don't change.
  expect(request.query_sha256).toBe(queryHash('query Viewer { viewer { login } }'));
  expect(request.query_sha256).toBe(
    queryHash('# Who signed in.\nquery Viewer {\n  viewer {\n    login\n  }\n}\n'),
  );
  expect(request.body_sha256).toBeUndefined();
  expect(fileName(3, request)).toBe('003-POST-graphql-Viewer.json');
});

function graphqlRequest(query: string, operationName: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ query, operationName, variables: {} }));
}

test('a GraphQL query is a read, and a mutation or any other body a write', () => {
  const graphql = new URL('https://api.github.com/graphql');
  const body = graphqlRequest;
  expect(isWrite('POST', graphql, body('query Viewer { viewer { login } }', 'Viewer'))).toBe(false);
  expect(
    isWrite(
      'POST',
      graphql,
      body('mutation Resolve { resolveReviewThread(input: {}) { clientMutationId } }', 'Resolve'),
    ),
  ).toBe(true);
  // The operation it names, not the first in the document.
  expect(isWrite('POST', graphql, body('query A { viewer { login } } mutation B { x }', 'B'))).toBe(
    true,
  );
  expect(isWrite('GET', new URL('https://api.github.com/user'), new Uint8Array())).toBe(false);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    expect(
      isWrite(method, new URL('https://api.github.com/repos/o/r/pulls/1/merge'), new Uint8Array()),
    ).toBe(true);
  }
});

test('refuses to send a write unless the recording may write', async () => {
  const cassette = join(scratch(), 'write');
  let sent = 0;
  const recorder = new Recorder({
    fetch: (...args) => {
      sent += 1;
      return fixed('{}')(...args);
    },
    dir: cassette,
    secrets: [FAKE_TOKEN],
  });
  await expect(
    recorder.fetch('https://api.github.com/repos/o/r/pulls/1/merge', { method: 'PUT', body: '{}' }),
  ).rejects.toThrow('writes to GitHub, and this recording may not');
  expect(sent).toBe(0);
  expect(() => recorder.finish({ description: '' })).toThrow('refused');
  expect(existsSync(cassette)).toBe(false);

  const allowed = new Recorder({ fetch: fixed('{}'), dir: cassette, secrets: [], writes: true });
  await allowed.fetch('https://api.github.com/repos/o/r/pulls/1/merge', {
    method: 'PUT',
    body: '{}',
  });
  allowed.finish({ description: 'a merge' });
  expect(readCassette(cassette).interactions[0]?.interaction.request.body_sha256).toBeDefined();
});

test('records only as the bot', async () => {
  const asked: string[] = [];
  const user =
    (login: string): typeof globalThis.fetch =>
    (input, init) => {
      asked.push(new Headers(init?.headers).get('authorization') ?? '');
      return Promise.resolve(Response.json({ login }));
    };
  await expect(checkRecordingAccount(user('rozed-bot'), FAKE_TOKEN)).resolves.toBeUndefined();
  await expect(checkRecordingAccount(user('someone'), FAKE_TOKEN)).rejects.toThrow(
    'the token belongs to "someone", and recordings are made only as rozed-bot',
  );
  await expect(
    checkRecordingAccount(() => Promise.resolve(new Response('', { status: 401 })), FAKE_TOKEN),
  ).rejects.toThrow('401');
  expect(asked).toEqual([`token ${FAKE_TOKEN}`, `token ${FAKE_TOKEN}`]);
});
