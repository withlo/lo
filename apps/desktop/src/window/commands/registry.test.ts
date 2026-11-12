// @vitest-environment jsdom
import type { Entry } from '@lo/ui/commands';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { escapeToMiddle, focusMiddle, here, setMiddle, type Middle } from './registry.ts';

const taken: (() => void)[] = [];

afterEach(() => {
  for (const takeBack of taken.splice(0)) takeBack();
  document.body.replaceChildren();
});

/** A middle view that records where focus was asked for, and is at `entry`. */
function view(entry?: Entry): Middle & { focus: ReturnType<typeof vi.fn<() => void>> } {
  return { focus: vi.fn<() => void>(), here: () => entry };
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
    const closing = { ...view(), escape: vi.fn<() => boolean>(() => open-- > 0) };
    taken.push(setMiddle(closing));
    escapeToMiddle();
    expect(closing.escape).toHaveBeenCalledOnce();
    expect(closing.focus).not.toHaveBeenCalled();
    escapeToMiddle();
    expect(closing.focus).toHaveBeenCalledOnce();
    // A view with nothing of its own to close just has focus back.
    const plain = view();
    taken.push(setMiddle(plain));
    escapeToMiddle();
    expect(plain.focus).toHaveBeenCalledOnce();
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
    focusMiddle();
    expect(document.activeElement).toBe(element);
    expect(here()).toBeUndefined();
  });
});
