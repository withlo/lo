// @vitest-environment jsdom
import type { Entry, View } from '@lo/ui/commands';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  canEscape,
  escapeToMiddle,
  focusMiddle,
  focusMiddleIn,
  here,
  inCodeOf,
  setMiddle,
  type Middle,
} from './registry.ts';

const taken: (() => void)[] = [];

afterEach(() => {
  for (const takeBack of taken.splice(0)) takeBack();
  document.body.replaceChildren();
});

/**
 * A middle view that records where focus was asked for, and is at `entry`: its focus goes to
 * `home`, if given.
 */
function view(
  entry?: Entry,
  home?: Element,
): Middle & { focus: ReturnType<typeof vi.fn<() => void>> } {
  return { focus: vi.fn<() => void>(), holds: (element) => element === home, here: () => entry };
}

describe('the middle view', () => {
  it('is the newest, and the one it covered is the middle again when it goes', () => {
    const under = view();
    const over = view();
    taken.push(setMiddle(under));
    const takeBack = setMiddle(over);
    focusMiddle();
    expect(over.focus).toHaveBeenCalledOnce();
    expect(under.focus).not.toHaveBeenCalled();
    takeBack();
    focusMiddle();
    expect(under.focus).toHaveBeenCalledOnce();
  });

  it('stays the same when the view under it goes first', () => {
    const under = view();
    const over = view();
    const takeUnder = setMiddle(under);
    taken.push(setMiddle(over));
    takeUnder();
    focusMiddle();
    expect(over.focus).toHaveBeenCalledOnce();
    expect(under.focus).not.toHaveBeenCalled();
  });

  it('says where the tab is in the newest', () => {
    const entry: Entry = { view: 'diff', at: { kind: 'none' } };
    taken.push(setMiddle(view()));
    expect(here()).toBeUndefined();
    taken.push(setMiddle(view(entry)));
    expect(here()).toBe(entry);
  });

  it('takes Esc first, closing what it has open, and else has focus back', () => {
    let open = 1;
    const close = vi.fn<() => void>(() => {
      open -= 1;
    });
    const closing = { ...view(), escape: () => (open > 0 ? close : undefined) };
    taken.push(setMiddle(closing));
    escapeToMiddle();
    expect(close).toHaveBeenCalledOnce();
    expect(closing.focus).not.toHaveBeenCalled();
    escapeToMiddle();
    expect(close).toHaveBeenCalledOnce();
    expect(closing.focus).toHaveBeenCalledOnce();
    // A view with nothing of its own to close just has focus back.
    const plain = view();
    taken.push(setMiddle(plain));
    escapeToMiddle();
    expect(plain.focus).toHaveBeenCalledOnce();
  });

  it('says Esc has nowhere to go with focus already where the view puts it, and nothing open', () => {
    const list = document.createElement('div');
    const field = document.createElement('input');
    document.body.append(list, field);
    let open = false;
    const close = vi.fn<() => void>();
    const recent = { ...view(undefined, list), escape: () => (open ? close : undefined) };
    taken.push(setMiddle(recent));
    expect(canEscape(list)).toBe(false);
    // From elsewhere, it gives focus back; and with something open, it closes it, asking nothing.
    expect(canEscape(field)).toBe(true);
    expect(canEscape(document.body)).toBe(true);
    expect(canEscape(null)).toBe(true);
    open = true;
    expect(canEscape(list)).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });

  it('knows a code view’s text by its scope, and a field or a control in it as neither', () => {
    const scope = document.createElement('div');
    scope.setAttribute('data-lo-scope', 'diff');
    const text = document.createElement('div');
    text.setAttribute('contenteditable', 'true');
    const card = document.createElement('div');
    card.setAttribute('contenteditable', 'false');
    const button = document.createElement('button');
    card.append(button);
    const field = document.createElement('input');
    text.append(card);
    scope.append(text, field);
    document.body.append(scope);
    expect(inCodeOf(text, 'diff')).toBe(true);
    expect(inCodeOf(text, 'file')).toBe(false);
    expect(inCodeOf(button, 'diff')).toBe(false);
    expect(inCodeOf(field, 'diff')).toBe(false);
  });

  it('is the window’s middle element while there is no view', () => {
    const element = document.createElement('main');
    element.tabIndex = -1;
    element.setAttribute('data-lo-middle', '');
    document.body.append(element);
    const takeBack = setMiddle(view());
    takeBack();
    // Taking a view back twice changes nothing.
    takeBack();
    expect(canEscape(document.body)).toBe(true);
    focusMiddle();
    expect(document.activeElement).toBe(element);
    expect(here()).toBeUndefined();
    expect(canEscape(element)).toBe(false);
  });
});

/** A view drawn in its own box, which focus can be in. */
function drawn(name: View): { middle: Middle; box: HTMLElement; focus: () => void } {
  const box = document.createElement('div');
  box.tabIndex = -1;
  box.dataset['name'] = name;
  document.body.append(box);
  const focus = () => box.focus();
  return {
    box,
    focus,
    middle: {
      focus,
      root: () => box,
      holds: (element) => element === box,
      here: () => ({ view: name, at: { kind: 'none' } }),
    },
  };
}

describe('two middle views side by side', () => {
  it('is the one focus is in, or was in last, for Esc and history', () => {
    const reading = drawn('overview');
    const code = drawn('diff');
    taken.push(setMiddle(reading.middle), setMiddle(code.middle));
    // Focus in neither yet: the newest.
    expect(here()?.view).toBe('diff');
    reading.focus();
    expect(here()?.view).toBe('overview');
    // Focus in a panel: the view that had it last.
    const panel = document.createElement('button');
    document.body.append(panel);
    panel.focus();
    expect(here()?.view).toBe('overview');
    focusMiddle();
    expect(document.activeElement).toBe(reading.box);
    // A click in the other view gives it focus.
    expect(focusMiddleIn(code.box)).toBe(true);
    expect(document.activeElement).toBe(code.box);
    expect(here()?.view).toBe('diff');
  });
});
