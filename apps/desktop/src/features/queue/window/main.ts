import { client, type Client } from '../../../window/ipc.ts';
import { contract as tabContract } from '../../tab/contract.ts';
import { contract } from '../contract.ts';

let connected: Client<typeof contract> | undefined;

/** The feature's client, made when it's first needed, once the window's bridge is there. */
export function main(): Client<typeof contract> {
  connected ??= client(contract);
  return connected;
}

/** The tab feature's client, to open pages on GitHub. */
export function tabs(): Client<typeof tabContract> {
  return client(tabContract);
}
