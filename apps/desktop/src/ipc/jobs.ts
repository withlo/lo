// Jobs for the background process: pure work, such as parsing or diffing, that the window sends
// straight to the process over a MessagePort, and that main sends over a port of its own, behind
// the window's. A group's contract gives each job an input schema and a reply type, as a feature's
// contract does for requests to main. The process validates every message: the window shows
// untrusted content, and the process has Node. The code port, from main to the window, speaks the
// same shapes.

import type { z } from 'zod';

import {
  IpcError,
  isResult,
  type Failure,
  type InputOf,
  type Reply,
  type ReplyOf,
} from './contract.ts';

/** A job: its input's schema and its reply's type. */
export interface JobSpec<Input extends z.ZodType = z.ZodType, Output = unknown> {
  input: Input;
  reply: Reply<Output>;
}

export interface JobContract<
  Group extends string = string,
  Specs extends Record<string, JobSpec> = Record<string, JobSpec>,
> {
  /** The jobs' group, which names them: `<group>.<job>`. */
  readonly group: Group;
  readonly jobs: Specs;
  /** `main` when only main may send them, over its own port; the window's port refuses them. */
  readonly from?: 'main' | undefined;
}

const groupName = /^[a-z][a-z0-9]*$/;
const jobName = /^[a-z][a-zA-Z0-9]*$/;

/** A job's full name: `<group>.<job>`. */
export const jobPath = /^[a-z][a-z0-9]*\.[a-z][a-zA-Z0-9]*$/;

export function defineJobs<const Group extends string, Specs extends Record<string, JobSpec>>(
  group: Group,
  specs: Specs,
  options: { from?: 'main' } = {},
): JobContract<Group, Specs> {
  if (!groupName.test(group)) {
    throw new Error(`A job group's name is lowercase letters and digits, not "${group}".`);
  }
  for (const name of Object.keys(specs)) {
    if (!jobName.test(name)) throw new Error(`${group}: "${name}" isn't a job name (camelCase).`);
  }
  return options.from === undefined ? { group, jobs: specs } : { group, jobs: specs, from: 'main' };
}

/**
 * What the window sends to stop a job it sent, by the id it sent it under: one still waiting for a
 * worker never starts, and one running has its worker stopped.
 */
export interface JobCancel {
  cancel: number;
}

/** What the window sends: an id of its choosing, the job's full name and its input. */
export interface JobRequest {
  id: number;
  job: string;
  input: unknown;
}

/**
 * What the process answers, under the request's id. A failure's code is `invalid` (the message or
 * its input didn't match), `unavailable` (no such job), `busy` (too many jobs were waiting, or its
 * worker couldn't start in time), `timeout` (it ran past its deadline), `memory` (it ran out of its
 * memory), `cancelled` (the window stopped it), or `failed` (it threw). The window adds `restarted`
 * for jobs lost when the process restarts.
 */
export type JobReply = { id: number } & (
  { ok: true; value: unknown } | { ok: false; error: Failure }
);

/** The channel main tells the window about the background process on, through the preload. */
export const handOver = 'lo:background';

/**
 * What main tells the window, which the preload passes on as a window message: a new port to the
 * process (`connected`, with the port), or that the process stopped (`lost`), so the window fails
 * the jobs it had sent at once. `testing` is set only in a build run from source with the test jobs.
 */
export interface HandOver {
  type: typeof handOver;
  state: 'connected' | 'lost';
  testing: boolean;
}

/**
 * The channel main hands the window the code port on, through the preload: a port of main's own,
 * made for each load of the page, which answers code features' questions from main (`code.*`).
 */
export const codeHandOver = 'lo:code';

/** What main sends with the code port, which the preload passes on as a window message. */
export interface CodeHandOver {
  type: typeof codeHandOver;
}

export function isCodeHandOver(value: unknown): value is CodeHandOver {
  return (
    typeof value === 'object' && value !== null && 'type' in value && value.type === codeHandOver
  );
}

