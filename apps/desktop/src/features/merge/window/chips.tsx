// A branch named inside a sentence the merge's dialogs and panel say, drawn in the code chip the
// "Into" fact uses, as the tables draw `main`: "GitHub merges #221 into `e4/gated` once it's
// approved."

import { Branch } from '@lo/ui';
import type { ReactNode } from 'react';

import { withoutBidi } from '../../tab/window/shared.ts';

/**
 * `text`, with `branch` in it drawn as a branch, the first time it's said as a word of its own: at
 * the start or after a space, and before a space, a full stop, a comma or the end. The rest is
 * text, drawn without the characters that turn text around.
 */
export function withBranch(text: string, branch: string): ReactNode {
  if (branch === '') return withoutBidi(text);
  let at = text.indexOf(branch);
  while (at >= 0) {
    const end = at + branch.length;
    const before = at === 0 ? ' ' : text.charAt(at - 1);
    const after = text.charAt(end);
    if (before === ' ' && (after === '' || after === ' ' || after === '.' || after === ',')) {
      return (
        <>
          {withoutBidi(text.slice(0, at))}
          <Branch name={branch} base />
          {withoutBidi(text.slice(end))}
        </>
      );
    }
    at = text.indexOf(branch, at + 1);
  }
  return withoutBidi(text);
}
