// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { panels, rightIds, rightPanel, showRightView, stepAmong, toggleRight } from './panels.ts';
import { putRight, rightKept, rightShown } from './shared.ts';

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

describe('the right panel’s views', () => {
  afterEach(() => {
    rightPanel.setState({ open: false, focus: false });
    rightIds.splice(0, Infinity);
  });

  it('shows the threads first, another view once asked, and that one again as it opens', () => {
    rightIds.push('comments.panel', 'code.references');
    expect(rightShown('t1')).toBeUndefined();
    toggleRight();
    expect(rightShown('t1')).toBe('comments.panel');
    toggleRight();
    showRightView('t1', 'code.references');
    expect(rightPanel.getState()).toEqual({ open: true, focus: true });
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
    expect(rightPanel.getState()).toEqual({ open: true, focus: false });
    showRightView('t1', undefined);
    expect(rightPanel.getState().open).toBe(false);
  });

  it('goes back to how it stood: closed, on the threads, which it opens on next', () => {
    rightIds.push('comments.panel', 'code.references');
    const before = rightKept('t3');
    expect(before).toEqual({ open: false, right: undefined });
    showRightView('t3', 'code.references');
    putRight('t3', before);
    expect(rightPanel.getState().open).toBe(false);
    toggleRight();
    expect(rightShown('t3')).toBe('comments.panel');
    // Or open on what it showed.
    showRightView('t3', 'code.references');
    putRight('t3', { open: true, right: undefined });
    expect(rightPanel.getState()).toEqual({ open: true, focus: false });
    expect(rightShown('t3')).toBe('comments.panel');
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
