// A tab's diff view, while it's drawn: what's been worked out of each file goes in as it arrives,
// a frame's worth at a time, so the page never stalls. When the local copy's files take the place
// of GitHub's and some start out otherwise (generated, large, or no longer either), a file off
// screen changes at once; one the reader is looking at stays as it is until it's off screen once
// the reader stops scrolling, or until the reader moves the cursor, opens or closes it.

import {
  createDiffView,
  type DiffView,
  type Probe,
  type Spot,
  type Target,
  type Viewport,
} from '@lo/ui/code';

import { openMenu } from '../../../window/commands/menus.tsx';
import { registry, setMiddle } from '../../../window/commands/registry.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import { followFile } from '../../tree/window/shared.ts';
import type { Start } from '../contract.ts';
import { diffFileOf, headerOf } from './files.ts';
import type { Entry, Loader, Moved, Shown } from './loader.ts';
import { main } from './main.ts';
import { setDrawn, takeReveal } from './tabs.ts';

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
  /** Where the view is, to come back to in another. */
  place(): Place;
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

/**
 * Runs work a few milliseconds a frame, so a lot of it never holds a frame up. Each frame's share
 * runs in a task of its own just after the frame is painted, not in its callbacks, so the view
 * measures what it changed before the next one is.
 */
class Pacer {
  readonly #tasks: (() => void)[] = [];
  #frame: number | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;

