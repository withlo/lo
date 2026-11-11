import { Fragment, type ReactNode } from 'react';

/** `text` with what's between backticks set as code, as the advice Lo finds for git is written. */
export function Ticks({ text }: { text: string }): ReactNode {
  return text.split(/`([^`]+)`/).map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="text-fg code-small">
        {part}
      </span>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
