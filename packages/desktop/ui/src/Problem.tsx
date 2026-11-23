import { cva } from 'class-variance-authority';
import { useId, useState, type ReactNode, type Ref } from 'react';

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
  /** The button, for what gives it focus, as details that open on the one thing to do. */
  ref?: Ref<HTMLButtonElement> | undefined;
}

export interface ProblemProps {
  /** What failed, in a few words with no status code in them: "Couldn't fetch the diff". */
  title: ReactNode;
  /**
   * Why, or what to do about it, in a sentence, and any retry: "Offline. Retrying in 8 s.". What
   * counts down in it is a `Countdown`, so the alert it's in reads the same throughout.
   */
  reason?: ReactNode;
  action?: ProblemAction | undefined;
  /**
   * Other ways on, beside the one thing to do, for a failed view that can also be left: "Open on
   * GitHub", "Close tab". Drawn quieter than `action`, after it.
   */
  others?: readonly ProblemAction[] | undefined;
  /**
   * What came back, as it came: the status, GitHub's own words, a path. It stays behind a Details
   * button, with a Copy button, and is the only place raw text shows. Copy goes through the window's
   * `CopyRoute`.
   */
  details?: string | undefined;
  /**
   * Commands that put it right, such as one that installs what's missing: each on its own line,
   * as code, with Copy. Only in a status item's details (`layout="details"`).
   */
  commands?: readonly string[] | undefined;
  /**
   * `view` when a whole view failed and this takes its place, with nothing drawn behind it;
   * `inline` when an action failed, shown by its control: above a dialog's foot, in a panel;
   * `details` in a status item's details, which are its box, so it has none of its own, and each
   * part takes a row of the popover's width.
   */
  layout?: 'view' | 'inline' | 'details' | undefined;
  /**
   * `warn` while it's a wait, not a failure: Lo tries again by itself, or it waits for something
   * else to let go. As the status item's amber ball, its triangle and ground are amber. `danger`,
   * the default, once it failed.
   */
  tone?: 'danger' | 'warn' | undefined;
}

const problem = cva('min-w-0 text-ui', {
  variants: {
    layout: {
      view: 'flex h-full flex-col items-center justify-center gap-12 p-32 text-center',
      inline: 'flex flex-col rounded-md border p-12 text-small',
      details: 'flex flex-col text-small',
    },
    tone: { danger: '', warn: '' },
  },
  compoundVariants: [
    { layout: 'inline', tone: 'danger', class: 'border-danger-border bg-danger-bg' },
    { layout: 'inline', tone: 'warn', class: 'border-warning-border bg-warning-bg' },
  ],
});

const triangle = cva('lo-i lo-i--sm flex-none', {
  variants: { tone: { danger: 'text-danger', warn: 'text-warning' } },
});

/**
 * Something that went wrong, in one shape wherever it shows: what failed, why, the one
 * thing to do about it, and the raw text behind Details. It's said once, here: no toast or second
 * line repeats it. A screen reader hears what failed and why at once, as an alert, and not its
 * buttons. Nothing in it changes on a timer except through `Countdown`, so the alert is read once.
 */
export function Problem({
  title,
  reason,
  action,
  others = [],
  details,
  commands = [],
  layout = 'inline',
  tone = 'danger',
}: ProblemProps) {
  const view = layout === 'view';
  const copy = useCopy();
  // In a view, the text sits 12 px under the buttons, in a roomier well with a hairline, since
  // the well's fill is the view's own ground, as the overview's other wells have; inline, under
  // the line, on the problem's own fill.
  const { more, shown } = useDetails(
    details,
    view ? 'pt-12' : 'pt-8',
    view ? 'p-12 inset-ring inset-ring-border' : 'p-8',
  );
  const button = (each: ProblemAction, main: boolean, key?: number) => (
    <Button
      key={key}
      variant={main ? (view ? 'primary' : 'secondary') : 'ghost'}
      size={view ? 'md' : 'sm'}
      ref={each.ref}
      busy={each.busy}
      working={each.working}
      onClick={each.onClick}
    >
      {each.label}
      {each.keys && <Key keys={each.keys} decorative />}
    </Button>
  );
  const act = (action || others.length > 0) && (
    <>
      {action && button(action, true)}
      {others.map((each, index) => button(each, false, index))}
    </>
  );
  const icon = (
    <svg className={triangle({ tone })} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9.5a1 1 0 0 1-.87 1.5H2.8a1 1 0 0 1-.87-1.5Z" />
      <path d="M8 6.25v3M8 11.25v.01" />
    </svg>
  );
  if (layout === 'details') {
    return (
      <div className={problem({ layout, tone })}>
        <div className="flex flex-col gap-8">
          {/* What failed on its own row, after its triangle, and why under it, full width. */}
          <div role="alert" className="flex flex-col gap-2">
            <p className="m-0 flex items-center gap-8 font-semibold text-fg">
              {icon}
              {title}
            </p>
            {/* The space is for what reads the alert as one run of text; it takes no room. */}
            {reason !== undefined && ' '}
            {reason !== undefined && <p className="m-0 text-fg-muted">{reason}</p>}
          </div>
          {/* Each command whole, on a line that scrolls, not breaks, with Copy at its end. */}
          {commands.map((command) => (
            <div key={command} className="flex items-center gap-8 rounded-sm bg-bg-well px-8 py-6">
              <pre className="m-0 min-w-0 flex-1 overflow-x-auto whitespace-pre text-fg code-small select-text">
                <code>{command}</code>
              </pre>
              <CopyButton size="sm" onCopy={() => copy(command)} />
            </div>
          ))}
          {/* The one thing to do first, then the others, then Details; a ghost button first sits on
            the line's edge, as the text above it does. */}
          {(act || more) && (
            <div className={`flex flex-wrap items-center gap-6 ${action ? '' : '-ms-8'}`}>
              {act}
              {more}
            </div>
          )}
        </div>
        {details !== undefined && shown}
      </div>
    );
  }
  return (
    <div className={problem({ layout, tone })}>
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
          <span className="mt-2 flex flex-none">{icon}</span>
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
