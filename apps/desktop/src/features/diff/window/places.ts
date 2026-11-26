// Where the keys and the tree take a pull request's tab's diff and its whole-file view: a place in
// the tab's history, shown in the view it's in, which comes on screen to show it, and in the diff
// in the comparison it was in, which is compared again first; a changed file the tree shows in the
// diff; a review thread another feature shows in the diff; and any file opened whole. A place in a
// view not on screen waits for it to be drawn. With code beside a reading view, the code on screen
// shows a link's place where it is, and the line Lands; and it follows what has focus in the reading
// view, recording nothing and leaving focus there.

import { KEY_EVENT, type Side, type Target } from '@lo/ui/commands';

import { refuse, withdraw } from '../../../window/commands/notices.tsx';
import { here, registry } from '../../../window/commands/registry.ts';
import {
  compareAgain,
  comparisonComing,
  comparisonHere,
  holdLimit,
} from '../../revisions/window/shared.ts';
import { besideNow, focusInView, showMiddle } from '../../tab/window/shared.ts';
import { fileKey, type TreePath } from '../../tree/contract.ts';
import { onShowFile, pathOf } from '../../tree/window/shared.ts';
import type { Version } from '../contract.ts';
import { keyOf } from './loader.ts';
import { drawnFor, loaderOf, onDrawn, revealWhenDrawn } from './tabs.ts';
import { drawnName, keepWanted, shown, wantPlace, wantThread } from './wanted.ts';
import { changeAt, changedIn, DIFF_VIEW, known, opened, versionOf, WHOLE_VIEW } from './whole.ts';

/** How many files have been asked to open whole, so each ask is told from the last. */
let asks = 0;

/**
 * How a place in code is shown: `go`, as a link to code goes, a jump recorded in the tab's history
 * first, with focus going to the code; `follow`, as the code beside a reading view follows what has
 * focus there, with nothing recorded, nothing said, and focus where it is.
 */
export type ShowHow = 'go' | 'follow';

/** A follow asked for while a key repeats, which waits for the key to come up: only the last. */
let afterRepeat: (() => void) | undefined;
/** Whether the key held down repeats, as the window last heard. */
let repeating = false;
/** Whether the window's keys are heard for that yet. */
let hearing = false;

/** Runs `follow` now, or while a key repeats, once the key comes up: the code waits for the last press. */
function whenRested(follow: () => void): void {
  if (!hearing) {
    hearing = true;
    window.addEventListener(
      'keydown',
      (event) => {
        repeating = event.repeat;
      },
      true,
    );
    const rest = () => {
      repeating = false;
      const run = afterRepeat;
      afterRepeat = undefined;
      run?.();
    };
    window.addEventListener('keyup', rest, true);
    window.addEventListener('blur', rest);
  }
  if (repeating) {
    afterRepeat = follow;
    return;
  }
  afterRepeat = undefined;
  follow();
}

/**
 * Records where the tab is in the middle view in its history, as a jump does: for the middle
 * changing however it was asked, a click included, so `⌃o` comes back. A command that's a jump
 * has recorded it already, which recording again leaves as it is, and walking the history records
 * nothing.
 */
function leave(): void {
  const from = here();
  if (from) registry().history.record(from);
}

/**
 * Opens the file `key`, at `path`, whole in tab `tab`, in `version` where it has one, with its
 * cursor at `at` when given and the lines `marked` picked out, and brings the whole-file view on
 * screen. Focus goes to it with `focus`, and otherwise only when it's nowhere in particular. Where
 * the tab was is recorded in its history first, unless it's a `follow`.
 */
export function openWhole(
  tab: string,
  file: {
    key: string;
    path: TreePath;
    version: Version;
    at?: Target | undefined;
    marked?: { from: number; to: number } | undefined;
    focus: boolean;
  },
  how: ShowHow = 'go',
): void {
  if (how === 'go') leave();
  const loader = loaderOf(tab);
  const change = changedIn(loader.snapshot().state?.files, file.key);
  asks += 1;
  known.update(tab, (paths) => new Map(paths).set(file.key, file.path));
  opened.set(tab, {
    key: file.key,
    id: loader.ids.of(file.key),
    path: file.path,
    version: versionOf(change, file.version),
    marked: file.marked,
    ask: { at: file.at, focus: file.focus, count: asks },
  });
  showMiddle(tab, WHOLE_VIEW);
}

/**
 * When a thread shows: `now`, in the diff on screen, or once it's drawn; `drawn`, once the diff is
 * drawn anew, as for another comparison that's coming; `both`, now, and again if the diff is drawn
 * anew before the reader does anything else, as when a comparison that was coming is called off.
 */
