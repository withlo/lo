// Comments on a pull request, as main reads them for the window: the HTML GitHub renders for
// posts, which threads and the timeline show in place of their Markdown. The window asks for the
// posts on screen or near it, and keeps what comes back in its memory only. It loads the images in
// posts, and avatars, on the image scheme (`ipc/images.ts`), which the feature serves in main, so
// nothing of that goes through a request.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';
import { tabId } from '../tab/contract.ts';

/**
 * The most posts one ask names: what one read asks GitHub for (`RenderedBodies`' `nodes(ids:)`
 * takes 100).
 */
export const POSTS_AN_ASK = 100;

/**
 * A post's node ID, as GitHub gives it: a comment's, a review's or a review comment's. They're
 * written in base64's letters, with a prefix such as `IC_` or `PRR_`.
 */
export const postId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[\w+/=-]+$/);

/** A post's HTML, as GitHub renders it, by its node ID. */
export interface RenderedPost {
  id: string;
  html: string;
}

/**
 * The HTML GitHub rendered for the posts asked about: the description's, when asked for and
 * GitHub gave it; each post's GitHub gave; and the posts GitHub gave none for, deleted since or
 * not ones the account can see.
 */
export interface Bodies {
  description: string | null;
  posts: RenderedPost[];
  gone: string[];
}

export const contract = defineContract('comments', {
  requests: {
    /**
     * The HTML GitHub renders for the posts on view `id`'s pull request named by `posts`, and for
     * its description when `description` is set, read as the view's account at the front of its
     * queue. Main never keeps it: its images' addresses are signed afresh on every read. Fails as
     * `missing` for no such view, as `refused` for one that acts as nobody or shows a run of a
     * stack's layers, and as `failed`, with why, when GitHub couldn't be read.
     */
    bodies: {
      input: z.strictObject({
        id: tabId,
        posts: z.array(postId).max(POSTS_AN_ASK),
        description: z.boolean(),
      }),
      reply: reply<Bodies>(),
    },
  },
  topics: {},
});
