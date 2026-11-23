import { expect, it } from 'vitest';

import { contract } from './contract.ts';

it('takes an answer as a question’s id and whether the reader pressed its action, and nothing else', () => {
  const { input } = contract.requests.answer;
  const id = crypto.randomUUID();
  expect(input.safeParse({ id, act: true }).success).toBe(true);
  expect(input.safeParse({ id, act: false }).success).toBe(true);
  for (const given of [
    { id },
    { id, act: 'true' },
    { id, act: 0 },
    { id, act: true, button: 0 },
    { id: 'x'.repeat(37), act: true },
    { act: true },
    null,
  ]) {
    expect(input.safeParse(given).success).toBe(false);
  }
});
