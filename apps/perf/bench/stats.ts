// Summaries of what a run records: percentiles of frame and key times, and the median and worst of
// the runs.

/**
 * The `p`th percentile of `values`, the nearest-rank way: the smallest value at least `p` percent
 * of the values are at or under. Undefined for no values.
 */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.toSorted((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/** The largest of `values`, which can be more than a call can take as arguments. */
export function max(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : values.reduce((most, value) => Math.max(most, value));
}

/** The median of `values`: the middle one, or the mean of the middle two. */
export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The time between each frame and the one before it. */
export function frameTimes(starts: readonly number[]): number[] {
  return starts.slice(1).map((start, index) => start - starts[index]!);
}

/**
 * Frame times in whole refreshes of `refresh` ms, the display's period: each rounded to the
 * nearest, and never under one. The display's refreshes come up to a couple of milliseconds early
 * or late, so a frame that made its refresh can read 18 ms, and the next 15; one that missed it
 * reads two refreshes, about 33 ms.
 */
export function inRefreshes(times: readonly number[], refresh: number): number[] {
  return times.map((time) => Math.max(1, Math.round(time / refresh)) * refresh);
}

/**
 * The frame bars' limits, read in refreshes at 60 Hz: one is 16.7 ms, two 33.3 ms. The bars' “33 ms”
 * is two refreshes, and their “100 ms” six.
 */
export const oneRefresh = 16.7;
export const twoRefreshes = 33.4;

/** What a stretch of frames looked like. */
export interface FrameSummary {
  frames: number;
  p50?: number | undefined;
  p95?: number | undefined;
  p99?: number | undefined;
  max?: number | undefined;
  /** Frames longer than one refresh at 60 Hz, two, and 100 ms. */
  over16: number;
  over33: number;
  over100: number;
}

export function summarizeFrames(times: readonly number[]): FrameSummary {
  return {
    frames: times.length,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    max: max(times),
    over16: times.filter((time) => time > oneRefresh).length,
    over33: times.filter((time) => time > twoRefreshes).length,
    over100: times.filter((time) => time > 100.01).length,
  };
}

/**
 * Key-to-paint times from the Event Timing API, which reports a key only when it took at least
 * its threshold, 16 ms, rounded to 8 ms. A key it didn't report took less: it counts here as
 * `under`, below every reported time.
 */
export interface KeyTimes {
  /** The keys pressed. */
  keys: number;
  /** The times reported, one per key that took at least the threshold. */
  reported: number[];
  /** The threshold under which a key isn't reported. */
  under: number;
  /**
   * Where each reported key's time went: waiting for the main thread, in its handlers, and from
   * then to the paint.
   */
  parts: { waiting: number; handling: number; toPaint: number }[];
}

/**
 * The `p`th percentile of the keys' times, with each key not reported counted as under the
 * threshold. Undefined when that's where the percentile falls: then it's under the threshold.
 */
export function keyPercentile(times: KeyTimes, p: number): number | undefined {
  if (times.keys === 0) return undefined;
  const missing = Math.max(0, times.keys - times.reported.length);
  const all = [...Array.from({ length: missing }, () => -1), ...times.reported];
  const value = percentile(all, p);
  return value === undefined || value < 0 ? undefined : value;
}

/** A number for the report: rounded to `digits` places, or a dash for none. */
export function shown(value: number | undefined, digits = 1): string {
  if (value === undefined || !Number.isFinite(value)) return '–';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
