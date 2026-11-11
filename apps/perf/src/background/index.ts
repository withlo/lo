// The background process: it diffs and highlights each file on worker threads, sends each result
// to the window as it's ready, then finds the code the pull request moves. A large file the window
// loads later comes as its own job, diffed and highlighted on a worker of its own.

import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

import { findMoves, type FileChanges } from '@lo/diff';
import type { MessagePortMain } from 'electron';

import type { Done, Job, LaterJob, Result, Work } from '../shared/protocol.ts';

/** Two to four workers, leaving the machine room for the window. */
const workerCount = Math.max(2, Math.min(4, Math.floor(availableParallelism() / 2)));

/** The work and the port to the window, once main has sent them. */
let given: { work: Work; port: MessagePortMain } | undefined;
/** Jobs that came later, one at a time. */
let later = Promise.resolve();

process.parentPort.on('message', (event) => {
  // Main builds both messages from the same protocol; they aren't validated here.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const message = event.data as Work | LaterJob;
  if ('type' in message) {
    if (!given) throw new Error('A job came before the work.');
    const { work, port } = given;
    later = later.then(() => runLater(work, port, message.job)).catch(fail);
    return;
  }
  const [port] = event.ports;
  if (!port) throw new Error('The background process got no port to the window.');
  given = { work: message, port };
  run(message, port).catch(fail);
});

function fail(error: unknown): never {
  console.error('The background process failed:', error);
  process.exit(1);
}

function startWorker(work: Work): Worker {
  return new Worker(work.workerEntry, { workerData: { syntaxFolder: work.syntaxFolder } });
}

function fileResult(done: Done): Result {
  return {
    type: 'file',
    index: done.index,
    diff: done.diff,
    tokens: done.tokens,
    diffMs: done.diffMs,
    highlightMs: done.highlightMs,
  };
}

/** Diffs and highlights a file loaded after the rest, on a worker of its own. */
async function runLater(work: Work, port: MessagePortMain, job: Job): Promise<void> {
  const worker = startWorker(work);
  try {
    port.postMessage(fileResult(await ask(worker, job)));
  } finally {
    await worker.terminate();
  }
}

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
  const start = (): Worker => startWorker(work);
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
        send(fileResult(done));
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
