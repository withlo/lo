// Review threads' marks, in a lane of their own between the line numbers and the code, drawn as
// every range is (`ranges.ts`): a bubble on the first row of each thread's last line, which says
// whether the thread is unresolved, resolved, pending or out of date, or that several end there,
// and a stem up the lane to a tick on its range's first line. Drafts not sent are ranges here too.
// The lane is there from the start, as wide with no marks as with them, so marks that come later
// change no line's width or height, and nothing on screen moves. A file's own threads have their
// bubble in its header's row, which the header draws, since its band covers the gutters.
//
// Each editor keeps its lane's cells in its state, worked out by whoever draws the threads only
// where they change, and mapped as its text changes in between: the gutter reads them as they are,
// and asks nothing of each line as it's drawn. Its bubbles are buttons a screen reader reaches, so
// the lane is the one gutter CodeMirror's `aria-hidden` doesn't cover.

import type { Extension, Text } from '@codemirror/state';
import { type EditorView, gutter, ViewPlugin } from '@codemirror/view';

import { type Bubble, bubbleElement, type LaneTone, sameBubble } from './bubbles.ts';
import {
  defineLane,
  type LaneHandle,
  type LaneMark,
  type LaneRange,
  type LaneUpdate,
  laneUpdate as rangeLaneUpdate,
  litRows,
} from './ranges.ts';

/**
 * A bubble on a line: what it says, the ranges it stands for (the threads ending there, as the
 * popover lists them, or a draft's own), whether its thread is open, and how it comes.
 */
export interface LaneBubble {
  readonly bubble: Bubble;
  readonly keys: readonly string[];
  readonly open: boolean;
  /** Whether its thread just came: it fades in. */
  readonly arriving?: boolean | undefined;
  /** The colour it was last drawn in, where that's changed since: it tints to its new one. */
  readonly was?: LaneTone | undefined;
}

/** A bubble as the lane's mark, which a click on runs its command, or opens its popover. */
class BubbleMark implements LaneMark {
  readonly keys: readonly string[];
  readonly arriving: boolean;
  readonly #bubble: LaneBubble;
  readonly #command: boolean;
  readonly #beside: boolean;

  constructor(bubble: LaneBubble, command: boolean, beside: boolean) {
    this.#bubble = bubble;
    this.keys = bubble.keys;
    this.arriving = bubble.arriving ?? false;
    this.#command = command;
    this.#beside = beside;
  }

  same(other: LaneMark): boolean {
    return (
      other instanceof BubbleMark &&
      other.#bubble.open === this.#bubble.open &&
      other.#command === this.#command &&
      other.#beside === this.#beside &&
      sameBubble(other.#bubble.bubble, this.#bubble.bubble)
    );
  }

  draw(lit: boolean, first: boolean): HTMLElement {
    const drawn = bubbleElement(this.#bubble.bubble, {
      open: this.#bubble.open,
      className: 'lo-lanebubble',
      command: this.#command,
      // It tints from the colour it had only as it's first drawn.
      was: first ? this.#bubble.was : undefined,
      beside: this.#beside,
    });
    if (lit) drawn.classList.add('is-lit');
    return drawn;
  }
}

/** The threads' lane in each editor's state. */
const lane = defineLane('threads');

/** The lane draws, in each part of the text, what each update says, as for a file's threads. */
export const setLane = lane.set;

/**
 * The lane's cells for the part of `doc` from `from` to `to`, by document line: a bubble on each
 * line of `bubbles`, and the stems of `ranges` beside each line they cover, those `lit` names in
 * their lit colours. `command` is false where the bubbles' view runs their clicks itself; `beside`
 * where threads show beside lines, where a stem opens its thread's popover. `handles` are the cells
 * that are an end of an open comment box's bracket.
 */
export function laneUpdate(
  doc: Text,
  span: { readonly from: number; readonly to: number },
  ranges: readonly LaneRange[],
  bubbles: ReadonlyMap<number, LaneBubble>,
  { command = true, beside = false, lit = new Set<string>(), handles }: LaneOptions = {},
): LaneUpdate {
  const marks = new Map<number, LaneMark>();
  for (const [line, bubble] of bubbles) marks.set(line, new BubbleMark(bubble, command, beside));
  return rangeLaneUpdate(doc, 'threads', span, ranges, marks, {
    lit,
    // A draft's stem isn't its mark: its bubble is.
    target: (range) => beside && range.tone !== 'muted',
    handles,
  });
}

/** How a lane update draws its threads. */
export interface LaneOptions {
  readonly command?: boolean | undefined;
  readonly beside?: boolean | undefined;
  readonly lit?: ReadonlySet<string> | undefined;
  readonly handles?: ReadonlyMap<number, LaneHandle> | undefined;
}

/**
 * Whether `event` is on a bubble, or, where threads show beside lines, on a stem's cell, which
 * opens its thread's popover too, or on an end of an open box's bracket, which drags.
 */
function onBubble(event: Event): boolean {
  const { target } = event;
  if (!(target instanceof Element)) return false;
  if (target.closest('.lo-bubble, .lo-handle') !== null) return true;
  return target.closest('.is-beside') !== null && besideMarker(target) !== undefined;
}

/**
 * The lane's cell `element` is in, where it draws a thread's mark, a bubble or a stem, which opens
 * its popover beside lines: none elsewhere.
 */
export function besideMarker(element: Element): HTMLElement | undefined {
  const cell = element.closest<HTMLElement>('.lo-threadlane .lo-lanecell');
  return cell?.querySelector('.lo-bubble, .lo-stem, .lo-tick') ? cell : undefined;
}

/**
 * CodeMirror hides its gutters from screen readers: what's in the lane, the bubbles, is theirs to
 * reach, so the lane alone is let out, and every other gutter is hidden on its own.
 */
const exposed = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.#expose(view);
    }

    update(update: { view: EditorView }): void {
      this.#expose(update.view);
    }

    #expose(view: EditorView): void {
      const gutters = view.contentDOM.previousElementSibling;
      if (!gutters?.classList.contains('cm-gutters')) return;
      if (gutters.hasAttribute('aria-hidden')) gutters.removeAttribute('aria-hidden');
      for (const each of gutters.children) {
        const hidden = !each.classList.contains('lo-threadlane');
        if (each.hasAttribute('aria-hidden') === hidden) continue;
        if (hidden) each.setAttribute('aria-hidden', 'true');
        else each.removeAttribute('aria-hidden');
      }
    }
  },
);

/**
 * The threads' lane, drawn from what the editor's state keeps of it (`setLane`), with the rows of
 * the code view's lit range (`setLit`). A press on a bubble or a handle leaves focus, and what's
 * selected, where they are; its click is the view's, which runs the bubble's command, and its drag
 * the handle's.
 */
export function threadLane(): Extension {
  return [
    lane.field,
    litRows(),
    gutter({
      class: 'lo-threadlane',
      markers: lane.cells,
      widgetMarker: lane.widgetMarker,
      lineMarkerChange: (update) =>
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setLane)),
        ),
      domEventHandlers: {
        mousedown: (_view, _line, event) => {
          if (!onBubble(event)) return false;
          event.preventDefault();
          return true;
        },
      },
    }),
    exposed,
  ];
}
