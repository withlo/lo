import { client, type Client } from '../../../window/ipc.ts';
import { contract as commentsContract } from '../../comments/contract.ts';
import { contract as revisionsContract } from '../../revisions/contract.ts';
import { contract as tabContract } from '../../tab/contract.ts';
import { contract } from '../contract.ts';

let connected: Client<typeof contract> | undefined;

/** The feature's client, made when it's first needed, once the window's bridge is there. */
export function main(): Client<typeof contract> {
  connected ??= client(contract);
  return connected;
}

/** The comments feature's client, for your pending review on each view. */
export function comments(): Client<typeof commentsContract> {
  return client(commentsContract);
}

/** The revisions feature's client, for each view's revisions and what it compares. */
export function revisions(): Client<typeof revisionsContract> {
  return client(revisionsContract);
}

/** The tab feature's client, to load a newer push. */
export function tabs(): Client<typeof tabContract> {
  return client(tabContract);
}
