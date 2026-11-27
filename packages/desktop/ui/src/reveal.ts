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

/**
 * The nearest box around `element` that scrolls up and down: its pane. A box that scrolls only
 * sideways, such as a wide table or a code block, computes `overflow-y: auto` too, since one axis
 * can't be visible while the other isn't, so a box counts only when it holds more than its height.
 */
export function scrollPane(element: Element): HTMLElement | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight) {
      return at;
    }
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

/** Where something is on the page, from its top to its bottom. */
export interface Span {
  readonly top: number;
  readonly bottom: number;
}

/**
 * Where what a view shows is on the page, read when it's asked, after anything around it has moved:
 * none once it's gone.
 */
export type Shown = () => Span | undefined;

/**
 * The event a view sends up the page as it shows something in it, a `CustomEvent` whose detail is
 * the {@link Shown} that says where: an overview's block that keeps its height, cutting off what
 * grew in it, shows it whole first if any of that is in the part cut off (`holdHeight`).
 */
export const SHOW_EVENT = 'lo-show';

/**
 * Says that what `shown` says is being shown in `from`: the cursor coming to a line, or a thread
 * or a comment box opening on one. Whatever holds `from` makes room for it at once, before it
 * opens, so it opens where it's seen. Its opener brings it into view as it always does.
 */
export function askToShow(from: Element, shown: Shown): void {
  from.dispatchEvent(new CustomEvent<Shown>(SHOW_EVENT, { bubbles: true, detail: shown }));
}

/** What `event`, one {@link askToShow} sent, says is being shown, if it's one. */
export function shownIn(event: Event): Shown | undefined {
  const shown: unknown = event instanceof CustomEvent ? event.detail : undefined;
  return isShown(shown) ? shown : undefined;
}

function isShown(value: unknown): value is Shown {
  return typeof value === 'function';
}
