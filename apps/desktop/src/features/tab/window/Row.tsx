// The panels in a pull request's tab's row, each as wide as the row lets it be, so only they draw
// again as a width changes: what they hold is handed in, drawn by the tab, and stays as it was. Each
// has an edge to drag, on the middle's side. A panel asked for fades in as it arrives, and focus in
// one goes back to the middle view as it goes, whatever takes it away.

import { handOffFocus, Splitter, swapIn, type SplitterProps } from '@lo/ui';
import { useCallback, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';

import { focusMiddle } from '../../../window/commands/registry.ts';
import {
  arrives,
  closePanel,
  row,
  setWidth,
  useClosing,
  useRow,
  useStepped,
  type Edge,
  type There,
} from './layout.ts';

/**
 * What panel `edge`'s edge does as it's dragged: it draws the drag's width, which the window keeps
 * for every tab only as the drag ends somewhere new; let go within reach of the window's side, it
 * closes the panel, and shows it gone from there; anything else puts back the width it had. A
 * double-click puts back its default.
 */
function dragged(
  edge: Edge,
): Pick<SplitterProps, 'onDrag' | 'onEnd' | 'onCancel' | 'onReset' | 'onClose'> {
  return {
    onDrag: (width, closing) => row.setState({ drag: { edge, width, closing } }),
    onEnd: (width) => {
      setWidth(edge, width);
      row.setState({ drag: undefined });
    },
    onCancel: () => row.setState({ drag: undefined }),
    onReset: () => setWidth(edge, undefined),
    onClose: () => {
      row.setState({ drag: undefined });
      closePanel(edge);
    },
  };
}

/** Where focus in a panel that goes is handed: the middle view. */
const MIDDLE = [{ focus: () => focusMiddle() }];

/**
 * The ref for panel `edge`'s element, which also goes to `forward`. As the panel is drawn it fades
 * in, if it was asked for. As it stops being drawn, by whatever route, closed, put away for room or
 * gone with its tab, focus in it goes back to the middle view, rather than falling to the page.
 */
function usePanel(edge: Edge, forward?: Ref<HTMLElement>): (element: HTMLElement | null) => void {
  const panel = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    // The move ends by itself, and takes itself off the panel, even once it's gone.
    if (element && arrives(edge)) swapIn(element);
    return () => handOffFocus([element], () => MIDDLE);
  }, [edge]);
  return useCallback(
    (element: HTMLElement | null) => {
      panel.current = element;
      if (typeof forward === 'function') forward(element);
      else if (forward) forward.current = element;
    },
    [forward],
  );
}

/**
 * A panel's classes: while a drag that would close it is under way it's drawn 0 px wide, rather
 * than not at all, so focus in it stays there for the drag to give back, as the drag is let go or
 * brought back.
 */
function asideClass(closing: boolean): string {
  return `flex min-w-0 flex-none flex-col bg-bg-chrome ${closing ? 'overflow-hidden' : ''}`;
}

/**
 * The width a panel `width` wide lays out what it holds at, in the box inside it: its own, and
 * while a drag that would close it is under way, the last it had before, clipped, so nothing in it
 * wraps anew as the drag goes into the zone that closes it, or back out.
 */
function useHeldWidth(width: number, closing: boolean): number | undefined {
  const last = useRef(width);
  if (!closing) last.current = width;
  return closing ? last.current : undefined;
}

/** The box inside a panel that lays out what it holds, at `width` while it's set. */
function Held({ width, children }: { width: number | undefined; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ width }}>
      {children}
    </div>
  );
}

export interface LeftPanelProps {
  /** Which panels the tab has views for. */
  readonly there: There;
  /** The pull request can't be shown: the panel is dimmed and inert, and its edge isn't there. */
  readonly failed: boolean;
  readonly children: ReactNode;
}

/** The left panel, the stack and files, and its edge. */
export function LeftPanel({ there, failed, children }: LeftPanelProps) {
  const drawn = useRow(there);
  const stepped = useStepped('left');
  const closing = useClosing('left');
  const width = drawn.left ?? 0;
  const held = useHeldWidth(width, closing);
  const ref = usePanel('left');
  return (
    <>
      <aside
        ref={ref}
        className={`${asideClass(closing)} ${failed ? 'controls-off' : ''}`}
        style={{ width: closing ? 0 : width }}
        aria-label="Files"
        inert={failed}
        data-lo-left=""
      >
        <Held width={held}>{children}</Held>
      </aside>
      {!failed && (
        <Splitter
          label="Resize left panel"
          value={width}
          range={drawn.edges.left ?? { min: width, max: width }}
          stepped={stepped}
          {...dragged('left')}
        />
      )}
    </>
  );
}

export interface RightPanelProps {
  /** Which panels the tab has views for. */
  readonly there: There;
  /** The pull request can't be shown: its edge isn't there. */
  readonly failed: boolean;
  readonly label: string | undefined;
  /** Its view's id. */
  readonly view: string;
  readonly ref?: Ref<HTMLElement> | undefined;
  readonly children: ReactNode;
}

/** The right panel, as wide as the row lets the threads panel be, and its edge. */
export function RightPanel({ there, failed, label, view, ref, children }: RightPanelProps) {
  const drawn = useRow(there);
  const stepped = useStepped('threads');
  const closing = useClosing('threads');
  const width = drawn.threads ?? 0;
  const held = useHeldWidth(width, closing);
  const panel = usePanel('threads', ref);
  return (
    <>
      {!failed && (
        <Splitter
          label="Resize threads panel"
          value={width}
          range={drawn.edges.threads ?? { min: width, max: width }}
          grows="start"
          // Off the middle view's scrollbar, on the panel's side.
          shift="end"
          stepped={stepped}
          {...dragged('threads')}
        />
      )}
      <aside
        ref={panel}
        className={asideClass(closing)}
        style={{ width: closing ? 0 : width }}
        aria-label={label}
        data-lo-right={view}
      >
        <Held width={held}>{children}</Held>
      </aside>
    </>
  );
}
