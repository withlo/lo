// A tab's diff view, while it's drawn: what's been worked out of each file goes in as it arrives,
// a frame's worth at a time, so the page never stalls. When the local copy's files take the place
// of GitHub's and some start out otherwise (generated, large, or no longer either), or a file's
// viewed mark changes elsewhere, a file off screen changes at once; one the reader is looking at
// stays as it is until it's off screen once the reader stops scrolling, or until the reader moves
// the cursor, opens or closes it. `e` closes a file the reader marks viewed at once, and puts the
// next file's header where the reader expects it. Review threads go under their lines as the
// threader places them, now and each time they change, and each file's header counts what its
// hold.

import {
  createDiffView,
  type DiffView,
  type Mark,
  type Place as Line,
  type Probe,
  type RenderThread,
  type Spot,
  type Target,
  type ThreadView,
  type Viewport,
} from '@lo/ui/code';
import { plainTarget } from '@lo/ui/commands';

import { openMenu } from '../../../window/commands/menus.tsx';
import { registry, setMiddle } from '../../../window/commands/registry.ts';
import { type ShownMarks, viewedMarkOf } from '../../revisions/window/shared.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import { followFile } from '../../tree/window/shared.ts';
import type { Start } from '../contract.ts';
import { explainer, marksOf, onExplained, sameMarks } from './explained.ts';
import { diffFileOf, headerOf, startWith } from './files.ts';
import type { Entry, Loader, Moved, Shown } from './loader.ts';
import { main } from './main.ts';
import { setDrawn, takeReveal } from './tabs.ts';
import { shown as shownWanted, wantedIn } from './wanted.ts';
import {
  type DiffThreads,
  NO_THREADS,
  onThreads,
  sameCounts,
  sameThreads,
  type ThreadedFile,
  threader,
} from './threads.ts';

declare global {
  interface Window {
    /**
     * The diff on screen, for the smoke test, in a build run from source: its readings, its
     * files' ids and paths, in the order it shows them, what's at the top of the screen, and how
     * many views the page has drawn.
     */
    loDiff?:
      | {
          probe: Probe;
          draws: number;
          files: { id: string; path: string }[];
          viewport(): Viewport;
          scrollTo(viewport: Viewport): boolean;
          filesOnScreen(): readonly string[];
          /** Closes a file as the local copy's say would, keeping what's on screen in place. */
          close(file: string): void;
          /** Gives the diff an overview's markers. */
          setMarks(marks: readonly Mark[]): void;
          /** Opens the note of the marker on a line, as its menu item does. */
          openNote(at: Line): boolean;
          /** The marks on the lines the overview explains, as the diff last gave them. */
          explained(): readonly Mark[];
          /** The review threads under the lines, as the diff last gave them. */
          threads(): readonly ThreadView[];
        }
      | undefined;
  }
}

/**
 * Where a tab's view was when it went: its cursor, what was at the top of the screen, and where
 * the cursor's line was, if it was on screen, which a view of the files in a new order puts back.
 */
export interface Place {
  readonly cursor: Target;
  readonly viewport: Viewport;
  readonly cursorAt?: Viewport | undefined;
}

/** The line or header `target` is on, if it's on one. */
function spotOf(target: Target): Spot | undefined {
  if (target.kind === 'line') {
    const { at } = target;
    // A span of lines is on the line its cursor is on, its end.
    if ('line' in at) return { kind: 'line', at };
    return { kind: 'line', at: { file: at.file, side: at.side, line: Math.max(at.from, at.to) } };
  }
  return target.kind === 'header' ? target : undefined;
}

/** A view drawn, and what's done with it while it's drawn. */
export interface Drawing {
  readonly view: DiffView;
  /** Takes the files as they are now: their headers, and how each starts out. */
  update(entries: readonly Entry[]): void;
  /** Takes the viewed marks as they show now: the headers' balls, and the files viewed closed. */
  setMarks(marks: ShownMarks): void;
  /** Where the view is, to come back to in another. */
  place(): Place;
  /**
   * Says whether the diff is the middle view on screen: while it's hidden, its keys and its place
   * in the window's history are another view's, and once it's shown again it takes them back,
   * shows a place asked for meanwhile, and takes focus that's nowhere in particular.
   */
  setShown(shown: boolean): void;
  /** Unhooks it, before it's destroyed. */
  stop(): void;
}

