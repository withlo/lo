import { Replay, replayFetch, type Interaction, type Json } from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import { unchecked } from './json.ts';
import { fetchPublicPull, fetchPullAs, readPullToOpen, type PullToOpen } from './pulls.ts';
import { PullRef } from './refs.ts';
import { Token } from './token.ts';

/** GitHub's answer for sharkdp/fd#2212, trimmed to the fields Lo reads and a few around them. */
const FD_2212 = `{
  "number": 2212,
  "title": "Honor explicit use-jemalloc requests",
  "state": "open",
  "user": { "login": "voidsipp", "id": 1 },
  "created_at": "2026-03-02T10:20:30Z",
  "head": {
    "sha": "22c70acc6992c0c51cb68527b87adf114d01acbc",
    "ref": "fix/1822-explicit-jemalloc",
    "repo": { "id": 2, "full_name": "voidsipp/fd", "clone_url": "https://github.com/voidsipp/fd.git" }
  },
  "base": {
    "sha": "cc4e40fa4e32d61733cd72926e233a3fb6c8d56d",
    "ref": "master",
    "repo": { "id": 1, "full_name": "sharkdp/fd", "clone_url": "https://github.com/sharkdp/fd.git" }
  }
}`;

const PULL = new PullRef('sharkdp', 'fd', 2212);
const PULL_URL = 'https://api.github.com/repos/sharkdp/fd/pulls/2212';

/** Answers the pull request's URL with `status`, `body` and `headers`, and anything else not at all. */
function canned(status: number, body: string, headers: Record<string, string> = {}) {
  return replayFetch(new Replay('canned', [answer(PULL_URL, status, body, headers)]));
}

function answer(
  url: string,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Interaction {
  return { request: { method: 'GET', url }, response: { status, headers, ...asBody(body) } };
}

/** `body` as a recorded response holds it: as JSON when it is JSON. */
function asBody(body: string): Pick<Interaction['response'], 'body' | 'body_text'> {
  try {
    return { body: unchecked<Json>(JSON.parse(body)) };
  } catch {
    return { body_text: body };
  }
}

function fetchAnonymously(fetch: typeof globalThis.fetch) {
  return fetchPublicPull(new GithubClient({ fetch }), PULL);
}

function fetchSignedIn(fetch: typeof globalThis.fetch) {
  return fetchPullAs(
    new GithubClient({ fetch, token: new Token('gho_secret') }),
    'rozed-bot',
    PULL,
  );
}

/** What `promise` rejected with. */
async function failure(promise: Promise<unknown>): Promise<Error> {
  const thrown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown instanceof Error) return thrown;
  throw new Error(`expected an error, got ${String(thrown)}`);
}

/** The GitHub error `promise` fails with. */
async function githubFailure(promise: Promise<unknown>): Promise<GithubError> {
  const error = await failure(promise);
  if (error instanceof GithubError) return error;
  throw new Error(`expected GitHub's error, got ${String(error)}`);
}

function read(body: string): PullToOpen {
  return readPullToOpen(JSON.parse(body));
}

test('reads the base branch head and clone url', async () => {
  const fetch = canned(200, FD_2212);
  const pull = await fetchAnonymously(fetch);
  expect(pull).toEqual({
    title: 'Honor explicit use-jemalloc requests',
    user: { login: 'voidsipp' },
    created_at: new Date('2026-03-02T10:20:30Z'),
    head: {
      sha: '22c70acc6992c0c51cb68527b87adf114d01acbc',
      repo: { id: 2, full_name: 'voidsipp/fd' },
    },
    base: {
      ref: 'master',
      sha: 'cc4e40fa4e32d61733cd72926e233a3fb6c8d56d',
      repo: { id: 1, full_name: 'sharkdp/fd', clone_url: 'https://github.com/sharkdp/fd.git' },
    },
    changed_files: undefined,
    merged: false,
    merge_commit_sha: undefined,
  } satisfies PullToOpen);

  const [request] = fetch.seen;
  expect(request?.url).toBe(PULL_URL);
  expect(request?.method).toBe('GET');
  expect(request?.headers.get('accept')).toBe('application/vnd.github+json');
  expect(request?.headers.get('authorization')).toBeNull();

  // A renamed repository's redirect is followed.
  const moved = 'https://api.github.com/repositories/1/pulls/2212';
  const renamed = replayFetch(
    new Replay('renamed', [
      answer(PULL_URL, 301, '{"message":"Moved Permanently"}', { location: moved }),
      answer(moved, 200, FD_2212),
    ]),
  );
  expect(await fetchAnonymously(renamed)).toEqual(pull);
  expect(renamed.seen.map((seen) => seen.url)).toEqual([PULL_URL, moved]);
});

