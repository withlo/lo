// Main's side of the store: each operation sent to the store's worker thread, answered in turn. The
// worker starts the first time something's asked, and starts again after it stops; what it was
// asked meanwhile fails. Nothing here calls Electron.

import { Worker } from 'node:worker_threads';

import { isStoreReply, type StoreOp, type StoreRequest } from './protocol.ts';
import type { Store } from './store.ts';

/** The store's operations, as main asks them of its worker. */
export type Symbols = {
  readonly [Op in StoreOp]: (...args: Parameters<Store[Op]>) => Promise<ReturnType<Store[Op]>>;
};

export interface SymbolStore extends Omit<Symbols, 'close'> {
  /** Closes the store and stops its worker. */
  stop(): Promise<void>;
}

/** How long stopping waits for the store to close before it stops the worker anyway. */
const CLOSE_LIMIT = 2000;

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/**
 * The store at `path`, in a worker thread started from `entry`, the worker's script: the built
 * chunk in the app, the source in tests.
 */
export function storeWorker(entry: string | URL, path: string): SymbolStore {
  let worker: Worker | undefined;
  let next = 1;
  const pending = new Map<number, Pending>();

  const lost = (why: string) => {
    for (const [id, waiting] of pending) {
      pending.delete(id);
      waiting.reject(new Error(why));
    }
    worker = undefined;
  };

  const started = (): Worker => {
    if (worker) return worker;
    const made = new Worker(entry, { workerData: { path } });
    made.on('message', (reply: unknown) => {
      if (!isStoreReply(reply)) return;
      const waiting = pending.get(reply.id);
      if (!waiting) return;
      pending.delete(reply.id);
      if (reply.ok) waiting.resolve(reply.value);
      else waiting.reject(new Error(`The syntax index’s store failed: ${reply.message}`));
    });
    made.once('error', (error) => lost(`The syntax index’s store stopped: ${error.message}`));
    made.once('exit', () => {
      if (worker === made) lost('The syntax index’s store stopped.');
    });
    worker = made;
    return made;
  };

  const ask =
    <Op extends StoreOp>(op: Op) =>
    (...args: Parameters<Store[Op]>) =>
      new Promise<ReturnType<Store[Op]>>((resolve, reject) => {
        const id = next++;
        pending.set(id, {
          // The worker answers each operation with what the store's method returned.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          resolve: (value) => resolve(value as ReturnType<Store[Op]>),
          reject,
        });
        // An operation with its own arguments, which TypeScript can't pair up across the union.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const request = { id, op, args } as StoreRequest;
        // A worker thread's port, not a window's: it has no origin to name.
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        started().postMessage(request);
      });

  return {
    fresh: ask('fresh'),
    put: ask('put'),
    setTree: ask('setTree'),
    tree: ask('tree'),
    definitions: ask('definitions'),
    referrers: ask('referrers'),
    kept: ask('kept'),
    trim: ask('trim'),
    clear: ask('clear'),
    async stop() {
      const stopping = worker;
      if (!stopping) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        ask('close')().catch(() => undefined),
        new Promise((resolve) => (timer = setTimeout(resolve, CLOSE_LIMIT))),
      ]);
      clearTimeout(timer);
      worker = undefined;
      lost('The syntax index has stopped.');
      await stopping.terminate();
    },
  };
}
