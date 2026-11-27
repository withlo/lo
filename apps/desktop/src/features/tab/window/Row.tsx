// The panels in a pull request's tab's row, each as wide as the row lets it be, and the one view or
// two between them, each a sheet, so only they draw again as a width changes: what they hold is
// handed in, drawn by the tab, and stays as it was. Each panel has an edge to drag, on the middle's
// side, and two views the gap between them. A panel asked for fades in as it arrives, and so does a
// view that comes on screen, but for one the window's own widening brings back; focus in a panel
// goes back to the middle view as it goes, whatever takes it away.

import { handOffFocus, Splitter, swapIn, type SplitterProps, type ViewFocus } from '@lo/ui';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  type FocusEvent,
  type ReactNode,
  type Ref,
} from 'react';

import { focusMiddle } from '../../../window/commands/registry.ts';
import {
  arrives,
  closePanel,
  row,
  setReading,
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

/** A sheet of the middle: the reading view's, on the left, or the code's, on the right. */
export type Sheet = 'reading' | 'code';

export interface ViewsRowProps {
  /** Which panels the tab has views for, and whether it has a reading view and code. */
  readonly there: There;
  /** Which of two views has focus, for what's put away where there's room for one. */
  readonly focus: ViewFocus;
  /** Which sheets are drawn: both, side by side, or one of them alone. */
  readonly drawn: Sheet | 'both';
  /**
   * A drawn sheet that a switch brings on screen, drawn unseen while the view it shows lays out:
   * then it fades in over the sheet it replaces.
   */
  readonly coming?: Sheet | undefined;
  /**
   * A sheet no longer drawn that a switch leaves on screen, under the drawn ones and inert, until
   * what replaces it has faded in over it.
   */
  readonly going?: Sheet | undefined;
  /** The pull request can't be shown: the edge between two views isn't there. */
  readonly failed: boolean;
  /** What each sheet holds: its views, each drawn by the tab. */
  readonly reading: ReactNode;
  readonly code: ReactNode;
  /** What goes across the top of the code with two views, or of the one view: a run's bar. */
  readonly over: ReactNode;
  /** What each sheet is to a screen reader. */
  readonly labels: { readonly reading: string; readonly code: string };
  /** Focus coming into either sheet. */
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
  /** What's drawn over the whole middle: why the pull request can't be shown. */
  readonly children?: ReactNode;
}

/**
 * What the edge between two views does as it's dragged: it draws the drag's width for the reading
 * view, which the window keeps for every tab as a share of the two views' room only as the drag
 * ends somewhere new; anything else puts back what it had. A double-click puts back its default.
 */
function draggedViews(room: number): Omit<SplitterProps, 'label' | 'value' | 'range'> {
  return {
    onDrag: (width) => row.setState({ drag: { edge: 'views', width, closing: false } }),
    onEnd: (width) => {
      setReading(width / room);
      row.setState({ drag: undefined });
    },
    onCancel: () => row.setState({ drag: undefined }),
    onReset: () => setReading(undefined),
  };
}

/**
 * The middle of the row: one view, or with the code beside, the reading view's sheet and the
 * code's, `lo-sp-8` of chrome apart, that gap being the edge between them. The sheet not drawn
 * stays, unseen and inert, over the one that is, so what it holds keeps its place and is laid out
 * at the width it next comes at. A sheet that comes on screen fades in, unless the window's own
 * widening brought it back, or the tab is first drawn; one a switch brings, once what it shows has
 * laid out, over the one it replaces, which stays under it until then.
 */
export function ViewsRow({
  there,
  focus,
  drawn,
  coming,
  going,
  failed,
  reading,
  code,
  over,
  labels,
  onFocus,
  children,
}: ViewsRowProps) {
  const fitted = useRow(there, focus);
  const stepped = useStepped('views');
  const both = drawn === 'both';
  const [readingWidth = 0, codeWidth = 0] = fitted.views;
  const sheets = { reading: useRef<HTMLElement>(null), code: useRef<HTMLElement>(null) };
  const shows = (sheet: Sheet) => both || drawn === sheet;
  // On screen: drawn and not still coming, or left by a switch, under the one coming.
  const seen = (sheet: Sheet) => (shows(sheet) && sheet !== coming) || sheet === going;
  const last = useRef<{ reading: boolean; code: boolean; width: number | undefined }>(undefined);
  const width = row.getState().width;
  useLayoutEffect(() => {
    const now = { reading: seen('reading'), code: seen('code'), width };
    const was = last.current;
    last.current = now;
    if (!was || was.width !== width) return;
    for (const sheet of ['reading', 'code'] as const) {
      const element = sheets[sheet].current;
      if (!was[sheet] && now[sheet] && element) swapIn(element);
    }
  });
  const sheetClass = (sheet: Sheet) => {
    if (sheet === going) return 'absolute inset-0 -z-1 flex flex-col overflow-hidden sheet';
    if (!shows(sheet)) return 'invisible absolute inset-0 flex flex-col overflow-hidden sheet';
    const grows = both && sheet === 'reading' ? 'flex-none' : 'min-w-0 flex-1';
    const unseen = sheet === coming ? 'pointer-events-none opacity-0' : '';
    return `flex min-h-0 flex-col overflow-hidden sheet ${grows} ${unseen}`;
  };
  // With the bar of what's seen until what comes is.
  const overIn: Sheet = both ? 'code' : coming !== undefined && going !== undefined ? going : drawn;
  const sheetOf = (sheet: Sheet, content: ReactNode) => (
    <section
      ref={sheets[sheet]}
      className={sheetClass(sheet)}
      style={both && sheet === 'reading' ? { width: readingWidth } : undefined}
      aria-label={both ? labels[sheet] : 'Pull request'}
      inert={!shows(sheet)}
      data-lo-sheet={sheet}
      onFocus={onFocus}
    >
      {overIn === sheet && over}
      <div className="relative min-h-0 flex-1">{content}</div>
    </section>
  );
  return (
    <div
      className="relative isolate flex min-h-0 min-w-0 flex-1"
      data-lo-views={both ? 'two' : 'one'}
    >
      {sheetOf('reading', reading)}
      {both && !failed && (
        <Splitter
          label="Resize views"
          gap
          value={readingWidth}
          range={fitted.edges.views ?? { min: readingWidth, max: readingWidth }}
          stepped={stepped}
          {...draggedViews(readingWidth + codeWidth)}
        />
      )}
      {both && failed && <span className="w-splitter-w flex-none" />}
      {sheetOf('code', code)}
      {children}
    </div>
  );
}
