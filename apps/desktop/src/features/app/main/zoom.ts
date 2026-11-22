import type { ZoomStep } from '../contract.ts';
import { ZOOM_STEPS } from '../settings.ts';

/**
 * The zoom a step leads to from `percent`: the next of {@link ZOOM_STEPS} up or down, which a
 * percent typed into the file between two of them steps to as well, or back to 100, actual size.
 * It stops at the ends.
 */
export function zoomed(percent: number, step: ZoomStep): number {
  switch (step) {
    case 'in':
      return ZOOM_STEPS.find((each) => each > percent) ?? ZOOM_STEPS.at(-1) ?? percent;
    case 'out':
      return ZOOM_STEPS.findLast((each) => each < percent) ?? ZOOM_STEPS[0];
    case 'reset':
      return 100;
    default:
      throw new Error(`a zoom step Lo doesn't know: ${JSON.stringify(step satisfies never)}`);
  }
}
