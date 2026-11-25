// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FIRST_LAYOUT, type WindowLayout } from '../contract.ts';
import {
  drawable,
  drawnRow,
  firstLayout,
  keepLayout,
  layout,
  loadLayout,
  panelDrawn,
  resetLayout,
  resettable,
  resetWidth,
  row,
  steppable,
  stepWidth,
  togglePanel,
  viewCounts,
} from './layout.ts';

/** What the window asked main to keep, in turn, and the layout main hands it. */
const kept: WindowLayout[] = [];
let fromMain: WindowLayout = FIRST_LAYOUT;
vi.mock('./main.ts', () => ({
  main: () => ({
    layout: () => Promise.resolve(fromMain),
    keepLayout: (value: WindowLayout) => {
      kept.push(value);
      return Promise.resolve();
    },
  }),
}));

beforeAll(() => {
  // The tokens' sizes, as the design system's stylesheet sets them on the page.
  const sizes = {
    'panel-left-w': '300px',
    'panel-left-min-w': '220px',
    'panel-left-max-w': '480px',
    'panel-right-w': '340px',
    'panel-right-min-w': '280px',
    'panel-right-max-w': '560px',
    'view-min-w': '340px',
    'timeline-w': '856px',
    'sp-24': '24px',
    'splitter-w': '8px',
  };
  for (const [name, value] of Object.entries(sizes)) {
    document.documentElement.style.setProperty(`--lo-${name}`, value);
  }
});

/** Both panels open, the left at `left` wide if given. */
const both = (left?: number): WindowLayout => ({
  left: left === undefined ? { open: true } : { open: true, width: left },
  threads: { open: true },
});

beforeEach(() => {
  viewCounts.left = 2;
  viewCounts.right = 1;
});

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-lo-resizing');
  layout.setState(FIRST_LAYOUT, true);
  row.setState({}, true);
  kept.splice(0);
  fromMain = FIRST_LAYOUT;
});

/** Draws both panels with a row in each, and gives `focused`'s focus. */
function panels(focused: 'left' | 'threads' | undefined): void {
  document.body.innerHTML =
    '<aside data-lo-left><button id="left">a.ts</button></aside><main></main>' +
    '<aside data-lo-right="comments.panel"><button id="threads">Thread</button></aside>';
  if (focused) document.getElementById(focused)?.focus();
}

describe('the keys that size what has focus', () => {
  it('widen and narrow the panel focus is in by a step, and draw its edge pressed', () => {
    panels('left');
    layout.setState(both());
    row.setState({ width: 1440 });
    stepWidth(1);
    expect(layout.getState().left.width).toBe(332);
    expect(row.getState().stepped).toBe('left');
    window.dispatchEvent(new KeyboardEvent('keyup', { key: '>' }));
    expect(row.getState().stepped).toBeUndefined();
    stepWidth(-1);
    stepWidth(-1);
    expect(layout.getState().left.width).toBe(268);

    document.getElementById('threads')?.focus();
    stepWidth(1);
    expect(layout.getState().threads.width).toBe(372);
    expect(row.getState().stepped).toBe('threads');
  });

  it('stop at the panel’s limits, and at the view’s minimum, then refuse with nothing to say', () => {
    panels('left');
    row.setState({ width: 1440 });
    layout.setState({ left: { open: true, width: 470 } });
    expect(steppable(1)).toBe(true);
    stepWidth(1);
    expect(layout.getState().left.width).toBe(480);
    expect(steppable(1)).toBe('');
    // In 1000 px beside the threads panel, which gives first, the view keeps 340.
    layout.setState(both(480));
    row.setState({ width: 1000 });
    expect(drawnRow()).toMatchObject({ left: 380, threads: 280, views: [340] });
    expect(steppable(1)).toBe('');
    layout.setState({ left: { open: true, width: 230 } });
    stepWidth(-1);
    expect(layout.getState().left.width).toBe(220);
    expect(steppable(-1)).toBe('');
  });

  it('put a width back to the default, and refuse once it is', () => {
    panels('left');
    layout.setState({ left: { open: true, width: 400 } });
    expect(resettable()).toBe(true);
    resetWidth();
    expect(layout.getState().left.width).toBeUndefined();
    expect(drawnRow().left).toBe(300);
    expect(resettable()).toBe('');
  });

  it('refuse with nothing to say where what has focus has no edge', () => {
    panels(undefined);
    expect(steppable(1)).toBe('');
    expect(steppable(-1)).toBe('');
    layout.setState({ left: { open: true, width: 400 } });
    expect(resettable()).toBe('');
    stepWidth(1);
    expect(layout.getState().left.width).toBe(400);
  });

  it('refuse while an edge is dragged, so `Esc` puts back the width the drag found', () => {
    panels('left');
    layout.setState({ left: { open: true, width: 400 } });
    document.documentElement.dataset.loResizing = 'col';
    expect(steppable(1)).toBe('');
    expect(resettable()).toBe('');
    stepWidth(1);
    resetWidth();
    expect(layout.getState().left.width).toBe(400);
  });
});

