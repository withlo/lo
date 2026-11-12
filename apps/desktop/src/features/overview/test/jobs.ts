// The overview's jobs run in the test's own process, as the background process runs them: each
// message checked as plain data, then against the job's schema, and what goes each way copied as a
// port copies it.

import type { Execute } from '../../../background/host.ts';
import { answer } from '../../../background/host.ts';
import { findJob } from '../../../background/runners.ts';
import runner from '../background/index.ts';
import type { CheckInput, Parsed } from '../jobs.ts';
import type { CheckedArtifact } from '@lo/artifact';

const execute: Execute = async (job, input) => {
  const found = findJob([runner], job);
  if (!found) return { ok: false, error: { code: 'unavailable', message: job } };
  try {
    return { ok: true, value: await found.run(input) };
  } catch (error) {
    return { ok: false, error: { code: 'failed', message: String(error) } };
  }
};

let next = 1;

/** Runs `job` on `input` as the background process would, and returns what it answered. */
export async function runJob(job: string, input: unknown): Promise<unknown> {
  const reply = await answer([runner], execute, structuredClone({ id: next++, job, input }));
  if (!reply) throw new Error(`${job} gave no answer`);
  if (!reply.ok) throw new Error(`${job} failed: ${reply.error.code}: ${reply.error.message}`);
  return structuredClone(reply.value);
}

/** The overview's jobs, run as {@link runJob} runs them. */
export const localJobs = {
  async parse(input: { artifact: Uint8Array }): Promise<Parsed> {
    const reply = await runJob('overview.parse', input);
    // The jobs answer as their contract says.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return reply as Parsed;
  },
  async check(input: CheckInput): Promise<CheckedArtifact> {
    const reply = await runJob('overview.check', input);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return reply as CheckedArtifact;
  },
};
