/**
 * What a stack's tree shows of its layers that the open pull request list doesn't keep current
 * (`docs/design.md`, "The stack tree"): review decision, checks, merge queue entry, and how many
 * files the viewer has viewed (`StackLayers`). With them, the merged pull requests below the
 * layers GitHub moved to another branch after their base branch was deleted.
 */

import type { GithubClient } from './client.ts';
import { StackLayersDocument, type StackLayersQuery } from './generated/graphql.ts';
import {
  lookUpBranches,
  MAX_BRANCH_LOOKUPS,
  noLookups,
  type BranchLookup,
  type MergedPullRequest,
} from './merged.ts';
import { PAGE_SIZE } from './pager.ts';
import type { RepoRef } from './refs.ts';

/** A node `StackLayers` reads. */
type StackLayerNode = NonNullable<StackLayersQuery['nodes'][number]>;

/** A layer as `StackLayers` reads it. */
export type StackLayer = Extract<StackLayerNode, { __typename: 'PullRequest' }>;

function isLayer(node: StackLayerNode): node is StackLayer {
  const { __typename: typename } = node;
  return typename === 'PullRequest';
}

/** The layers of a stack's tree, as `StackLayers` reads them. */
export interface StackLayerList {
  /** The layers' node IDs, as asked for. */
  ids: string[];
  /**
   * The layers GitHub found, in the order asked for. A layer that's gone, or that the account
   * can't see, is left out.
   */
  layers: StackLayer[];
  /**
   * The merged pull requests from the branches the layers were moved from ({@link movedFrom}): once
   * a squashed layer's branch is deleted, only they can mark the layers it held as needing a rebase.
   */
  merged: MergedPullRequest[];
  /** The branches whose merged pull requests were looked up, which the next read carries over. */
  lookups: BranchLookup[];
  /**
   * Why some branches weren't looked up, past {@link MAX_BRANCH_LOOKUPS} or after a lookup failed.
   * The read is tried again after a wait.
   */
  lookupsFailed: string | undefined;
}

/**
 * The fields of the cheap check (`PullRequestCheck`) whose change means the open pull request's own
 * layer changed: its state, head, review decision, checks and queue entry, and the events that move
 * it to another branch. Each is a JSON pointer into the check. The other layers are read again on
 * a slower refresh, when the layers asked for change, and when Lo writes to one of them.
 */
export const STACK_LAYERS_WATCHED: readonly string[] = [
  '/state',
  '/headRefOid',
  '/reviewDecision',
  '/statusCheckRollup',
  '/mergeQueueEntry',
  '/revisionEvents/filteredCount',
];

/** Whether every branch to look up was: a list that wasn't is read again after a wait. */
export function stackLayersComplete(list: StackLayerList): boolean {
  return list.lookupsFailed === undefined;
}

/** The layer whose node ID is `id`. */
export function stackLayer(list: StackLayerList, id: string): StackLayer | undefined {
  return list.layers.find((layer) => layer.id === id);
}

/**
 * The branch `layer` last moved from: GitHub moves a layer once the branch it targeted is deleted,
 * and people change a layer's base once the layer below merged. It's the head branch of the layer
 * it sat on, if that one merged.
 */
export function movedFrom(layer: StackLayer): string | undefined {
  const event = (layer.movedFrom.nodes ?? []).findLast((node) => node !== null);
  if (!event) return undefined;
  if ('oldBase' in event) return event.oldBase;
  if ('previousRefName' in event) return event.previousRefName;
  return undefined;
}

/** How many of a layer's files the viewer has viewed. */
export interface ViewedFiles {
  viewed: number;
  /** How many files the layer changes. */
  files: number;
  /**
   * Whether every file's mark was read. Only the first 100 are, so for a layer with more, `viewed`
   * counts among those.
   */
  complete: boolean;
}

/** How many of `layer`'s files the viewer has viewed. */
export function viewedFiles(layer: StackLayer): ViewedFiles {
  const marks = (layer.files?.nodes ?? []).flatMap((file) =>
    file ? [file.viewerViewedState] : [],
  );
  const files = Math.max(0, layer.files?.totalCount ?? 0);
  return {
    viewed: marks.filter((mark) => mark === 'VIEWED').length,
    files,
    complete: marks.length >= files,
  };
}

/**
 * The layers whose node IDs are `ids`, {@link PAGE_SIZE} a request, in `repo`, with the merged pull
 * requests from the branches they moved from. What `known`, read before, looked up is carried over,
 * as of `now`, in milliseconds since the Unix epoch.
 */
export async function readStackLayers(
  client: GithubClient,
  repo: RepoRef,
  ids: readonly string[],
  known: StackLayerList | undefined,
  now: number,
): Promise<StackLayerList> {
  const list: StackLayerList = {
    ids: [...ids],
    layers: [],
    merged: [],
    lookups: [],
    lookupsFailed: undefined,
  };
  for (let start = 0; start < ids.length; start += PAGE_SIZE) {
    // GitHub answers an ID it can't find with null, and an error about that node.
    const { data } = await client.graphqlWithErrors(
      StackLayersDocument,
      { ids: ids.slice(start, start + PAGE_SIZE) },
      1,
    );
    for (const node of data.nodes) if (node && isLayer(node)) list.layers.push(node);
  }
  const moved = [...new Set(list.layers.flatMap((layer) => movedFrom(layer) ?? []))].toSorted(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  // A deleted branch's tip is unknown, and a moved-from branch's merged pull requests rarely change.
  const looked = await lookUpBranches(
    client,
    repo,
    moved.map((branch) => ({ branch, tip: undefined })),
    known ? { lookups: known.lookups, merged: known.merged, now } : noLookups(now),
    MAX_BRANCH_LOOKUPS,
    list.merged,
    list.lookups,
  );
  if (looked === undefined) {
    list.lookupsFailed = 'a lookup of merged pull requests failed';
  } else if (list.lookups.length < moved.length) {
    list.lookupsFailed = `more than ${MAX_BRANCH_LOOKUPS} branches to look up`;
  }
  return list;
}
