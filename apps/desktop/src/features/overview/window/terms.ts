// Each pull request's tab's repository's definitions in the window: what main last said of them
// and, once main has read a `terms.json`, the file read in the background process, once for each
// file whichever tabs show it, and kept for the few read last. While a newer file is read, the
// terms read before stay, so nothing a tab shows goes blank between them.

import type { StoreProblem } from '@lo/artifact';

import { IpcError } from '../../../ipc/contract.ts';
import { tabState } from '../../tab/window/shared.ts';
import type { Problem, StoreState } from '../contract.ts';
import type { StoredTerm, StoreRead } from '../jobs.ts';
import { main, overviewJobs } from './main.ts';

/** A repository's definitions, read. */
export interface Terms {
  /** The format `terms.json` is in. */
  readonly format: number;
  /** Each term, by its key, in the order `terms.json` holds them. */
  readonly terms: ReadonlyMap<string, StoredTerm>;
  /** Each name a term goes by, its own and its aliases', as keys, to its term's key. */
  readonly names: ReadonlyMap<string, string>;
}

/** The term `key`, a term's key or an alias's, names in `terms`, if any. */
export function storedTerm(terms: Terms, key: string): StoredTerm | undefined {
  const owner = terms.names.get(key);
  return owner === undefined ? undefined : terms.terms.get(owner);
}

/** A repository, by its owner and name. */
export interface RepoName {
  readonly owner: string;
  readonly name: string;
}

/**
 * Why a repository's definitions can't be used:
 *
 * - `tooMany`, `tooLarge`: they're past their limits on terms or on size;
 * - `invalid`: `terms.json` isn't what the store holds, as `problem` says;
 * - `notStore`: `refs/lo/terms` holds no `terms.json` Lo reads: it holds something other than a
 *   commit, or a commit with no `terms.json`, or something other than a file there;
 * - `problem`: main couldn't read them from GitHub, and has nothing kept;
 * - `failed`: the background process couldn't read the file, for `code`, its failure's: `timeout`,
 *   `memory`, `restarted` or another.
 */
export type StoreFailure =
  | { kind: 'tooMany' }
  | { kind: 'tooLarge' }
  | { kind: 'invalid'; problem: StoreProblem }
  | { kind: 'notStore'; why: 'notCommit' | 'missing' | 'notFile' }
  | { kind: 'problem'; problem: Problem }
  | { kind: 'failed'; code: string };

/**
 * A pull request's tab's repository's definitions, as far as the window knows:
 *
 * - `reading`: main hasn't said what they are yet, or they're being read for the first time;
 * - `none`: the repository has none;
 * - `read`: read, as kept from an earlier read (`saved`) or as GitHub last said, at `checkedAt`;
 * - `unreadable`: they can't be used, and why: each overview shows its own definitions.
 *
 * `problem`, beside what's known, says why main's last read failed, as when Lo is offline.
 */
export type RepoTerms =
  | { kind: 'reading' }
  | { kind: 'none'; repository: RepoName; problem: Problem | null }
  | {
      kind: 'read';
      repository: RepoName;
      terms: Terms;
      saved: boolean;
      checkedAt: number | null;
      problem: Problem | null;
    }
  | { kind: 'unreadable'; repository: RepoName; why: StoreFailure };

/** Each tab's repository's definitions. */
export const terms = tabState<RepoTerms>(() => ({ kind: 'reading' }));

/** What main last said of each tab's repository's definitions: none until it has. */
export const storeStates = tabState<StoreState | undefined>(() => undefined);

/** The tabs main has spoken of, open ones, whose definitions turning overviews off forgets. */
const known = new Set<string>();

/** A file read, by its ID: what it gave, once it has. */
interface Reading {
  readonly promise: Promise<FileRead>;
  value: FileRead | undefined;
}

/** What reading a file gave: its terms, or why the store can't be used. */
type FileRead = { ok: true; terms: Terms } | { ok: false; why: StoreFailure };

/** The most files kept read: a window rarely shows more repositories at once. */
const KEPT_READS = 8;

const reads = new Map<string, Reading>();

/** What the window reads a file with: main and the background process, unless a test says. */
export interface TermsReads {
  file(input: { id: string; file: string }): Promise<Uint8Array>;
  read(bytes: Uint8Array): Promise<StoreRead>;
}

let reading: TermsReads = {
  file: (input) => main().storeFile(input),
  read: (bytes) => overviewJobs().store({ bytes }),
};

/** Reads files with `using` from now on, as a test does. Returns a function that puts it back. */
export function readTermsWith(using: TermsReads): () => void {
  const before = reading;
  reading = using;
  reads.clear();
  return () => {
    reading = before;
    reads.clear();
  };
}

/** Whether the window takes what main says of them: not while Settings turns overviews off. */
let taking = true;

/** Takes what main says of a tab's repository's definitions. */
export function takeStore(state: StoreState): void {
  if (!taking) return;
  known.add(state.id);
  storeStates.set(state.id, state);
  settle(state);
}

/**
 * Reads tab `tab`'s repository's definitions again, after they couldn't be: main reads them from
 * GitHub again, or the background process reads the file again. Settles once that's done.
 */
