// A made-up feature for the tests: everything it needs is in its own folder.

import { z } from 'zod';

import { defineContract, reply } from '../../../../ipc/contract.ts';

export const contract = defineContract('notes', {
  requests: {
    add: { input: z.strictObject({ text: z.string().min(1) }), reply: reply<{ id: number }>() },
    remove: { input: z.strictObject({ id: z.number().int() }), reply: reply<null>() },
    count: { input: z.undefined(), reply: reply<number>() },
    crash: { input: z.undefined(), reply: reply<null>() },
  },
  topics: {
    changed: z.number().int().nonnegative(),
  },
});
