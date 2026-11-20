// @vitest-environment jsdom
// Lo's window with a toast that waits: the toast floats above the status bar as a note does, and
// the middle keeps its whole height, so the page doesn't shift as a toast comes, changes or goes.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { toasts } from '../features/tab/window/shared.ts';
import { createRegistry } from './commands/registry.ts';
import { defineView, Slots } from './slots.tsx';
import { Window } from './Window.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry([], 'mac');
});

/** What a toast that waits would measure, for anything in the window that measured it. */
let measured = 0;
const observers = new Set<() => void>();

class Observer {
  readonly #callback: () => void;
  constructor(callback: () => void) {
    this.#callback = callback;
  }
  observe(): void {
    observers.add(this.#callback);
  }
  disconnect(): void {
    observers.delete(this.#callback);
  }
}

vi.stubGlobal('ResizeObserver', Observer);
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return this.getAttribute('aria-atomic') === 'false' ? measured : 0;
  },
});

afterEach(() => {
  measured = 0;
  document.body.replaceChildren();
});

function draw(hold: boolean): { middle: HTMLElement; region: HTMLElement; change: () => void } {
  const views = hold
    ? [defineView(toasts, { id: 'test.waits', order: 0, render: () => <div>Waiting</div> })]
    : [];
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <Slots views={views}>
        <Window />
      </Slots>,
    ),
  );
  const middle = host.querySelector<HTMLElement>('main[data-lo-middle]');
  const region = host.querySelector<HTMLElement>('.toast-floating');
  if (!middle || !region) throw new Error('The window drew no middle or no toast region.');
  return {
    middle,
    region,
    change: () =>
      act(() => {
        for (const observe of observers) observe();
      }),
  };
}

describe('the window', () => {
  it('floats a toast that waits above the status bar, and gives the middle its whole height', () => {
    measured = 96;
    const { middle, region, change } = draw(true);
    change();
    // Nothing is set inline: the middle has no margin to make room, and the region sits where a
    // note does, by the stylesheet, above the status bar the middle's tab may have in it.
    expect(middle.getAttribute('style')).toBeNull();
    expect(region.getAttribute('style')).toBeNull();
    expect(region.textContent).toContain('Waiting');
    // A taller toast, as the offer's becomes Homebrew's command, moves nothing.
    measured = 150;
    change();
    expect(middle.getAttribute('style')).toBeNull();
    expect(region.getAttribute('style')).toBeNull();
    // Gone, and the page hasn't moved then either.
    measured = 0;
    change();
    expect(middle.getAttribute('style')).toBeNull();
    expect(region.getAttribute('style')).toBeNull();
  });

  it('is the same with no toast waiting', () => {
    const { middle, region } = draw(false);
    expect(middle.getAttribute('style')).toBeNull();
    expect(region.getAttribute('style')).toBeNull();
  });
});
