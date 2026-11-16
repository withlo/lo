import { describe, expect, it } from 'vitest';

import { formatBytes } from './bytes.ts';

describe('formatBytes', () => {
  it('writes a size in the units the cache counts in', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(38 * 1024)).toBe('38 KB');
    expect(formatBytes(1024 ** 2)).toBe('1 MB');
    expect(formatBytes(12.34 * 1024 ** 2)).toBe('12.3 MB');
    expect(formatBytes(6.2 * 1024 ** 3)).toBe('6.2 GB');
    expect(formatBytes(10 * 1024 ** 3)).toBe('10 GB');
    expect(formatBytes(1.5 * 1024 ** 4)).toBe('1.5 TB');
    // Past the last unit, it stays in it.
    expect(formatBytes(2048 * 1024 ** 4)).toBe('2048 TB');
  });

  it('writes a size that rounds up to the next unit in the unit it reached', () => {
    expect(formatBytes(1024 ** 3 - 1)).toBe('1024 MB');
  });

  it('writes a size below nothing as nothing', () => {
    expect(formatBytes(-5)).toBe('0 B');
  });
});
