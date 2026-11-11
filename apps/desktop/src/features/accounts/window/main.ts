import { client, type Client } from '../../../window/ipc.ts';
import { contract } from '../contract.ts';

/** The feature's client, on the window's bridge as it is now. */
export function main(): Client<typeof contract> {
  return client(contract);
}
