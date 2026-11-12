// Jobs for the background process: pure work, such as parsing or diffing, that the window sends
// straight to the process over a MessagePort. A group's contract gives each job an input schema
// and a reply type, as a feature's contract does for requests to main. The process validates every
// message: the window shows untrusted content, and the process has Node.

import type { z } from 'zod';

import type { Failure, Reply } from './contract.ts';

/** A job: its input's schema and its reply's type. */
export interface JobSpec<Input extends z.ZodType = z.ZodType, Output = unknown> {
  input: Input;
  reply: Reply<Output>;
}

export interface JobContract<
  Group extends string = string,
  Jobs extends Record<string, JobSpec> = Record<string, JobSpec>,
> {
  /** The jobs' group, which names them: `<group>.<job>`. */
  readonly group: Group;
  readonly jobs: Jobs;
}

const groupName = /^[a-z][a-z0-9]*$/;
const jobName = /^[a-z][a-zA-Z0-9]*$/;

/** A job's full name: `<group>.<job>`. */
export const jobPath = /^[a-z][a-z0-9]*\.[a-z][a-zA-Z0-9]*$/;

export function defineJobs<const Group extends string, Jobs extends Record<string, JobSpec>>(
  group: Group,
  jobs: Jobs,
): JobContract<Group, Jobs> {
  if (!groupName.test(group)) {
    throw new Error(`A job group's name is lowercase letters and digits, not "${group}".`);
  }
  for (const name of Object.keys(jobs)) {
    if (!jobName.test(name)) throw new Error(`${group}: "${name}" isn't a job name (camelCase).`);
  }
  return { group, jobs };
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
 * its input didn't match), `unavailable` (no such job), `timeout` (it ran past its deadline),
 * `memory` (it ran out of its memory), `cancelled` (the window stopped it), or `failed` (it
 * threw). The window adds `restarted` for jobs lost when the process restarts.
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
