// The bars the diff view must meet, each with what it reads from a run, and how the runs are judged:
// the median and the worst of them, and a pass only when every run met the bar.

import type { RunResult } from './results.ts';
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
  unit: 'ms' | 'px' | 'MB' | '%' | 'frames';
  read: (run: RunResult) => Reading;
}

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
    label: 'Longest main-thread task while computing',
    shown: () => 'none over 50 ms',
    limit: () => 50,
    unit: 'ms',
    read: (run) => run.open.longestTask,
  },
  ...scrollBars('fling', 'Flings, top to bottom'),
  ...scrollBars('pageDown', 'PageDown, top to bottom'),
  {
    id: 'heldJ',
    label: 'Held `j`, key to paint, p95',
    shown: () => '≤ 16 ms',
    limit: () => 16,
    unit: 'ms',
    read: (run) => keyReading(run.keys.heldJ, 95),
  },
  {
    id: 'nextFile',
    label: '`]f`, key to paint, slowest',
    shown: () => '≤ 50 ms',
    limit: () => 50,
    unit: 'ms',
    read: (run) => keyReading(run.keys.nextFile, 100),
  },
  {
    id: 'nextChange',
    label: '`]c`, key to paint, slowest',
    shown: () => '≤ 50 ms',
    limit: () => 50,
    unit: 'ms',
    read: (run) => keyReading(run.keys.nextChange, 100),
  },
  {
    id: 'end',
    label: '`G`, key to paint, slowest',
    shown: () => '≤ 50 ms',
    limit: () => 50,
    unit: 'ms',
    read: (run) => keyReading(run.keys.end, 100),
  },
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
    label: 'Renderer memory, at its largest',
    shown: (pull) => (kubernetes(pull) ? '≤ 600 MB' : '≤ 1.2 GB'),
    limit: (pull) => (kubernetes(pull) ? 600 : 1200),
    unit: 'MB',
    read: (run) => run.memory.peak,
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

function scrollBars(id: 'fling' | 'pageDown', label: string): Bar[] {
  return [
    {
      id: `${id}P95`,
      label: `${label}: p95 frame`,
      shown: () => '≤ 16.7 ms',
      limit: () => oneRefresh,
      unit: 'ms',
      read: (run) => run[id].frames.p95,
    },
    {
      id: `${id}P99`,
      label: `${label}: p99 frame`,
      shown: () => '≤ 33 ms',
      limit: () => twoRefreshes,
      unit: 'ms',
      read: (run) => run[id].frames.p99,
    },
    {
      id: `${id}Max`,
      label: `${label}: longest frame`,
      shown: () => 'none over 100 ms',
      limit: () => 100.01,
      unit: 'ms',
      read: (run) => run[id].frames.max,
    },
    {
      id: `${id}Blank`,
      label: `${label}: frames with blank rows`,
      shown: () => 'none',
      limit: () => 0,
      unit: 'frames',
      read: (run) => run[id].blank.frames,
    },
  ];
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
