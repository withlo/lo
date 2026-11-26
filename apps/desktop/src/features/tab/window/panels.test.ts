// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FIRST_LAYOUT } from '../contract.ts';
import { layout, row, viewCounts } from './layout.ts';
import {
  bringView,
  middleIds,
  middleOf,
  panels,
  rightIds,
  rightPanel,
  showRightView,
  stepAmong,
  toggleRight,
  viewsOf,
} from './panels.ts';
import { putRight, rightKept, rightShown } from './shared.ts';
import { setRowSizes } from './sizes.testing.ts';

describe('stepping through the middle views', () => {
  // The overview, the diff, a file whole, which has no label, and a fourth view.
  const labeled = [true, true, false, true];

  it('goes to the next or previous view the switch lists, round the ends', () => {
    expect(stepAmong(0, 1, labeled)).toBe(1);
    expect(stepAmong(1, 1, labeled)).toBe(3);
    expect(stepAmong(3, 1, labeled)).toBe(0);
    expect(stepAmong(0, -1, labeled)).toBe(3);
    expect(stepAmong(3, -1, labeled)).toBe(1);
  });

  it('goes from a view with no label to the next or previous one with', () => {
    expect(stepAmong(2, 1, labeled)).toBe(3);
    expect(stepAmong(2, -1, labeled)).toBe(1);
  });

  it('stays where it is with no other view to go to', () => {
    expect(stepAmong(0, 1, [true, false])).toBe(0);
    expect(stepAmong(0, -1, [])).toBe(0);
  });
});

describe('the view a tab opens on', () => {
  const ids = ['overview.view', 'diff.view', 'diff.whole', 'timeline.view'];

  it('is the one Settings names, once it’s known', () => {
    expect(middleOf(undefined, ids, undefined)).toBeUndefined();
    expect(middleOf(undefined, ids, 'overview')).toBe('overview.view');
    expect(middleOf(undefined, ids, 'timeline')).toBe('timeline.view');
    expect(middleOf(undefined, ids, 'diff')).toBe('diff.view');
  });

  it('is the timeline in place of the overview while overviews are off', () => {
    const without = ids.filter((id) => id !== 'overview.view');
    expect(middleOf(undefined, without, 'overview')).toBe('timeline.view');
    expect(middleOf(undefined, without, 'diff')).toBe('diff.view');
    // One the tab showed that's gone shows as the timeline too, until it's back.
    expect(middleOf('overview.view', without, 'diff')).toBe('timeline.view');
    expect(middleOf('overview.view', ids, 'diff')).toBe('overview.view');
    // With no timeline either, the first there is.
    expect(middleOf(undefined, ['diff.view', 'diff.whole'], 'overview')).toBe('diff.view');
  });

  it('gives way to the one the tab shows, whatever Settings says after', () => {
    expect(middleOf('diff.whole', ids, 'overview')).toBe('diff.whole');
    expect(middleOf('diff.view', ids, undefined)).toBe('diff.view');
  });
});

/** Whether the right panel is open in the window's layout, and takes focus as it's next drawn. */
const right = () => ({ open: layout.getState().threads.open, focus: rightPanel.getState().focus });

describe('the right panel’s views', () => {
  beforeAll(() => {
    setRowSizes();
  });

  beforeEach(() => {
    viewCounts.right = 2;
  });

  afterEach(() => {
    rightPanel.setState({ focus: false });
    layout.setState(FIRST_LAYOUT, true);
    row.setState({}, true);
    rightIds.splice(0, Infinity);
    viewCounts.right = 0;
  });

  it('shows the threads first, another view once asked, and that one again as it opens', () => {
    rightIds.push('comments.panel', 'code.references');
    expect(rightShown('t1')).toBeUndefined();
    toggleRight();
    expect(rightShown('t1')).toBe('comments.panel');
    toggleRight();
    showRightView('t1', 'code.references');
    expect(right()).toEqual({ open: true, focus: true });
    expect(rightShown('t1')).toBe('code.references');
    // Another tab shows its own.
    expect(rightShown('t2')).toBe('comments.panel');
    // Closed and opened again, it shows the view shown last.
    toggleRight();
    expect(rightShown('t1')).toBeUndefined();
    toggleRight();
    expect(rightShown('t1')).toBe('code.references');
    expect(panels.get('t1').right).toBe('code.references');
  });

  it('shows a view without taking focus when asked, and closes with none', () => {
    rightIds.push('comments.panel', 'code.references');
    showRightView('t1', 'comments.panel', false);
    expect(right()).toEqual({ open: true, focus: false });
    showRightView('t1', undefined);
    expect(right().open).toBe(false);
  });

  it('goes back to how it stood: closed, on the threads, which it opens on next', () => {
    rightIds.push('comments.panel', 'code.references');
    const before = rightKept('t3');
    expect(before).toEqual({ open: false, right: undefined });
    showRightView('t3', 'code.references');
    putRight('t3', before);
    expect(right().open).toBe(false);
    toggleRight();
    expect(rightShown('t3')).toBe('comments.panel');
    // Or open on what it showed.
    showRightView('t3', 'code.references');
    putRight('t3', { open: true, right: undefined });
    expect(right()).toEqual({ open: true, focus: false });
    expect(rightShown('t3')).toBe('comments.panel');
  });

  it('opens too cramped to be drawn without taking focus as the window widens later', () => {
    rightIds.push('comments.panel', 'code.references');
    row.setState({ width: 600 });
    showRightView('t5', 'code.references');
    expect(right()).toEqual({ open: true, focus: false });
    row.setState({ width: 1440 });
    showRightView('t5', 'comments.panel');
    expect(right()).toEqual({ open: true, focus: true });
  });

  it('takes focus at once, asked to show the view it’s drawn on already', () => {
    rightIds.push('comments.panel', 'code.references');
    const aside = document.createElement('aside');
    aside.dataset.loRight = 'code.references';
    const list = document.createElement('div');
    list.dataset.loScope = 'references';
    list.tabIndex = 0;
    aside.append(list);
    document.body.append(aside);
    showRightView('t4', 'code.references');
    // Drawn, it took focus then; the reader went back to the code.
    rightPanel.setState({ focus: false });
    expect(document.activeElement).not.toBe(list);
    showRightView('t4', 'code.references');
    expect(document.activeElement).toBe(list);
    expect(rightPanel.getState().focus).toBe(false);
    aside.remove();
  });
});

