// Main's side of the code port, one for each load of a window's page: each message is checked as
// the background process checks its own, as plain data within limits and then against the port's
// contract, before anything is read, since the window shows untrusted content. A question is
// answered only about a view of the window the port was made for; a cancel stops one under way.
// Nothing here calls Electron, so it runs under unit tests with a port of Node's.

import { z } from 'zod';

import { IpcError, type ParsedOf, type ReplyOf } from '../../../ipc/contract.ts';
import { jobPath, plainDataProblem, type JobReply, type Port } from '../../../ipc/jobs.ts';
import { contract } from '../port.ts';

type Questions = typeof contract.jobs;

/** What answers each question, typed from the port's contract. */
export type Answerers = {
  [Name in keyof Questions]: (
    input: ParsedOf<Questions[Name]>,
    signal: AbortSignal,
  ) => Promise<ReplyOf<Questions[Name]>>;
};

export interface PortOptions {
  /** Whether view `view` is one this port's window shows. */
  readonly owns: (view: string) => boolean;
  readonly answer: Answerers;
  readonly log: (line: string) => void;
}

const request = z.strictObject({
  id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  job: z.string().regex(jobPath),
  input: z.unknown().optional(),
});

const cancel = z.strictObject({
  cancel: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

/** The id a message asks to be answered under, if it has a usable one. */
function idOf(message: unknown): number | undefined {
  if (typeof message !== 'object' || message === null || !('id' in message)) return undefined;
  const { id } = message;
  return typeof id === 'number' && Number.isSafeInteger(id) && id >= 0 ? id : undefined;
}

function fail(id: number, code: string, message: string): JobReply {
  return { id, ok: false, error: { code, message } };
}

/** The port's question by its full name, `code.<name>`, if it has one. */
function questionOf(job: string): keyof Questions | undefined {
  const [group, name] = job.split('.');
  if (group !== contract.group || name === undefined || !Object.hasOwn(contract.jobs, name)) {
    return undefined;
  }
  return Object.keys(contract.jobs).find((each): each is keyof Questions => each === name);
}

/**
 * Answers one message: what to reply with, if anything. A message without an id gets no answer;
 * any other gets one, even when what answers it fails.
 */
export async function answerMessage(
  options: PortOptions,
  message: unknown,
  signal: AbortSignal,
): Promise<JobReply | undefined> {
  const problem = plainDataProblem(message);
  if (problem) {
    const id = idOf(message);
    return id === undefined
      ? undefined
      : fail(id, 'invalid', `The question can't be read: ${problem}.`);
  }
  const parsed = request.safeParse(message);
  if (!parsed.success) {
    const id = idOf(message);
    return id === undefined ? undefined : fail(id, 'invalid', 'The question is malformed.');
  }
  const { id, job, input } = parsed.data;
  const name = questionOf(job);
  if (name === undefined) return fail(id, 'unavailable', `There's no question named ${job}.`);
  const checked = contract.jobs[name].input.safeParse(input);
  if (!checked.success) {
    const where = checked.error.issues.map((issue) => issue.path.join('.') || 'input');
    return fail(id, 'invalid', `${job} got malformed input (${where.join(', ')}).`);
  }
  if (!options.owns(checked.data.view)) {
    return fail(id, 'refused', "That view isn't in this window.");
  }
  try {
    // Each answerer takes its own question's input, which its schema just checked.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const answer = options.answer[name] as (
      input: unknown,
      signal: AbortSignal,
    ) => Promise<unknown>;
    return { id, ok: true, value: await answer(checked.data, signal) };
  } catch (error) {
    if (signal.aborted) return fail(id, 'cancelled', `${job} was cancelled.`);
    if (error instanceof IpcError) return fail(id, error.code, error.message);
    options.log(`answering ${job}: ${error instanceof Error ? error.message : String(error)}`);
    return fail(id, 'failed', `${job} failed.`);
  }
}

/**
 * Serves the code port on `port` until it's closed: answers each question, and stops one the
 * window cancels, which then answers as `cancelled`. Returns what closes it.
 */
export function servePort(port: Port, options: PortOptions): () => void {
  const running = new Map<number, AbortController>();
  let closed = false;
  port.addEventListener('message', ({ data }) => {
    const stop = cancel.safeParse(data);
    if (stop.success) {
      running.get(stop.data.cancel)?.abort();
      return;
    }
    const id = idOf(data);
    const controller = new AbortController();
    if (id !== undefined) {
      running.get(id)?.abort();
      running.set(id, controller);
    }
    answerMessage(options, data, controller.signal)
      .then((reply) => {
        if (reply && !closed) port.postMessage(reply);
      })
      .catch((error: unknown) => options.log(`couldn't answer the window: ${String(error)}`))
      .finally(() => {
        if (id !== undefined && running.get(id) === controller) running.delete(id);
      });
  });
  port.start();
  return () => {
    closed = true;
    for (const controller of running.values()) controller.abort();
    running.clear();
    port.close();
  };
}
