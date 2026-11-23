import { cva } from 'class-variance-authority';
import { useId, useState, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import { Collapse } from './Collapse.tsx';
import { CopyButton, useCopy } from './CopyButton.tsx';
import { Key } from './Key.tsx';

/**
 * The one thing to do about a problem. Its label starts with a verb: "Try again". A name that's
 * code stays code in it: "Open `settings.json`".
 */
export interface ProblemAction {
  label: ReactNode;
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
  const view = layout === 'view';
  // In a view, the text sits 12 px under the buttons, in a roomier well with a hairline, since
  // the well's fill is the view's own ground, as the overview's other wells have; inline, under
  // the line, on the problem's own fill.
  const { more, shown } = useDetails(
    details,
    view ? 'pt-12' : 'pt-8',
    view ? 'p-12 inset-ring inset-ring-border' : 'p-8',
  );
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
  return (
    <div className={problem({ layout })}>
      {view ? (
        // One column, centred, as wide as what failed and why: the buttons under it, and the
        // text behind Details as wide as it, so the text adds no width as it opens.
        <div className="flex max-w-read-measure flex-col items-center gap-12">
          <div role="alert" className="flex flex-col gap-4">
            <p className="m-0 text-title">{title}</p>
            {reason !== undefined && <p className="m-0 text-fg-muted">{reason}</p>}
          </div>
          {(act || more) && (
            <div className="flex flex-col items-center self-stretch">
              <div className="flex items-center gap-8">
                {act}
                {more}
              </div>
              {details !== undefined && <div className="w-0 min-w-full">{shown}</div>}
            </div>
          )}
        </div>
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
      {!view && details !== undefined && shown}
    </div>
  );
}

/**
 * The raw text behind Details, wherever something that failed shows it: `more`, the Details button
 * that opens it, and `shown`, what opens, the text with Copy in a well, under a gap of `gap` inside
 * what opens, so a closed one takes no room. `well` is the well's padding, and a hairline where
 * its fill is the surface it sits on. `open` says whether it's open. Nothing for no `details`.
 */
export function useDetails(
  details: string | undefined,
  gap?: string,
  well = 'p-8',
): { more: ReactNode; shown: ReactNode; open: boolean } {
  const copy = useCopy();
  const [detailed, setDetailed] = useState(false);
  const id = useId();
  if (details === undefined) return { more: null, shown: null, open: false };
  const more = (
    <Button
      variant="ghost"
      size="sm"
      aria-expanded={detailed}
      aria-controls={id}
      onClick={() => setDetailed((was) => !was)}
    >
      Details
    </Button>
  );
  const shown = (
    <div id={id}>
      <Collapse open={detailed}>
        <div className={gap}>
          <div className={`flex items-start gap-8 rounded-sm bg-bg-well text-start ${well}`}>
            <pre className="m-0 problem-details min-w-0 flex-1 overflow-auto wrap-anywhere whitespace-pre-wrap text-fg-muted code-small">
              {details}
            </pre>
            <CopyButton size="sm" onCopy={() => copy(details)} />
          </div>
        </div>
      </Collapse>
    </div>
  );
  return { more, shown, open: detailed };
}
