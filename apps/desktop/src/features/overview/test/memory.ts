// A pull request's local copy held in memory, for tests of reading code that needs more of it than
// a repository on disk would comfortably hold: every file there, at any commit. Its contents are
// there from the start, or downloaded as GitHub sends them: a download brings what it asks for,
// stopped as `@lo/git` stops one once more than it may has come in. What comes in for a file is
// its size, or what `wire` says, as for one that compresses well, or one a pack pads out.

import { GitError, parseOid, type Oid } from '@lo/git';

import type { CodeClone } from '../main/code.ts';

/** What a copy in memory did: the paths read from it, and each download, with what it brought. */
export interface MemoryClone {
  clone: CodeClone;
  reads: string[];
  /** Each download: what it asked for, its cap, and what came in, stopped or not. */
  downloads: { paths: string[]; maxBytes: number | undefined; brought: number }[];
}

/** The ID a copy in memory gives the file at `index`. */
const oidOf = (index: number): Oid => parseOid(index.toString(16).padStart(40, '0'));

/**
 * A local copy of `files`, by path: with all their contents, or with `lacking` none of them until
 * they're downloaded, each bringing what `wire` says of it, else its size.
 */
export function memoryClone(
  files: ReadonlyMap<string, Uint8Array>,
  {
    lacking = false,
    wire = new Map<string, number>(),
  }: { lacking?: boolean; wire?: ReadonlyMap<string, number> } = {},
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
      options?.signal?.throwIfAborted();
      const wanted = oids.map(pathOf).filter((path) => !present.has(path));
      if (wanted.length === 0) return Promise.resolve([]);
      const coming = wanted.reduce(
        (sum, path) => sum + (wire.get(path) ?? files.get(path)?.length ?? 0),
        0,
      );
      const maxBytes = options?.maxBytes;
      // Stopped once a little more than it may has come in.
      const brought = maxBytes !== undefined && coming > maxBytes ? maxBytes + 1 : coming;
      downloads.push({ paths: wanted, maxBytes, brought });
      options?.received?.(brought);
      if (brought < coming) {
        return Promise.reject(
          new GitError({ kind: 'fetch', what: what ?? '', failure: 'tooLarge', message: 'past' }),
        );
      }
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
