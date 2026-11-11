import { describe, expect, test } from 'vitest';

import { aboveFloor, bars, judge, keyReading } from './bars.ts';

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
    const times = { keys: 10, reported: [56, 24], under: 16, parts: [], longFrames: [] };
    expect(keyReading(times, 100)).toBe(56);
    expect(keyReading(times, 95)).toBe(56);
    expect(keyReading(times, 50)).toEqual({ under: 16 });
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

describe('aboveFloor', () => {
  test('takes the floor’s median off a key’s time, and nothing off a key under the threshold', () => {
    const floor = { keys: 4, reported: [32, 32, 40, 24], under: 16, parts: [], longFrames: [] };
    expect(aboveFloor(56, floor)).toBe(24);
    expect(aboveFloor(24, floor)).toBe(0);
    expect(aboveFloor({ under: 16 }, floor)).toBe(0);
    expect(aboveFloor(undefined, floor)).toBeUndefined();
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
    expect(limit('blank15000')).toBe(0);
    expect(limit('pageDownMax')).toBeCloseTo(100, 1);
  });
});
