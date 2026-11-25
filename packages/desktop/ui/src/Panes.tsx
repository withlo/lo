// A row of panes and the edges between them, which the reader drags to resize what's beside them:
// a `Panes` row, its panes as wide as they're given or the rest, and a `Splitter` at each edge that
// moves. Every edge in Lo is one, so a feature never handles a drag of its own. `fit` works out how
// wide each pane is drawn.
//
// An edge gives 8 px to grab (`lo-splitter-w`), centred on it and shifted off a scrollbar under it,
// or the whole gap between two views. At rest it draws nothing, since the surfaces' step divides
// them; under the pointer, a 2 px `lo-border` line its full height; pressed, or moved by a key,
// `lo-accent`, as the gutter's `+` spends the accent on a press. It isn't a `Tab` stop, and has no
// tooltip: the keys that move it act on what has focus. The drag itself is `dragEdge`'s, which an
// edge drawn outside React uses too.

import { useEffect, useLayoutEffect, useRef, type HTMLAttributes } from 'react';
import { flushSync } from 'react-dom';

import { dragEdge, limitOf } from './drag.ts';
import type { Range } from './fit.ts';

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
   * Each frame of a drag, once the pointer has moved: the width the pointer asks for, within the
   * range, and, with `onClose`, whether letting go there closes the pane, which then shows gone.
   * Draw it, but save nothing yet.
   */
  readonly onDrag: (value: number, closing: boolean) => void;
  /** A drag let go, or ended by the window losing focus, at a new width: save it. */
  readonly onEnd: (value: number) => void;
  /**
   * A press that changed nothing: one with no move, one moved back to where it started, `Esc`, or a
   * drag stopped because the edge went. Put back what was saved at the press.
   */
  readonly onCancel: () => void;
  /** A double-click: back to its default. */
  readonly onReset: () => void;
  /**
   * For a panel's edge: let go within `CLOSE_REACH` of the window's side the panel is on, it closes
   * the panel instead of ending, and its saved width stays.
   */
  readonly onClose?: (() => void) | undefined;
}

/**
 * An edge between two panes that the pointer drags, with `dragEdge`. It follows the pointer each
 * frame and stops at its range's ends. Only a drag that moves it somewhere new ends with a width;
 * anything else cancels, `Esc` among them, and the caller puts back what was saved at the press. A
 * drag under way when the edge goes, as when its tab closes, cancels. A double-click puts it back
 * to its default.
 */
export function Splitter(props: SplitterProps) {
  const { label, value, range, grows = 'end', gap = false, shift, stepped = false } = props;
  const latest = useRef(props);
  latest.current = props;
  /** Stops the drag under way, if one: it then cancels. */
  const cancel = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancel.current?.(), []);

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
      data-at={limitOf(value, range)}
      data-stepped={stepped ? '' : undefined}
      className="splitter"
      onPointerDown={(event) => {
        if (cancel.current) return;
        const done = () => {
          cancel.current = undefined;
        };
        cancel.current = dragEdge(event.currentTarget, event.nativeEvent, {
          from: value,
          range: () => latest.current.range,
          grows,
          // Drawn in the frame the pointer moved in, not the next.
          onDrag: (to, closing) => flushSync(() => latest.current.onDrag(to, closing)),
          onEnd: (to) => {
            done();
            latest.current.onEnd(to);
          },
          onCancel: () => {
            done();
            latest.current.onCancel();
          },
          onClose:
            props.onClose &&
            (() => {
              done();
              latest.current.onClose?.();
            }),
        });
      }}
      onDoubleClick={() => latest.current.onReset()}
    />
  );
}
