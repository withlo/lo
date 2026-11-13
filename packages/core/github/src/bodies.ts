/**
 * The HTML GitHub renders for posts (`RenderedBodies`): a pull request's description, and the
 * comments, reviews and review comments named by node ID, which threads and the timeline show in
 * place of their Markdown. Its images' addresses are signed for a few minutes, so it's read for
 * what's on screen and never kept: every read brings new addresses.
 */

import type { GithubClient } from './client.ts';
import { RenderedBodiesDocument } from './generated/graphql.ts';
import type { PullRef } from './refs.ts';

/** The most posts one request asks for: GitHub's limit on `nodes(ids:)`. */
export const BODIES_A_REQUEST = 100;

/** Posts' HTML, as `RenderedBodies` reads it. */
export interface RenderedBodies {
  /** The description's HTML, when it was asked for. */
  description: string | undefined;
  /** Each post's HTML, by its node ID. */
  bodies: Map<string, string>;
  /**
   * The IDs GitHub gave no post for: deleted since, or not a comment, review or review comment
   * the account can see.
   */
  gone: string[];
}

/** What to read besides the posts. */
export interface RenderedBodiesOptions {
  /** Whether to read the description's HTML too. */
  description?: boolean | undefined;
}

/**
 * The HTML of the posts on `pull` whose node IDs are `ids`, {@link BODIES_A_REQUEST} a request, and
 * of its description when asked. Each request goes through `client`; nothing is sent when there's
 * nothing to read.
 */
export async function readRenderedBodies(
  client: GithubClient,
  pull: PullRef,
  ids: readonly string[],
  { description = false }: RenderedBodiesOptions = {},
): Promise<RenderedBodies> {
  const unique = [...new Set(ids)];
  const read: RenderedBodies = { description: undefined, bodies: new Map(), gone: [] };
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += BODIES_A_REQUEST) {
    chunks.push(unique.slice(start, start + BODIES_A_REQUEST));
  }
  if (description && chunks.length === 0) chunks.push([]);
  for (const [index, asked] of chunks.entries()) {
    // GitHub answers an ID it has no post for with null, and an error about that node.
    const { data } = await client.graphqlWithErrors(
      RenderedBodiesDocument,
      {
        owner: pull.repo.owner,
        name: pull.repo.name,
        number: pull.number,
        description: description && index === 0,
        ids: asked,
      },
      1,
    );
    if (description && index === 0) read.description = data.repository?.pullRequest?.bodyHTML;
    for (const [at, id] of asked.entries()) {
      const node = data.nodes[at];
      if (node && 'bodyHTML' in node && node.id === id) read.bodies.set(id, node.bodyHTML);
      else read.gone.push(id);
    }
  }
  return read;
}
