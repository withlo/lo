import type { ReactNode } from 'react';

import { withoutBidi } from './controls.ts';
import { Spinner } from './Spinner.tsx';
import { Steps, type StepState } from './Steps.tsx';

/** One layer of a stack. */
export interface LayerRow {
  number: number;
  /** Its title, as GitHub has it. */
  title: string;
  /**
   * Where it stands: `now` for the one on screen in a confirmation, or for the one GitHub is
   * working on in a merge's progress; `done` once it merged; `stopped` where GitHub stopped.
   */
  state: StepState;
  /** A line under it: "Approved · 14 checks passed · 12 files", "Rules passed". */
  detail?: ReactNode;
  /** GitHub is working on it, which a ring turning before the detail shows. */
  working?: boolean | undefined;
}

export interface LayerListProps {
  /** The layers, bottom first: the order GitHub merges them in. */
  layers: readonly LayerRow[];
  /** What the list is called, for screen readers: "Layers that will merge". */
  label: string;
}

/**
 * A stack's layers, bottom to top, each as a step with its number, title and where it stands: in
 * a confirmation, every layer that will merge; in a merge's progress, how far GitHub has got.
 */
export function LayerList({ layers, label }: LayerListProps) {
  return (
    <Steps
      label={label}
      steps={layers.map((layer) => ({
        key: String(layer.number),
        state: layer.state,
        title: (
          <>
            <strong className="font-semibold">#{layer.number}</strong> {withoutBidi(layer.title)}
          </>
        ),
        detail:
          layer.working === true ? (
            <span className="inline-flex items-center gap-8">
              <Spinner size="xs" />
              {layer.detail}
            </span>
          ) : (
            layer.detail
          ),
      }))}
    />
  );
}
