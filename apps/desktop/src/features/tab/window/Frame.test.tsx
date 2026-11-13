// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { defineView, Slots } from '../../../window/slots.tsx';
import type { Tab } from '../contract.ts';
import { TabPage } from './Frame.tsx';
import { kinds } from './shared.ts';
import { showTabs } from './store.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  showTabs({ tabs: [{ id: 'recent', kind: 'recent' }], active: 'recent' });
});

const fd: Tab = { id: 'fd', kind: 'pull', owner: 'sharkdp', repo: 'fd', number: 2212 };
const bat: Tab = { id: 'bat', kind: 'pull', owner: 'sharkdp', repo: 'bat', number: 7 };
const settings: Tab = { id: 'settings', kind: 'settings' };

/** A pull request's tab, with a field and a count of its own, as a view would draw it. */
function Pull({ tab }: { tab: Tab }) {
  const [count] = useState(() => (tab.kind === 'pull' ? tab.number : 0));
  return tab.kind === 'pull' ? <input aria-label={tab.repo} defaultValue={count} /> : null;
}

/** Settings' tab, as its feature would draw it. */
function Settings({ tab }: { tab: Tab }) {
  return tab.kind === 'settings' ? <p>Settings</p> : null;
}

const views = [
  defineView(kinds, { id: 'test.pull', order: 0, render: Pull }),
  defineView(kinds, { id: 'test.settings', order: 1, render: Settings }),
];

/** The page in the middle of a window, and the window's middle. */
function render(): { middle: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <Slots views={views}>
        <main data-lo-middle tabIndex={-1}>
          <TabPage />
        </main>
      </Slots>,
    ),
  );
  onTestFinished(() => {
    act(() => root.unmount());
    container.remove();
  });
  const middle = container.querySelector('main');
  if (!middle) throw new Error('No middle.');
  return { middle };
}

describe('the tab on screen', () => {
  it('is drawn by its kind’s view, afresh each time it’s shown', () => {
    act(() => showTabs({ tabs: [fd, bat, settings], active: 'fd' }));
    const { middle } = render();
    const field = () => middle.querySelector('input');
    expect(field()?.getAttribute('aria-label')).toBe('fd');
    expect(field()?.value).toBe('2212');
    act(() => showTabs({ tabs: [fd, bat, settings], active: 'bat' }));
    // Nothing of the last tab's view carries over.
    expect(field()?.getAttribute('aria-label')).toBe('bat');
    expect(field()?.value).toBe('7');
    act(() => showTabs({ tabs: [fd, bat, settings], active: 'settings' }));
    expect(middle.textContent).toBe('Settings');
    expect(field()).toBeNull();
  });

  it('takes focus that left with the last tab’s view, but none as Lo starts', () => {
    act(() => showTabs({ tabs: [fd, bat], active: 'fd' }));
    const { middle } = render();
    expect(document.activeElement).toBe(document.body);
    middle.querySelector('input')?.focus();
    act(() => showTabs({ tabs: [fd, bat], active: 'bat' }));
    expect(document.activeElement).toBe(middle);
  });

  it('is a stack’s layer on screen, drawn afresh as another is shown, taking focus that left', () => {
    const stack: Tab = { ...fd, layer: 2213, layers: [2212, 2213] };
    act(() => showTabs({ tabs: [stack, bat], active: 'fd' }));
    const { middle } = render();
    const field = () => middle.querySelector('input');
    expect(field()?.value).toBe('2213');
    field()?.focus();
    act(() => showTabs({ tabs: [{ ...stack, layer: undefined }, bat], active: 'fd' }));
    expect(field()?.value).toBe('2212');
    expect(document.activeElement).toBe(middle);
  });

  it('leaves focus where it is when it didn’t leave with the last tab', () => {
    act(() => showTabs({ tabs: [fd, bat], active: 'fd' }));
    render();
    const outside = document.createElement('button');
    document.body.append(outside);
    onTestFinished(() => outside.remove());
    outside.focus();
    act(() => showTabs({ tabs: [fd, bat], active: 'bat' }));
    expect(document.activeElement).toBe(outside);
  });
});
