// @vitest-environment jsdom
// The open box as drawn: a button under its field goes with what it acted on, and the field keeps
// focus, so typing and `⏎` go on working in it.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type { Preview } from '../contract.ts';
import { boxClosed, closeBox, openBox } from './box.ts';
import open from './index.ts';
import { OpenBox } from './OpenBox.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

const ISSUE = 'https://github.com/rozed-dev/e2e/issues/12';
const issue: Preview = { kind: 'web', url: ISSUE, github: true, page: 'issue', secure: true };

/** What the window's bridge answers, which each test sets: the feature's client keeps one bridge. */
const answers: Record<string, (input: unknown) => unknown> = {};
installBridge(answers);

// Base UI moves focus on the next animation frame, which never comes here.
let frame: MockInstance<typeof window.requestAnimationFrame> | undefined;

beforeEach(() => {
  frame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
  createRegistry(open.commands, 'mac');
});

afterEach(() => {
  act(() => {
    closeBox();
    boxClosed();
  });
  frame?.mockRestore();
  for (const channel of Object.keys(answers)) Reflect.deleteProperty(answers, channel);
  document.body.replaceChildren();
});

/** Lets the bridge's answers, and what waits on them, run. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
  });
}

/** The box, open on `text`, as the window draws it. */
async function render(text: string): Promise<HTMLInputElement> {
  const page = document.createElement('div');
  page.id = 'root';
  document.body.append(page);
  const root = createRoot(page);
  act(() => root.render(<OpenBox />));
  act(() => openBox(text));
  await settle();
  const field = document.querySelector('[data-lo-scope="palette"] input');
  if (!(field instanceof HTMLInputElement)) throw new Error('No field in the box.');
  return field;
}

/** Presses the button named `label` in the box, as a click that gives it focus first. */
async function press(label: string): Promise<void> {
  const found = [...document.querySelectorAll('[data-lo-scope="palette"] button')].find((each) =>
    each.textContent.startsWith(label),
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`No button "${label}".`);
  found.focus();
  expect(document.activeElement).toBe(found);
  act(() => found.click());
  await settle();
}

describe('the open box’s buttons', () => {
  it('give the field focus back as the link note’s button goes', async () => {
    answers['open.look'] = () => issue;
    // Main's answer waits, so the box shows it opening, with the button gone.
    answers['open.open'] = () => new Promise(() => undefined);
    const field = await render(ISSUE);
    await press('Open on GitHub');
    expect(document.body.textContent).toContain('Opening link…');
    expect(document.body.textContent).not.toContain('Open on GitHub');
    expect(document.activeElement).toBe(field);
  });

  it('give the field focus back as Try again goes', async () => {
    let fails = true;
    answers['open.look'] = () => {
      if (fails) throw new Error('The bridge went away.');
      return issue;
    };
    const field = await render(ISSUE);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Couldn’t check the link',
    );
    // The alert is a live region of its own, in none that says the box's lines.
    expect(document.querySelector('[role="status"] [role="alert"]')).toBeNull();
    fails = false;
    await press('Try again');
    expect(document.body.textContent).not.toContain('Couldn’t check the link');
    expect(document.activeElement).toBe(field);
  });
});
