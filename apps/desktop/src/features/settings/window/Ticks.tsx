// Main's words for the settings file, where what's between backticks is code: a key, a value or
// the file's name.

import { Fragment, type ReactNode } from 'react';

/** `text` with what's between backticks set as code. */
export function Ticks({ text }: { text: string }): ReactNode {
  return text.split(/`([^`]+)`/).map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="code-small">
        {part}
      </span>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