/** How a file is drawn: its lines, open or closed; kept out until it's loaded; or not a diff. */
type Drawn = 'shown' | 'collapsed' | 'out' | 'skipped';

/** What a file drawn one way needs to start out as `start`, if anything. */
type Change = 'close' | 'open' | 'bring';

function changeFor(drawn: Drawn, start: Start): Change | undefined {
  switch (start) {
    case 'shown':
      return drawn === 'collapsed' ? 'open' : drawn === 'out' ? 'bring' : undefined;
    case 'collapsed':
      return drawn === 'shown' ? 'close' : drawn === 'out' ? 'bring' : undefined;
    case 'large':
    case 'binary':
    case 'unchanged':
      // Lines already drawn stay in, closed; a file kept out stays out.
      return drawn === 'shown' ? 'close' : undefined;
    default:
      start satisfies never;
      throw new Error(`A start Lo doesn't know: ${JSON.stringify(start)}.`);
  }
}

/** How the pacer runs a task: after those before it, with a frame's share to itself, or first. */
type Pace = 'run' | 'alone' | 'first';

/**
 * Runs work a few milliseconds a frame, so a lot of it never holds a frame up. Each frame's share
 * runs in a task of its own just after the frame is painted, not in its callbacks, so the view
 * measures what it changed before the next one is.
 */
export class Pacer {
  readonly #tasks: { readonly task: () => void; readonly pace: Pace }[] = [];
  #frame: number | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;

  /** Runs `task` soon, after those before it. */
  run(task: () => void): void {
    this.#add(task, 'run');
  }

  /**
   * Runs `task` soon, after those before it, with a frame's share to itself: for work that changes
   * much of what's drawn, so the page it reads as it starts is laid out already, and its frame lays
   * out only its own change.
   */
  alone(task: () => void): void {
    this.#add(task, 'alone');
  }

  /**
   * Runs `task` in the next frame's share, before the tasks waiting but after others asked for this
   * way: for what follows a task, such as a file's colors after its lines.
   */
  first(task: () => void): void {
    this.#add(task, 'first');
  }

  #add(task: () => void, pace: Pace): void {
    if (this.#stopped) return;
    let at = this.#tasks.length;
    if (pace === 'first') {
      at = this.#tasks.findIndex((waiting) => waiting.pace !== 'first');
      if (at === -1) at = this.#tasks.length;
    }
    this.#tasks.splice(at, 0, { task, pace });
    this.#next();
  }

  stop(): void {
    this.#stopped = true;
    this.#tasks.length = 0;
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    clearTimeout(this.#timer);
  }

  /** Runs the next share once the next frame is painted. */
  #next(): void {
    if (this.#frame !== undefined || this.#timer !== undefined) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = undefined;
      this.#timer = setTimeout(this.#pump, 0);
    });
  }

  readonly #pump = (): void => {
    this.#timer = undefined;
    const until = performance.now() + 4;
    for (let ran = 0; this.#tasks.length > 0 && performance.now() < until; ran++) {
      const { task, pace } = this.#tasks[0]!;
      if (pace === 'alone' && ran > 0) break;
      this.#tasks.shift();
      task();
      if (pace === 'alone') break;
    }
    if (this.#tasks.length > 0) this.#next();
  };
}

/** How long the scroll stays still before the reader counts as having stopped, in milliseconds. */
const STILL_AFTER = 150;

/** Whether Lo runs as it ships, which keeps the smoke test's readings out of the page. */
export interface DrawOptions {
  parent: HTMLElement;
  tab: PullTab;
  loader: Loader;
  entries: readonly Entry[];
  at: string;
  /** The comparison of revisions it shows, by its key, or none for the whole pull request. */
  comparison: string | null;
  /** The commit a stack's layer is compared with, when it's that. */
  compareFrom: string | null;
  layout: 'split' | 'inline';
  nonce: string;
  packaged: boolean;
  /** Whether it's the middle view on screen as it's drawn. */
  shown: boolean;
  /** Where the tab's last view was, to come back to. */
  before: Place | undefined;
  /**
   * A file to put at the top of the screen, with the cursor on its header, in place of `before`: as
   * when the reader compares other revisions. Nothing happens when the view hasn't it.
   */
  onTop?: string | undefined;
  /** The viewed marks as they show: viewed files start closed. */
  marks: ShownMarks;
}

