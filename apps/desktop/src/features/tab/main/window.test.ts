import { describe, expect, it } from 'vitest';

import { openDatabase, type Database } from '../../../main/database.ts';
import { migrate } from '../../../main/migrations.ts';
import { FIRST_LAYOUT } from '../contract.ts';
import { createWindowStore, placeable } from './window.ts';

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
    expect(placeable({ x: 100, y: 100, width: 1280, height: 800 }, [display])).toBe(true);
    // Mostly off the side, but grabbable.
    expect(placeable({ x: 1350, y: 100, width: 1280, height: 800 }, [display])).toBe(true);
  });

  it('opens where it would have once the display it was on is gone', () => {
    // It was on a display to the right that isn't there now.
    expect(placeable({ x: 1600, y: 100, width: 1280, height: 800 }, [display])).toBe(false);
    // Its top above the work area, under the menu bar.
    expect(placeable({ x: 100, y: -200, width: 1280, height: 210 }, [display])).toBe(false);
    expect(placeable({ x: 100, y: 100, width: 1280, height: 800 }, [])).toBe(false);
  });
});
