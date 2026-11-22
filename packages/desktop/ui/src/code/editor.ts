// What every code view's own editors have, the diff's and the whole file's alike: their plain keys
// (`plain.ts`), or, with Vim keys on, Vim, with the rules `keys.ts` gives it, saying its mode for the
// status bar; a caret that doesn't blink, and the cursor line's number marked, so where the cursor
// is shows in every frame, with Vim keys off too; read-only text split into lines at `\n` alone, as
// the diff splits it; long lines wrapped, each continuing past its own indent (`hang.ts`); their
// style elements carrying the window's nonce, which its content security policy lets in; and the
// scroll Lo's screen keys leave alone (`screen.ts`).

import { EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLineGutter } from '@codemirror/view';

import { hang } from './hang.ts';
import { handlingKey, readOnly, switchVim } from './keys.ts';
import { plainCode } from './plain.ts';
import { leaveOnScreen } from './screen.ts';

/**
 * A code view's editor, whose view hears through `moved` when its cursor moves, its text changes
 * or focus comes or goes while it has focus, and isn't told while Vim is in the middle of a key:
 * what a key did is said once Vim is done with it. With Vim keys off, no key is Vim's.
 */
export function codeEditor(nonce: string, moved: () => void): Extension {
  return [
    switchVim(plainCode()),
    drawSelection({ cursorBlinkRate: 0 }),
    highlightActiveLineGutter(),
    EditorState.lineSeparator.of('\n'),
    readOnly(),
    EditorView.lineWrapping,
    hang(),
    EditorView.cspNonce.of(nonce),
    leaveOnScreen,
    EditorView.updateListener.of((update) => {
      if (!update.view.hasFocus || handlingKey(update.view)) return;
      if (update.selectionSet || update.focusChanged || update.docChanged) moved();
    }),
  ];
}
