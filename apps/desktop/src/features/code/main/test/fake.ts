// A local copy for the syntax index's tests, built in memory: commits of files, blobs named by their
// contents' hash, some lacking until downloaded, and a count of every download and read. And the
// store, in memory, as main asks its worker.

import { createHash } from 'node:crypto';

import { GitError, parseOid, type Oid, type TreeEntry } from '@lo/git';

import { IpcError } from '../../../../ipc/contract.ts';
import type { FileJob, FileSymbols, Tagged, Uses } from '../../jobs.ts';
import type { CodeRepo } from '../indexer.ts';
import { Store } from '../store/store.ts';

/** A blob's ID for `text`, as git would name a blob. */
export function blobOf(text: string): Oid {
  const bytes = Buffer.from(text, 'utf8');
  return parseOid(
    createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex'),
  );
}

/** A commit's ID for a name, so a test names its commits. */
export function commitOf(name: string): Oid {
  return parseOid(createHash('sha1').update(`commit ${name}`).digest('hex'));
}

export interface FakeRepo extends CodeRepo {
  /** Each blob's ID, every time a batch of blobs was read. */
  readonly reads: Oid[][];
  /** The bytes each download brought. */
  readonly downloads: number[];
  /** Blobs the clone lacks. */
  readonly lacking: Set<Oid>;
}

/**
 * A local copy with `commits`, each a map of paths to texts. `lacking` names paths whose blobs the
 * clone doesn't have until they're downloaded; `generated` paths `.gitattributes` marks generated.
 */
export function fakeRepo(options: {
  commits: Readonly<Record<string, Readonly<Record<string, string>>>>;
  lacking?: readonly string[];
  generated?: readonly string[];
  offline?: boolean;
  /** Fails a download with this, as when the network is down. */
  failDownloads?: boolean;
}): FakeRepo {
  const blobs = new Map<Oid, Buffer>();
  const trees = new Map<Oid, Map<string, Oid>>();
  for (const [name, files] of Object.entries(options.commits)) {
    const tree = new Map<string, Oid>();
    for (const [path, text] of Object.entries(files)) {
      const oid = blobOf(text);
      blobs.set(oid, Buffer.from(text, 'utf8'));
      tree.set(path, oid);
    }
    trees.set(commitOf(name), tree);
  }
  const lacking = new Set<Oid>();
  for (const path of options.lacking ?? []) {
    for (const tree of trees.values()) {
      const oid = tree.get(path);
      if (oid) lacking.add(oid);
    }
  }
  const generated = new Set(options.generated ?? []);
  const reads: Oid[][] = [];
  const downloads: number[] = [];
  const treeOf = (commit: Oid) => {
    const tree = trees.get(commit);
    if (!tree) throw new GitError({ kind: 'notFetched', oid: commit });
    return tree;
  };
  const has = (oid: Oid) => blobs.has(oid) && !lacking.has(oid);
  /** A batch of blobs, read. */
  const out = function* (names: Oid[]) {
    reads.push(names);
    yield names.map((oid) => ({ oid, data: blobs.get(oid) ?? Buffer.alloc(0) }));
  };
  const fileAt = (commit: Oid, path: Uint8Array) => {
    const oid = treeOf(commit).get(Buffer.from(path).toString('utf8'));
    return (
      oid && {
        path: Buffer.from(path),
        oid,
        mode: 'regular' as const,
        size: has(oid) ? blobs.get(oid)?.byteLength : undefined,
      }
    );
  };
  return {
    reads,
    downloads,
    lacking,
    offline: options.offline ?? false,
    async treeId(commit) {
      treeOf(commit);
      return parseOid(createHash('sha1').update(`tree ${commit}`).digest('hex'));
    },
    async tree(commit) {
      return [...treeOf(commit)].map(([path, oid]): TreeEntry => ({
        path: Buffer.from(path, 'utf8'),
        oid,
        mode: 'regular',
        size: has(oid) ? blobs.get(oid)?.byteLength : undefined,
      }));
    },
    async missingObjects(oids) {
      return oids.filter((oid) => !has(oid));
    },
    async download(oids, _what, { maxBytes, received } = {}) {
      if (options.failDownloads) {
        throw new GitError({ kind: 'fetch', what: 'files', failure: 'network', message: 'down' });
      }
      let brought = 0;
      for (const oid of oids) {
        if (!lacking.has(oid)) continue;
        brought += blobs.get(oid)?.byteLength ?? 0;
        if (maxBytes !== undefined && brought > maxBytes) {
          received?.(brought);
          downloads.push(brought);
          throw new GitError({ kind: 'fetch', what: 'files', failure: 'tooLarge', message: 'cap' });
        }
      }
      for (const oid of oids) lacking.delete(oid);
      received?.(brought);
      downloads.push(brought);
      return oids.filter((oid) => !has(oid));
    },
    async objectSizes(oids) {
      return oids.map((oid) => (has(oid) ? blobs.get(oid)?.byteLength : undefined));
    },
    async *readBlobs(oids, { maxBytes }) {
      const wanted = [...new Set(oids)];
      const absent = wanted.filter((oid) => !has(oid));
      if (absent.length > 0) throw new GitError({ kind: 'notDownloaded', oids: absent });
      let batch: Oid[] = [];
      let bytes = 0;
      for (const oid of wanted) {
        const size = blobs.get(oid)?.byteLength ?? 0;
        if (batch.length > 0 && bytes + size > maxBytes) {
          yield* out(batch);
          batch = [];
          bytes = 0;
        }
        batch.push(oid);
        bytes += size;
      }
      if (batch.length > 0) yield* out(batch);
    },
    async downloadAttributes() {
      return [];
    },
    async attribute(_commit, _name, paths) {
      return paths.map((path) =>
        generated.has(Buffer.from(path).toString('utf8')) ? 'set' : 'unspecified',
      );
    },
    async fileVersion(commit, path) {
      return fileAt(commit, path);
    },
    async fileVersions(commit, paths) {
      return paths.map((path) => fileAt(commit, path));
    },
    async readBlob(oid) {
      return has(oid) ? blobs.get(oid) : undefined;
    },
    async downloadFiles(commit, paths) {
      for (const path of paths) {
        const oid = treeOf(commit).get(Buffer.from(path).toString('utf8'));
        if (oid && !options.offline) lacking.delete(oid);
      }
      return [];
    },
  };
}

