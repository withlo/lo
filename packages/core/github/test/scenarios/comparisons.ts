/**
 * Comparisons recorded as `rozed-bot` on rozed-dev/e2e, among a tree of pull requests there: #2
 * `e2/a` -> main, #3 `e2/b` -> `e2/a`, #4 `e2/c` -> `e2/b`, and #6 `e2/d` -> main, cut from #4's
 * head. Nothing here writes to GitHub.
 *
 * - `rest_comparison_e2e`: #4's head compared with #3's, the changes #4 makes on `e2/b`, then
 *   again with the ETag GitHub gave, which it answers with a `304`; #6's head compared with #4's,
 *   the changes #6 makes over the layer whose commits it holds; and #4's head compared with a
 *   commit rozed-dev/e2e doesn't have, which GitHub answers with a `404`.
 */

import type { Scenario } from '@lo/testing';

import { GithubClient } from '../../src/client.ts';
import { readComparison } from '../../src/comparisons.ts';
import { GithubError } from '../../src/errors.ts';
import { RepoRef } from '../../src/refs.ts';
import { Token } from '../../src/token.ts';

/** The heads of the pull requests compared. */
export const E2E_HEADS = {
  /** #3, `e2/b`. */
  b: 'fd3d9a4102c1371a42100297822828c8cd12255c',
  /** #4, `e2/c`, on `e2/b`. */
  c: '4b18a1a61f29869e0665318e518ed79a9957fcc8',
  /** #6, `e2/d`, on main, cut from #4's head. */
  d: '8bb8daed45b4c4ceeaa9f90c55aeb26e512f8506',
} as const;

/** A commit rozed-dev/e2e doesn't have. */
export const MISSING_COMMIT = '0000000000000000000000000000000000000001';

/** The recordings `node testing/scripts/record.ts` makes from this module. */
export const scenarios: Scenario[] = [
  {
    name: 'rest_comparison_e2e',
    description:
      "rozed-dev/e2e's e2/b...e2/c, by their heads, read again with its ETag; #6's head compared with #4's, which it holds; and #4's head compared with a commit the repository doesn't have, as rozed-bot",
    repo: 'rozed-dev/e2e',
    async run(fetch, token) {
      const client = new GithubClient({ fetch, token: new Token(token) });
      const e2e = new RepoRef('rozed-dev', 'e2e');
      const first = await readComparison(client, e2e, E2E_HEADS.b, E2E_HEADS.c, undefined);
      if (first.etag === undefined) throw new Error('the comparison came without an ETag');
      await readComparison(client, e2e, E2E_HEADS.b, E2E_HEADS.c, first);
      await readComparison(client, e2e, E2E_HEADS.c, E2E_HEADS.d, undefined);
      const missing = await readComparison(client, e2e, MISSING_COMMIT, E2E_HEADS.c, undefined)
        .then(() => undefined)
        .catch((error: unknown) => error);
      if (!(missing instanceof GithubError) || missing.detail.kind !== 'notFound') {
        throw new Error('a missing commit was answered with something other than a 404', {
          cause: missing,
        });
      }
      return undefined;
    },
  },
];
