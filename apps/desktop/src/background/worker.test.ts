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
