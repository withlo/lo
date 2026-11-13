// @vitest-environment jsdom
// The dialog for making a chain a GitHub stack, with main answered by a stand-in bridge: a key held
// down, or a double click, never presses a button that came up after the press began, and putting
// back is asked for once.

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
  const channels = ['stacks.plan', 'stacks.convert', 'stacks.stop', 'stacks.putBack'];
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
  title: 'Make these 3 PRs a GitHub stack?',
  description: 'e2e · found by base branch',
  heading: '1 · One base branch changes',
  rows: [{ number: 84, title: 'Stack C', base: 'stack/root', to: 'stack/b' }],
  stack: '#82 → #83 → #84, through GitHub’s Stacks API.',
  warning: null,
  login: 'rozed-bot',
  confirm: 'Make the stack',
});

/** A conversion that stopped at its first change, with `label` to put it back, or none. */
const failed = (label: string | null): ConversionView => ({
  key: KEY,
  tab: 't1',
  version: 1,
  phase: 'failed',
  title: 'The stack wasn’t created',
  description: 'One base branch had already changed.',
  waitingUntil: null,
  stopping: false,
  changes: [
    {
      change: { kind: 'retarget', pr: 84, from: 'stack/root', to: 'stack/b' },
      status: label === null ? 'failed' : 'done',
      detail: null,
    },
  ],
  putBack: [],
  putBackLabel: label,
  notes: [],
  made: null,
});

function showing(view: ConversionView): void {
  act(() =>
    stacksStore.setState({
      dialog: { kind: 'conversion', tab: 't1', number: 84, key: view.key, asking: false },
      conversions: new Map([[view.key, view]]),
    }),
  );
}

it('confirms a plan only on a first press of ⏎, never on a held one', async () => {
  answers = { 'stacks.convert': () => ({ ...failed(null), phase: 'running' }) };
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
  // A repeat is stopped before the button, so it can't press it, nor can the dialog for it.
  expect(enter(button('Make the stack'), true).defaultPrevented).toBe(true);
  expect(enter(dialog()?.querySelector('p') ?? document.body, true).defaultPrevented).toBe(true);
  await settle();
  expect(asked()).toEqual([]);
  // A first press is the reader's: `⏎` off the buttons presses the main one.
  expect(enter(dialog()?.querySelector('p') ?? document.body, false).defaultPrevented).toBe(true);
  await settle();
  expect(bridge.calls.filter(([channel]) => channel === 'stacks.convert')).toEqual([
    ['stacks.convert', { key: KEY }],
  ]);
});

it('never confirms the plan "Try again" brought up with the same press or a double click', async () => {
  answers = {
    'stacks.plan': () => plan(AGAIN),
    'stacks.stop': () => undefined,
    'stacks.convert': () => ({ ...failed(null), key: AGAIN, phase: 'running' }),
  };
  render();
  showing(failed(null));
  // The double click's first click plans again; its second lands where "Make the stack" comes up.
  click(button('Try again'), 1);
  await vi.waitFor(() => expect(dialog()?.textContent).toContain('Make the stack'));
  click(button('Make the stack'), 2);
  // `⏎` held from before the plan came up repeats on it.
  enter(button('Make the stack'), true);
  await settle();
  expect(asked()).toEqual(['stacks.stop', 'stacks.plan']);
  click(button('Make the stack'), 1);
  await settle();
  expect(bridge.calls.at(-1)).toEqual(['stacks.convert', { key: AGAIN }]);
});

it('asks main to put the base branches back once, however many presses', async () => {
  const answer = Promise.withResolvers<ConversionView>();
  answers = { 'stacks.putBack': () => answer.promise };
  render();
  showing(failed('Put the base branch back'));
  click(button('Put the base branch back'));
  click(button('Put the base branch back'));
  enter(dialog()?.querySelector('h2') ?? document.body, false);
  await settle();
  expect(bridge.calls).toEqual([['stacks.putBack', { key: KEY }]]);
  expect(button('Put the base branch back').getAttribute('aria-disabled')).toBe('true');
  answer.resolve({ ...failed('Put the base branch back'), version: 2, phase: 'puttingBack' });
  await settle();
  expect(dialog()?.textContent).not.toContain('nothing to put back');
});

it('drops the controls that reorder text from what GitHub said', () => {
  render();
  const view = failed(null);
  showing({
    ...view,
    changes: view.changes.map((row) => ({ ...row, detail: 'Base ‮b/kcats‬ was refused.' })),
  });
  expect(dialog()?.textContent).toContain('Base b/kcats was refused.');
});
