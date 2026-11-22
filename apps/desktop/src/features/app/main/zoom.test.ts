import { expect, it } from 'vitest';

import { zoomed } from './zoom.ts';

it('zooms a step in or out, or back to actual size', () => {
  expect(zoomed(100, 'in')).toBe(110);
  expect(zoomed(110, 'out')).toBe(100);
  expect(zoomed(100, 'out')).toBe(90);
  expect(zoomed(150, 'reset')).toBe(100);
});

it('steps from a percent between two steps to the next one either way', () => {
  expect(zoomed(105, 'in')).toBe(110);
  expect(zoomed(105, 'out')).toBe(100);
});

it('stops at either end', () => {
  expect(zoomed(200, 'in')).toBe(200);
  expect(zoomed(50, 'out')).toBe(50);
});
