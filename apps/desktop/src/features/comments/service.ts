// What the comments feature offers the others in main: posts' HTML, as GitHub renders it, read on
// demand for a view of a pull request's tab.

import type { RenderedBodies } from '@lo/github';

import { defineService } from '../../main/services.ts';

/** What to read besides the posts. */
export interface BodiesOptions {
  /** Whether to read the description's HTML too. */
  readonly description: boolean;
}

/**
 * The HTML GitHub renders for posts, read for the posts someone is waiting on and never kept: its
 * images' addresses are signed for a few minutes, so every read brings new ones.
 */
export interface BodiesService {
  /**
   * The HTML of the posts on view `id`'s pull request named by `posts`, by node ID, and of its
   * description when asked, read as the view's account, 100 posts a request, each at the front of
   * the account's queue. Throws an `IpcError`: `missing` for no such view, `refused` for one that
   * acts as nobody, has no account yet, or shows a run of a stack's layers, and `failed` when
   * GitHub couldn't be read.
   */
  read(id: string, posts: readonly string[], options: BodiesOptions): Promise<RenderedBodies>;
}

export const bodies = defineService<BodiesService>('comments.bodies');
