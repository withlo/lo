// Where `Ctrl-o` and `Ctrl-i` go: the jumps Vim's motions make, each with the editor it was made
// in. Vim's own list is one for every editor and keeps only positions, so going back after `Tab`
// landed on the other side's line numbers in this side's document, and it held on to editors long
// gone. Here the diff's editors share one list, so going back can cross to the other side; a
// comment box has its own; and an editor's jumps go when it does.

import type { ChangeDesc } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Vim } from '@replit/codemirror-vim';

interface Jump {
  view: EditorView;
  pos: number;
}

type JumpList = ReturnType<typeof Vim.getVimGlobalState_>['jumpList'];
type Adapter = Parameters<JumpList['add']>[0];
type Pos = Parameters<JumpList['add']>[1];

/** As many as Vim keeps. */
const size = 100;

const jumps: Jump[] = [];
/** The jump the cursor is at, or was last taken to. */
let at = -1;
const diffEditors = new WeakSet<EditorView>();
let installed = false;

/** Whether a jump made in `from` is one `Ctrl-o` in `to` can go to. */
function together(from: EditorView, to: EditorView): boolean {
  return from === to || (diffEditors.has(from) && diffEditors.has(to));
}

function viewOf(cm: Adapter): EditorView | undefined {
  const view: unknown = Reflect.get(cm, 'cm6');
  return view instanceof EditorView ? view : undefined;
}

/**
 * The jump `offset` steps from the current one, among those `view` can go to, skipping editors
 * that are gone and moving the current one there; undefined if there's none that far.
 */
function step(view: EditorView, offset: number): Jump | undefined {
  const direction = Math.sign(offset);
  let index = at;
  let found: number | undefined;
  for (let left = Math.abs(offset); left > 0;) {
    index += direction;
    if (index < 0 || index >= jumps.length) break;
    const jump = jumps[index]!;
    if (!jump.view.dom.isConnected || !together(jump.view, view)) continue;
    found = index;
    left--;
  }
  if (found === undefined) return undefined;
  at = found;
  return jumps[found];
}

const list: JumpList = {
  cachedCursor: undefined,
  add(cm: Adapter, oldCur: Pos, newCur: Pos) {
    const view = viewOf(cm);
    if (!view) return;
    const from = cm.indexFromPos(oldCur);
    // A new jump drops the ones after the current one, as Vim's does.
    jumps.length = at + 1;
    const current = jumps[at];
    if (!current || current.view !== view || current.pos !== from) jumps.push({ view, pos: from });
    jumps.push({ view, pos: cm.indexFromPos(newCur) });
    if (jumps.length > size) jumps.splice(0, jumps.length - size);
    at = jumps.length - 1;
  },
  // Vim walks the list itself only in comment boxes: the diff's editors walk it in `walkJumps`.
  move(cm: Adapter, offset: number) {
    const view = viewOf(cm);
    const jump = view && step(view, offset);
    if (!jump || jump.view !== view) return undefined;
    return marker(cm, jump.pos);
  },
  find(cm: Adapter, offset: number) {
    const view = viewOf(cm);
    if (!view) return undefined;
    const before = at;
    const jump = step(view, offset);
    at = before;
    return jump && jump.view === view ? cm.posFromIndex(jump.pos) : undefined;
  },
};

function marker(cm: Adapter, offset: number): ReturnType<JumpList['move']> {
  return {
    cm,
    id: -1,
    offset,
    assoc: -1,
    clear() {},
    find: () => cm.posFromIndex(offset),
    update() {},
  };
}

/** Puts this list in place of Vim's, once. */
export function installJumps(): void {
  if (installed) return;
  installed = true;
  // Vim offers no other way to its state than this hook, which its name marks as for tests.
  // oxlint-disable-next-line no-underscore-dangle
  Vim.getVimGlobalState_().jumpList = list;
}

/** Makes `view` one of the diff's editors, whose jumps `Ctrl-o` in any of them goes back to. */
export function addDiffEditor(view: EditorView): void {
  diffEditors.add(view);
}

/**
 * `Ctrl-o` (back) or `Ctrl-i` (forward) in one of the diff's editors: the cursor goes to the jump
 * there, in the editor it was made in, which takes focus. Says whether there was one.
 */
export function walkJumps(view: EditorView, forward: boolean): boolean {
  const jump = step(view, forward ? 1 : -1);
  if (!jump) return false;
  const pos = Math.min(jump.pos, jump.view.state.doc.length);
  if (jump.view !== view) jump.view.focus();
  jump.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  return true;
}

/** Moves `view`'s jumps with a change to its document. */
export function mapJumps(view: EditorView, changes: ChangeDesc): void {
  for (const jump of jumps) if (jump.view === view) jump.pos = changes.mapPos(jump.pos, -1);
}

/** Drops `view`'s jumps, as it goes. */
export function forgetJumps(view: EditorView): void {
  for (let index = jumps.length - 1; index >= 0; index--) {
    if (jumps[index]!.view !== view) continue;
    jumps.splice(index, 1);
    if (index <= at) at--;
  }
}
