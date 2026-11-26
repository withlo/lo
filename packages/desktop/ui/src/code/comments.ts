// Comment boxes: a small Markdown editor, under the line it comments on, in the thread there if
// there is one, or on its own where a caller puts it. It grows as you type. Around the editor sits a
// frame the caller draws in the parts the box makes: a head, a note, a preview that takes the
// editor's place, a dropzone over it, the uploads and a foot. `⌘⏎` adds the comment to the review
// and `⌥⏎` posts it now; `⌘⇧V` shows the preview or the editor, and `⌘⇧A` asks to attach files;
// `Esc` closes the box. Focus in it means typing: it's a plain editor, with a caret. With Vim keys
// on (`setVim`) it has Vim's keys instead: it opens in insert mode, `Esc` leaves that, and `Esc`
// again closes the box. Files dropped or pasted go to the caller, never into the text. While the
// caller holds it, as while it's sent, no key changes its text. The box is a scope of its own,
// `box`, so Lo's keys for the diff don't reach it, and its Vim keeps its own jumps: `⌃o` and `⌃i`
// there are Vim's. A box can open as another was, as when the view it's in is drawn anew: in the
// same mode, with the same caret, selection, undo history and preview.

import {
  defaultKeymap,
  history,
  historyField,
  historyKeymap,
  indentLess,
  indentMore,
} from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import {
  Compartment,
  EditorState,
  type Extension,
  findClusterBreak,
  Prec,
  Transaction,
} from '@codemirror/state';
import { drawSelection, EditorView, keymap, placeholder, runScopeHandlers } from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import { getCM, Vim } from '@replit/codemirror-vim';

import {
  type KeySource,
  SCOPE_ATTRIBUTE,
  setScopeSource,
  type Target,
  type VimKey,
} from '../commands/index.ts';
import { iconElement } from '../iconElement.ts';
import { reveal, scrollPane } from '../reveal.ts';
import type {
  BoxFrame,
  BoxParts,
  Composer,
  ComposerEvents,
  HeldText,
  KeptBox,
  Mode,
  Send,
} from './api.ts';
import { mapJumps } from './jumps.ts';
import {
  clearVim,
  idle,
  installVim,
  leaveToNormal,
  modeName,
  onVim,
  onVimMode,
  passToVim,
  readOnly,
  setVimKeys,
  switchVim,
  vimMode,
  vimOn,
  vimPending,
} from './keys.ts';
import type { Side } from './layout.ts';
import type { ModeName } from './mode.ts';
import type { BoxHost } from './widgets.ts';

/** The scope of the box's own keys, `⌘⏎`, `⌥⏎`, `⌘⇧V` and `⌘⇧A`, which its editor runs first. */
const BOX_KEYS = 'box-keys';

/** The reader's input that takes a box's place on screen from it, as it opens. */
const INPUTS = ['keydown', 'pointerdown', 'wheel'] as const;

/** Where a box is: under a file's line on one side, by the file's index. */
export interface BoxPlace {
  file: number;
  side: Side;
  line: number;
}

export function placeKey(place: BoxPlace): string {
  return `${place.file}:${place.side}:${place.line}`;
}

/** What a box held as text says where it has none, as an empty state's row: its icon, its words. */
function heldEmpty(text: HeldText): HTMLElement {
  const row = document.createElement('span');
  row.className = 'lo-diffcomposer__empty';
  row.append(iconElement(text.icon, 14), text.empty);
  return row;
}

