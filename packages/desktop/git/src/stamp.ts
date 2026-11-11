import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { GitError } from './errors.ts';

/** The file in a clone, or a checkout's git folder, that records when Lo last used it. */
export const LAST_USED_FILE = 'lo-last-used';

/** Records that the clone or checkout whose git folder is `folder` was used at `time`. */
export async function stampUsed(folder: string, time = Date.now()): Promise<void> {
  const path = join(folder, LAST_USED_FILE);
  try {
    await writeFile(path, `${Math.floor(time / 1000)}\n`);
  } catch (error) {
    throw GitError.io(`writing ${path}`, error);
  }
}
