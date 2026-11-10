// The window's side of the background process: the port main hands it, and a client per job group
// whose methods and types come from the group's contract.

import { IpcError, isResult, type InputOf, type ReplyOf } from '../ipc/contract.ts';
import { handOver, type JobContract, type JobReply } from '../ipc/jobs.ts';

/** A port as the window uses it: the browser's MessagePort, or Node's in tests. */
export interface Port {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  start(): void;
  close(): void;
}

export interface Connection {
  /** Runs a job by its full name. Rejects with an `IpcError` if it fails. */
  run(job: string, input: unknown): Promise<unknown>;
  /**
   * Takes a new port to the process. Jobs sent on the old one fail as `restarted`, since a new
   * port means the process started again; jobs sent before any port go out on this one.
   */
  connect(port: Port): void;
}

export function createConnection(): Connection {
  let port: Port | undefined;
  let next = 1;
  const waiting = new Map<
    number,
    {
      job: string;
      input: unknown;
      sent: boolean;
      resolve(value: unknown): void;
      reject(error: Error): void;
    }
  >();

  const receive = (reply: unknown) => {
    if (!isJobReply(reply)) return;
    const job = waiting.get(reply.id);
    if (!job) return;
    waiting.delete(reply.id);
    if (reply.ok) job.resolve(reply.value);
    else job.reject(new IpcError(reply.error.code, reply.error.message));
  };

  return {
    run(job, input) {
      const id = next++;
      return new Promise((resolve, reject) => {
        const sent = port !== undefined;
        waiting.set(id, { job, input, sent, resolve, reject });
        port?.postMessage({ id, job, input });
      });
    },
    connect(newPort) {
      for (const [id, job] of waiting) {
        if (!job.sent) continue;
        waiting.delete(id);
        job.reject(
          new IpcError('restarted', `The background process restarted during ${job.job}.`),
        );
      }
      port?.close();
      port = newPort;
      port.addEventListener('message', (event) => receive(event.data));
      port.start();
      for (const [id, job] of waiting) {
        job.sent = true;
        port.postMessage({ id, job: job.job, input: job.input });
      }
    },
  };
}

/** The window's connection, which takes each port main hands over through the preload. */
export const background = createConnection();

/** Listens for main's ports. Runs once, as the window starts, so no port is missed. */
export function listenForBackground(): void {
  window.addEventListener('message', (event) => {
    const [port] = event.ports;
    if (event.source === window && event.data === handOver && port) background.connect(port);
  });
}

/** A job as a function. One whose input can be undefined may be called without it. */
type Call<Spec> =
  undefined extends InputOf<Spec>
    ? (input?: InputOf<Spec>) => Promise<ReplyOf<Spec>>
    : (input: InputOf<Spec>) => Promise<ReplyOf<Spec>>;

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
    (input?: unknown) => connection.run(`${contract.group}.${name}`, input),
  ]);
  // The process answers each job as its contract says; replies aren't validated here.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return Object.fromEntries(calls) as Jobs<C>;
}

function isJobReply(value: unknown): value is JobReply {
  return isResult(value) && 'id' in value && typeof value.id === 'number';
}
