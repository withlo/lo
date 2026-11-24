import { describe, expect, it } from 'vitest';

import { when } from './words.ts';

const NOW = Date.parse('2026-11-22T12:00:00Z');

describe('when', () => {
  it('says how long ago an ISO time was, and nothing for a time that doesn’t read as one', () => {
    expect(when('2026-11-22T11:00:00Z', NOW)).toBe('1 h ago');
    expect(when('not a time', NOW)).toBe('');
  });
});
