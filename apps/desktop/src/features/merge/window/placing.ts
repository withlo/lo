// Where the merge panel's pull request sits, as main says when the panel asks, which decides what
// the panel's main button merges: a GitHub stack's layers below it too, a chain's bottom layer
// alone, or nothing until the chain is a GitHub stack. The panel asks each time it opens, again
// when the layers of the pull request's stack move, as main sends them for its stack's tree, and
// while Lo lists the open pull requests again, which may settle it; `⏎` asks once more before it
// refuses for where the pull request sits. What main said last stands while it's asked again, so
// only the first time it's asked does the panel wait to say what it merges.

import { client } from '../../../window/ipc.ts';
import {
  contract as stacksContract,
  type StackState,
  type StackView,
} from '../../stacks/contract.ts';
import { tabState } from '../../tab/window/shared.ts';
import type { MergeState, Placement } from '../contract.ts';
import { main } from './main.ts';
import { panels, placementOf } from './store.ts';

/**
 * Each view's stack, as far as it says where the pull request sits: a text that changes when its
 * layers or what they sit on change, or what they could become, and not when their reviews or
 * checks do. Nothing until main has sent it.
 */
export const shapes = tabState<string | undefined>(() => undefined);

/** What of `stack` says where its layers sit, as a text. */
export function shapeOf(stack: StackView): string {
  if (stack.kind !== 'stack') return stack.kind;
  return JSON.stringify([
    stack.root,
    stack.githubStack,
    stack.callout,
    stack.notes.map((note) => note.kind),
    stack.rows.map((row) => [row.number, row.on, row.branch, row.state, row.needsRebase]),
  ]);
}

/** Takes a view's stack as main sends it to the stack's tree. */
export function takeStack({ id, stack }: StackState): void {
  const shape = shapeOf(stack);
  if (shapes.get(id) !== shape) shapes.set(id, shape);
}

/** Follows each view's stack as main sends it. Returns a function that stops. */
export function followStacks(): () => void {
  return client(stacksContract).subscribe('stack', takeStack);
}

/**
 * What a view's place is asked at, with its status `state`: the head, the base and the verdict, the
 * panel's `round` of asking, and the `shape` of the stack's layers. A change to any asks again.
 */
export function placeKey(state: MergeState, round: number, shape: string | undefined): string {
  return [state.head, state.base, state.verdict, String(round), shape ?? ''].join('\n');
}

/** What main is being asked, by view: what it was asked at, and what it says. */
const asking = new Map<
  string,
  { readonly at: string; readonly said: Promise<Placement | undefined> }
>();

/**
 * Asks main where view `id`'s pull request sits, unless it was asked at `at` already, or is being
 * asked there: what main says, or nothing when it couldn't say. What it said the time before stands
 * until it answers.
 */
export function readPlace(id: string, at: string): Promise<Placement | undefined> {
  const now = panels.get(id).place;
  if (now.kind === 'read' && now.at === at) return Promise.resolve(now.placement);
  if (now.kind === 'failed' && now.at === at) return Promise.resolve(undefined);
  const under = asking.get(id);
  if (under?.at === at && now.kind === 'reading' && now.at === at) return under.said;
  const last = placementOf(id);
  panels.update(id, (panel) => ({ ...panel, place: { kind: 'reading', at, last } }));
  const said = main()
    .place({ id })
    .then(
      (placement): Placement | undefined => placement,
      (error: unknown) => {
        console.error('Lo couldn’t ask where the pull request sits:', error);
        return undefined;
      },
    )
    .then((placement) => {
      if (asking.get(id)?.at === at) asking.delete(id);
      const current = panels.get(id).place;
      if (current.kind === 'reading' && current.at === at) {
        panels.update(id, (panel) => ({
          ...panel,
          place: placement === undefined ? { kind: 'failed', at } : { kind: 'read', at, placement },
        }));
      }
      return placement;
    });
  asking.set(id, { at, said });
  return said;
}

/**
 * Where view `id`'s pull request sits now, with its status `state`: what main is being asked, once
 * it answers; else what it last said, unless that keeps the merge from going, which it's asked
 * afresh. Nothing when main couldn't say, which leaves the merge to main to plan.
 */
export function placeNow(id: string, state: MergeState): Promise<Placement | undefined> {
  const { place } = panels.get(id);
  if (place.kind === 'reading') return readPlace(id, place.at);
  const placement = placementOf(id);
  // Lo is listing the open pull requests again, and the panel asks again by itself.
  if (placement?.kind === 'refused' && placement.again) return Promise.resolve(placement);
  if (place.kind === 'read' && placement?.kind !== 'convert' && placement?.kind !== 'refused') {
    return Promise.resolve(placement);
  }
  panels.update(id, (panel) => ({ ...panel, round: panel.round + 1 }));
  return readPlace(id, placeKey(state, panels.get(id).round, shapes.get(id)));
}
