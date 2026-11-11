// What a repository's author can make git print, read without running main out of memory.

import { Worker } from 'node:worker_threads';

import { expect, test } from 'vitest';

import { MAX_ENTRIES } from '../src/tree.ts';

/** How reading a made-up diff of `files` files went, in a thread with a heap of `megabytes`. */
function readInSmallHeap(files: number, megabytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), {
      workerData: files,
      resourceLimits: { maxOldGenerationSizeMb: megabytes, maxYoungGenerationSizeMb: 16 },
    });
    worker.once('message', resolve);
    worker.once('error', reject);
  });
}

test('a diff of more files than Lo reads is refused before any is read', async () => {
  // 600,000 files: each would be several objects, more than the heap holds, so each must be
  // counted before any is made.
  const outcome = await readInSmallHeap(MAX_ENTRIES + 100_000, 48);

  const refused = { kind: 'tooLarge', limit: MAX_ENTRIES, unit: 'entries' };
  expect(outcome).toMatchObject([refused, refused]);
});
