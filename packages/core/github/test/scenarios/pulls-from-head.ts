/**
 * The open pull requests from a branch, recorded on `rozed-dev/e2e` as `rozed-bot`, read only, on
 * one generation of the merge fixture (`testing/fixtures/merge.sh`):
 *
 *   LO_MERGE_GENERATION=<generation> LO_FIXTURE_TOKEN_FILE=<file> \
 *     node testing/scripts/record.ts packages/core/github/test/scenarios/pulls-from-head.ts
 *
 * - `merge/<generation>/chain-1`, which the generation's `chain-1` pull request comes from, and
 *   which `chain-2` is based on;
 * - `merge/<generation>/base`, which no pull request comes from;
 * - `code/fork`, which only a pull request from rozed-bot's fork comes from (the code fixture's
 *   #99): a fork's branch of that name.
 */

import type { Scenario } from '@lo/testing';

import { GithubClient } from '../../src/client.ts';
import { openPullsFromHead } from '../../src/merge.ts';
import { RepoRef } from '../../src/refs.ts';
import { Token } from '../../src/token.ts';

export const REPO = new RepoRef('rozed-dev', 'e2e');
/** The schema the queries were checked against when these were recorded. */
const SCHEMA = 'github/docs@03caf3ce9bc56af9d147500036b0bb6dda352674';

/** A fork's branch, which a pull request into rozed-dev/e2e comes from. */
export const FORK_BRANCH = 'code/fork';

/** The branches read, for the merge fixture's generation `generation`. */
export function branches(generation: number): string[] {
  return [`merge/${generation}/chain-1`, `merge/${generation}/base`, FORK_BRANCH];
}

export const scenarios: Scenario[] = [
  {
    name: 'pulls_from_head_e2e',
    description:
      "PullsFromHead on rozed-dev/e2e as rozed-bot, read only, for a merge fixture generation: the open pull requests from merge/<generation>/chain-1 (its chain-1 pull request, which chain-2 is based on), from merge/<generation>/base (none), and from code/fork (the code fixture's #99, from rozed-bot's fork's branch of that name).",
    repo: 'rozed-dev/e2e',
    schema: SCHEMA,
    async run(fetch, token) {
      const generation = Number(process.env['LO_MERGE_GENERATION']);
      if (!Number.isSafeInteger(generation) || generation < 1) {
        throw new Error('Set LO_MERGE_GENERATION to the merge fixture generation to record on.');
      }
      const client = new GithubClient({ fetch, token: new Token(token) });
      for (const branch of branches(generation)) await openPullsFromHead(client, REPO, branch);
      return { generation };
    },
  },
];
