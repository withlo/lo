import type { ZoomStep } from '../contract.ts';

/** How far one step zooms, in Chromium's zoom levels, as Electron's menu roles step. */
export const ZOOM_STEP = 0.5;

/** The zoom level a step leads to from `level`: one step in or out, or back to 0, actual size. */
export function zoomed(level: number, step: ZoomStep): number {
  switch (step) {
    case 'in':
      return level + ZOOM_STEP;
    case 'out':
      return level - ZOOM_STEP;
    case 'reset':
      return 0;
    default:
      throw new Error(`a zoom step Lo doesn't know: ${JSON.stringify(step satisfies never)}`);
  }
}
