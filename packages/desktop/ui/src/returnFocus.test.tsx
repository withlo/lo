// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Dialog } from './Dialog.tsx';
import { KeyHelp } from './KeyHelp.tsx';
import { Palette } from './Palette.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  root = undefined;
});

/**
 * A page with a container that takes focus without being tabbable and holds a tabbable button, as
 * the middle of the window does, focused; and `dialog(open)` rendered over it.
 */
function page(dialog: (open: boolean) => ReactNode) {
  const host = document.createElement('div');
  host.className = 'lo-app';
  const container = document.createElement('main');
  container.tabIndex = -1;
  const button = document.createElement('button');
  container.append(button);
  const mount = document.createElement('div');
  host.append(container, mount);
  document.body.append(host);
  container.focus();
  root = createRoot(mount);
  const show = (open: boolean) => act(() => root?.render(dialog(open)));
  show(false);
  return { container, button, show };
}

const palette = (open: boolean) => (
  <Palette
    open={open}
    onOpenChange={() => {}}
    label="Palette"
    placeholder="Type"
    query=""
    onQueryChange={() => {}}
    groups={[]}
    itemId={String}
    renderItem={String}
    onRun={() => {}}
    empty="Nothing"
  />
);

const keyHelp = (open: boolean) => <KeyHelp open={open} onOpenChange={() => {}} groups={[]} />;

const dialog = (open: boolean) => (
  <Dialog open={open} onOpenChange={() => {}} title="Dialog">
    <input aria-label="Field" />
  </Dialog>
);

describe('closing a dialog', () => {
  it.each([
    ['a palette', palette],
    ['key help', keyHelp],
    ['a dialog', dialog],
  ])(
    'puts focus back on the element that had it, not a tabbable part of it: %s',
    async (_, make) => {
      const { container, button, show } = page(make);
      show(true);
      await vi.waitFor(() => expect(document.activeElement).not.toBe(container));
      show(false);
      await vi.waitFor(() => expect(document.activeElement).toBe(container));
      expect(document.activeElement).not.toBe(button);
    },
  );

  it('does not take focus from a dialog that opened again meanwhile', async () => {
    const { container, show } = page(palette);
    show(true);
    await vi.waitFor(() => expect(document.activeElement).not.toBe(container));
    show(false);
    show(true);
    await vi.waitFor(() => expect(document.activeElement?.tagName).toBe('INPUT'));
    expect(document.activeElement).not.toBe(container);
  });
});
