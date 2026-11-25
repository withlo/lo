import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { openDatabase, type Database } from '../../../main/database.ts';
import { migrate } from '../../../main/migrations.ts';
import { FIRST_LAYOUT } from '../contract.ts';
import {
  createPlaces,
  createWindowStore,
  placeIn,
  SETTLE_MS,
  type Area,
  type Place,
  type PlacedWindow,
  type WindowStore,
} from './window.ts';

// The feature's migrations, named by their paths in the app, as main finds them.
const migrations = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../migrations/*.sql', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([path, sql]) => [path.replace(/^\.\.\//, '/src/features/tab/'), sql]),
);

/** A database with the tab feature's tables. */
function database(): Database {
  const opened = openDatabase(':memory:');
  migrate(opened, migrations);
  return opened;
}

const limits = { left: { min: 220, max: 480 }, threads: { min: 280, max: 560 } };

describe('the window’s layout, as main keeps it', () => {
  it('is the first layout until one is kept, and what was kept after', () => {
    const on = database();
    const store = createWindowStore(on, limits);
    expect(store.layout()).toEqual(FIRST_LAYOUT);
    const kept = { left: { open: false, width: 260 }, threads: { open: true } };
    store.keepLayout(kept);
    // Read again as Lo starts next.
    expect(createWindowStore(on, limits).layout()).toEqual(kept);
  });

  it('comes back with each width within its limits', () => {
    const store = createWindowStore(database(), limits);
    store.keepLayout({ left: { open: true, width: 900 }, threads: { open: true, width: 100 } });
    expect(store.layout()).toEqual({
      left: { open: true, width: 480 },
      threads: { open: true, width: 280 },
    });
  });

  it('is the first layout where what was kept won’t read, and leaves out what it doesn’t name', () => {
    const on = database();
    const store = createWindowStore(on, limits);
    const keep = (text: string) =>
      on.prepare('INSERT OR REPLACE INTO tab_window (id, layout) VALUES (1, ?)').run(text);
    keep('{"left": {"open": true}');
    expect(store.layout()).toEqual(FIRST_LAYOUT);
    keep('{"left": {"open": "yes"}, "threads": {"open": false}}');
    expect(store.layout()).toEqual(FIRST_LAYOUT);
    // What a newer Lo keeps beside the panels.
    keep('{"left": {"open": false}, "threads": {"open": true}, "beside": true}');
    expect(store.layout()).toEqual({ left: { open: false }, threads: { open: true } });
  });

  it('keeps the window’s place beside it, each without the other', () => {
    const store = createWindowStore(database(), limits);
    expect(store.place()).toBeUndefined();
    const place = { x: 40, y: 60, width: 1440, height: 900, maximized: false, fullScreen: true };
    store.keepPlace(place);
    store.keepLayout(FIRST_LAYOUT);
    expect(store.place()).toEqual(place);
    expect(store.layout()).toEqual(FIRST_LAYOUT);
  });
});

describe('putting the window back', () => {
  const display = { x: 0, y: 25, width: 1512, height: 920 };

  it('goes where it was while its top is on a display, by enough to grab', () => {
    const place = { x: 100, y: 100, width: 1280, height: 800 };
    expect(placeIn(place, [display])).toEqual(place);
  });

  it('is fitted to the display that holds its top, smaller if it must be', () => {
    // Mostly off the side, but grabbable: it comes back whole.
    expect(placeIn({ x: 1350, y: 100, width: 1280, height: 800 }, [display])).toEqual({
      x: 232,
      y: 100,
      width: 1280,
      height: 800,
    });
    // Kept on a bigger display, opened on this one: no bigger than its work area, and on it.
    expect(placeIn({ x: 200, y: 40, width: 2400, height: 1300 }, [display])).toEqual({
      x: 0,
      y: 25,
      width: 1512,
      height: 920,
    });
    // Across two displays, it goes on the one with more of its top.
    const beside = { x: 1512, y: 0, width: 2560, height: 1415 };
    expect(placeIn({ x: 1300, y: 100, width: 1600, height: 1000 }, [display, beside])).toEqual({
      x: 1512,
      y: 100,
      width: 1600,
      height: 1000,
    });
  });

  it('opens where it would have once the display it was on is gone', () => {
    // It was on a display to the right that isn't there now.
    expect(placeIn({ x: 1600, y: 100, width: 1280, height: 800 }, [display])).toBeUndefined();
    // Its top above the work area, under the menu bar.
    expect(placeIn({ x: 100, y: -200, width: 1280, height: 210 }, [display])).toBeUndefined();
    expect(placeIn({ x: 100, y: 100, width: 1280, height: 800 }, [])).toBeUndefined();
  });
});

/** A window as Electron's would be, which records what it's told and says what it's asked. */
class FakeWindow implements PlacedWindow {
  bounds: Area = { x: 10, y: 50, width: 1280, height: 800 };
  maximized = false;
  fullScreen = false;
  destroyed = false;
  readonly #listeners = new Map<string, (() => void)[]>();

