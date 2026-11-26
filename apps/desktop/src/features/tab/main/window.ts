// The window's own state, which main keeps for it in `tab_window`, one row: the layout every pull
// request's tab draws its row with, and the window's place on screen. Each is read through a schema
// as it's read, so what a newer Lo wrote, or what's broken, reads as the first layout, or as no
// place, and a width outside its limits comes back within them. A window goes back to its place as
// it opens, fitted to a display only where part of it would be off every one, and its place is kept
// as it settles, as it closes, and as Lo quits.

import { z } from 'zod';

import type { Database } from '../../../main/database.ts';
import { FIRST_LAYOUT, type WindowLayout } from '../contract.ts';

/** The narrowest and widest a panel is drawn, in CSS pixels. */
interface Limits {
  readonly min: number;
  readonly max: number;
}

/** Each panel's limits, as the design tokens set them. */
export interface PanelLimits {
  readonly left: Limits;
  readonly threads: Limits;
}

const keptPanel = z.object({ open: z.boolean(), width: z.number().finite().optional() });

/**
 * A layout as it's kept: what it doesn't name, as a newer Lo's might, is left out, and what an
 * older Lo didn't keep, as code beside, is as it first is.
 */
const keptLayout = z.object({
  left: keptPanel,
  threads: keptPanel,
  beside: z.boolean().optional(),
  reading: z.number().finite().optional(),
  sides: z.number().finite().optional(),
});

/** A share of a width, kept, within it. */
const share = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Where the window is and how big, in the screen's points, as it is when it's neither maximized
 * nor full screen, and whether it's either.
 */
export interface Place {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly maximized: boolean;
  readonly fullScreen: boolean;
}

const keptPlace = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  maximized: z.boolean(),
  fullScreen: z.boolean(),
});

/** A rectangle on screen, in points: a display's work area, say. */
export interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** How much of a window's top must be on a display for it to go back there: enough to grab. */
const GRAB = { width: 120, height: 32 };

/** How much of the top of a window at `place`, the band it's dragged from, is on `area`. */
function overlap(place: Area, area: Area): { across: number; down: number } {
  const across = Math.min(place.x + place.width, area.x + area.width) - Math.max(place.x, area.x);
  const down = Math.min(place.y + GRAB.height, area.y + area.height) - Math.max(place.y, area.y);
  return { across: Math.max(0, across), down: Math.max(0, down) };
}

/** Whether the point at `x`, `y` is on `area`, its edges among it. */
function onArea(x: number, y: number, area: Area): boolean {
  return x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;
}

/**
 * Where a window kept at `place` goes back to, among the displays whose work areas are `areas`.
 * Nowhere once its top, where it's dragged from, isn't on them by enough to grab, as when the
 * display it was on is gone: across one display, and down the displays stacked under it, as a
 * top across the seam between two is. Where it was while each of its corners is on a display,
 * across two of them, say. Otherwise, fitted to the display that holds most of its top, smaller
 * if it must be, so its edges and corners can all be reached.
 */
export function placeIn(place: Area, areas: readonly Area[]): Area | undefined {
  const holding = areas
    .map((area) => ({ area, ...overlap(place, area) }))
    .filter((each) => each.across >= GRAB.width && each.down > 0);
  // Work areas don't overlap, so the ones under the top add up to how much of it is on screen.
  const down = holding.reduce((sum, each) => sum + each.down, 0);
  const [first, ...more] = holding;
  if (!first || down < GRAB.height) return undefined;
  const { x, y, width, height } = place;
  const corners = [
    [x, y],
    [x + width, y],
    [x, y + height],
    [x + width, y + height],
  ] as const;
  if (corners.every(([cx, cy]) => areas.some((area) => onArea(cx, cy, area)))) {
    return { x, y, width, height };
  }
  const on = more.reduce(
    (most, each) => (each.across * each.down > most.across * most.down ? each : most),
    first,
  ).area;
  const fitted = { width: Math.min(width, on.width), height: Math.min(height, on.height) };
  return {
    x: Math.max(on.x, Math.min(x, on.x + on.width - fitted.width)),
    y: Math.max(on.y, Math.min(y, on.y + on.height - fitted.height)),
    ...fitted,
  };
}

/** A panel as it's kept, its width within `limits`. */
function within(panel: z.output<typeof keptPanel>, { min, max }: Limits): WindowLayout['left'] {
  return panel.width === undefined
    ? { open: panel.open }
    : { open: panel.open, width: Math.max(min, Math.min(max, panel.width)) };
}

