/** Temporary folders that tests make, and remove when they're done with them. */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll } from 'vitest';

/**
 * Folders a test file's tests share, such as a remote they all fetch from, which outlast each
 * test: each call of the function it returns makes one, and every one is removed once the file's
 * tests have run. Call it as the file loads, at a module's top, so the removal is the file's.
 */
export function fileFolders(prefix: string): () => string {
  const made: string[] = [];
  afterAll(() => {
    for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
  });
  return () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    made.push(folder);
    return folder;
  };
}
