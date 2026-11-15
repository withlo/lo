/**
 * The repositories pull requests in rozed-dev/e2e join, by node ID, recorded as `rozed-bot`, read
 * only:
 *
 * - #80, from a branch of rozed-dev/e2e itself (`testing/fixtures/app.sh`);
 * - #97, from `fork/live` in rozed-bot/e2e, a fork, one commit adding `fork.md` on `main`;
 * - #96, from `fork/gone` in rozed-bot/e2e-gone, a fork made the same way and deleted once the pull
 *   request was opened, which GitHub then closed and names no head repository for;
 * - #9999, which rozed-dev/e2e doesn't have.
 *
 * rozed-bot made both forks with GitHub's API, and closed #97, so neither is among the repository's
 * open pull requests.
 */

import type { Scenario } from '@lo/testing';

import { GithubClient } from '../../src/client.ts';
import { GithubError } from '../../src/errors.ts';
import { PullRef } from '../../src/refs.ts';
import { readPullRequestRepositories } from '../../src/repositories.ts';
import { Token } from '../../src/token.ts';

/** The fixture's pull requests and repositories, by number and node ID. */
export const REPOSITORIES_E2E = {
  /** rozed-dev/e2e. */
  base: 'R_kgDOVleUfQ',
  /** rozed-bot/e2e, #97's fork. */
  fork: 'R_kgDOVvlr6A',
  sameRepository: 80,
  fromFork: 97,
  fromForkGone: 96,
  missing: 9999,
} as const;

/** The recordings `node testing/scripts/record.ts` makes from this module. */
export const scenarios: Scenario[] = [
  {
    name: 'pull_request_repositories_e2e',
    description:
      'The repositories of rozed-dev/e2e#80, from a branch of its own, #97, from a fork, rozed-bot/e2e, and #96, from a fork that was deleted, by node ID, and of #9999, which it lacks, read as rozed-bot',
    repo: 'rozed-dev/e2e',
    schema: 'github/docs@03caf3ce9bc56af9d147500036b0bb6dda352674',
    async run(fetch, token) {
      const client = new GithubClient({ fetch, token: new Token(token) });
      const { sameRepository, fromFork, fromForkGone, missing } = REPOSITORIES_E2E;
      for (const number of [sameRepository, fromFork, fromForkGone]) {
        await readPullRequestRepositories(client, new PullRef('rozed-dev', 'e2e', number));
      }
      try {
        await readPullRequestRepositories(client, new PullRef('rozed-dev', 'e2e', missing));
      } catch (error) {
        if (error instanceof GithubError && error.detail.kind === 'notFound') return undefined;
        throw error;
      }
      throw new Error(`rozed-dev/e2e#${missing} exists`);
    },
  },
];
