/**
 * What threads and the timeline read beside the posts' Markdown, recorded as `rozed-bot`, read
 * only: the HTML GitHub renders for a review, its review comments, a reply and a comment that's
 * gone, on rozed-dev/e2e#23; and the labels, reviewers, assignees and draft state of two of
 * cli/cli's pull requests, read by an account that can't see every team asked to review them.
 */

import type { Scenario } from '@lo/testing';

import { GithubClient } from '../../src/client.ts';
import { RenderedBodiesDocument } from '../../src/generated/graphql.ts';
import { PullRef } from '../../src/refs.ts';
import { readPullRequestSidebar } from '../../src/sidebar.ts';
import { Token } from '../../src/token.ts';

/** rozed-dev/e2e#23's posts, by node ID. */
export const POSTS_23 = {
  /** A line thread's first comment, submitted with its review. */
  comment: 'PRRC_kwDOVleUfc8AAAABDjlwiA',
  /** A reply in that thread. */
  reply: 'PRRC_kwDOVleUfc8AAAABDjl0_g',
  /** The review they were submitted with, whose summary is Markdown. */
  review: 'PRR_kwDOVleUfc8AAAABXON7uA',
  /** A review comment a recording deleted. */
  deleted: 'PRRC_kwDOVleUfc8AAAABDS30Vg',
} as const;

/** The recordings `node testing/scripts/record.ts` makes from this module. */
export const scenarios: Scenario[] = [
  {
    name: 'rendered_bodies_e2e_23',
    description:
      "The HTML GitHub renders for rozed-dev/e2e#23's posts, read as rozed-bot: a review comment, a reply to it, the review they were submitted with, and a review comment that was deleted, which GitHub answers with null and an error",
    repo: 'rozed-dev/e2e',
    async run(fetch, token) {
      const client = new GithubClient({ fetch, token: new Token(token) });
      await client.graphqlWithErrors(
        RenderedBodiesDocument,
        {
          owner: 'rozed-dev',
          name: 'e2e',
          number: 23,
          description: false,
          ids: [POSTS_23.comment, POSTS_23.reply, POSTS_23.review, POSTS_23.deleted],
        },
        1,
      );
      return undefined;
    },
  },
  {
    name: 'pull_request_sidebar_cli',
    description:
      "The labels, reviewers, assignees and draft state of cli/cli#13013, which asks two people and a team rozed-bot can't see for reviews and was reviewed by a bot and a person, and of cli/cli#13017, a draft assigned to two people, read as rozed-bot",
    repo: 'cli/cli',
    async run(fetch, token) {
      const client = new GithubClient({ fetch, token: new Token(token) });
      await readPullRequestSidebar(client, new PullRef('cli', 'cli', 13013));
      await readPullRequestSidebar(client, new PullRef('cli', 'cli', 13017));
      return undefined;
    },
  },
];
