/**
 * The repository's definitions written as `rozed-bot` on rozed-dev/e2e, as Lo writes them, to
 * `refs/lo/terms`, which rozed-dev/e2e has none of before or after. It writes to GitHub, so it
 * records only with `LO_RECORD_WRITES=1`.
 *
 * - `rest_terms_writes_e2e`: who may write them; a tree holding one `terms.json`, a commit of it on
 *   nothing, and the ref made at it; made again, which GitHub refuses; a second tree and two
 *   commits of it on the first; the ref moved to one, then from the first to the other, which it
 *   no longer holds, then from where it is to the other, which isn't a fast-forward; and how GitHub
 *   compares the three. The ref is deleted after, unrecorded.
 */

import type { Scenario } from '@lo/testing';

import { GithubClient } from '../../src/client.ts';
import { watchRef } from '../../src/overviews.ts';
import { RepoRef } from '../../src/refs.ts';
import {
  holds,
  moveTerms,
  TERMS_REF,
  termsAccess,
  termsCommit,
  termsTree,
} from '../../src/terms.ts';
import { Token } from '../../src/token.ts';

const E2E = new RepoRef('rozed-dev', 'e2e');

/** A store of one term, `bucket`, as `definition`. */
function storeOf(definition: string, written: 'agent' | 'human'): string {
  const by = { login: 'rozed-bot' };
  const term =
    written === 'agent'
      ? { term: 'bucket', definition, written, by, from: '#80', at: '2026-11-11T09:30:00Z' }
      : { term: 'bucket', definition, written, by, from: 'lo', at: '2026-11-28T12:00:00Z' };
  return `${JSON.stringify({ format: 1, terms: { bucket: term } }, null, 2)}\n`;
}

/** A tree's IDs, as a recording keeps them. */
function ids(tree: { tree: string; blob: string }): { tree: string; blob: string } {
  return { tree: tree.tree, blob: tree.blob };
}

/** The definitions the recording writes first, then after an edit. */
export const TERMS_TEXTS = {
  first: storeOf('The tokens a tenant has to spend.', 'agent'),
  edited: storeOf('What a tenant spends from, refilled each second.', 'human'),
} as const;

export const scenarios: Scenario[] = [
  {
    name: 'rest_terms_writes_e2e',
    description:
      "rozed-dev/e2e's definitions written as Lo writes them, as rozed-bot: who may write them; a tree of terms.json, a commit of it on nothing, refs/lo/terms made at it, and made again, which GitHub refuses; a second tree and two commits of it on the first; the ref moved to one, then from the first to the other, which it no longer holds, then from where it is to the other, which isn't a fast-forward; and the three compared. rozed-dev/e2e had no refs/lo/terms before, and the ref is deleted after, unrecorded.",
    repo: 'rozed-dev/e2e',
    writes: true,
    async run(fetch, token) {
      const github = new GithubClient({ fetch: globalThis.fetch, token: new Token(token) });
      const before = await watchRef(github, E2E, TERMS_REF, undefined);
      if (before.notModified || before.value.kind !== 'none') {
        throw new Error(`rozed-dev/e2e has ${TERMS_REF} already: leave it, and record elsewhere.`);
      }
      const client = new GithubClient({ fetch, token: new Token(token) });
      try {
        const { repositoryId } = await termsAccess(client, E2E);
        const first = await termsTree(client, E2E, TERMS_TEXTS.first);
        const made = await termsCommit(client, E2E, {
          tree: first.tree,
          parent: undefined,
          message: 'Definitions for the recording',
        });
        await moveTerms(client, repositoryId, { from: undefined, to: made });
        await moveTerms(client, repositoryId, { from: undefined, to: made });
        const second = await termsTree(client, E2E, TERMS_TEXTS.edited);
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
        await moveTerms(client, repositoryId, { from: made, to: edited });
        await moveTerms(client, repositoryId, { from: made, to: other });
        await moveTerms(client, repositoryId, { from: edited, to: other });
        await holds(client, E2E, edited, made);
        await holds(client, E2E, made, edited);
        await holds(client, E2E, edited, other);
        return { repositoryId, first: ids(first), made, second: ids(second), edited, other };
      } finally {
        await github.delete(`/repos/${E2E.owner}/${E2E.name}/git/${TERMS_REF}`).catch(() => {
          console.log(`deleting ${TERMS_REF} from rozed-dev/e2e failed: delete it by hand`);
        });
      }
    },
  },
];
