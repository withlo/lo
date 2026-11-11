import { describe, expect, test } from 'vitest';

import {
  frameTimes,
  inRefreshes,
  keyPercentile,
  median,
  percentile,
  summarizeFrames,
} from './stats.ts';

describe('percentile', () => {
  test('is the smallest value at least that share of the values are at or under', () => {
    const values = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 95)).toBe(10);
    expect(percentile(values, 90)).toBe(9);
    expect(percentile(values, 0)).toBe(1);
  });

  test('is undefined for no values', () => {
    expect(percentile([], 95)).toBeUndefined();
  });
});

describe('median', () => {
  test('is the middle value, or the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('frame times', () => {
  test('are the time between each frame and the one before', () => {
    expect(frameTimes([0, 16.7, 33.3, 66.7])).toEqual([
      expect.closeTo(16.7),
      expect.closeTo(16.6),
      expect.closeTo(33.4),
    ]);
  });

  test('count a frame that came a little early or late as one refresh, and one that missed as two', () => {
    const refresh = 1000 / 60;
    expect(inRefreshes([15, 18.3, 16.7, 33.6, 49, 9], refresh)).toEqual([
      refresh,
      refresh,
      refresh,
      2 * refresh,
      3 * refresh,
      refresh,
    ]);
  });

  test('are summarized with the frames over one refresh, two, and 100 ms', () => {
    const refresh = 1000 / 60;
    const times = inRefreshes(
      [...Array.from({ length: 96 }, () => 16.7), 33.4, 33.2, 50, 117],
      refresh,
    );
    const summary = summarizeFrames(times);
    expect(summary.frames).toBe(100);
    expect(summary.p95).toBeCloseTo(refresh);
    expect(summary.p99).toBeCloseTo(3 * refresh);
    expect(summary.max).toBeCloseTo(7 * refresh);
    expect([summary.over16, summary.over33, summary.over100]).toEqual([4, 2, 1]);
  });
});

describe('keyPercentile', () => {
  test('counts the keys the Event Timing API didn’t report as under its threshold', () => {
    const times = { keys: 20, reported: [24, 40], under: 16, parts: [], longFrames: [] };
    // 18 of 20 keys are under 16 ms: the 90th percentile is under it, the 95th isn't.
    expect(keyPercentile(times, 90)).toBeUndefined();
    expect(keyPercentile(times, 95)).toBe(24);
    expect(keyPercentile(times, 100)).toBe(40);
  });

  test('is undefined when no key was pressed', () => {
    expect(
      keyPercentile({ keys: 0, reported: [], under: 16, parts: [], longFrames: [] }, 95),
    ).toBeUndefined();
  });
});
