// The repositories a pull request joins, by node ID: replayed from what rozed-bot read
// (`test/scenarios/repositories.ts`), and answers GitHub gives only in some organizations.

import { replayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient } from '../src/client.ts';
import { GithubError } from '../src/errors.ts';
import { PullRef } from '../src/refs.ts';
import { readPullRequestRepositories } from '../src/repositories.ts';
import { Token } from '../src/token.ts';
import { REPOSITORIES_E2E } from './scenarios/repositories.ts';

const { base, fork } = REPOSITORIES_E2E;

function read(
  number: number,
  fetch: typeof globalThis.fetch = replayFetch('pull_request_repositories_e2e'),
) {
  const client = new GithubClient({ fetch, token: new Token('gho_FAKE') });
  return readPullRequestRepositories(client, new PullRef('rozed-dev', 'e2e', number));
}

/** A `fetch` that answers every request with `body`, GitHub's answer to a GraphQL query. */
function answering(body: unknown): typeof globalThis.fetch {
  return () => Promise.resolve(Response.json(body));
}

test('a pull request from a branch of its own repository has it as both base and head', async () => {
  expect(await read(REPOSITORIES_E2E.sameRepository)).toEqual({
    base: { id: base, name: 'rozed-dev/e2e' },
    head: { id: base, name: 'rozed-dev/e2e' },
    isCrossRepository: false,
  });
});

test('a pull request from a fork names the fork as its head', async () => {
  expect(await read(REPOSITORIES_E2E.fromFork)).toEqual({
    base: { id: base, name: 'rozed-dev/e2e' },
    head: { id: fork, name: 'rozed-bot/e2e' },
    isCrossRepository: true,
  });
});

test('a pull request whose fork is gone has no head repository, and is from a fork', async () => {
  expect(await read(REPOSITORIES_E2E.fromForkGone)).toEqual({
    base: { id: base, name: 'rozed-dev/e2e' },
    head: undefined,
    isCrossRepository: true,
  });
});

test('a pull request that isn’t there is not found', async () => {
  const error = await read(REPOSITORIES_E2E.missing).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(GithubError);
  expect(error instanceof GithubError && error.detail.kind).toBe('notFound');
});

test('a head GitHub names none for, or another one, is from a fork whatever GitHub says', async () => {
  const answer = (headRepository: unknown, errors?: unknown[]) =>
    answering({
      data: {
        repository: {
          pullRequest: {
            isCrossRepository: false,
            baseRepository: { id: base, nameWithOwner: 'rozed-dev/e2e' },
            headRepository,
          },
        },
      },
      ...(errors === undefined ? {} : { errors }),
    });
  // A fork the account can't see, as in an organization that restricts OAuth apps.
  const hidden = answer(null, [
    {
      type: 'FORBIDDEN',
      path: ['repository', 'pullRequest', 'headRepository'],
      message: 'Although you appear to have the correct authorization credentials, …',
    },
  ]);
  expect(await read(1, hidden)).toEqual({
    base: { id: base, name: 'rozed-dev/e2e' },
    head: undefined,
    isCrossRepository: true,
  });
  const other = answer({ id: fork, nameWithOwner: 'rozed-bot/e2e' });
  expect((await read(1, other)).isCrossRepository).toBe(true);
});

test('an answer with no base repository isn’t taken', async () => {
  const none = answering({
    data: {
      repository: {
        pullRequest: { isCrossRepository: false, baseRepository: null, headRepository: null },
      },
    },
  });
  await expect(read(1, none)).rejects.toThrow('GitHub named no base repository');
});
