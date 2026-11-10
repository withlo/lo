import { MessageChannel, type MessagePort } from 'node:worker_threads';

import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reply } from '../ipc/contract.ts';
import { defineJobs } from '../ipc/jobs.ts';
import { createConnection, jobs, type Port } from './background.ts';

const contract = defineJobs('sample', {
  double: { input: z.number(), reply: reply<number>() },
  stall: { input: z.undefined(), reply: reply<never>() },
});

const opened: MessagePort[] = [];
afterEach(() => {
  for (const port of opened.splice(0)) port.close();
});

/** A port to a pretend process that doubles numbers, refuses everything else and never stalls back. */
function process(): Port {
  const { port1, port2 } = new MessageChannel();
  opened.push(port1, port2);
  port2.on('message', (request: { id: number; job: string; input: unknown }) => {
    if (request.job === 'sample.double' && typeof request.input === 'number') {
      port2.postMessage({ id: request.id, ok: true, value: request.input * 2 });
    } else if (request.job !== 'sample.stall') {
      port2.postMessage({
        id: request.id,
        ok: false,
        error: { code: 'unavailable', message: 'No.' },
      });
    }
  });
  const listeners: ((event: { data: unknown }) => void)[] = [];
  port1.on('message', (data: unknown) => {
    for (const listener of listeners) listener({ data });
  });
  return {
    postMessage: (message) => port1.postMessage(message),
    addEventListener: (_type, listener) => listeners.push(listener),
    start: () => {},
    close: () => port1.close(),
  };
}

describe('the background connection', () => {
  it('runs a job and resolves with its answer', async () => {
    const connection = createConnection();
    connection.connect(process());
    expect(await jobs(contract, connection).double(21)).toBe(42);
  });

  it("waits for a port before sending, so a job sent first isn't lost", async () => {
    const connection = createConnection();
    const answer = jobs(contract, connection).double(4);
    connection.connect(process());
    expect(await answer).toBe(8);
  });

  it("rejects with the process's code and message", async () => {
    const connection = createConnection();
    connection.connect(process());
    await expect(connection.run('sample.nothing', null)).rejects.toMatchObject({
      name: 'IpcError',
      code: 'unavailable',
      message: 'No.',
    });
  });

  it('fails the jobs in flight as restarted when a new port arrives, and carries on', async () => {
    const connection = createConnection();
    connection.connect(process());
    const stalled = jobs(contract, connection).stall();
    connection.connect(process());
    await expect(stalled).rejects.toMatchObject({ code: 'restarted' });
    expect(await jobs(contract, connection).double(5)).toBe(10);
  });

  it('ignores answers that aren’t replies, or are to nothing it sent', async () => {
    const connection = createConnection();
    const { port1, port2 } = new MessageChannel();
    opened.push(port1, port2);
    const listeners: ((event: { data: unknown }) => void)[] = [];
    port1.on('message', (data: unknown) => {
      for (const listener of listeners) listener({ data });
    });
    connection.connect({
      postMessage: (message) => port1.postMessage(message),
      addEventListener: (_type, listener) => listeners.push(listener),
      start: () => {},
      close: () => port1.close(),
    });
    const answer = connection.run('sample.double', 1);
    port2.postMessage('nonsense');
    port2.postMessage({ id: 99, ok: true, value: 'stray' });
    port2.postMessage({ id: 1, ok: true, value: 2 });
    expect(await answer).toBe(2);
  });
});

describe('the background connection, when things go wrong', () => {
  it('fails the jobs it sent as soon as the process stops, and queues new ones for the next port', async () => {
    const connection = createConnection();
    connection.connect(process());
    const stalled = jobs(contract, connection).stall();
    connection.lose();
    await expect(stalled).rejects.toMatchObject({ code: 'restarted' });
    const later = jobs(contract, connection).double(6);
    connection.connect(process());
    expect(await later).toBe(12);
  });

  it('gives up on a job that gets no answer', async () => {
    vi.useFakeTimers();
    try {
      const connection = createConnection();
      connection.connect(process());
      const stalled = connection
        .run('sample.stall', undefined, { timeout: 5000 })
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await stalled).toMatchObject({ code: 'unanswered' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses input a port would drop, without sending it', async () => {
    const connection = createConnection();
    connection.connect(process());
    await expect(connection.run('sample.double', new Blob(['2']))).rejects.toMatchObject({
      code: 'invalid',
      message: 'sample.double takes plain data, but it holds a Blob.',
    });
  });
});
