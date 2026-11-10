// The REST client on responses recorded from `rozed-dev/playground`.

import type { components } from '@octokit/openapi-types';
import { replayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient } from '../src/client.ts';
import { GithubError } from '../src/errors.ts';
import { fileHead, parsedPatch, pullFiles } from '../src/files.ts';
import { unchecked } from '../src/json.ts';
import { readPullSummary } from '../src/pulls.ts';
import { PullRef } from '../src/refs.ts';
import { Token } from '../src/token.ts';
import { missingScopes } from '../src/user.ts';

const PULL = '/repos/rozed-dev/playground/pulls/1';

const signedIn = (fetch: typeof globalThis.fetch) =>
  new GithubClient({ fetch, token: new Token('gho_FAKE') });

test('a conditional get returns not modified when nothing changed', async () => {
  const fetch = replayFetch('rest_pull_conditional');
  const client = signedIn(fetch);

  const first = await client.getConditional(PULL, undefined, readPullSummary);
  expect(first).toMatchObject({
    notModified: false,
    value: { number: 1, head: { ref: 'stack-a' } },
  });
  const etag = first.notModified ? undefined : first.etag;
  // GitHub sends an ETag for a pull request.
  expect(etag).toBeDefined();

  const second = await client.getConditional(PULL, etag, readPullSummary);
  expect(second).toEqual({ notModified: true });

  const { seen } = fetch;
  expect(seen[0]?.headers.get('if-none-match')).toBeNull();
  expect(seen[1]?.headers.get('if-none-match')).toBe(etag);
  expect(seen[1]?.headers.get('authorization')).toBe('token gho_FAKE');
  // The 304 still reports the limit.
  expect(client.rateLimits().core()).toBeDefined();
});

/**
 * Recorded alone, with `GET /rate_limit` (itself free) before and after: the plain GET cost 1,
 * and three 304s cost nothing.
 */
test('a 304 costs no rate limit', async () => {
  const client = signedIn(replayFetch('rest_pull_304_rate_limit'));
  const coreUsed = async () => {
    const limits = await client.get(
      '/rate_limit',
      unchecked<components['schemas']['rate-limit-overview']>,
    );
    return limits.resources.core.used;
  };
  const before = await coreUsed();
  const first = await client.getConditional(PULL, undefined, readPullSummary);
  const etag = first.notModified ? undefined : first.etag;
  const after200 = await coreUsed();
  for (let time = 0; time < 3; time++) {
    expect(await client.getConditional(PULL, etag, readPullSummary)).toEqual({
      notModified: true,
    });
  }
  const after304s = await coreUsed();
  expect(after200).toBe(before + 1);
  expect(after304s).toBe(after200);
});

test('a pull requests files come with their patches', async () => {
  const fetch = replayFetch('rest_pull_files');
  const files = await pullFiles(signedIn(fetch), new PullRef('rozed-dev', 'playground', 2));

  // PR #2's one file.
  expect(files).toHaveLength(1);
  const [file] = files;
  expect(file?.filename).toBe('stack-b.md');
  expect(file?.status).toBe('added');
  // The head GitHub listed it at, PR #2's.
  expect(file && fileHead(file)).toBe('d712aa7652cc723fee5fd9b3eba867b0480d40da');
  expect([file?.additions, file?.deletions]).toEqual([1, 0]);
  const patch = file && parsedPatch(file);
  expect(patch?.hunks).toHaveLength(1);
  const [hunk] = patch?.hunks ?? [];
  expect([hunk?.old, hunk?.new]).toEqual([
    { start: 0, end: 0 },
    { start: 0, end: 1 },
  ]);
  expect(hunk?.lines).toEqual([{ kind: 'added', text: 'Layer B of the stack fixture.' }]);
  expect(patch?.newMissingNewline).toBe(false);

  const [seen] = fetch.seen;
  expect(seen?.url).toBe(
    'https://api.github.com/repos/rozed-dev/playground/pulls/2/files?per_page=100',
  );
  expect(seen?.headers.get('authorization')).toBe('token gho_FAKE');
});

test('user reads the login and scopes', async () => {
  const { user, scopes } = await signedIn(replayFetch('user')).user();
  expect(user.login).toBe('rozed-bot');
  expect(user.id).toBe(353226052);
  expect(scopes).toEqual(['read:org', 'repo', 'workflow']);
  expect(missingScopes(scopes)).toEqual([]);
});

test('a missing repository is not found', async () => {
  const client = signedIn(replayFetch('rest_not_found'));
  const error = await client
    .get('/repos/rozed-dev/does-not-exist', (json) => json)
    .catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(GithubError);
  expect(error instanceof GithubError && error.detail).toEqual({
    kind: 'notFound',
    message: 'Not Found',
    documentationUrl: expect.stringMatching(/^https:\/\/docs\.github\.com\//),
  });
});

test('github gives a text patch for a file its attributes call binary', async () => {
  // yarnpkg/berry#7077, read as rozed-bot: its `.gitattributes` marks `/.pnp.*` and `hook.js`
  // binary, which unsets `diff`.
  const client = signedIn(replayFetch('rest_pull_files_berry_7077'));
  const pull = new PullRef('yarnpkg', 'berry', 7077);
  const summary = await client.get(pull.restPath(), readPullSummary);
  const head = summary.head.sha;
  const files = await pullFiles(client, pull);
  const contents = await client.get(
    `/repos/yarnpkg/berry/contents/.gitattributes?ref=${head}`,
    unchecked<components['schemas']['content-file']>,
  );
  const attributes = Buffer.from(contents.content, 'base64').toString('utf8');
  const marked = (pattern: string) =>
    attributes.split('\n').some((line) => {
      const [first, ...rest] = line.split(/\s+/).filter(Boolean);
      return first === pattern && rest.includes('binary');
    });
  expect(marked('/.pnp.*')).toBe(true);
  expect(marked('packages/yarnpkg-pnp/sources/hook.js')).toBe(true);

  const file = (name: string) => files.find((found) => found.filename === name);
  const pnp = file('.pnp.cjs');
  expect(pnp && parsedPatch(pnp)?.hunks.length).toBeGreaterThan(0);
  // hook.js is one line of 140 kB, too large for a patch.
  const hook = file('packages/yarnpkg-pnp/sources/hook.js');
  expect([hook?.additions, hook?.deletions, hook?.patch]).toEqual([1, 1, undefined]);
});
