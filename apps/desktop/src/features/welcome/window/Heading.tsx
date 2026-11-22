// The heading of each step after the first, and its line. The heading sits in the middle of a row
// as tall as the mark beside the last step's, so every step's heading and line are at one height.

import type { ReactNode } from 'react';

export function StepHeading({
  id,
  mark,
  title,
  line,
}: {
  /** The heading's id, for what it names. */
  id?: string | undefined;
  /** The mark beside it, on the last step. */
  mark?: ReactNode;
  title: ReactNode;
  line: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex h-40 items-center gap-12">
        {mark}
        <h1 id={id} className="m-0 text-heading">
          {title}
        </h1>
      </div>
      <p className="m-0 text-fg-muted text-ui">{line}</p>
    </div>
  );
}
