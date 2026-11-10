// The window's side of a feature's contract: a client whose methods and types come from the
// contract itself, so calling a request is a typed function call and no list of channels exists.

import type { Bridge } from '../ipc/bridge.ts';
import {
  channel,
  IpcError,
  type Contract,
  type InputOf,
  type ReplyOf,
  type ValueOf,
} from '../ipc/contract.ts';

declare global {
  interface Window {
    /** Set by the preload: Lo's only way to main. */
    readonly lo: Bridge;
  }
}

/** A request as a function. One whose input can be undefined may be called without it. */
type Call<Spec> =
  undefined extends InputOf<Spec>
    ? (input?: InputOf<Spec>) => Promise<ReplyOf<Spec>>
    : (input: InputOf<Spec>) => Promise<ReplyOf<Spec>>;

export type Client<C extends Contract> = {
  readonly [Name in keyof C['requests']]: Call<C['requests'][Name]>;
} & {
  /** Listens to one of the feature's topics. Returns a function that stops listening. */
  subscribe<Topic extends keyof C['topics'] & string>(
    topic: Topic,
    listener: (value: ValueOf<C['topics'][Topic]>) => void,
  ): () => void;
};

/**
 * A feature's client: `client(contract).info()` sends `app.info` and resolves with its reply, or
 * rejects with an `IpcError` carrying main's code and message.
 */
export function client<C extends Contract>(contract: C, bridge: Bridge = window.lo): Client<C> {
  const calls = Object.keys(contract.requests).map((name) => [
    name,
    async (input?: unknown) => {
      const result = await bridge.invoke(channel(contract.feature, name), input);
      if (!result.ok) throw new IpcError(result.error.code, result.error.message);
      return result.value;
    },
  ]);
  const subscribe = (topic: string, listener: (value: unknown) => void) =>
    bridge.subscribe(channel(contract.feature, topic), listener);
  // Main answers each request as its contract says; replies aren't validated in the window.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { ...Object.fromEntries(calls), subscribe } as Client<C>;
}
