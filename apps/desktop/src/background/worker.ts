// Each job runs on a worker thread of its own, with a cap on its JavaScript heap and a deadline.
// Past either, the worker is stopped and the job fails with `memory` or `timeout`. Memory outside
// the heap (WebAssembly's, say) isn't capped here; main watches the whole process for that.
//
// The deadline is the job's own: it starts when the worker says the job's code has, not when the
// worker does. A worker first loads the whole of the process's script, which takes a few hundred
// milliseconds on a slow machine, more with other workers loading or running beside it, and none of
// that is the job's doing. The load has a limit of its own, so a worker that never finishes it
// still gives its place back.

import { parentPort, Worker, workerData } from 'node:worker_threads';

import { IpcError, isResult, type Result } from '../ipc/contract.ts';
import type { Execute } from './host.ts';
import { findJob, type Runner } from './runners.ts';

/** How long a worker may take to load before its job starts, in milliseconds. */
const START_LIMIT = 10_000;

/** What a worker posts as its job's code starts, before the job's result. */
const STARTED = 'started';

/**
 * Runs jobs on workers started from `entry`, a script that calls `work` in a worker. Past
 * `startLimit` without its job started, a worker is stopped and the job fails as `busy`.
 */
export function workers(entry: URL, startLimit = START_LIMIT): Execute {
  return (job, input, limits, signal) =>
    new Promise((resolve) => {
      const worker = new Worker(entry, {
        workerData: { job, input },
        resourceLimits: { maxOldGenerationSizeMb: limits.memory, maxYoungGenerationSizeMb: 16 },
      });
      let settled = false;
      let started = false;
      const settle = (result: Result<unknown>) => {
        if (settled) return;
        settled = true;
        clearTimeout(limit);
        signal?.removeEventListener('abort', cancelled);
        resolve(result);
        void worker.terminate();
      };
      const fail = (code: string, message: string) =>
        settle({ ok: false, error: { code, message } });
      // Cancelled while it loads or runs: its worker stops.
      const cancelled = () => fail('cancelled', `${job} was cancelled.`);
      signal?.addEventListener('abort', cancelled, { once: true });
      // The load's limit, until the job starts; then the job's deadline.
      let limit = setTimeout(
        () => fail('busy', `${job} couldn't start within ${startLimit} ms; try again later.`),
        startLimit,
      );
      if (signal?.aborted) cancelled();
      worker.on('message', (message: unknown) => {
        if (!started && message === STARTED) {
          started = true;
          clearTimeout(limit);
          limit = setTimeout(
            () => fail('timeout', `${job} ran past its ${limits.deadline} ms.`),
            limits.deadline,
          );
        } else if (started && isResult(message)) settle(message);
        else fail('failed', `${job} answered with something that isn't a result.`);
      });
      worker.once('error', (error: unknown) => {
        const outOfMemory =
          error instanceof Error && 'code' in error && error.code === 'ERR_WORKER_OUT_OF_MEMORY';
        if (outOfMemory) fail('memory', `${job} ran out of its ${limits.memory} MB.`);
        else fail('failed', `${job} failed.`);
      });
      worker.once('exit', () => fail('failed', `${job} stopped without an answer.`));
    });
}

/** In a worker: says the job has started, runs it, and posts the result. */
export async function work(runners: readonly Runner[]): Promise<void> {
  const { job, input } = jobData(workerData);
  const found = findJob(runners, job);
  // Worker threads' ports, not windows: they have no origin to name.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  parentPort?.postMessage(STARTED);
  let result: Result<unknown>;
  try {
    if (!found) throw new IpcError('unavailable', `There's no job named ${job}.`);
    result = { ok: true, value: await found.run(input) };
  } catch (error) {
    // A job's own IpcError says what went wrong; anything else stays here.
    result =
      error instanceof IpcError
        ? { ok: false, error: { code: error.code, message: error.message } }
        : { ok: false, error: { code: 'failed', message: `${job} failed.` } };
    if (!(error instanceof IpcError)) console.error(`${job} failed:`, error);
  }
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  parentPort?.postMessage(result);
}

function jobData(data: unknown): { job: string; input: unknown } {
  if (typeof data === 'object' && data !== null && 'job' in data && typeof data.job === 'string') {
    return { job: data.job, input: 'input' in data ? data.input : undefined };
  }
  throw new Error('A worker started without a job.');
}
