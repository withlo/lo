// The panels in a pull request's tab's row, each as wide as the row lets it be, so only they draw
// again as a width changes: what they hold is handed in, drawn by the tab, and stays as it was. Each
// has an edge to drag, on the middle's side.

import { Splitter, type SplitterProps } from '@lo/ui';
import type { ReactNode, Ref } from 'react';

import {
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
  return (
    <>
      <aside
        className={`${closing ? 'hidden' : 'flex'} min-w-0 flex-none flex-col bg-bg-chrome ${failed ? 'controls-off' : ''}`}
        style={{ width }}
        aria-label="Files"
        inert={failed}
        data-lo-left=""
      >
        {children}
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
        ref={ref}
        className={`${closing ? 'hidden' : 'flex'} min-w-0 flex-none flex-col bg-bg-chrome`}
        style={{ width }}
        aria-label={label}
        data-lo-right={view}
      >
        {children}
      </aside>
    </>
  );
}
