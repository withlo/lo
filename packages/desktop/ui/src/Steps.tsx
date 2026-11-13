import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

/**
 * How a step stands: not yet, being done now, done, stopped at, or passed over since what came
 * before it stopped.
 */
export type StepState = 'todo' | 'now' | 'done' | 'stopped' | 'skipped';

export interface StepItem {
  /** What tells it from the others, for React. */
  readonly key: string;
  readonly state: StepState;
  /** What the step is. */
  readonly title: ReactNode;
  /** A line under it: what's happening, or why it stopped. */
  readonly detail?: ReactNode;
}

export interface StepsProps {
  /** The steps, in the order they're done. */
  steps: readonly StepItem[];
  /** What the list is called, for screen readers. */
  label: string;
}

const row = cva('grid step text-ui', {
  variants: {
    state: {
      todo: 'text-fg',
      now: 'text-fg',
      done: 'text-fg',
      stopped: 'text-fg',
      skipped: 'text-fg-dim',
    },
  },
});

const ball = cva('row-span-2 step-ball font-semibold text-micro', {
  variants: {
    state: {
      todo: 'text-fg-muted',
      now: 'bg-accent text-on-accent step-ball-filled',
      done: 'bg-success-bg text-success step-ball-filled',
      stopped: 'bg-danger-bg text-danger step-ball-filled',
      skipped: 'text-fg-dim',
    },
  },
});

/** What a screen reader says of each state, before the step. */
const SAID: Readonly<Record<StepState, string>> = {
  todo: 'Not yet',
  now: 'Now',
  done: 'Done',
  stopped: 'Stopped',
  skipped: 'Not done',
};

/** The ball's mark: the step's number until it's done or stopped at. */
function mark(state: StepState, place: number): string {
  if (state === 'done') return '✓';
  if (state === 'stopped') return '!';
  return String(place);
}

/**
 * Ordered steps, each with a ball: an empty ring with its number not yet, the accent while it's
 * being done, a tick once done, and a mark where it stopped. What it shows of an operation that
 * runs a step at a time, such as making a GitHub stack.
 */
export function Steps({ steps, label }: StepsProps) {
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-col steps p-0">
      {steps.map((step, index) => (
        <li
          key={step.key}
          className={row({ state: step.state })}
          aria-current={step.state === 'now' ? 'step' : undefined}
        >
          <span className={ball({ state: step.state })} aria-hidden="true">
            {mark(step.state, index + 1)}
          </span>
          <span className="min-w-0">
            <span className="sr-only">{`${SAID[step.state]}: `}</span>
            {step.title}
          </span>
          {step.detail !== undefined && (
            <span className="col-start-2 min-w-0 text-fg-muted text-small">{step.detail}</span>
          )}
        </li>
      ))}
    </ol>
  );
}
