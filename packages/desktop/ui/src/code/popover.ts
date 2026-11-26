// A code view's thread popover, beside lines: the threads that end on one line, over the code, in a
// layer of the view's own scroll, so it moves with its line and passes under the pinned file header
// as code does. One per code view, or one for every code view in a scroll, as an overview's code
// blocks share theirs (`sharedPop`). The pointer resting on a mark previews it; a click on the mark,
// or on anything in the preview, pins it, which shows its Close and key chips in the room the
// preview kept for them, and moves nothing. It never covers its lines unless they fill the pane:
// under the last line, else above the first, else at the pane's foot. Opened by a click or a key it
// goes under the last line, and the pane scrolls the least that shows it whole; only where the
// scroll can go no further does it go above.
//
// The caller draws what it shows (`RenderPopover`), at once, since it's measured and placed as it's
// drawn: it's built as the pointer comes to a mark, ahead of the rest, so it's whole in the first
// frame after it opens.
//
// A comment box written in it, as a reply's, is the view's, which puts it in the slot the caller
// draws for it. While one is open, only the box closing closes the popover: a press outside leaves
// it be, and what closes it on purpose, or moves it to another line, closes the box first, keeping
// its draft.

import {
  KEY_EVENT,
  SCOPE_ATTRIBUTE,
  setScopeSource,
  TAB_ATTRIBUTE,
  type ThreadTarget,
} from '../commands/index.ts';
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

/** A key pressed alone that's no key of its own, as `⌘` held for a click: it closes no preview. */
const MODIFIERS: readonly string[] = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn'];

/** What `Tab` can stop on, before what's disabled, hidden or taken out of the order is left out. */
const TABBABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';

/** The elements in `root` that `Tab` stops on, in its order. */
function tabStops(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (each) =>
      each.tabIndex >= 0 &&
      !each.matches(':disabled') &&
      each.closest('[inert], [hidden]') === null &&
      // Where the page can tell, as in a closed `<details>` or a control kept invisible.
      (typeof each.checkVisibility !== 'function' ||
        each.checkVisibility({ visibilityProperty: true })),
  );
}

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
  /** What draws what it shows at `at`, once the view has something to. */
  render(at: At): RenderPopover | undefined;
  /** Where `at`'s lines and lane are drawn now, or none while they aren't. */
  lines(at: At): PopLines | undefined;
  /** The pane `at`'s lines are in, as it is now. */
  room(at: At): PopRoom;
  /** What it shows at `at` now: no threads once there are none. */
  view(at: At, pinned: boolean): PopoverView;
  /** It opened at `at`, moved there, or closed: the marks and lines say so. */
  shown(at: At | undefined): void;
  /** Gives focus to `at`'s line, the cursor on it, as a popover closing hands it back. */
  focusLine(at: At): void;
  /** Scrolls the pane of `at`'s lines by `by`, down or up, as the view's own scroll. */
  scrollBy(by: number, at: At): void;
  /** Whether `target` is on `at`'s mark. */
  onMark(target: Element, at: At): boolean;
  /**
   * Whether what it shows at `at` holds a comment box being written: only the box closing closes
   * it then, so a press outside leaves it be.
   */
  holds(at: At): boolean;
  /**
   * Closes the comment box it shows at `at`, if one is, keeping its draft, as it's closed or moves
   * to another line on purpose. Focus is the popover's to move.
   */
  release(at: At): void;
  /** What it shows at `at` was drawn, or drawn again: a comment box goes in the slot drawn for it. */
  drawn(at: At): void;
}

/** Whether `view` shows nothing: no threads, and no comment box. */
function nothingIn(view: PopoverView): boolean {
  return view.threads.length === 0 && view.box === undefined;
}

/**
 * A code view's thread popover, as the view's threads open it at their lines: its own
 * (`ThreadPop`), or its handle on the one it shares with the views in its scroll (`sharedPop`),
 * which is open, pinned, focused or drawn for the view only while it's at the view's lines.
 */
