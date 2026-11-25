// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { drawnRow, layout, resettable, resetWidth, row, steppable, stepWidth } from './layout.ts';

const both = { left: true, threads: true };

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

afterEach(() => {
  document.body.innerHTML = '';
  layout.setState({ left: undefined }, true);
  row.setState({ width: undefined, stepped: undefined }, true);
});

/** Draws the left panel with a row in it, and gives the row focus if `focused`. */
function leftPanel(focused: boolean): void {
  document.body.innerHTML =
    '<aside data-lo-left><button id="row">a.ts</button></aside><main></main>';
  if (focused) document.getElementById('row')?.focus();
}

describe('the keys that size what has focus', () => {
  it('widen and narrow the left panel by a step while focus is in it, and draw its edge pressed', () => {
    leftPanel(true);
    row.setState({ width: 1440 });
    stepWidth(both, 1);
    expect(layout.getState().left).toBe(332);
    expect(row.getState().stepped).toBe('left');
    window.dispatchEvent(new KeyboardEvent('keyup', { key: '>' }));
    expect(row.getState().stepped).toBeUndefined();
    stepWidth(both, -1);
    stepWidth(both, -1);
    expect(layout.getState().left).toBe(268);
  });

  it('stop at the panel’s limits, and at the views’ minimum, then refuse with nothing to say', () => {
    leftPanel(true);
    row.setState({ width: 1440 });
    layout.setState({ left: 470 });
    expect(steppable(both, 1)).toBe(true);
    stepWidth(both, 1);
    expect(layout.getState().left).toBe(480);
    expect(steppable(both, 1)).toBe('');
    // In 1000 px beside the threads panel, which gives first, the view keeps 340.
    row.setState({ width: 1000 });
    expect(drawnRow(both)).toMatchObject({ left: 380, threads: 280, views: [340] });
    expect(steppable(both, 1)).toBe('');
    layout.setState({ left: 230 });
    stepWidth(both, -1);
    expect(layout.getState().left).toBe(220);
    expect(steppable(both, -1)).toBe('');
  });

  it('put a width back to the default, and refuse once it is', () => {
    leftPanel(true);
    layout.setState({ left: 400 });
    expect(resettable(both)).toBe(true);
    resetWidth(both);
    expect(layout.getState().left).toBeUndefined();
    expect(drawnRow(both).left).toBe(300);
    expect(resettable(both)).toBe('');
  });

  it('refuse with nothing to say where what has focus has no edge', () => {
    leftPanel(false);
    expect(steppable(both, 1)).toBe('');
    expect(steppable(both, -1)).toBe('');
    layout.setState({ left: 400 });
    expect(resettable(both)).toBe('');
    stepWidth(both, 1);
    expect(layout.getState().left).toBe(400);
  });
});

describe('the left panel’s width', () => {
  it('is a drag’s while one is under way, and the window’s, unchanged, once it’s over', () => {
    row.setState({ width: 1440 });
    layout.setState({ left: 360 });
    row.setState({ drag: { left: 420, closing: false } });
    expect(drawnRow(both).left).toBe(420);
    expect(layout.getState().left).toBe(360);
    row.setState({ drag: undefined });
    expect(drawnRow(both).left).toBe(360);
  });
});
