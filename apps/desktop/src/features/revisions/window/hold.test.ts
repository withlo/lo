import { afterEach, describe, expect, it, vi } from 'vitest';

import { HOLD_LIMIT } from '../contract.ts';
import { afterHold, holdLimit, takeHoldLimit } from './hold.ts';

describe('holdLimit', () => {
  afterEach(() => takeHoldLimit(undefined));

  it('is the bound a tab holds back what it shows first, unless a test asked for another', () => {
    expect(holdLimit()).toBe(HOLD_LIMIT);
  });

  it('is the bound main said a test asked for', () => {
    takeHoldLimit(60_000);
    expect(holdLimit()).toBe(60_000);
  });

  it('goes back to the bound when main says none was asked for', () => {
    takeHoldLimit(60_000);
    takeHoldLimit(undefined);
    expect(holdLimit()).toBe(HOLD_LIMIT);
  });
});

describe('afterHold', () => {
  afterEach(() => {
    takeHoldLimit(undefined);
    vi.useRealTimers();
  });

  it('runs once the bound has passed since the tab started waiting', () => {
    vi.useFakeTimers({ now: 10_000 });
    const run = vi.fn<() => void>();
    afterHold(9_600, run);
    vi.advanceTimersByTime(HOLD_LIMIT - 400 - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HOLD_LIMIT);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs at once for a tab that has waited past the bound already', () => {
    vi.useFakeTimers({ now: 10_000 });
    const run = vi.fn<() => void>();
    afterHold(0, run);
    vi.advanceTimersByTime(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits for the bound a test asked for after the wait began', () => {
    vi.useFakeTimers({ now: 0 });
    const run = vi.fn<() => void>();
    afterHold(0, run);
    // Main says, some way into the wait, that this run holds tabs back for longer.
    vi.advanceTimersByTime(100);
    takeHoldLimit(5_000);
    vi.advanceTimersByTime(HOLD_LIMIT);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000 - HOLD_LIMIT - 100 - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('is cancelled by the function it returns', () => {
    vi.useFakeTimers({ now: 0 });
    const run = vi.fn<() => void>();
    const cancel = afterHold(0, run);
    cancel();
    vi.advanceTimersByTime(HOLD_LIMIT * 2);
    expect(run).not.toHaveBeenCalled();
  });
});
