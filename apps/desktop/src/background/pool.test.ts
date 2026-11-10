import { describe, expect, it } from 'vitest';

import type { Execute } from './host.ts';
import { pool } from './pool.ts';
import { defaultLimits } from './runners.ts';

/** An execute whose jobs finish when the test says, recording how many ran at once. */
function controlled() {
  let running = 0;
  let most = 0;
  const started: string[] = [];
  const finish = new Map<string, () => void>();
  const execute: Execute = (job) =>
    new Promise((resolve) => {
      running += 1;
      most = Math.max(most, running);
      started.push(job);
      finish.set(job, () => {
        running -= 1;
        resolve({ ok: true, value: job });
      });
    });
  return { execute, started, finish, most: () => most };
}

describe('pool', () => {
  it('runs no more jobs at once than its size, in the order they came', async () => {
    const { execute, started, finish, most } = controlled();
    const run = pool(execute, 2);
    const answers = ['a', 'b', 'c', 'd'].map((job) => run(job, undefined, defaultLimits));
    await Promise.resolve();
    expect(started).toEqual(['a', 'b']);
    finish.get('a')?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['a', 'b', 'c']);
    for (const job of ['b', 'c']) finish.get(job)?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    finish.get('d')?.();
    expect(await Promise.all(answers)).toEqual(
      ['a', 'b', 'c', 'd'].map((value) => ({ ok: true, value })),
    );
    expect(most()).toBe(2);
  });

  it('turns jobs away once too many are waiting', async () => {
    const { execute } = controlled();
    const run = pool(execute, 1, 1);
    void run('running', undefined, defaultLimits);
    void run('waiting', undefined, defaultLimits);
    expect(await run('one too many', undefined, defaultLimits)).toEqual({
      ok: false,
      error: { code: 'busy', message: 'Too many jobs are waiting; try again later.' },
    });
  });

  it('answers a job whose run throws, and carries on', async () => {
    const run = pool(async (job) => {
      if (job === 'bad') throw new Error('Broken.');
      return { ok: true, value: job };
    }, 1);
    expect(await run('bad', undefined, defaultLimits)).toEqual({
      ok: false,
      error: { code: 'failed', message: 'bad failed.' },
    });
    expect(await run('good', undefined, defaultLimits)).toEqual({ ok: true, value: 'good' });
  });
});
