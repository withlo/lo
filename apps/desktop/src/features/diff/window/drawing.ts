// A tab's diff view, while it's drawn: what's been worked out of each file goes in as it arrives,
// a frame's worth at a time, so the page never stalls. When the local copy's files take the place
// of GitHub's and some start out otherwise (generated, large, or no longer either), a file off
// screen changes at once; one the reader is looking at stays as it is until it's scrolled away, or
// until the reader opens or closes it.

import { createDiffView, type DiffView, type Probe, type Target, type Viewport } from '@lo/ui/code';

import { openMenu } from '../../../window/commands/menus.tsx';
import { registry, setMiddle } from '../../../window/commands/registry.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import { followFile, onShowFile } from '../../tree/window/shared.ts';
import type { Start } from '../contract.ts';
import { diffFileOf, headerOf } from './files.ts';
import type { Entry, Loader, Shown } from './loader.ts';
import { main } from './main.ts';
import { setDrawn } from './tabs.ts';

declare global {
  interface Window {
    /**
     * The diff on screen, for the smoke test, in a build run from source: its readings, its
     * files' ids and paths, in the order it shows them, and what's at the top of the screen.
     */
    loDiff?:
      | {
          probe: Probe;
          files: { id: string; path: string }[];
          viewport(): Viewport;
          filesOnScreen(): readonly string[];
        }
      | undefined;
  }
}

/** Where a tab's view was when it went: its cursor, and what was at the top of the screen. */
export interface Place {
  readonly cursor: Target;
  readonly viewport: Viewport;
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
 * Runs work a few milliseconds at a time, so a lot of it never holds a frame up. It runs in tasks
 * of its own, not in a frame's callbacks, so the view measures what it changed before the page is
 * painted.
 */
class Pacer {
  readonly #tasks: (() => void)[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;

  /** Runs `task` soon, after those before it. */
  run(task: () => void): void {
    if (this.#stopped) return;
    this.#tasks.push(task);
    this.#timer ??= setTimeout(this.#pump, 0);
  }

  stop(): void {
    this.#stopped = true;
    this.#tasks.length = 0;
    clearTimeout(this.#timer);
  }

  readonly #pump = (): void => {
    this.#timer = undefined;
    const until = performance.now() + 8;
    while (this.#tasks.length > 0 && performance.now() < until) this.#tasks.shift()?.();
    if (this.#tasks.length > 0) this.#timer = setTimeout(this.#pump, 0);
  };
}

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

/** Draws the view of `entries`, fills in what's been worked out, and hooks it up. */
export function draw(options: DrawOptions): Drawing {
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
   * The local copy's lines of files that start out otherwise now and are on screen: they stay as
   * they were until they're scrolled away, lines and all.
   */
  const held = new Map<string, Shown>();
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

  const setLines = (id: string, shown: Shown) =>
    steady(() => {
      view.setLines(id, shown.lines, shown.diff);
      for (const side of ['old', 'new'] as const) {
        const triples = shown.tokens[side];
        if (triples) view.setTokens(id, side, triples);
      }
    });

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

  /** Makes the changes waiting on files the reader isn't looking at now. */
  const settle = () => {
    if (pending.size === 0 && held.size === 0) return;
    const looked = new Set(view.filesOnScreen());
    for (const [id, shown] of held) {
      if (looked.has(id)) continue;
      held.delete(id);
      setLines(id, shown);
    }
    for (const [id, { change, start }] of pending) {
      if (looked.has(id) || held.has(id)) continue;
      if (apply(id, change, start)) pending.delete(id);
    }
  };

  const view = createDiffView(
    parent,
    { files, layout: options.layout, vimKeys: keys.vimKeys(), nonce: options.nonce },
    {
      cursor: () => pacer.run(settle),
      mode() {},
      file(id) {
        followFile(tab.id, loader.ids.keyOf(id));
        pacer.run(settle);
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
  // Highlighting first, so each file is drawn once, with its diff.
  files.forEach((file) => {
    const shown = file.lines ? loader.shown(file.id) : undefined;
    if (!shown) return;
    for (const side of ['old', 'new'] as const) {
      const triples = shown.tokens[side];
      if (triples) view.setTokens(file.id, side, triples);
    }
    view.setDiff(file.id, shown.diff);
  });
  view.setMoves(loader.moves());
  loader.attach({
    lines(id, shown) {
      pacer.run(() => {
        // A file the reader is looking at that starts out otherwise now stays as it is.
        if (pending.has(id) && drawn.get(id) !== 'out' && view.filesOnScreen().includes(id)) {
          held.set(id, shown);
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
    diff: (id, diff) => pacer.run(() => steady(() => view.setDiff(id, diff))),
    failed: (id) => pacer.run(() => steady(() => view.loadFailed(id))),
    // Labels at moves' ends change the height of files above the screen too.
    moves: (moves) => pacer.run(() => steady(() => view.setMoves(moves))),
    tokens: (id, tokens) =>
      pacer.run(() => {
        for (const side of ['old', 'new'] as const) {
          const triples = tokens[side];
          if (triples) view.setTokens(id, side, triples);
        }
      }),
  });
  const stops = [
    setDrawn(tab.id, {
      view,
      loader,
      pull: { owner: tab.owner, repo: tab.repo, number: tab.number },
      acted(id) {
        pending.delete(id);
        const shown = held.get(id);
        held.delete(id);
        if (shown) setLines(id, shown);
      },
    }),
    setMiddle({
      focus: () => view.focus(),
      here: () => ({ view: 'diff', at: view.keyState().target }),
    }),
    keys.history.register(tab.id, 'diff', (target) => {
      if (!view.reveal(target)) return false;
      view.focus();
      return true;
    }),
    // A changed file the tree asks for: its header comes on screen, focus staying in the tree.
    onShowFile('diff', (id, key) => {
      const file = id === tab.id ? loader.ids.find(key) : undefined;
      if (file !== undefined) view.reveal({ kind: 'file', file });
    }),
    keys.subscribe(() => view.setVimKeys(keys.vimKeys())),
  ];
  const testing = options.packaged
    ? undefined
    : {
        probe: view.probe,
        files: files.map(({ id, path }) => ({ id, path })),
        viewport: () => view.viewport(),
        filesOnScreen: () => view.filesOnScreen(),
      };
  if (testing) window.loDiff = testing;
  // Back where the tab's last view was: its cursor, and what was at the top of the screen.
  const { before } = options;
  if (before) {
    view.reveal(before.cursor);
    view.scrollTo(before.viewport);
  }
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
          view.setHeader(entry.id, header);
        }
        const now = drawn.get(entry.id);
        const change = now === undefined ? undefined : changeFor(now, entry.versions.start);
        if (change) pending.set(entry.id, { change, start: entry.versions.start });
        else pending.delete(entry.id);
      }
      pacer.run(settle);
    },
    place: () => ({ cursor: view.keyState().target, viewport: view.viewport() }),
    stop() {
      pacer.stop();
      if (testing && window.loDiff === testing) window.loDiff = undefined;
      loader.attach(undefined);
      for (const stop of stops) stop();
    },
  };
}
