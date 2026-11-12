// A pull request's local copy held in memory, for tests of reading code that needs more of it than
// a repository on disk would comfortably hold: every file there, with its size, at any commit.

import { parseOid, type FileVersion } from '@lo/git';

import type { CodeClone } from '../main/code.ts';

/** A local copy of `files`, by path, and the paths read from it, in order. */
export function memoryClone(files: ReadonlyMap<string, Uint8Array>): {
  clone: CodeClone;
  reads: string[];
} {
  const paths = [...files.keys()];
  const reads: string[] = [];
  const clone: CodeClone = {
    offline: false,
    hasCommit: () => Promise.resolve(true),
    fetchCommit: () => Promise.resolve(),
    download: () => Promise.resolve([]),
    fileVersion(_rev, path): Promise<FileVersion | undefined> {
      const name = new TextDecoder().decode(path);
      const bytes = files.get(name);
      if (!bytes) return Promise.resolve(undefined);
      const oid = parseOid(paths.indexOf(name).toString(16).padStart(40, '0'));
      return Promise.resolve({ path: Buffer.from(path), oid, mode: 'regular', size: bytes.length });
    },
    readBlob(oid, options) {
      const name = paths[Number.parseInt(oid, 16)] ?? '';
      reads.push(name);
      const bytes = files.get(name) ?? new Uint8Array();
      if (options?.maxBytes !== undefined && bytes.length > options.maxBytes) {
        return Promise.reject(new Error('Past the most it may read.'));
      }
      return Promise.resolve(Buffer.from(bytes));
    },
  };
  return { clone, reads };
}
