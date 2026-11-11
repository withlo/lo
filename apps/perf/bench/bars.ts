// The bars the diff view must meet, each with what it reads from a run, and how the runs are judged:
// the median and the worst of them, and a pass only when every run met the bar.

import type { RunResult, Stretch } from './results.ts';
import { keyPercentile, type KeyTimes, max, median, oneRefresh, twoRefreshes } from './stats.ts';

/**
 * A reading: a number, or for a key the Event Timing API didn't report, under its threshold.
 * Undefined when it wasn't measured.
 */
export type Reading = number | { under: number } | undefined;

export interface Bar {
  id: string;
  /** What's measured, as the report's table names it. */
  label: string;
  /** The bar for a pull request, as the report shows it. */
  shown: (pull: string) => string;
  /** The largest reading that passes, or with `strict` the least that doesn't. */
  limit: (pull: string) => number;
  strict?: boolean;
  unit: 'ms' | 'px' | 'MB' | '%' | 'count';
  read: (run: RunResult) => Reading;
  /** For a key: its reading less the floor, the run's minimal-paint key at the median. */
  aboveFloor?: (run: RunResult) => Reading;
}

/** How fast the full scrolls go, and the other speeds blank rows are checked at, in px a second. */
export const scrollSpeed = 8000;
export const checkSpeeds = [3000, 15_000];

const kubernetes = (pull: string): boolean => pull.startsWith('kubernetes');

export const bars: Bar[] = [
  {
    id: 'open',
    label: 'Open to first file painted with highlighting',
    shown: () => '≤ 400 ms',
    limit: () => 400,
    unit: 'ms',
    read: (run) => run.open.firstDrawn,
  },
  {
    id: 'computed',
    label: 'All diffs and moves computed',
    shown: (pull) => (kubernetes(pull) ? '≤ 2 s' : '≤ 5 s'),
    limit: (pull) => (kubernetes(pull) ? 2000 : 5000),
    unit: 'ms',
    read: (run) => run.open.loaded,
  },
  {
    id: 'openTask',
    label: 'Longest main-thread task while opening',
    shown: () => 'none over 50 ms',
    limit: () => 50,
    unit: 'ms',
    read: (run) => run.open.longestTask,
  },
  ...frameBars(
    'scroll',
    `Scrolling, top to bottom, ${scrollSpeed.toLocaleString('en-US')} px/s`,
    (run) => run.scroll,
  ),
  ...checkSpeeds.map((speed): Bar => ({
    id: `blank${speed}`,
    label: `Scrolling at ${speed.toLocaleString('en-US')} px/s: frames with blank rows`,
    shown: () => 'none',
    limit: () => 0,
    unit: 'count',
    read: (run) => run.speeds.find((check) => check.speed === speed)?.stretch.blank.frames,
  })),
  // PageDown's frames say nothing about the whole document while it stops short of the bottom.
  ...frameBars('pageDown', 'PageDown, top to bottom', (run) =>
    run.stuck.length === 0 && run.reached >= 1 ? run.pageDown : undefined,
  ),
  {
    id: 'pageDownStuck',
    label: 'PageDown, top to bottom: places it stopped short of the bottom',
    shown: () => 'none',
    limit: () => 0,
    unit: 'count',
    read: (run) => run.stuck.length,
  },
  keyBar('heldJ', 'Held `j`, key to paint, p95', 16, 95),
  keyBar('nextFile', '`]f`, key to paint, slowest', 50, 100),
  keyBar('nextChange', '`]c`, key to paint, slowest', 50, 100),
  keyBar('end', '`G`, key to paint, slowest', 50, 100),
  {
    id: 'alignment',
    label: 'Alignment, worst frame, every step',
    shown: () => 'within 0.5 px',
    limit: () => 0.5,
    unit: 'px',
    read: (run) => run.alignment.worst,
  },
  {
    id: 'memory',
    label: 'Renderer memory (footprint), at its largest',
    shown: (pull) => (kubernetes(pull) ? '≤ 600 MB' : '≤ 1.2 GB'),
    limit: (pull) => (kubernetes(pull) ? 600 : 1200),
    unit: 'MB',
    read: (run) => run.memory.peak.footprint,
  },
  {
    id: 'heapGrowth',
    label: 'Heap growth on a second full scroll',
    shown: () => 'under 10%',
    limit: () => 10,
    strict: true,
    unit: '%',
    read: (run) => run.memory.growth,
  },
];

