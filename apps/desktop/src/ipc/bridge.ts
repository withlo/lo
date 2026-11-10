import type { Result } from './contract.ts';

/**
 * What the preload gives the window, as `window.lo`, and all it gives: a request to main, and a
 * subscription to what main pushes. Feature code reaches it through a client built from its
 * contract (`window/ipc.ts`), never directly.
 */
export interface Bridge {
  /** Sends a request to main. Always resolves: a failure is `{ ok: false }`. */
  invoke(channel: string, input?: unknown): Promise<Result<unknown>>;
  /** Listens to a topic main pushes. Returns a function that stops listening. */
  subscribe(topic: string, listener: (value: unknown) => void): () => void;
}
