import { jobs, type Jobs } from '../../../window/background.ts';
import { client, type Client } from '../../../window/ipc.ts';
import { contract } from '../contract.ts';
import { contract as jobContract } from '../jobs.ts';

let connected: Client<typeof contract> | undefined;
let background: Jobs<typeof jobContract> | undefined;

/** The feature's client, made when it's first needed, once the window's bridge is there. */
export function main(): Client<typeof contract> {
  connected ??= client(contract);
  return connected;
}

/** The feature's jobs in the background process. */
export function diffJobs(): Jobs<typeof jobContract> {
  background ??= jobs(jobContract);
  return background;
}
