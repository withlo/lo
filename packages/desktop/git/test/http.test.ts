// Signing in over real HTTP, against servers on this machine: a proxy that wants a password, a
// server that redirects to another host, a server that wants a password, and a git server that
// lets in one token at a time. The token must reach only the remote's own host, and a clone open
// across a renewal of the account's token signs in with the renewed one.

import {
  basicCredentials,
  FakeServer,
  GitHttpServer,
  type RemoteRepo,
  type RepoServer,
} from '@lo/testing/git';
import { expect, onTestFinished, test } from 'vitest';

import { GitError } from '../src/errors.ts';
import { type Oid, parseOid } from '../src/oid.ts';
import type { Repo } from '../src/repo.ts';
import { blobs, readFile, refs } from './fixtures.ts';
import { cacheFor, repoServer } from './support.ts';

/** The token the tests sign in with. Not a real one. */
const TOKEN = 'SECRET_TOKEN_FOR_TESTS';

/** A token source that gives what `holder.token` holds, as an account's client does. */
function following(holder: { token: string }) {
  return () => Promise.resolve(holder.token);
}

async function failure(promise: Promise<unknown>): Promise<GitError> {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof GitError)) throw new Error(`expected a GitError, got ${String(error)}`);
  return error;
}

/** Fetching pull request #1 of `owner/repo` from `remote`, signed in with {@link TOKEN}. */
async function fetchPullOne(
  remote: string,
  options: { proxy?: string; config?: string[] } = {},
): Promise<GitError> {
  const cache = await cacheFor(remote, { config: options.config });
  const repo = await cache.open('owner', 'repo', {
    token: () => Promise.resolve(TOKEN),
    proxy: () => Promise.resolve(options.proxy),
  });
  return failure(repo.fetchPull(refs(1, 'main')));
}

async function started(server: Promise<FakeServer>): Promise<FakeServer> {
  const running = await server;
  onTestFinished(() => running.close());
  return running;
}

test('a proxy that asks for a password never gets the token', async () => {
  const proxy = await started(FakeServer.proxy());
  // The proxy's URL names a user but no password, so git asks for one.
  const address = `http://alice@127.0.0.1:${proxy.port}`;

  // github.com itself, through the proxy, which answers everything.
  const error = await fetchPullOne('https://github.com', { proxy: address });

  expect(proxy.saw(TOKEN)).toBe(false);
  expect(error.detail.kind).toBe('fetch');
});

test('a server that asks for a password gets the token', async () => {
  const server = await started(FakeServer.asksForAPassword());

  const error = await fetchPullOne(server.url);

  // It asked, got the token, and refused it, which says nothing about signing in.
  expect(server.saw(TOKEN)).toBe(true);
  expect(error.detail).toMatchObject({ kind: 'fetch', failure: 'tokenRefused' });
  expect(error.message).not.toContain('sign in');
  expect(error.message).toContain("GitHub refused the account's token");
});

test('a redirect to another host is never followed', async () => {
  const elsewhere = await started(FakeServer.asksForAPassword());
  const redirector = await started(FakeServer.redirectsTo(elsewhere.port));

  await fetchPullOne(redirector.url);

  expect(redirector.requests()).not.toEqual([]);
  expect(elsewhere.requests()).toEqual([]);
});

test('a host redirected to never gets the token', async () => {
  const elsewhere = await started(FakeServer.asksForAPassword());
  const redirector = await started(FakeServer.redirectsTo(elsewhere.port));

  // Even with redirects on, the token is only for the remote's own host.
  await fetchPullOne(redirector.url, { config: ['http.followRedirects=true'] });

  // With redirects on, the request reaches the other host.
  expect(elsewhere.requests()).not.toEqual([]);
  expect(elsewhere.saw(TOKEN)).toBe(false);
});

test('decodes basic credentials', () => {
  expect(basicCredentials('Basic eC1hY2Nlc3MtdG9rZW46YWJj')).toBe('x-access-token:abc');
  expect(basicCredentials('Basic YWI=')).toBe('ab');
  expect(basicCredentials('Basic YQ==')).toBe('a');
  expect(basicCredentials('Bearer abc')).toBeUndefined();
  expect(basicCredentials(undefined)).toBeUndefined();
});

/**
 * GitHub's copy of `owner/repo`, served over HTTP to one token at a time: `main` with `a.txt`, and
 * pull request #1, whose head adds `b.txt`.
 */
async function pullOne(token: string): Promise<{
  server: RepoServer;
  remote: RemoteRepo;
  http: GitHttpServer;
  head: Oid;
}> {
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  remote.write('a.txt', 'a\n').commit('base');
  remote.publish('refs/heads/main');
  remote.switch('feature').write('b.txt', 'b\n');
  const head = parseOid(remote.commit('head'));
  remote.publish('refs/pull/1/head');
  const http = await GitHttpServer.start(server.remotes, token);
  onTestFinished(() => http.close());
  return { server, remote, http, head };
}