export type ShowWhen = 'now' | 'drawn' | 'both';

/**
 * Shows review thread `thread` in tab `tab`'s diff, as `when` says: opens it and puts its line at
 * the top of the screen, a jump. With the diff on screen, `now` says whether it has the thread; a
 * diff not on screen comes on screen, and shows it once it's drawn with it, unless the reader does
 * anything else first. Focus stays where it is, as in the threads panel, which asks this: but with
 * code beside a reading view, the line Lands, and focus in either view goes to the code.
 */
export function showThread(tab: string, thread: string, when: ShowWhen): boolean {
  const drawn = drawnFor(tab);
  if (drawn && when !== 'drawn') {
    const has = drawn.view.openThread(thread, true);
    if (!has && when === 'now') return false;
    leave();
    shown(tab);
    if (has) {
      drawn.view.showThread(thread);
      if (besideNow()) {
        const at = { kind: 'thread', thread } as const;
        drawn.view.land(at);
        if (focusInView()) drawn.view.focus();
      }
    }
    if (when === 'both') wantThread(tab, thread);
    return true;
  }
  leave();
  wantThread(tab, thread, besideNow() && focusInView());
  if (!drawn) showMiddle(tab, DIFF_VIEW);
  return true;
}

/**
 * Shows review thread `thread` in tab `tab`'s diff, as a link to code does, `how` says how: to `go`
 * is a jump, the thread shown as the view shows one, the cursor on its line and focus in the code;
 * to `follow` brings its line on screen only if it's off it, once a key held to get there is let
 * go. Either opens it, and with code beside a reading view, its line Lands. A diff not on screen
 * comes on screen, and shows it once it's drawn with it, taking focus to `go`. Says whether the
 * diff on screen has the thread; to `follow`, whether there's a diff on screen to follow it in.
 */
export function goToThread(tab: string, thread: string, how: ShowHow): boolean {
  const drawn = drawnFor(tab);
  if (!drawn) {
    if (how === 'go') leave();
    wantThread(tab, thread, how === 'go');
    showMiddle(tab, DIFF_VIEW);
    return true;
  }
  const at = { kind: 'thread', thread } as const;
  if (how === 'follow') {
    whenRested(() => {
      if (drawnFor(tab) !== drawn || !drawn.view.openThread(thread, true)) return;
      drawn.view.reveal(at);
      if (besideNow()) drawn.view.land(at);
    });
    return true;
  }
  if (!drawn.view.openThread(thread, true)) return false;
  leave();
  shown(tab);
  drawn.view.showThread(thread);
  if (besideNow()) drawn.view.land(at);
  drawn.view.focus();
  return true;
}

/** A place asked for in each tab before its diff's files were known, and what stops it waiting. */
const waiting = new Map<string, () => void>();

/**
 * What the note says while a place waits for the diff's files. The reader moving on before they're
 * read isn't a failure: the note goes, and nothing more is said. One dropped as it waited too long
 * says nothing more either: the note said why.
 */
const WAITING = 'Reading changed files…';

/**
 * What the reader does that drops a place waiting for the diff's files, as they've moved on: a key,
 * as the key listener tells of it once it's their input (`KEY_EVENT`), those Lo's commands take
 * among them; a click; or the wheel.
 */
const INPUT = [KEY_EVENT, 'pointerdown', 'wheel'] as const;

/**
 * Shows line `line` of the file at `path` on side `side`, in tab `tab`: in the diff, on that side,
 * with the cursor on it, when the comparison on screen has the file there; otherwise the file
 * whole, with lines `marked` picked out. On the head's side (`new`) that's the file at the head on
 * screen; on the base's (`old`), a file the comparison leaves alone is the same there as at the
 * head, so it opens at the head. Without a line, the file's top. Where the tab was is recorded in
 * its history first, as a jump's place, and focus goes to the code. Until the diff's files are
 * known, which has the file isn't: a note says it waits for them, for up to `holdLimit()`. Past
 * that it's dropped; once the reader does anything else, it's dropped and the note goes with it. A
 * later place asked for in the tab takes its place. To `follow` records nothing and leaves focus
 * where it is; it waits for no files, and for a key that repeats to come up.
 */
