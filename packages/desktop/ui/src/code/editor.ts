// What every code view's own editors have, the diff's and the whole file's alike: their plain keys
// (`plain.ts`), or, with Vim keys on, Vim, with the rules `keys.ts` gives it, saying its mode for the
// status bar; a caret that doesn't blink, and the cursor line's number marked, so where the cursor
// is shows in every frame, with Vim keys off too; read-only text split into lines at `\n` alone, as
// the diff splits it; long lines wrapped, each continuing past its own indent (`hang.ts`); their
// style elements carrying the window's nonce, which its content security policy lets in; the
// scroll Lo's screen keys leave alone (`screen.ts`); and the cursor's row of text said to be shown
// each time the cursor moves (`askToShow`), so a block around the editor that cut it off shows it
// whole.

import { EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLineGutter } from '@codemirror/view';

import { askToShow } from '../reveal.ts';
import { hang } from './hang.ts';
import { handlingKey, readOnly, switchVim } from './keys.ts';
import { landings } from './landing.ts';
import { plainCode } from './plain.ts';
import { bodyOf, caretOf, leaveOnScreen } from './screen.ts';

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
    landings(),
    EditorView.cspNonce.of(nonce),
    leaveOnScreen,
    EditorView.updateListener.of((update) => {
      if (!update.view.hasFocus || handlingKey(update.view)) return;
      if (update.selectionSet || update.focusChanged || update.docChanged) moved();
    }),
    // The cursor coming to a row of text, by any key or as something opens on its line, shows it.
    EditorView.updateListener.of((update) => {
      if (!update.selectionSet) return;
      const { view } = update;
      const { head } = update.state.selection.main;
      askToShow(view.dom, () => {
        if (!view.dom.isConnected || head > view.state.doc.length) return undefined;
        // Read from what's drawn, as while the editor updates, so asking forces no measure of its
        // own, which would bring the cursor into view before anything around it made room.
        const row = caretOf(view, head, true);
        const top = view.documentTop;
        return { top: top + row.top, bottom: top + row.bottom };
      });
    }),
  ];
}

/**
 * Says line `line` of `view`'s document is being shown, with `under`, what opens under it, if
 * anything does (`askToShow`): a block around the editor that cut any of it off shows whole first.
 * Where the line is is read as it's asked, from the editor's last measure of its lines, which
 * showing it doesn't change, so asking forces no measure of the editor's own.
 */
export function askToShowLine(view: EditorView, line: number, under?: Element): void {
  askToShow(view.dom, () => {
    if (!view.dom.isConnected || line < 1 || line > view.state.doc.lines) return undefined;
    // The line's own text, without what's drawn under it.
    const text = bodyOf(view.lineBlockAt(view.state.doc.line(line).from));
    const top = view.documentTop;
    const below = under?.isConnected ? under.getBoundingClientRect().bottom : 0;
    return { top: top + text.top, bottom: Math.max(top + text.bottom, below) };
  });
}
