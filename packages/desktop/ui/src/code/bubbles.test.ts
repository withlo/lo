// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';

import type { ThreadMark, ThreadView } from './api.ts';
import { bubbleElement, bubbleOf, rangeTone, Tones } from './bubbles.ts';

/** A thread under new line 35 of file `a`, marked as `mark` says. */
function marked(id: string, mark: Partial<ThreadMark> = {}): ThreadView {
  return {
    id,
    at: { file: 'a', side: 'new', line: 35 },
    open: true,
    version: 1,
    mark: { resolved: false, words: { lines: 'lines 10–35', line: 'line 35' }, ...mark },
  };
}

describe('a thread’s bubble', () => {
  test('says what one thread is, by its icon, its colour and its name', () => {
    expect(bubbleOf([marked('a')])).toEqual({
      icon: 'message-square',
      tone: 'warn',
      name: 'Unresolved thread · lines 10–35',
      thread: 'a',
    });
    expect(bubbleOf([marked('a', { resolved: true })])).toMatchObject({
      icon: 'message-square-check',
      tone: 'quiet',
      name: 'Resolved thread · lines 10–35',
    });
  });

  test('holding comments not yet sent, it has the dot, in the thread’s colour, amber when all are', () => {
    expect(bubbleOf([marked('a', { pending: 'all' })])).toMatchObject({
      icon: 'message-square-dot',
      tone: 'warn',
      name: 'Pending thread · lines 10–35',
    });
    expect(bubbleOf([marked('a', { resolved: true, pending: 'some' })])).toMatchObject({
      icon: 'message-square-dot',
      tone: 'quiet',
    });
  });

  test('out of date, it keeps its state’s icon in grey, and says its revision', () => {
    const words = { lines: 'line 9 · r1', line: 'line 9 · r1' };
    expect(bubbleOf([marked('a', { outdated: true, words })])).toEqual({
      icon: 'message-square',
      tone: 'quiet',
      name: 'Unresolved thread · line 9 · r1',
      thread: 'a',
    });
  });

  test('several on a line are one bubble, amber while any is unresolved, with no digits', () => {
    const two = [marked('a', { resolved: true }), marked('b')];
    expect(bubbleOf(two)).toEqual({
      icon: 'messages-square',
      tone: 'warn',
      name: '2 threads · line 35 · 1 unresolved',
      thread: 'a',
    });
    const resolved = [marked('a', { resolved: true }), marked('b', { resolved: true })];
    expect(bubbleOf(resolved)).toMatchObject({ tone: 'quiet', name: '2 threads · line 35' });
  });

  test('a thread the caller says nothing of is unresolved, on its line alone', () => {
    const plain: ThreadView = {
      id: 'a',
      at: { file: 'a', side: 'new', line: 3 },
      open: true,
      version: 1,
    };
    expect(bubbleOf([plain])).toMatchObject({ icon: 'message-square', tone: 'warn' });
    expect(rangeTone(plain)).toBe('warn');
  });

  test('a bracket is amber while its thread is unresolved or pending, and grey otherwise', () => {
    expect(rangeTone(marked('a'))).toBe('warn');
    expect(rangeTone(marked('a', { resolved: true }))).toBe('quiet');
    expect(rangeTone(marked('a', { resolved: true, pending: 'some' }))).toBe('warn');
    expect(rangeTone(marked('a', { outdated: true }))).toBe('quiet');
  });

  test('is a button for its first thread, which says whether it’s open, and no stop for Tab', () => {
    const control = bubbleElement(bubbleOf([marked('a')]), {
      open: true,
      className: 'lo-lanebubble',
    });
    expect(control.getAttribute('role')).toBe('button');
    expect(control.getAttribute('aria-label')).toBe('Unresolved thread · lines 10–35');
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(control.dataset.command).toBe('diff.toggleThread');
    expect(control.dataset.thread).toBe('a');
    expect(control.dataset.tip).toBe('Collapse thread');
    expect(control.tabIndex).toBe(-1);
    expect(control.querySelector('svg.lo-i--sm')).not.toBeNull();
    const closed = bubbleElement(bubbleOf([marked('a')]), {
      open: false,
      className: 'lo-lanebubble',
      command: false,
    });
    expect(closed.getAttribute('aria-expanded')).toBe('false');
    expect(closed.dataset.tip).toBe('Expand thread');
    expect(closed.dataset.command).toBeUndefined();
  });

  test('changing state, it tints from the colour it had to its own once it’s drawn', async () => {
    const tones = new Tones();
    expect(tones.was('a', 'warn')).toBeUndefined();
    expect(tones.was('a', 'warn')).toBeUndefined();
    expect(tones.was('a', 'quiet')).toBe('warn');
    const control = bubbleElement(bubbleOf([marked('a', { resolved: true })]), {
      open: false,
      className: 'lo-lanebubble',
      was: 'warn',
    });
    expect(control.classList.contains('lo-bubble--warn')).toBe(true);
    expect(control.classList.contains('move-tint')).toBe(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(control.classList.contains('lo-bubble--quiet')).toBe(true);
    expect(control.classList.contains('lo-bubble--warn')).toBe(false);
  });
});
