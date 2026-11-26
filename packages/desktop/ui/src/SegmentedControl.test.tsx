// @vitest-environment jsdom
// A segmented control dimmed with a reason, and the Files panel's switch on it: the reason on each
// segment while it can't be changed, the key only while it can, focus kept as it's dimmed and
// undimmed, and a click or an arrow choosing.

import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { cleanUp, click, press, render, rerender, tipOf } from '../test/dom.ts';
import { FileTreePanel } from './FileTree.tsx';
import { SegmentedControl } from './SegmentedControl.tsx';

const ITEMS = [
  { value: 'tree', label: 'Tree' },
  { value: 'review', label: 'Review order' },
] as const;

function markup(disabled: boolean): string {
  return renderToStaticMarkup(
    <SegmentedControl
      label="File list"
      kind="views"
      size="sm"
      items={ITEMS}
      value="tree"
      onChange={() => {}}
      keys={['t']}
      disabled={disabled}
      why="Reading files…"
    />,
  );
}

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
  vi.useRealTimers();
});

describe('SegmentedControl', () => {
  it('says why on each segment while it can’t be changed, and keeps the one chosen marked', () => {
    const segments = markup(true).split('<button').slice(1);
    expect(segments).toHaveLength(2);
    for (const segment of segments) {
      expect(segment).toContain('aria-disabled="true"');
      expect(segment).toContain('aria-description="Reading files…"');
      expect(segment).not.toMatch(/\sdisabled=""/);
    }
    expect(segments[0]).toContain('aria-selected="true"');
    expect(segments[0]).toContain('tabindex="0"');
  });

  it('says no reason while it can be changed', () => {
    const html = markup(false);
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('aria-description');
  });

  it('shows its key only while it can be changed, keeping the key’s room', () => {
    expect(markup(false)).toMatch(/<kbd(?![^>]*invisible)[^>]*>t<\/kbd>/);
    expect(markup(true)).toMatch(/<kbd[^>]*invisible[^>]*>t<\/kbd>/);
  });
  it('marks every view on screen current, and a click on one that is gives it focus', () => {
    const views = [
      { value: 'overview', label: 'Overview' },
      { value: 'diff', label: 'Diff' },
      { value: 'timeline', label: 'Timeline' },
    ] as const;
    const chose: string[] = [];
    const host = render(
      <SegmentedControl
        label="View"
        kind="views"
        items={views}
        value="timeline"
        current={['diff', 'timeline']}
        onChange={(view) => chose.push(view)}
      />,
    );
    const marks = [...host.querySelectorAll('[role="tab"]')].map((tab) => [
      tab.textContent,
      tab.getAttribute('aria-current'),
      tab.getAttribute('aria-selected'),
    ]);
    expect(marks).toEqual([
      ['Overview', null, 'false'],
      ['Diff', 'true', 'false'],
      ['Timeline', 'true', 'true'],
    ]);
    // Both on screen take a click, the chosen one too, for focus.
    click(segment(host, 'Timeline'));
    click(segment(host, 'Diff'));
    click(segment(host, 'Overview'));
    expect(chose).toEqual(['timeline', 'diff', 'overview']);
  });
});

/** The panel with its switch, `waiting` while the files are read. */
const panel = (onMode: (mode: 'tree' | 'review') => void, waiting: boolean) => (
  <FileTreePanel mode="tree" onMode={onMode} modeKeys={['t']} changedOnly={false} waiting={waiting}>
    {null}
  </FileTreePanel>
);

/** The segment named `name` of the switch drawn in `host`. */
const segment = (host: HTMLElement, name: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (button) => button.textContent === name,
  );
  if (!found) throw new Error(`No segment ${name}`);
  return found;
};

describe('the Files panel’s switch', () => {
  it('keeps focus on its segment as it’s dimmed while the files are read, and undimmed', () => {
    const onMode = vi.fn<(mode: 'tree' | 'review') => void>();
    const host = render(panel(onMode, false));
    const tree = segment(host, 'Tree');
    act(() => tree.focus());
    rerender(host, panel(onMode, true));
    expect(document.activeElement).toBe(tree);
    expect(tipOf(tree)).toBe('Reading files…');
    // Dimmed, neither a click nor an arrow changes it.
    click(segment(host, 'Review order'));
    press(tree, 'ArrowRight');
    expect(onMode).not.toHaveBeenCalled();
    rerender(host, panel(onMode, false));
    expect(document.activeElement).toBe(tree);
    expect(tipOf(tree)).toBe(undefined);
  });

  it('chooses review order by a click or an arrow', () => {
    const onMode = vi.fn<(mode: 'tree' | 'review') => void>();
    const host = render(panel(onMode, false));
    click(segment(host, 'Review order'));
    expect(onMode).toHaveBeenLastCalledWith('review');
    const tree = segment(host, 'Tree');
    act(() => tree.focus());
    press(tree, 'ArrowRight');
    expect(onMode).toHaveBeenCalledTimes(2);
    expect(onMode).toHaveBeenLastCalledWith('review');
  });
});
