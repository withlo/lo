import { land } from './motion.ts';

/** Where in its pane the revealed element ends up. `nearest` moves the pane as little as it can. */
export type RevealBlock = 'start' | 'center' | 'end' | 'nearest';

export interface RevealOptions {
  /** Where the element ends up in its pane. `nearest` unless said. */
  block?: RevealBlock | undefined;
  /**
   * Whether the element takes the Land tint. A jump does, so `start`, `center` and `end` do unless
   * told not to. Keeping a cursor in view as it moves isn't a jump, so `nearest` doesn't.
   */
  land?: boolean | undefined;
}

/** The nearest box around `element` that scrolls up and down: its pane. */
export function scrollPane(element: Element): HTMLElement | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === 'auto' || overflowY === 'scroll') return at;
  }
  return null;
}

/**
 * Brings `element` into view by scrolling its pane, and nothing else: the window never scrolls.
 * The scroll is instant, and a jump marks where it landed with the Land move. Use it in place of
 * `scrollIntoView`, which scrolls every box around the element, the window's shell among them.
 *
 * An element under a pinned header gets a `scroll-margin-top` the height of the header, and this
 * keeps clear of it.
 */
export function reveal(element: Element, options: RevealOptions = {}): void {
  const block = options.block ?? 'nearest';
  const pane = scrollPane(element);
  if (pane) {
    const box = element.getBoundingClientRect();
    const frame = pane.getBoundingClientRect();
    const style = getComputedStyle(element);
    const above = Number.parseFloat(style.scrollMarginTop) || 0;
    const below = Number.parseFloat(style.scrollMarginBottom) || 0;
    const room = pane.clientHeight;
    // Where the element starts and ends in what the pane scrolls, with its margins.
    const top = box.top - frame.top - pane.clientTop + pane.scrollTop - above;
    const bottom = top + above + box.height + below;
    const start = top;
    const end = bottom - room;
    const to = (() => {
      switch (block) {
        case 'start':
          return start;
        case 'end':
          return end;
        case 'center':
          return (start + end) / 2;
        case 'nearest':
          // Taller than the pane, it shows from its top.
          if (top < pane.scrollTop || bottom - top > room) return start;
          return bottom > pane.scrollTop + room ? end : pane.scrollTop;
        default:
          block satisfies never;
          return pane.scrollTop;
      }
    })();
    if (to !== pane.scrollTop) pane.scrollTop = to;
  }
  if (options.land ?? block !== 'nearest') land(element);
}