  /** Runs `task` soon, after those before it. */
  run(task: () => void): void {
    if (this.#stopped) return;
    this.#tasks.push(task);
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
    while (this.#tasks.length > 0 && performance.now() < until) this.#tasks.shift()?.();
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
  layout: 'split' | 'inline';
  nonce: string;
  packaged: boolean;
  /** Where the tab's last view was, to come back to. */
  before: Place | undefined;
}

/** How many views the page has drawn, for the smoke test. */
let draws = 0;

/** Draws the view of `entries`, fills in what's been worked out, and hooks it up. */
export function draw(options: DrawOptions): Drawing {
  draws += 1;
  const { parent, tab, loader, entries, at } = options;
  const keys = registry();
  const files = entries.map((entry) => diffFileOf(entry, loader.shown(entry.id)));
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

  /** Gives a held file the loader's latest lines, diff and colors, asking for colors it lacks. */
  const release = (id: string) => {
    if (!held.delete(id)) return;
    const shown = loader.shown(id);
    if (!shown) return;
    setLines(id, shown);
    if (!shown.tokens.old && !shown.tokens.new) loader.recolor(id);
  };
  /** Files the reader asked to load, which come in as soon as they arrive. */
  const asked = new Set<string>();
  const pacer = new Pacer();

  /** Changes the view while what's at the top of the screen stays where it is. */
  const steady = (change: () => void) => {
    const top = view.viewport();
    change();
    // A line that was on screen stays drawn, though the new diff collapses the lines around it.
    if (top.at.kind === 'line') view.fold({ kind: 'line', at: top.at.at }, 'open');
    view.scrollTo(top);
  };

  const setTokens = (id: string, tokens: Shown['tokens']) => {
    for (const side of ['old', 'new'] as const) {
      const triples = tokens[side];
      if (triples) view.setTokens(id, side, triples);
    }
  };

  const setLines = (id: string, shown: Shown) => {
    steady(() => view.setLines(id, shown.lines, shown.diff));
    // Its colors in a task of their own, so a frame takes a file's lines or its colors.
    pacer.run(() => setTokens(id, shown.tokens));
  };

  /** Makes a change to a file now. Returns whether it could. */
  const apply = (id: string, change: Change, start: Start): boolean => {
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
        setLines(id, shown);
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
    pacer.run(settleOne);
  };

  const settleOne = () => {
    settling = false;
    const looked = new Set(view.filesOnScreen());
    const made = (): boolean => {
      for (const id of held) {
        if (looked.has(id)) continue;
        release(id);
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

  const view = createDiffView(
    parent,
    { files, layout: options.layout, vimKeys: keys.vimKeys(), nonce: options.nonce },
    {
      cursor: settle,
      mode() {},
      file(id) {
        followFile(tab.id, loader.ids.keyOf(id));
        settle();
      },
      jumped: (from) => keys.history.record({ view: 'diff', at: from }),
      load(id) {
        // `za` on a file kept out: the reader's to have now.
        const waiting = pending.get(id);
        pending.delete(id);
        if (waiting?.change === 'bring' && apply(id, 'bring', waiting.start)) return;
        asked.add(id);
        loader.load(id);
      },
      menu: (target, x, y) => {
        openMenu(target, { x, y });
      },
    },
  );
  // Each file's diff and highlighting came with it.
  view.setMoves(shownMoves);
  loader.attach({
    lines(id, shown) {
      pacer.run(() => {
        // A file the reader is looking at stays as it is, unless its new lines draw in the rows
        // it has, so nothing on screen moves.
        if (
          drawn.get(id) !== 'out' &&
          !asked.has(id) &&
          view.filesOnScreen().includes(id) &&
          !view.keepsShape(id, shown.lines, shown.diff)
        ) {
          held.add(id);
          return;
        }
        if (drawn.get(id) !== 'out' || asked.delete(id)) {
          // In place of the lines it had, or a file the reader asked for.
          setLines(id, shown);
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
    setDrawn(tab.id, {
      view,
      loader,
      pull: { owner: tab.owner, repo: tab.repo, number: tab.number },
      acted(id) {
        pending.delete(id);
        release(id);
      },
    }),
    setMiddle({
      focus: () => view.focus(),
      here: () => ({ view: 'diff', at: view.keyState().target }),
    }),
    keys.subscribe(() => view.setVimKeys(keys.vimKeys())),
  ];
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
      };
  if (testing) window.loDiff = testing;
  // Back where the tab's last view was: its cursor, and what was at the top of the screen.
  const { before } = options;
  if (before) {
    view.reveal(before.cursor);
    // The cursor's line where it was on the page, as when the reader changes the files' order; or
    // what was at the top of the screen.
    if (!(before.cursorAt && view.scrollTo(before.cursorAt))) view.scrollTo(before.viewport);
  }
  // A place asked for while another middle view was on screen, as `⌃o` back from a whole file
  // asks for the place it left.
  const waiting = takeReveal(tab.id);
  if (waiting && view.reveal(waiting.target) && waiting.focus) view.focus();
  // Focus that's nowhere in particular comes to the diff, as it does to any middle view.
  const focused = document.activeElement;
  if (!focused || focused === document.body || focused.hasAttribute('data-lo-middle')) {
    view.focus();
  }
  // The diff at this head is on screen: it stays, until the reader loads a newer push.
  main()
    .drawn({ id: tab.id, at })
    .catch((error: unknown) => console.error("Lo couldn't say the diff was drawn:", error));
  const headers = new Map(files.map((file) => [file.id, JSON.stringify(file.header)]));
  return {
    view,
    update(next) {
      for (const entry of next) {
        const header = headerOf(entry.versions);
        const said = JSON.stringify(header);
        if (headers.has(entry.id) && headers.get(entry.id) !== said) {
          headers.set(entry.id, said);
          // A header at a time, as a new list can change every file's.
          pacer.run(() => steady(() => view.setHeader(entry.id, header)));
        }
        const now = drawn.get(entry.id);
        const change = now === undefined ? undefined : changeFor(now, entry.versions.start);
        if (change) pending.set(entry.id, { change, start: entry.versions.start });
        else pending.delete(entry.id);
      }
      settle();
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
    stop() {
      pacer.stop();
      if (testing && window.loDiff === testing) window.loDiff = undefined;
      loader.attach(undefined);
      for (const stop of stops) stop();
    },
  };
}

/** Whether two lists hold the same moves, in any order. */
function sameMoves(a: readonly Moved[], b: readonly Moved[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a.map((move) => JSON.stringify(move)));
  return b.every((move) => seen.has(JSON.stringify(move)));
}
