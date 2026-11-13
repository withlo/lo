import { describe, expect, it } from 'vitest';

import { stepAmong } from './panels.ts';

describe('stepping through the middle views', () => {
  // The overview, the diff, a file whole, which has no label, and a fourth view.
  const labeled = [true, true, false, true];

  it('goes to the next or previous view the switch lists, round the ends', () => {
    expect(stepAmong(0, 1, labeled)).toBe(1);
    expect(stepAmong(1, 1, labeled)).toBe(3);
    expect(stepAmong(3, 1, labeled)).toBe(0);
    expect(stepAmong(0, -1, labeled)).toBe(3);
    expect(stepAmong(3, -1, labeled)).toBe(1);
  });

  it('goes from a view with no label to the next or previous one with', () => {
    expect(stepAmong(2, 1, labeled)).toBe(3);
    expect(stepAmong(2, -1, labeled)).toBe(1);
  });

  it('stays where it is with no other view to go to', () => {
    expect(stepAmong(0, 1, [true, false])).toBe(0);
    expect(stepAmong(0, -1, [])).toBe(0);
  });
});
