// @vitest-environment jsdom
// The banner that offers where a layer's diff starts, with main answered by a stand-in bridge: it
// shows what main offers, its button asks main to start the diff there and goes, and it shows only
// while a start is offered, asking main for a tab drawn before main said anything.

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, it, onTestFinished } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type { DiffState } from '../../diff/contract.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { Offer, StackState } from '../contract.ts';
import feature from './index.ts';
import { StartBanner } from './StartBanner.tsx';
import { startedAt, startSwitch } from './offers.ts';

const BELOW = '5'.repeat(40);

const OFFER: Offer = {
  title: "#84's diff includes #83's changes.",
  action: "Show only #84's",
  commit: BELOW,
};

/** What main says of each tab's stack, by its id. */
const states = new Map<string, StackState>();

/** What main says of each tab's diff, by its id. */
const diffs = new Map<string, DiffState>();

/** The diff of tab `id` as the local copy has it, with `change`. */
function diffOf(id: string, change: Partial<DiffState> = {}): DiffState {
  return {
    id,
    at: '1'.repeat(40),
    comparison: null,
    compareFrom: null,
    since: null,
    waiting: null,
    from: 'local',
    start: null,
    files: [],
    partial: false,
    uncompared: false,
    problem: null,
    ...change,
  };
}

const bridge = installBridge({
  'stacks.state': (input) => states.get(String(Reflect.get(Object(input), 'id'))),
  'stacks.useStart': () => undefined,
  'diff.versions': (input) => diffs.get(String(Reflect.get(Object(input), 'id'))),
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

it('shows only while a start is offered, asking main for it as a tab drawn before main said anything comes on screen', async () => {
  states.set('t2:84', { id: 't2:84', stack: { kind: 'none' }, offer: OFFER });
  const tab = tabOf('t2:84');
  expect(startSwitch.shows(tab)).toBe(false);
  let changes = 0;
  const stop = startSwitch.subscribe(tab, () => {
    changes += 1;
  });
  onTestFinished(stop);
  await until(() => startSwitch.shows(tab));
  expect(changes).toBeGreaterThan(0);
  const page = draw(<StartBanner tab={tab} />);
  expect(page.textContent).toContain(OFFER.title);
  act(() => bridge.push('stacks.stack', { id: 't2:84', stack: { kind: 'none' }, offer: null }));
  expect(startSwitch.shows(tab)).toBe(false);
  expect(page.textContent).toBe('');
});

it('doesn’t offer a start the diff on screen has', () => {
  const at = (change: Partial<DiffState>) => startedAt(OFFER, diffOf('t', change));
  // Compared with the commit offered, or worked out by the local copy to start there: as when the
  // layer's base branch, which its diff started at, was the layer below's until it was changed.
  expect(at({ compareFrom: BELOW })).toBe(true);
  expect(at({ start: BELOW })).toBe(true);
  // Another start, or none known, as with GitHub's diff, which doesn't say.
  expect(at({ start: '6'.repeat(40) })).toBe(false);
  expect(at({ compareFrom: '6'.repeat(40) })).toBe(false);
  expect(at({ from: 'github' })).toBe(false);
  expect(startedAt(OFFER, undefined)).toBe(false);
  // A start at the base branch is the whole pull request, compared with no commit.
  const base: Offer = { ...OFFER, commit: null };
  expect(startedAt(base, diffOf('t', { compareFrom: null }))).toBe(true);
  expect(startedAt(base, diffOf('t', { compareFrom: BELOW }))).toBe(false);
  // Not while two revisions are compared, or the diff waits for the local copy: neither is
  // compared with a commit, and neither starts at the base branch.
  expect(startedAt(base, diffOf('t', { comparison: 'r4 r5' }))).toBe(false);
  expect(startedAt(base, diffOf('t', { waiting: 'the local copy', from: null }))).toBe(false);
  expect(startedAt(base, diffOf('t', { from: null, files: null }))).toBe(false);
});

it('goes once the diff on screen starts where it offers, and stays while it starts elsewhere', async () => {
  states.set('t3:84', { id: 't3:84', stack: { kind: 'none' }, offer: OFFER });
  diffs.set('t3:84', diffOf('t3:84', { start: BELOW }));
  states.set('t4:84', { id: 't4:84', stack: { kind: 'none' }, offer: OFFER });
  diffs.set('t4:84', diffOf('t4:84', { start: '6'.repeat(40) }));
  const [started, elsewhere] = [tabOf('t3:84'), tabOf('t4:84')];
  for (const tab of [started, elsewhere]) {
    const stop = startSwitch.subscribe(tab, () => undefined);
    onTestFinished(stop);
  }
  // Both are offered the start; once main has said where each diff starts, only one still needs it.
  await until(() => startSwitch.shows(elsewhere));
  await until(() => !startSwitch.shows(started));
  const page = draw(
    <>
      <StartBanner tab={started} />
      <StartBanner tab={elsewhere} />
    </>,
  );
  expect(page.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(page.textContent).toContain(OFFER.title);
});
