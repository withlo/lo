import { describe, expect, it } from 'vitest';

import { wholeNumber } from './format.ts';

describe('wholeNumber', () => {
  it('reads digits, with white space round them', () => {
    expect(wholeNumber('20')).toBe(20);
    expect(wholeNumber('  7 ')).toBe(7);
    expect(wholeNumber('007')).toBe(7);
    expect(wholeNumber('0')).toBe(0);
  });

  it('reads nothing else as a number of GB', () => {
    for (const text of [
      '',
      ' ',
      '2.5',
      '-4',
      '+4',
      '1e3',
      '0x10',
      'ten',
      '1 0',
      '1,000',
      '1234567890',
    ]) {
      expect(wholeNumber(text)).toBeUndefined();
    }
  });
});
