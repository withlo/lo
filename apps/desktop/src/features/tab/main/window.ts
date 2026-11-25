// The window's own state, which main keeps for it in `tab_window`, one row: the layout every pull
// request's tab draws its row with, and the window's place on screen. Each is read through a schema
// as it's read, so what a newer Lo wrote, or what's broken, reads as the first layout, or as no
// place, and a width outside its limits comes back within them.

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

/**
 * Whether a window at `place` can go back there: its top, where it's dragged from, is on one of
 * the displays whose work areas are `areas`, by enough to grab. Not once that display is gone.
 */
export function placeable(place: Area, areas: readonly Area[]): boolean {
  return areas.some((area) => {
    const across = Math.min(place.x + place.width, area.x + area.width) - Math.max(place.x, area.x);
    const down = Math.min(place.y + GRAB.height, area.y + area.height) - Math.max(place.y, area.y);
    return across >= GRAB.width && down >= GRAB.height;
  });
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
