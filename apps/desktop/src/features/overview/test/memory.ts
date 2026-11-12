// A pull request's local copy held in memory, for tests of reading code that needs more of it than
// a repository on disk would comfortably hold: every file there, at any commit. Its contents are
// there from the start, or downloaded as GitHub sends them: a download brings what it asks for,
// stopped as `@lo/git` stops one once it brings more than it may, here counted as the files' sizes.

import { GitError, parseOid, type Oid } from '@lo/git';

import type { CodeClone } from '../main/code.ts';

/** What a copy in memory did: the paths read from it, and each download, with what it brought. */
export interface MemoryClone {
  clone: CodeClone;
  reads: string[];
  downloads: { paths: string[]; maxBytes: number | undefined; brought: number }[];
}

/** The ID a copy in memory gives the file at `index`. */
const oidOf = (index: number): Oid => parseOid(index.toString(16).padStart(40, '0'));

/**
 * A local copy of `files`, by path: with all their contents, or with `lacking` none of them until
 * they're downloaded.
 */
export function memoryClone(
  files: ReadonlyMap<string, Uint8Array>,
  { lacking = false } = {},
): MemoryClone {
  const paths = [...files.keys()];
  const pathOf = (oid: string) => paths[Number.parseInt(oid, 16)] ?? '';
  const present = new Set<string>(lacking ? [] : paths);
  const reads: string[] = [];
  const downloads: MemoryClone['downloads'] = [];
  const sizeOf = (oid: string) => {
    const path = pathOf(oid);
    return present.has(path) ? files.get(path)?.length : undefined;
  };
  const clone: CodeClone = {
    offline: false,
    hasCommit: () => Promise.resolve(true),
    fetchCommit: () => Promise.resolve(),
    missingObjects: (oids) => Promise.resolve(oids.filter((oid) => sizeOf(oid) === undefined)),
    download(oids, what, options) {
      const wanted = oids.map(pathOf).filter((path) => !present.has(path));
      const size = wanted.reduce((sum, path) => sum + (files.get(path)?.length ?? 0), 0);
      const maxBytes = options?.maxBytes;
      if (maxBytes !== undefined && size > maxBytes) {
        downloads.push({ paths: wanted, maxBytes, brought: maxBytes });
        return Promise.reject(
          new GitError({ kind: 'fetch', what: what ?? '', failure: 'tooLarge', message: 'past' }),
        );
      }
      downloads.push({ paths: wanted, maxBytes, brought: size });
      for (const path of wanted) present.add(path);
      return Promise.resolve([]);
    },
    fileVersions(_rev, asked) {
      return Promise.resolve(
        asked.map((path) => {
          const name = new TextDecoder().decode(path);
          const index = paths.indexOf(name);
          if (index === -1) return undefined;
          const oid = oidOf(index);
          return { path: Buffer.from(path), oid, mode: 'regular' as const, size: sizeOf(oid) };
        }),
      );
    },
    objectSizes: (oids) => Promise.resolve(oids.map(sizeOf)),
    readBlob(oid, options) {
      const name = pathOf(oid);
      if (!present.has(name)) return Promise.resolve(undefined);
      reads.push(name);
      const bytes = files.get(name) ?? new Uint8Array();
      if (options?.maxBytes !== undefined && bytes.length > options.maxBytes) {
        return Promise.reject(new Error('Past the most it may read.'));
      }
      return Promise.resolve(Buffer.from(bytes));
    },
  };
  return { clone, reads, downloads };
}
