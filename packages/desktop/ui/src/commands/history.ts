// Where `⌃o` and `⌃i` go: one history per tab, of places. An entry is plain data (a view and a
// target), never an editor or a DOM node, so a view that's gone can't be reached through it, and
// going back after `Tab` lands on the side the jump was made on. Each view registers how it
// reveals an entry; an entry no view can reveal now (a closed file view, a file a push removed) is
// skipped.

import { plainTarget, type Place, type Span, type Target } from './targets.ts';

/** The views history's places are in. */
export type View = 'diff' | 'file' | 'overview' | 'timeline';

/** A place in a tab: a view, and where in it. */
export interface Entry {
  view: View;
  at: Target;
}

/** Shows `at` in its view and says whether it could. */
export type Reveal = (at: Target) => boolean;

/** As many entries as Vim keeps. */
export const HISTORY_LIMIT = 100;

interface List {
  entries: Entry[];
  /** The entry the tab is at, or `entries.length` when it's at a place not in the list. */
  index: number;
}

/** The window's histories, one per tab, and the views that reveal their entries. */
export class History {
  private readonly limit: number;
  private readonly lists = new Map<string, List>();
  private readonly reveals = new Map<string, Map<View, Reveal>>();
  /** The tab whose list `record`, `back` and `forward` use. Before any tab, the window's own. */
  private current = '';
  /** A view is revealing an entry: the jump it makes to get there is the walk's, not a new one. */
  private revealing = false;

  constructor(options: { readonly limit?: number } = {}) {
    this.limit = options.limit ?? HISTORY_LIMIT;
  }

  /** Makes `id` the current tab. */
  tab(id: string): void {
    this.current = id;
  }

  /** Forgets a closed tab's list and its views. */
  close(id: string): void {
    this.lists.delete(id);
    this.reveals.delete(id);
  }

  /**
   * Lets `view` in `tab` reveal its entries. Returns the function to call when the view goes, after
   * which its entries are skipped.
   */
  register(tab: string, view: View, reveal: Reveal): () => void {
    let views = this.reveals.get(tab);
    if (!views) {
      views = new Map();
      this.reveals.set(tab, views);
    }
    views.set(view, reveal);
    return () => {
      const current = this.reveals.get(tab);
      if (current?.get(view) === reveal) current.delete(view);
    };
  }

  /**
   * Records `from`, the place a jump leaves, in the current tab. Places ahead of where the tab
   * was in its history are dropped, as a browser's are. A jump a view makes while it reveals an
   * entry isn't recorded, so walking back keeps the places ahead.
   */
  record(from: Entry): void {
    if (this.revealing) return;
    const list = this.list();
    list.entries.length = Math.min(list.index + 1, list.entries.length);
    this.push(list, from);
    list.index = list.entries.length;
  }

  /**
   * Goes back to the newest earlier place a view can reveal, skipping the rest, and returns it.
   * `here` is where the tab is now, kept so that `forward` can come back to it.
   */
  back(here?: Entry): Entry | undefined {
    const list = this.list();
    if (list.index >= list.entries.length && here) {
      this.push(list, here);
      list.index = list.entries.length - 1;
    }
    for (let index = list.index - 1; index >= 0; index--) {
      const entry = list.entries[index];
      if (entry && this.reveal(entry)) {
        list.index = index;
        return entry;
      }
    }
    return undefined;
  }

  /** Goes forward to the next place a view can reveal, skipping the rest, and returns it. */
  forward(): Entry | undefined {
    const list = this.list();
    for (let index = list.index + 1; index < list.entries.length; index++) {
      const entry = list.entries[index];
      if (entry && this.reveal(entry)) {
        list.index = index;
        return entry;
      }
    }
    return undefined;
  }

  /** The current tab's entries, oldest first. */
  entries(): readonly Entry[] {
    return this.list().entries;
  }

  private list(): List {
    let list = this.lists.get(this.current);
    if (!list) {
      list = { entries: [], index: 0 };
      this.lists.set(this.current, list);
    }
    return list;
  }

  /** Adds a copy of `entry` as plain data, unless it's where the list already ends. */
  private push(list: List, entry: Entry): void {
    const last = list.entries.at(-1);
    if (last && same(last, entry)) return;
    list.entries.push({ view: entry.view, at: plainTarget(entry.at) });
    const over = list.entries.length - this.limit;
    if (over > 0) {
      list.entries.splice(0, over);
      list.index = Math.max(0, list.index - over);
    }
  }

  private reveal(entry: Entry): boolean {
    const reveal = this.reveals.get(this.current)?.get(entry.view);
    if (reveal === undefined) return false;
    this.revealing = true;
    try {
      return reveal(entry.at);
    } finally {
      this.revealing = false;
    }
  }
}

/** Whether two entries are one place: the same view, file, side and line, or the same thing. */
function same(a: Entry, b: Entry): boolean {
  if (a.view !== b.view) return false;
  const x = a.at;
  const y = b.at;
  if (x.kind === 'line' && y.kind === 'line') return sameAt(x.at, y.at);
  return JSON.stringify(plainTarget(x)) === JSON.stringify(plainTarget(y));
}

function sameAt(a: Place | Span, b: Place | Span): boolean {
  if (a.file !== b.file || a.side !== b.side) return false;
  if ('line' in a) return 'line' in b && a.line === b.line;
  return !('line' in b) && a.from === b.from && a.to === b.to;
}
