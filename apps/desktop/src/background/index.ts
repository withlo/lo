// The background process: one Electron utility process that runs pure work, such as parsing and
// diffing, for the window, which talks to it over a MessagePort that main hands both of them, and
// for main, over a port of its own whose jobs wait behind the window's. It gets no tokens and never
// reads files or the network. Each job runs on a worker thread of its own, or the few that ask for
// it on one kept warm, and this same script is each worker's entry.

import { availableParallelism } from 'node:os';
import { isMainThread } from 'node:worker_threads';

import type { MessagePortMain } from 'electron';

import { host, idOf, type Execute } from './host.ts';
import { mainWay, memoryCap, pool, poolSize } from './pool.ts';
import { findJob, largestHeap, loadRunners, windowRunners, type Runner } from './runners.ts';
import testing from './testing.ts';
import { work, workers } from './worker.ts';

// Every feature folder with jobs for this process. No file lists them.
const found = import.meta.glob<Runner>('../features/*/background/index.ts', {
  eager: true,
  import: 'default',
});
// Main gives the process an environment of its own making, nothing inherited, and sets LO_TEST_JOBS
// in it only in a build run from source, and only when asked.
const runners = [...loadRunners(found), ...(process.env.LO_TEST_JOBS === '1' ? [testing] : [])];

/** Answers the jobs of `served` sent on `port`, running them through `execute`. */
function serve(port: MessagePortMain, execute: Execute, served: readonly Runner[]): void {
  const jobs = host(served, execute);
  port.on('message', ({ data }) => {
    jobs
      .receive(data)
      .catch((error: unknown) => {
        // Every message with an id gets an answer, even one that broke the process's own code.
        console.error("The background process couldn't answer:", error);
        const id = idOf(data);
        return id === undefined
          ? undefined
          : { id, ok: false, error: { code: 'failed', message: 'The job request failed.' } };
      })
      .then((reply) => reply && port.postMessage(reply))
      .catch((error: unknown) => console.error("The background process couldn't reply:", error));
  });
  port.start();
}

if (isMainThread) {
  // Jobs wait for a worker: one per core, as many as fit under the process's memory cap. Main sets
  // the cap in the process's environment, so without a valid one this throws, which reports it and
  // stops the process, and main starts it again.
  const size = poolSize({
    cores: availableParallelism(),
    memoryCap: memoryCap(process.env.LO_BACKGROUND_MEMORY_CAP_MB),
    jobHeap: largestHeap(runners) * 1024 ** 2,
  });
  // The jobs that ask for it run on a worker kept warm, which starts loading now.
  const execute = workers(new URL(import.meta.url), {
    warm: (job) => findJob(runners, job)?.warm === true,
  });
  const workerPool = pool(execute, size);
  // Main's jobs that answer the reader take a queue of their own, so none waits behind the index.
  const mainJobs = mainWay(workerPool, (job) => findJob(runners, job)?.asked === true);
  // Main sends a port for each connection to the window, and a new one whenever the window loads;
  // and one for its own jobs each time the process starts, which wait behind the window's.
  process.parentPort.on('message', ({ data, ports }) => {
    const [port] = ports;
    if (!port) return;
    if (data === 'connect') serve(port, workerPool.window, windowRunners(runners));
    else if (data === 'connect-main') serve(port, mainJobs, runners);
  });
} else {
  void work(runners);
}
