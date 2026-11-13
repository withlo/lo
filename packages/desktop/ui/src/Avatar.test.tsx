// @vitest-environment jsdom
// An avatar's initials, and its picture: the initials until it has loaded, and for good if it can't.

import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

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

  it('keeps the initials while the picture loads, then shows the picture in their place', () => {
    const host = render(<Avatar login="mira-chen" image="lo-image://avatar/mira-chen?s=56" />);
    expect(host.textContent).toBe('MC');
    const img = picture(host);
    expect(img?.getAttribute('src')).toBe('lo-image://avatar/mira-chen?s=56');
    // The picture is decoration beside the login, so it has no description of its own.
    expect(img?.getAttribute('alt')).toBe('');

    happens(img!, 'load');
    expect(host.textContent).toBe('');
    expect(picture(host)).not.toBeNull();
  });

  it('keeps the initials, and drops the picture, when it fails', () => {
    const host = render(<Avatar login="mira-chen" image="lo-image://avatar/mira-chen?s=56" />);
    happens(picture(host)!, 'error');
    expect(host.textContent).toBe('MC');
    expect(picture(host)).toBeNull();
  });

  it('starts again from the initials when the picture changes', () => {
    const host = render(<Avatar login="mira-chen" image="lo-image://avatar/mira-chen?s=56" />);
    happens(picture(host)!, 'error');
    expect(picture(host)).toBeNull();
    rerender(host, <Avatar login="mira-chen" image="lo-image://avatar/mira-chen?s=84" />);
    expect(host.textContent).toBe('MC');
    expect(picture(host)?.getAttribute('src')).toBe('lo-image://avatar/mira-chen?s=84');
  });
});
