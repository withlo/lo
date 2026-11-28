// Each job runs on a worker thread of its own, with a cap on its JavaScript heap and a deadline.
// Past either, the worker is stopped and the job fails with `memory` or `timeout`. Memory outside
// the heap (WebAssembly's, say) isn't capped here; main watches the whole process for that.
//
// The deadline is the job's own: it starts when the worker says the job's code has, not when the
// worker does. A worker first loads the whole of the process's script, which takes a few hundred
// milliseconds on a slow machine, more with other workers loading or running beside it, and none of
// that is the job's doing. The load has a limit of its own, so a worker that never finishes it
// still gives its place back.
//
// The jobs that ask for it (`warm` in their runner), short ones a reader waits on as a tab opens,
// such as reading and checking an overview, run instead on one worker kept warm: started with the
// process, so it has loaded before it's needed, and kept between jobs, which it runs one at a time.
// While it runs one, another runs on a worker of its own. Whatever ends a job but its own answer
// (its deadline, its heap, a cancel, a failure) stops the warm worker too, and a fresh one starts
// loading in its place, unless it never loaded: then the next such job starts one.

import { parentPort, Worker, workerData } from 'node:worker_threads';

import { IpcError, isResult, type Result } from '../ipc/contract.ts';
import type { Execute } from './host.ts';
import { defaultLimits, findJob, type Limits, type Runner } from './runners.ts';

/** How long a worker may take to load before its job starts, in milliseconds. */
const START_LIMIT = 10_000;

/** What a worker posts as its job's code starts, before the job's result. */
const STARTED = 'started';

/** What a worker's workerData says to make it the warm one, which waits to be sent its jobs. */
const WARM = 'warm';

export interface WorkerOptions {
  /** How long a worker may take to load before its job starts, in milliseconds. */
  readonly startLimit?: number;
  /** Whether job `job` runs on the warm worker while that's free. Without it, none is kept. */
  readonly warm?: (job: string) => boolean;
}

/** The worker kept warm: whether it's running a job, and whether it has ever started one. */
interface Warm {
  readonly worker: Worker;
  busy: boolean;
  loaded: boolean;
}

/**
 * How a job on a worker ended: its result; whether its code started, so the worker had loaded; and
 * whether the worker answered with the result, so it can run another.
 */
interface Ended {
  readonly result: Result<unknown>;
  readonly started: boolean;
  readonly answered: boolean;
}

/**
 * Runs jobs on workers started from `entry`, a script that calls `work` in a worker. Past
 * `startLimit` without its job started, a worker is stopped and the job fails as `busy`. With
 * `warm`, a worker is started at once and kept for the jobs it names, under the default heap: one
 * that asks for another runs on a worker of its own.
 */
export function workers(entry: URL, options: WorkerOptions = {}): Execute {
  const { startLimit = START_LIMIT, warm: runsWarm } = options;
  const start = (data: unknown, memory: number) =>
    new Worker(entry, {
      workerData: data,
      resourceLimits: { maxOldGenerationSizeMb: memory, maxYoungGenerationSizeMb: 16 },
    });

  let warm: Warm | undefined;
  const startWarm = (): Warm => {
    const worker = start(WARM, defaultLimits.memory);
    // The process stays up for its ports, not for a worker that waits.
    worker.unref();
    const kept: Warm = { worker, busy: false, loaded: false };
    // One that stops between jobs, as it shouldn't, is let go: the next job starts another. One that
    // stops in a job is the job's to end.
    const gone = () => {
      if (warm === kept && !kept.busy) warm = undefined;
    };
    worker.once('error', gone);
    worker.once('exit', gone);
    return kept;
  };
  if (runsWarm) warm = startWarm();

  return async (job, input, limits, signal) => {
    if (signal?.aborted) return cancelled(job);
    if (runsWarm?.(job) && limits.memory === defaultLimits.memory && !warm?.busy) {
      const kept = warm ?? startWarm();
      warm = kept;
      kept.busy = true;
      const ended = await runOn(kept.worker, job, limits, startLimit, signal, () =>
        kept.worker.postMessage({ job, input }),
      );
      if (ended.answered) {
        kept.loaded = true;
        kept.busy = false;
        return ended.result;
      }
      void kept.worker.terminate();
      // A worker that never loaded may never: the next job starts one, rather than this one now.
      const loads = kept.loaded || ended.started || signal?.aborted === true;
      if (warm === kept) warm = loads ? startWarm() : undefined;
      return ended.result;
    }
    const worker = start({ job, input }, limits.memory);
    const ended = await runOn(worker, job, limits, startLimit, signal);
    void worker.terminate();
    return ended.result;
  };
}