/** The store in memory, asked as main asks its worker. */
export function memoryStore(now: () => number = Date.now) {
  const store = new Store(':memory:', now);
  return {
    store,
    fresh: async (...args: Parameters<Store['fresh']>) => store.fresh(...args),
    put: async (...args: Parameters<Store['put']>) => store.put(...args),
    setTree: async (...args: Parameters<Store['setTree']>) => store.setTree(...args),
    tree: async (...args: Parameters<Store['tree']>) => store.tree(...args),
    definitions: async (...args: Parameters<Store['definitions']>) => store.definitions(...args),
    referrers: async (...args: Parameters<Store['referrers']>) => store.referrers(...args),
    kept: async (...args: Parameters<Store['kept']>) => store.kept(...args),
    trim: async (...args: Parameters<Store['trim']>) => store.trim(...args),
    clear: async () => store.clear(),
  };
}

/**
 * Reads a text's symbols as a stand-in for tree-sitter's tags: `function`, `class`, `const` and
 * `interface` define the name after them, and every other word is a name it refers to.
 */
export function fakeSymbols(text: string): FileSymbols {
  const definitions: FileSymbols['definitions'] = [];
  const defined = new Set<string>();
  const references = new Set<string>();
  for (const [index, line] of text.split('\n').entries()) {
    for (const match of line.matchAll(/\b(function|class|const|interface)\s+(\w+)/g)) {
      const name = match[2] ?? '';
      const column = (match.index ?? 0) + (match[0].length - name.length);
      definitions.push({
        name,
        kind:
          match[1] === 'class'
            ? 'class'
            : match[1] === 'interface'
              ? 'interface'
              : match[1] === 'const'
                ? 'constant'
                : 'function',
        line: index + 1,
        column,
        lastLine: index + 1,
      });
      defined.add(`${index}:${column}`);
    }
    for (const match of line.matchAll(/\b[A-Za-z_]\w*\b/g)) {
      if (!defined.has(`${index}:${match.index}`)) references.add(match[0]);
    }
  }
  const imports = [...text.matchAll(/^import \{ (\w+) \} from '([^']+)'/gm)].map((match) => ({
    line: text.slice(0, match.index).split('\n').length,
    module: match[2] ?? '',
    names: [{ name: match[1] ?? '' }],
  }));
  return { definitions, references: [...references].toSorted(), imports };
}

/** The background process, standing in: reads what it's sent with {@link fakeSymbols}. */
export function fakeBackground(
  options: { version?: string; fail?: (text: string) => boolean } = {},
) {
  const decoder = new TextDecoder();
  const read: string[] = [];
  const jobs: number[] = [];
  return {
    /** Each text read, in order. */
    read,
    /** How many files each job had. */
    jobs,
    version: options.version ?? 'v1',
    async symbols(files: readonly FileJob[]): Promise<{ version: string; files: Tagged[] }> {
      jobs.push(files.length);
      const texts = files.map((file) => decoder.decode(file.bytes));
      if (texts.some((text) => options.fail?.(text))) {
        throw new IpcError('timeout', 'code.symbols ran past its 60000 ms.');
      }
      read.push(...texts);
      return {
        version: this.version,
        files: texts.map((text) => ({ symbols: fakeSymbols(text) })),
      };
    },
    async find(name: string, files: readonly FileJob[]): Promise<Uses[]> {
      return files.map((file) => {
        const uses: { line: number; column: number }[] = [];
        for (const [index, line] of decoder.decode(file.bytes).split('\n').entries()) {
          for (const match of line.matchAll(new RegExp(`\\b${name}\\b`, 'g'))) {
            uses.push({ line: index + 1, column: match.index ?? 0 });
          }
        }
        return { uses };
      });
    },
  };
}
