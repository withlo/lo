import type { ReactNode } from 'react';

import { Glyphs } from './Icon.tsx';

/**
 * `text` with what's between backticks set as code: a sentence main writes, such as a refusal, that
 * names a command, a path or a link the reader may type or paste. Outside them, a character the
 * fonts don't hold, as the `→` of `r1 → r3`, is drawn as its icon (`Glyphs`).
 */
export function Ticks({ text }: { text: string }): ReactNode {
  return text.split(/`([^`]+)`/).map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="text-fg code-small">
        {part}
      </span>
    ) : (
      <Glyphs key={index} text={part} />
    ),
  );
}
