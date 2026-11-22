// @vitest-environment jsdom
import { act, createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from './Dialog.tsx';
import { KeyHelp } from './KeyHelp.tsx';
import { MergePanel } from './MergePanel.tsx';
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

const mergePanel = (open: boolean) => (
  <MergePanel
    open={open}
    onOpenChange={() => {}}
    anchor={null}
    scope="merge"
    kind="ready"
    verdict="Ready to merge"
  />
);

const confirm = createRef<HTMLButtonElement>();

/** `popup`, open until `closed`, and with `into`, the dialog that opens in its place then. */
const closing = (popup: (open: boolean) => ReactNode, into: boolean) => (closed: boolean) => (
  <>
    {popup(!closed)}
    {into && (
      <Dialog open={closed} onOpenChange={() => {}} title="Merge" initialFocus={confirm}>
        <button ref={confirm}>Merge #1</button>
      </Dialog>
    )}
  </>
);

/** Lets what's waiting run: a popup takes focus two microtasks after it mounts. */
const settle = () => act(async () => {});

/** The next animation frame, and what it leaves waiting. */
const nextFrame = () =>
  act(async () => {
    vi.advanceTimersToNextFrame();
  });

describe('closing a popup that gives focus back a frame on, once its close is complete', () => {
  // Base UI completes a close a frame on, once the popup's animations have finished. jsdom has
  // none to read, and without them Base UI completes it at once, so the page has an empty list of
  // them, and the frame comes when the test says.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    Object.defineProperty(Element.prototype, 'getAnimations', {
      configurable: true,
      value: () => [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(Element.prototype, 'getAnimations');
  });

  const late = [
    ['the merge panel', mergePanel],
    ['key help', keyHelp],
  ] as const;

  it.each(late)('gives it back to where it was when nothing opened: %s', async (_, popup) => {
    const { container, show } = page(closing(popup, false));
    await settle();
    expect(document.activeElement).not.toBe(container);
    show(true);
    await settle();
    expect(document.activeElement).not.toBe(container);
    await nextFrame();
    expect(document.activeElement).toBe(container);
  });

  it.each(late)('leaves focus in a dialog that opened in its place: %s', async (_, popup) => {
    const { show } = page(closing(popup, true));
    await settle();
    show(true);
    await settle();
    expect(document.activeElement).toBe(confirm.current);
    await nextFrame();
    expect(document.activeElement).toBe(confirm.current);
  });
});