describe('code beside', () => {
  // The overview, which tab `none` has nothing in, the diff, a file whole, and the timeline.
  const views = {
    ids: ['overview.view', 'diff.view', 'diff.whole', 'timeline.view'],
    labeled: [true, true, false, true],
    kinds: ['reading', 'code', 'code', 'reading'] as const,
    empty: [(tab: string) => tab === 'none', undefined, undefined, undefined],
  };

  afterEach(() => {
    panels.set('t1', {});
    Object.assign(middleIds, { ids: [], labeled: [], kinds: [], empty: [] });
  });

  it('puts the diff beside the reading view the tab shows, which keeps focus', () => {
    expect(viewsOf('t1', { middle: 'timeline.view' }, 'overview', true, views)).toEqual({
      beside: true,
      reading: 'timeline.view',
      code: 'diff.view',
      focus: 'reading',
    });
    // Off, the tab shows its one view.
    expect(viewsOf('t1', { middle: 'timeline.view' }, 'overview', false, views)).toEqual({
      beside: false,
      single: 'timeline.view',
    });
  });

  it('brings, beside the code, the reading view the tab showed last, else Settings’, else one with something to show', () => {
    const fromDiff = { middle: 'diff.view' };
    expect(
      viewsOf('t1', { ...fromDiff, reading: 'timeline.view' }, 'overview', true, views),
    ).toEqual({ beside: true, reading: 'timeline.view', code: 'diff.view', focus: 'code' });
    expect(viewsOf('t1', fromDiff, 'timeline', true, views)).toMatchObject({
      reading: 'timeline.view',
    });
    // Settings naming an overview the pull request doesn't have: the timeline.
    expect(viewsOf('none', fromDiff, 'overview', true, views)).toMatchObject({
      reading: 'timeline.view',
    });
    // Settings naming the diff: the overview where the pull request has one, else the timeline.
    expect(viewsOf('t1', fromDiff, 'diff', true, views)).toMatchObject({
      reading: 'overview.view',
    });
    expect(viewsOf('none', fromDiff, 'diff', true, views)).toMatchObject({
      reading: 'timeline.view',
    });
    // A file whole keeps the code's place.
    expect(viewsOf('t1', { middle: 'diff.whole' }, 'overview', true, views)).toMatchObject({
      reading: 'overview.view',
      code: 'diff.whole',
      focus: 'code',
    });
  });

  it('brings a view into its sheet, focus staying where it was, and alone shows it', () => {
    Object.assign(middleIds, views);
    panels.set('t1', { middle: 'overview.view' });
    // The timeline takes the overview's place, and its focus.
    bringView('t1', 'timeline.view', true);
    expect(panels.get('t1')).toMatchObject({ middle: 'timeline.view', reading: 'timeline.view' });
    // A file whole takes the diff's, focus staying on the timeline.
    bringView('t1', 'diff.whole', true);
    expect(panels.get('t1')).toMatchObject({ middle: 'timeline.view', code: 'diff.whole' });
    expect(viewsOf('t1', panels.get('t1'), 'overview', true)).toMatchObject({
      reading: 'timeline.view',
      code: 'diff.whole',
    });
    // Alone, the view brought is the one on screen.
    bringView('t1', 'diff.view', false);
    expect(panels.get('t1').middle).toBe('diff.view');
  });
});
