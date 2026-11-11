// Renderings that make the HTML parser build far more than the text holds, read within a background
// job's heap cap and in bounded time.

import { Worker } from 'node:worker_threads';

import { expect, test } from 'vitest';

import type { Tree } from '../src/index.ts';
import { problems } from './walker.ts';

/** A background job's heap cap, unless the job sets its own. */
const HEAP_MEGABYTES = 256;

/**
 * The longest a reading may take, in milliseconds. These take some 20 ms on a laptop; a parse
 * that builds what it copies takes seconds, and runs out of the heap first.
 */
const LIMIT = 2_500;

/** How reading `html` went, in a thread with a background job's heap. */
function readInJobHeap(html: string): Promise<{ elapsed: number; tree: Tree }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./bounded.worker.ts', import.meta.url), {
      workerData: html,
      resourceLimits: { maxOldGenerationSizeMb: HEAP_MEGABYTES, maxYoungGenerationSizeMb: 16 },
    });
    worker.once('message', (value: { elapsed: number; tree: Tree }) => {
      resolve(value);
      void worker.terminate();
    });
    worker.once('error', reject);
  });
}

/**
 * Sixty formatting elements with long, distinct attributes, closed by a paragraph, then `runs`
 * paragraphs: the parser makes all sixty again in each, every copy with the original's attributes,
 * so the text's attributes are read some hundred thousand times over. `length` is the text's.
 */
function copiedAttributes(length: number, runs: number): string {
  const tokens = Math.floor((length - 4 * runs) / 60 / 2);
  let html = '<p>';
  for (let i = 0; i < 60; i++) html += `<b id=${i} class="${'c '.repeat(tokens)}">`;
  return html + '<p>x'.repeat(runs);
}

test.each([
  ['118 KB', 118_000],
  ['969 KB', 969_000],
])('formatting copied with %s of attributes reads within the heap cap', async (_size, length) => {
  const html = copiedAttributes(length, 2_100);
  expect(html.length).toBeLessThan(1_048_576);
  const { elapsed, tree } = await readInJobHeap(html);
  expect(problems(tree)).toEqual([]);
  expect(elapsed, `took ${elapsed} ms`).toBeLessThan(LIMIT);
});
