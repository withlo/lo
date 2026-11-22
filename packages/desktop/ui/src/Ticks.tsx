import { Fragment, type ReactNode } from 'react';

/**
 * `text` with what's between backticks set as code: a sentence main writes, such as a refusal, that
 * names a command, a path or a link the reader may type or paste.
 */
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
