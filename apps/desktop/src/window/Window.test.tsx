// @vitest-environment jsdom
// Lo's window with a toast that waits: the middle ends above it, so it sits over nothing, and the
// middle has its whole height again once the toast goes.

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

/** What a toast that waits measures, for the region that measures it. */
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
  it('leaves the middle all its height while no toast waits', () => {
    const { middle, region } = draw(false);
    expect(middle.style.marginBottom).toBe('');
    expect(region.style.bottom).toBe('');
  });

  it('ends the middle above a toast that waits, with a gap, and puts the toast at the foot', () => {
    measured = 96;
    const { middle, region, change } = draw(true);
    change();
    expect(middle.style.marginBottom).toBe('calc(96px + var(--lo-sp-24))');
    expect(region.style.bottom).toBe('var(--lo-sp-12)');
    // A taller toast, as the offer's becomes Homebrew's command: the room follows.
    measured = 150;
    change();
    expect(middle.style.marginBottom).toBe('calc(150px + var(--lo-sp-24))');
    // Gone: the middle has its height again, and a note floats above the status bar as before.
    measured = 0;
    change();
    expect(middle.style.marginBottom).toBe('');
    expect(region.style.bottom).toBe('');
  });
});
