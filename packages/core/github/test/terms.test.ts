// Writing a repository's definitions, `refs/lo/terms`, recorded as rozed-bot on rozed-dev/e2e: who
// may, a tree of `terms.json` and a commit of it, the ref made and moved only from the commit it
// holds and only forward, and how GitHub compares commits; and which of GitHub's refusals say the
// account can't write them.

import { createHash } from 'node:crypto';

import { cassette, replayFetch } from '@lo/testing';
import { describe, expect, test } from 'vitest';

import { GithubClient } from '../src/client.ts';
import { GithubError } from '../src/errors.ts';
import { RepoRef } from '../src/refs.ts';
import {
  holds,
  moveTerms,
  termsAccess,
  termsCommit,
  termsRefusal,
  termsTree,
} from '../src/terms.ts';
import { Token } from '../src/token.ts';
import { TERMS_TEXTS } from './scenarios/terms.ts';

const E2E = new RepoRef('rozed-dev', 'e2e');

/** What the recording made, as its `cassette.json` keeps it. */
const MADE = madeBy(cassette('rest_terms_writes_e2e').info.setup);

/** The IDs `setup`, what a recording made, names. */
function madeBy(setup: unknown): Record<'repositoryId' | 'made' | 'edited' | 'other', string> {
  const of = (name: string): string => {
    const value =
      typeof setup === 'object' && setup !== null ? Reflect.get(setup, name) : undefined;
    if (typeof value !== 'string') throw new Error(`The recording made no ${name}.`);
    return value;
  };
  return {
    repositoryId: of('repositoryId'),
    made: of('made'),
    edited: of('edited'),
    other: of('other'),
  };
}

/** GitHub's REST API refusing a request with `status`, saying `message`. */
function api(status: number, message: string): GithubError {
  return new GithubError({ kind: 'api', status, message, errors: [] });
}

/** The ID git gives a blob of `text`'s UTF-8. */
function blobId(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

test('writes, moves and compares as GitHub answered rozed-bot', async () => {
  const fetch = replayFetch('rest_terms_writes_e2e');
  const client = new GithubClient({ fetch, token: new Token('gho_FAKE') });
  // rozed-bot is rozed-dev/e2e's admin.
  expect(await termsAccess(client, E2E)).toEqual({ repositoryId: MADE.repositoryId, push: true });

  const first = await termsTree(client, E2E, TERMS_TEXTS.first);
  // GitHub made the blob from the text as UTF-8, as git names it.
  expect(first.blob).toBe(blobId(TERMS_TEXTS.first));
  const made = await termsCommit(client, E2E, {
    tree: first.tree,
    parent: undefined,
    message: 'Definitions for the recording',
  });
  expect(made).toBe(MADE.made);
  const { repositoryId } = MADE;
  expect(await moveTerms(client, repositoryId, { from: undefined, to: made })).toEqual({
    kind: 'moved',
  });
  // Made again, where there's one: GitHub says only that something went wrong.
  expect(await moveTerms(client, repositoryId, { from: undefined, to: made })).toMatchObject({
    kind: 'unsure',
    said: expect.stringMatching(/Something went wrong/),
  });

  const second = await termsTree(client, E2E, TERMS_TEXTS.edited);
  expect(second.blob).toBe(blobId(TERMS_TEXTS.edited));
  const edited = await termsCommit(client, E2E, {
    tree: second.tree,
    parent: made,
    message: 'Edit "bucket"',
  });
  const other = await termsCommit(client, E2E, {
    tree: second.tree,
    parent: made,
    message: 'Edit "bucket" elsewhere',
  });
  expect(await moveTerms(client, repositoryId, { from: made, to: edited })).toEqual({
    kind: 'moved',
  });
  // From a commit it no longer holds: refused, in the same words.
  expect(await moveTerms(client, repositoryId, { from: made, to: other })).toMatchObject({
    kind: 'unsure',
  });
  // From where it is, to a commit that isn't on it.
  expect(await moveTerms(client, repositoryId, { from: edited, to: other })).toMatchObject({
    kind: 'behind',
    said: expect.stringMatching(/non-fast forward/),
  });

  expect(await holds(client, E2E, edited, made)).toBe(true);
  expect(await holds(client, E2E, made, edited)).toBe(false);
  expect(await holds(client, E2E, edited, other)).toBe(false);
  expect(fetch.seen.map(({ method, url }) => `${method} ${new URL(url).pathname}`)).toEqual([
    'POST /graphql',
    'POST /repos/rozed-dev/e2e/git/trees',
    'POST /repos/rozed-dev/e2e/git/commits',
    'POST /graphql',
    'POST /graphql',
    'POST /repos/rozed-dev/e2e/git/trees',
    'POST /repos/rozed-dev/e2e/git/commits',
    'POST /repos/rozed-dev/e2e/git/commits',
    'POST /graphql',
    'POST /graphql',
    'POST /graphql',
    `GET /repos/rozed-dev/e2e/compare/${made}...${edited}`,
    `GET /repos/rozed-dev/e2e/compare/${edited}...${made}`,
    `GET /repos/rozed-dev/e2e/compare/${other}...${edited}`,
  ]);
});

test('moves nothing to what isn’t a commit’s ID, and sends nothing for it', async () => {
  const fetch = replayFetch('rest_terms_writes_e2e');
  const client = new GithubClient({ fetch, token: new Token('gho_FAKE') });
  await expect(
    moveTerms(client, MADE.repositoryId, { from: undefined, to: 'refs/heads/main' }),
  ).rejects.toThrow(/object's ID/);
  await expect(
    termsCommit(client, E2E, { tree: 'HEAD', parent: undefined, message: 'x' }),
  ).rejects.toThrow(/object's ID/);
  expect(fetch.seen).toEqual([]);
});

describe('GitHub refusing a write', () => {
  test('says the account can’t push where GitHub refused it or wouldn’t say there was anything', () => {
    expect(termsRefusal(api(403, 'Resource not accessible by integration'))).toMatchObject({
      why: 'push',
    });
    expect(termsRefusal(new GithubError({ kind: 'notFound', message: 'Not Found' }))).toMatchObject(
      { why: 'push' },
    );
    const forbidden = new GithubError({
      kind: 'graphql',
      errors: [{ type: 'FORBIDDEN', message: 'rozed-bot does not have permission', path: [] }],
    });
    expect(termsRefusal(forbidden)).toMatchObject({ why: 'push' });
  });

  test('says a rule blocks it by GitHub’s words', () => {
    expect(termsRefusal(api(422, 'Repository rule violations found'))).toMatchObject({
      why: 'rule',
    });
    expect(termsRefusal(api(403, 'Push rejected by a ruleset'))).toMatchObject({ why: 'rule' });
  });

  test('isn’t a refusal for the rate limit, a refused token, or anything else', () => {
    const limited = new GithubError({ kind: 'rateLimited', message: 'x', secondary: true });
    expect(termsRefusal(limited)).toBeUndefined();
    expect(termsRefusal(new GithubError({ kind: 'unauthorized', message: 'x' }))).toBeUndefined();
    expect(termsRefusal(api(422, 'Validation Failed'))).toBeUndefined();
    expect(termsRefusal(api(500, 'Server Error'))).toBeUndefined();
    expect(termsRefusal(new Error('x'))).toBeUndefined();
  });
});
