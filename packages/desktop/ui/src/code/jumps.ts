// Where Vim's jumps go. Vim keeps one jumplist for every editor, of positions alone, so going back
// after `Tab` landed on the other side's line numbers in this side's document, and it held on to
// editors long gone. In its place, each editor's jumps go to its owner: a code view's own editors
// hand theirs to the view, which hands them on as places to the tab's history, where `⌃o` and `⌃i`
// walk them as Lo's commands; any other editor, such as a comment box, keeps a list of its own,
// which `⌃o` and `⌃i` walk as Vim's keys there, and which goes with it.

import type { ChangeDesc } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Vim } from '@replit/codemirror-vim';

type JumpList = ReturnType<typeof Vim.getVimGlobalState_>['jumpList'];
type Adapter = Parameters<JumpList['add']>[0];

/** Hears a code view editor's jumps, between document positions. */
export type JumpSink = (from: number, to: number) => void;

/** As many as Vim keeps. */
const size = 100;

/** One editor's own jumps, as document positions. */
class OwnJumps {
  readonly positions: number[] = [];
  /** The jump the cursor is at, or was last taken to. */
  at = -1;

  add(from: number, to: number): void {
    // A new jump drops the ones after the current one, as Vim's does.
    this.positions.length = this.at + 1;
    if (this.positions[this.at] !== from) this.positions.push(from);
    this.positions.push(to);
    const over = this.positions.length - size;
    if (over > 0) this.positions.splice(0, over);
    this.at = this.positions.length - 1;
  }

  /** The position `offset` jumps from the current one, if there's one that far. */
  peek(offset: number): number | undefined {
    const index = this.at + offset;
    return index >= 0 && index < this.positions.length ? this.positions[index] : undefined;
  }

  /** Goes `offset` jumps from the current one, and gives its position, if there's one that far. */
  step(offset: number): number | undefined {
    const position = this.peek(offset);
    if (position !== undefined) this.at += offset;
    return position;
  }

  map(changes: ChangeDesc): void {
    for (let index = 0; index < this.positions.length; index++) {
      this.positions[index] = changes.mapPos(this.positions[index]!, -1);
    }
  }
}

const sinks = new WeakMap<EditorView, JumpSink>();
const own = new WeakMap<EditorView, OwnJumps>();

function viewOf(cm: Adapter): EditorView | undefined {
  const view: unknown = Reflect.get(cm, 'cm6');
  return view instanceof EditorView ? view : undefined;
}

function ownJumps(view: EditorView): OwnJumps {
  let jumps = own.get(view);
  if (!jumps) {
    jumps = new OwnJumps();
    own.set(view, jumps);
  }
  return jumps;
}

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

const list: JumpList = {
  cachedCursor: undefined,
  add(cm, oldCur, newCur) {
    const view = viewOf(cm);
    if (!view) return;
    const from = cm.indexFromPos(oldCur);
    const to = cm.indexFromPos(newCur);
    const sink = sinks.get(view);
    if (sink) sink(from, to);
    else ownJumps(view).add(from, to);
  },
  // A code view's own editors keep no list here: `⌃o` there is Lo's, and walks the tab's history.
  move(cm, offset) {
    const view = viewOf(cm);
    if (!view || sinks.has(view)) return undefined;
    const position = ownJumps(view).step(offset);
    return position === undefined ? undefined : marker(cm, position);
  },
  find(cm, offset) {
    const view = viewOf(cm);
    if (!view || sinks.has(view)) return undefined;
    const position = ownJumps(view).peek(offset);
    return position === undefined ? undefined : cm.posFromIndex(position);
  },
};

let installed = false;

/** Puts these lists in place of Vim's, once. */
export function installJumps(): void {
  if (installed) return;
  installed = true;
  // Vim offers no other way to its state than this hook, which its name marks as for tests.
  // oxlint-disable-next-line no-underscore-dangle
  Vim.getVimGlobalState_().jumpList = list;
}

/** Sends the jumps Vim makes in `view`, one of a code view's own editors, to `sink`. */
export function sendJumps(view: EditorView, sink: JumpSink): void {
  sinks.set(view, sink);
}

/** Moves the jumps `view` keeps itself with a change to its document. */
export function mapJumps(view: EditorView, changes: ChangeDesc): void {
  own.get(view)?.map(changes);
}
