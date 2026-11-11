// The background process: it diffs and highlights each file on worker threads, sends each result
// to the window as it's ready, then finds the code the pull request moves.

import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

import { findMoves, type FileChanges } from '@lo/diff';
import type { MessagePortMain } from 'electron';

import type { Done, Job, Result, Work } from '../shared/protocol.ts';

/** Two to four workers, leaving the machine room for the window. */
const workerCount = Math.max(2, Math.min(4, Math.floor(availableParallelism() / 2)));

process.parentPort.once('message', (event) => {
  // Main builds the work from the same protocol; it isn't validated here.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const work = event.data as Work;
  const [port] = event.ports;
  if (!port) throw new Error('The background process got no port to the window.');
  run(work, port).catch((error: unknown) => {
    console.error('The background process failed:', error);
    process.exit(1);
  });
});

async function run(work: Work, port: MessagePortMain): Promise<void> {
  const started = performance.now();
  const send = (result: Result): void => port.postMessage(result);
  const changes: FileChanges[] = Array.from({ length: work.files }, () => ({
    path: '',
    deleted: [],
    added: [],
  }));
  // Files in order, so the first one on screen is diffed first.
  const queue = [...work.jobs];
  const start = (): Worker =>
    new Worker(work.workerEntry, { workerData: { syntaxFolder: work.syntaxFolder } });
  const workers = Array.from({ length: Math.min(workerCount, queue.length) }, start);
  await Promise.all(
    workers.map(async (first) => {
      let worker = first;
      for (let job = queue.shift(); job; job = queue.shift()) {
        const done = await ask(worker, job);
        if (done.replace) {
          await worker.terminate();
          worker = start();
        }
        changes[done.index] = done.changes;
        send({
          type: 'file',
          index: done.index,
          diff: done.diff,
          tokens: done.tokens,
          diffMs: done.diffMs,
          highlightMs: done.highlightMs,
        });
      }
      await worker.terminate();
    }),
  );
  const movesStarted = performance.now();
  const moves = findMoves(changes);
  send({ type: 'moves', moves, ms: performance.now() - movesStarted });
  send({ type: 'done', ms: performance.now() - started });
}

/** Has `worker` diff and highlight one file. */
function ask(worker: Worker, job: Job): Promise<Done> {
  return new Promise((resolve, reject) => {
    const onError = (error: unknown): void => {
      worker.off('message', onMessage);
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onMessage = (done: Done): void => {
      worker.off('error', onError);
      resolve(done);
    };
    worker.once('message', onMessage);
    worker.once('error', onError);
    // A worker thread, not a window: it has no origin to name.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    worker.postMessage(job);
  });
}
