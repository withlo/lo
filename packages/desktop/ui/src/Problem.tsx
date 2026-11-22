import { cva } from 'class-variance-authority';
import { useId, useState, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import { Collapse } from './Collapse.tsx';
import { CopyButton, useCopy } from './CopyButton.tsx';
import { Key } from './Key.tsx';

/** The one thing to do about a problem. Its label starts with a verb: "Try again". */
export interface ProblemAction {
  label: string;
  onClick: () => void;
  /** Its key, as the system shows each key of it. */
  keys?: readonly string[] | undefined;
  /**
   * It's being done: the button is busy, and says `working`. Pass `false` while it rests, for an
   * action that can be busy, as to a `Button`.
   */
  busy?: boolean | undefined;
  /** What the button says while busy: "Trying again…". */
  working?: string | undefined;
}

export interface ProblemProps {
  /** What failed, in a few words with no status code in them: "Couldn't fetch the diff". */
  title: ReactNode;
  /** Why, or what to do about it, in a sentence. */
  reason?: ReactNode;
  action?: ProblemAction | undefined;
  /**
   * What came back, as it came: the status, GitHub's own words, a path. It stays behind a Details
   * button, with a Copy button, and is the only place raw text shows. Copy goes through the window's
   * `CopyRoute`.
   */
  details?: string | undefined;
  /**
   * `view` when a whole view failed and this takes its place, with nothing drawn behind it;
   * `inline` when an action failed, shown by its control: above a dialog's foot, in a panel.
   */
  layout?: 'view' | 'inline' | undefined;
}

const problem = cva('min-w-0 text-ui', {
  variants: {
    layout: {
      view: 'flex h-full flex-col items-center justify-center gap-12 p-32 text-center',
      inline: 'flex flex-col rounded-md border border-danger-border bg-danger-bg p-12 text-small',
    },
  },
});

/**
 * Something that went wrong, in one shape wherever it shows: what failed, why, the one
 * thing to do about it, and the raw text behind Details. It's said once, here: no toast or second
 * line repeats it. A screen reader hears what failed and why at once, as an alert, and not its
 * buttons.
 */
export function Problem({ title, reason, action, details, layout = 'inline' }: ProblemProps) {
  const copy = useCopy();
  const [detailed, setDetailed] = useState(false);
  const detailsId = useId();
  const view = layout === 'view';
  const act = action && (
    <Button
      variant={view ? 'primary' : 'secondary'}
      size={view ? 'md' : 'sm'}
      busy={action.busy}
      working={action.working}
      onClick={action.onClick}
    >
      {action.label}
      {action.keys && <Key keys={action.keys} decorative />}
    </Button>
  );
  const more = details !== undefined && (
    <Button
      variant="ghost"
      size="sm"
      aria-expanded={detailed}
      aria-controls={detailsId}
      onClick={() => setDetailed((was) => !was)}
    >
      Details
    </Button>
  );
  return (
    <div className={problem({ layout })}>
      {view ? (
        <>
          <div role="alert" className="flex max-w-read-measure flex-col gap-4">
            <p className="m-0 text-title">{title}</p>
            {reason !== undefined && <p className="m-0 text-fg-muted">{reason}</p>}
          </div>
          {(act || more) && (
            <div className="flex items-center gap-8">
              {act}
              {more}
            </div>
          )}
        </>
      ) : (
        <div className="flex items-start gap-8">
          <svg
            className="lo-i lo-i--sm mt-2 flex-none text-danger"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9.5a1 1 0 0 1-.87 1.5H2.8a1 1 0 0 1-.87-1.5Z" />
            <path d="M8 6.25v3M8 11.25v.01" />
          </svg>
          {/* What failed on a line of its own, and why under it. */}
          <div role="alert" className="flex min-w-0 flex-1 flex-col">
            <p className="m-0 font-semibold text-fg">{title}</p>
            {/* The space is for what reads the alert as one run of text; it takes no room. */}
            {reason !== undefined && ' '}
            {reason !== undefined && <p className="m-0 text-fg-muted">{reason}</p>}
          </div>
          {/* On the title's line, and no taller than it, so the box is as deep under its words
              as over them. */}
          {(act || more) && (
            <div className="flex h-1lh flex-none items-center gap-6">
              {more}
              {act}
            </div>
          )}
        </div>
      )}
      {details !== undefined && (
        <div id={detailsId} className={view ? 'w-full max-w-read-measure' : undefined}>
          <Collapse open={detailed}>
            {/* Its gap is inside what opens, so a closed one takes no room. */}
            <div className={view ? undefined : 'pt-8'}>
              <div className="flex items-start gap-8 rounded-sm bg-bg-well p-8 text-start">
                <pre className="m-0 problem-details min-w-0 flex-1 overflow-auto wrap-anywhere whitespace-pre-wrap text-fg-muted code-small">
                  {details}
                </pre>
                <CopyButton size="sm" onCopy={() => copy(details)} />
              </div>
            </div>
          </Collapse>
        </div>
      )}
    </div>
  );
}
