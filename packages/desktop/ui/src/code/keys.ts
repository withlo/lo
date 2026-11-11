// Vim in code views, from CodeMirror's Vim package. The registry (`@lo/ui/commands`) sees every key
// first, runs Lo's commands, and hands the rest on to the focused editor's Vim. Here is what Lo
// changes in that Vim, once for the window, since its keymap and much of its state are global:
//
// - Lo's jumps are Vim motions, under the keys the registry gives (`setVimKeys`), so counts, visual
//   mode and operators work with them, and the keymap file's `vim` lines are Vim mappings.
// - A code view's own editors are read-only: no key changes their text, and none enters insert or
//   replace mode. Vim refuses most such keys itself in a read-only editor, but `o` and `O` would
//   leave it in insert mode, so a key that does is undone, the cursor back where it was.
// - Vim's jumplist goes (`jumps.ts`), and the keys that go by the screen go by the box that scrolls
//   (`screen.ts`).

import { Annotation, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
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
  ];
}

/** Makes `view` one of a code view's own editors, before any key is typed in it. */
export function addCodeEditor(view: EditorView, editor: CodeEditor): void {
  installVim();
  editors.set(view, editor);
  sendJumps(view, editor.jumped);
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
  for (const { keys: lhs, context } of mapped.toReversed()) {
    // Vim's types want a mode, but a mapping made for every mode has none.
    Reflect.apply(Vim.unmap, Vim, [lhs, context]);
  }
  mapped = [];
  for (const key of keys) {
    if (key.kind === 'motion') {
      const motion = Object.hasOwn(diffMotions, key.command) ? diffMotions[key.command] : undefined;
      if (!motion) continue;
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

/** Hands `keys`, in Vim's notation, to Vim in `view`, as if they were typed there. */
export function passToVim(view: EditorView, keys: readonly string[]): void {
  const cm = getCM(view);
  if (!cm) return;
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