function cancelled(job: string): Result<unknown> {
  return { ok: false, error: { code: 'cancelled', message: `${job} was cancelled.` } };
}

/**
 * Waits for `worker`'s answer to `job`, sent to it by `send` once it's listened to, under the
 * load's limit until the job starts and then the job's deadline, until `signal` cancels it.
 */
function runOn(
  worker: Worker,
  job: string,
  limits: Limits,
  startLimit: number,
  signal: AbortSignal | undefined,
  send?: () => void,
): Promise<Ended> {
  return new Promise((resolve) => {
    let settled = false;
    let started = false;
    const settle = (result: Result<unknown>, answered = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(limit);
      signal?.removeEventListener('abort', cancel);
      worker.off('message', message);
      worker.off('error', error);
      worker.off('exit', exit);
      resolve({ result, started, answered });
    };
    const fail = (code: string, text: string) =>
      settle({ ok: false, error: { code, message: text } });
    // Cancelled while it loads or runs: its worker stops.
    const cancel = () => settle(cancelled(job));
    // The load's limit, until the job starts; then the job's deadline.
    let limit = setTimeout(
      () => fail('busy', `${job} couldn’t start within ${startLimit} ms; try again later.`),
      startLimit,
    );
    const message = (data: unknown) => {
      if (!started && data === STARTED) {
        started = true;
        clearTimeout(limit);
        limit = setTimeout(
          () => fail('timeout', `${job} ran past its ${limits.deadline} ms.`),
          limits.deadline,
        );
      } else if (started && isResult(data)) settle(data, true);
      else fail('failed', `${job} answered with something that isn’t a result.`);
    };
    const error = (thrown: unknown) => {
      const outOfMemory =
        thrown instanceof Error && 'code' in thrown && thrown.code === 'ERR_WORKER_OUT_OF_MEMORY';
      if (outOfMemory) fail('memory', `${job} ran out of its ${limits.memory} MB.`);
      else fail('failed', `${job} failed.`);
    };
    const exit = () => fail('failed', `${job} stopped without an answer.`);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.on('message', message);
    worker.once('error', error);
    worker.once('exit', exit);
    send?.();
  });
}

/**
 * In a worker: says the job has started, runs it, and posts the result. The warm worker does so
 * for each job it's sent, one at a time, and stays.
 */
export async function work(runners: readonly Runner[]): Promise<void> {
  if (workerData === WARM) {
    let last = Promise.resolve();
    parentPort?.on('message', (data: unknown) => {
      last = last
        .then(() => runJob(runners, jobData(data)))
        .catch((error: unknown) => console.error("The warm worker couldn't run a job:", error));
    });
    return;
  }
  await runJob(runners, jobData(workerData));
}

async function runJob(
  runners: readonly Runner[],
  { job, input }: { job: string; input: unknown },
): Promise<void> {
  const found = findJob(runners, job);
  // Worker threads' ports, not windows: they have no origin to name.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  parentPort?.postMessage(STARTED);
  let result: Result<unknown>;
  try {
    if (!found) throw new IpcError('unavailable', `There’s no job named ${job}.`);
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
