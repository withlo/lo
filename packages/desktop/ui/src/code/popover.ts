// A code view's thread popover, beside lines: the threads that end on one line, over the code, in a
// layer of the view's own scroll, so it moves with its line and passes under the pinned file header
// as code does. One per code view. The pointer resting on a mark previews it; a click on the mark,
// or on anything in the preview, pins it, which shows its Close and key chips in the room the
// preview kept for them, and moves nothing. It never covers its lines unless they fill the pane:
// under the last line, else above the first, else at the pane's foot. Opened by a click or a key it
// goes under the last line, and the pane scrolls the least that shows it whole; only where the
// scroll can go no further does it go above.
//
// The caller draws what it shows (`RenderPopover`), at once, since it's measured and placed as it's
// drawn: it's built as the pointer comes to a mark, ahead of the rest, so it's whole in the first
// frame after it opens.

import { SCOPE_ATTRIBUTE, setScopeSource, type ThreadTarget } from '../commands/index.ts';
import { whenSettled } from '../motion.ts';
import type { PopoverContent, PopoverView, RenderPopover } from './api.ts';

/** How long the pointer rests on a mark before its preview opens, in milliseconds. */
export const REST = 500;

/** Within this long of a preview closing, the next opens at once, in milliseconds. */
export const AGAIN = 300;

/**
 * How long a preview waits for the pointer that left its mark to come into it, or back, before it
 * closes: the room between them, the gap under the line, it crosses in less.
 */
export const CROSS = 120;

/** The gap between a popover and its lines. */
const GAP = 4;

/** How far a popover stays inside the pane's edges, and over its foot. */
const EDGE = 8;

/** The pane's height a popover leaves free, under the pinned header. */
const FREE = 16;

/** What opens over everything, from a popover too: a menu, or a dialog it asks in. */
const OVER = '[role="menu"], [role="dialog"], [role="alertdialog"]';

