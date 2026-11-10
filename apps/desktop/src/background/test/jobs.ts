// Made-up jobs for the tests, run on real worker threads.

import { z } from 'zod';

import { IpcError, reply } from '../../ipc/contract.ts';
import { defineJobs } from '../../ipc/jobs.ts';
import { defineRunner } from '../runners.ts';

export const sample = defineJobs('sample', {
  double: { input: z.number(), reply: reply<number>() },
  spin: { input: z.undefined(), reply: reply<never>() },
  fill: { input: z.undefined(), reply: reply<never>() },
  refuse: { input: z.undefined(), reply: reply<never>() },
  crash: { input: z.undefined(), reply: reply<never>() },
});

export default defineRunner(sample, {
  double: { run: (input) => input * 2 },
  spin: {
    run() {
      for (;;) {
        // Never ends.
      }
    },
    limits: { deadline: 200 },
  },
  fill: {
    run() {
      const held: unknown[] = [];
      for (;;) held.push(Array.from({ length: 10_000 }, (_, index) => ({ index })));
    },
    limits: { memory: 16 },
  },
  refuse: {
    run() {
      throw new IpcError('refused', 'Not that one.');
    },
  },
  crash: {
    run() {
      throw new Error('The secret token is hunter2.');
    },
  },
});
