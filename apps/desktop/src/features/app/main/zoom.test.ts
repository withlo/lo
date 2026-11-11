import { expect, it } from 'vitest';

import { zoomed } from './zoom.ts';

it('zooms a step in or out, or back to actual size', () => {
  expect(zoomed(0, 'in')).toBe(0.5);
  expect(zoomed(0.5, 'out')).toBe(0);
  expect(zoomed(0, 'out')).toBe(-0.5);
  expect(zoomed(1.5, 'reset')).toBe(0);
});
