// The window's side of the background process: the port main hands it, and a client per job group
// whose methods and types come from the group's contract.

import { IpcError, isResult, type InputOf, type ReplyOf } from '../ipc/contract.ts';
import { isHandOver, plainDataProblem, type JobContract, type JobReply } from '../ipc/jobs.ts';

/** A port as the window uses it: the browser's MessagePort, or Node's in tests. */
export interface Port {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  start(): void;
  close(): void;
}

export interface Connection {
  /**
   * Runs a job by its full name. Rejects with an `IpcError`: the process's own, `invalid` for input
   * that isn't plain data, `restarted` if the process stopped meanwhile, `unanswered` past
   * `timeout` milliseconds (a minute unless given), or `cancelled` once `signal` aborts, which
   * stops the job in the process too.
   */
  run(job: string, input: unknown, options?: RunOptions): Promise<unknown>;
  /** Takes a new port to the process. Jobs sent before any port go out on this one. */
  connect(port: Port): void;
  /** The process stopped: the jobs sent to it fail as `restarted`, and new ones wait for a port. */
  lose(): void;
}

/** How long to wait for a job, and what stops it. */
export interface RunOptions {
  timeout?: number;
  signal?: AbortSignal | undefined;
}

interface Waiting {
  job: string;
  input: unknown;
  sent: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export function createConnection(): Connection {
  let port: Port | undefined;
  let next = 1;
  const waiting = new Map<number, Waiting>();

  const settle = (id: number) => {
    const job = waiting.get(id);
    if (job) clearTimeout(job.timer);
    waiting.delete(id);
    return job;
  };

  const receive = (reply: unknown) => {
    if (!isJobReply(reply)) return;
    const job = settle(reply.id);
    if (!job) return;
    if (reply.ok) job.resolve(reply.value);
    else job.reject(new IpcError(reply.error.code, reply.error.message));
  };

  const lose = () => {
    for (const [id, job] of waiting) {
      if (!job.sent) continue;
      settle(id);
      job.reject(new IpcError('restarted', `The background process stopped during ${job.job}.`));
    }
    port?.close();
    port = undefined;
  };

  return {
    run(job, input, { timeout = 60_000, signal } = {}) {
      // A port drops what it can't send, such as a Blob, and the job would never be answered.
      const problem = plainDataProblem(input);
      if (problem) {
        return Promise.reject(new IpcError('invalid', `${job} takes plain data, but ${problem}.`));
      }
      const cancelled = () => new IpcError('cancelled', `${job} was cancelled.`);
      if (signal?.aborted) return Promise.reject(cancelled());
      const id = next++;
      return new Promise((resolve, reject) => {
        const stop = () => {
          const waited = settle(id);
          if (!waited) return;
          // The process stops it too, if it has it.
          if (waited.sent) port?.postMessage({ cancel: id });
          reject(cancelled());
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', stop);
          settle(id);
          reject(new IpcError('unanswered', `${job} got no answer in ${timeout} ms.`));
        }, timeout);
        signal?.addEventListener('abort', stop, { once: true });
        const done =
          <T>(then: (value: T) => void) =>
          (value: T) => {
            signal?.removeEventListener('abort', stop);
            then(value);
          };
        waiting.set(id, {
          job,
          input,
          sent: port !== undefined,
          timer,
          resolve: done(resolve),
          reject: done(reject),
        });
        port?.postMessage({ id, job, input });
      });
    },
    connect(newPort) {
      lose();
      port = newPort;
      port.addEventListener('message', (event) => receive(event.data));
      port.start();
      for (const [id, job] of waiting) {
        job.sent = true;
        port.postMessage({ id, job: job.job, input: job.input });
      }
    },
    lose,
  };
}

/** The window's connection, which takes each port main hands over through the preload. */
export const background = createConnection();

declare global {
  interface Window {
    /** The window's connection, for the smoke test, in a build run from source with test jobs. */
    loBackground?: Connection;
  }
}

/** Listens for main's news of the process. Runs once, as the window starts, so none is missed. */
export function listenForBackground(): void {
  window.addEventListener('message', (event) => {
    if (event.source !== window || !isHandOver(event.data)) return;
    const [port] = event.ports;
    if (event.data.state === 'lost') background.lose();
    else if (port) background.connect(port);
    if (event.data.testing) window.loBackground = background;
  });
}

/**
 * A job as a function, with what stops it. One whose input can be undefined may be called without
 * it.
 */
type Call<Spec> =
  undefined extends InputOf<Spec>
    ? (input?: InputOf<Spec>, options?: RunOptions) => Promise<ReplyOf<Spec>>
    : (input: InputOf<Spec>, options?: RunOptions) => Promise<ReplyOf<Spec>>;

export type Jobs<C extends JobContract> = {
  readonly [Name in keyof C['jobs']]: Call<C['jobs'][Name]>;
};

/** A job group's client: `jobs(contract).highlight(input)` runs `<group>.highlight`. */
export function jobs<C extends JobContract>(
  contract: C,
  connection: Connection = background,
): Jobs<C> {
  const calls = Object.keys(contract.jobs).map((name) => [
    name,
    (input?: unknown, options?: RunOptions) =>
      connection.run(`${contract.group}.${name}`, input, options),
  ]);
  // The process answers each job as its contract says; replies aren't validated here.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return Object.fromEntries(calls) as Jobs<C>;
}

function isJobReply(value: unknown): value is JobReply {
  return isResult(value) && 'id' in value && typeof value.id === 'number';
}