export interface Popover<At extends PopAt> {
  /** The layer in the scroll's content. */
  readonly dom: HTMLElement;
  /** Where it's open, if it is. */
  readonly at: At | undefined;
  readonly pinned: boolean;
  readonly open: boolean;
  /** Whether focus is in it. */
  hasFocus(): boolean;
  /** What it shows at `at`, built ahead, unseen, for the pointer or the cursor that came to it. */
  build(at: At): void;
  /** The pointer came to a mark, or left the one it was on. */
  hover(at: At | undefined): void;
  /** A click on `at`'s mark: pinned there, or closed if it was. Says whether it's pinned now. */
  clicked(at: At): boolean;
  /** Pins it at `at`, the pane scrolled the least that shows it whole unless not `scroll`ed. */
  pin(at: At, scroll?: boolean): void;
  /** Focus into it: on its first comment with `ring`, else on the popover itself. */
  focus(ring?: boolean): void;
  /** Closes it, the comment box in it first; focus in it goes to its line unless not `focus`. */
  close(focus?: boolean): void;
  /** Closes it at once, and takes down what it holds, built ahead or fading. */
  clear(): void;
  /** What it shows changed: drawn again, and placed again. */
  refresh(): void;
  /** What draws it changed: drawn anew. */
  redraw(): void;
  /** Placed again where it is, by its lines as they are now. */
  place(): void;
  destroy(): void;
}

