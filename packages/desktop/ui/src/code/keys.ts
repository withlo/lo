// Vim in code views, from CodeMirror's Vim package. The registry (`@lo/ui/commands`) sees every key
// first, runs Lo's commands, and hands the rest on to the focused editor's Vim. Here is what Lo
// changes in that Vim, once for the window, since its keymap and much of its state are global:
//
// - Lo's jumps are Vim motions, under the keys the registry gives (`setVimKeys`), so counts, visual
//   mode and operators work with them, and the keymap file's `vim` lines are Vim mappings.
// - A code view's own editors are read-only: no key changes their text, and none enters insert or
//   replace mode. Vim refuses most such keys itself in a read-only editor, but `o` and `O` would
//   leave it in insert mode, and a refused edit still moves the cursor, so what such a key, or an Ex
//   command from Vim's prompt, started is undone, the cursor back where it was.
// - Vim's jumplist goes (`jumps.ts`), and the keys that go by the screen go by the box that scrolls
//   (`screen.ts`).

import { Annotation, EditorState, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { CodeMirror, type CodeMirrorV, getCM, Vim } from '@replit/codemirror-vim';

import type { JumpTo, Mode, VimKey } from './api.ts';
import { diffMotions } from './api.ts';
import { installJumps, type JumpSink, sendJumps } from './jumps.ts';
import { defineScreenKeys } from './screen.ts';

/** What one of a code view's own editors does for Vim. */
export interface CodeEditor {
  /** The document line `count` stops of `to` after (or before) line `line`, if there's one. */
  jump(to: JumpTo, forward: boolean, line: number, count: number): number | undefined;
  /** Hears the jumps Vim makes in it. */
  jumped: JumpSink;
  /** Vim finished with a key, and anything it tried that a read-only editor refuses is undone. */
  settled(): void;
}

const editors = new WeakMap<EditorView, CodeEditor>();
/** The editors Vim is handling a key in, whose state is passing until it's done. */
const busy = new WeakSet<EditorView>();

/** Whether Vim is in the middle of handling a key in `view`, after which it settles. */
export function handlingKey(view: EditorView): boolean {
  return busy.has(view);
}

/** Marks a change a code view makes to its own editor's text, which no key may make. */
export const ownChange = Annotation.define<boolean>();

/**
 * What a code view's own editors have: their text changes only by the view, which marks the
 * change, and is read-only to Vim.
 */
export function readOnly(): Extension {
  return [
    EditorState.readOnly.of(true),
    EditorState.changeFilter.of((transaction) => transaction.annotation(ownChange) === true),
    noCompositions,
  ];
}

const compositionEvents = ['compositionstart', 'compositionupdate', 'compositionend'] as const;

/**
 * Cancels an input method's composition in a read-only editor's text, before CodeMirror sees it:
 * CodeMirror would follow the composed text, which the editor refuses, and a later focus change
 * would then fail on text no longer in the page. Moving focus out and back ends the composition.
 * Vim's prompt, outside the text, composes as any field does.
 */
const noCompositions = ViewPlugin.define((view) => {
  const cancel = (event: Event): void => {
    if (!(event.target instanceof Node) || !view.contentDOM.contains(event.target)) return;
    event.stopPropagation();
    if (event.type !== 'compositionstart') return;
    view.contentDOM.blur();
    view.focus();
  };
  for (const type of compositionEvents) view.dom.addEventListener(type, cancel, true);
  return {
    destroy() {
      for (const type of compositionEvents) view.dom.removeEventListener(type, cancel, true);
    },
  };
});

/** Makes `view` one of a code view's own editors, before any key is typed in it. */
export function addCodeEditor(view: EditorView, editor: CodeEditor): void {
  installVim();
  editors.set(view, editor);
  sendJumps(view, editor.jumped);
  // Vim's prompt runs an Ex command as its `Enter` is pressed, outside `handleKey`.
  view.dom.addEventListener('keydown', (event) => guardEx(view, editor, event), { capture: true });
}

/**
 * The Ex commands that would edit text or enter insert mode, by their names and the shortest each
 * is written: refused in a read-only editor, they still move the cursor, so it goes back.
 */
const editingEx: readonly { name: string; shortest: string }[] = [
  { name: 'delete', shortest: 'd' },
  { name: 'global', shortest: 'g' },
  { name: 'join', shortest: 'j' },
  { name: 'normal', shortest: 'norm' },
  { name: 'put', shortest: 'pu' },
  { name: 'redo', shortest: 'red' },
  { name: 'sort', shortest: 'sor' },
  { name: 'startinsert', shortest: 'start' },
  { name: 'substitute', shortest: 's' },
  { name: 'undo', shortest: 'u' },
  { name: 'vglobal', shortest: 'v' },
];

/** A range before an Ex command's name: lines, marks, patterns and offsets, joined by `,` or `;`. */
const exRange =
  /^(?:\s*(?:\d+|[.$%]|'.|\/(?:\\.|[^\\/])*\/?|\?(?:\\.|[^\\?])*\??)?(?:\s*[+-]\s*\d*)*\s*[,;]?)*\s*/;

/** Whether the Ex command `input`, as typed at Vim's `:` prompt, would edit text or insert. */
export function editsText(input: string): boolean {
  const word = /^[a-z]+/i.exec(input.replace(/^[\s:]*/, '').replace(exRange, ''))?.[0];
  if (!word) return false;
  return editingEx.some(
    ({ name, shortest }) => name.startsWith(word) && word.length >= shortest.length,
  );
}

/**
 * As `Enter` in Vim's `:` prompt runs an Ex command in `view`, keeps the cursor where it was if
 * the command would edit, and never leaves insert mode on: as `handleKey` does for a key.
 */
function guardEx(view: EditorView, editor: CodeEditor, event: KeyboardEvent): void {
  const input = event.target;
  if (event.key !== 'Enter' || !(input instanceof HTMLInputElement) || busy.has(view)) return;
  if (input.previousSibling?.textContent !== ':' || view.contentDOM.contains(input)) return;
  const before = view.state.selection;
  const edits = editsText(input.value);
  busy.add(view);
  let done = false;
  const after = (): void => {
    if (done) return;
    done = true;
    busy.delete(view);
    const cm = getCM(view);
    if (cm && hasVim(cm) && cm.state.vim.insertMode) {
      delete cm.state.vim.insertModeRepeat;
      Vim.exitInsertMode(cm, true);
    }
    if (edits) view.dispatch({ selection: before, scrollIntoView: true });
    editor.settled();
  };
  // Vim's own listener on the prompt runs the command; this one, added later, runs after it.
  input.addEventListener('keydown', after, { once: true });
  setTimeout(after, 0);
}

function viewOf(cm: unknown): EditorView | undefined {
  const view: unknown = typeof cm === 'object' && cm !== null ? Reflect.get(cm, 'cm6') : undefined;
  return view instanceof EditorView ? view : undefined;
}

let installed = false;

/** Changes Vim for code views, once. */
export function installVim(): void {
  if (installed) return;
  installed = true;
  installJumps();
  defineScreenKeys();
  Vim.defineMotion('loJump', (cm, head, motionArgs) => {
    const view = viewOf(cm);
    const editor = view && editors.get(view);
    const to: unknown = Reflect.get(motionArgs, 'to');
    if (!editor || (to !== 'change' && to !== 'file' && to !== 'thread')) return head;
    const line = editor.jump(to, motionArgs.forward ?? true, head.line + 1, motionArgs.repeat);
    return line === undefined ? head : { line: line - 1, ch: 0 };
  });
  // Every key Vim handles passes through here, typed, mapped, replayed or repeated with `.`.
  const handleKey = Vim.handleKey.bind(Vim);
  Vim.handleKey = (cm, key, origin) => {
    const view = viewOf(cm);
    const editor = view && editors.get(view);
    if (!view || !editor || busy.has(view)) return handleKey(cm, key, origin);
    busy.add(view);
    try {
      return refuseEdits(view, cm, () => handleKey(cm, key, origin));
    } finally {
      busy.delete(view);
      editor.settled();
    }
  };
}

/**
 * Runs `handle`, Vim handling a key in `view`, one of a code view's own editors, and undoes what
 * it started that a read-only editor can't finish: insert or replace mode, and the cursor's move
 * for an edit, whose text never changed. A yank isn't an edit.
 */
function refuseEdits<T>(
  view: EditorView,
  cm: Parameters<typeof Vim.handleKey>[0],
  handle: () => T,
): T {
  const before = view.state.selection;
  const vim = hasVim(cm) ? cm.state.vim : undefined;
  const edit = { input: vim?.lastEditInputState, action: vim?.lastEditActionCommand };
  const handled = handle();
  if (!hasVim(cm)) return handled;
  const after = cm.state.vim;
  const inserting = after.insertMode;
  const edited =
    (after.lastEditInputState !== edit.input || after.lastEditActionCommand !== edit.action) &&
    after.lastEditInputState?.operator !== 'yank';
  if (inserting) {
    // Not as many times as a count asked.
    delete after.insertModeRepeat;
    Vim.exitInsertMode(cm, true);
  }
  if (inserting || edited) view.dispatch({ selection: before });
  return handled;
}

/** Whether Vim has started in `cm`, as it has in any editor a key reached. */
function hasVim(cm: Parameters<typeof Vim.handleKey>[0]): cm is CodeMirrorV {
  return Boolean(cm.state.vim);
}

/** The Vim key mappings `setVimKeys` made, to take back before the next. */
let mapped: { keys: string; context: Mode | undefined }[] = [];

/**
 * Maps Lo's motions to the keys the registry gives them, and the keymap file's `vim` lines, in
 * place of the last ones. Vim's keymap is global, so every code view has the same: a motion moves
 * only in a code view's own editors.
 */
export function setVimKeys(keys: readonly VimKey[]): void {
  installVim();
  for (const key of keys) {
    if (key.kind === 'motion' && !Object.hasOwn(diffMotions, key.command)) {
      throw new Error(`No code view runs ${key.command} as a motion: diffMotions doesn't list it.`);
    }
  }
  for (const { keys: lhs, context } of mapped.toReversed()) {
    // Vim's types want a mode, but a mapping made for every mode has none.
    Reflect.apply(Vim.unmap, Vim, [lhs, context]);
  }
  mapped = [];
  for (const key of keys) {
    if (key.kind === 'motion') {
      const motion = diffMotions[key.command]!;
      const args = { forward: motion.forward, to: motion.to, linewise: true, toJumplist: true };
      Vim.mapCommand(key.keys, 'motion', 'loJump', args, {});
      mapped.push({ keys: key.keys, context: undefined });
    } else {
      Vim.map(key.keys, key.to, key.mode);
      mapped.push({ keys: key.keys, context: key.mode });
    }
  }
}

/** Vim's mode in `view`. */
export function vimMode(view: EditorView): Mode {
  const vim = getCM(view)?.state.vim;
  if (vim?.insertMode) return 'insert';
  return vim?.visualMode ? 'visual' : 'normal';
}

/**
 * Whether Vim in `view` is in the middle of a command: after a count, an operator, a register, or
 * the first keys of a longer one.
 */
export function vimPending(view: EditorView): boolean {
  const input = getCM(view)?.state.vim?.inputState;
  if (!input) return false;
  return (
    input.keyBuffer.length > 0 ||
    input.prefixRepeat.length > 0 ||
    input.motionRepeat.length > 0 ||
    Boolean(input.operator) ||
    Boolean(input.motion) ||
    input.registerName !== undefined
  );
}

/** Drops whatever Vim in `view` is in the middle of, leaving its mode. */
export function clearVim(view: EditorView): void {
  const cm = getCM(view);
  const vim = cm?.state.vim;
  if (!cm || !vim || !vimPending(view)) return;
  const InputState: unknown = Object.getPrototypeOf(vim.inputState)?.constructor;
  if (typeof InputState !== 'function') return;
  vim.inputState = Reflect.construct(InputState, []);
  vim.expectLiteralNext = false;
  CodeMirror.signal(cm, 'vim-command-done', 'clear');
}

/**
 * Hands `keys`, in Vim's notation, to Vim in `view`, as if they were typed there: only while its
 * editor has focus. Typed keys reach Vim only there, so with focus elsewhere in the view, on its
 * scroller say, Vim would wait for keys that never come, and every key after would go to it.
 */
export function passToVim(view: EditorView, keys: readonly string[]): void {
  const cm = getCM(view);
  if (!cm || !view.contentDOM.contains(view.root.activeElement)) return;
  for (const key of keys) Vim.handleKey(cm, key, 'user');
}

/** Whether Vim in `view` is in normal mode with nothing typed towards a command. */
export function idle(view: EditorView): boolean {
  return vimMode(view) === 'normal' && !vimPending(view);
}

/** Calls `listener` with Vim's mode in `view` each time it changes. Returns a function that stops. */
export function onVimMode(view: EditorView, listener: (mode: Mode) => void): () => void {
  const cm = getCM(view);
  if (!cm) return () => {};
  const changed = (): void => listener(vimMode(view));
  CodeMirror.on(cm, 'vim-mode-change', changed);
  return () => CodeMirror.off(cm, 'vim-mode-change', changed);
}