/** Pushes a commit adding `c.txt` on top of pull request #1's head, and returns it. */
function push(remote: RemoteRepo): Oid {
  const pushed = parseOid(remote.write('c.txt', 'c\n').commit('push'));
  remote.publish('refs/pull/1/head');
  return pushed;
}

/** Pull request #1, fetched into a clone open with the account's token from `holder`. */
async function openWithPullOne(
  http: GitHttpServer,
  holder: { token: string },
  head: Oid,
): Promise<Repo> {
  const cache = await cacheFor(http.url);
  const repo = await cache.open('owner', 'repo', { token: following(holder) });
  expect((await repo.fetchPull(refs(1, 'main'))).head).toBe(head);
  return repo;
}

test('a clone open across a renewal fetches and downloads with the renewed token', async () => {
  const { remote, http, head } = await pullOne('gho_OLD');
  const holder = { token: 'gho_OLD' };
  const repo = await openWithPullOne(http, holder, head);
  // Downloading a file signs in with the token.
  const [a] = blobs(repo, head);
  expect(await repo.download(a === undefined ? [] : [a])).toEqual([]);
  expect(readFile(repo, head, 'a.txt')).toBe('a');

  // The account's token is renewed, which revokes the one before.
  http.accept('gho_NEW');
  holder.token = 'gho_NEW';
  const renewedAt = http.signedInWith().length;

  // A push after the renewal is fetched, and files not read yet download, all with the new token.
  const pushed = push(remote);
  expect((await repo.fetchPull(refs(1, 'main'))).head).toBe(pushed);
  expect(await repo.download(blobs(repo, pushed))).toEqual([]);
  expect([readFile(repo, head, 'b.txt'), readFile(repo, pushed, 'c.txt')]).toEqual(['b', 'c']);
  const since = http.signedInWith().slice(renewedAt);
  expect(since).not.toEqual([]);
  expect(since.filter((token) => token !== 'gho_NEW')).toEqual([]);
});

test('a fetch refused while the token was renewed fetches again with the renewed one', async () => {
  const { http, head } = await pullOne('gho_NEW');
  const holder = { token: 'gho_OLD' };
  // The token is renewed while git fetches with the old one, which GitHub refuses.
  http.onRefused(() => {
    holder.token = 'gho_NEW';
  });
  const cache = await cacheFor(http.url);
  const repo = await cache.open('owner', 'repo', { token: following(holder) });

  const fetched = await repo.fetchPull(refs(1, 'main'));

  expect(fetched.head).toBe(head);
  const signedInWith = http.signedInWith();
  expect(signedInWith[0]).toBe('gho_OLD');
  expect(signedInWith.slice(1).filter((token) => token !== 'gho_NEW')).toEqual([]);
});

test('a clone open across a renewal downloads files with the renewed token', async () => {
  const { http, head } = await pullOne('gho_OLD');
  const holder = { token: 'gho_OLD' };
  const repo = await openWithPullOne(http, holder, head);

  // The account's token is renewed, which revokes the one before.
  http.accept('gho_NEW');
  holder.token = 'gho_NEW';
  const renewedAt = http.signedInWith().length;

  // Listing needs no sign-in, and the download signs in with the renewed token.
  const files = blobs(repo, head);
  expect(files).toHaveLength(2);
  expect(http.signedInWith()).toHaveLength(renewedAt);
  expect(await repo.download(files)).toEqual([]);
  const since = http.signedInWith().slice(renewedAt);
  expect(since).not.toEqual([]);
  expect(since.filter((token) => token !== 'gho_NEW')).toEqual([]);
  expect(readFile(repo, head, 'b.txt')).toBe('b');
});

test('a download refused while the token was renewed downloads again with the renewed one', async () => {
  const { http, head } = await pullOne('gho_OLD');
  const holder = { token: 'gho_OLD' };
  const repo = await openWithPullOne(http, holder, head);

  // The token is renewed while git downloads with the old one, which GitHub refuses.
  http.accept('gho_NEW');
  http.onRefused(() => {
    holder.token = 'gho_NEW';
  });
  const refusedFrom = http.signedInWith().length;

  expect(await repo.download(blobs(repo, head))).toEqual([]);

  const since = http.signedInWith().slice(refusedFrom);
  expect(since[0]).toBe('gho_OLD');
  expect(since.length).toBeGreaterThan(1);
  expect(since.slice(1).filter((token) => token !== 'gho_NEW')).toEqual([]);
});

test('a token github refuses isnt a reason to sign in', async () => {
  const { http } = await pullOne('gho_NEW');
  const cache = await cacheFor(http.url);
  const repo = await cache.open('owner', 'repo', { token: () => Promise.resolve('gho_REVOKED') });

  const error = await failure(repo.fetchPull(refs(1, 'main')));

  expect(error.detail).toMatchObject({ kind: 'fetch', failure: 'tokenRefused' });
  // The account is signed in; it's the token GitHub refused, which renewing replaces.
  expect(error.isRetryable()).toBe(true);
  expect(error.message).not.toContain('sign in');
  expect(error.message).toContain(
    "GitHub refused the account's token, which may have just expired; Lo tries again with its " +
      'renewed token',
  );
});
