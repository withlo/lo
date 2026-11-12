import { describe, expect, it, vi } from 'vitest';

import { findJob } from './runners.ts';
import sampleRunner from './test/jobs.ts';
import { workers } from './worker.ts';

const execute = workers(new URL('./test/entry.ts', import.meta.url));
const limits = (job: string) => findJob([sampleRunner], job)?.limits ?? { deadline: 0, memory: 0 };
const run = (job: string, input?: unknown) => execute(job, input, limits(job));

describe('workers', () => {
  it('runs a job on a worker and answers with its result', async () => {
    expect(await run('sample.double', 21)).toEqual({ ok: true, value: 42 });
  });

  it('stops a job that runs past its deadline', async () => {
    const started = Date.now();
    expect(await run('sample.spin')).toEqual({
      ok: false,
      error: { code: 'timeout', message: 'sample.spin ran past its 200 ms.' },
    });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("starts a job's deadline when its code does, not while its worker loads", async () => {
    // The worker takes a second to load, twice the job's deadline; the job takes 50 ms of it.
    const slow = workers(new URL('./test/slow.ts', import.meta.url));
    expect(await slow('sample.pause', 50, limits('sample.pause'))).toEqual({ ok: true, value: 50 });
  });

  it('gives up on a worker that never starts its job', async () => {
    const stuck = workers(new URL('./test/stuck.ts', import.meta.url), 200);
    const started = Date.now();
    expect(await stuck('sample.double', 21, limits('sample.double'))).toEqual({
      ok: false,
      error: {
        code: 'busy',
        message: "sample.double couldn't start within 200 ms; try again later.",
      },
    });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('stops a job the window cancels while it runs', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const answer = execute(
      'sample.spin',
      undefined,
      { deadline: 30_000, memory: 64 },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 50);
    expect(await answer).toEqual({
      ok: false,
      error: { code: 'cancelled', message: 'sample.spin was cancelled.' },
    });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('stops a job that runs out of its memory', async () => {
    expect(await run('sample.fill')).toEqual({
      ok: false,
      error: { code: 'memory', message: 'sample.fill ran out of its 16 MB.' },
    });
  });

  it("passes on a job's own IpcError", async () => {
    expect(await run('sample.refuse')).toEqual({
      ok: false,
      error: { code: 'refused', message: 'Not that one.' },
    });
  });

  it("keeps an unexpected error's text in the process", async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await run('sample.crash');
      expect(result).toEqual({
        ok: false,
        error: { code: 'failed', message: 'sample.crash failed.' },
      });
      expect(JSON.stringify(result)).not.toContain('hunter2');
    } finally {
      logged.mockRestore();
    }
  });
});
