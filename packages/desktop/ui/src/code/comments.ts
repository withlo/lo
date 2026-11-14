// Comment boxes: a small Markdown editor with Vim's keys, under the line it comments on, in the
// thread there if there is one, or on its own where a caller puts it. It grows as you type. Around
// the editor sits a frame the caller draws in the parts the box makes: a head, a note, a preview
// that takes the editor's place, a dropzone over it, the uploads and a foot. `⌘⏎` adds the comment
// to the review and `⌥⏎` posts it now; `⌘⇧V` shows the preview or the editor, and `⌘⇧A` asks to
// attach files; `Esc` leaves insert mode, and `Esc` again closes the box. Files dropped or pasted
// go to the caller, never into the text. While the caller holds it, as while it's sent, no key
// changes its text. The box is a scope of its own, `box`, so Lo's keys for the
// diff don't reach it, and its Vim keeps its own jumps: `⌃o` and `⌃i` there are Vim's. A box can
// open as another was, as when the view it's in is drawn anew: in the same mode, with the same
// caret, selection, undo history and preview.

import { history, historyField, indentLess, indentMore } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import {
  Compartment,
  EditorState,
  type Extension,
  findClusterBreak,
  Prec,
} from '@codemirror/state';
import { drawSelection, EditorView, keymap, runScopeHandlers } from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import { getCM, Vim, vim } from '@replit/codemirror-vim';

import {
  type KeySource,
  SCOPE_ATTRIBUTE,
  setScopeSource,
  type Target,
  type VimKey,
} from '../commands/index.ts';
import type { BoxFrame, BoxParts, Composer, ComposerEvents, KeptBox, Mode, Send } from './api.ts';
import { mapJumps } from './jumps.ts';
import {
  clearVim,
  idle,
  installVim,
  leaveToNormal,
  modeName,
  onVimMode,
  passToVim,
  readOnly,
  setVimKeys,
  showMode,
  vimMode,
  vimPending,
} from './keys.ts';
import type { Side } from './layout.ts';
import type { ModeName } from './mode.ts';
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

/** What a box is made with. */
export interface BoxOptions {
  /** What a key in the box acts on: the line it's under, and its thread. */
  target: Target;
  /** The thread it's written in, as a reply's box is, which it's drawn right after. */
  thread?: string | undefined;
  draft: string;
  on: ComposerEvents;
  frame: BoxFrame | undefined;
  nonce: string | undefined;
  label?: string | undefined;
  /** The box this one is, as it was, to open as it was where its text is the draft. */
  kept?: KeptBox | undefined;
  /** `Esc` in normal mode, or in the preview: the box's owner closes it, or tells the caller. */
  escape: (box: CommentBox) => void;
  /** `close()` on its handle. */
  close: (box: CommentBox) => void;
  /** `dismiss()` on its handle: as `close()`, unless it's given. */
  dismiss?: ((box: CommentBox) => void) | undefined;
  /** The box grew or shrank as it was typed in, or as its editor changed width. */
  resized?: ((box: CommentBox) => void) | undefined;
}

export class CommentBox implements BoxHost, KeySource {
  readonly dom: HTMLElement;
  readonly view: EditorView;
  /** What a key in the box acts on. */
  readonly target: Target;
  /** The thread it's written in, if it's written in one. */
  readonly thread: string | undefined;
  /** The caller's handle on the box. */
  readonly composer: Composer;
  readonly #parts: BoxParts;
  readonly #on: ComposerEvents;
  readonly #escape: (box: CommentBox) => void;
  readonly #stops: (() => void)[] = [];
  #frame: { destroy(): void } | undefined;
  #previewing = false;
  /** Where the cursor was in insert mode as the preview showed, to go back to insert mode there. */
  #resume: number | undefined;
  /** How deep into the box files being dragged are, by the elements they entered. */
  #dragged = 0;
  /** How tall the box was when its editor last changed. */
  #height = 0;
  /** What makes the text read-only while the caller holds it. */
  readonly #held = new Compartment();
  #holding = false;
  /** Focus left the box as it moved into another widget, and is on its way back. */
  #refocusing = false;