/** How many views the page has drawn, for the smoke test. */
let draws = 0;

/** Draws the view of `entries`, fills in what's been worked out, and hooks it up. */
export function draw(options: DrawOptions): Drawing {
  draws += 1;
  const { parent, tab, loader, entries, at, comparison, compareFrom } = options;
  const keys = registry();
  let marks = options.marks;
  /** The files as they are now, as `update` last gave them. */
  let latest: readonly Entry[] = entries;
  const markOf = (entry: Entry) =>
    viewedMarkOf(marks, entry.versions.path, entry.versions.previous);
  /** The review threads under the lines, and what each file's hold, as the threader last said. */
  let placed: DiffThreads = NO_THREADS;
  /** A file's header: its counts, tags and viewed mark, and its threads counted. */
  const headerFor = (entry: Entry) =>
    headerOf(entry.versions, markOf(entry), placed.counts.get(entry.id));
  /**
   * Files the reader marked viewed, or cleared, here: how they show is theirs to say now, so a
   * mark that changes again, as when GitHub didn't take it, doesn't open or close them.
   */
  const own = new Set<string>();
  const files = entries.map((entry) => diffFileOf(entry, loader.shown(entry.id), markOf(entry)));
  const drawn = new Map<string, Drawn>(
    files.map((file) => [
      file.id,
      file.lines === undefined
        ? file.skip === 'large'
          ? 'out'
          : 'skipped'
        : file.collapsed
          ? 'collapsed'
          : 'shown',
    ]),
  );
  /** Files to change once the reader isn't looking at them, and how. */
  const pending = new Map<string, { change: Change; start: Start }>();
  /**
   * Files on screen whose local copy's lines have come: they stay as they were, lines, diff and
   * colors, so nothing on screen moves, until they're off screen once the reader stops scrolling,
   * or the reader opens or closes them, and then take the loader's latest, whatever whitespace was
   * hidden or shown meanwhile.
   */
  const held = new Set<string>();
  /**
   * The moved code the view shows, and the latest found: a move at a file on screen, or held,
   * waits as the file does, since its labels change the file's height.
   */
  let shownMoves: readonly Moved[] = loader.moves();
  let latestMoves = shownMoves;

  /**
   * Gives a held file the loader's latest lines, diff and colors, asking for colors it lacks: one
   * the reader acted on, `onScreen`, or one that left the screen.
   */
  const release = (id: string, onScreen: boolean) => {
    if (!held.delete(id)) return;
    const shown = loader.shown(id);
    if (!shown) return;
    setLines(id, shown, onScreen);
    if (!shown.tokens.old && !shown.tokens.new) loader.recolor(id);
  };
  /** Files the reader asked to load, which come in as soon as they arrive. */
  const asked = new Set<string>();
  /** Files whose new lines came and wait their turn, with the latest that came. */
  const coming = new Map<string, Shown>();
  const pacer = new Pacer();

  /**
   * Changes the view while what's at the top of the screen stays where it is. It only keeps the
   * page: a cursor a key just moved stays where the key took the screen.
   */
  const steady = (change: () => void) => {
    const top = view.viewport();
    change();
    // A line that was on screen stays drawn, though the new diff collapses the lines around it.
    if (top.at.kind === 'line') view.fold({ kind: 'line', at: top.at.at }, 'open');
    view.holdTop(top);
  };

  const setTokens = (id: string, tokens: Shown['tokens']) => {
    for (const side of ['old', 'new'] as const) {
      const triples = tokens[side];
      if (triples) view.setTokens(id, side, triples);
    }
  };

  /** Gives a file its lines, and then its colors: in the next frame for a file `onScreen`. */
  const setLines = (id: string, shown: Shown, onScreen: boolean) => {
    steady(() => view.setLines(id, shown.lines, shown.diff));
    // Its colors in a task of their own, so a frame takes a file's lines or its colors. Off
    // screen, they wait for the work before them, such as other files' lines.
    const color = () => setTokens(id, shown.tokens);
    if (onScreen) pacer.first(color);
    else pacer.run(color);
  };

  /**
   * Brings a file the reader acts on up to the lines that came for it, held or still waiting their
   * turn, so the key acts on them, not on lines about to go. A file kept out comes in as asked.
   */
  const catchUp = (id: string) => {
    if (drawn.get(id) === 'out') return;
    const shown = coming.get(id);
    coming.delete(id);
    if (held.has(id)) release(id, true);
    else if (shown) setLines(id, shown, true);
  };

  /** Makes a change to a file now, `onScreen` or not. Returns whether it could. */
  const apply = (id: string, change: Change, start: Start, onScreen = false): boolean => {
    switch (change) {
      case 'close':
        steady(() => view.setCollapsed(id, true));
        drawn.set(id, 'collapsed');
        return true;
      case 'open':
        steady(() => view.setCollapsed(id, false));
        drawn.set(id, 'shown');
        return true;
      case 'bring': {
        const shown = loader.shown(id);
        if (!shown) return false;
        setLines(id, shown, onScreen);
        if (start === 'collapsed') steady(() => view.setCollapsed(id, true));
        drawn.set(id, start === 'collapsed' ? 'collapsed' : 'shown');
        return true;
      }
      default:
        change satisfies never;
        throw new Error(`A change Lo doesn't know: ${JSON.stringify(change)}.`);
    }
  };

  /** Shows the latest moves, but those at files on screen or held, which keep what they had. */
  const showMoves = () => {
    const looked = new Set(view.filesOnScreen());
    const waits = (move: Moved) =>
      [move.from.file, move.to.file].some((file) => looked.has(file) || held.has(file));
    const next = [...latestMoves.filter((move) => !waits(move)), ...shownMoves.filter(waits)];
    if (sameMoves(next, shownMoves)) return;
    shownMoves = next;
    steady(() => view.setMoves(next));
  };

  /** Whether a pass of `settleOne` is waiting its turn. */
  let settling = false;

  /** Makes the changes waiting on files the reader isn't looking at now, a file a task. */
  const settle = () => {
    const waiting = pending.size > 0 || held.size > 0 || !sameMoves(shownMoves, latestMoves);
    if (settling || !waiting) return;
    settling = true;
    pacer.alone(settleOne);
  };

  const settleOne = () => {
    settling = false;
    const looked = new Set(view.filesOnScreen());
    const made = (): boolean => {
      for (const id of held) {
        if (looked.has(id)) continue;
        release(id, false);
        return true;
      }
      for (const [id, { change, start }] of pending) {
        if (looked.has(id) || held.has(id) || !apply(id, change, start)) continue;
        pending.delete(id);
        return true;
      }
      return false;
    };
    if (made()) settle();
    else showMoves();
  };

  /** What the view registers while it's on screen, to take back as it's hidden. */
  let showing: (() => void)[] | undefined;
  /**
   * Puts file `id`'s header at the top of the screen with the cursor on it, on the side the cursor
   * goes to: the reader's jump, so it lands there however near the end it is. Says whether the view
   * has the file.
   */
  const toTop = (id: string): boolean => view.revealAtTop({ kind: 'file', file: id });
  const view = createDiffView(
    parent,
    { files, layout: options.layout, vimKeys: keys.vimKeys(), nonce: options.nonce },
    {
      cursor: settle,
      mode() {},
      file(id) {
        // Only while the diff is on screen: hidden behind another middle view, it still lays out,
        // and the tree marks that view's file.
        if (showing) followFile(tab.id, loader.ids.keyOf(id));
        settle();
      },
      jumped: (from) => keys.history.record({ view: 'diff', at: from }),
      load(id) {
        // `za` on a file kept out: the reader's to have now.
        const waiting = pending.get(id);
        pending.delete(id);
        if (waiting?.change === 'bring' && apply(id, 'bring', waiting.start, true)) return;
        asked.add(id);
        loader.load(id);
      },
      menu: (target, x, y) => {
        openMenu(target, { x, y });
      },
      // "Read it in the overview": a jump, from the line the note is under.
      explained(block, line) {
        if (explainer()?.read(tab.id, block)) {
          keys.history.record({ view: 'diff', at: { kind: 'line', at: line } });
        }
      },
    },
  );
  // The lines another feature explains, marked as it says, now and each time that changes. By each
  // file's whole path: a header shortens a long one.
  const whole = entries.map(({ id, versions }) => ({
    id,
    path: versions.path.text,
    change: versions.change,
  }));
  let explained: readonly Mark[] = [];
  const explain = () => {
    const next = marksOf(explainer()?.linesAt(tab.id, at) ?? [], whole);
    if (sameMarks(next, explained)) return;
    explained = next;
    view.setMarks(next);
  };
  explain();
  // The review threads under the lines, placed as the threader says for what each column shows, and
  // drawn by it, now and each time they change. The headers count what each file's hold.
  const toggle = (thread: string) => view.openThread(thread, 'toggle');
  let rendering: { readonly from: object; readonly render: RenderThread } | undefined;
  /** With `now`, as the view is made, before the reader has seen it, they all come at once. */
  const showThreads = (now = false) => {
    const given = threader();
    const next =
      given?.threadsIn(tab.id, { at, comparison, compareFrom, files: threadFiles(latest) }) ??
      NO_THREADS;
    if (given && rendering?.from !== given)
      rendering = { from: given, render: given.render(tab, toggle) };
    const before = placed;
    placed = next;
    if (!sameThreads(before.threads, next.threads) && rendering) {
      view.setThreads(next.threads, rendering.render, { now });
    }
    const counted = new Set([...before.counts.keys(), ...next.counts.keys()]);
    if ([...counted].some((id) => !sameCounts(before.counts.get(id), next.counts.get(id)))) {
      take(latest);
    }
    showWanted();
  };
  /**
   * The thread another feature asked the diff to show, once this view is on screen and has it:
   * opened, its line at the top of the screen. Focus stays where it is.
   */
  const showWanted = () => {
    const thread = wantedIn(tab.id);
    if (showing === undefined || thread === undefined || !view.openThread(thread, true)) return;
    shownWanted(tab.id);
    view.revealAtTop({ kind: 'thread', thread });
  };
  // Each file's diff and highlighting came with it.
  view.setMoves(shownMoves);
  loader.attach({
    lines(id, given) {
      coming.set(id, given);
      pacer.alone(() => {
        const shown = coming.get(id);
        // The reader took them already, or an earlier turn took the latest.
        if (!shown) return;
        coming.delete(id);
        const onScreen = view.filesOnScreen().includes(id);
        // A file the reader is looking at stays as it is, unless its new lines draw in the rows
        // it has, so nothing on screen moves.
        if (
          drawn.get(id) !== 'out' &&
          !asked.has(id) &&
          onScreen &&
          !view.keepsShape(id, shown.lines, shown.diff)
        ) {
          held.add(id);
          return;
        }
        if (drawn.get(id) !== 'out' || asked.delete(id)) {
          // In place of the lines it had, or a file the reader asked for.
          setLines(id, shown, onScreen);
          if (drawn.get(id) === 'out') drawn.set(id, 'shown');
          return;
        }
        // A file kept out that now starts out with its lines comes in once it's off screen.
        settle();
      });
    },
    // A held file shows GitHub's lines still: what's worked out of the local copy's waits for it.
    diff: (id, diff) =>
      pacer.run(() => {
        if (!held.has(id)) steady(() => view.setDiff(id, diff));
      }),
    failed: (id) =>
      pacer.run(() => {
        if (!held.has(id)) steady(() => view.loadFailed(id));
      }),
    // Labels at moves' ends change the height of files above the screen too: `steady` keeps what's
    // on screen in place.
    moves: (moves) =>
      pacer.run(() => {
        latestMoves = moves;
        showMoves();
      }),
    tokens: (id, tokens) =>
      pacer.run(() => {
        if (!held.has(id)) setTokens(id, tokens);
      }),
  });
  // Once the reader stops scrolling, what's waiting on files that left the screen is done.
  let still: ReturnType<typeof setTimeout> | undefined;
  const scrolled = () => {
    clearTimeout(still);
    still = setTimeout(settle, STILL_AFTER);
  };
  parent.addEventListener('scroll', scrolled, { capture: true, passive: true });
  const stops = [
    () => {
      parent.removeEventListener('scroll', scrolled, { capture: true });
      clearTimeout(still);
    },
    keys.subscribe(() => view.setVimKeys(keys.vimKeys())),
    onExplained(tab.id, explain),
    onThreads(tab.id, () => showThreads()),
  ];
  const setShown = (shown: boolean) => {
    if (shown === (showing !== undefined)) return;
    if (!shown) {
      for (const stop of showing ?? []) stop();
      showing = undefined;
      return;
    }
    showing = [
      setDrawn(tab.id, {
        view,
        loader,
        tab: tab.id,
        pull: { owner: tab.owner, repo: tab.repo, number: tab.number },
        order: files.map((file) => file.id),
        acted(id) {
          pending.delete(id);
          catchUp(id);
        },
        toTop,
        fileAt(target) {
          const spot = spotOf(target);
          const top = spot && view.probe.spotTop(spot);
          const box = parent.getBoundingClientRect();
          if (spot && top !== undefined && top >= box.top && top < box.bottom) {
            return spot.kind === 'header' ? spot.file : spot.at.file;
          }
          const [first] = view.filesOnScreen();
          if (first !== undefined) return first;
          const there = spot ?? view.viewport().at;
          return there.kind === 'header' ? there.file : there.at.file;
        },
        viewedHere(id, viewed, next) {
          // The next file's header stays where it is on screen, if it's there, and otherwise
          // comes to the top, as the next thing to read; with no file left to read, this one's.
          // One the foot of the screen cuts off comes up just far enough to show whole, since the
          // cursor goes to it. Where it is is where the reader sees it now, before anything of
          // this file changes: the lines it takes in below, held back while the reader looked at
          // it, move it.
          const to = next ?? id;
          const cursor = spotOf(view.keyState().target);
          const side = cursor?.kind === 'header' ? cursor.side : (cursor?.at.side ?? 'new');
          const header: Spot = { kind: 'header', file: to, side };
          const box = parent.getBoundingClientRect();
          const top = viewed ? view.probe.spotTop(header) : undefined;
          const bottom = viewed ? view.probe.spotBottom(header) : undefined;
          own.add(id);
          pending.delete(id);
          catchUp(id);
          // However the reader left it with `za`, as a file with lines to show is.
          const lines = drawn.get(id) === 'shown' || drawn.get(id) === 'collapsed';
          if (!viewed) {
            // Its lines come back under its header, and what's at the top of the screen stays.
            if (lines) {
              steady(() => view.setCollapsed(id, false));
              drawn.set(id, 'shown');
            }
            return;
          }
          const onScreen = top !== undefined && top >= box.top && top < box.bottom;
          if (lines) {
            view.setCollapsed(id, true);
            drawn.set(id, 'collapsed');
          }
          const height = top !== undefined && bottom !== undefined ? bottom - top : 0;
          const place = onScreen ? Math.max(box.top, Math.min(top, box.bottom - height)) : box.top;
          view.reveal({ kind: 'file', file: to });
          view.scrollTo({ at: header, offset: box.top - place });
        },
      }),
      setMiddle({
        focus: () => view.focus(),
        here: () => ({ view: 'diff', at: view.keyState().target }),
        // An overview's note open in the diff closes on `Esc` in the diff.
        escape: () => parent.contains(document.activeElement) && view.closeNote(),
      }),
    ];
    // The tree marks the file at the top of the screen again.
    const top = view.viewport().at;
    followFile(tab.id, loader.ids.keyOf(top.kind === 'line' ? top.at.file : top.file));
    // A place asked for while another middle view was on screen, as `⌃o` back from a whole file
    // asks for the place it left. The cursor already there stays as it is: revealing it again
    // would scroll it to the screen's edge, moving what's on screen. A file the tree asked for
    // comes to the top, wherever the cursor is.
    const waiting = takeReveal(tab.id);
    if (waiting?.top && waiting.target.kind === 'file') toTop(waiting.target.file);
    else if (waiting && !samePlace(waiting.target, view.keyState().target)) {
      view.reveal(waiting.target);
    }
    showWanted();
    // Focus that's nowhere in particular, or left behind in a middle view now hidden, comes to the
    // diff, as it does to any middle view.
    const focused = document.activeElement;
    const free =
      !focused ||
      focused === document.body ||
      focused.hasAttribute('data-lo-middle') ||
      focused.closest('[inert]') !== null;
    if (waiting?.focus || free) view.focus();
  };
  const testing = options.packaged
    ? undefined
    : {
        probe: view.probe,
        draws,
        files: files.map(({ id, path }) => ({ id, path })),
        viewport: () => view.viewport(),
        scrollTo: (viewport: Viewport) => view.scrollTo(viewport),
        close: (id: string) => steady(() => view.setCollapsed(id, true)),
        filesOnScreen: () => view.filesOnScreen(),
        setMarks: (given: readonly Mark[]) => view.setMarks(given),
        openNote: (line: Line) => view.openNote(line),
        explained: () => explained,
        threads: () => placed.threads,
      };
  if (testing) window.loDiff = testing;
  // Back where the tab's last view was: its cursor, and what was at the top of the screen. Or, for
  // another comparison, the cursor's file at the top, if this one has it.
  const { before, onTop } = options;
  if (onTop !== undefined && files.some((file) => file.id === onTop)) {
    toTop(onTop);
  } else if (before) {
    view.reveal(before.cursor);
    // The cursor's line where it was on the page, as when the reader changes the files' order; or
    // what was at the top of the screen.
    if (!(before.cursorAt && view.scrollTo(before.cursorAt))) view.scrollTo(before.viewport);
  }
  setShown(options.shown);
  // The diff at this head is on screen: it stays, until the reader loads a newer push, and so does
  // where it starts, until the reader asks for another start.
  main()
    .drawn({ id: tab.id, at, compareFrom })
    .catch((error: unknown) => console.error("Lo couldn't say the diff was drawn:", error));
  const headers = new Map(files.map((file) => [file.id, JSON.stringify(file.header)]));
  /** Takes the files as they are now, with their marks: headers, and how each starts out. */
  const take = (next: readonly Entry[]) => {
    latest = next;
    for (const entry of next) {
      const mark = markOf(entry);
      const header = headerFor(entry);
      const said = JSON.stringify(header);
      if (headers.has(entry.id) && headers.get(entry.id) !== said) {
        headers.set(entry.id, said);
        // A header at a time, as a new list can change every file's.
        pacer.run(() => steady(() => view.setHeader(entry.id, header)));
      }
      if (own.has(entry.id)) continue;
      const start = startWith(entry.versions, mark);
      const now = drawn.get(entry.id);
      const change = now === undefined ? undefined : changeFor(now, start);
      if (change) pending.set(entry.id, { change, start });
      else pending.delete(entry.id);
    }
    settle();
  };
  showThreads(true);
  return {
    view,
    update(next) {
      take(next);
      // A file's local copy may show it from where it was viewed, which places its threads anew.
      showThreads();
    },
    setMarks(next) {
      if (next === marks) return;
      marks = next;
      take(latest);
    },
    place: () => {
      const cursor = view.keyState().target;
      const spot = spotOf(cursor);
      const top = spot && view.probe.spotTop(spot);
      const box = parent.getBoundingClientRect();
      const shown = top !== undefined && top >= box.top && top < box.bottom;
      return {
        cursor,
        viewport: view.viewport(),
        cursorAt: spot && shown ? { at: spot, offset: box.top - top } : undefined,
      };
    },
    setShown,
    stop() {
      setShown(false);
      pacer.stop();
      if (testing && window.loDiff === testing) window.loDiff = undefined;
      loader.attach(undefined);
      for (const stop of stops) stop();
    },
  };
}

/** The files of a diff as its threads are looked up on them. */
function threadFiles(entries: readonly Entry[]): ThreadedFile[] {
  return entries.map(({ id, key, versions }) => ({
    id,
    key,
    path: versions.change === 'deleted' ? null : versions.path.text,
    old: versions.change === 'added' ? null : (versions.previous ?? versions.path).text,
    since: versions.since !== null,
  }));
}

/** Whether two lists hold the same moves, in any order. */
function sameMoves(a: readonly Moved[], b: readonly Moved[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a.map((move) => JSON.stringify(move)));
  return b.every((move) => seen.has(JSON.stringify(move)));
}

/** The line a target's cursor is on, or for a header or a file, the target itself. */
function cursorOf(target: Target): string {
  if (target.kind !== 'line') return JSON.stringify(plainTarget(target));
  const { at } = target;
  const line = 'line' in at ? at.line : Math.max(at.from, at.to);
  return JSON.stringify({ file: at.file, side: at.side, line });
}

/** Whether two targets put the cursor in one place: on one line of one side of one file. */
export function samePlace(a: Target, b: Target): boolean {
  return cursorOf(a) === cursorOf(b);
}
