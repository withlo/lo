// Jobs for the smoke test only: one that runs as long as it's told, one that takes memory, and one
// that lists the process's environment.
// The process offers them only when main asks, which it does only in a build run from source
// with LO_TEST_JOBS=1.

import { z } from 'zod';

import { reply } from '../ipc/contract.ts';
import { defineJobs } from '../ipc/jobs.ts';
import { defineRunner } from './runners.ts';

export const testJobs = defineJobs('test', {
  /** The names of the variables in the process's environment. */
  environment: { input: z.undefined(), reply: reply<string[]>() },
  /** Keeps the thread busy for `ms`, as a runaway job would. */
  spin: {
    input: z.strictObject({ ms: z.number().int().min(0).max(60_000) }),
    reply: reply<number>(),
  },
  /**
   * Takes `mb` of memory, on the JavaScript heap or outside it (as WebAssembly does), and holds it
   * for `holdMs`.
   */
  allocate: {
    input: z.strictObject({
      mb: z.number().int().min(1).max(4096),
      where: z.enum(['heap', 'outside']),
      holdMs: z.number().int().min(0).max(60_000),
    }),
    reply: reply<number>(),
  },
});

export default defineRunner(testJobs, {
  environment: { run: () => Object.keys(process.env).toSorted() },
  spin: {
    run({ ms }) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        // Busy, on purpose.
      }
      return ms;
    },
    limits: { deadline: 1000 },
  },
  allocate: {
    run({ mb, where, holdMs }) {
      const held: unknown[] = [];
      if (where === 'heap') {
        // About 1 MB of small objects at a time, so it's the heap that fills.
        for (let filled = 0; filled < mb; filled += 1) {
          held.push(Array.from({ length: 16_384 }, (_, index) => ({ index })));
        }
      } else {
        // Written to, so the system really hands the pages over.
        held.push(Buffer.alloc(mb * 1024 * 1024, 1));
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs);
      return held.length;
    },
    limits: { deadline: 30_000, memory: 64 },
  },
});
