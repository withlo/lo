/**
 * Reading what decides a merge, from recorded answers and answers edited from them, read as
 * rozed-bot, read only: `pytorch/pytorch#115316`'s checks, more than a page of them;
 * `zed-industries/zed#66631`; `rozed-dev/e2e`'s squash commit text; and a branch a pull request
 * moves onto before it merges, with `e4/gated`'s rulesets as recorded. What the reads are mapped
 * into is tested with the merge rules, in `@lo/review`.
 */

import {
  cassette,
  isObject,
  Replay,
  replayFetch,
  type Interaction,
  type Json,
  type ReplayFetch,
} from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient } from '../src/client.ts';
import { GithubError } from '../src/errors.ts';
import { mergeFactsComplete, readMergeFacts, rulesOnto, squashText } from '../src/merge.ts';
import { PullRef, RepoRef } from '../src/refs.ts';
import { Token } from '../src/token.ts';

const BOT = 'rozed-bot';

function client(fetch: ReplayFetch): GithubClient {
  return new GithubClient({ fetch, token: new Token('gho_FAKE') });
}

type JsonObject = { [key: string]: Json };

function object(value: Json | undefined): JsonObject {
  if (!isObject(value)) throw new Error(`expected an object, got ${JSON.stringify(value)}`);
  return value;
}

/** `name`'s recorded answers, each edited by `edit` with its file name. */
function edited(name: string, edit: (file: string, interaction: Interaction) => void): ReplayFetch {
  const interactions = cassette(name).interactions.map(({ file, interaction }) => {
    const copy = structuredClone(interaction);
    edit(file, copy);
    return copy;
  });
  return replayFetch(new Replay(name, interactions));
}

/** The pull request in a recorded GraphQL answer. */
function pullRequestOf(interaction: Interaction): JsonObject {
  return object(object(object(object(interaction.response.body).data).repository).pullRequest);
}

/**
 * Leaves the field at `path` out of a recorded answer, as GitHub does when it can't give it: null,
 * and an error naming it, of GitHub's type `type`, or of none, as for a timeout.
 */
function leaveOut(interaction: Interaction, path: string[], type?: string): void {
  const body = object(interaction.response.body);
  let parent: Json | undefined = body['data'];
  for (const step of path.slice(0, -1)) {
    parent = Array.isArray(parent) ? parent[Number(step)] : object(parent)[step];
  }
  const last = path.at(-1) ?? '';
  if (Array.isArray(parent)) parent[Number(last)] = null;
  else object(parent)[last] = null;
  const error: Json = {
    type: type ?? null,
    path: path.map((step) => (/^\d+$/.test(step) ? Number(step) : step)),
    message:
      'Something went wrong while executing your query. This may be the result of a timeout.',
  };
  const errors = body['errors'];
  if (Array.isArray(errors)) errors.push(error);
  else body['errors'] = [error];
}

const PYTORCH = new PullRef('pytorch', 'pytorch', 115316);

test('a push while the checks are paged fails the read', async () => {
  const fetch = edited('merge_pytorch_115316', (file, interaction) => {
    if (file.includes('MergeChecks')) pullRequestOf(interaction)['headRefOid'] = '0'.repeat(40);
  });

  const read = readMergeFacts(client(fetch), PYTORCH, BOT);

  await expect(read).rejects.toThrow(GithubError);
  await expect(read).rejects.toMatchObject({ detail: { kind: 'inconsistent' } });
});

test('a check github leaves out of a later page is left out', async () => {
  const fetch = edited('merge_pytorch_115316', (file, interaction) => {
    if (file.includes('MergeChecks')) {
      const path = ['repository', 'pullRequest', 'statusCheckRollup', 'contexts', 'nodes', '0'];
      leaveOut(interaction, path);
    }
  });

  const facts = await readMergeFacts(client(fetch), PYTORCH, BOT);

  expect(facts.leftOut).toEqual(['pullRequest.statusCheckRollup.contexts.nodes.0', 'checks']);
  expect(mergeFactsComplete(facts)).toBe(false);
});

