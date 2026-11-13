import { afterEach, describe, expect, it } from 'vitest';

import { HOLD_LIMIT } from '../contract.ts';
import { holdLimit, takeHoldLimit } from './hold.ts';

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
