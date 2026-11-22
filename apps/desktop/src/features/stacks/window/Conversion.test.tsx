// @vitest-environment jsdom
// The dialog for converting a chain to a GitHub stack, with main answered by a stand-in bridge: a
// key held down, or a double click, never presses a button that came up after the press began, and
// undoing is asked for once.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, onTestFinished, vi } from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge, type FakeBridge } from '../../../window/test/bridge.ts';
import type { ConversionView, Plan } from '../contract.ts';
import { ConversionDialog } from './Conversion.tsx';
import feature from './index.ts';
import { stacksStore } from './store.ts';

const KEY = '00000000-0000-0000-0000-000000000001';
const AGAIN = '00000000-0000-0000-0000-000000000002';

/** What main answers each request with, as each test says. The feature's client is made once. */
let answers: Record<string, (input: unknown) => unknown> = {};
let bridge: FakeBridge;

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(feature.commands, 'mac');
  const channels = [
    'stacks.plan',
    'stacks.convert',
    'stacks.stop',
    'stacks.putBack',
    'tab.openExternal',
  ];
  bridge = installBridge(
    Object.fromEntries(
      channels.map((channel) => [channel, (input: unknown) => answers[channel]?.(input)]),
    ),
  );
});

afterEach(() => {
  act(() => stacksStore.setState({ dialog: undefined, conversions: new Map() }));
  answers = {};
  bridge.calls.length = 0;
});

/** The requests made of main, by their channels. */
const asked = () => bridge.calls.map(([channel]) => channel);

function render(): void {
  const host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<ConversionDialog />));
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
}

/** Lets every answer main gave, and what follows from it, happen. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
  });
}

const dialog = () => document.querySelector('[data-testid="make-stack"]');

function button(text: string): HTMLButtonElement {
  const found = [...(dialog()?.querySelectorAll('button') ?? [])].find((each) =>
    each.textContent.startsWith(text),
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`No button "${text}".`);
  return found;
}

/** Presses `⏎` on `target`, as a first press or as a held key's repeat. */
function enter(target: Element, repeat: boolean): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    repeat,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Clicks `target`, as the `count`th click of a run of them. */
function click(target: Element, count = 1): void {
  act(() => {
    target.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, detail: count }),
    );
  });
}

const plan = (key: string): Plan => ({
  kind: 'plan',
  key,
  description: 'e2e · 3 layers',
  changes: [
    { kind: 'retarget', pr: 84, from: 'stack/root', to: 'stack/b' },
    { kind: 'create', prs: [82, 83, 84] },
  ],
  warning: 'On GitHub, each moved pull request’s diff shows only its own commits.',
  login: 'rozed-bot',
});

/** A conversion that stopped at its first change, which can be undone when `undo`. */
const failed = (undo: boolean): ConversionView => ({
  key: KEY,
  tab: 't1',
  version: 1,
  phase: 'failed',
  waitingUntil: null,
  stopping: false,
  changes: [
    {
      change: { kind: 'retarget', pr: 84, from: 'stack/root', to: 'stack/b' },
      status: undo ? 'done' : 'failed',
      detail: null,
    },
    { change: { kind: 'create', prs: [82, 83, 84] }, status: 'skipped', detail: null },
  ],
  putBack: [],
  line: null,
  problem: {
    title: 'Couldn’t convert to GitHub stack',
    reason: 'Each pull request must be based on the one below it.',
    details: null,
    link: null,
  },
  undo,
});

function showing(view: ConversionView): void {
  act(() =>
    stacksStore.setState({
      dialog: {
        kind: 'conversion',
        tab: 't1',
        number: 84,
        key: view.key,
        plan: plan(view.key),
        asking: false,
        problem: undefined,
      },
      conversions: new Map([[view.key, view]]),
    }),
  );
}

it('confirms a plan only on a first press of ⏎, never on a held one', async () => {
  answers = { 'stacks.convert': () => ({ ...failed(false), phase: 'running', problem: null }) };
  render();
  act(() =>
    stacksStore.setState({
      dialog: {
        kind: 'confirm',
        tab: 't1',
        number: 84,
        plan: plan(KEY),
        sending: false,
        problem: undefined,
      },
    }),
  );
  const text = dialog()?.textContent ?? '';
  expect(text).toContain('Convert to GitHub stack?');
  expect(text).toContain('e2e · 3 layers');
  expect(text).toContain('Move #84 onto stack/b.');
  expect(text).toContain('Create the GitHub stack from #82, #83 and #84.');
  expect(text).toContain('On GitHub, each moved pull request’s diff shows only its own commits.');
  // A repeat is stopped before the button, so it can't press it, nor can the dialog for it.
  expect(enter(button('Convert to GitHub stack'), true).defaultPrevented).toBe(true);
  expect(enter(dialog()?.querySelector('p') ?? document.body, true).defaultPrevented).toBe(true);
  await settle();
  expect(asked()).toEqual([]);
  // A first press is the reader's: `⏎` off the buttons presses the main one.
  expect(enter(dialog()?.querySelector('p') ?? document.body, false).defaultPrevented).toBe(true);
  await settle();
  expect(bridge.calls.filter(([channel]) => channel === 'stacks.convert')).toEqual([
    ['stacks.convert', { key: KEY }],
  ]);
  // It's busy while it converts, under the same title.
  expect(button('Convert to GitHub stack').getAttribute('aria-busy')).toBe('true');
  expect(dialog()?.textContent).toContain('Convert to GitHub stack?');
});

