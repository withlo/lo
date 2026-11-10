import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import type { Bridge } from '../ipc/bridge.ts';
import { defineContract, IpcError, reply } from '../ipc/contract.ts';
import { client } from './ipc.ts';

const contract = defineContract('notes', {
  requests: {
    add: { input: z.strictObject({ text: z.string() }), reply: reply<{ id: number }>() },
    count: { input: z.undefined(), reply: reply<number>() },
  },
  topics: { changed: z.number() },
});

function fakeBridge(answer: Awaited<ReturnType<Bridge['invoke']>>) {
  const stop = vi.fn<() => void>();
  const bridge = {
    invoke: vi.fn<Bridge['invoke']>(async () => answer),
    subscribe: vi.fn<Bridge['subscribe']>(() => stop),
  };
  return { bridge, stop };
}

describe('client', () => {
  it("sends a request on its channel and resolves with main's reply", async () => {
    const { bridge } = fakeBridge({ ok: true, value: { id: 7 } });
    const notes = client(contract, bridge);
    expect(await notes.add({ text: 'Read the diff' })).toEqual({ id: 7 });
    expect(bridge.invoke).toHaveBeenCalledWith('notes.add', { text: 'Read the diff' });
  });

  it('sends a request with no input', async () => {
    const { bridge } = fakeBridge({ ok: true, value: 3 });
    expect(await client(contract, bridge).count()).toBe(3);
    expect(bridge.invoke).toHaveBeenCalledWith('notes.count', undefined);
  });

  it("rejects with main's code and message", async () => {
    const { bridge } = fakeBridge({ ok: false, error: { code: 'invalid', message: 'Bad input.' } });
    const failure = client(contract, bridge).count();
    await expect(failure).rejects.toBeInstanceOf(IpcError);
    await expect(failure).rejects.toMatchObject({ code: 'invalid', message: 'Bad input.' });
  });

  it('subscribes on the topic’s channel', () => {
    const { bridge, stop } = fakeBridge({ ok: true, value: null });
    const listener = vi.fn<(value: number) => void>();
    expect(client(contract, bridge).subscribe('changed', listener)).toBe(stop);
    expect(bridge.subscribe).toHaveBeenCalledWith('notes.changed', listener);
  });
});
