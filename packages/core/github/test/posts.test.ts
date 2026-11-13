/**
 * What threads and the timeline read beside the posts' Markdown, replayed from what rozed-bot read
 * (`test/scenarios/posts.ts`): the HTML GitHub renders for posts, review comments among them, and a
 * pull request's labels, reviewers, assignees and draft state.
 */

import { replayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

import { POSTS_23 } from './scenarios/posts.ts';
import { BODIES_A_REQUEST, readRenderedBodies } from '../src/bodies.ts';
import { GithubClient } from '../src/client.ts';
import { PullRef } from '../src/refs.ts';
import { labelColor, readPullRequestSidebar } from '../src/sidebar.ts';
import { Token } from '../src/token.ts';

function client(cassette: string): GithubClient {
  return new GithubClient({ fetch: replayFetch(cassette), token: new Token('gho_FAKE') });
}

test('a review comments html reads by its node id, as a reviews does', async () => {
  const github = client('rendered_bodies_e2e_23');
  const pull = new PullRef('rozed-dev', 'e2e', 23);
  const ids = [POSTS_23.comment, POSTS_23.reply, POSTS_23.review, POSTS_23.deleted];
  const read = await readRenderedBodies(github, pull, ids);
  expect(read.bodies.get(POSTS_23.comment)).toBe(
    '<p dir="auto">Fixture E11: a line thread, the first comment of a pending review.</p>',
  );
  expect([...read.bodies.keys()]).toEqual([POSTS_23.comment, POSTS_23.reply, POSTS_23.review]);
  // A post that's gone is null, with an error about it alone; the description wasn't asked for.
  expect(read.gone).toEqual([POSTS_23.deleted]);
  expect(read.description).toBeUndefined();
  expect(github.rateLimits().lastGraphQLCost).toBe(1);

  const described = await readRenderedBodies(github, pull, [POSTS_23.review], {
    description: true,
  });
  expect(described.description).toMatch(/^<p dir="auto">Fixture E11 \(review writes\)/);
  expect(described.bodies).toEqual(
    new Map([
      [
        POSTS_23.review,
        '<p dir="auto">Fixture E11: the pending review\'s summary, submitted as a comment.</p>',
      ],
    ]),
  );
  expect(described.gone).toEqual([]);
});

/** The node IDs a `RenderedBodies` request asked for. */
function askedIds(body: unknown): string[] {
  const variables: unknown = typeof body === 'object' && body ? Reflect.get(body, 'variables') : {};
  const ids: unknown =
    typeof variables === 'object' && variables ? Reflect.get(variables, 'ids') : [];
  if (!Array.isArray(ids)) throw new Error('no ids');
  return ids.map(String);
}

/** GitHub's answer to a read of `ids`, each a comment. */
function comments(ids: string[]): Response {
  return Response.json({
    data: {
      rateLimit: null,
      repository: { pullRequest: null },
      nodes: ids.map((id) => ({ __typename: 'IssueComment', id, bodyHTML: `<p>${id}</p>` })),
    },
  });
}

test('posts are read a hundred at a time, and nothing is sent for nothing', async () => {
  const sent: number[] = [];
  const github = new GithubClient({
    fetch: async (input, init) => {
      const ids = askedIds(await new Request(input, init).json());
      sent.push(ids.length);
      return comments(ids);
    },
    token: new Token('gho_FAKE'),
  });
  const pull = new PullRef('rozed-dev', 'e2e', 23);
  expect(await readRenderedBodies(github, pull, [])).toEqual({
    description: undefined,
    bodies: new Map(),
    gone: [],
  });
  expect(sent).toEqual([]);
  const ids = Array.from({ length: BODIES_A_REQUEST * 2 + 5 }, (_, at) => `IC_${at}`);
  const read = await readRenderedBodies(github, pull, [...ids, ids[0] ?? '']);
  expect(sent).toEqual([BODIES_A_REQUEST, BODIES_A_REQUEST, 5]);
  expect([...read.bodies.keys()]).toEqual(ids);
  expect(read.bodies.get('IC_204')).toBe('<p>IC_204</p>');
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
      // A team rozed-bot can't see, which GitHub answers with null and no error.
      { kind: 'hiddenTeam' },
      { kind: 'account', login: 'williammartin', type: 'User' },
      { kind: 'account', login: 'BagToad', type: 'User' },
    ],
    reviews: [
      { author: { login: 'copilot-pull-request-reviewer', type: 'Bot' }, state: 'COMMENTED' },
      { author: { login: 'ke66344060-ship-it', type: 'User' }, state: 'COMMENTED' },
    ],
    assignees: [],
  });
  const draft = await readPullRequestSidebar(github, new PullRef('cli', 'cli', 13017));
  expect(draft.isDraft).toBe(true);
  expect(draft.requested).toEqual([{ kind: 'account', login: 'babakks', type: 'User' }]);
  expect(draft.assignees).toEqual([
    { login: 'babakks', type: 'User' },
    { login: 'Copilot', type: 'User' },
  ]);
  expect(github.rateLimits().lastGraphQLCost).toBe(1);
});

test('a labels color reaches a style only as six hex digits', () => {
  expect(labelColor('2700AF')).toBe('2700af');
  expect(labelColor('fff')).toBeUndefined();
  expect(labelColor('000000;background:url(x)')).toBeUndefined();
});
