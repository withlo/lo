// The panels in a pull request's tab's row, each as wide as the row lets it be, so only they draw
// again as a width changes: what they hold is handed in, drawn by the tab, and stays as it was. The
// left panel has an edge to drag.

import { Splitter } from '@lo/ui';
import type { ReactNode, Ref } from 'react';

import { layout, row, useClosing, useRow, useStepped } from './layout.ts';
import { panels } from './panels.ts';

export interface LeftPanelProps {
  readonly tab: string;
  /** Whether the threads panel is drawn beside it. */
  readonly threads: boolean;
  /** The pull request can't be shown: the panel is dimmed and inert, and its edge isn't there. */
  readonly failed: boolean;
  readonly children: ReactNode;
}

/**
 * The left panel, the stack and files, and its edge. A drag on the edge sets its width as it ends
 * somewhere new, which the window keeps for every tab; let go within reach of the window's side, it
 * closes the panel, and shows it gone from there. Anything else puts back the width it had.
 */
export function LeftPanel({ tab, threads, failed, children }: LeftPanelProps) {
  const drawn = useRow({ left: true, threads });
  const stepped = useStepped();
  const closing = useClosing();
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
          onDrag={(value, close) => row.setState({ drag: { left: value, closing: close } })}
          onEnd={(value) => {
            layout.setState({ left: value });
            row.setState({ drag: undefined });
          }}
          onCancel={() => row.setState({ drag: undefined })}
          onReset={() => layout.setState({ left: undefined })}
          onClose={() => {
            row.setState({ drag: undefined });
            panels.update(tab, (current) => ({ ...current, leftOpen: false }));
          }}
        />
      )}
    </>
  );
}

export interface RightPanelProps {
  /** Whether the left panel is drawn beside it. */
  readonly left: boolean;
  readonly label: string | undefined;
  /** Its view's id. */
  readonly view: string;
  readonly ref?: Ref<HTMLElement> | undefined;
  readonly children: ReactNode;
}

/** The right panel, as wide as the row lets the threads panel be. */
export function RightPanel({ left, label, view, ref, children }: RightPanelProps) {
  const drawn = useRow({ left, threads: true }).threads;
  return (
    <aside
      ref={ref}
      className="flex min-w-0 flex-none flex-col bg-bg-chrome"
      style={{ width: drawn }}
      aria-label={label}
      data-lo-right={view}
    >
      {children}
    </aside>
  );
}
