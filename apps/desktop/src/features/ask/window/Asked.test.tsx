// @vitest-environment jsdom
// The question main asks, as Lo's own dialog, with main answered by a stand-in bridge: it shows what
// main asked, with Cancel focused, so `⏎` is Cancel, as `Esc` is; only the action's own press
// answers it; and it goes once main takes the question down.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, expect, onTestFinished, test } from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type { Question } from '../contract.ts';
import { Asked } from './Asked.tsx';
import feature from './index.ts';

const REPLACE: Question = {
  id: '0b5f7f2e-7d1c-4c57-9a43-1f1f3b6c5a10',
  title: 'Replace Lo in Applications?',
  detail: 'The copy in Applications moves to the Trash. This one takes its place and restarts.',
  action: 'Replace Lo',
};

const bridge = installBridge({ 'ask.read': () => null, 'ask.answer': () => undefined });

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry([], 'mac');
  feature.start?.();
});

afterEach(() => {
  act(() => bridge.push('ask.question', null));
  bridge.calls.length = 0;
});

/** The dialog as the window draws it, once main has asked `question`. */
function render(question: Question = REPLACE): HTMLElement {
  const host = document.createElement('div');
  host.id = 'root';
  host.className = 'lo-app';
  document.body.append(host);
  const root = createRoot(host);
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  act(() => root.render(<Asked />));
  act(() => bridge.push('ask.question', question));
  return document.querySelector<HTMLElement>('[data-testid="asked"]')!;
}

function button(within: Element, text: string): HTMLButtonElement {
  const found = [...within.querySelectorAll('button')].find((each) =>
    each.textContent.startsWith(text),
  );
  if (!found) throw new Error(`No button "${text}".`);
  return found;
}

/** The answers the window sent main. */
function answers(): unknown[] {
  return bridge.calls.filter(([channel]) => channel === 'ask.answer').map(([, input]) => input);
}

test('shows what main asked, with Cancel focused, so `⏎` is Cancel', async () => {
  const dialog = render();
  // It takes focus a turn or two after it mounts.
  await act(async () => {
    for (let turn = 0; turn < 3; turn++) await Promise.resolve();
  });
  expect(dialog.textContent).toContain('Replace Lo in Applications?');
  expect(dialog.textContent).toContain(REPLACE.detail);
  const cancel = button(dialog, 'Cancel');
  expect(cancel.textContent).toContain('Esc');
  expect(button(dialog, 'Replace Lo').textContent).toBe('Replace Lo');
  expect(document.activeElement).toBe(cancel);
});

test('answers the action only for its own press, with the question’s id, and once', () => {
  const dialog = render();
  const replace = button(dialog, 'Replace Lo');
  act(() => {
    replace.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    replace.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  });
  expect(answers()).toEqual([{ id: REPLACE.id, act: true }]);
});

test('answers Cancel for Cancel, `Esc`, and `⏎` off its buttons', () => {
  const dialog = render();
  act(() => {
    button(dialog, 'Cancel').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(answers()).toEqual([{ id: REPLACE.id, act: false }]);
  for (const key of ['Escape', 'Enter']) {
    const id = `${key}-question`;
    act(() => bridge.push('ask.question', { ...REPLACE, id }));
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
    expect(answers().at(-1)).toEqual({ id, act: false });
  }
  expect(answers()).toHaveLength(3);
});

test('ignores a held key’s repeats', () => {
  const dialog = render();
  act(() => {
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, repeat: true }),
    );
  });
  expect(answers()).toEqual([]);
});

test('goes once main takes the question down', () => {
  render();
  act(() => bridge.push('ask.question', null));
  const shown = document.querySelector('[data-testid="asked"]');
  expect(shown === null || shown.hasAttribute('inert')).toBe(true);
});
