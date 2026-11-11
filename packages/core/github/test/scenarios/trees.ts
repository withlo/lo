/**
 * The REST trees recorded as `rozed-bot`: rozed-dev/e2e at the head of #78, the pull request the
 * app's tests open (`testing/fixtures/app.sh`), read whole, with #78's files, which the file tree
 * marks until the local copy is ready. Nothing here writes to GitHub.
 *
 * A tree GitHub lists only in part can't be recorded small: GitHub cuts a tree off at about 70,000
 * entries, over 20 MB of JSON. `rest_tree_truncated` is GitHub's answer for torvalds/linux written
 * by hand, with its list cut down.
 */

import type { Scenario } from '@lo/testing';

import { GithubClient } from '../../src/client.ts';
import { pullFiles } from '../../src/files.ts';
import { PullRef, RepoRef } from '../../src/refs.ts';
import { Token } from '../../src/token.ts';
import { repoTree } from '../../src/trees.ts';

/** rozed-dev/e2e#78's head, the second push. */
export const E2E_HEAD = '5530830f535b2947f1b50a184dc58a9c7b2845ad';

/** The recordings `node testing/scripts/record.ts` makes from this module. */
export const scenarios: Scenario[] = [
  {
    name: 'rest_tree_e2e',
    description:
      "rozed-dev/e2e's whole tree at the head of #78 (testing/fixtures/app.sh), and #78's files, read as rozed-bot",
    repo: 'rozed-dev/e2e',
    async run(fetch, token) {
      const client = new GithubClient({ fetch, token: new Token(token) });
      await repoTree(client, new RepoRef('rozed-dev', 'e2e'), E2E_HEAD);
      await pullFiles(client, new PullRef('rozed-dev', 'e2e', 78));
      return undefined;
    },
  },
];