test('signed in it reads with the accounts client', async () => {
  const fetch = canned(200, FD_2212);
  const pull = await fetchSignedIn(fetch);
  expect(pull).toEqual(await fetchAnonymously(canned(200, FD_2212)));
  const [request] = fetch.seen;
  expect(request?.url).toBe(PULL_URL);
  expect(request?.headers.get('authorization')).toBe('token gho_secret');

  const missing = await failure(fetchSignedIn(canned(404, '{"message":"Not Found"}')));
  expect(missing.message).toBe(
    "GitHub has no pull request sharkdp/fd#2212, or rozed-bot can't see it",
  );
  const broken = await failure(fetchSignedIn(canned(500, '{"message":"Server Error"}')));
  expect(broken.message).toBe(
    'asking GitHub for sharkdp/fd#2212: GitHub answered 500: Server Error',
  );
});

/**
 * A fork's head branch says where it lives, and once the fork is deleted, GitHub leaves that out:
 * either way it isn't the base's repository.
 */
test('a deleted fork is no head repository', () => {
  const pull = read(FD_2212);
  expect(pull.base.repo.id).toBe(1);
  expect(pull.head.repo?.id).toBe(2);
  const deleted = FD_2212.replace(
    '{ "id": 2, "full_name": "voidsipp/fd", "clone_url": "https://github.com/voidsipp/fd.git" }',
    'null',
  );
  expect(read(deleted).head.repo).toBeUndefined();
});

test('a deleted author is no author', () => {
  const body = FD_2212.replace('{ "login": "voidsipp", "id": 1 }', 'null');
  expect(read(body).user).toBeUndefined();
});

test('refuses a repository name that isnt owner slash name', () => {
  for (const name of ['fd', '/fd', 'sharkdp/', 'a/b/c']) {
    const body = FD_2212.replace('"sharkdp/fd"', JSON.stringify(name));
    expect(() => read(body)).toThrow('named the repository');
  }
});

test('a missing or private pull request is githubs not found', async () => {
  const error = await githubFailure(fetchAnonymously(canned(404, '{"message":"Not Found"}')));
  expect(error.detail).toMatchObject({ kind: 'notFound', message: 'Not Found' });
});

test('a used up rate limit is githubs, with when it resets', async () => {
  const fetch = canned(403, '{"message":"API rate limit exceeded"}', {
    'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': '1700000000',
  });
  const error = await githubFailure(fetchAnonymously(fetch));
  expect(error.detail).toMatchObject({
    kind: 'rateLimited',
    secondary: false,
    reset: 1700000000,
  });
  expect(error.said()).toBe('API rate limit exceeded');
});

test('other errors carry githubs status and message', async () => {
  const error = await githubFailure(fetchAnonymously(canned(500, '{"message":"Server Error"}')));
  expect(error.said()).toBe('500 Internal Server Error\nServer Error');
});

test('refuses a clone url off github', () => {
  const body = FD_2212.replace('https://github.com/sharkdp/fd.git', 'https://example.com/fd.git');
  expect(() => read(body)).toThrow("isn't on github.com");
});

test('an unexpected body is an error', async () => {
  const error = await failure(fetchAnonymously(canned(200, '<html>')));
  expect(error.message).toContain("reading GitHub's answer");
});
