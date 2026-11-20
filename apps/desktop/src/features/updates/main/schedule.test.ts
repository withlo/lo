import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHECK_EVERY, FIRST_CHECK, Schedule } from './schedule.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let checks: number[];
let schedule: Schedule;

beforeEach(() => {
  vi.useFakeTimers({ now: 1_800_000_000_000 });
  checks = [];
  schedule = new Schedule(() => checks.push(Date.now()), FIRST_CHECK);
});

afterEach(() => {
  schedule.stop();
  vi.useRealTimers();
});

/** How many checks Lo made by itself `ms` from now. */
function after(ms: number): number {
  vi.advanceTimersByTime(ms);
  return checks.length;
}

describe('with updates.check on', () => {
  beforeEach(() => schedule.timed(true));

  it('checks 30 s after the window is up, then every 6 hours', () => {
    expect(after(HOUR)).toBe(0);
    schedule.up();
    expect(after(FIRST_CHECK - 1)).toBe(0);
    expect(after(1)).toBe(1);
    expect(after(CHECK_EVERY - 1)).toBe(1);
    expect(after(1)).toBe(2);
    expect(after(CHECK_EVERY)).toBe(3);
  });

  it('counts the window up once', () => {
    schedule.up();
    vi.advanceTimersByTime(20_000);
    schedule.up();
    expect(after(10_000)).toBe(1);
  });

  it('puts the next check 6 hours after one asked for', () => {
    schedule.up();
    expect(after(FIRST_CHECK)).toBe(1);
    vi.advanceTimersByTime(2 * HOUR);
    schedule.checked();
    expect(after(CHECK_EVERY - 1)).toBe(1);
    expect(after(1)).toBe(2);
  });

  it('checks soon after a computer that slept through a check wakes', () => {
    schedule.up();
    expect(after(FIRST_CHECK)).toBe(1);
    // Asleep: the clock goes on, and timers don't.
    vi.setSystemTime(Date.now() + 10 * HOUR);
    expect(after(5 * MINUTE)).toBe(2);
  });

  it('stops for good as Lo quits', () => {
    schedule.up();
    schedule.stop();
    schedule.timed(true);
    expect(after(CHECK_EVERY * 2)).toBe(0);
  });
});

describe('with updates.check off', () => {
  it('never checks by itself', () => {
    schedule.timed(false);
    schedule.up();
    expect(after(CHECK_EVERY * 3)).toBe(0);
  });

  it('stops checking by itself once it’s turned off, and starts again once it’s on', () => {
    schedule.timed(true);
    schedule.up();
    expect(after(FIRST_CHECK)).toBe(1);
    schedule.timed(false);
    expect(after(CHECK_EVERY * 2)).toBe(1);
    // Over 6 hours since the last, so one is due now.
    schedule.timed(true);
    expect(checks.length).toBe(2);
    expect(after(CHECK_EVERY)).toBe(3);
  });
});

it('checks nothing before the settings file has been read', () => {
  schedule.up();
  expect(after(CHECK_EVERY)).toBe(0);
  schedule.timed(true);
  expect(checks.length).toBe(1);
});
