// Rendering into jsdom for the Markdown and overview tests, and the walk that holds what a renderer
// wrote to an allowlist.

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';

import { TOOLTIP_DELAY } from '../src/Tooltip.tsx';

let mounted: { root: Root; host: HTMLElement }[] = [];

/** Renders `node` into a fresh `.lo-app` element on the page, and returns that element. */
export function render(node: ReactNode): HTMLElement {
  const host = document.createElement('div');
  host.className = 'lo-app';
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  mounted.push({ root, host });
  return host;
}

/** Draws `node` in place of what `render` drew into `host`, as a parent drawing again would. */
export function rerender(host: HTMLElement, node: ReactNode): void {
  const found = mounted.find((each) => each.host === host);
  if (!found) throw new Error('Nothing was rendered into that element.');
  act(() => found.root.render(node));
}

/** Unmounts and removes everything `render` made. */
export function cleanUp(): void {
  for (const { root, host } of mounted) {
    act(() => root.unmount());
    host.remove();
  }
  mounted = [];
}

/** Dispatches a key's `keydown` at `target`, as the browser would. */
export function press(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Clicks `target`. */
export function click(target: Element): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/**
 * What `target`'s tooltip says once the pointer has rested on it, its key caps' text last, or
 * nothing where it shows none. The pointer then leaves, and the tooltip with it. jsdom lays nothing
 * out, so text is never cut short there: with `cut`, `target` is measured as narrower than its
 * text. It waits on fake timers, and puts back the real ones if it set them.
 */
export function tipOf(
  target: Element,
  { cut = false }: { cut?: boolean } = {},
): string | undefined {
  const faked = vi.isFakeTimers();
  if (!faked) vi.useFakeTimers();
  if (cut) {
    Object.defineProperty(target, 'clientWidth', { configurable: true, value: 40 });
    Object.defineProperty(target, 'scrollWidth', { configurable: true, value: 80 });
  }
  try {
    act(() => {
      target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('mouseenter'));
      target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      vi.advanceTimersByTime(TOOLTIP_DELAY);
    });
    const said = document.querySelector('.tooltip')?.textContent ?? undefined;
    act(() => {
      target.dispatchEvent(new MouseEvent('mouseleave'));
      target.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      vi.advanceTimersByTime(TOOLTIP_DELAY);
    });
    return said;
  } finally {
    if (cut) {
      Reflect.deleteProperty(target, 'clientWidth');
      Reflect.deleteProperty(target, 'scrollWidth');
    }
    if (!faked) vi.useRealTimers();
  }
}

/** Gives `target` focus. */
export function focus(target: HTMLElement | SVGElement): void {
  act(() => target.focus());
}

/** Elements that load or run something, which no renderer of text from others may make. */
const LOADS = new Set([
  'script',
  'style',
  'link',
  'meta',
  'base',
  'img',
  'picture',
  'source',
  'video',
  'audio',
  'track',
  'iframe',
  'frame',
  'object',
  'embed',
  'form',
  'input',
  'image',
  'use',
  'foreignobject',
]);

/** Attributes that hold an address, a style or a handler, which no renderer may write. */
const FORBIDDEN =
  /^(?:on|href$|xlink:href$|src|srcset$|srcdoc$|style$|action$|formaction$|data$|poster$|background$|ping$|manifest$|xmlns)/i;

/**
 * Everything under `root` that `allowed` doesn't allow, as `element` or `element@attribute`: an
 * element it lacks, an attribute it lacks on that element, and anything that loads or runs, which
 * no allowlist may hold. `allowed` answers whether an element may carry an attribute, with
 * `attribute` undefined for the element itself.
 */
export function disallowed(
  root: Element,
  allowed: (element: string, attribute?: string) => boolean,
): string[] {
  const found: string[] = [];
  for (const element of root.querySelectorAll('*')) {
    const name = element.localName;
    if (LOADS.has(name) || !allowed(name)) found.push(name);
    for (const { name: attribute, value } of element.attributes) {
      if (
        FORBIDDEN.test(attribute) ||
        !allowed(name, attribute) ||
        /url\(|javascript:|blob:|data:/i.test(value)
      ) {
        found.push(`${name}@${attribute}`);
      }
    }
  }
  return found;
}

/** Every id under `root`. */
export function ids(root: Element): string[] {
  return [...root.querySelectorAll('[id]')].map((element) => element.id);
}