export function showPlace(
  tab: string,
  path: string,
  line: number | undefined,
  marked?: { from: number; to: number },
  side: Side = 'new',
  how: ShowHow = 'go',
): void {
  if (how === 'follow') {
    whenRested(() => {
      if (loaderOf(tab).snapshot().state?.files) place(tab, path, line, marked, side, how);
    });
    return;
  }
  leave();
  waiting.get(tab)?.();
  const loader = loaderOf(tab);
  if (loader.snapshot().state?.files) {
    place(tab, path, line, marked, side, how);
    return;
  }
  refuse(WAITING);
  const stop = () => {
    listening();
    clearTimeout(bound);
    for (const type of INPUT) window.removeEventListener(type, moved, true);
    if (waiting.get(tab) === stop) waiting.delete(tab);
  };
  const moved = () => {
    stop();
    withdraw(WAITING, '');
  };
  const bound = setTimeout(stop, holdLimit());
  const listening = loader.subscribe(() => {
    if (!loader.snapshot().state?.files) return;
    stop();
    withdraw(WAITING, '');
    place(tab, path, line, marked, side, how);
  });
  // Not the key or click that asked for the place: the window has heard it already.
  for (const type of INPUT) window.addEventListener(type, moved, true);
  waiting.set(tab, stop);
}

/** Shows the place {@link showPlace} asks for, once the diff's files are known. */
function place(
  tab: string,
  path: string,
  line: number | undefined,
  marked: { from: number; to: number } | undefined,
  side: Side,
  how: ShowHow,
): void {
  const loader = loaderOf(tab);
  const change = changeAt(loader.snapshot().state?.files, path, side);
  const focus = how === 'go';
  if (change) {
    const file = loader.ids.of(keyOf(change));
    // A file the pull request deletes has no head's side, nor one it adds a base's.
    const there = side === 'new' ? change.change !== 'deleted' : change.change !== 'added';
    const target: Target =
      line === undefined || !there
        ? { kind: 'file', file }
        : { kind: 'line', at: { file, side, line } };
    const drawn = drawnFor(tab);
    if (drawn) {
      drawn.view.reveal(target);
      if (besideNow()) drawn.view.land(target);
      if (focus) drawn.view.focus();
      return;
    }
    revealWhenDrawn(tab, { target, focus });
    showMiddle(tab, DIFF_VIEW);
    return;
  }
  const whole: TreePath = { text: path };
  const key = fileKey(whole);
  const file = loader.ids.of(key);
  openWhole(
    tab,
    {
      key,
      path: whole,
      version: 'new',
      at: line === undefined ? undefined : { kind: 'line', at: { file, side: 'new', line } },
      marked,
      focus,
    },
    how,
  );
}

/** The whole path of the file `key` names in tab `tab`, as it was opened, the diff has it, or the tree. */
function pathFor(tab: string, key: string): TreePath {
  const change = changedIn(loaderOf(tab).snapshot().state?.files, key);
  return known.get(tab).get(key) ?? change?.path ?? pathOf(tab, key);
}

/** The file and side a place in a code view is on, if it's on one. */
function placeOf(target: Target): { file: string; side: Side } | undefined {
  switch (target.kind) {
    case 'line':
      return { file: target.at.file, side: target.at.side };
    case 'header':
      return { file: target.file, side: target.side };
    case 'file':
      return { file: target.file, side: 'new' };
    case 'thread':
    case 'layer':
    case 'block':
    case 'tab':
    case 'row':
    case 'box':
    case 'notice':
    case 'none':
      return undefined;
    default:
      throw new Error(`A target Lo doesn’t know: ${JSON.stringify(target satisfies never)}`);
  }
}

/**
 * Shows `target` in tab `tab`'s diff and focuses it: at once if the diff is drawn; otherwise once
 * it's drawn again, if it has the file, bringing it on screen. In another comparison than the one
 * on screen, `within`, it's compared again first, and shown once its diff is drawn. Going there is
 * the reader's last move, so another comparison still coming is called off, or replaced. Says
 * whether it could.
 */
function revealInDiff(tab: string, target: Target, within: string | undefined): boolean {
  const onScreen = comparisonHere(tab);
  const name = within ?? onScreen;
  if (name !== undefined && (name !== onScreen || comparisonComing(tab) !== undefined)) {
    const asked = compareAgain(tab, name);
    if (typeof asked !== 'string') return false;
    if (asked === 'coming') {
      const state = loaderOf(tab).snapshot().ready;
      wantPlace(tab, target, drawnName(state?.at, state?.comparison));
      if (!drawnFor(tab)) showMiddle(tab, DIFF_VIEW);
      return true;
    }
  }
  const drawn = drawnFor(tab);
  if (drawn) {
    if (!drawn.view.reveal(target)) return false;
    drawn.view.focus();
    return true;
  }
  const file = placeOf(target)?.file;
  const ready = loaderOf(tab).snapshot().ready;
  if (file === undefined || !ready?.entries.some((entry) => entry.id === file)) return false;
  revealWhenDrawn(tab, { target, focus: true });
  showMiddle(tab, DIFF_VIEW);
  return true;
}

