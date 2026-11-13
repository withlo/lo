// A comment box outside any code view, where its caller puts it: a reply at the foot of a thread,
// or a comment on the whole pull request. The caller places it, and closes it when it's done.

import type { BoxFrame, Composer, ComposerEvents, ComposerInit } from './api.ts';
import { CommentBox } from './comments.ts';

/** Opens a comment box in `parent`, outside any code view, with `frame` drawn around its editor. */
export function createComposer(
  parent: HTMLElement,
  init: ComposerInit,
  on: ComposerEvents,
  frame?: BoxFrame,
): Composer {
  const box = new CommentBox({
    target: { kind: 'none' },
    draft: init.draft,
    on,
    frame,
    nonce: init.nonce,
    label: init.label,
    // Where it is is the caller's, and so is closing it.
    escape: (escaped) => on.close(escaped.text.trim() !== ''),
    close: (closed) => closed.destroy(),
  });
  parent.append(box.dom);
  return box.composer;
}
