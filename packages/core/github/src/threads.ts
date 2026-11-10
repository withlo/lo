/**
 * A pull request's review threads (`docs/design.md`, "Comments", "Threads panel"), each with every
 * comment, read with `ReviewThreads`. A thread with more comments than a page holds reads the rest
 * with `ReviewThreadComments`, whose comments have the same fields. They come back as GitHub gives
 * them; `@lo/review` maps them into its threads.
 */

import type { GithubClient } from './client.ts';
import {
  ReviewThreadCommentsDocument,
  ReviewThreadsDocument,
  type ReviewThreadsQuery,
} from './generated/graphql.ts';
import { notFound, PAGE_SIZE, Pager } from './pager.ts';
import type { PullRef } from './refs.ts';

type ReviewThreadConnection = NonNullable<
  NonNullable<ReviewThreadsQuery['repository']>['pullRequest']
>['reviewThreads'];

/** A thread as `ReviewThreads` reads it. In a {@link ReviewThreadList}, it holds every comment. */
export type ReviewThread = NonNullable<NonNullable<ReviewThreadConnection['nodes']>[number]>;

/** A thread's comment, as both queries read it. */
export type ReviewThreadComment = NonNullable<
  NonNullable<ReviewThread['comments']['nodes']>[number]
>;

/**
 * A pull request's review threads, each with every comment, in GitHub's order. Your pending
 * review's threads and replies are among them; nobody else's are.
 */
export interface ReviewThreadList {
  /** The threads as GitHub gives them. A comment GitHub left out with an error is a `null`. */
  nodes: ReviewThread[];
  /**
   * How many threads and comments GitHub left out with an error, keeping the rest. The list isn't
   * complete while any are, so it's read again after a wait.
   */
  missing: number;
}

/** `pull`'s review threads, each with every comment. */
export function reviewThreads(client: GithubClient, pull: PullRef): Promise<ReviewThreadList> {
  return reviewThreadsPaged(client, pull, PAGE_SIZE);
}

/**
 * {@link reviewThreads}, reading `pageSize` threads a page, each with its first `pageSize`
 * comments, and a longer thread's other comments `pageSize` a page.
 */
export async function reviewThreadsPaged(
  client: GithubClient,
  pull: PullRef,
  pageSize: number,
): Promise<ReviewThreadList> {
  const { owner, name } = pull.repo;
  const read: ReviewThread[] = [];
  let missing = 0;
  let pager: Pager | undefined;
  let after: string | null = null;
  for (;;) {
    // `repository.pullRequest` is what was asked for; errors below it only leave out the threads
    // and comments they're about.
    const { data } = await client.graphqlWithErrors(
      ReviewThreadsDocument,
      { owner, name, number: pull.number, first: pageSize, after },
      2,
    );
    const threads = data.repository?.pullRequest?.reviewThreads;
    if (!threads) throw notFound(`pull request ${pull.toString()}`);
    pager ??= new Pager('review threads', threads.totalCount, pageSize);
    for (const node of threads.nodes ?? []) {
      if (node === null) missing += 1;
      else read.push(node);
    }
    const next = pager.next(threads.pageInfo.hasNextPage, threads.pageInfo.endCursor);
    if (next === undefined) break;
    after = next;
  }
  const nodes: ReviewThread[] = [];
  for (const thread of read) nodes.push(await withOtherComments(client, thread, pageSize));
  missing += nodes
    .flatMap((thread) => thread.comments.nodes ?? [])
    .filter((comment) => comment === null).length;
  return { nodes, missing };
}

/** `thread` with the comments past the ones its page held. */
async function withOtherComments(
  client: GithubClient,
  thread: ReviewThread,
  pageSize: number,
): Promise<ReviewThread> {
  const { comments } = thread;
  const pager = new Pager("a thread's comments", comments.totalCount, pageSize);
  let after = pager.next(comments.pageInfo.hasNextPage, comments.pageInfo.endCursor);
  if (after === undefined) return thread;
  const nodes = [...(comments.nodes ?? [])];
  let pageInfo = comments.pageInfo;
  while (after !== undefined) {
    // The thread is what was asked for; errors below it only leave out the comments they're about.
    const { data } = await client.graphqlWithErrors(
      ReviewThreadCommentsDocument,
      { id: thread.id, first: pageSize, after },
      1,
    );
    // Only a review thread has comments: any other node, or none, isn't the thread.
    const { node } = data;
    if (!node || !('comments' in node)) throw notFound(`review thread ${thread.id}`);
    nodes.push(...(node.comments.nodes ?? []));
    pageInfo = node.comments.pageInfo;
    after = pager.next(pageInfo.hasNextPage, pageInfo.endCursor);
  }
  return { ...thread, comments: { ...comments, nodes, pageInfo } };
}