/** Opens `target`'s file whole in tab `tab`, at `target`, and focuses it. */
function revealWhole(tab: string, target: Target): boolean {
  const at = placeOf(target);
  const key = at && loaderOf(tab).ids.keyOf(at.file);
  if (!at || key === undefined) return false;
  openWhole(tab, { key, path: pathFor(tab, key), version: at.side, at: target, focus: true });
  return true;
}

/**
 * Whether tab `tab`'s diff could still show `target`, in `within`, asked without showing it: a
 * file the comparison on screen has, drawn or read. A place in another comparison is compared
 * again first, and what can't be told counts as there: while another comparison is coming or the
 * files load, as a diff held while the next one loads, or where GitHub listed only some.
 */
function inDiff(tab: string, target: Target, within: string | undefined): boolean {
  if (within !== undefined && within !== comparisonHere(tab)) return true;
  const file = placeOf(target)?.file;
  const drawn = drawnFor(tab);
  const { ready } = loaderOf(tab).snapshot();
  if (file === undefined || !drawn || !ready || ready.partial) return true;
  if (comparisonComing(tab) !== undefined) return true;
  return drawn.order.includes(file) || ready.entries.some((entry) => entry.id === file);
}

/** The tabs whose history can reveal places in the diff and the whole-file view. */
const registered = new Set<string>();

/** Stops dropping the places that are gone as each diff is drawn, once it's started. */
let dropping: (() => void) | undefined;

/**
 * Lets tab `tab`'s history reveal its places in the diff and the whole-file view for as long as
 * the tab is open, whichever of them is on screen: `⌃o` from a whole file goes back to the diff.
 * As each diff is drawn, as when the comparison on screen changes or a push removes a file, the
 * places it no longer has are dropped, so Back goes to the nearest one still there.
 */
export function placesFor(tab: string): void {
  if (registered.has(tab)) return;
  registered.add(tab);
  const { history } = registry();
  history.register(
    tab,
    'diff',
    (target, within) => revealInDiff(tab, target, within),
    (target, within) => inDiff(tab, target, within),
  );
  history.register(tab, 'file', (target) => revealWhole(tab, target));
  dropping ??= onDrawn((id) => registry().history.dropGone(id));
}

/** Forgets the tabs that closed, those not in `open`: their history goes with them. */
export function keepPlaces(open: ReadonlySet<string>): void {
  for (const tab of registered) if (!open.has(tab)) registered.delete(tab);
  for (const [tab, stop] of waiting) if (!open.has(tab)) stop();
  keepWanted(open);
}

/**
 * Whether the files tab `tab`'s diff has on their way, to be drawn anew, hold the file `id`, though
 * the view drawn doesn't.
 */
function coming(tab: string, id: string): boolean {
  const { ready } = loaderOf(tab).snapshot();
  return ready?.entries.some((entry) => entry.id === id) ?? false;
}

/**
 * Shows the files the tree asks for: a changed one in the diff, its header at the top of the
 * screen with focus staying in the tree, and the diff brought back to show it; any one whole.
 * Either is a jump, which `⌃o` comes back from, whether a key or a click asked for it. With code
 * beside a reading view, the header Lands, and focus in either view, as Go to file… gives it
 * back there, goes to the code.
 */
export function showTreeFiles(): void {
  onShowFile('diff', (tab, key) => {
    // Its id, though the diff hasn't had its files yet, as before it's first shown: the files take
    // the same one as they come.
    const target = { kind: 'file', file: loaderOf(tab).ids.of(key) } as const;
    const drawn = drawnFor(tab);
    if (drawn) {
      if (drawn.order.includes(target.file)) {
        leave();
        drawn.toTop(target.file);
        if (besideNow()) {
          drawn.view.land(target);
          if (focusInView()) drawn.view.focus();
        }
      } else if (coming(tab, target.file)) {
        // A view of other files is about to be drawn, as the local copy's are: it shows it.
        leave();
        revealWhenDrawn(tab, { target, focus: false, top: true });
      }
      return;
    }
    leave();
    revealWhenDrawn(tab, { target, focus: false, top: true });
    showMiddle(tab, DIFF_VIEW);
  });
  onShowFile('whole', (tab, key, path) =>
    openWhole(tab, { key, path, version: 'new', focus: besideNow() && focusInView() }),
  );
}
