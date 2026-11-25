// A row of panes and the edges between them, which the reader drags to resize what's beside them:
// a `Panes` row, its panes as wide as they're given or the rest, and a `Splitter` at each edge that
// moves. Every edge in Lo is one, so a feature never handles a drag of its own. `fit` works out how
// wide each pane is drawn.
//
// An edge gives 8 px to grab (`lo-splitter-w`), centred on it and shifted off a scrollbar under it,
// or the whole gap between two views. At rest it draws nothing, since the surfaces' step divides
// them; under the pointer, a 2 px `lo-border` line its full height; pressed, or moved by a key,
// `lo-accent`, as the gutter's `+` spends the accent on a press. It isn't a `Tab` stop, and has no
// tooltip: the keys that move it act on what has focus.

import { useLayoutEffect, useRef, useState, type HTMLAttributes, type PointerEvent } from 'react';
import { flushSync } from 'react-dom';

import { takeKeys } from './commands/listener.ts';
import type { Range } from './fit.ts';

/** How near the window's side a panel's edge is let go to close the panel. */
export const CLOSE_REACH = 110;

/** How far a key moves an edge. */
export const KEY_STEP = 32;

export interface PanesProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The row's width, in CSS pixels, each time it changes: as it's first drawn, and as the window
   * resizes, in the frame it's laid out, before it's painted.
   */
  readonly onWidth?: ((width: number) => void) | undefined;
}

/**
 * A row of panes, each drawn as its own layer, so the edges between them sit over what they hold.
 * Give a pane a width and `flex-none`, or let one take the rest with `flex-1`.
 */
export function Panes({ onWidth, className = '', children, ...rest }: PanesProps) {
  const row = useRef<HTMLDivElement>(null);
  const said = useRef(onWidth);
  said.current = onWidth;
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return undefined;
    said.current?.(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(([entry]) => {
      const width = entry?.borderBoxSize[0]?.inlineSize ?? element.getBoundingClientRect().width;
      // In this frame, so no frame draws the panes at the width the row had.
      flushSync(() => said.current?.(width));
    });
    watch.observe(element);
    return () => watch.disconnect();
  }, []);
  return (
    <div ref={row} className={`panes ${className}`} {...rest}>
      {children}
    </div>
  );
}

export interface SplitterProps {
  /** What a screen reader calls it: "Resize left panel". */
  readonly label: string;
  /** The width it sizes, as drawn now. */
  readonly value: number;
  /** How far it goes: as `fit` gives an edge. */
  readonly range: Range;
  /**
   * Which way the pointer goes to widen what it sizes: `end` for what's before the edge, as the
   * left panel is; `start` for what's after it, as the threads panel is.
   */
  readonly grows?: 'end' | 'start';
  /** It's the gap between two views, all of which it gives to grab, rather than an edge. */
  readonly gap?: boolean;
  /** Which way to shift what it gives to grab, off a scrollbar under the edge. */
  readonly shift?: 'start' | 'end' | undefined;
  /** A key moved it, and is held: it draws as pressed. */
  readonly stepped?: boolean;
  /**
   * Each frame of a drag: the width the pointer asks for, within the range, and, with `onClose`,
   * whether letting go there closes the pane, which then shows gone.
   */
  readonly onDrag: (value: number, closing: boolean) => void;
  /** Let go, `Esc` (with the width the press found), or the window lost focus: where it ends. */
  readonly onEnd: (value: number) => void;
  /** A double-click: back to its default. */
  readonly onReset: () => void;
  /**
   * For a panel's edge: let go within `CLOSE_REACH` of the window's side the panel is on, it closes
   * the panel, and keeps the width the press found.
   */
  readonly onClose?: (() => void) | undefined;
}

/** What a drag under way holds. */
interface Drag {
  readonly pointer: number;
  readonly element: HTMLElement;
  /** Where the pointer was pressed. */
  readonly x: number;
  /** The width the press found. */
  readonly from: number;
  /** The width it's at now, and whether letting go now closes the pane. */
  at: number;
  closing: boolean;
  /** Stops what the drag listens to. */
  readonly stop: () => void;
}

/** Which limit `value` is at, if one, for the cursor that says it can only go the other way. */
function limitOf(value: number, range: Range): 'min' | 'max' | undefined {
  if (range.max - range.min < 0.5) return undefined;
  if (value <= range.min + 0.5) return 'min';
  if (value >= range.max - 0.5) return 'max';
  return undefined;
}

