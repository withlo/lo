import { expect, test } from 'vitest';

import { savedWhen } from './time.ts';

test('when something was saved says today or yesterday, and else the date', () => {
  const now = new Date(2026, 10, 13, 12, 0).getTime();
  expect(savedWhen(new Date(2026, 10, 12, 18, 40).getTime(), now)).toMatch(/^yesterday, /);
  expect(savedWhen(new Date(2026, 10, 13, 9, 12).getTime(), now)).toMatch(/^today, /);
  expect(savedWhen(new Date(2026, 10, 1, 9, 12).getTime(), now)).not.toMatch(/day/);
});
