/**
 * The overviews recorded as `rozed-bot` on rozed-dev/e2e: #80's, which `testing/fixtures/app.sh`
 * builds and the app's tests open, watched and fetched. Nothing here writes to GitHub.
 *
 * - `rest_overview_refs_e2e`: the refs that start #80's overview's ref, then again with the ETag
 *   GitHub gave, which it answers with a `304`; the same for #8, whose prefix only #80's ref starts,
 *   and #9, which nothing starts.
 * - `rest_overview_e2e`: #80's overview's commit, its tree, and its two files, raw.
 */

import type { Scenario } from '@lo/testing';

import { GithubClient } from '../../src/client.ts';
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
      "rozed-dev/e2e#80's overview (testing/fixtures/app.sh): its commit, its tree, and its artifact.md and figure, raw, as rozed-bot",
    repo: 'rozed-dev/e2e',
    async run(fetch, token) {
      const client = new GithubClient({ fetch, token: new Token(token) });
      const commit = await commitSummary(client, E2E, E2E_OVERVIEW.commit);
      await repoTree(client, E2E, commit.tree);
      await blobBytes(client, E2E, E2E_OVERVIEW.artifact);
      await blobBytes(client, E2E, E2E_OVERVIEW.figure);
      return undefined;
    },
  },
];
