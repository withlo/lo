// The code port's host in main, over a port of Node's: it answers a question about an open view,
// refuses one about a view that isn't, refuses what isn't plain data or doesn't match the port's
// contract, and stops a question the window cancels.

import { MessageChannel } from 'node:worker_threads';

import { describe, expect, it, onTestFinished } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import type { Port } from '../../../ipc/jobs.ts';
import { servePort, type Answerers } from './serve.ts';

const KEY = 'a'.repeat(40);
const PLACE = { view: 't1', key: KEY, path: 'src/format.ts', line: 2, column: 48 };

/** Main's end as the host takes it, and the window's, which sends a message and waits for its answer. */
function channel(isOpen: (view: string) => boolean, answer: Partial<Answerers>) {
  const { port1, port2 } = new MessageChannel();
  const main: Port = {
    postMessage: (message) => port1.postMessage(message),
    addEventListener: (_type, listener) =>
      port1.on('message', (data: unknown) => listener({ data })),
    start: () => port1.start(),
    close: () => port1.close(),
  };
  const lines: string[] = [];
  const close = servePort(main, {
    isOpen,
    answer: {
      definitions: async () => ({ name: 'parse', answers: [], more: false }),
      references: async () => ({ name: null, answers: [], more: false, note: '' }),
      hover: async () => ({ none: true }),
      hints: async () => ({ hints: [] }),
      outline: async () => ({ symbols: [], more: false, source: 'syntax' }),
      snippet: async () => ({ from: 1, text: [] }),
      ...answer,
    },
    log: (line) => lines.push(line),
  });
  onTestFinished(() => {
    close();
    port2.close();
  });
  const ask = (message: unknown, id = Reflect.get(Object(message), 'id')) =>
    new Promise<unknown>((resolve) => {
      const listen = (reply: { id?: unknown }) => {
        if (reply.id !== id) return;
        port2.off('message', listen);
        resolve(reply);
      };
      port2.on('message', listen);
      port2.postMessage(message);
    });
  return { ask, window: port2, lines };
}

describe('the code port', () => {
  it('answers a question about an open view', async () => {
    const { ask } = channel(() => true, {});
    expect(await ask({ id: 1, job: 'code.definitions', input: PLACE })).toEqual({
      id: 1,
      ok: true,
      value: { name: 'parse', answers: [], more: false },
    });
  });

  it('refuses a view that isn’t open', async () => {
    const { ask } = channel((view) => view === 'mine', {});
    expect(await ask({ id: 2, job: 'code.definitions', input: PLACE })).toMatchObject({
      id: 2,
      ok: false,
      error: { code: 'refused' },
    });
  });

  it('refuses what doesn’t match the contract, and a question it has no answer for', async () => {
    const { ask } = channel(() => true, {});
    for (const input of [
      { ...PLACE, line: 0 },
      { ...PLACE, key: 'not-a-commit' },
      { ...PLACE, extra: true },
      { ...PLACE, path: '' },
    ]) {
      expect(await ask({ id: 3, job: 'code.definitions', input })).toMatchObject({
        ok: false,
        error: { code: 'invalid' },
      });
    }
    expect(await ask({ id: 4, job: 'code.toString', input: PLACE })).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    });
    expect(await ask({ id: 5, job: 'diff.files', input: PLACE })).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    });
    expect(await ask({ id: 6, job: 'code.definitions', input: PLACE, more: 1 })).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
  });

  it('passes on why an answer can’t be had, and keeps the rest of a failure to itself', async () => {
    const { ask, lines } = channel(() => true, {
      definitions: async () => {
        throw new IpcError('refused', "That isn't a tree this view shows.");
      },
      references: async () => {
        throw new Error('/home/someone/secret path');
      },
    });
    expect(await ask({ id: 7, job: 'code.definitions', input: PLACE })).toEqual({
      id: 7,
      ok: false,
      error: { code: 'refused', message: "That isn't a tree this view shows." },
    });
    expect(await ask({ id: 8, job: 'code.references', input: PLACE })).toEqual({
      id: 8,
      ok: false,
      error: { code: 'failed', message: 'code.references failed.' },
    });
    expect(lines).toEqual(['answering code.references: /home/someone/secret path']);
  });

  it('stops a question the window cancels', async () => {
    let stopped = false;
    const { ask, window } = channel(() => true, {
      references: (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            stopped = true;
            reject(new Error('stopped'));
          });
        }),
    });
    const answer = ask({ id: 9, job: 'code.references', input: PLACE });
    // A worker thread's port, not a window's: it has no origin to name.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    window.postMessage({ cancel: 9 });
    expect(await answer).toMatchObject({ id: 9, ok: false, error: { code: 'cancelled' } });
    expect(stopped).toBe(true);
  });
});
