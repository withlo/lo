// What main and the store's worker thread say to each other: a request names one of the store's
// operations and its arguments, and the reply carries what it returned, or why it failed.

import type { Store } from './store.ts';

/** The store's operations that main asks the worker for. */
export const storeOps = [
  'fresh',
  'put',
  'setTree',
  'tree',
  'definitions',
  'referrers',
  'kept',
  'trim',
  'clear',
  'close',
] as const satisfies readonly (keyof Store)[];

export type StoreOp = (typeof storeOps)[number];

/** A request for one operation, under an id of main's choosing. */
export type StoreRequest = {
  [Op in StoreOp]: { id: number; op: Op; args: Parameters<Store[Op]> };
}[StoreOp];

export type StoreReply = { id: number } & (
  { ok: true; value: unknown } | { ok: false; message: string }
);

/** Whether a message is a request, as main sends them: only main does. */
export function isStoreRequest(message: unknown): message is StoreRequest {
  if (typeof message !== 'object' || message === null) return false;
  const { id, op, args } = message as { id?: unknown; op?: unknown; args?: unknown };
  return (
    typeof id === 'number' &&
    typeof op === 'string' &&
    storeOps.some((each) => each === op) &&
    Array.isArray(args)
  );
}

export function isStoreReply(message: unknown): message is StoreReply {
  if (typeof message !== 'object' || message === null) return false;
  const { id, ok } = message as { id?: unknown; ok?: unknown };
  return typeof id === 'number' && typeof ok === 'boolean';
}
