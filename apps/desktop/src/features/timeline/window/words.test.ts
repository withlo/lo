import { describe, expect, it } from 'vitest';

import { ago, when } from './words.ts';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('ago', () => {
  it('says how long ago in the largest whole unit, and the date past 30 days', () => {
    expect(ago(NOW - 20_000, NOW)).toBe('just now');
    expect(ago(NOW - 12 * MINUTE, NOW)).toBe('12 min ago');
    expect(ago(NOW - 2 * HOUR - 5 * MINUTE, NOW)).toBe('2 h ago');
    expect(ago(NOW - 3 * DAY, NOW)).toBe('3 d ago');
    expect(ago(Date.parse('2026-11-12T12:00:00Z') - 30 * DAY, NOW)).toBe('Oct 13');
    expect(ago(Date.parse('2025-11-12T12:00:00Z'), NOW)).toBe('Nov 12, 2025');
  });

  it('says nothing for a time that doesn’t read as one', () => {
    expect(when('not a time', NOW)).toBe('');
    expect(when('2026-11-22T11:00:00Z', NOW)).toBe('1 h ago');
  });
});