export interface WindowStore {
  /** The layout kept, each width within its limits, or the first layout. */
  layout(): WindowLayout;
  keepLayout(layout: WindowLayout): void;
  /** The place kept, or nothing. */
  place(): Place | undefined;
  keepPlace(place: Place): void;
}

/** The window's state in `database`, its panels' widths kept within `limits`. */
export function createWindowStore(database: Database, limits: PanelLimits): WindowStore {
  const read = (sql: string): unknown => {
    const text = database.prepare(sql).get()?.value;
    if (typeof text !== 'string') return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };
  return {
    layout() {
      const kept = keptLayout.safeParse(
        read('SELECT layout AS value FROM tab_window WHERE id = 1'),
      );
      if (!kept.success) return FIRST_LAYOUT;
      const { reading, sides } = kept.data;
      return {
        left: within(kept.data.left, limits.left),
        threads: within(kept.data.threads, limits.threads),
        beside: kept.data.beside ?? FIRST_LAYOUT.beside,
        // Shares of the two views' room, and of a diff's width, each within it.
        ...(reading === undefined ? {} : { reading: share(reading) }),
        ...(sides === undefined ? {} : { sides: share(sides) }),
      };
    },
    keepLayout(layout) {
      database
        .prepare(
          'INSERT INTO tab_window (id, layout) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET layout = excluded.layout',
        )
        .run(JSON.stringify(layout));
    },
    place() {
      const kept = keptPlace.safeParse(read('SELECT place AS value FROM tab_window WHERE id = 1'));
      return kept.success ? kept.data : undefined;
    },
    keepPlace(place) {
      database
        .prepare(
          'INSERT INTO tab_window (id, place) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET place = excluded.place',
        )
        .run(JSON.stringify(place));
    },
  };
}

/** What `createPlaces` uses of a window: Electron's `BrowserWindow`. */
export interface PlacedWindow {
  setBounds(bounds: Area): void;
  getNormalBounds(): Area;
  isMaximized(): boolean;
  isFullScreen(): boolean;
  isDestroyed(): boolean;
  maximize(): void;
  setFullScreen(on: boolean): void;
  on(event: string, listener: () => void): unknown;
  once(event: string, listener: () => void): unknown;
}

/** How long a window stays still before its place is kept, as it's dragged or resized. */
export const SETTLE_MS = 500;

/** The windows whose places are kept. */
export interface Places {
  /**
   * Puts `window` back where it was kept, as big, and maximized or full screen if it was, on the
   * displays whose work areas are `areas`, as `placeIn` fits it to them; unless the display that held
   * its top is gone, when it opens where it would have. Then keeps its place each time it settles, as
   * it closes, and as Lo quits.
   */
  follow(window: PlacedWindow, areas: readonly Area[]): void;
  /**
   * Keeps each open window's place now, as Lo quits, and nothing after, as a window that closes
   * or opens later does: the database closes next. Lo may close its windows before it stops its features or
   * after, so a window's place is kept as it closes or here, whichever comes first.
   */
  stop(): void;
}

/** Keeps windows' places in `store`, saying in `log` when one can't be kept. */
export function createPlaces(store: WindowStore, log: (line: string) => void): Places {
  const keepers = new Set<() => void>();
  let stopped = false;
  return {
    follow(window, areas) {
      // Lo is quitting, and the database is closing: a window made now, as by a link, stays where
      // it opened.
      if (stopped) return;
      const place = store.place();
      const bounds = place && placeIn(place, areas);
      if (place && bounds) {
        window.setBounds(bounds);
        // Maximized before it shows, so it's never drawn at its normal size first. Full screen is
        // the system's move, made once the window is there.
        if (place.fullScreen) window.once('show', () => window.setFullScreen(true));
        else if (place.maximized) window.once('ready-to-show', () => window.maximize());
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const keep = () => {
        clearTimeout(timer);
        timer = undefined;
        if (stopped || window.isDestroyed()) return;
        try {
          store.keepPlace({
            ...window.getNormalBounds(),
            maximized: window.isMaximized(),
            fullScreen: window.isFullScreen(),
          });
        } catch (error) {
          log(
            `couldn't keep the window's place: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      };
      const settle = () => {
        clearTimeout(timer);
        timer = setTimeout(keep, SETTLE_MS);
      };
      window.on('resize', settle);
      window.on('move', settle);
      for (const event of [
        'maximize',
        'unmaximize',
        'enter-full-screen',
        'leave-full-screen',
        'close',
      ]) {
        window.on(event, keep);
      }
      keepers.add(keep);
      window.once('closed', () => keepers.delete(keep));
    },
    stop() {
      for (const keep of keepers) keep();
      keepers.clear();
      stopped = true;
    },
  };
}
