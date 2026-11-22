// A code view's plain keys: what its editors have in Vim's place while Vim keys are off, which is
// how Lo starts. The code is read with a caret, as text anywhere is: a click puts it, the arrows
// move it, Shift selects with either, and the system's copy takes the selection. Lo's own keys go
// on working, since the registry (`@lo/ui/commands`) runs them before a key reaches the editor, its
// jumps among them. Here are the few keys Lo documents as the code view's own, which Vim runs
// while it's on: `j` and `k` move by a line, `g g` and `G` go to the top and the end, `/` and `⌘F`
// search the code, and `n` and `N` go between the matches. A page goes by the box that scrolls
// (`screen.ts`), as Vim's does, since an editor here is as tall as its document. `Esc` ends a
// selection.

import { cursorDocEnd, cursorDocStart, standardKeymap } from '@codemirror/commands';
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  search,
  SearchQuery,
  searchPanelOpen,
  setSearchQuery,
} from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import { type EditorView, keymap, type Panel } from '@codemirror/view';

import { plainKeys } from './api.ts';
import { pageBy } from './screen.ts';

/** The search's field, at the foot of the code it searches. */
function searchPanel(view: EditorView): Panel {
  const dom = document.createElement('div');
  dom.className = 'lo-codesearch';
  const field = document.createElement('input');
  field.className = 'lo-codesearch__field';
  field.type = 'text';
  field.name = 'search';
  field.placeholder = 'Search';
  field.setAttribute('aria-label', 'Search');
  field.setAttribute('main-field', 'true');
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.value = getSearchQuery(view.state).search;
  const ask = (): void => {
    const query = new SearchQuery({ search: field.value, literal: true });
    view.dispatch({ effects: setSearchQuery.of(query) });
  };
  field.addEventListener('input', ask);
  field.addEventListener('keydown', (event) => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) findPrevious(view);
      else findNext(view);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  });
  dom.append(field);
  return {
    dom,
    mount() {
      field.select();
    },
    // What the search is for can change under the field, as when it opens on the selection.
    update(update) {
      for (const transaction of update.transactions) {
        for (const effect of transaction.effects) {
          if (effect.is(setSearchQuery) && effect.value.search !== field.value) {
            field.value = effect.value.search;
          }
        }
      }
    },
  };
}

/** Opens the search, or puts focus back in its field. */
function openSearch(view: EditorView): boolean {
  return openSearchPanel(view);
}

/** Closes the search, and ends a selection, leaving the caret at its head: nothing else is `Esc`'s. */
function leave(view: EditorView): boolean {
  const { main } = view.state.selection;
  if (main.empty && !searchPanelOpen(view.state)) return false;
  if (searchPanelOpen(view.state)) closeSearchPanel(view);
  if (!main.empty) view.dispatch({ selection: { anchor: main.head } });
  return true;
}

/**
 * Moves the caret `by` lines of the document, at the column it's at where the line is that long,
 * as Vim's `j` and `k` do: a line that wraps is one line, and so is a file's header. The arrows
 * move by the rows on screen, as they do in text anywhere.
 */
function lineBy(view: EditorView, by: number): boolean {
  const { doc, selection } = view.state;
  const { head } = selection.main;
  const from = doc.lineAt(head);
  const to = doc.line(Math.min(doc.lines, Math.max(1, from.number + by)));
  if (to.number !== from.number || !selection.main.empty) {
    view.dispatch({
      selection: { anchor: Math.min(to.to, to.from + (head - from.from)) },
      scrollIntoView: true,
      userEvent: 'select',
    });
  }
  return true;
}

/** The keys of `g g`: the registry holds the first for Lo's sequences, as it does `g d`'s. */
const [topHeld, topLast] = plainKeys.top.split(' ');

/** The editor whose held `g` came back to it, until the key pressed after it has run. */
let handed: EditorView | undefined;

/**
 * Takes `keys` in `view` with Vim keys off: keys the registry held for one of Lo's sequences that
 * the key being pressed doesn't go on with, which comes to the editor itself next. `g` is the one
 * such key a code view has a use for: before another `g`, it goes to the top.
 */
export function passPlain(view: EditorView, keys: readonly string[]): void {
  if (keys.length !== 1 || keys[0] !== topHeld) return;
  handed = view;
  // Only the key being pressed goes on with it.
  setTimeout(() => {
    if (handed === view) handed = undefined;
  });
}

/**
 * Whether `view` is in the middle of `g g`: its `g` came back, so the key being pressed is the
 * editor's, not the start of another of Lo's sequences.
 */
export function plainPending(view: EditorView): boolean {
  return handed === view;
}

/** Goes to the top on the `g` after a `g` handed back. */
function top(view: EditorView): boolean {
  if (handed !== view) return false;
  handed = undefined;
  return cursorDocStart(view);
}

/** What one of a code view's own editors has while Vim keys are off. */
export function plainCode(): Extension {
  return [
    search({ createPanel: searchPanel }),
    keymap.of([
      { key: plainKeys.down, run: (view) => lineBy(view, 1) },
      { key: plainKeys.up, run: (view) => lineBy(view, -1) },
      { key: plainKeys.search, run: openSearch },
      { key: 'Mod-f', run: openSearch, preventDefault: true },
      { key: plainKeys.nextMatch, run: findNext },
      { key: plainKeys.previousMatch, run: findPrevious },
      { key: topLast, run: top },
      { key: plainKeys.bottom, run: cursorDocEnd },
      { key: 'PageDown', run: (view) => pageBy(view, true) },
      { key: 'PageUp', run: (view) => pageBy(view, false) },
      { key: 'Escape', run: leave },
      ...standardKeymap,
    ]),
  ];
}
