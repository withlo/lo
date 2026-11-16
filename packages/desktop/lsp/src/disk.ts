/**
 * Writing an install so a power loss can't leave half of it looking whole: each file's data and
 * each folder's entries are synced to the disk before anything that says they're there.
 */

import { open } from 'node:fs/promises';

/** Syncs the file or folder at `path` to the disk: its data, and for a folder, its entries. */
export async function syncPath(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Runs `run` on each of `items`, at most `limit` at once, and throws the first error, after which
 * no more start.
 */
export async function atOnce<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<unknown>,
): Promise<void> {
  // Each worker takes the next item from the one iterator.
  const left = items.values();
  let failed = false;
  const worker = async (): Promise<void> => {
    for (const item of left) {
      if (failed) return;
      try {
        await run(item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
