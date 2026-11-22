// A note under a field that takes a link, for what's in it that the field won't open as it is: a
// warning, not a failure. The open box draws one under its input, and the welcome's field draws
// the same one for text that isn't a pull request link.

import { Button, Key, Ticks } from '@lo/ui';

import type { NotPull } from '../contract.ts';
import { notPullLine } from './words.ts';

const WARN_ICON = (
  <svg className="lo-i lo-i--sm mt-2 flex-none text-warning" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9.5a1 1 0 0 1-.87 1.5H2.8a1 1 0 0 1-.87-1.5Z" />
    <path d="M8 6.25v3M8 11.25v.01" />
  </svg>
);

/** A note's one button, with the key that presses it. */
export interface NoteAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly keys?: readonly string[] | undefined;
}

/**
 * What's in a link field that it won't open as it is: a warning triangle, a title, one reason when
 * it changes what the reader does, and the one button `⏎` runs, if there's one. It's drawn in a
 * row its parent lays out, beside whatever else is there.
 */
export function LinkNote({
  title,
  reason,
  action,
}: {
  title: string;
  reason?: string | undefined;
  action?: NoteAction | undefined;
}) {
  return (
    <>
      {WARN_ICON}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* What a screen reader hears as it comes: the title and the reason, not the button. */}
        <span role="status" className="flex flex-col gap-2">
          <span className="font-semibold">{title}</span>
          {reason !== undefined && (
            <span className="text-fg-muted text-small">
              <Ticks text={reason} />
            </span>
          )}
        </span>
        {action !== undefined && (
          <span className="mt-6 flex">
            <Button size="sm" onClick={action.onClick}>
              {action.label}
              {action.keys && <Key keys={action.keys} decorative />}
            </Button>
          </span>
        )}
      </div>
    </>
  );
}

/** That what's in the field isn't a pull request link, and what one looks like, in its own row. */
export function NotPullNote({ why, id }: { why: NotPull; id?: string | undefined }) {
  return (
    <div id={id} className="flex gap-12 text-ui">
      <LinkNote title="Not a pull request link" reason={notPullLine(why)} />
    </div>
  );
}