test('a pull request github errs on fails the read with githubs error', async () => {
  // A field that can't be null failing nulls the whole pull request.
  const fetch = edited('merge_zed', (file, interaction) => {
    if (!file.startsWith('001-')) return;
    leaveOut(interaction, ['repository', 'pullRequest', 'mergeStateStatus']);
    object(object(object(interaction.response.body).data).repository)['pullRequest'] = null;
  });

  const read = readMergeFacts(client(fetch), new PullRef('zed-industries', 'zed', 66631), BOT);

  await expect(read).rejects.toMatchObject({ detail: { kind: 'graphql' } });
});

test('a squash commit starts from the text github would give it', async () => {
  const github = client(replayFetch('merge_text_e2e'));
  const text = (number: number) => squashText(github, new PullRef('rozed-dev', 'e2e', number));

  // e2e's settings take the commit's title when there's one commit, and the commits' messages.
  const one = await text(25);
  expect(one.title).toBe("test(e4): add passing's change, with ci-result pass (#25)");
  // With four, the pull request's title, and each commit's message.
  const four = await text(16);
  expect(four.title).toBe('E1: revisions (#16)');
  expect(four.message).toMatch(
    /^\* test\(e1\): r1 adds a\.txt and b\.txt\n\n\* test\(e1\): r2 changes a\.txt\n\n/,
  );
});

/**
 * `rulesOnto` for `rozed-dev/e2e`'s `e4/gated`, answered as `answer` says for GraphQL, with
 * `e4/gated`'s rulesets as recorded.
 */
function ontoGated(answer: Json): { fetch: ReplayFetch; read: ReturnType<typeof rulesOnto> } {
  const protection: Interaction = {
    request: {
      method: 'POST',
      url: 'https://api.github.com/graphql',
      operation: 'BranchProtection',
      variables: {
        owner: 'rozed-dev',
        name: 'e2e',
        qualified: 'refs/heads/e4/gated',
        branch: 'e4/gated',
      },
    },
    response: { status: 200, headers: {}, body: answer },
  };
  const rules = cassette('merge_e4_gated').interactions.find(({ file }) =>
    file.includes('rules_branches_e4_gated'),
  );
  if (!rules) throw new Error("no read of e4/gated's rules");
  const fetch = replayFetch(new Replay('onto_gated', [protection, rules.interaction]));
  return { fetch, read: rulesOnto(client(fetch), new RepoRef('rozed-dev', 'e2e'), 'e4/gated') };
}

/** `e4/gated` as a reader sees it: classic protection that requires linear history. */
function gatedRef(): Json {
  return {
    name: 'e4/gated',
    refUpdateRule: {
      requiredApprovingReviewCount: 1,
      requiredStatusCheckContexts: [],
      requiresCodeOwnerReviews: false,
      requiresConversationResolution: false,
      requiresLinearHistory: true,
      requiresSignatures: false,
      viewerCanPush: true,
    },
    branchProtectionRule: null,
  };
}

test('a branch lo cant read in full isnt planned on', async () => {
  // The branch is gone.
  const gone = ontoGated({
    data: { rateLimit: null, repository: { ref: null, mergeQueue: null } },
  });
  await expect(gone.read).rejects.toMatchObject({ detail: { kind: 'notFound' } });
  // GitHub left part of its protection out.
  const partial = ontoGated({
    data: {
      rateLimit: null,
      repository: {
        ref: { name: 'e4/gated', refUpdateRule: null, branchProtectionRule: null },
        mergeQueue: null,
      },
    },
    errors: [{ message: 'Something went wrong', path: ['repository', 'ref', 'refUpdateRule'] }],
  });
  await expect(partial.read).rejects.toThrow(GithubError);
  // What only admins and writers see isn't left out: it's GitHub's answer.
  const hidden = ontoGated({
    data: {
      rateLimit: null,
      repository: { ref: gatedRef(), mergeQueue: { configuration: null } },
    },
    errors: [
      {
        type: 'FORBIDDEN',
        message: 'Resource not accessible by integration',
        path: ['repository', 'ref', 'branchProtectionRule'],
      },
      {
        type: 'FORBIDDEN',
        message: 'Resource not accessible by integration',
        path: ['repository', 'mergeQueue', 'configuration'],
      },
    ],
  });
  const onto = await hidden.read;
  expect(onto.queueRequired).toBe(true);
  expect(onto.queueMethod).toBeUndefined();
});
