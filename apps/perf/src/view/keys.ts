// Keys in the diff: Vim's own, from CodeMirror's Vim package, and Lo's. Lo's jumps (`]c`, `]f`,
// `]t` and their `[` twins) are Vim motions, so counts, visual mode and the jumplist work with
// them; Vim's keymap is global, but they move only in a diff editor. `Ctrl-o` and `Ctrl-i` walk a
// jumplist the diff's editors share, so they can go back across to the other side. Lo's actions whose keys Vim
// uses for editing (`c`, `yl`, `gi`, `zo`, `zc`, `zR`, `za`) and `Tab` go through a handler on
// diff editors alone, ahead of Vim, so a comment box keeps Vim's meanings.

import { Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getCM, Vim } from '@replit/codemirror-vim';

import { idle } from './comments.ts';
import { addDiffEditor, installJumps, mapJumps, walkJumps } from './jumps.ts';

export type Target = 'change' | 'file' | 'thread';

export type Action =
  | 'comment'
  | 'copy-link'
  | 'inline'
  | 'open'
  | 'close'
  | 'open-file'
  | 'toggle-file'
  | 'other-side';

/** What a diff editor does for Lo's keys. */
export interface DiffKeys {
  /** The document line `count` targets after (or before) `line`, if there's one. */
  jump(target: Target, forward: boolean, line: number, count: number): number | undefined;
  /** Does `action` at the cursor of `view`. */
  act(action: Action, view: EditorView): void;
}

const single: Readonly<Record<string, Action>> = { c: 'comment' };
const sequences: Readonly<Record<string, Action>> = {
  yl: 'copy-link',
  gi: 'inline',
  zo: 'open',
  zc: 'close',
  zR: 'open-file',
  za: 'toggle-file',
};
const prefixes = new Set(Object.keys(sequences).map((sequence) => sequence[0]!));
const modifiers = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

const editors = new WeakMap<EditorView, DiffKeys>();
/** The first key of one of Lo's sequences, typed in an editor and held back from Vim. */
const pending = new WeakMap<EditorView, string>();

let motionsDefined = false;

/** Makes `]c`, `]f`, `]t` and the `[` keys Vim motions, once. */
function defineMotions(): void {
  if (motionsDefined) return;
  motionsDefined = true;
  installJumps();
  Vim.defineMotion('loJump', (cm, head, motionArgs) => {
    const view: unknown = cm.cm6;
    const keys = view instanceof EditorView ? editors.get(view) : undefined;
    const target: unknown = Reflect.get(motionArgs, 'target');
    if (!keys || (target !== 'change' && target !== 'file' && target !== 'thread')) return head;
    const line = keys.jump(target, motionArgs.forward ?? true, head.line + 1, motionArgs.repeat);
    return line === undefined ? head : { line: line - 1, ch: 0 };
  });
  for (const [key, target] of [
    ['c', 'change'],
    ['f', 'file'],
    ['t', 'thread'],
  ] as const) {
    for (const [bracket, forward] of [
      [']', true],
      ['[', false],
    ] as const) {
      Vim.mapCommand(
        `${bracket}${key}`,
        'motion',
        'loJump',
        { forward, target, linewise: true, toJumplist: true },
        {},
      );
    }
  }
}

/** The extension that gives a diff editor Lo's keys. */
export function diffKeys(keys: DiffKeys): ReturnType<typeof Prec.highest> {
  defineMotions();
  return Prec.highest([
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (modifiers.has(event.key)) return false;
        const prefix = pending.get(view);
        pending.delete(view);
        if (event.metaKey || event.ctrlKey || event.altKey) {
          // A key held back goes to Vim ahead of one with a modifier, as ahead of any other.
          const cm = getCM(view);
          if (prefix !== undefined && cm) Vim.handleKey(cm, prefix, 'user');
          const forward = event.key === 'i' ? true : event.key === 'o' ? false : undefined;
          if (
            event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            forward !== undefined &&
            idle(view)
          ) {
            event.preventDefault();
            walkJumps(view, forward);
            return true;
          }
          return false;
        }
        if (prefix !== undefined) {
          const action = sequences[prefix + event.key];
          if (action) {
            event.preventDefault();
            keys.act(action, view);
            return true;
          }
          // Not one of Lo's: Vim gets the held-back key, then this one as usual.
          const cm = getCM(view);
          if (cm) Vim.handleKey(cm, prefix, 'user');
          return false;
        }
        if (!idle(view)) return false;
        const action = event.key === 'Tab' && !event.shiftKey ? 'other-side' : single[event.key];
        if (action) {
          event.preventDefault();
          keys.act(action, view);
          return true;
        }
        if (prefixes.has(event.key)) {
          event.preventDefault();
          pending.set(view, event.key);
          return true;
        }
        return false;
      },
      // A key held back is for this editor alone: it goes when the editor loses focus.
      blur(_event, view) {
        pending.delete(view);
        return false;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) mapJumps(update.view, update.changes);
    }),
  ]);
}

/** Tells the keys which editor is a diff editor before any key is typed in it. */
export function registerDiffEditor(view: EditorView, keys: DiffKeys): void {
  editors.set(view, keys);
  addDiffEditor(view);
}
