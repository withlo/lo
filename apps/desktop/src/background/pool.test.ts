import { describe, expect, it } from 'vitest';

import type { Execute } from './host.ts';
import { memoryCap, pool, poolSize } from './pool.ts';
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
    const run = pool(execute, 2).window;
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
    const run = pool(execute, 1, 1).window;
    void run('running', undefined, defaultLimits);
    void run('waiting', undefined, defaultLimits);
    expect(await run('one too many', undefined, defaultLimits)).toEqual({
      ok: false,
      error: { code: 'busy', message: 'Too many jobs are waiting; try again later.' },
    });
  });

  it('never starts a job cancelled while it waits', async () => {
    const { execute, started, finish } = controlled();
    const run = pool(execute, 1).window;
    const first = run('a', undefined, defaultLimits);
    const controller = new AbortController();
    const second = run('b', undefined, defaultLimits, controller.signal);
    controller.abort();
    expect(await second).toEqual({
      ok: false,
      error: { code: 'cancelled', message: 'b was cancelled.' },
    });
    finish.get('a')?.();
    await first;
    expect(started).toEqual(['a']);
  });

  it('answers a job whose run throws, and carries on', async () => {
    const run = pool(async (job) => {
      if (job === 'bad') throw new Error('Broken.');
      return { ok: true, value: job };
    }, 1).window;
    expect(await run('bad', undefined, defaultLimits)).toEqual({
      ok: false,
      error: { code: 'failed', message: 'bad failed.' },
    });
    expect(await run('good', undefined, defaultLimits)).toEqual({ ok: true, value: 'good' });
  });
});

/** Lets every job that can start, and every answer that's in, go on. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("main's jobs", () => {
  it('runs one of main’s jobs at a time, on a worker the window isn’t using', async () => {
    const { execute, started, finish, most } = controlled();
    const jobs = pool(execute, 3);
    const answers = ['m1', 'm2', 'm3'].map((job) => jobs.main(job, undefined, defaultLimits));
    await settled();
    expect(started).toEqual(['m1']);
    finish.get('m1')?.();
    await settled();
    expect(started).toEqual(['m1', 'm2']);
    finish.get('m2')?.();
    await settled();
    finish.get('m3')?.();
    expect(await Promise.all(answers)).toEqual(
      ['m1', 'm2', 'm3'].map((value) => ({ ok: true, value })),
    );
    expect(most()).toBe(1);
  });

  it('waits behind the window’s jobs: a free worker goes to the window first', async () => {
    const { execute, started, finish } = controlled();
    const jobs = pool(execute, 2);
    void jobs.window('w1', undefined, defaultLimits);
    void jobs.window('w2', undefined, defaultLimits);
    // Both workers busy: main's job and the window's next wait, and the window's goes first.
    void jobs.main('m1', undefined, defaultLimits);
    void jobs.window('w3', undefined, defaultLimits);
    await settled();
    expect(started).toEqual(['w1', 'w2']);
    finish.get('w1')?.();
    await settled();
    expect(started).toEqual(['w1', 'w2', 'w3']);
    finish.get('w2')?.();
    await settled();
    expect(started).toEqual(['w1', 'w2', 'w3', 'm1']);
  });

  it('leaves the window’s jobs every other worker while one of main’s runs', async () => {
    const { execute, started } = controlled();
    const jobs = pool(execute, 2);
    void jobs.main('m1', undefined, defaultLimits);
    void jobs.window('w1', undefined, defaultLimits);
    void jobs.main('m2', undefined, defaultLimits);
    await settled();
    expect(started).toEqual(['m1', 'w1']);
  });

  it('never starts one of main’s jobs cancelled while it waits', async () => {
    const { execute, started, finish } = controlled();
    const jobs = pool(execute, 1);
    void jobs.window('w1', undefined, defaultLimits);
    const controller = new AbortController();
    const waiting = jobs.main('m1', undefined, defaultLimits, controller.signal);
    controller.abort();
    expect(await waiting).toEqual({
      ok: false,
      error: { code: 'cancelled', message: 'm1 was cancelled.' },
    });
    finish.get('w1')?.();
    await settled();
    expect(started).toEqual(['w1']);
  });
});

describe('poolSize', () => {
  const gb = 1024 ** 3;
  const mb = 1024 ** 2;

  it('takes a core each when their heaps fit under the cap', () => {
    expect(poolSize({ cores: 4, memoryCap: 2 * gb, jobHeap: 256 * mb })).toBe(4);
  });

  it('takes fewer when the heaps would pass three quarters of the cap', () => {
    // 18 cores at 256 MB would be 4.6 GB, past a 2 GB cap.
    expect(poolSize({ cores: 18, memoryCap: 2 * gb, jobHeap: 256 * mb })).toBe(6);
  });

  it('always runs at least one job', () => {
    expect(poolSize({ cores: 8, memoryCap: 200 * mb, jobHeap: 256 * mb })).toBe(1);
  });
});

describe('memoryCap', () => {
  const mb = 1024 ** 2;

  it('turns the megabytes main sets into bytes', () => {
    expect(memoryCap('2048')).toBe(2048 * mb);
    expect(memoryCap('200')).toBe(200 * mb);
    expect(memoryCap('1')).toBe(mb);
  });

  it('gives a pool a real size, however many cores there are', () => {
    expect(poolSize({ cores: 4, memoryCap: memoryCap('2048'), jobHeap: 256 * mb })).toBe(4);
    expect(poolSize({ cores: 4, memoryCap: memoryCap('1'), jobHeap: 256 * mb })).toBe(1);
  });

  it('refuses a cap that was never set, rather than size a pool from nothing', () => {
    expect(() => memoryCap(undefined)).toThrow(
      'The background process needs LO_BACKGROUND_MEMORY_CAP_MB, a whole number of megabytes, and got nothing.',
    );
  });

  it.each([
    '',
    ' ',
    '0',
    '-5',
    '1.5',
    '1e3',
    '0x10',
    '+5',
    ' 2048',
    '2048 ',
    '2048MB',
    'lots',
    'NaN',
    'Infinity',
    '9'.repeat(400),
  ])('refuses a cap of %j', (cap) => {
    expect(() => memoryCap(cap)).toThrow(
      `needs LO_BACKGROUND_MEMORY_CAP_MB, a whole number of megabytes, and got ${JSON.stringify(cap)}.`,
    );
  });
});
