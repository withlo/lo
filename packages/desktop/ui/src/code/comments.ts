// Comment boxes: a small Markdown editor with Vim's keys, under the line it comments on, in the
// thread there if there is one. It grows as you type. `⌘⏎` adds the comment to the review and `⌥⏎`
// posts it now; `Esc` leaves insert mode, and `Esc` again closes the box. The box is a scope of its
// own, `box`, so Lo's keys for the diff don't reach it, and its Vim keeps its own jumps: `⌃o` and
// `⌃i` there are Vim's.

import { history, indentLess, indentMore } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { Prec } from '@codemirror/state';
import { drawSelection, EditorView, keymap } from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import { getCM, Vim, vim } from '@replit/codemirror-vim';

import {
  type KeySource,
  type LineTarget,
  SCOPE_ATTRIBUTE,
  setScopeSource,
  type VimKey,
} from '../commands/index.ts';
import type { Send } from './api.ts';
import { mapJumps } from './jumps.ts';
import { clearVim, idle, passToVim, setVimKeys, vimMode, vimPending } from './keys.ts';
import type { Side } from './layout.ts';
import type { BoxHost } from './widgets.ts';

/** Where a box is: under a file's line on one side, by the file's index. */
export interface BoxPlace {
  file: number;
  side: Side;
  line: number;
}

export function placeKey(place: BoxPlace): string {
  return `${place.file}:${place.side}:${place.line}`;
}

export interface BoxEvents {
  /** The box grew or shrank. */
  resized(box: CommentBox): void;
  change(box: CommentBox, text: string): void;
  submit(box: CommentBox, how: Send): void;
  /** `Esc` in normal mode. */
  close(box: CommentBox): void;
}

export class CommentBox implements BoxHost, KeySource {
  readonly place: BoxPlace;
  readonly dom: HTMLElement;
  readonly view: EditorView;
  /** What a key in the box acts on: the line it's under, and its thread. */
  readonly target: LineTarget;
  readonly #forget: () => void;
  #height = 0;

  constructor(
    place: BoxPlace,
    target: LineTarget,
    draft: string,
    events: BoxEvents,
    nonce: string | undefined,
  ) {
    this.place = place;
    this.target = target;
    this.dom = document.createElement('div');
    this.dom.className = 'lo-diffcomposer';
    this.dom.setAttribute(SCOPE_ATTRIBUTE, 'box');
    const hint = document.createElement('div');
    hint.className = 'lo-diffcomposer__hint';
    hint.textContent = '⌘⏎ add to the review · ⌥⏎ comment now · Esc Esc close and keep the draft';
    const send = (how: Send) => () => {
      if (this.text.trim()) events.submit(this, how);
      return true;
    };
    this.view = new EditorView({
      parent: this.dom,
      doc: draft,
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
            // The box keeps Tab: it indents in insert mode, as in a Markdown list, and does nothing
            // otherwise, where the browser would move focus out of the box and into the diff.
            {
              key: 'Tab',
              run: (view) => (vimMode(view) === 'insert' ? indentMore(view) : true),
              shift: (view) => (vimMode(view) === 'insert' ? indentLess(view) : true),
              preventDefault: true,
            },
            { key: 'Mod-Enter', run: send('review') },
            { key: 'Alt-Enter', run: send('now') },
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
          if (update.docChanged) {
            mapJumps(update.view, update.changes);
            events.change(this, this.text);
          }
          if (!update.docChanged && !update.geometryChanged) return;
          const height = this.dom.getBoundingClientRect().height;
          if (Math.abs(height - this.#height) < 0.5) return;
          this.#height = height;
          events.resized(this);
        }),
      ],
    });
    this.dom.append(hint);
    this.#forget = setScopeSource(this.dom, this);
    // The box sits inside a diff editor's content: no key typed in it goes on to that editor.
    for (const type of ['keydown', 'keypress', 'keyup', 'beforeinput', 'input'] as const) {
      this.dom.addEventListener(type, (event) => event.stopPropagation());
    }
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

  insert(text: string): void {
    this.view.dispatch(this.view.state.replaceSelection(text));
  }

  keyState(): ReturnType<KeySource['keyState']> {
    return { mode: vimMode(this.view), pending: vimPending(this.view), target: this.target };
  }

  passKeys(keys: readonly string[]): void {
    passToVim(this.view, keys);
  }

  clearPending(): void {
    clearVim(this.view);
  }

  setVimKeys(keys: readonly VimKey[]): void {
    setVimKeys(keys);
  }

  destroy(): void {
    this.#forget();
    this.view.destroy();
    this.dom.remove();
  }
}
