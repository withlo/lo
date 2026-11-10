// Each job runs on a worker thread of its own, with a cap on its JavaScript heap and a deadline.
// Past either, the worker is stopped and the job fails with `memory` or `timeout`. Memory outside
// the heap (WebAssembly's, say) isn't capped here; main watches the whole process for that.

import { parentPort, Worker, workerData } from 'node:worker_threads';

import { IpcError, isResult, type Result } from '../ipc/contract.ts';
import type { Execute } from './host.ts';
import { findJob, type Runner } from './runners.ts';

/** Runs jobs on workers started from `entry`, a script that calls `work` in a worker. */
export function workers(entry: URL): Execute {
  return (job, input, limits) =>
    new Promise((resolve) => {
      const worker = new Worker(entry, {
        workerData: { job, input },
        resourceLimits: { maxOldGenerationSizeMb: limits.memory, maxYoungGenerationSizeMb: 16 },
      });
      let settled = false;
      const settle = (result: Result<unknown>) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve(result);
        void worker.terminate();
      };
      const fail = (code: string, message: string) =>
        settle({ ok: false, error: { code, message } });
      const deadline = setTimeout(
        () => fail('timeout', `${job} ran past its ${limits.deadline} ms.`),
        limits.deadline,
      );
      worker.once('message', (result: unknown) => {
        if (isResult(result)) settle(result);
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

/** In a worker: runs the job it was started for and posts the result. */
export async function work(runners: readonly Runner[]): Promise<void> {
  const { job, input } = jobData(workerData);
  const found = findJob(runners, job);
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
  // A worker thread's port, not a window: it has no origin to name.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  parentPort?.postMessage(result);
}

function jobData(data: unknown): { job: string; input: unknown } {
  if (typeof data === 'object' && data !== null && 'job' in data && typeof data.job === 'string') {
    return { job: data.job, input: 'input' in data ? data.input : undefined };
  }
  throw new Error('A worker started without a job.');
}
