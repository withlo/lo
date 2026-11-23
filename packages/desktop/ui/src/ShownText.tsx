import { Fragment } from 'react';

import { markTitle, splitFormat } from './controls.ts';
import { Tooltip } from './Tooltip.tsx';

/**
 * Text from a repository or a language server: a name, a path, a signature or some code. Each
 * format character in it, which is invisible, shows as a small badge of its code point, so a name
 * can't read as another, named as a mark is, in its tooltip and to a screen reader: "U+202E
 * right-to-left override". See `controls.ts`.
 */
export function ShownText({ text }: { text: string }) {
  return splitFormat(text).map((piece, index) =>
    typeof piece === 'string' ? (
      <Fragment key={index}>{piece}</Fragment>
    ) : (
      <Tooltip key={index} label={markTitle(piece)}>
        <span
          role="img"
          aria-label={markTitle(piece)}
          className="mx-2 rounded-xs bg-warning-bg px-4 whitespace-nowrap text-warning code-small"
        >
          {piece.code}
        </span>
      </Tooltip>
    ),
  );
}
