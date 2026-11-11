// What every code view's own editors have, the diff's and the whole file's alike: Vim, with the
// rules `keys.ts` gives it; read-only text split into lines at `\n` alone, as the diff splits it;
// long lines wrapped; their style elements carrying the window's nonce, which its content security
// policy lets in; and the scroll Lo's screen keys leave alone (`screen.ts`).

import { EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView } from '@codemirror/view';
import { vim } from '@replit/codemirror-vim';

import { handlingKey, readOnly } from './keys.ts';
import { leaveOnScreen } from './screen.ts';

/**
 * A code view's editor, whose view hears through `moved` when its cursor moves, its text changes
 * or focus comes or goes while it has focus, and isn't told while Vim is in the middle of a key:
 * what a key did is said once Vim is done with it.
 */
export function codeEditor(nonce: string, moved: () => void): Extension {
  return [
    vim(),
    drawSelection(),
    EditorState.lineSeparator.of('\n'),
    readOnly(),
    EditorView.lineWrapping,
    EditorView.cspNonce.of(nonce),
    leaveOnScreen,
    EditorView.updateListener.of((update) => {
      if (!update.view.hasFocus || handlingKey(update.view)) return;
      if (update.selectionSet || update.focusChanged || update.docChanged) moved();
    }),
  ];
}
