import { cassette, isObject, type Json } from '@lo/testing';
import { expect, test } from 'vitest';

import type { FileViewedState } from './generated/graphql.ts';
import { unchecked } from './json.ts';
import {
  layerThreads,
  movedFrom,
  STACK_LAYERS_WATCHED,
  viewedFiles,
  type StackLayer,
} from './stack-layers.ts';

/** A layer with `files` files, the first of them marked `listed`, and `threads` threads, the first of them resolved or not as `resolved` says. */
function layer(
  files: number,
  listed: readonly FileViewedState[],
  threads = 0,
  resolved: readonly boolean[] = [],
): StackLayer {
  return unchecked<StackLayer>({
    __typename: 'PullRequest',
    id: 'PR_x',
    number: 1,
    state: 'OPEN',
    headRefOid: 'a'.repeat(40),
    reviewDecision: 'APPROVED',
    statusCheckRollup: { state: 'FAILURE' },
    isInMergeQueue: true,
    mergeQueueEntry: { position: 2, state: 'AWAITING_CHECKS' },
    files: { totalCount: files, nodes: listed.map((mark) => ({ viewerViewedState: mark })) },
    reviewThreads: {
      totalCount: threads,
      nodes: resolved.map((isResolved) => ({ isResolved })),
    },
    movedFrom: {
      nodes: [
        { __typename: 'AutomaticBaseChangeSucceededEvent', oldBase: 'first' },
        { __typename: 'AutomaticBaseChangeSucceededEvent', oldBase: 'last' },
      ],
    },
  });
}

test('viewed files count the marks read', () => {
  const read = layer(3, ['VIEWED', 'DISMISSED', 'VIEWED']);
  expect(viewedFiles(read)).toEqual({ viewed: 2, files: 3, complete: true });
  // Past the first 100, marks aren't read.
  const large = layer(
    150,
    Array.from({ length: 100 }, () => 'UNVIEWED' as const),
  );
  expect(viewedFiles(large)).toEqual({ viewed: 0, files: 150, complete: false });
  expect(read.reviewDecision).toBe('APPROVED');
  expect(movedFrom(read)).toBe('last');
  expect(read.mergeQueueEntry).toEqual({ position: 2, state: 'AWAITING_CHECKS' });
});

test('unresolved threads count the states read', () => {
  expect(layerThreads(layer(0, [], 3, [true, false, false]))).toEqual({
    unresolved: 2,
    threads: 3,
    complete: true,
  });
  // Past the first 100, states aren't read.
  const busy = layer(
    0,
    [],
    130,
    Array.from({ length: 100 }, (_, index) => index % 2 === 0),
  );
  expect(layerThreads(busy)).toEqual({ unresolved: 50, threads: 130, complete: false });

  // cli/cli's stack, as recorded: every thread on its layers is open.
  const found = cassette('stacks_cli').interactions.find(
    ({ interaction }) => interaction.request.operation === 'StackLayers',
  );
  const nodes = unchecked<{ data: { nodes: StackLayer[] } }>(found?.interaction.response.body).data
    .nodes;
  expect(nodes.map((node) => [node.number, layerThreads(node).unresolved])).toEqual([
    [14920, 7],
    [14921, 9],
    [14922, 2],
    [14923, 4],
    [14924, 3],
    [14925, 4],
    [14926, 2],
    [14927, 4],
  ]);
});

/** What `pointer`, a JSON pointer, points at in `value`. */
function atPointer(value: Json | undefined, pointer: string): Json | undefined {
  return pointer
    .split('/')
    .slice(1)
    .reduce<Json | undefined>((inside, key) => (isObject(inside) ? inside[key] : undefined), value);
}

test('it watches fields the open prs check has', () => {
  const found = cassette('poll_playground').interactions.find(
    ({ interaction }) => interaction.request.operation === 'PullRequestCheck',
  );
  const body = found?.interaction.response.body;
  const check = atPointer(body, '/data/repository/pullRequest');
  const missing = STACK_LAYERS_WATCHED.filter((pointer) => atPointer(check, pointer) === undefined);
  expect(missing).toEqual([]);
});