/** A code view's one thread popover: its layer, what's drawn in it, and how it comes and goes. */
export class ThreadPop<At extends PopAt> implements Popover<At> {
  /** The layer in the scroll's content: a scope of its own for the keys, `thread`. */
  readonly dom: HTMLElement;
  readonly #host: PopHost<At>;
  /** What the caller draws in, inside the layer: an element of its own each time it draws anew. */
  readonly #content: HTMLElement;
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
  /** Whether the key a preview heard was a modifier alone, which closes nothing. */
  #lone = false;
  #keyed: ReturnType<typeof setTimeout> | undefined;
  /** Whether focus is in it, or was until what it was on went, with nothing taking it since. */
  #focusedIn = false;
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
    // `Tab` goes through its links and controls, round from its last to its first, as in a dialog.
    this.dom.setAttribute(TAB_ATTRIBUTE, 'browser');
    this.dom.addEventListener('keydown', (event) => this.#tabbed(event));
    this.dom.addEventListener('focusin', () => {
      this.#focusedIn = true;
    });
    // Focus taken elsewhere: not focus lost as what it was on went.
    this.dom.addEventListener('focusout', (event) => {
      if (event.relatedTarget !== null) this.#focusedIn = false;
    });
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
    // A key closes a preview once the key listener says it's the reader's input, those Lo's
    // commands take, which go no further, among them. A modifier alone, which Lo's commands never
    // take, is told apart as it goes on past them.
    const heard = (): void => this.#heard();
    const alone = (event: KeyboardEvent): void => {
      if (MODIFIERS.includes(event.key)) this.#lone = true;
    };
    // The pane's scroll closes a preview, not a scroll of the comments in it.
    const wheeled = (event: WheelEvent): void => {
      const { target } = event;
      if (this.#state !== 'preview' || (target instanceof Node && this.dom.contains(target)))
        return;
      this.close();
    };
    document.addEventListener('pointerdown', pressed, true);
    document.addEventListener(KEY_EVENT, heard);
    window.addEventListener('keydown', alone, true);
    host.scroller.addEventListener('wheel', wheeled, { passive: true });
    this.#stops.push(
      () => document.removeEventListener('pointerdown', pressed, true),
      () => document.removeEventListener(KEY_EVENT, heard),
      () => window.removeEventListener('keydown', alone, true),
      () => host.scroller.removeEventListener('wheel', wheeled),
    );
    // Focus in it that falls to nothing as what it shows changes, as a thread with focus in it
    // goes from a popover of two, comes back to it.
    if (typeof MutationObserver !== 'undefined') {
      const kept = new MutationObserver(() => this.#refocus());
      kept.observe(this.#content, { childList: true, subtree: true });
      this.#stops.push(() => kept.disconnect());
    }
    // As what it shows grows or shrinks, as an image loads or a reply comes, it's placed again,
    // from the edge by its line.
    if (typeof ResizeObserver !== 'undefined') {
      this.#sized = new ResizeObserver(() => this.place());
      this.#sized.observe(this.#content);
    }
    // First in the scroll, out of its flow: what the view draws keeps its order after it.
    host.scroller.prepend(this.dom);
  }

  /** What draws it changed: drawn anew, by the new caller. */
  redraw(): void {
    this.#drop();
    if (this.#at && this.#state !== 'closed') this.#draw(this.#at);
  }

  /** Where it's open, if it is. */
  get at(): At | undefined {
    return this.#state === 'closed' ? undefined : this.#at;
  }

  /** What it's drawn for: where it's open, or what it built ahead while it's closed. */
  get built(): At | undefined {
    return this.#built;
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
   * it's pinned there, the comment box in it first. Says whether it's pinned now.
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

  /**
   * Pins it at `at`, as a key opens it, unless it's pinned there already: the pane scrolls the
   * least that shows it whole. Not `scroll`ed, as for what opens with no input of the reader's, it
   * goes where it has room on screen, as a preview does, and nothing on screen moves.
   */
  pin(at: At, scroll = true): void {
    if (this.#at?.key === at.key && this.#state === 'pinned') return;
    clearTimeout(this.#rest);
    this.#open(at, 'pinned', scroll);
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
   * Closes it, fading, the comment box in it first, keeping its draft. Focus in it goes to its line
   * as it starts to leave, unless `focus` is false, as for a press elsewhere, which takes it there.
   */
  close(focus = true): void {
    if (this.#state === 'closed') return;
    const at = this.#at!;
    const held = this.hasFocus();
    this.#host.release(at);
    // What letting the box go did may have closed it already.
    if (!this.open) return;
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
   * Closes it at once, with no fade, and takes down what it holds, built ahead or fading: nothing
   * will open it, and an empty shell mustn't fade out over the code.
   */
  clear(): void {
    this.close(false);
    this.#leaving?.();
    this.#leaving = undefined;
    this.dom.hidden = true;
    delete this.dom.dataset.endingStyle;
    this.#drop();
  }

  /**
   * What it shows changed, as its threads did: drawn again, and placed again. Its threads gone, it
   * closes, focus in it going to the line.
   */
  refresh(): void {
    const at = this.#state === 'closed' ? this.#built : this.#at;
    if (!at || !this.#drawn) return;
    const view = this.#host.view(at, this.#state === 'pinned');
    if (nothingIn(view)) {
      if (this.#state !== 'closed') this.close();
      this.#drop();
      return;
    }
    this.#drawn.update(view);
    this.#host.drawn(at);
    if (this.#state !== 'closed') this.#host.shown(at);
  }

  /**
   * Places it again where it is, by its lines as they are now, as a resize asks, as tall as the
   * pane lets it be now.
   */
  place(): void {
    if (this.#state === 'closed' || !this.#at) return;
    const lines = this.#host.lines(this.#at);
    // Its lines aren't drawn now, as their file closed.
    if (!lines) {
      this.close();
      return;
    }
    const room = this.#host.room(this.#at);
    this.dom.style.setProperty('--lo-pop-max', `${popMax(room)}px`);
    this.#put(placePop(room, lines, this.#content.offsetHeight, this.#side));
  }

  destroy(): void {
    clearTimeout(this.#rest);
    clearTimeout(this.#crossing);
    clearTimeout(this.#keyed);
    this.#leaving?.();
    this.#sized?.disconnect();
    for (const stop of this.#stops) stop();
    this.#drop();
    this.dom.remove();
  }

  /** Draws what it shows at `at`, unseen. */
  #draw(at: At): void {
    const render = this.#host.render(at);
    if (!render) return;
    const view = this.#host.view(at, this.#state === 'pinned');
    if (nothingIn(view)) return;
    if (this.#drawn && this.#built?.key === at.key) {
      this.#drawn.update(view);
      this.#host.drawn(at);
      return;
    }
    this.#drop();
    this.#built = at;
    // An element of its own each time: what was drawn before may still be going.
    const host = document.createElement('div');
    this.#content.replaceChildren(host);
    this.#drawn = render(host, view, () => this.close());
    this.#host.drawn(at);
  }

  #drop(): void {
    const drawn = this.#drawn;
    this.#drawn = undefined;
    this.#built = undefined;
    drawn?.destroy();
    this.#content.replaceChildren();
  }

  /**
   * Opens it at `at`: placed, and whole, in the frame it's first seen in. Pinned, it's placed as a
   * key opens it, with the least scroll, unless not `scroll`ed. One open on another line, holding
   * a comment box, lets the box go first.
   */
  #open(at: At, state: 'preview' | 'pinned', scroll = true): void {
    const lines = this.#host.lines(at);
    if (!lines || !this.#host.render(at)) return;
    if (this.#state !== 'closed' && this.#at && this.#at.key !== at.key) {
      this.#host.release(this.#at);
    }
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
    const room = this.#host.room(at);
    this.dom.style.setProperty('--lo-pop-max', `${popMax(room)}px`);
    this.dom.style.width = `${across(lines, room.width, room.edge).width}px`;
    // Laid out unseen, as wide as it goes, to be measured and placed before it's seen.
    this.dom.style.visibility = 'hidden';
    this.dom.hidden = false;
    const placed = placePop(
      room,
      lines,
      this.#content.offsetHeight,
      state === 'pinned' && scroll ? 'opened' : 'preview',
    );
    if (placed.scroll !== 0) this.#host.scrollBy(placed.scroll, at);
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
    this.#host.drawn(this.#at);
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

  /**
   * A press anywhere: one outside it and its mark closes it, unless it holds a comment box being
   * written, which only the box closing closes.
   */
  #pressed(event: Event): void {
    if (this.#state === 'closed' || !this.#at) return;
    const { target } = event;
    if (!(target instanceof Element) || this.dom.contains(target)) return;
    if (this.#host.onMark(target, this.#at) || this.#host.holds(this.#at)) return;
    // What it opened over everything, as its thread's menu, is its own.
    if (target.closest(OVER) !== null) return;
    this.close(false);
  }

  /**
   * A key closes a preview, once its keydown has gone as far as it goes: a modifier alone goes on
   * to say so first.
   */
  #heard(): void {
    if (this.#state !== 'preview') return;
    this.#lone = false;
    clearTimeout(this.#keyed);
    this.#keyed = setTimeout(() => {
      if (this.#state === 'preview' && !this.#lone) this.close();
    }, 0);
  }

  /**
   * `Tab` in it goes to its next link or control, as the page's own does, and from its last round
   * to its first, as in a dialog; `⇧Tab` the other way. It never takes focus out of it.
   */
  #tabbed(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.dom.contains(active)) return;
    const stops = tabStops(this.dom);
    const way = event.shiftKey
      ? Node.DOCUMENT_POSITION_PRECEDING
      : Node.DOCUMENT_POSITION_FOLLOWING;
    if (stops.some((stop) => stop !== active && (active.compareDocumentPosition(stop) & way) !== 0))
      return;
    event.preventDefault();
    const to = event.shiftKey ? stops.at(-1) : stops[0];
    to?.focus();
  }

  /** Focus that was in it, left with nothing as what it was on went, comes back to it. */
  #refocus(): void {
    if (this.#state === 'closed' || !this.#focusedIn || this.hasFocus()) return;
    const active = document.activeElement;
    if (active === null || active === document.body) this.focus(false);
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

/** A code view with a handle on the popover it shares: what it asks of it, and its own number. */
interface Member {
  readonly id: number;
  readonly host: PopHost<PopAt>;
}

/** Where a shared popover opens: a view's place, by a key no other view's place has. */
interface Owned extends PopAt {
  readonly at: PopAt;
  readonly member: Member;
}

/** The popover the code views in one scroll share, by the scroll. */
const sharedPops = new WeakMap<HTMLElement, SharedPop>();

/**
 * A handle on the one popover of the code views in `host`'s scroll, as an overview's code blocks
 * share theirs: one layer, made with the first handle and taken down with the last. Open for one
 * view's lines, it's open for no other's: each view sees it open, pinned, focused or drawn only
 * while it's at its own lines, and a view's pointer previews nothing while another's is pinned.
 */
export function sharedPop<At extends PopAt>(host: PopHost<At>): Popover<At> {
  let shared = sharedPops.get(host.scroller);
  if (!shared) {
    shared = new SharedPop(host.scroller);
    sharedPops.set(host.scroller, shared);
  }
  return new SharedHandle<At>(shared, shared.join(host));
}

/** One popover for the code views in a scroll, which asks of each view about its own places. */
class SharedPop {
  readonly pop: ThreadPop<Owned>;
  readonly #scroller: HTMLElement;
  readonly #members = new Set<Member>();
  #next = 0;
  /** The view it was last shown open for, told as it closes or opens for another view. */
  #shownFor: Member | undefined;

  constructor(scroller: HTMLElement) {
    this.#scroller = scroller;
    this.pop = new ThreadPop<Owned>({
      scroller,
      render: (owned) => owned.member.host.render(owned.at),
      lines: (owned) => owned.member.host.lines(owned.at),
      room: (owned) => owned.member.host.room(owned.at),
      view: (owned, pinned) => owned.member.host.view(owned.at, pinned),
      shown: (owned) => {
        const was = this.#shownFor;
        this.#shownFor = owned?.member;
        if (was && was !== owned?.member) was.host.shown(undefined);
        if (owned) owned.member.host.shown(owned.at);
      },
      focusLine: (owned) => owned.member.host.focusLine(owned.at),
      scrollBy: (by, owned) => owned.member.host.scrollBy(by, owned.at),
      onMark: (target, owned) => owned.member.host.onMark(target, owned.at),
      holds: (owned) => owned.member.host.holds(owned.at),
      release: (owned) => owned.member.host.release(owned.at),
      drawn: (owned) => owned.member.host.drawn(owned.at),
    });
  }

  /** A view takes a handle on it. */
  join(host: PopHost<PopAt>): Member {
    const member = { id: this.#next++, host };
    this.#members.add(member);
    return member;
  }

  /** A view lets its handle go: what it drew for the view goes, and with the last view, it all. */
  leave(member: Member): void {
    if (!this.#members.delete(member)) return;
    if (this.pop.built?.member === member) this.pop.clear();
    if (this.#shownFor === member) this.#shownFor = undefined;
    if (this.#members.size > 0) return;
    this.pop.destroy();
    if (sharedPops.get(this.#scroller) === this) sharedPops.delete(this.#scroller);
  }
}

/** A view's handle on the popover it shares, which sees it only as it's at the view's lines. */
class SharedHandle<At extends PopAt> implements Popover<At> {
  readonly #shared: SharedPop;
  readonly #member: Member;
  /** The view's places it's been handed, by their keys as the shared popover knows them. */
  readonly #places = new Map<string, At>();

  constructor(shared: SharedPop, member: Member) {
    this.#shared = shared;
    this.#member = member;
  }

  get dom(): HTMLElement {
    return this.#shared.pop.dom;
  }

  get at(): At | undefined {
    return this.#mine(this.#shared.pop.at);
  }

  get pinned(): boolean {
    return this.#shared.pop.pinned && this.open;
  }

  get open(): boolean {
    return this.at !== undefined;
  }

  hasFocus(): boolean {
    return this.open && this.#shared.pop.hasFocus();
  }

  build(at: At): void {
    this.#shared.pop.build(this.#own(at));
  }

  hover(at: At | undefined): void {
    this.#shared.pop.hover(at && this.#own(at));
  }

  clicked(at: At): boolean {
    return this.#shared.pop.clicked(this.#own(at));
  }

  pin(at: At, scroll = true): void {
    this.#shared.pop.pin(this.#own(at), scroll);
  }

  focus(ring = true): void {
    if (this.open) this.#shared.pop.focus(ring);
  }

  close(focus = true): void {
    if (this.open) this.#shared.pop.close(focus);
  }

  clear(): void {
    if (this.#drawsHere()) this.#shared.pop.clear();
  }

  refresh(): void {
    if (this.#drawsHere()) this.#shared.pop.refresh();
  }

  redraw(): void {
    if (this.#drawsHere()) this.#shared.pop.redraw();
  }

  place(): void {
    if (this.open) this.#shared.pop.place();
  }

  destroy(): void {
    this.#shared.leave(this.#member);
  }

  /** `at`, as the shared popover knows it. */
  #own(at: At): Owned {
    const key = `${this.#member.id}|${at.key}`;
    this.#places.set(key, at);
    return { key, at, member: this.#member };
  }

  /** The view's own place, of `owned`, if it's the view's. */
  #mine(owned: Owned | undefined): At | undefined {
    return owned?.member === this.#member ? this.#places.get(owned.key) : undefined;
  }

  /** Whether what's drawn in it, open or built ahead, is the view's. */
  #drawsHere(): boolean {
    return this.#shared.pop.built?.member === this.#member;
  }
}
