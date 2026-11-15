// The store's worker thread, one of main's: it opens the store and answers what main asks of it, one
// request at a time, so SQLite's writes and lookups never hold main's event loop.

import { parentPort, workerData } from 'node:worker_threads';

import { isStoreRequest, type StoreReply, type StoreRequest } from './protocol.ts';
import { Store } from './store.ts';

const path = pathOf(workerData);
let store: Store | undefined;

parentPort?.on('message', (message: unknown) => {
  if (!isStoreRequest(message)) return;
  let reply: StoreReply;
  try {
    // Opened the first time it's asked for, so a store that can't be opened fails a request.
    store ??= new Store(path);
    reply = { id: message.id, ok: true, value: run(store, message) };
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    reply = { id: message.id, ok: false, message: said };
  }
  // A worker thread's port, not a window's: it has no origin to name.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  parentPort?.postMessage(reply);
});

function run(kept: Store, request: StoreRequest): unknown {
  switch (request.op) {
    case 'fresh':
      return kept.fresh(...request.args);
    case 'put':
      return kept.put(...request.args);
    case 'setTree':
      return kept.setTree(...request.args);
    case 'tree':
      return kept.tree(...request.args);
    case 'definitions':
      return kept.definitions(...request.args);
    case 'referrers':
      return kept.referrers(...request.args);
    case 'kept':
      return kept.kept(...request.args);
    case 'trim':
      return kept.trim(...request.args);
    case 'clear':
      return kept.clear();
    case 'close':
      kept.close();
      store = undefined;
      return undefined;
    default:
      request satisfies never;
      throw new Error('The store has no such operation.');
  }
}

function pathOf(data: unknown): string {
  if (
    typeof data === 'object' &&
    data !== null &&
    'path' in data &&
    typeof data.path === 'string'
  ) {
    return data.path;
  }
  throw new Error('The store started without a path.');
}
