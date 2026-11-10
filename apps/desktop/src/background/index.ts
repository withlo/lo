// The background process: one Electron utility process that runs pure work, such as parsing and
// diffing, for the window, which talks to it over a MessagePort that main hands both of them. It
// gets no tokens and never reads files or the network for the window. Each job runs on a worker
// thread of its own, and this same script is that worker's entry.

import { isMainThread } from 'node:worker_threads';

import type { MessagePortMain } from 'electron';

import { answer } from './host.ts';
import { loadRunners, type Runner } from './runners.ts';
import testing from './testing.ts';
import { work, workers } from './worker.ts';

// Every feature folder with jobs for this process. No file lists them.
const found = import.meta.glob<Runner>('../features/*/background/index.ts', {
  eager: true,
  import: 'default',
});
// Main sets LO_TEST_JOBS only in a build run from source, and only when asked.
const runners = [...loadRunners(found), ...(process.env.LO_TEST_JOBS === '1' ? [testing] : [])];

if (isMainThread) {
  const execute = workers(new URL(import.meta.url));
  const serve = (port: MessagePortMain) => {
    port.on('message', ({ data }) => {
      answer(runners, execute, data)
        .then((reply) => reply && port.postMessage(reply))
        .catch((error: unknown) => console.error("The background process couldn't answer:", error));
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
