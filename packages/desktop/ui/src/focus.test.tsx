// @vitest-environment jsdom
import { act, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import { Dialog } from './Dialog.tsx';
import { besideIn, handOffFocus, useTakeFocus } from './focus.ts';
import { KeyHelp } from './KeyHelp.tsx';
import { Palette } from './Palette.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

let root: Root | undefined;
let host: HTMLElement | undefined;
// Base UI moves focus on the next animation frame, which never comes here: whatever has focus,
// the popup gave it itself.
let frame: MockInstance<typeof window.requestAnimationFrame> | undefined;

beforeEach(() => {
  frame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  frame?.mockRestore();
});

/** Renders `node` into a fresh `.lo-app` element, and returns the page: popups portal to its body. */
function render(node: ReactNode): HTMLElement {
  host = document.createElement('div');
  host.className = 'lo-app';
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return document.body;
}

/** A popup that takes focus: its field's, with `field`, or its own. */
function Popup({ field, focused }: { field?: boolean; focused?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const takeFocus = useTakeFocus(field ? input : undefined);
  return (
    <div ref={takeFocus} tabIndex={-1} data-testid="popup">
      <input ref={input} aria-label="Field" />
      {/* React focuses it as it mounts, before the popup's turn comes. */}
      {focused && <button type="button" autoFocus aria-label="Focused" />}
    </div>
  );
}

describe('useTakeFocus', () => {
  it('gives its target focus as the popup mounts', async () => {
    const page = render(<Popup field />);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(page.querySelector('[aria-label="Field"]')),
    );
  });

  it('gives the popup itself focus without a target', async () => {
    const page = render(<Popup />);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(page.querySelector('[data-testid="popup"]')),
    );
  });

  it('leaves focus that is inside the popup already', async () => {
    const page = render(<Popup field focused />);
    const focused = page.querySelector('[aria-label="Focused"]');
    expect(document.activeElement).toBe(focused);
    // Two microtasks on, and more.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(focused);
  });
});

/** A dialog that starts on its main button. */
function Asking() {
  const primary = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open
      onOpenChange={() => {}}
      title="Sign in"
      foot={
        <button ref={primary} type="button">
          Continue
        </button>
      }
      initialFocus={primary}
    />
  );
}

describe('the dialogs take focus as they open, without waiting for a frame', () => {
  it('a palette, in its input', async () => {
    const page = render(
      <Palette<string>
        open
        onOpenChange={() => {}}
        label="Open a pull request"
        placeholder="Paste a link to a pull request"
        query=""
        onQueryChange={() => {}}
        groups={[]}
        itemId={(item) => item}
        renderItem={(item) => item}
        onRun={() => {}}
        empty=""
      />,
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(page.querySelector('input')));
  });

  it('key help, in its search', async () => {
    const page = render(<KeyHelp open onOpenChange={() => {}} groups={[]} />);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(page.querySelector('input[type="search"]')),
    );
  });

  it('a dialog, on what it starts on', async () => {
    const page = render(<Asking />);
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Continue'));
    expect(page.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true);
  });
});

/** A row of three buttons, on the page. */
function row(): { row: HTMLElement; buttons: HTMLButtonElement[] } {
  const element = document.createElement('div');
  const buttons = ['a', 'b', 'c'].map((name) => {
    const button = document.createElement('button');
    button.id = name;
    element.append(button);
    return button;
  });
  document.body.append(element);
  return { row: element, buttons };
}

describe('handOffFocus', () => {
  it('hands focus on where it fell to the page as what had it left, beside it in its row', async () => {
    const { row: bar, buttons } = row();
    const [a, b, c] = buttons;
    b?.focus();
    const stops = besideIn(bar, [b]);
    expect(stops).toEqual([c, a, bar]);
    handOffFocus([b], () => stops);
    b?.remove();
    await Promise.resolve();
    expect(document.activeElement).toBe(c);
    bar.remove();
  });

  it('hands focus on from what can no longer hold it, and to the row itself, only for a while', async () => {
    const { row: bar, buttons } = row();
    const [a] = buttons;
    a?.focus();
    handOffFocus([a], () => [bar]);
    // The row it's in closes: it goes inert, with focus still on it.
    a?.setAttribute('inert', '');
    await Promise.resolve();
    expect(document.activeElement).toBe(bar);
    // The row holds focus only until it goes: it was never a stop for `Tab`.
    a?.removeAttribute('inert');
    a?.focus();
    expect(bar.hasAttribute('tabindex')).toBe(false);
    bar.remove();
  });

  it('leaves focus that went anywhere else meanwhile, and that was never in what left', async () => {
    const { row: bar, buttons } = row();
    const [a, b, c] = buttons;
    a?.focus();
    handOffFocus([a], () => [b]);
    // As a dialog the press opened takes it.
    c?.focus();
    a?.remove();
    await Promise.resolve();
    expect(document.activeElement).toBe(c);
    handOffFocus([b], () => [bar]);
    b?.remove();
    await Promise.resolve();
    expect(document.activeElement).toBe(c);
    bar.remove();
  });
});
