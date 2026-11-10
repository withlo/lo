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

/** What the window sends: an id of its choosing, the job's full name and its input. */
export interface JobRequest {
  id: number;
  job: string;
  input: unknown;
}

/**
 * What the process answers, under the request's id. A failure's code is `invalid` (the message or
 * its input didn't match), `unavailable` (no such job), `timeout` (it ran past its deadline),
 * `memory` (it ran out of its memory), or `failed` (it threw). The window adds `restarted` for
 * jobs lost when the process restarts.
 */
export type JobReply = { id: number } & (
  { ok: true; value: unknown } | { ok: false; error: Failure }
);

/** The message the preload passes to the page with the port to the background process. */
export const handOver = 'lo:background';
