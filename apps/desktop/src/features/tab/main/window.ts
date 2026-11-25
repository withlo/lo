// The window's own state, which main keeps for it in `tab_window`, one row: the layout every pull
// request's tab draws its row with, and the window's place on screen. Each is read through a schema
// as it's read, so what a newer Lo wrote, or what's broken, reads as the first layout, or as no
// place, and a width outside its limits comes back within them. A window goes back to its place as
// it opens, fitted to the display it's on, and its place is kept as it settles, as it closes, and as
// Lo quits.

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

/** A layout as it's kept: what it doesn't name, as a newer Lo's might, is left out. */
const keptLayout = z.object({ left: keptPanel, threads: keptPanel });

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

/** How much of the top of a window at `place`, where it's dragged from, is across `area`. */
function grabbable(place: Area, area: Area): number {
  const across = Math.min(place.x + place.width, area.x + area.width) - Math.max(place.x, area.x);
  const down = Math.min(place.y + GRAB.height, area.y + area.height) - Math.max(place.y, area.y);
  return across >= GRAB.width && down >= GRAB.height ? across : 0;
}

/**
 * Where a window kept at `place` goes back to: the display whose work area holds most of its top,
 * where it's dragged from, by enough to grab, among the displays whose work areas are `areas`;
 * fitted to that work area, smaller if it must be, so its edges and corners can all be reached.
 * Nowhere once no display holds it, as when the display it was on is gone.
 */
export function placeIn(place: Area, areas: readonly Area[]): Area | undefined {
  let on: Area | undefined;
  let most = 0;
  for (const area of areas) {
    const across = grabbable(place, area);
    if (across > most) [on, most] = [area, across];
  }
  if (!on) return undefined;
  const width = Math.min(place.width, on.width);
  const height = Math.min(place.height, on.height);
  return {
    x: Math.max(on.x, Math.min(place.x, on.x + on.width - width)),
    y: Math.max(on.y, Math.min(place.y, on.y + on.height - height)),
    width,
    height,
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
      return {
        left: within(kept.data.left, limits.left),
        threads: within(kept.data.threads, limits.threads),
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
   * Puts `window` back where it was kept, as big, and maximized or full screen if it was, fitted to
   * the display it's on, whose work areas are `areas`; unless that display is gone, when it opens
   * where it would have. Then keeps its place each time it settles, as it closes, and as Lo quits.
   */
  follow(window: PlacedWindow, areas: readonly Area[]): void;
  /**
   * Keeps each open window's place now, as Lo quits, and nothing after, as a window that closes
   * later does: the database closes next. Lo may close its windows before it stops its features or
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