  setBounds(bounds: Area): void {
    this.bounds = bounds;
  }
  getNormalBounds(): Area {
    return this.bounds;
  }
  isMaximized(): boolean {
    return this.maximized;
  }
  isFullScreen(): boolean {
    return this.fullScreen;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  maximize(): void {
    this.maximized = true;
  }
  setFullScreen(on: boolean): void {
    this.fullScreen = on;
  }
  on(event: string, listener: () => void): void {
    this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
  }
  once(event: string, listener: () => void): void {
    const once = () => {
      this.#listeners.set(
        event,
        (this.#listeners.get(event) ?? []).filter((each) => each !== once),
      );
      listener();
    };
    this.on(event, once);
  }
  emit(event: string): void {
    for (const listener of this.#listeners.get(event) ?? []) listener();
  }
}

/** A store holding `place`, and the places it keeps after, in turn. */
function placesFrom(place?: Place): { store: WindowStore; keptPlaces: Place[] } {
  const store = createWindowStore(database(), limits);
  if (place) store.keepPlace(place);
  const keptPlaces: Place[] = [];
  const keepPlace = store.keepPlace.bind(store);
  store.keepPlace = (next) => {
    keptPlaces.push(next);
    keepPlace(next);
  };
  return { store, keptPlaces };
}

describe('the window’s place', () => {
  const areas = [{ x: 0, y: 25, width: 1512, height: 920 }];
  const kept = { x: 40, y: 60, width: 1200, height: 760, maximized: false, fullScreen: false };

  it('is where the window opens, as big, and maximized as it shows if it was', () => {
    const { store } = placesFrom({ ...kept, maximized: true });
    const window = new FakeWindow();
    createPlaces(store, () => {}).follow(window, areas);
    expect(window.bounds).toEqual({ x: 40, y: 60, width: 1200, height: 760 });
    expect(window.maximized).toBe(false);
    window.emit('ready-to-show');
    expect(window.maximized).toBe(true);
    expect(window.fullScreen).toBe(false);
  });

  it('puts the window back full screen once it shows, if it was', () => {
    const { store } = placesFrom({ ...kept, maximized: true, fullScreen: true });
    const window = new FakeWindow();
    createPlaces(store, () => {}).follow(window, areas);
    window.emit('ready-to-show');
    expect(window.maximized).toBe(false);
    window.emit('show');
    expect(window.fullScreen).toBe(true);
  });

  it('leaves a window where it opened with no place kept, or none on a display now', () => {
    const window = new FakeWindow();
    createPlaces(placesFrom().store, () => {}).follow(window, areas);
    expect(window.bounds).toEqual({ x: 10, y: 50, width: 1280, height: 800 });
    const gone = new FakeWindow();
    createPlaces(placesFrom({ ...kept, x: 3000, maximized: true }).store, () => {}).follow(
      gone,
      areas,
    );
    gone.emit('ready-to-show');
    expect(gone.bounds).toEqual({ x: 10, y: 50, width: 1280, height: 800 });
    expect(gone.maximized).toBe(false);
  });

  it('is kept once the window settles, at once as it fills the screen, and as it closes', () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { store, keptPlaces } = placesFrom();
    const window = new FakeWindow();
    createPlaces(store, () => {}).follow(window, areas);
    window.bounds = { x: 80, y: 90, width: 1000, height: 700 };
    window.emit('move');
    window.emit('resize');
    expect(keptPlaces).toEqual([]);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(keptPlaces).toEqual([
      { x: 80, y: 90, width: 1000, height: 700, maximized: false, fullScreen: false },
    ]);
    window.maximized = true;
    window.emit('maximize');
    window.emit('close');
    expect(keptPlaces.slice(1)).toEqual([
      { x: 80, y: 90, width: 1000, height: 700, maximized: true, fullScreen: false },
      { x: 80, y: 90, width: 1000, height: 700, maximized: true, fullScreen: false },
    ]);
    expect(store.place()).toEqual(keptPlaces.at(-1));
  });

  it('is kept for each open window as Lo quits, and not after, as the database closes', () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { store, keptPlaces } = placesFrom();
    const places = createPlaces(store, () => {});
    const open = new FakeWindow();
    const closed = new FakeWindow();
    places.follow(open, areas);
    places.follow(closed, areas);
    closed.emit('close');
    closed.emit('closed');
    keptPlaces.splice(0);
    open.bounds = { x: 70, y: 80, width: 900, height: 720 };
    // Moved, but stopped before it settles.
    open.emit('move');
    places.stop();
    expect(keptPlaces).toEqual([
      { x: 70, y: 80, width: 900, height: 720, maximized: false, fullScreen: false },
    ]);
    // Its windows close after, and the move's wait runs out: nothing is written.
    open.emit('close');
    vi.advanceTimersByTime(SETTLE_MS);
    expect(keptPlaces).toHaveLength(1);
  });

  it('says why a place can’t be kept, and the window closes anyway', () => {
    const { store } = placesFrom();
    store.keepPlace = () => {
      throw new Error('The database is not open.');
    };
    const lines: string[] = [];
    const window = new FakeWindow();
    createPlaces(store, (line) => lines.push(line)).follow(window, areas);
    expect(() => window.emit('close')).not.toThrow();
    expect(lines).toEqual(["couldn't keep the window's place: The database is not open."]);
  });
});
