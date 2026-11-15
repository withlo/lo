// Jobs wait their turn for a worker, so however many arrive at once, no more run than the machine
// has cores, and each one's deadline starts when it does. The window's jobs come first: main's own,
// such as indexing a pull request's files, go one at a time, only when a worker is free and no job
// of the window's is waiting for one.

import type { Result } from '../ipc/contract.ts';
import type { Execute } from './host.ts';

/** A pool's two ways in: the window's jobs, and main's, which wait behind them. */
export interface Pool {
  readonly window: Execute;
  /** Main's: one at a time, starting only once no job of the window's is waiting. */
  readonly main: Execute;
}

export function pool(execute: Execute, size: number, waitingLimit = 1000): Pool {
  let running = 0;
  let mainRunning = false;
  const waiting: (() => void)[] = [];
  const mainWaiting: (() => void)[] = [];

  /** Starts what may start now: the window's first, then one of main's. */
  const next = () => {
    for (;;) {
      if (running >= size) return;
      const start = waiting.shift() ?? (mainRunning ? undefined : mainWaiting.shift());
      if (!start) return;
      start();
    }
  };

  const way =
    (main: boolean): Execute =>
    (job, input, limits, signal) => {
      const queue = main ? mainWaiting : waiting;
      if (queue.length >= waitingLimit) {
        return Promise.resolve({
          ok: false,
          error: { code: 'busy', message: 'Too many jobs are waiting; try again later.' },
        });
      }
      return new Promise<Result<unknown>>((resolve) => {
        const start = () => {
          signal?.removeEventListener('abort', leave);
          running += 1;
          if (main) mainRunning = true;
          void execute(job, input, limits, signal)
            .catch((): Result<unknown> => ({
              ok: false,
              error: { code: 'failed', message: `${job} failed.` },
            }))
            .then(resolve)
            .finally(() => {
              running -= 1;
              if (main) mainRunning = false;
              next();
            });
        };
        // Cancelled while it waits: it never starts.
        const leave = () => {
          const at = queue.indexOf(start);
          if (at < 0) return;
          queue.splice(at, 1);
          resolve({ ok: false, error: { code: 'cancelled', message: `${job} was cancelled.` } });
        };
        queue.push(start);
        signal?.addEventListener('abort', leave, { once: true });
        next();
      });
    };

  return { window: way(false), main: way(true) };
}

/**
 * How many jobs may run at once: one per core, but no more than fit in three quarters of the
 * process's memory cap at the largest heap any job may use, leaving the rest for the process itself
 * and for memory outside the heap. Never fewer than one.
 */
export function poolSize(options: { cores: number; memoryCap: number; jobHeap: number }): number {
  const fit = Math.floor((options.memoryCap * 0.75) / options.jobHeap);
  return Math.max(1, Math.min(options.cores, fit));
}

/**
 * The process's memory cap, in bytes, from the whole megabytes main puts in
 * `LO_BACKGROUND_MEMORY_CAP_MB`. Main always sets it. Without a valid one there's no size to give
 * the pool, and no safe one to guess, so this throws: the process stops at startup and main starts
 * it again, rather than run with a pool that has no bound or that no job ever leaves.
 */
export function memoryCap(megabytes: string | undefined): number {
  const cap = Number(megabytes);
  if (megabytes === undefined || !/^[1-9]\d*$/.test(megabytes) || !Number.isSafeInteger(cap)) {
    const got = megabytes === undefined ? 'nothing' : JSON.stringify(megabytes);
    throw new Error(
      `The background process needs LO_BACKGROUND_MEMORY_CAP_MB, a whole number of megabytes, and got ${got}.`,
    );
  }
  return cap * 1024 ** 2;
}