/** The cursor at `limit` for an edge that `grows` one way: the arrow points the way left to go. */
function cursorAt(limit: 'min' | 'max' | undefined, grows: 'end' | 'start'): 'col' | 'e' | 'w' {
  if (limit === undefined) return 'col';
  return (limit === 'min') === (grows === 'end') ? 'e' : 'w';
}

/**
 * An edge between two panes that the pointer drags. It follows the pointer each frame and stops at
 * its range's ends. `Esc` puts it back where the press found it. Nothing is selected or hovered
 * meanwhile, and the pointer can leave the window, but the window losing focus ends it there. A
 * double-click puts it back to its default.
 */
export function Splitter(props: SplitterProps) {
  const { label, value, range, grows = 'end', gap = false, shift, stepped = false } = props;
  const latest = useRef(props);
  latest.current = props;
  const drag = useRef<Drag | undefined>(undefined);
  const [pressed, setPressed] = useState(false);
  const limit = limitOf(value, range);

  /** Ends the drag under way, at `at`, closing the pane if `close` and it can. */
  const finish = (at: number, close: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = undefined;
    current.stop();
    setPressed(false);
    const { onEnd, onClose } = latest.current;
    if (close && onClose) {
      onEnd(current.from);
      onClose();
    } else {
      onEnd(at);
    }
  };

  /** Where the pointer at `x` puts the edge, and whether letting go there closes the pane. */
  const follow = (current: Drag, x: number) => {
    const now = latest.current;
    const way = now.grows ?? 'end';
    const moved = (x - current.x) * (way === 'end' ? 1 : -1);
    current.at = Math.max(now.range.min, Math.min(now.range.max, current.from + moved));
    const window = current.element.ownerDocument.defaultView;
    current.closing =
      now.onClose !== undefined &&
      window !== null &&
      (way === 'end' ? x <= CLOSE_REACH : x >= window.innerWidth - CLOSE_REACH);
    const root = current.element.ownerDocument.documentElement;
    root.dataset.loResizing = cursorAt(limitOf(current.at, now.range), way);
    // Drawn in the frame the pointer moved in, not the next.
    flushSync(() => now.onDrag(current.at, current.closing));
  };

  const press = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current) return;
    // Focus stays where it was, so the keys go on acting on it, and no text is selected.
    event.preventDefault();
    const element = event.currentTarget;
    const document = element.ownerDocument;
    const window = document.defaultView;
    element.setPointerCapture(event.pointerId);
    const root = document.documentElement;
    root.dataset.loResizing = cursorAt(limit, grows);
    const stopKeys = takeKeys((key) => {
      if (key.key !== 'Escape' || !drag.current) return false;
      const current = drag.current;
      latest.current.onDrag(current.from, false);
      finish(current.from, false);
      return true;
    });
    const blur = () => {
      if (drag.current) finish(drag.current.at, false);
    };
    window?.addEventListener('blur', blur);
    drag.current = {
      pointer: event.pointerId,
      element,
      x: event.clientX,
      from: value,
      at: value,
      closing: false,
      stop: () => {
        stopKeys();
        window?.removeEventListener('blur', blur);
        delete root.dataset.loResizing;
        if (element.hasPointerCapture(event.pointerId))
          element.releasePointerCapture(event.pointerId);
      },
    };
    setPressed(true);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(range.min)}
      aria-valuemax={Math.round(range.max)}
      data-lo-splitter={gap ? 'gap' : 'edge'}
      data-grows={grows}
      data-shift={shift}
      data-at={limit}
      data-pressed={pressed || stepped ? '' : undefined}
      className="splitter"
      onPointerDown={press}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current?.pointer === event.pointerId) follow(current, event.clientX);
      }}
      onPointerUp={(event) => {
        const current = drag.current;
        if (current?.pointer !== event.pointerId) return;
        follow(current, event.clientX);
        finish(current.at, current.closing);
      }}
      onPointerCancel={() => {
        if (drag.current) finish(drag.current.at, false);
      }}
      onLostPointerCapture={() => {
        if (drag.current) finish(drag.current.at, false);
      }}
      onDoubleClick={() => latest.current.onReset()}
    />
  );
}
