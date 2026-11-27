// @vitest-environment jsdom
// The bar over the diff, narrowed: it gives up its key chips, then Compare revisions, then the
// note's facts after the first, last first, each whole and still heard, so what it compares,
// "base → r2", is never cut. jsdom lays nothing out, so the bar's width is worked out from what it
// still draws.

import { holdRegistry } from '@lo/ui/commands';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, onTestFinished, vi } from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import type * as DiffShared from '../../diff/window/shared.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import feature from './index.ts';
import type * as Model from './model.ts';
import { Note } from './Note.tsx';
import type * as Store from './store.ts';

const NOTE = 'base → r2 · whole pull request · no change since r2';

vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  usePull: () => ({ acting: { kind: 'user', login: 'rozed-bot' } }),
  useTabState: () => undefined,
}));
vi.mock('../../diff/window/shared.ts', async (original) => ({
  ...(await original<typeof DiffShared>()),
  useDiffFiles: () => undefined,
}));
vi.mock('./store.ts', async (original) => ({
  ...(await original<typeof Store>()),
  catchUp: () => undefined,
}));
vi.mock('./model.ts', async (original) => ({
  ...(await original<typeof Model>()),
  noteOf: () => ({ tone: 'plain', text: NOTE }),
}));

const TAB = { id: 't1', kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 94 } as const;

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  holdRegistry(createRegistry(feature.commands, 'mac'));
});

let root: ReturnType<typeof createRoot> | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

/** The bar, as wide as `room`: what it gave up. */
function barAt(room: number): HTMLElement {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-gave-up') || this.classList.contains('give-up') ? room : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-gave-up') || this.classList.contains('give-up')
        ? drawn(this)
        : 0;
    },
  });
  onTestFinished(() => {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
  });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Note tab={TAB} />));
  return host.querySelector<HTMLElement>('.give-up')!;
}

/**
 * How wide the bar draws what it hasn't given up: what it compares, 80 px; each fact after it,
 * 100; Compare revisions, 140, and its key chips, 40.
 */
function drawn(bar: HTMLElement): number {
  const gave = (bar.getAttribute('data-gave-up') ?? '').split(' ');
  const shown = (element: Element): boolean =>
    !gave.includes(element.getAttribute('data-gives') ?? '');
  const facts = [...bar.querySelectorAll('[data-gives^="drop"]')].filter(shown).length;
  const hint = bar.querySelector('[data-gives="hint"]');
  const chips = hint?.querySelector('kbd') && !gave.includes('keys') ? 40 : 0;
  return 80 + 100 * facts + (hint && shown(hint) ? 140 + chips : 0);
}

it('gives up its key chips, then Compare revisions, then the facts after the first, last first, and never what it compares', () => {
  // Whole, it takes 80 + 200 + 180.
  expect(barAt(460).getAttribute('data-gave-up') ?? '').toBe('');
  expect(barAt(459).getAttribute('data-gave-up')).toBe('keys');
  expect(barAt(419).getAttribute('data-gave-up')).toBe('keys hint');
  expect(barAt(279).getAttribute('data-gave-up')).toBe('keys hint drop1');
  const bar = barAt(179);
  expect(bar.getAttribute('data-gave-up')).toBe('keys hint drop1 drop2');
  // The last fact went first, and each given up is still there to be heard.
  const fact = (step: string) => bar.querySelector(`[data-gives="${step}"]`);
  expect(fact('drop1')?.textContent).toBe(' · no change since r2');
  expect(fact('drop2')?.textContent).toBe(' · whole pull request');
  expect([fact('drop1'), fact('drop2')].map((each) => each?.hasAttribute('data-heard'))).toEqual([
    true,
    true,
  ]);
  // What it compares is given up by no step, and cut by none: it's drawn whole however narrow.
  const note = bar.querySelector('[role="note"] [data-fit]');
  expect(note?.firstElementChild?.textContent).toBe('base → r2');
  expect(note?.firstElementChild?.hasAttribute('data-gives')).toBe(false);
  expect(barAt(60).getAttribute('data-gave-up')).toBe('keys hint drop1 drop2');
});
