// @vitest-environment jsdom
// An avatar's initials, and its picture: an empty disc until it has loaded, which it fades in over, and
// the initials if it can't be.

import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { cleanUp, render, rerender } from '../test/dom.ts';
import { Avatar, avatarHue, redrawPictures, useReadyPicture } from './Avatar.tsx';

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

/** What keeps the picture at `address` ready, while it's drawn. */
function Ready({ address }: { address: string | undefined }) {
  useReadyPicture(address);
  return null;
}

/**
 * The images made out of the page from now, as the pictures kept ready are, with only `loaded`
 * having loaded, as far as the avatars can tell.
 */
function images(): { made: HTMLImageElement[]; loaded: Set<HTMLImageElement> } {
  const made: HTMLImageElement[] = [];
  const loaded = new Set<HTMLImageElement>();
  const Real = window.Image;
  vi.stubGlobal('Image', function Image() {
    const image = new Real();
    made.push(image);
    return image;
  });
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(function (
    this: HTMLImageElement,
  ) {
    return loaded.has(this);
  });
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(function (
    this: HTMLImageElement,
  ) {
    return loaded.has(this) ? 56 : 0;
  });
  return { made, loaded };
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
    expect(disc?.classList.contains('bg-bg-raised')).toBe(true);
    expect(disc?.classList.contains(`bg-avatar-${avatarHue('mira-chen')}-bg`)).toBe(false);
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

  it('draws a picture kept ready from its first frame, with the image loaded for it, and readies another', () => {
    const { made, loaded } = images();
    onTestFinished(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });
    const address = 'lo-image://avatar/tess-okafor?s=64';
    render(<Ready address={address} />);
    expect(made).toHaveLength(1);
    const [readied] = made;
    expect(readied?.getAttribute('src')).toBe(address);
    loaded.add(readied!);
    const host = render(<Avatar login="tess-okafor" image={address} />);
    expect(picture(host)).toBe(readied);
    expect(picture(host)?.className).not.toContain('opacity-0');
    expect(picture(host)?.getAttribute('alt')).toBe('');
    // Another is readied for the next; one drawn before it has loaded draws its own, as any does.
    expect(made).toHaveLength(2);
    const next = render(<Avatar login="tess-okafor" image={address} />);
    expect(picture(next)).not.toBe(made[1]);
    expect(picture(next)?.className).toContain('opacity-0');
  });

  it('keeps nothing ready once nothing asks', () => {
    const { made, loaded } = images();
    onTestFinished(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });
    const address = 'lo-image://avatar/tess-okafor?s=40';
    const keeper = render(<Ready address={address} />);
    loaded.add(made[0]!);
    rerender(keeper, <Ready address={undefined} />);
    const host = render(<Avatar login="tess-okafor" image={address} />);
    expect(picture(host)).not.toBe(made[0]);
    expect(picture(host)?.className).toContain('opacity-0');
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
    expect(
      host.firstElementChild?.classList.contains(`bg-avatar-${avatarHue('mira-chen')}-bg`),
    ).toBe(true);
    expect(host.firstElementChild?.classList.contains('bg-bg-raised')).toBe(false);
    expect(picture(host)).toBeNull();
  });

  it('fades in every avatar drawn with a picture new to the window, not only the first to load', () => {
    const address = 'lo-image://bot/cursor?s=48';
    const one = render(<Avatar login="cursor" image={address} />);
    const two = render(<Avatar login="cursor" image={address} />);
    happens(picture(one)!, 'load');
    happens(picture(two)!, 'load');
    expect(picture(one)?.classList.contains('move-swap')).toBe(true);
    expect(picture(two)?.classList.contains('move-swap')).toBe(true);
  });

  it('draws an avatar again from an empty disc, with the Swap, at the address it’s given anew', () => {
    const address = 'lo-image://bot/coderabbitai?s=40';
    const other = 'lo-image://avatar/mira-chen?s=48';
    const host = render(<Avatar login="coderabbitai" image={address} />);
    const beside = render(<Avatar login="mira-chen" image={other} />);
    happens(picture(host)!, 'load');
    happens(picture(beside)!, 'load');
    const untouched = picture(beside);
    act(() => {
      redrawPictures((drawn) => (drawn === address ? `${address}&r=1` : undefined));
    });
    const again = picture(host);
    expect(again?.getAttribute('src')).toBe(`${address}&r=1`);
    expect(again?.className).toContain('opacity-0');
    happens(again!, 'load');
    expect(picture(host)?.classList.contains('move-swap')).toBe(true);
    // Another address isn't drawn again.
    expect(picture(beside)).toBe(untouched);
    // An avatar drawn later with the address it had draws the new one, as drawn before.
    const later = render(<Avatar login="coderabbitai" image={address} />);
    expect(picture(later)?.getAttribute('src')).toBe(`${address}&r=1`);
    // Given the same again, nothing is drawn again.
    const now = picture(host);
    act(() => {
      redrawPictures((drawn) => (drawn === address ? `${address}&r=1` : undefined));
    });
    expect(picture(host)).toBe(now);
  });

  it('draws the initials when a redrawn address no longer loads', () => {
    const address = 'lo-image://bot/gone-bot?s=40';
    const host = render(<Avatar login="gone-bot" image={address} />);
    happens(picture(host)!, 'load');
    act(() => {
      redrawPictures((drawn) => (drawn === address ? `${address}&r=1` : undefined));
    });
    happens(picture(host)!, 'error');
    expect(host.textContent).toBe('GB');
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
