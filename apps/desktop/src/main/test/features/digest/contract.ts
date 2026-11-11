// A made-up feature for the tests, which reads the notes feature's service.

import { z } from 'zod';

import { defineContract, reply } from '../../../../ipc/contract.ts';

export const contract = defineContract('digest', {
  requests: {
    read: { input: z.undefined(), reply: reply<{ notes: number }>() },
  },
  topics: {
    started: z.strictObject({ notes: z.number().int().nonnegative() }),
  },
});
