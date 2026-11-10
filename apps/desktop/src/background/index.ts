// The background process: one Electron utility process that runs pure work, such as parsing and
// diffing, for the window, which talks to it over a MessagePort that main hands both of them. It
// gets no tokens and never reads files or the network for the window. Each job runs on a worker
// thread of its own, and this same script is that worker's entry.

import { availableParallelism } from 'node:os';
import { isMainThread } from 'node:worker_threads';

import type { MessagePortMain } from 'electron';

import { answer, idOf } from './host.ts';
import { pool } from './pool.ts';
import { loadRunners, type Runner } from './runners.ts';
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

if (isMainThread) {
  // Jobs wait for one of as many workers as the machine has cores.
  const execute = pool(workers(new URL(import.meta.url)), availableParallelism());
  const serve = (port: MessagePortMain) => {
    port.on('message', ({ data }) => {
      answer(runners, execute, data)
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
  };
  // Main sends a port for each connection to the window, and a new one whenever the window loads.
  process.parentPort.on('message', ({ data, ports }) => {
    const [port] = ports;
    if (data === 'connect' && port) serve(port);
  });
} else {
  void work(runners);
}
