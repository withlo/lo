// @vitest-environment jsdom
// An avatar's initials, and its picture: an empty disc until it has loaded, which it fades in over, and
// the initials if it can't be.

import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { cleanUp, render, rerender } from '../test/dom.ts';
import { Avatar } from './Avatar.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

function picture(host: HTMLElement): HTMLImageElement | null {
  return host.querySelector('img');
}

function happens(target: Element, type: 'load' | 'error'): void {
  act(() => {
    target.dispatchEvent(new Event(type));
  });
}

describe('Avatar', () => {
  it('draws only the initials without a picture', () => {
    const host = render(<Avatar login="mira-chen" />);
    expect(host.textContent).toBe('MC');
    expect(picture(host)).toBeNull();
  });

  it('draws an empty disc while the picture loads, then fades the picture in over it', () => {
    const host = render(<Avatar login="mira-chen" image="lo-image://avatar/mira-chen?s=24" />);
    // No initials meanwhile, and none of their hue: only the disc.
    expect(host.textContent).toBe('');
    const disc = host.firstElementChild;
    expect(disc?.className).toContain('bg-raised');
    expect(disc?.className).not.toContain('bg-avatar');
    const img = picture(host);
    expect(img?.getAttribute('src')).toBe('lo-image://avatar/mira-chen?s=24');
    expect(img?.className).toContain('opacity-0');
    // The picture is decoration beside the login, so it has no description of its own.
    expect(img?.getAttribute('alt')).toBe('');

    happens(img!, 'load');
    expect(host.textContent).toBe('');
    expect(picture(host)?.className).not.toContain('opacity-0');
    // It comes in with the Swap move, once.
    expect(picture(host)?.classList.contains('move-swap')).toBe(true);
    happens(picture(host)!, 'load');
    expect(picture(host)?.className.match(/move-swap/g)).toHaveLength(1);
  });

  it('shows a picture the window already holds from the first frame, with nothing before it, and doesn’t move it', () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    const width = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(56);
    const host = render(<Avatar login="mira-chen" image="lo-image://avatar/mira-chen?s=56" />);
    expect(host.textContent).toBe('');
    expect(picture(host)?.className).not.toContain('opacity-0');
    // The load the browser still announces for it starts no move.
    happens(picture(host)!, 'load');
    expect(picture(host)?.classList.contains('move-swap')).toBe(false);
    complete.mockRestore();
    width.mockRestore();
  });

  it('brings back a picture the window drew before as it loads, without the move', () => {
    const address = 'lo-image://avatar/mira-chen?s=40';
    const first = render(<Avatar login="mira-chen" image={address} />);
    happens(picture(first)!, 'load');
    expect(picture(first)?.classList.contains('move-swap')).toBe(true);
    // Drawn again, as a card is when its thread collapses: its picture still has to load.
    const again = render(<Avatar login="mira-chen" image={address} />);
    expect(picture(again)?.className).toContain('opacity-0');
    happens(picture(again)!, 'load');
    expect(picture(again)?.className).not.toContain('opacity-0');
    expect(picture(again)?.classList.contains('move-swap')).toBe(false);
  });

  it('draws the initials, in their hue, and drops the picture, when it fails', () => {
    const host = render(<Avatar login="mira-chen" image="lo-image://avatar/mira-chen?s=56" />);
    happens(picture(host)!, 'error');
    expect(host.textContent).toBe('MC');
    expect(host.firstElementChild?.className).toContain('bg-avatar');
    expect(picture(host)).toBeNull();
  });

  it('starts again from an empty disc when the picture changes', () => {
    const host = render(<Avatar login="mira-chen" image="lo-image://avatar/mira-chen?s=56" />);
    happens(picture(host)!, 'error');
    expect(picture(host)).toBeNull();
    rerender(host, <Avatar login="mira-chen" image="lo-image://avatar/mira-chen?s=84" />);
    expect(host.textContent).toBe('');
    expect(picture(host)?.getAttribute('src')).toBe('lo-image://avatar/mira-chen?s=84');
  });
});