it('never confirms the plan "Try again" brought up with the same press or a double click', async () => {
  answers = {
    'stacks.plan': () => plan(AGAIN),
    'stacks.stop': () => undefined,
    'stacks.convert': () => ({ ...failed(false), key: AGAIN, phase: 'running', problem: null }),
  };
  render();
  showing(failed(false));
  // The double click's first click plans again; its second lands where Convert comes up.
  click(button('Try again'), 1);
  await vi.waitFor(() => expect(dialog()?.textContent).toContain('Convert to GitHub stack'));
  click(button('Convert to GitHub stack'), 2);
  // `⏎` held from before the plan came up repeats on it.
  enter(button('Convert to GitHub stack'), true);
  await settle();
  expect(asked()).toEqual(['stacks.stop', 'stacks.plan']);
  click(button('Convert to GitHub stack'), 1);
  await settle();
  expect(bridge.calls.at(-1)).toEqual(['stacks.convert', { key: AGAIN }]);
});

it('asks main to undo the changes once, however many presses', async () => {
  const answer = Promise.withResolvers<ConversionView>();
  answers = { 'stacks.putBack': () => answer.promise };
  render();
  showing(failed(true));
  click(button('Undo changes'));
  click(button('Undo changes'));
  enter(dialog()?.querySelector('h2') ?? document.body, false);
  await settle();
  expect(bridge.calls).toEqual([['stacks.putBack', { key: KEY }]]);
  expect(button('Undo changes').getAttribute('aria-busy')).toBe('true');
  answer.resolve({ ...failed(true), version: 2, phase: 'puttingBack', problem: null });
  await settle();
  expect(button('Undo changes').getAttribute('aria-busy')).toBe('true');
  expect(button('Cancel')).toBeDefined();
});

it('says what went wrong above the buttons, and what undoing left as it was in its step', () => {
  render();
  const view = failed(false);
  showing(view);
  let text = dialog()?.textContent ?? '';
  expect(text).toContain('Couldn’t convert to GitHub stack');
  expect(text).toContain('Each pull request must be based on the one below it.');
  expect(text).toContain('From stack/root.');
  // Nothing changed, so there is nothing to undo: it can be tried again or closed.
  expect(text).not.toContain('Undo changes');
  expect(button('Try again')).toBeDefined();
  expect(button('Close')).toBeDefined();

  showing({
    ...view,
    phase: 'putBack',
    putBack: [
      {
        change: { kind: 'retarget', pr: 84, from: 'stack/b', to: 'stack/root' },
        status: 'left',
        detail: 'stack/x',
      },
    ],
    problem: {
      title: 'Couldn’t undo every change',
      reason: '1 base branch was changed elsewhere.',
      details: null,
      link: null,
    },
    undo: false,
  });
  text = dialog()?.textContent ?? '';
  expect(text).toContain('Undo');
  expect(text).toContain('Move #84 onto stack/root.');
  expect(text).toContain('Its base branch is now stack/x.');
  expect(text).toContain('Couldn’t undo every change');
  expect(button('Close')).toBeDefined();
});

it('opens GitHub’s page for a conversion that isn’t confirmed, and offers to undo it', async () => {
  answers = { 'tab.openExternal': () => undefined };
  render();
  const link = 'https://github.com/rozed-dev/e2e/pull/82';
  showing({
    ...failed(true),
    changes: [
      {
        change: { kind: 'retarget', pr: 84, from: 'stack/root', to: 'stack/b' },
        status: 'done',
        detail: null,
      },
      { change: { kind: 'create', prs: [82, 83, 84] }, status: 'unknown', detail: null },
    ],
    problem: {
      title: 'Conversion not confirmed',
      reason: 'GitHub didn’t respond.',
      details: 'GitHub answered 502: Bad Gateway.',
      link,
    },
  });
  expect(dialog()?.textContent).toContain('Not confirmed');
  expect(button('Undo changes')).toBeDefined();
  click(button('Open on GitHub'));
  await settle();
  expect(bridge.calls).toEqual([['tab.openExternal', { url: link }]]);
});

it('says it’s done, with Done its only button', () => {
  render();
  showing({
    ...failed(false),
    phase: 'done',
    changes: failed(false).changes.map((row) => ({ ...row, status: 'done' })),
    line: 'Converted to GitHub stack',
    problem: null,
  });
  expect(dialog()?.textContent).toContain('Converted to GitHub stack');
  expect(button('Done')).toBeDefined();
  expect(() => button('Try again')).toThrow('No button');
  expect(() => button('Close')).toThrow('No button');
});

it('drops the controls that reorder text from what GitHub said', () => {
  render();
  showing({
    ...failed(false),
    problem: {
      title: 'Couldn’t convert to GitHub stack',
      reason: 'Its base branch is now ‮b/kcats‬.',
      details: null,
      link: null,
    },
  });
  expect(dialog()?.textContent).toContain('Its base branch is now b/kcats.');
});
