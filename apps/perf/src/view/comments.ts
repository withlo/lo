// Comment boxes: a small Markdown editor with Vim's keys, under the line it comments on, in the
// thread there if there is one. It grows as you type. `⌘⏎` adds the comment to the thread; `Esc`
// leaves insert mode, and `Esc` again closes the box and keeps the draft for the next `c` there.

import { history } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { Prec } from '@codemirror/state';
import { drawSelection, EditorView, keymap } from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import { getCM, Vim, vim } from '@replit/codemirror-vim';

import type { Side } from './layout.ts';
import type { BoxHost } from './widgets.ts';

/** A file's line on one side: where a thread or a comment box is. */
export interface Place {
  file: number;
  side: Side;
  line: number;
}

export function placeKey(place: Place): string {
  return `${place.file}:${place.side}:${place.line}`;
}

export interface BoxEvents {
  /** The box grew or shrank. */
  resized(box: CommentBox): void;
  /** `⌘⏎`: the comment is written. */
  submit(box: CommentBox, text: string): void;
  /** `Esc` in normal mode: the box closes and keeps its draft. */
  close(box: CommentBox): void;
}

export class CommentBox implements BoxHost {
  readonly place: Place;
  readonly dom: HTMLElement;
  readonly view: EditorView;
  #height = 0;

  constructor(place: Place, events: BoxEvents, nonce: string | undefined) {
    this.place = place;
    this.dom = document.createElement('div');
    this.dom.className = 'lo-diffcomposer';
    const hint = document.createElement('div');
    hint.className = 'lo-diffcomposer__hint';
    hint.textContent = '⌘⏎ add the comment · Esc Esc close and keep the draft';
    this.view = new EditorView({
      parent: this.dom,
      extensions: [
        vim(),
        drawSelection(),
        history(),
        markdown(),
        syntaxHighlighting(classHighlighter),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Comment' }),
        nonce ? EditorView.cspNonce.of(nonce) : [],
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: (view) => {
                const text = view.state.doc.toString().trim();
                if (text) events.submit(this, text);
                return true;
              },
            },
          ]),
        ),
        Prec.highest(
          EditorView.domEventHandlers({
            keydown: (event, view) => {
              if (event.key !== 'Escape' || !idle(view)) return false;
              event.preventDefault();
              events.close(this);
              return true;
            },
          }),
        ),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged && !update.geometryChanged) return;
          const height = this.dom.getBoundingClientRect().height;
          if (Math.abs(height - this.#height) < 0.5) return;
          this.#height = height;
          events.resized(this);
        }),
      ],
    });
    this.dom.append(hint);
  }

  /** The draft so far. */
  get text(): string {
    return this.view.state.doc.toString();
  }

  attach(parent: HTMLElement): void {
    const focused = this.view.hasFocus;
    parent.append(this.dom);
    // The widget isn't in the page until the editor that draws it has put it there.
    if (focused) queueMicrotask(() => this.view.focus());
  }

  /** Focuses the box in insert mode, at the end of the draft. */
  focus(): void {
    const { doc } = this.view.state;
    this.view.dispatch({ selection: { anchor: doc.line(doc.lines).from } });
    this.view.focus();
    const cm = getCM(this.view);
    if (cm && !cm.state.vim?.insertMode) Vim.handleKey(cm, 'A', 'user');
  }

  clear(): void {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length } });
  }

  destroy(): void {
    this.view.destroy();
    this.dom.remove();
  }
}

/** Whether Vim in `view` is in normal mode with nothing typed towards a command. */
export function idle(view: EditorView): boolean {
  const vimState = getCM(view)?.state.vim;
  if (!vimState) return true;
  if (vimState.insertMode || vimState.visualMode) return false;
  const input = vimState.inputState;
  return (
    input.keyBuffer.length === 0 &&
    input.prefixRepeat.length === 0 &&
    input.motionRepeat.length === 0 &&
    !input.operator &&
    !input.motion
  );
}