describe('the panels', () => {
  it('draw a drag’s width while it’s under way, and the layout’s, unchanged, once it’s over', () => {
    row.setState({ width: 1440 });
    layout.setState(both(360));
    row.setState({ drag: { edge: 'left', width: 420, closing: false } });
    expect(drawnRow().left).toBe(420);
    expect(layout.getState().left.width).toBe(360);
    row.setState({ drag: undefined });
    expect(drawnRow().left).toBe(360);
  });

  it('put away the threads panel first, and the left before the one asked for last', () => {
    layout.setState(both());
    row.setState({ width: 720 });
    expect(drawnRow()).toMatchObject({ left: 300, threads: undefined, views: [420] });
    expect(panelDrawn('threads')).toBe(false);
    // Pressed, the threads panel is asked for, and the left panel gives way.
    togglePanel('threads');
    expect(layout.getState()).toEqual(both());
    expect(drawnRow()).toMatchObject({ left: undefined, threads: 340, views: [380] });
    // Each comes back as soon as there's room.
    row.setState({ width: 1440 });
    expect(drawnRow()).toMatchObject({ left: 300, threads: 340, views: [800] });
    // Drawn, pressing it closes it.
    togglePanel('threads');
    expect(layout.getState().threads.open).toBe(false);
  });

  it('say to widen the window where one can’t be drawn beside a view at its minimum', () => {
    layout.setState({ left: { open: false }, threads: { open: false } });
    row.setState({ width: 600 });
    expect(drawable('left')).toBe(true);
    expect(drawable('threads')).toBe('Widen the window first');
    togglePanel('left');
    expect(panelDrawn('left')).toBe(true);
    row.setState({ width: 540 });
    expect(panelDrawn('left')).toBe(false);
    expect(drawable('left')).toBe('Widen the window first');
  });

  it('aren’t there in a tab with no views for them', () => {
    viewCounts.left = 0;
    layout.setState(both());
    row.setState({ width: 1440 });
    expect(drawnRow()).toMatchObject({ left: undefined, threads: 340 });
  });
});

describe('the window’s layout', () => {
  it('goes back to the first layout, and has nothing to put back once it has', () => {
    panels('threads');
    layout.setState({ left: { open: false, width: 400 }, threads: { open: true, width: 500 } });
    row.setState({ asked: 'threads' });
    expect(firstLayout()).toBe(false);
    resetLayout();
    expect(layout.getState()).toEqual(FIRST_LAYOUT);
    expect(row.getState().asked).toBeUndefined();
    expect(firstLayout()).toBe(true);
  });

  it('is main’s as the window starts, and main keeps each change after, but not what it sent', async () => {
    fromMain = { left: { open: false, width: 260 }, threads: { open: true } };
    await loadLayout();
    expect(layout.getState()).toEqual(fromMain);
    const stop = keepLayout();
    layout.setState(fromMain, true);
    expect(kept).toEqual([]);
    togglePanel('left');
    expect(kept).toEqual([{ left: { open: true, width: 260 }, threads: { open: true } }]);
    stop();
  });
});
