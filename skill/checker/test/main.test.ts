/** The command line's own failures: whatever goes wrong exits 2, never 1, which means errors. */

import { expect, test } from 'vitest';

import { main } from '../src/main.ts';

test('a failure of the checker’s own exits 2, saying so, never 1', async () => {
  const said: string[] = [];
  const status = await main(['--help'], {
    out: () => {
      throw new Error('The pipe closed.');
    },
    err: (text) => said.push(text),
  });
  expect(status).toBe(2);
  expect(said).toEqual([
    "Lo couldn't check the overview, for a reason it can't name: The pipe closed.\n",
  ]);
});
