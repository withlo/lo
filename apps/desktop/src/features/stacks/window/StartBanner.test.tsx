// @vitest-environment jsdom
// The banner that offers where a layer's diff starts, with main answered by a stand-in bridge: it
// shows what main offers, for a tab drawn before main said anything too, its button asks main to
// start the diff there and goes, and it goes once main offers nothing.

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, it, onTestFinished } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { Offer, StackState } from '../contract.ts';
import feature from './index.ts';
import { StartBanner } from './StartBanner.tsx';

const BELOW = '5'.repeat(40);

const OFFER: Offer = {
  title: "#84's diff includes #83's changes.",
  action: "Show only #84's",
  commit: BELOW,
};

/** What main says of each tab's stack, by its id. */
const states = new Map<string, StackState>();

const bridge = installBridge({
  'stacks.state': (input) => states.get(String(Reflect.get(Object(input), 'id'))),
  'stacks.useStart': () => undefined,
});

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  feature.start?.();
});

/** Pull request #84's tab, by its view `id`. */
function tabOf(id: string): PullTab {
  return {
    id,
    kind: 'pull',
    owner: 'rozed-dev',
    repo: 'e2e',
    number: 84,
    title: 'c',
    state: 'open',
  };
}

/** Draws `node` on the page, until the test ends. */
function draw(node: ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

/** Lets what's waiting on main settle, until `done` holds. */
async function until(done: () => boolean): Promise<void> {
  for (let round = 0; round < 200 && !done(); round++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  expect(done()).toBe(true);
}

it('offers the start main offers, and asks main to use it', async () => {
  const page = draw(<StartBanner tab={tabOf('t1:84')} />);
  expect(page.textContent).toBe('');
  act(() => bridge.push('stacks.stack', { id: 't1:84', stack: { kind: 'none' }, offer: OFFER }));
  expect(page.querySelector('[role="status"]')?.textContent).toContain(OFFER.title);
  const button = [...page.querySelectorAll('button')].find(
    (each) => each.textContent === OFFER.action,
  );
  act(() => button?.click());
  await until(() => bridge.calls.some(([channel]) => channel === 'stacks.useStart'));
  expect(bridge.calls.find(([channel]) => channel === 'stacks.useStart')?.[1]).toEqual({
    id: 't1:84',
    commit: BELOW,
  });
  expect(page.textContent).toBe('');
});

it('asks main for the offer of a tab drawn before main said anything, and goes when it’s gone', async () => {
  states.set('t2:84', { id: 't2:84', stack: { kind: 'none' }, offer: OFFER });
  const page = draw(<StartBanner tab={tabOf('t2:84')} />);
  await until(() => (page.textContent ?? '').includes(OFFER.title));
  act(() => bridge.push('stacks.stack', { id: 't2:84', stack: { kind: 'none' }, offer: null }));
  expect(page.textContent).toBe('');
});
