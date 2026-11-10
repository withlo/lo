// The process's side of each port to the window: every message is checked before a job runs, since
// the window shows untrusted content and this process has Node.

import { z } from 'zod';

import type { Result } from '../ipc/contract.ts';
import { jobPath, plainDataProblem, type JobReply } from '../ipc/jobs.ts';
import { findJob, type Limits, type Runner } from './runners.ts';

const request = z.strictObject({
  id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  job: z.string().regex(jobPath),
  input: z.unknown().optional(),
});

/** Runs a job, already checked, under its limits. */
export type Execute = (job: string, input: unknown, limits: Limits) => Promise<Result<unknown>>;

/**
 * Answers a message from the window: the job's result, or why it didn't run. A message without
 * an id to answer under gets no answer. Before any schema looks at it, the message must be plain
 * data within limits, so a small message can't expand into a huge check (an array with holes, say).
 */
export async function answer(
  runners: readonly Runner[],
  execute: Execute,
  message: unknown,
): Promise<JobReply | undefined> {
  const problem = plainDataProblem(message);
  if (problem) {
    const id = idOf(message);
    return id === undefined
      ? undefined
      : fail(id, 'invalid', `The job request can't be read: ${problem}.`);
  }
  const parsed = request.safeParse(message);
  if (!parsed.success) {
    const id = idOf(message);
    return id === undefined ? undefined : fail(id, 'invalid', 'The job request is malformed.');
  }
  const { id, job, input } = parsed.data;
  const found = findJob(runners, job);
  if (!found) return fail(id, 'unavailable', `There's no job named ${job}.`);
  const checked = found.spec.input.safeParse(input);
  if (!checked.success) {
    const where = checked.error.issues.map((issue) => issue.path.join('.') || 'input');
    return fail(id, 'invalid', `${job} got malformed input (${where.join(', ')}).`);
  }
  return { id, ...(await execute(job, checked.data, found.limits)) };
}

function fail(id: number, code: string, message: string): JobReply {
  return { id, ok: false, error: { code, message } };
}

/** The id a message asks to be answered under, if it has a usable one. */
export function idOf(message: unknown): number | undefined {
  if (typeof message !== 'object' || message === null || !('id' in message)) return undefined;
  const { id } = message;
  return typeof id === 'number' && Number.isSafeInteger(id) && id >= 0 ? id : undefined;
}
