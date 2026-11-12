import { describe, expect, it, vi } from 'vitest';

import { answer, host as portHost, type Execute } from './host.ts';
import { defaultLimits } from './runners.ts';
import sampleRunner from './test/jobs.ts';

function host() {
  const execute = vi.fn<Execute>(async (_job, input) => ({ ok: true, value: input }));
  return { execute, ask: (message: unknown) => answer([sampleRunner], execute, message) };
}

/**
 * An array claiming the most entries an array can have, with none: what a hostile page can send
 * cheaply. A check that walked its length wouldn't finish in the test's time.
 */
function sparse(): unknown[] {
  const holes: unknown[] = [];
  holes.length = 4_294_967_295;
  return holes;
}

describe('a port’s jobs', () => {
  it('stops a job the window cancels, by the id it sent it under', async () => {
    let stopped: AbortSignal | undefined;
    const execute: Execute = (_job, _input, _limits, signal) =>
      new Promise((resolve) => {
        stopped = signal;
        signal?.addEventListener('abort', () =>
          resolve({ ok: false, error: { code: 'cancelled', message: 'gone' } }),
        );
      });
    const jobs = portHost([sampleRunner], execute);
    const answered = jobs.receive({ id: 3, job: 'sample.double', input: 2 });
    await vi.waitFor(() => expect(stopped).toBeDefined());
    expect(await jobs.receive({ cancel: 9 })).toBe(undefined);
    expect(stopped?.aborted).toBe(false);
    expect(await jobs.receive({ cancel: 3 })).toBe(undefined);
    expect(await answered).toEqual({
      id: 3,
      ok: false,
      error: { code: 'cancelled', message: 'gone' },
    });
  });
});

describe('answer', () => {
  it('runs a job under its limits and answers under its id', async () => {
    const { ask, execute } = host();
    expect(await ask({ id: 7, job: 'sample.double', input: 2 })).toEqual({
      id: 7,
      ok: true,
      value: 2,
    });
    expect(execute).toHaveBeenCalledWith('sample.double', 2, defaultLimits, undefined);
    await ask({ id: 8, job: 'sample.spin' });
    expect(execute).toHaveBeenLastCalledWith(
      'sample.spin',
      undefined,
      { ...defaultLimits, deadline: 200 },
      undefined,
    );
  });

  it('refuses input that doesn’t match the job', async () => {
    const { ask, execute } = host();
    expect(await ask({ id: 1, job: 'sample.double', input: 'two' })).toEqual({
      id: 1,
      ok: false,
      error: { code: 'invalid', message: 'sample.double got malformed input (input).' },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown job', { id: 1, job: 'sample.nothing' }],
    ['an unknown group', { id: 1, job: 'other.double', input: 1 }],
    ['a name objects already have', { id: 1, job: 'sample.toString' }],
  ])('refuses %s', async (_case, message) => {
    const { ask, execute } = host();
    expect(await ask(message)).toMatchObject({ id: 1, ok: false, error: { code: 'unavailable' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['extra keys', { id: 3, job: 'sample.double', input: 1, extra: true }],
    ['a name that isn’t a job’s', { id: 3, job: 'ELECTRON_SOMETHING', input: 1 }],
  ])('refuses a malformed message with %s, under its id', async (_case, message) => {
    expect(await host().ask(message)).toMatchObject({
      id: 3,
      ok: false,
      error: { code: 'invalid' },
    });
  });

  it.each([
    null,
    'run',
    42,
    { job: 'sample.double' },
    { id: -1, job: 'sample.double' },
    { id: 1.5 },
  ])("doesn't answer %j, which has no id to answer under", async (message) => {
    const { ask, execute } = host();
    expect(await ask(message)).toBe(undefined);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('answer, before any schema', () => {
  it('refuses a message that isn’t plain data, under its id', async () => {
    const { ask, execute } = host();
    for (const input of [sparse(), new Map([[1, 2]])]) {
      expect(await ask({ id: 4, job: 'sample.double', input })).toMatchObject({
        id: 4,
        ok: false,
        error: { code: 'invalid' },
      });
    }
    expect(execute).not.toHaveBeenCalled();
  });
});