export function isHandOver(value: unknown): value is HandOver {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === handOver &&
    'state' in value &&
    (value.state === 'connected' || value.state === 'lost') &&
    'testing' in value &&
    typeof value.testing === 'boolean'
  );
}

/** The most bytes a job's input may hold in byte arrays, counting each array's whole buffer. */
export const BYTES_LIMIT = 256 * 1024 * 1024;

/**
 * Why a value can't go to the process, or undefined when it can: jobs take plain data (objects,
 * arrays, strings, numbers, booleans, null, and bytes as a `Uint8Array` of its own memory),
 * nothing a port might drop, such as a Blob, and no array with holes. Checked by the window before
 * sending and by the process before anything else, and cheap however a value is built: it visits
 * only what's really there, within limits. A byte array goes with its whole buffer, so that's what
 * it counts.
 */
export function plainDataProblem(value: unknown): string | undefined {
  let nodes = 0;
  let characters = 0;
  let bytes = 0;
  const visit = (item: unknown, depth: number): string | undefined => {
    nodes += 1;
    if (nodes > 1_000_000) return 'it has more than a million values';
    if (depth > 64) return 'it nests more than 64 deep';
    if (item === null || item === undefined || typeof item === 'boolean') return undefined;
    if (typeof item === 'number') return undefined;
    if (typeof item === 'string') {
      characters += item.length;
      return characters > 64 * 1024 * 1024 ? 'it holds more than 64 million characters' : undefined;
    }
    if (
      item instanceof Uint8Array &&
      Object.getPrototypeOf(item) === Uint8Array.prototype &&
      item.buffer instanceof ArrayBuffer
    ) {
      bytes += item.buffer.byteLength;
      return bytes > BYTES_LIMIT
        ? `it holds more than ${BYTES_LIMIT / (1024 * 1024)} MiB of bytes`
        : undefined;
    }
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) return 'it has an array with holes';
      for (const entry of item) {
        const problem = visit(entry, depth + 1);
        if (problem) return problem;
      }
      return undefined;
    }
    if (typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      for (const entry of Object.values(item)) {
        const problem = visit(entry, depth + 1);
        if (problem) return problem;
      }
      return undefined;
    }
    return `it holds a ${typeof item === 'object' ? (item.constructor?.name ?? 'object') : typeof item}`;
  };
  return visit(value, 0);
}

/** A port as a connection uses it: the browser's MessagePort, Node's, or Electron's in main. */
export interface Port {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  start(): void;
  close(): void;
}

/** One side's connection to whatever answers jobs over a port: the background process, or main. */
export interface Connection {
  /**
   * Runs a job by its full name. Rejects with an `IpcError`: the other side's own, `invalid` for
   * input that isn't plain data, `restarted` if the other side stopped meanwhile, `unanswered` past
   * `timeout` milliseconds (a minute unless given), or `cancelled` once `signal` aborts, which
   * stops the job on the other side too.
   */
  run(job: string, input: unknown, options?: RunOptions): Promise<unknown>;
  /** Takes a new port. Jobs sent before any port go out on this one. */
  connect(port: Port): void;
  /** The other side stopped: the jobs sent to it fail as `restarted`, and new ones wait for a port. */
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

/** A connection, whose jobs name `who` when it stops under them: the background process unless said. */
export function createConnection(who = 'The background process'): Connection {
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
      job.reject(new IpcError('restarted', `${who} stopped during ${job.job}.`));
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
          // The other side stops it too, if it has it.
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

/** A job group's client on `connection`: `jobs(contract, c).highlight(input)` runs `<group>.highlight`. */
export function jobs<C extends JobContract>(contract: C, connection: Connection): Jobs<C> {
  const calls = Object.keys(contract.jobs).map((name) => [
    name,
    (input?: unknown, options?: RunOptions) =>
      connection.run(`${contract.group}.${name}`, input, options),
  ]);
  // The other side answers each job as its contract says; replies aren't validated here.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return Object.fromEntries(calls) as Jobs<C>;
}

function isJobReply(value: unknown): value is JobReply {
  return isResult(value) && 'id' in value && typeof value.id === 'number';
}
