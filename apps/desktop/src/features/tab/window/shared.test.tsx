// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import type { Tab } from '../contract.ts';
import { middleIds, panels } from './panels.ts';
import { activeTab, showMiddle, tabState, useActiveTab, useTabState } from './shared.ts';
import { showTabs } from './store.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

const fd: Tab = { id: 'fd', kind: 'pull', owner: 'sharkdp', repo: 'fd', number: 2212 };
const bat: Tab = { id: 'bat', kind: 'pull', owner: 'sharkdp', repo: 'bat', number: 7 };

afterEach(() => {
  showTabs({ tabs: [{ id: 'recent', kind: 'recent' }], active: 'recent' });
});

/** Renders `element` into a fresh root, and what it shows. */
function render(element: ReactNode): { text: () => string } {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(element));
  onTestFinished(() => act(() => root.unmount()));
  return { text: () => container.textContent };
}

/** The tab on screen, by its repository and number. */
function Title() {
  const tab = useActiveTab();
  return tab?.kind === 'pull' ? `${tab.repo}#${tab.number}` : 'none';
}

describe('the tab on screen', () => {
  it('is what main last said, and re-renders what reads it', () => {
    showTabs({ tabs: [fd, bat], active: 'fd' });
    expect(activeTab()).toBe(fd);
    const shown = render(<Title />);
    expect(shown.text()).toBe('fd#2212');
    act(() => showTabs({ tabs: [fd, bat], active: 'bat' }));
    expect(shown.text()).toBe('bat#7');
  });
});

describe('state kept for each tab', () => {
  it('starts as made, once a tab, and keeps each tab’s apart', () => {
    let made = 0;
    const open = tabState(() => {
      made += 1;
      return { folders: ['src'] };
    });
    showTabs({ tabs: [fd, bat], active: 'fd' });
    expect(open.get('fd')).toEqual({ folders: ['src'] });
    // The same value each time it's asked for, until it's set.
    expect(open.get('fd')).toBe(open.get('fd'));
    expect(made).toBe(1);
    open.update('fd', ({ folders }) => ({ folders: [...folders, 'docs'] }));
    open.set('bat', { folders: [] });
    expect(open.get('fd')).toEqual({ folders: ['src', 'docs'] });
    expect(open.get('bat')).toEqual({ folders: [] });
  });

  it('holds undefined as a value of its own', () => {
    const picked = tabState<string | undefined>(() => 'README.md');
    picked.set('fd', undefined);
    expect(picked.get('fd')).toBeUndefined();
  });

  it('goes as its tab closes, and starts afresh for a tab opened since', () => {
    const count = tabState(() => 0);
    showTabs({ tabs: [fd, bat], active: 'fd' });
    count.set('fd', 3);
    count.set('bat', 5);
    showTabs({ tabs: [bat], active: 'bat' });
    expect(count.get('bat')).toBe(5);
    expect(count.get('fd')).toBe(0);
  });

  it('re-renders what reads a tab’s value when it’s set, and only that tab’s', () => {
    const count = tabState(() => 0);
    showTabs({ tabs: [fd, bat], active: 'fd' });
    let renders = 0;
    function Count({ tab }: { tab: string }) {
      renders += 1;
      return `${tab}: ${useTabState(count, tab, (value) => value * 2)}`;
    }
    const shown = render(<Count tab="fd" />);
    expect(shown.text()).toBe('fd: 0');
    act(() => count.set('fd', 2));
    expect(shown.text()).toBe('fd: 4');
    const before = renders;
    act(() => count.set('bat', 9));
    expect(renders).toBe(before);
  });
});

describe('the middle views', () => {
  it('show one by its id, as the tab draws them, and say when the tab has no such view', () => {
    showTabs({ tabs: [fd, bat], active: 'fd' });
    const drawn = middleIds.ids;
    onTestFinished(() => {
      middleIds.ids = drawn;
    });
    middleIds.ids = ['overview.view', 'diff.view', 'diff.whole'];
    expect(showMiddle('fd', 'diff.whole')).toBe(true);
    expect(panels.get('fd').middle).toBe(2);
    expect(panels.get('bat').middle).toBe(0);
    expect(showMiddle('fd', 'timeline.view')).toBe(false);
    expect(panels.get('fd').middle).toBe(2);
    expect(showMiddle('fd', 'diff.view')).toBe(true);
    expect(panels.get('fd')).toEqual({ leftOpen: true, middle: 1 });
  });
});