export async function readTermsAgain(tab: string): Promise<void> {
  const state = storeStates.get(tab);
  const now = terms.get(tab);
  if (!state || now.kind !== 'unreadable') return;
  if (now.why.kind === 'problem') {
    await main().retryStore({ id: tab });
    return;
  }
  if (now.why.kind === 'failed' && state.found.kind === 'file') {
    reads.delete(state.found.id);
    settle(state);
    await reads.get(state.found.id)?.promise;
  }
}

/** Tab `state.id`'s definitions, from what main said of them. */
function settle(state: StoreState): void {
  const { id, found, problem } = state;
  const repository = { owner: state.repository.owner, name: state.repository.name };
  switch (found.kind) {
    case 'unknown':
      terms.set(
        id,
        problem ? { kind: 'unreadable', repository, why: { kind: 'problem', problem } } : READING,
      );
      return;
    case 'none':
      terms.set(id, { kind: 'none', repository, problem });
      return;
    case 'unreadable':
      terms.set(id, {
        kind: 'unreadable',
        repository,
        why: found.why === 'tooLarge' ? { kind: 'tooLarge' } : { kind: 'notStore', why: found.why },
      });
      return;
    case 'file':
      break;
    default:
      found satisfies never;
      terms.set(id, READING);
      return;
  }
  const take = (read: FileRead) => {
    // A newer word from main takes its own.
    if (storeStates.get(id) !== state) return;
    terms.set(
      id,
      read.ok
        ? {
            kind: 'read',
            repository,
            terms: read.terms,
            saved: state.saved,
            checkedAt: state.checkedAt,
            problem,
          }
        : { kind: 'unreadable', repository, why: read.why },
    );
  };
  const file = readFile(id, found.id);
  if (file.value) {
    take(file.value);
    return;
  }
  // The terms read before stay while the newer ones are read, unless they're another
  // repository's.
  const before = terms.get(id);
  if (
    before.kind !== 'read' ||
    before.repository.owner.toLowerCase() !== repository.owner.toLowerCase() ||
    before.repository.name.toLowerCase() !== repository.name.toLowerCase()
  ) {
    terms.set(id, READING);
  }
  void file.promise.then(take);
}

const READING: RepoTerms = { kind: 'reading' };

/** The file `file` read, through tab `tab`, once for every tab that asks for it. */
function readFile(tab: string, file: string): Reading {
  const kept = reads.get(file);
  if (kept) {
    // The latest read is kept the longest.
    reads.delete(file);
    reads.set(file, kept);
    return kept;
  }
  const entry: Reading = {
    value: undefined,
    promise: readNow(tab, file).then(
      (value) => {
        entry.value = value;
        return value;
      },
      (error: unknown) => {
        // Main has another file by now, which it says: nothing to keep.
        if (reads.get(file) === entry) reads.delete(file);
        if (!(error instanceof IpcError && error.code === 'moved')) {
          console.error('Lo couldn’t read the repository’s definitions:', error);
        }
        const code = error instanceof IpcError ? error.code : 'failed';
        const value: FileRead = { ok: false, why: { kind: 'failed', code } };
        return value;
      },
    ),
  };
  reads.set(file, entry);
  for (const key of reads.keys()) {
    if (reads.size <= KEPT_READS) break;
    reads.delete(key);
  }
  return entry;
}

async function readNow(tab: string, file: string): Promise<FileRead> {
  const bytes = await reading.file({ id: tab, file });
  const read = await reading.read(bytes);
  if (!read.ok) return { ok: false, why: failureOf(read.problem) };
  return {
    ok: true,
    terms: {
      format: read.format,
      terms: new Map(read.terms.map((term) => [term.key, term])),
      names: new Map(read.names),
    },
  };
}

/** Why the store can't be used, from what reading it found. */
export function failureOf(problem: StoreProblem): StoreFailure {
  switch (problem.code) {
    case 'too-many':
      return { kind: 'tooMany' };
    case 'too-large':
      return { kind: 'tooLarge' };
    case 'unreadable':
    case 'too-long':
    case 'encoding':
    case 'syntax':
    case 'format':
    case 'format-newer':
    case 'shape':
    case 'key':
    case 'key-twice':
    case 'name-twice':
      return { kind: 'invalid', problem };
    default:
      // From the background process: a code Lo doesn't know is still a store it can't use.
      problem.code satisfies never;
      return { kind: 'invalid', problem };
  }
}

/**
 * Takes what main says of the definitions again as Settings turns overviews on, or as it turns them
 * off, forgets every tab's, and takes nothing more until they're on.
 */
export function takeTerms(on: boolean): void {
  taking = on;
  if (on) return;
  for (const id of known) {
    storeStates.set(id, undefined);
    terms.set(id, READING);
  }
  known.clear();
  reads.clear();
}

/**
 * Asks main for the definitions of each of `ids`, once, for a tab main spoke of before the window
 * listened: what main says meanwhile comes first.
 */
export function catchUpTerms(ids: readonly string[]): void {
  for (const id of ids) {
    if (storeStates.get(id) !== undefined) continue;
    main()
      .currentStore({ id })
      .then((state) => {
        if (state && storeStates.get(id) === undefined) takeStore(state);
      })
      .catch((error: unknown) =>
        console.error("Lo couldn't ask about a tab's definitions:", error),
      );
  }
}

/** Forgets the tabs that closed, those not in `open`, whose definitions go with them. */
export function keepTermsOnly(open: ReadonlySet<string>): void {
  for (const id of known) if (!open.has(id)) known.delete(id);
}
