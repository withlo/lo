// The cache as Settings knows it: how much room its local copies take, as main last said, and its
// folder, which "Show cache folder" shows in Finder. The Cache row and the command read the same.

import { createStore } from 'zustand/vanilla';

import { IpcError } from '../../../ipc/contract.ts';
import { refuse } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { contract, type CacheUsage } from '../contract.ts';

export const cacheStore = createStore<{ readonly usage: CacheUsage | undefined }>()(() => ({
  usage: undefined,
}));

/** Asks main how much room the local copies take, for the Cache row and the command. */
export function measureCache(): void {
  client(contract)
    .cacheUsage()
    .then(
      (usage) => cacheStore.setState({ usage }),
      (error: unknown) => {
        console.error("Lo couldn't measure the cache:", error);
        // Better to say there are no copies to show than to go on saying it's measuring them.
        cacheStore.setState({ usage: { status: 'unavailable' } });
      },
    );
}

/** Why the cache's folder can't be shown now, as the command's reason: while there's no cache. */
export function cacheShowable(): true | string {
  const { usage } = cacheStore.getState();
  if (usage === undefined || usage.status === 'ready') return true;
  return usage.status === 'checking' ? 'The cache isn’t ready' : 'There’s no cache folder';
}

/** Shows the cache's folder in Finder, and says why in a toast when it can't. */
export async function showCache(): Promise<void> {
  try {
    await client(contract).showCache();
  } catch (error) {
    console.error("Lo couldn't show the cache folder:", error);
    refuse(
      error instanceof IpcError && error.code === 'noCache'
        ? 'There’s no cache folder'
        : 'Couldn’t show the cache folder',
    );
  }
}