  constructor(options: BoxOptions) {
    installVim();
    const { on } = options;
    this.target = options.target;
    this.thread = options.thread;
    this.#on = on;
    this.#escape = options.escape;
    this.dom = document.createElement('div');
    this.dom.className = 'lo-diffcomposer';
    this.dom.setAttribute(SCOPE_ATTRIBUTE, 'box');
    this.#parts = {
      head: part('head'),
      note: part('note'),
      preview: part('preview'),
      dropzone: part('dropzone'),
      uploads: part('uploads'),
      foot: part('foot'),
    };
    const { head, note, preview, dropzone, uploads, foot } = this.#parts;
    preview.hidden = true;
    preview.tabIndex = -1;
    dropzone.hidden = true;
    const body = document.createElement('div');
    body.className = 'lo-diffcomposer__body';
    const send = (how: Send) => () => {
      if (this.text.trim()) on.submit(how);
      return true;
    };
    const extensions: Extension[] = [
      vim(),
      showMode,
      this.#held.of([]),
      drawSelection(),
      history(),
      markdown(),
      syntaxHighlighting(classHighlighter),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': options.label ?? 'Comment' }),
      options.nonce ? EditorView.cspNonce.of(options.nonce) : [],
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
          {
            key: 'Mod-Shift-v',
            run: () => {
              this.preview(!this.#previewing);
              on.preview?.(this.#previewing);
              return true;
            },
          },
          {
            key: 'Mod-Shift-a',
            run: () => {
              on.attach?.();
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
            this.#escape(this);
            return true;
          },
        }),
      ),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          mapJumps(update.view, update.changes);
          on.change(this.text);
        }
        if (!update.docChanged && !update.geometryChanged) return;
        // Its owner hears of it now, before the editor the box is in measures it.
        const { height } = this.dom.getBoundingClientRect();
        if (Math.abs(height - this.#height) < 0.5) return;
        this.#height = height;
        options.resized?.(this);
      }),
    ];
    const kept = editorOf(options.kept, options.draft);
    const was = kept && stateOf(kept, extensions);
    this.view = new EditorView({
      parent: body,
      state: was?.state ?? EditorState.create({ doc: options.draft, extensions }),
    });
    body.append(preview, dropzone);
    this.dom.append(head, note, body, uploads, foot);
    this.composer = this.#handle(options);
    if (options.frame) {
      this.#frame = options.frame(this.#parts, this.composer);
    } else {
      const hint = document.createElement('div');
      hint.className = 'lo-diffcomposer__hint';
      hint.textContent = '⌘⏎ add to the review · ⌥⏎ comment now · Esc Esc close and keep the draft';
      this.dom.append(hint);
    }
    this.#stops.push(
      setScopeSource(this.dom, this),
      onVimMode(this.view, (mode) => on.mode?.(mode)),
    );
    // The box's own keys, where the editor doesn't hear them: in the preview, or on the frame.
    this.dom.addEventListener('keydown', (event) => this.#frameKey(event));
    // The box can sit inside a code view's editor: no key typed in it goes on to that editor.
    for (const type of ['keydown', 'keypress', 'keyup', 'beforeinput', 'input'] as const) {
      this.dom.addEventListener(type, (event) => event.stopPropagation());
    }
    this.dom.addEventListener('focusin', () => this.dom.classList.add('is-focused'));
    this.dom.addEventListener('focusout', (event) => {
      const to = event.relatedTarget;
      if (!(to instanceof Node) || !this.dom.contains(to)) this.dom.classList.remove('is-focused');
    });
    this.#takeFiles();
    if (was) this.#resumeAs(was.editor);
  }

  /** The draft so far. */
  get text(): string {
    return this.view.state.doc.toString();
  }

  get previewing(): boolean {
    return this.#previewing;
  }

  attach(parent: HTMLElement): void {
    const focused = this.hasFocus;
    parent.append(this.dom);
    // The widget isn't in the page until the editor that draws it has put it there.
    if (!focused) return;
    this.#refocusing = true;
    queueMicrotask(() => {
      if (!this.#refocusing) return;
      this.#refocusing = false;
      this.focusShown();
    });
  }

  /** Whether focus is in the box, or on its way back to it after it moved. */
  get hasFocus(): boolean {
    return this.#refocusing || this.dom.contains(this.dom.ownerDocument.activeElement);
  }

  /** Focuses the box: in insert mode at the end of the draft, or its preview while that shows. */
  focus(): void {
    if (this.#previewing) {
      this.#parts.preview.focus();
      return;
    }
    const { doc } = this.view.state;
    const cm = getCM(this.view);
    // In insert mode the cursor goes to the end itself; otherwise `A` takes it there, into insert
    // mode.
    const inserting = cm?.state.vim?.insertMode === true;
    this.view.dispatch({
      selection: { anchor: inserting ? doc.length : doc.line(doc.lines).from },
    });
    this.view.focus();
    if (cm && !inserting) Vim.handleKey(cm, 'A', 'user');
  }

  /** The box as it is, for another to open as it was. */
  keep(): KeptBox {
    const cm = getCM(this.view);
    const sel = cm?.state.vim?.visualMode ? cm.state.vim.sel : undefined;
    const editor: Editor = {
      state: this.view.state.toJSON({ history: historyField }),
      mode: modeName(this.view),
      sel:
        cm && sel
          ? { anchor: cm.indexFromPos(sel.anchor), head: cm.indexFromPos(sel.head) }
          : undefined,
      previewing: this.#previewing,
      resume: this.#resume,
    };
    editors.add(editor);
    return { text: this.text, editor };
  }

  insert(text: string): void {
    if (vimMode(this.view) === 'insert' || text === '') {
      this.view.dispatch(this.view.state.replaceSelection(text));
      return;
    }
    // Outside insert mode the cursor is a block on a character: the text goes after it, as `a`
    // puts it, and the cursor ends on the last character put in.
    leaveToNormal(this.view);
    const { state } = this.view;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const at = head < line.to ? line.from + findClusterBreak(line.text, head - line.from) : head;
    const last = at + findClusterBreak(text, text.length, false);
    this.view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: last } });
  }

  replace(from: number, to: number, text: string): void {
    const { length } = this.view.state.doc;
    const clamp = (offset: number): number => Math.max(0, Math.min(length, Math.round(offset)));
    const start = clamp(Math.min(from, to));
    const end = clamp(Math.max(from, to));
    this.view.dispatch({ changes: { from: start, to: end, insert: text } });
  }

  /** Holds the text as it is, leaving insert mode, or lets it go. */
  hold(on: boolean): void {
    if (on === this.#holding) return;
    this.#holding = on;
    if (on) leaveToNormal(this.view);
    this.view.dispatch({ effects: this.#held.reconfigure(on ? readOnly() : []) });
  }

  /**
   * Shows the preview in the editor's place, leaving insert mode, or the editor again, in insert
   * mode where it was if it was.
   */
  preview(on: boolean): void {
    if (on === this.#previewing) return;
    const focused = this.dom.contains(this.dom.ownerDocument.activeElement);
    if (on) {
      this.#resume =
        vimMode(this.view) === 'insert' ? this.view.state.selection.main.head : undefined;
      leaveToNormal(this.view);
    }
    this.#previewing = on;
    this.view.dom.hidden = on;
    this.#parts.preview.hidden = !on;
    this.dom.classList.toggle('is-preview', on);
    const resume = on ? undefined : this.#resume;
    const cm = getCM(this.view);
    if (resume !== undefined && cm) {
      // Back in insert mode, where the cursor was.
      this.#resume = undefined;
      Vim.handleKey(cm, 'i', 'user');
      this.view.dispatch({ selection: { anchor: Math.min(resume, this.view.state.doc.length) } });
    }
    if (focused) this.focusShown();
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
    this.#refocusing = false;
    for (const stop of this.#stops) stop();
    this.#stops.length = 0;
    const frame = this.#frame;
    this.#frame = undefined;
    frame?.destroy();
    this.view.destroy();
    this.dom.remove();
  }

  /** Focus on what the box shows: the editor, as it was, or the preview. */
  focusShown(): void {
    if (this.#previewing) this.#parts.preview.focus();
    else this.view.focus();
  }

  /** The caller's handle on the box. */
  #handle(options: BoxOptions): Composer {
    const draft = (): string => this.text;
    const mode = (): Mode => vimMode(this.view);
    const previewing = (): boolean => this.previewing;
    return {
      get text() {
        return draft();
      },
      get mode() {
        return mode();
      },
      get previewing() {
        return previewing();
      },
      focus: () => this.focus(),
      hold: (on) => this.hold(on),
      insert: (text) => this.insert(text),
      replace: (from, to, text) => this.replace(from, to, text),
      preview: (on) => this.preview(on),
      close: () => options.close(this),
      dismiss: () => (options.dismiss ?? options.close)(this),
      keep: () => this.keep(),
    };
  }

  /**
   * Vim's mode, with the selection it keeps in a visual mode, and the preview, as they were in the
   * box this one is: its caret, selection and undo history came with its editor's state.
   */
  #resumeAs(was: Editor): void {
    const cm = getCM(this.view);
    const { length } = this.view.state.doc;
    const { main } = this.view.state.selection;
    if (cm && was.mode === 'INSERT') {
      Vim.handleKey(cm, 'i', 'user');
      this.view.dispatch({ selection: { anchor: main.anchor, head: main.head } });
    } else if (cm && was.sel && was.mode !== 'NORMAL') {
      // A selection no key of Vim's made brings visual mode back, character by character, as a
      // mouse's does, and covers the character at its head, as Vim draws it; then the kind it was.
      const anchor = Math.min(was.sel.anchor, length);
      const head = Math.min(was.sel.head, length);
      const forward = head >= anchor;
      this.view.dispatch({
        selection: {
          anchor: forward ? anchor : Math.min(anchor + 1, length),
          head: forward ? Math.min(head + 1, length) : head,
        },
      });
      if (was.mode === 'V-LINE') Vim.handleKey(cm, 'V', 'user');
      else if (was.mode === 'V-BLOCK') Vim.handleKey(cm, '<C-v>', 'user');
    }
    if (was.previewing) {
      this.preview(true);
      this.#resume = was.resume;
    }
  }

  /**
   * A key in the box outside its editor, in the preview or on the frame: the box's own keys, as
   * in the editor, and `Esc`, which closes the box, as in normal mode.
   */
  #frameKey(event: KeyboardEvent): void {
    const { target } = event;
    if (event.defaultPrevented || !(target instanceof Node) || this.view.dom.contains(target)) {
      return;
    }
    if (runScopeHandlers(this.view, event, 'editor')) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Escape' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.shiftKey) return;
    event.preventDefault();
    this.#escape(this);
  }

  /**
   * Files dragged over the box show the frame's dropzone, and dropped or pasted, go to the caller,
   * before the editor, which would put a file's text in the comment, can take them.
   */
  #takeFiles(): void {
    const capture = { capture: true } as const;
    this.dom.addEventListener(
      'dragenter',
      (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        if (this.#dragged++ === 0) this.#dragging(fileCount(event.dataTransfer));
      },
      capture,
    );
    this.dom.addEventListener(
      'dragover',
      (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      },
      capture,
    );
    this.dom.addEventListener(
      'dragleave',
      (event) => {
        if (!carriesFiles(event) || this.#dragged === 0) return;
        if (--this.#dragged === 0) this.#dragging(0);
      },
      capture,
    );
    this.dom.addEventListener(
      'drop',
      (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        this.#dragged = 0;
        this.#dragging(0);
        const dropped = [...(event.dataTransfer?.files ?? [])];
        if (dropped.length > 0) this.#on.files?.(dropped);
      },
      capture,
    );
    this.dom.addEventListener(
      'paste',
      (event) => {
        const pasted = [...(event.clipboardData?.files ?? [])];
        if (pasted.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.#on.files?.(pasted);
      },
      capture,
    );
  }

  /** Shows the dropzone while `count` files are dragged over the box, and says how many. */
  #dragging(count: number): void {
    this.#parts.dropzone.hidden = count === 0;
    this.dom.classList.toggle('is-dragging', count > 0);
    this.#on.dragging?.(count);
  }
}

/** What a box keeps of its editor, for another opened as it was: the code view's own. */
interface Editor {
  /** Its editor's state as JSON, with its undo history. */
  readonly state: unknown;
  /** Vim's mode, as the status bar names it. */
  readonly mode: ModeName;
  /** The selection Vim keeps in a visual mode, by offsets. */
  readonly sel: { readonly anchor: number; readonly head: number } | undefined;
  readonly previewing: boolean;
  /** Where the cursor was in insert mode as the preview showed. */
  readonly resume: number | undefined;
}

/** What boxes kept of their editors, as `keep()` made it. */
const editors = new WeakSet<object>();

/** Whether `editor` is what a box kept of its editor. */
function isEditor(editor: unknown): editor is Editor {
  return typeof editor === 'object' && editor !== null && editors.has(editor);
}

/** What `kept` kept of its editor, where its text is `draft`. */
function editorOf(kept: KeptBox | undefined, draft: string): Editor | undefined {
  return kept?.text === draft && isEditor(kept.editor) ? kept.editor : undefined;
}

/** The state `editor` kept, with `extensions`: none where it's not one this editor reads. */
function stateOf(
  editor: Editor,
  extensions: Extension[],
): { state: EditorState; editor: Editor } | undefined {
  try {
    const state = EditorState.fromJSON(editor.state, { extensions }, { history: historyField });
    return { state, editor };
  } catch {
    return undefined;
  }
}

/** Whether a drag carries files. */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

/** A part of a box's frame, empty. */
function part(name: keyof BoxParts): HTMLElement {
  const element = document.createElement('div');
  element.className = `lo-diffcomposer__${name}`;
  return element;
}

/** How many files a drag carries. */
function fileCount(transfer: DataTransfer | null): number {
  if (!transfer) return 0;
  return [...transfer.items].filter((item) => item.kind === 'file').length;
}
