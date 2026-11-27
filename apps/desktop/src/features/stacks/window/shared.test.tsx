// @vitest-environment jsdom
// The offer of a GitHub stack that another feature makes, as the merge panel does: it's made while
// the stack main sent says it's offered, with the menu of the offer over the tree, and goes in the
// render that takes the tree's offer away, so a dismissal in either place takes both at once. A view
// drawn before main said anything of its stack asks for it.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, it, onTestFinished } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import type { StackView } from '../contract.ts';
import { stacks } from './layers.ts';
import { useConvertOffer } from './shared.ts';

const TAB: PullTab = {
  id: 't1:84',
  kind: 'pull',
  owner: 'rozed-dev',
  repo: 'e2e',
  number: 84,
  title: 'c',
  state: 'open',
};

/** #84's stack, its offer of a GitHub stack made over the tree. */
const OFFERED: StackView = {
  kind: 'stack',
  root: 'stack/root',
  githubStack: false,
  rows: [],
  notes: [],
  offered: true,
  callout: 'This branch stack merges one layer at a time.',
};

/** What main says of each tab's stack when the window asks. */
const said = new Map<string, StackView>();

const bridge = installBridge({
  'stacks.state': (input) => {
    const id = String(Reflect.get(Object(input), 'id'));
    const stack = said.get(id);
    return stack && { id, stack, offer: null };
  },
});

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

/** What each render of tab `tab` showed: whether the tree's offer and the other were made. */
function drawn(tab: PullTab): [boolean, boolean][] {
  const renders: [boolean, boolean][] = [];
  function Probe() {
    const tree = useTabState(
      stacks,
      tab.id,
      (view) => view?.kind === 'stack' && view.callout !== null,
    );
    const offer = useConvertOffer(tab);
    renders.push([tree, offer?.['data-lo-scope'] === 'notice']);
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<Probe />));
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return renders;
}

/** Lets what's waiting on main settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

it('is made while the stack is offered, and goes in the same render as the tree’s offer', () => {
  stacks.set(TAB.id, OFFERED);
  const renders = drawn(TAB);
  expect(renders.at(-1)).toEqual([true, true]);
  // Dismissed for the stack, from either place: main sends the stack once, with neither.
  act(() => stacks.set(TAB.id, { ...OFFERED, offered: false, callout: null }));
  expect(renders.at(-1)).toEqual([false, false]);
  expect(renders.some(([tree, offer]) => tree !== offer)).toBe(false);
  // Where the tree makes none, as before the layers' state is read, it's still made.
  act(() => stacks.set(TAB.id, { ...OFFERED, callout: null }));
  expect(renders.at(-1)).toEqual([false, true]);
});

it('isn’t made for a tab with no stack, and asks main for one drawn before it said', async () => {
  const tab = { ...TAB, id: 't2:84' };
  said.set(tab.id, OFFERED);
  const renders = drawn(tab);
  expect(renders.at(-1)).toEqual([false, false]);
  await settle();
  expect(bridge.calls).toContainEqual(['stacks.state', { id: tab.id }]);
  expect(renders.at(-1)).toEqual([true, true]);
  act(() => stacks.set(tab.id, { kind: 'none' }));
  expect(renders.at(-1)).toEqual([false, false]);
});
