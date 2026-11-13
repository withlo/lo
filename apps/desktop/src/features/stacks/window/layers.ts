// The stack each view of a pull request's tab is in, as main last said, and the layer the keyboard
// is on in its tree: kept with the view, and gone when its tab closes. And where `]s` and `[s` go
// from a layer: main sends the rows in the core's walk, so the next row is the next layer.

import { tabState } from '../../tab/window/shared.ts';
import type { StackState, StackView } from '../contract.ts';
import { main } from './main.ts';

/** Each view's stack, as main last said: nothing until it has. */
export const stacks = tabState<StackView | undefined>(() => undefined);

/** The layer the keyboard is on in each view's stack tree, by number, once it's been on one. */
export const focused = tabState<number | undefined>(() => undefined);

/** Takes what main sent of a view's stack. */
export function takeStack({ id, stack }: StackState): void {
  if (JSON.stringify(stacks.get(id)) !== JSON.stringify(stack)) stacks.set(id, stack);
}

const asked = new Set<string>();

/** Asks main for a view's stack, once at a time, for a view drawn before main said anything of it. */
export function catchUp(id: string): void {
  if (asked.has(id)) return;
  asked.add(id);
  main()
    .state({ id })
    .then((state) => {
      // A topic that came meanwhile is newer.
      if (state && stacks.get(id) === undefined) takeStack(state);
    })
    .catch((error: unknown) => console.error("Lo couldn't ask about a tab's stack:", error))
    .finally(() => asked.delete(id));
}

/** The layers of `view`, by number, in the order the tree lists them and `]s` walks them. */
export function layersOf(view: StackView | undefined): readonly number[] {
  return view?.kind === 'stack' ? view.rows.map((row) => row.number) : [];
}

/**
 * The layer the keyboard is on in `view`'s tree: `keyboard`, the one it was put on, while it's still
 * a layer, or else `onScreen`, the layer on screen, or the first.
 */
export function keyboardLayer(
  view: StackView | undefined,
  keyboard: number | undefined,
  onScreen: number,
): number | undefined {
  const layers = layersOf(view);
  if (keyboard !== undefined && layers.includes(keyboard)) return keyboard;
  return layers.includes(onScreen) ? onScreen : layers[0];
}

/**
 * The layer `by` steps from `number` in `view`, the stack it's in: the next one for `]s`, the one
 * before for `[s`. The walk doesn't go round: at either end, or without a stack, it says why not.
 */
export function stepFrom(
  view: StackView | undefined,
  number: number,
  by: 1 | -1,
): { layer: number } | { why: string } {
  switch (view?.kind) {
    case undefined:
    case 'unknown':
      return { why: `Lo is still looking for the stack #${number} is in.` };
    case 'none':
      return { why: `#${number} isn't in a stack.` };
    case 'stack': {
      const layers = layersOf(view);
      const at = layers.indexOf(number);
      if (at < 0) return { why: `#${number} isn't in its stack now.` };
      const layer = layers[at + by];
      if (layer !== undefined) return { layer };
      return { why: `#${number} is the ${by > 0 ? 'last' : 'first'} layer.` };
    }
    default:
      view satisfies never;
      throw new Error(`A stack of a kind Lo doesn't know: ${JSON.stringify(view)}.`);
  }
}