/** A size token's value in pixels, as the stylesheet has it, or `fallback` where it has none. */
function token(name: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Where a popover sits: under its last line, above its first, or at the pane's foot. */
export type PopSide = 'under' | 'above' | 'foot';

/**
 * A popover's lines and lane, in the scroll's content: the top of its first line and the bottom of
 * its last, from the content's top, and the thread lane's left edge, from its left.
 */
export interface PopLines {
  readonly first: number;
  readonly last: number;
  readonly lane: number;
}

/** The pane a popover is placed in: its scroll, its size, and the pinned header over its top. */
export interface PopRoom {
  /** How far it's scrolled. */
  readonly scroll: number;
  readonly height: number;
  /** How wide what scrolls shows: its own width less its scrollbar's room. */
  readonly width: number;
  /**
   * Where its edge is, from the left of what scrolls: past `width` by its scrollbar's room, which
   * is the pane's, though nothing in what scrolls can go over it.
   */
  readonly edge: number;
  /** How tall its content is: as far as it can scroll, with its height. */
  readonly end: number;
  /** How tall the pinned file header is, over the top of what scrolls. */
  readonly header: number;
}

/** Where a popover goes, in the scroll's content, and how far the pane scrolls to show it. */
export interface Placed {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly side: PopSide;
  /** How far the pane scrolls first, down, or up where it's less than 0. */
  readonly scroll: number;
}

/** The tallest a popover is, in `room`: `lo-thread-pop-h`, or the pane under the header less 16. */
export function popMax(room: PopRoom, most = token('--lo-thread-pop-h', 480)): number {
  return Math.max(0, Math.min(most, room.height - room.header - FREE));
}

/**
 * Where a popover goes across, in a pane whose scroll shows `width` and whose edge is `edge` from
 * its left: `lo-thread-pop-w` wide at any width, on its thread lane's left edge, where that leaves
 * it 8 px inside the pane's edge and off its scrollbar; else over the other side, back to there.
 * In a pane too narrow for it, as with a panel open in a narrow window, it narrows to fit there,
 * 8 px inside its left edge.
 */
export function across(
  lines: PopLines,
  width: number,
  edge = width,
  wide = token('--lo-thread-pop-w', 520),
): { left: number; width: number } {
  const right = Math.min(width, edge - EDGE);
  const shown = Math.max(0, Math.min(wide, right - EDGE));
  return { left: Math.max(EDGE, Math.min(lines.lane, right - shown)), width: shown };
}

/** How far to scroll to show `top` to `bottom` in `room` whole, the least, as `reveal` does. */
function nearest(room: PopRoom, top: number, bottom: number): number {
  const shown = { top: room.scroll + room.header, bottom: room.scroll + room.height - EDGE };
  if (top < shown.top) return top - shown.top;
  if (bottom > shown.bottom) return Math.min(bottom - shown.bottom, top - shown.top);
  return 0;
}

/** `by`, as far as `room` can scroll that way. */
function scrollable(room: PopRoom, by: number): number {
  return Math.max(-room.scroll, Math.min(room.end - room.height - room.scroll, by));
}

/**
 * Where a popover `height` tall goes for `lines` in `room`. A `preview` takes the first place with
 * room on screen, under the last line, above the first clear of the pinned header, or at the pane's
 * foot, and never scrolls. One `opened` by a click or a key goes under the last line, the pane
 * scrolled the least that shows it whole, with the first line too where both fit; only where the
 * scroll can't go that far, at the content's end, does it go above, scrolled the same way. One
 * open already keeps its `side`, placed again by its lines as they are now.
 */
export function placePop(
  room: PopRoom,
  lines: PopLines,
  height: number,
  how: 'preview' | 'opened' | PopSide,
): Placed {
  const { left, width } = across(lines, room.width, room.edge);
  const under = lines.last + GAP;
  const above = lines.first - GAP - height;
  const placed = (side: PopSide, top: number, scroll = 0): Placed => ({
    top,
    left,
    width,
    side,
    scroll,
  });
  const top = room.scroll + room.header;
  const foot = room.scroll + room.height - EDGE;
  switch (how) {
    case 'under':
      return placed('under', under);
    case 'above':
      return placed('above', above);
    case 'foot':
      return placed('foot', Math.max(top + EDGE, foot - height));
    case 'preview':
      if (under + height <= Math.min(foot, room.end)) return placed('under', under);
      if (above >= top + GAP) return placed('above', above);
      return placed('foot', Math.max(top + EDGE, foot - height));
    case 'opened': {
      if (under + height <= room.end) {
        // With its first line too, where both fit on screen.
        const both = under + height - lines.first <= room.height - room.header - EDGE;
        const wanted = nearest(room, both ? lines.first : lines.last - GAP, under + height);
        const scroll = scrollable(room, wanted);
        if (scroll === wanted) return placed('under', under, scroll);
      }
      if (above >= 0) {
        const wanted = nearest(room, above, lines.last);
        return placed('above', above, scrollable(room, wanted));
      }
      return placed('foot', Math.max(top + EDGE, foot - height));
    }
    default:
      throw new Error(`A place Lo doesn’t know: ${JSON.stringify(how satisfies never)}`);
  }
}

/** Where a popover opens: a mark, by a key for its line that's the same wherever it's drawn. */
export interface PopAt {
  readonly key: string;
}

/** What a popover asks of the code view it's in. */
export interface PopHost<At extends PopAt> {
  /** The box that scrolls, whose content the popover's layer is in. */
  readonly scroller: HTMLElement;
  /** Where `at`'s lines and lane are drawn now, or none while they aren't. */
  lines(at: At): PopLines | undefined;
  /** The pane, as it is now. */
  room(): PopRoom;
  /** What it shows at `at` now: no threads once there are none. */
  view(at: At, pinned: boolean): PopoverView;
  /** It opened at `at`, moved there, or closed: the marks and lines say so. */
  shown(at: At | undefined): void;
  /** Gives focus to `at`'s line, the cursor on it, as a popover closing hands it back. */
  focusLine(at: At): void;
  /** Scrolls the pane by `by`, down or up, as the view's own scroll. */
  scrollBy(by: number): void;
  /** Whether `target` is on `at`'s mark. */
  onMark(target: Element, at: At): boolean;
}

/** A code view's one thread popover: its layer, what's drawn in it, and how it comes and goes. */
export class ThreadPop<At extends PopAt> {
  /** The layer in the scroll's content: a scope of its own for the keys, `thread`. */
  readonly dom: HTMLElement;
  readonly #host: PopHost<At>;
  /** What the caller draws in, inside the layer: an element of its own each time it draws anew. */
  readonly #content: HTMLElement;
  #render: RenderPopover | undefined;
  #drawn: PopoverContent | undefined;
  /** What it's drawn for, built ahead or shown. */
  #built: At | undefined;
  #state: 'closed' | 'preview' | 'pinned' = 'closed';
  #at: At | undefined;
  #side: PopSide = 'under';
  /** The mark under the pointer, while it's over one. */
  #hovered: At | undefined;
  #rest: ReturnType<typeof setTimeout> | undefined;
  #crossing: ReturnType<typeof setTimeout> | undefined;
  /** Whether the pointer is in the layer. */
  #inside = false;
  /** When a preview last closed. */
  #closedAt = -Infinity;
  #leaving: (() => void) | undefined;
  readonly #stops: (() => void)[] = [];
  readonly #sized: ResizeObserver | undefined;

  constructor(host: PopHost<At>) {
    this.#host = host;
    this.dom = document.createElement('div');
    this.dom.className = 'lo-threadpop move-pop';
    this.dom.hidden = true;
    this.dom.tabIndex = -1;
    this.dom.setAttribute(SCOPE_ATTRIBUTE, 'thread');
    this.#content = document.createElement('div');
    this.dom.append(this.#content);
    this.#stops.push(setScopeSource(this.dom, { target: () => this.#target() }));
    this.dom.addEventListener('pointerenter', () => {
      this.#inside = true;
      clearTimeout(this.#crossing);
    });
    this.dom.addEventListener('pointerleave', () => {
      this.#inside = false;
      this.#crossed();
    });
    // A press in a preview pins it, before what was pressed runs.
    this.dom.addEventListener('pointerdown', () => {
      if (this.#state === 'preview') this.#pinHere();
    });
    const pressed = (event: Event): void => this.#pressed(event);
    const typed = (event: KeyboardEvent): void => this.#typed(event);
    // The pane's scroll closes a preview, not a scroll of the comments in it.
    const wheeled = (event: WheelEvent): void => {
      const { target } = event;
      if (this.#state !== 'preview' || (target instanceof Node && this.dom.contains(target)))
        return;
      this.close();
    };
    document.addEventListener('pointerdown', pressed, true);
    document.addEventListener('keydown', typed, true);
    host.scroller.addEventListener('wheel', wheeled, { passive: true });
    this.#stops.push(
      () => document.removeEventListener('pointerdown', pressed, true),
      () => document.removeEventListener('keydown', typed, true),
      () => host.scroller.removeEventListener('wheel', wheeled),
    );
    // As what it shows grows or shrinks, as an image loads or a reply comes, it's placed again,
    // from the edge by its line.
    if (typeof ResizeObserver !== 'undefined') {
      this.#sized = new ResizeObserver(() => this.place());
      this.#sized.observe(this.#content);
    }
    host.scroller.append(this.dom);
  }

  set render(render: RenderPopover | undefined) {
    if (render === this.#render) return;
    this.#render = render;
    // Drawn anew by the new caller.
    this.#drop();
    if (this.#at && this.#state !== 'closed') this.#draw(this.#at);
  }

  /** Where it's open, if it is. */
  get at(): At | undefined {
    return this.#state === 'closed' ? undefined : this.#at;
  }

  get pinned(): boolean {
    return this.#state === 'pinned';
  }

  get open(): boolean {
    return this.#state !== 'closed';
  }

  /** Whether focus is in it. */
  hasFocus(): boolean {
    return this.dom.contains(document.activeElement);
  }

  /** What it shows at `at`, built ahead, unseen, for the pointer that came to its mark. */
  build(at: At): void {
    if (this.#state !== 'closed' || this.#built?.key === at.key) return;
    this.#draw(at);
  }

  /** The pointer came to a mark, or left the one it was on. */
  hover(at: At | undefined): void {
    if (at?.key === this.#hovered?.key) return;
    this.#hovered = at;
    clearTimeout(this.#rest);
    if (this.#state === 'pinned') return;
    if (at === undefined) {
      this.#crossed();
      return;
    }
    if (this.#state === 'preview' && this.#at?.key === at.key) {
      clearTimeout(this.#crossing);
      return;
    }
    this.build(at);
    const again = this.#state === 'preview' || performance.now() - this.#closedAt < AGAIN;
    this.#rest = setTimeout(
      () => {
        if (this.#hovered?.key === at.key && this.#state !== 'pinned') this.#open(at, 'preview');
      },
      again ? 0 : REST,
    );
  }

  /**
   * A click on `at`'s mark: pins its popover, in place if it's the preview there, or closes it if
   * it's pinned there. Says whether it's pinned now.
   */
  clicked(at: At): boolean {
    clearTimeout(this.#rest);
    if (this.#at?.key === at.key && this.#state === 'pinned') {
      this.close();
      return false;
    }
    if (this.#at?.key === at.key && this.#state === 'preview') {
      this.#pinHere();
      return true;
    }
    this.#open(at, 'pinned');
    return true;
  }

  /** Pins it at `at`, as a key opens it, unless it's pinned there already. */
  pin(at: At): void {
    if (this.#at?.key === at.key && this.#state === 'pinned') return;
    clearTimeout(this.#rest);
    this.#open(at, 'pinned');
  }

  /**
   * Focus into it: with `ring`, on its first comment, the ring the keys move, as `⏎` takes it;
   * without, on the popover itself, as a click on its mark takes it, which draws no ring, so the
   * click changes nothing in it but its Close and chips. `j` then rings the first comment.
   */
  focus(ring = true): void {
    const first = ring ? this.dom.querySelector<HTMLElement>('[data-comment]') : null;
    const popover = this.dom.querySelector<HTMLElement>('[data-thread-pop]');
    (first ?? popover ?? this.dom).focus({ preventScroll: true });
  }

  /**
   * Closes it, fading. Focus in it goes to its line as it starts to leave, unless `focus` is false,
   * as for a press elsewhere, which takes it there.
   */
  close(focus = true): void {
    if (this.#state === 'closed') return;
    const at = this.#at!;
    const held = this.hasFocus();
    if (this.#state === 'preview') this.#closedAt = performance.now();
    this.#state = 'closed';
    clearTimeout(this.#crossing);
    this.#host.shown(undefined);
    if (held && focus) this.#host.focusLine(at);
    this.dom.dataset.endingStyle = '';
    this.#leaving?.();
    this.#leaving = whenSettled(this.dom, () => {
      this.#leaving = undefined;
      if (this.#state !== 'closed') return;
      this.dom.hidden = true;
      delete this.dom.dataset.endingStyle;
    });
  }

  /**
   * What it shows changed, as its threads did: drawn again, and placed again. Its threads gone, it
   * closes, focus in it going to the line.
   */
  refresh(): void {
    const at = this.#state === 'closed' ? this.#built : this.#at;
    if (!at || !this.#drawn) return;
    const view = this.#host.view(at, this.#state === 'pinned');
    if (view.threads.length === 0) {
      if (this.#state !== 'closed') this.close();
      this.#drop();
      return;
    }
    this.#drawn.update(view);
    if (this.#state !== 'closed') this.#host.shown(at);
  }

  /** Places it again where it is, by its lines as they are now, as a resize asks. */
  place(): void {
    if (this.#state === 'closed' || !this.#at) return;
    const lines = this.#host.lines(this.#at);
    // Its lines aren't drawn now, as their file closed.
    if (!lines) {
      this.close();
      return;
    }
    this.#put(placePop(this.#host.room(), lines, this.#content.offsetHeight, this.#side));
  }

  destroy(): void {
    clearTimeout(this.#rest);
    clearTimeout(this.#crossing);
    this.#leaving?.();
    this.#sized?.disconnect();
    for (const stop of this.#stops) stop();
    this.#drop();
    this.dom.remove();
  }

  /** Draws what it shows at `at`, unseen. */
  #draw(at: At): void {
    const render = this.#render;
    if (!render) return;
    const view = this.#host.view(at, this.#state === 'pinned');
    if (view.threads.length === 0) return;
    if (this.#drawn && this.#built?.key === at.key) {
      this.#drawn.update(view);
      return;
    }
    this.#drop();
    this.#built = at;
    // An element of its own each time: what was drawn before may still be going.
    const host = document.createElement('div');
    this.#content.replaceChildren(host);
    this.#drawn = render(host, view, () => this.close());
  }

  #drop(): void {
    const drawn = this.#drawn;
    this.#drawn = undefined;
    this.#built = undefined;
    drawn?.destroy();
    this.#content.replaceChildren();
  }

  /** Opens it at `at`: placed, and whole, in the frame it's first seen in. */
  #open(at: At, state: 'preview' | 'pinned'): void {
    const lines = this.#host.lines(at);
    if (!lines || !this.#render) return;
    const moving = this.#state !== 'closed' && this.#at?.key !== at.key;
    // The one open elsewhere goes at once: one popover per view.
    if (moving && this.#state === 'preview') this.#closedAt = performance.now();
    const was = this.#state;
    this.#state = state;
    this.#at = at;
    this.#draw(at);
    if (!this.#drawn) {
      this.#state = 'closed';
      return;
    }
    this.#leaving?.();
    this.#leaving = undefined;
    delete this.dom.dataset.endingStyle;
    const room = this.#host.room();
    this.dom.style.setProperty('--lo-pop-max', `${popMax(room)}px`);
    this.dom.style.width = `${across(lines, room.width, room.edge).width}px`;
    // Laid out unseen, as wide as it goes, to be measured and placed before it's seen.
    this.dom.style.visibility = 'hidden';
    this.dom.hidden = false;
    const placed = placePop(
      room,
      lines,
      this.#content.offsetHeight,
      state === 'pinned' ? 'opened' : 'preview',
    );
    if (placed.scroll !== 0) this.#host.scrollBy(placed.scroll);
    this.#put(placed);
    this.dom.dataset.side = placed.side === 'above' ? 'top' : 'bottom';
    if (moving || was === 'closed') {
      // It comes from nothing, with its Pop: its style is worked out hidden once, so the next is
      // its first shown. Moved, it comes anew where it's going, with no fade from where it was.
      this.dom.hidden = true;
      void getComputedStyle(this.dom).display;
      this.dom.hidden = false;
    }
    this.dom.style.visibility = '';
    this.#host.shown(at);
  }

  #put(placed: Placed): void {
    this.#side = placed.side;
    this.dom.style.top = `${placed.top}px`;
    this.dom.style.left = `${placed.left}px`;
    this.dom.style.width = `${placed.width}px`;
  }

  /** The preview, pinned where it is: its Close and chips come in the room it kept for them. */
  #pinHere(): void {
    if (this.#state !== 'preview' || !this.#at) return;
    this.#state = 'pinned';
    clearTimeout(this.#crossing);
    this.#drawn?.update(this.#host.view(this.#at, true));
    this.#host.shown(this.#at);
  }

  /** The pointer left the mark or the preview: it closes unless it's on one of them soon. */
  #crossed(): void {
    if (this.#state !== 'preview') return;
    clearTimeout(this.#crossing);
    this.#crossing = setTimeout(() => {
      if (this.#state !== 'preview' || this.#inside) return;
      if (this.#hovered?.key === this.#at?.key) return;
      this.close();
    }, CROSS);
  }

  /** A press anywhere: one outside it and its mark closes it. */
  #pressed(event: Event): void {
    if (this.#state === 'closed' || !this.#at) return;
    const { target } = event;
    if (!(target instanceof Element) || this.dom.contains(target)) return;
    if (this.#host.onMark(target, this.#at)) return;
    // What it opened over everything, as its thread's menu, is its own.
    if (target.closest(OVER) !== null) return;
    this.close(false);
  }

  /** A key closes a preview. */
  #typed(event: KeyboardEvent): void {
    if (this.#state !== 'preview') return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) return;
    this.close();
  }

  /**
   * What a key in it acts on: the thread focus is in, or its first, and the comment the ring is
   * on.
   */
  #target(): ThreadTarget {
    const active = document.activeElement;
    const inside = active instanceof Element && this.dom.contains(active) ? active : undefined;
    const card = inside?.closest<HTMLElement>('[data-thread-id]');
    const thread =
      card?.dataset.threadId ??
      this.dom.querySelector<HTMLElement>('[data-thread-id]')?.dataset.threadId ??
      '';
    const comment = inside?.closest<HTMLElement>('[data-comment]')?.dataset.comment;
    return comment === undefined ? { kind: 'thread', thread } : { kind: 'thread', thread, comment };
  }
}