/** `zR` on TypeScript#54820's `checker.ts`. */
export const zRBar = { label: '`zR` on `checker.ts`, key to paint', shown: '≤ 150 ms', limit: 150 };

/** The bars on a stretch's frames, which `stretch` reads, or undefined where it can't be read. */
function frameBars(
  id: string,
  label: string,
  stretch: (run: RunResult) => Stretch | undefined,
): Bar[] {
  return [
    {
      id: `${id}P95`,
      label: `${label}: p95 frame`,
      shown: () => '≤ 16.7 ms',
      limit: () => oneRefresh,
      unit: 'ms',
      read: (run) => stretch(run)?.frames.p95,
    },
    {
      id: `${id}P99`,
      label: `${label}: p99 frame`,
      shown: () => '≤ 33 ms',
      limit: () => twoRefreshes,
      unit: 'ms',
      read: (run) => stretch(run)?.frames.p99,
    },
    {
      id: `${id}Max`,
      label: `${label}: longest frame`,
      shown: () => 'none over 100 ms',
      limit: () => 100.01,
      unit: 'ms',
      read: (run) => stretch(run)?.frames.max,
    },
    {
      id: `${id}Blank`,
      label: `${label}: frames with blank rows`,
      shown: () => 'none',
      limit: () => 0,
      unit: 'count',
      read: (run) => stretch(run)?.blank.frames,
    },
  ];
}

/** A key's bar: its reading at the `p`th percentile, and that less the run's floor. */
function keyBar(
  id: 'heldJ' | 'nextFile' | 'nextChange' | 'end',
  label: string,
  limit: number,
  p: number,
): Bar {
  return {
    id,
    label,
    shown: () => `≤ ${limit} ms`,
    limit: () => limit,
    unit: 'ms',
    read: (run) => keyReading(run.keys[id], p),
    aboveFloor: (run) => aboveFloor(keyReading(run.keys[id], p), run.keys.floor),
  };
}

/**
 * A key's reading less the floor: the minimal-paint key's time at the median. A reading under the
 * Event Timing threshold is under the floor too, so nothing above it.
 */
export function aboveFloor(reading: Reading, floor: KeyTimes | undefined): Reading {
  if (reading === undefined || !floor) return undefined;
  if (typeof reading !== 'number') return 0;
  const base = keyReading(floor, 50);
  return Math.max(0, reading - (typeof base === 'number' ? base : 0));
}

/** A key's time at the `p`th percentile, or under the threshold when that's where it falls. */
export function keyReading(times: KeyTimes | undefined, p: number): Reading {
  if (!times || times.keys === 0) return undefined;
  const value = p >= 100 ? (max(times.reported) ?? -1) : (keyPercentile(times, p) ?? -1);
  return value < 0 ? { under: times.under } : value;
}

/** Where a reading sorts: one under a threshold just below it. */
function rank(reading: Exclude<Reading, undefined>): number {
  return typeof reading === 'number' ? reading : reading.under - 1e-6;
}

/** The median of the runs' readings, the worst, and whether every run met the bar. */
export interface Judged {
  median: Reading;
  worst: Reading;
  pass: boolean | undefined;
  /** How many runs it was read in. */
  runs: number;
}

export function judge(readings: readonly Reading[], limit: number, strict = false): Judged {
  const read = readings.filter((reading) => reading !== undefined);
  if (read.length === 0) return { median: undefined, worst: undefined, pass: undefined, runs: 0 };
  const sorted = read.toSorted((a, b) => rank(a) - rank(b));
  const middle = median(sorted.map((_, index) => index)) ?? 0;
  // With an even count, the median of two readings that are both under the threshold stays so.
  const low = sorted[Math.floor(middle)]!;
  const high = sorted[Math.ceil(middle)]!;
  const medianReading =
    typeof low === 'number' && typeof high === 'number' ? (low + high) / 2 : high;
  const worst = sorted.at(-1)!;
  return {
    median: medianReading,
    worst,
    pass:
      read.length === readings.length &&
      read.every((reading) => (strict ? rank(reading) < limit : rank(reading) <= limit)),
    runs: read.length,
  };
}
