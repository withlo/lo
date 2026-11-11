// A stand-in for what the preload gives the window, for the tests of what the window asks main.

import { vi } from 'vitest';

import type { Bridge } from '../../ipc/bridge.ts';
import { IpcError, type Result } from '../../ipc/contract.ts';

type Answer = (input: unknown) => unknown;

export interface FakeBridge {
  /** The requests made, as `[channel, input]`. */
  readonly calls: [string, unknown][];
  /** Pushes a value to what listens to a topic. */
  push(topic: string, value: unknown): void;
}

/**
 * Installs a `window.lo` that answers each channel from `answers`: a function's return value is the
 * reply, and an `IpcError` it throws is a refusal. A channel with no answer fails as `unavailable`.
 */
export function installBridge(answers: Readonly<Record<string, Answer>> = {}): FakeBridge {
  const calls: [string, unknown][] = [];
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const bridge: Bridge = {
    invoke: vi.fn<Bridge['invoke']>(async (channel, input) => {
      calls.push([channel, input]);
      const answer = Object.hasOwn(answers, channel) ? answers[channel] : undefined;
      if (!answer) return failure('unavailable', `No answer for ${channel}.`);
      try {
        return { ok: true, value: await answer(input) };
      } catch (error) {
        if (error instanceof IpcError) return failure(error.code, error.message);
        throw error;
      }
    }),
    subscribe: vi.fn<Bridge['subscribe']>((topic, listener) => {
      const set = listeners.get(topic) ?? new Set();
      set.add(listener);
      listeners.set(topic, set);
      return () => {
        set.delete(listener);
      };
    }),
  };
  Reflect.set(window, 'lo', bridge);
  return {
    calls,
    push(topic, value) {
      for (const listener of listeners.get(topic) ?? []) listener(value);
    },
  };
}

function failure(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}