/** What a box is made with. */
export interface BoxOptions {
  /** What a key in the box acts on: the line it's under, and its thread. */
  target: Target;
  /** The thread it's written in, as a reply's box is, which it's drawn right after. */
  thread?: string | undefined;
  /** The comment of that thread it edits, in whose place it's drawn. */
  edits?: string | undefined;
  draft: string;
  on: ComposerEvents;
  frame: BoxFrame | undefined;
  nonce: string | undefined;
  label?: string | undefined;
  /** What it says while it's empty. */
  hint?: string | undefined;
  /** The box this one is, as it was, to open as it was where its text is the draft. */
  kept?: KeptBox | undefined;
  /**
   * `Esc` in the box, in Vim's normal mode with Vim keys on, or in the preview: the box's owner
   * closes it, or tells the caller.
   */
  escape: (box: CommentBox) => void;
  /**
   * `Esc` in the box while it's held, as while its comment is sent: focus goes back to where the
   * box is, and the box stays, the comment on it. Unless it's given, `escape` hears it.
   */
  leave?: ((box: CommentBox) => void) | undefined;
  /** `close()` on its handle: with `landed`, what it sent is drawn already. */
  close: (box: CommentBox, landed: boolean) => void;
  /** `dismiss()` on its handle: as `close()`, unless it's given. */
  dismiss?: ((box: CommentBox) => void) | undefined;
  /** The box grew or shrank as it was typed in, or as its editor changed width. */
  resized?: ((box: CommentBox) => void) | undefined;
  /** The box scrolled its pane to come on screen whole, as it took focus. */
  shown?: ((box: CommentBox) => void) | undefined;
}

export class CommentBox implements BoxHost, KeySource {
  readonly dom: HTMLElement;
  readonly view: EditorView;
  /** What a key in the box acts on. */
  readonly target: Target;
  /** The thread it's written in, if it's written in one. */
  readonly thread: string | undefined;
  /** The comment of that thread it edits, if it edits one. */
  readonly edits: string | undefined;
  /** The caller's handle on the box. */
  readonly composer: Composer;
  readonly #parts: BoxParts;
  readonly #on: ComposerEvents;
  readonly #escape: (box: CommentBox) => void;
  readonly #leave: ((box: CommentBox) => void) | undefined;
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
  /** Held, it stays as it was written, its text read-only, rather than showing its `sent` part. */
  #asText = false;
  /** Focus left the box as it moved into another widget, and is on its way back. */
  #refocusing = false;
  readonly #shown: ((box: CommentBox) => void) | undefined;
  /** Stops keeping the box on screen whole, while it's kept there. */
  #settle: (() => void) | undefined;
  /** How tall the box was when it was last laid out, which tells that it grew. */
  #tall: number | undefined;
  /**
   * Whether the box's foot was on screen as the reader last acted in it, or as it last put itself
   * there. Unknown once they act anywhere else, as when they scroll.
   */
  #whole: boolean | undefined;
  /**
   * How wide the box's pane was as the reader last acted in it, or as it last put itself on screen:
   * what's around the box moves it by itself only once the pane is another width, as the window
   * narrows and the code over it wraps again.
   */
  #width: number | undefined;

