/**
 * What threads and the timeline read beside the posts' Markdown, replayed from what rozed-bot read
 * (`test/scenarios/posts.ts`): the HTML GitHub renders for posts, review comments among them, and a
 * pull request's labels, reviewers, assignees and draft state.
 */

import { replayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

import { POSTS_23 } from './scenarios/posts.ts';
import { GithubClient } from '../src/client.ts';
import { RenderedBodiesDocument } from '../src/generated/graphql.ts';
import { PullRef } from '../src/refs.ts';
import { labelColor, readPullRequestSidebar } from '../src/sidebar.ts';
import { Token } from '../src/token.ts';

function client(cassette: string): GithubClient {
  return new GithubClient({ fetch: replayFetch(cassette), token: new Token('gho_FAKE') });
}

test('a review comments html reads by its node id, as a reviews does', async () => {
  const github = client('rendered_bodies_e2e_23');
  const ids = [POSTS_23.comment, POSTS_23.reply, POSTS_23.review, POSTS_23.deleted];
  const { data, errors } = await github.graphqlWithErrors(
    RenderedBodiesDocument,
    { owner: 'rozed-dev', name: 'e2e', number: 23, description: false, ids },
    1,
  );
  const html = new Map(
    data.nodes.flatMap((node) => {
      if (!node || !('bodyHTML' in node)) return [];
      const { __typename: typename, id, bodyHTML } = node;
      return [[id, [typename, bodyHTML]]];
    }),
  );
  expect(html.get(POSTS_23.comment)).toEqual([
    'PullRequestReviewComment',
    '<p dir="auto">Fixture E11: a line thread, the first comment of a pending review.</p>',
  ]);
  expect(html.get(POSTS_23.reply)?.[0]).toBe('PullRequestReviewComment');
  expect(html.get(POSTS_23.review)?.[0]).toBe('PullRequestReview');
  // A post that's gone is null, with an error about it alone; the description wasn't asked for.
  expect(data.nodes[3]).toBeNull();
  expect(errors.map((error) => error.path)).toEqual([['nodes', 3]]);
  expect(data.repository?.pullRequest).toBeUndefined();
  expect(github.rateLimits().lastGraphQLCost).toBe(1);
});

test('the sidebar holds labels, reviewers, their latest reviews, assignees and drafts', async () => {
  const github = client('pull_request_sidebar_cli');
  expect(await readPullRequestSidebar(github, new PullRef('cli', 'cli', 13013))).toEqual({
    isDraft: false,
    labels: [
      { name: 'external', color: '2700af' },
      { name: 'ready-for-review', color: '39d965' },
    ],
    requested: [
      { kind: 'account', login: 'williammartin' },
      { kind: 'account', login: 'BagToad' },
    ],
    // A team rozed-bot can't see.
    unseenRequests: 1,
    reviews: [
      { author: 'copilot-pull-request-reviewer', state: 'COMMENTED' },
      { author: 'ke66344060-ship-it', state: 'COMMENTED' },
    ],
    assignees: [],
  });
  const draft = await readPullRequestSidebar(github, new PullRef('cli', 'cli', 13017));
  expect(draft.isDraft).toBe(true);
  expect(draft.requested).toEqual([{ kind: 'account', login: 'babakks' }]);
  expect(draft.assignees).toEqual(['babakks', 'Copilot']);
  expect(github.rateLimits().lastGraphQLCost).toBe(1);
});

test('a labels color reaches a style only as six hex digits', () => {
  expect(labelColor('2700AF')).toBe('2700af');
  expect(labelColor('fff')).toBeUndefined();
  expect(labelColor('000000;background:url(x)')).toBeUndefined();
});
