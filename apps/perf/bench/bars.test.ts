import { describe, expect, test } from 'vitest';

import { aboveFloor, bars, blankShare, judge, keyReading } from './bars.ts';
import type { Stretch } from './results.ts';
import { type KeyTimes, summarizeFrames } from './stats.ts';

describe('judge', () => {
  test('passes a bar only when every run met it, with the median and the worst run', () => {
    expect(judge([380, 420, 390], 400)).toEqual({ median: 390, worst: 420, pass: false, runs: 3 });
    expect(judge([380, 400, 390], 400)).toEqual({ median: 390, worst: 400, pass: true, runs: 3 });
  });

  test('fails a strict bar at its limit', () => {
    expect(judge([9.9, 10], 10, true).pass).toBe(false);
    expect(judge([9.9, 9.99], 10, true).pass).toBe(true);
  });

  test('ranks a key under the Event Timing threshold below every reported time', () => {
    const result = judge([{ under: 16 }, 24, { under: 16 }], 16);
    expect(result.median).toEqual({ under: 16 });
    expect(result.worst).toBe(24);
    expect(result.pass).toBe(false);
    expect(judge([{ under: 16 }, 16], 16).pass).toBe(true);
  });

  test('passes nothing a run didn’t measure', () => {
    expect(judge([undefined, undefined], 50)).toEqual({
      median: undefined,
      worst: undefined,
      pass: undefined,
      runs: 0,
    });
    expect(judge([40, undefined], 50).pass).toBe(false);
  });
});

describe('keyReading', () => {
  test('is the slowest key, or the percentile, or under the threshold', () => {
    const ten = { keys: 10, reported: [56, 24], under: 16, parts: [], longFrames: [] };
    expect(keyReading(ten, 100)).toBe(56);
    expect(keyReading(ten, 95)).toBe(56);
    expect(keyReading(ten, 50)).toEqual({ under: 16 });
    expect(
      keyReading({ keys: 3, reported: [], under: 16, parts: [], longFrames: [] }, 100),
    ).toEqual({ under: 16 });
    expect(
      keyReading({ keys: 0, reported: [], under: 16, parts: [], longFrames: [] }, 100),
    ).toBeUndefined();
  });
});

function limit(id: string, pull = 'kubernetes-125488'): number {
  return bars.find((bar) => bar.id === id)!.limit(pull);
}

/** Keys the Event Timing API reported, with these times. */
function times(...reported: number[]): KeyTimes {
  return { keys: reported.length, reported, under: 16, parts: [], longFrames: [] };
}

describe('aboveFloor', () => {
  const floor = times(24, 32, 32, 40);

  test('takes off the floor at the same statistic: p95 from p95, the slowest from the slowest', () => {
    expect(aboveFloor(times(32, 40, 40, 48), floor, 95)).toBe(8);
    expect(aboveFloor(times(32, 40, 40, 48), floor, 50)).toBe(8);
    expect(aboveFloor(times(32, 40, 40, 72), floor, 100)).toBe(32);
    // Held keys as slow as the floor at p95 are nothing above it.
    expect(aboveFloor(times(24, 32, 32, 40), floor, 95)).toBe(0);
  });

  test('is nothing for keys under the threshold, and undefined for keys not pressed', () => {
    expect(aboveFloor({ ...times(), keys: 3 }, floor, 95)).toBe(0);
    expect(aboveFloor(undefined, floor, 95)).toBeUndefined();
  });
});

describe('blankShare', () => {
  test('is the share of frames with blank rows, in %', () => {
    const frames = summarizeFrames(Array.from({ length: 200 }, () => 1000 / 60));
    const stretch: Stretch = {
      frames,
      raw: frames,
      blank: { frames: 50, oneSided: 0, undrawn: 0, past: 50, worstPx: 130 },
      worst: 0,
      misaligned: 0,
      scrolled: 40_000,
      ms: 5000,
      inputs: 2,
      readMs: undefined,
      longFrames: [],
    };
    expect(blankShare(stretch)).toBe(25);
    expect(blankShare(undefined)).toBeUndefined();
  });
});

describe('bars', () => {
  test('hold each bar from the research, with the pull requests’ own limits', () => {
    expect(limit('open')).toBe(400);
    expect(limit('computed')).toBe(2000);
    expect(limit('computed', 'typescript-51387')).toBe(5000);
    expect(limit('memory')).toBe(600);
    expect(limit('memory', 'typescript-51387')).toBe(1200);
    expect(limit('heldJ')).toBe(16);
    expect(limit('nextFile')).toBe(50);
    expect(limit('alignment')).toBe(0.5);
    expect(limit('scrollBlank')).toBe(0);
    expect(limit('blank3000')).toBe(0);
    expect(limit('blank8000')).toBe(0);
    expect(limit('blank15000')).toBe(0);
    expect(limit('flingBlank')).toBe(0);
    expect(limit('pageDownMax')).toBeCloseTo(100, 1);
  });
});