  constructor(options: BoxOptions) {
    installVim();
    const { on } = options;
    this.target = options.target;
    this.thread = options.thread;
    this.edits = options.edits;
    this.#on = on;
    this.#escape = options.escape;
    this.#leave = options.leave;
    this.#shown = options.shown;
    this.dom = document.createElement('div');
    this.dom.className = 'lo-diffcomposer';
    this.#followGrowth();
    this.dom.setAttribute(SCOPE_ATTRIBUTE, 'box');
    this.#parts = {
      head: part('head'),
      note: part('note'),
      preview: part('preview'),
      sent: part('sent'),
      dropzone: part('dropzone'),
      uploads: part('uploads'),
      foot: part('foot'),
    };
    const { head, note, preview, sent, dropzone, uploads, foot } = this.#parts;
    preview.hidden = true;
    preview.tabIndex = -1;
    sent.hidden = true;
    sent.tabIndex = -1;
    dropzone.hidden = true;
    const body = document.createElement('div');
    body.className = 'lo-diffcomposer__body';
    const send = (how: Send) => () => {
      if (this.text.trim()) on.submit(how);
      return true;
    };
    const extensions: Extension[] = [
      // Without Vim, the editor's own keys: typing, moving, selecting and undoing, as anywhere.
      switchVim(keymap.of([...historyKeymap, ...defaultKeymap])),
      this.#held.of([]),
      drawSelection(),
      history(),
      markdown(),
      syntaxHighlighting(classHighlighter),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': options.label ?? 'Comment' }),
      options.hint === undefined ? [] : placeholder(options.hint),
      // The foot stays at the foot of the box's pane while the box runs under it (`view.css`): the
      // caret keeps clear of it.
      EditorView.scrollMargins.of(() => ({ bottom: foot.offsetHeight })),
      options.nonce ? EditorView.cspNonce.of(options.nonce) : [],
      Prec.highest(
        keymap.of([
          // The box keeps Tab: it indents while the box is typed in, as in a Markdown list, and
          // does nothing in Vim's other modes, where the browser would move focus out of the box
          // and into the diff.
          {
            key: 'Tab',
            run: (view) => (this.#typing() ? indentMore(view) : true),
            shift: (view) => (this.#typing() ? indentLess(view) : true),
            preventDefault: true,
          },
        ]),
      ),
      // The box's own keys, which the keymap file's `vim` lines can't take: its keys run before
      // Vim's, which a keymap's own handler, at the default precedence, would follow.
      Prec.highest(
        keymap.of([
          { key: 'Mod-Enter', run: send('review'), scope: BOX_KEYS },
          { key: 'Alt-Enter', run: send('now'), scope: BOX_KEYS },
          {
            key: 'Mod-Shift-v',
            run: () => {
              this.preview(!this.#previewing);
              on.preview?.(this.#previewing);
              return true;
            },
            scope: BOX_KEYS,
          },
          {
            key: 'Mod-Shift-a',
            run: () => {
              on.attach?.();
              return true;
            },
            scope: BOX_KEYS,
          },
        ]),
      ),
      Prec.highest(
        EditorView.domEventHandlers({
          keydown: (event, view) => {
            if (runScopeHandlers(view, event, BOX_KEYS)) return true;
            // With Vim keys on, `Esc` is Vim's until it's in normal mode, waiting on nothing.
            if (event.key !== 'Escape' || (vimOn() && !idle(view))) return false;
            // While text is being composed, `Esc` is the input method's: it cancels the composition.
            if (event.isComposing || view.composing) return false;
            if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
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
    this.dom.append(sent, head, note, body, uploads, foot);
    this.composer = this.#handle(options);
    if (options.frame) this.#frame = options.frame(this.#parts, this.composer);
    this.#stops.push(
      setScopeSource(this.dom, this),
      onVimMode(this.view, () => on.mode?.(this.#mode())),
      // A box open as Vim keys go on is still being typed in.
      onVim(() => {
        if (vimOn() && !this.#holding && !this.#previewing) this.#insertMode();
      }),
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

  /**
   * The box's mode as its caller and Lo's keys see it: Vim's, or, with Vim keys off, insert mode,
   * since every key there types.
   */
  #mode(): Mode {
    return vimOn() ? vimMode(this.view) : 'insert';
  }

  /** Whether a key in the box now types in it: focus is in its text, in insert mode. */
  #typing(): boolean {
    return this.view.hasFocus && this.#mode() === 'insert';
  }

  /** Puts Vim in insert mode, where the caret is. */
  #insertMode(): void {
    const cm = getCM(this.view);
    if (!vimOn() || !cm || cm.state.vim?.insertMode === true) return;
    const { main } = this.view.state.selection;
    Vim.handleKey(cm, 'i', 'user');
    this.view.dispatch({ selection: { anchor: main.anchor, head: main.head } });
  }

  /**
   * Focuses the box, the caret at the end of the draft, in insert mode with Vim keys on; or its
   * preview while that shows. The box comes on screen whole.
   */
  focus(): void {
    this.#takeFocus();
    this.#show();
  }

  /**
   * Brings the box on screen whole, by the least scroll of its pane that does, and keeps it there
   * as its frame draws and it grows, until the reader's next key, press or wheel: where it is from
   * then on is theirs, but for its foot as it grows (`#followGrowth`). A box taller than its pane
   * shows from its top, its foot at the pane's (`view.css`).
   */
  #show(): void {
    this.#settle?.();
    const show = (): void => {
      if (!this.dom.isConnected) return;
      const pane = scrollPane(this.dom);
      const before = pane?.scrollTop;
      reveal(this.dom);
      if (pane && pane.scrollTop !== before) this.#shown?.(this);
    };
    // Once what opening it moved is back in place, and then as it's laid out; and as what's around
    // it is, once the pane is another width: the code over it wraps anew as the window narrows, a
    // frame or two after the box did. Anything else around an open box, such as a peek opening
    // above it, moves it as it moves the lines. Held, it's the card of what it sent, being looked
    // for, which nobody types in: it stays whole on screen as what's around it settles.
    queueMicrotask(show);
    const watch = new ResizeObserver(show);
    watch.observe(this.dom);
    const width = this.#paneWidth();
    const around = new ResizeObserver(() => {
      if (this.#holding || this.#paneWidth() !== width) show();
    });
    for (const each of scrollPane(this.dom)?.children ?? []) around.observe(each);
    const page = this.dom.ownerDocument;
    const settle = (): void => {
      watch.disconnect();
      around.disconnect();
      for (const type of INPUTS) page.removeEventListener(type, settle, { capture: true });
      this.#settle = undefined;
    };
    for (const type of INPUTS) {
      page.addEventListener(type, settle, { capture: true, passive: true });
    }
    this.#settle = settle;
  }

  /**
   * Keeps the box's foot clear of its pane's as the box grows with focus in it: as a line is typed,
   * its preview is drawn, or its text wraps again in less width. It's the least scroll that does,
   * as an editor keeps its caret on screen, and only for a foot that was on screen, so a box the
   * reader scrolled away from stays where they left it. One that shrinks moves nothing.
   */
  #followGrowth(): void {
    if (typeof ResizeObserver === 'undefined') return;
    // What's around it, which moves it as it's laid out anew: the code over it wraps again as the
    // window narrows, a frame or two after the box itself did.
    const around = new ResizeObserver(() => this.#moved());
    let pane: HTMLElement | null = null;
    const watchAround = (): void => {
      const now = this.dom.isConnected ? scrollPane(this.dom) : null;
      if (now === pane) return;
      around.disconnect();
      pane = now;
      for (const each of pane?.children ?? []) around.observe(each);
    };
    const watch = new ResizeObserver(() => {
      watchAround();
      this.#grew();
    });
    watch.observe(this.dom);
    const page = this.dom.ownerDocument;
    // Before what the input changes is laid out: where the foot is now is where the reader has it.
    const acted = (event: Event): void => {
      watchAround();
      const { target } = event;
      const inBox = event.type !== 'wheel' && target instanceof Node && this.dom.contains(target);
      // What the last input grew, if no frame has laid it out since, is followed first.
      if (inBox) this.#grew();
      this.#whole = inBox ? this.#footShows() : undefined;
      this.#width = this.#paneWidth();
    };
    for (const type of INPUTS) {
      page.addEventListener(type, acted, { capture: true, passive: true });
    }
    this.#stops.push(() => {
      watch.disconnect();
      around.disconnect();
      for (const type of INPUTS) page.removeEventListener(type, acted, { capture: true });
    });
  }

  /**
   * What's around the box was laid out anew in a pane of another width and moved it: with focus in
   * it and its foot on screen as the reader last acted in it, its foot comes back on screen, by the
   * least scroll that does. What moves it in a pane as wide, such as a peek opening above it, moves
   * it as it moves the lines.
   */
  #moved(): void {
    if (this.#settle || this.#whole !== true || !this.hasFocus) return;
    if (this.#paneWidth() === this.#width) return;
    const at = this.#foot();
    if (!at) return;
    const { pane, box, foot, below } = at;
    // Taller than its pane, it shows from its top.
    if (box.height + below > pane.clientHeight) return;
    const over = box.bottom + below - foot;
    if (over < 0.5) return;
    const before = pane.scrollTop;
    pane.scrollTop = before + over;
    if (pane.scrollTop !== before) this.#shown?.(this);
  }

  /** Where the box's foot is, and its pane's, with the room the box keeps clear under it. */
  #foot(): { pane: HTMLElement; box: DOMRect; foot: number; below: number } | undefined {
    const pane = this.dom.isConnected ? scrollPane(this.dom) : null;
    if (!pane) return undefined;
    const box = this.dom.getBoundingClientRect();
    const foot = pane.getBoundingClientRect().top + pane.clientTop + pane.clientHeight;
    const below = Number.parseFloat(getComputedStyle(this.dom).scrollMarginBottom) || 0;
    return { pane, box, foot, below };
  }

  #footShows(): boolean | undefined {
    const at = this.#foot();
    return at && at.box.bottom <= at.foot + 0.5;
  }

  #grew(): void {
    const at = this.#foot();
    if (!at) return;
    const { pane, box, foot, below } = at;
    const grew = this.#tall === undefined ? 0 : box.height - this.#tall;
    this.#tall = box.height;
    // While it's kept on screen whole as it opens, that's what moves it.
    if (this.#settle || grew < 0.5 || !this.hasFocus) return;
    const whole = this.#whole ?? box.bottom - grew <= foot + 0.5;
    // Taller than its pane, it shows from its top.
    if (!whole || box.height + below > pane.clientHeight) return;
    const over = box.bottom + below - foot;
    if (over < 0.5) return;
    const before = pane.scrollTop;
    pane.scrollTop = before + over;
    this.#whole = true;
    this.#width ??= pane.clientWidth;
    if (pane.scrollTop !== before) this.#shown?.(this);
  }

  /** How wide the box's pane is inside its edges, while the box is in one. */
  #paneWidth(): number | undefined {
    return this.dom.isConnected ? scrollPane(this.dom)?.clientWidth : undefined;
  }

  #takeFocus(): void {
    // Held, it's the comment it sent, and that has focus.
    if (this.#holding && !this.#asText) {
      this.#parts.sent.focus({ preventScroll: true });
      return;
    }
    if (this.#previewing) {
      this.#parts.preview.focus();
      return;
    }
    const { doc } = this.view.state;
    if (!vimOn()) {
      this.view.dispatch({ selection: { anchor: doc.length } });
      this.view.focus();
      return;
    }
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
    const cm = vimOn() ? getCM(this.view) : null;
    const sel = cm?.state.vim?.visualMode ? cm.state.vim.sel : undefined;
    const editor: Editor = {
      state: this.view.state.toJSON({ history: historyField }),
      mode: vimOn() ? modeName(this.view) : 'INSERT',
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
    if (this.#mode() === 'insert' || text === '') {
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

  replace(from: number, to: number, text: string, record = true): void {
    const { length } = this.view.state.doc;
    const clamp = (offset: number): number => Math.max(0, Math.min(length, Math.round(offset)));
    const start = clamp(Math.min(from, to));
    const end = clamp(Math.max(from, to));
    this.view.dispatch({
      changes: { from: start, to: end, insert: text },
      annotations: record ? [] : Transaction.addToHistory.of(false),
    });
  }

  /** Whether it's held, as while what it sent is on its way. */
  get held(): boolean {
    return this.#holding;
  }

  /**
   * Holds the text as it is, leaving Vim's insert mode, or lets it go. Held, the box is the comment
   * it sent: its `sent` part shows in place of everything else, and the rest comes back, with the
   * text and focus where they were, when it's let go, as after a send that failed. Held with
   * `text`, it stays as it was written, head and foot too, its text read-only and muted, and
   * `text.empty` where it has none.
   */
  hold(on: boolean, text?: HeldText): void {
    if (on === this.#holding) return;
    const focused = this.dom.contains(this.dom.ownerDocument.activeElement);
    if (on) this.#asText = text !== undefined;
    const card = !this.#asText;
    this.#holding = on;
    // Held, it's as tall as it was written in, however short the comment is as a card: nothing
    // under it moves until the comment's own card takes its place.
    if (card) this.dom.style.minHeight = on ? `${this.dom.getBoundingClientRect().height}px` : '';
    if (on) leaveToNormal(this.view);
    const empty = on && text !== undefined ? placeholder(heldEmpty(text)) : [];
    this.view.dispatch({ effects: this.#held.reconfigure(on ? [readOnly(), empty] : []) });
    if (card) {
      this.#parts.sent.hidden = !on;
      this.dom.classList.toggle('is-sent', on);
    } else {
      this.dom.classList.toggle('is-held', on);
    }
    if (!focused) return;
    // Focus stays in the box, so its keys and the code's don't change hands while it's sent.
    if (on && card) this.#parts.sent.focus({ preventScroll: true });
    else if (!on) this.focusShown();
  }

  /**
   * Shows the preview in the editor's place, or the editor again, its caret where it was. With Vim
   * keys on, the preview leaves insert mode, and the editor comes back in it if it was.
   */
  preview(on: boolean): void {
    if (on === this.#previewing) return;
    const focused = this.dom.contains(this.dom.ownerDocument.activeElement);
    if (on) {
      this.#resume =
        vimOn() && vimMode(this.view) === 'insert'
          ? this.view.state.selection.main.head
          : undefined;
      leaveToNormal(this.view);
    }
    this.#previewing = on;
    this.view.dom.hidden = on;
    this.#parts.preview.hidden = !on;
    this.dom.classList.toggle('is-preview', on);
    const resume = on ? undefined : this.#resume;
    const cm = getCM(this.view);
    if (resume !== undefined && cm && vimOn()) {
      // Back in insert mode, where the cursor was.
      this.#resume = undefined;
      Vim.handleKey(cm, 'i', 'user');
      this.view.dispatch({ selection: { anchor: Math.min(resume, this.view.state.doc.length) } });
    }
    if (focused) this.focusShown();
  }

  keyState(): ReturnType<KeySource['keyState']> {
    return {
      mode: this.#mode(),
      pending: vimPending(this.view),
      target: this.target,
      plain: !vimOn(),
    };
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
    this.#settle?.();
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
    const mode = (): Mode => this.#mode();
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
      hold: (on, text) => this.hold(on, text),
      insert: (text) => this.insert(text),
      replace: (from, to, text, record) => this.replace(from, to, text, record),
      preview: (on) => this.preview(on),
      close: (landed = false) => options.close(this, landed),
      dismiss: () => (options.dismiss ? options.dismiss(this) : options.close(this, false)),
      leave: () => this.#escape(this),
      keep: () => this.keep(),
    };
  }

  /**
   * Vim's mode, with the selection it keeps in a visual mode, and the preview, as they were in the
   * box this one is: its caret, selection and undo history came with its editor's state.
   */
  #resumeAs(was: Editor): void {
    const cm = vimOn() ? getCM(this.view) : null;
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
   * in the editor, and `Esc`, which closes the box.
   */
  #frameKey(event: KeyboardEvent): void {
    const { target } = event;
    if (event.defaultPrevented || !(target instanceof Node) || this.view.dom.contains(target)) {
      return;
    }
    // Of the editor's own keys, only `Tab` is the frame's too, which keeps focus in the box.
    if (
      (event.key === 'Tab' && runScopeHandlers(this.view, event, 'editor')) ||
      runScopeHandlers(this.view, event, BOX_KEYS)
    ) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Escape' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.shiftKey) return;
    event.preventDefault();
    // Held, as while its comment is sent, it stays, and says how that went: `Esc` only leaves it.
    if (this.#holding && this.#leave) this.#leave(this);
    else this.#escape(this);
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
