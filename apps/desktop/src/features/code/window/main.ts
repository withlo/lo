import { code, jobs, type Jobs } from '../../../window/background.ts';
import { client, type Client } from '../../../window/ipc.ts';
import { contract } from '../contract.ts';
import { contract as codePort } from '../port.ts';

let connected: Client<typeof contract> | undefined;
let asking: Jobs<typeof codePort> | undefined;

/** The feature's client, made when it's first needed, once the window's bridge is there. */
export function main(): Client<typeof contract> {
  connected ??= client(contract);
  return connected;
}

/**
 * The code port's client: what the window asks main of a file's code, such as a name's
 * definitions, answered from the syntax index.
 */
export function port(): Jobs<typeof codePort> {
  asking ??= jobs(codePort, code);
  return asking;
}
