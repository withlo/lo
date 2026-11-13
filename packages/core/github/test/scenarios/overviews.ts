/**
 * The overviews recorded as `rozed-bot` on rozed-dev/e2e: #80's, which `testing/fixtures/app.sh`
 * builds and the app's tests open, watched and fetched. Nothing here writes to GitHub.
 *
 * - `rest_overview_refs_e2e`: the refs that start #80's overview's ref, then again with the ETag
 *   GitHub gave, which it answers with a `304`; the same for #8, whose prefix only #80's ref starts,
 *   and #9, which nothing starts.
 * - `rest_overview_e2e`: #80's overview, as Lo reads it: the commit's tree, by the commit's ID, its
 *   `artifact.md`, raw, the figure it names first, raw, and the commit.
 * - `rest_overview_refs_missing_e2e`: the refs of a pull request rozed-dev/e2e doesn't have, #9999,
 *   then again with its ETag, and of one in a repository that doesn't exist, rozed-dev/gone#1. A
 *   tab reads its overview's ref as it opens, before it knows whether its pull request exists.
 */

import type { Scenario } from '@lo/testing';

import { GithubClient } from '../../src/client.ts';
import { GithubError } from '../../src/errors.ts';
import { blobBytes, commitSummary, watchOverviewRef } from '../../src/overviews.ts';
import { RepoRef } from '../../src/refs.ts';
import { Token } from '../../src/token.ts';
import { repoTree } from '../../src/trees.ts';

const E2E = new RepoRef('rozed-dev', 'e2e');

/** #80's overview, as `testing/fixtures/app.sh` writes it. */
export const E2E_OVERVIEW = {
  commit: 'ad1cfa3d053a10b8fc8e46ad786f284509e4b8a9',
  tree: '3691c0b1986fa31d3bca412d2f4d6c1d3379edde',
  artifact: 'a481067b4846c72fa4b637d20e40108b20985b66',
  figure: '9e34eac2018965ce2375440252619e90d6b45b33',
} as const;

/** The recordings `node testing/scripts/record.ts` makes from this module. */
export const scenarios: Scenario[] = [
  {
    name: 'rest_overview_refs_e2e',
    description:
      "The refs that start rozed-dev/e2e#80's overview's ref (testing/fixtures/app.sh), #8's, which only #80's starts, and #9's, which none does, each read again with its ETag, as rozed-bot",
    repo: 'rozed-dev/e2e',
    async run(fetch, token) {
      const client = new GithubClient({ fetch, token: new Token(token) });
      for (const number of [80, 8, 9]) {
        const first = await watchOverviewRef(client, E2E, number, undefined);
        if (first.notModified) throw new Error(`#${number}'s refs came back unchanged`);
        await watchOverviewRef(client, E2E, number, first.etag);
      }
      return undefined;
    },
  },
  {
    name: 'rest_overview_e2e',
    description:
      "rozed-dev/e2e#80's overview (testing/fixtures/app.sh), as Lo reads it: its commit's tree, by the commit's ID, its artifact.md, raw, the figure it names first, raw, and the commit, as rozed-bot",
    repo: 'rozed-dev/e2e',
    async run(fetch, token) {
      const client = new GithubClient({ fetch, token: new Token(token) });
      await repoTree(client, E2E, E2E_OVERVIEW.commit);
      await blobBytes(client, E2E, E2E_OVERVIEW.artifact);
      await blobBytes(client, E2E, E2E_OVERVIEW.figure);
      await commitSummary(client, E2E, E2E_OVERVIEW.commit);
      return undefined;
    },
  },
  {
    name: 'rest_overview_refs_missing_e2e',
    description:
      "The overview's refs of a pull request rozed-dev/e2e doesn't have, #9999, read again with its ETag, and of one in a repository that doesn't exist, rozed-dev/gone#1, as rozed-bot",
    repo: 'rozed-dev/e2e',
    async run(fetch, token) {
      const client = new GithubClient({ fetch, token: new Token(token) });
      const none = await watchOverviewRef(client, E2E, 9999, undefined);
      if (none.notModified || none.etag === undefined) throw new Error("#9999's refs have no ETag");
      await watchOverviewRef(client, E2E, 9999, none.etag);
      const gone = await watchOverviewRef(client, new RepoRef('rozed-dev', 'gone'), 1, undefined)
        .then(() => undefined)
        .catch((error: unknown) => error);
      if (!(gone instanceof GithubError) || gone.detail.kind !== 'notFound') {
        throw new Error('rozed-dev/gone answered with something other than a 404', { cause: gone });
      }
      return undefined;
    },
  },
];
