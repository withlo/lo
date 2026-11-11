// Files shown whole, in a pull request's tab's whole-file view: which file each tab has open, in
// which version, and what main read of it from the local copy, highlighted in the background as
// the diff's files are. A file is known by the tree's key and, in the views, by the tab's id for
// it, the diff's own, so a place in the tab's history names the same file in the diff and here; a
// path is never a key, since one can be long enough to slow any map keyed by it.

import { splitLines } from '@lo/diff';
import type { Target } from '@lo/ui/commands';
import type { FileView } from '@lo/ui/code';

import { IpcError } from '../../../ipc/contract.ts';
import { tabState } from '../../tab/window/shared.ts';
import { fileKey, type TreePath } from '../../tree/contract.ts';
import type { FileVersions, Version, WholeText } from '../contract.ts';
import { diffJobs, main } from './main.ts';

/** The whole-file view's id among a pull request's tab's middle views. */
export const WHOLE_VIEW = 'diff.whole';

/** The diff's id among them. */
export const DIFF_VIEW = 'diff.view';

/** What opening a file whole asks of its view: where its cursor goes, and whether focus does. */
export interface Ask {
  readonly at: Target | undefined;
  readonly focus: boolean;
  /** Counts the asks, so the view answers each once. */
  readonly count: number;
}

/** A file a tab has open whole. */
export interface Opened {
  /** Its key, as the tree names it. */
  readonly key: string;
  /** Its id in the tab's views: the diff's for it, if the pull request changes it. */
  readonly id: string;
  readonly version: Version;
  readonly ask: Ask;
}

/** The file each tab has open whole, if any. */
export const opened = tabState<Opened | undefined>(() => undefined);

/** What a whole file shows: its lines, or a note in their place, or that it's being read. */
export type Content =
  | { readonly kind: 'reading' }
  | {
      readonly kind: 'text';
      readonly lines: readonly string[];
      /** `@lo/syntax`'s triples over its lines joined with `\n`, once they're worked out. */
      readonly tokens: Uint32Array | undefined;
    }
  | { readonly kind: 'failed'; readonly why: string }
  | Exclude<WholeText, { kind: 'text' }>;

/** What was read of a tab's file: which file, at which head, and what came. */
export interface Read {
  readonly key: string;
  readonly version: Version;
  /** The head on screen it's read at. */
  readonly at: string;
  /** Whether it was asked for past the size Lo loads at once. */
  readonly large: boolean;
  readonly content: Content;
}

/** What each tab last read for its file. */
export const reads = tabState<Read | undefined>(() => undefined);

/** The whole-file view drawn in each tab while it's on screen: its code view, once it has one. */
const drawn = new Map<string, () => FileView | undefined>();

/**
 * Records that tab `tab`'s whole-file view is on screen, its code view from `view`. Returns a
 * function that forgets it, as it goes.
 */
export function setWholeDrawn(tab: string, view: () => FileView | undefined): () => void {
  drawn.set(tab, view);
  return () => {
    if (drawn.get(tab) === view) drawn.delete(tab);
  };
}

/**
 * Tab `tab`'s whole-file view, if it's on screen: its code view, if it shows code, through
 * `view`.
 */
export function wholeDrawn(tab: string): { view(): FileView | undefined } | undefined {
  const view = drawn.get(tab);
  return view && { view };
}

/** The changed file `key` names among `files`, the diff's, if the pull request changes it. */
export function changedIn(
  files: readonly FileVersions[] | null | undefined,
  key: string,
): FileVersions | undefined {
  return files?.find((file) => fileKey(file.path) === key);
}

/**
 * The version of a file to show when `asked` is: a file the pull request adds has no base, and one
 * it deletes has no head, nor does a file it leaves alone have a version of its own in the base.
 */
export function versionOf(change: FileVersions | undefined, asked: Version): Version {
  if (change === undefined || change.change === 'added') return 'new';
  if (change.change === 'deleted') return 'old';
  return asked;
}

/**
 * The path of `version` of a file: a changed file's in the head, or for `old` where it was in the
 * base; any other file's as the tree has it.
 */
export function pathIn(
  change: FileVersions | undefined,
  version: Version,
  inTree: () => TreePath,
): TreePath {
  if (change === undefined) return inTree();
  return version === 'old' ? (change.previous ?? change.path) : change.path;
}

/** Whether `read` is of `file` at the head `at`. */
export function readOf(
  read: Read | undefined,
  file: { key: string; version: Version },
  at: string,
): read is Read {
  return read?.key === file.key && read.version === file.version && read.at === at;
}

/** What reading a whole file asks of main and the background process. */
export interface WholeWork {
  whole(input: {
    at: string;
    version: Version;
    path: TreePath;
    large: boolean;
  }): Promise<WholeText>;
  /** `@lo/syntax`'s triples over `text` as the file at `path` is highlighted, if it can be. */
  highlight(path: string, text: string): Promise<Uint32Array | undefined>;
  log(message: string, error: unknown): void;
}

/**
 * Reads `file` whole for tab `tab`, at the head on screen, `at`, past the size Lo loads at once if
 * `large` says, and keeps what comes in {@link reads}: its lines first, then their highlighting.
 * A newer read for the tab drops what an older one brings.
 */
export function readWhole(
  tab: string,
  file: { key: string; version: Version; path: TreePath },
  at: string,
  large: boolean,
  work: WholeWork,
): void {
  const read: Read = {
    key: file.key,
    version: file.version,
    at,
    large,
    content: { kind: 'reading' },
  };
  reads.set(tab, read);
  work
    .whole({ at, version: file.version, path: file.path, large })
    .then(
      async (text) => {
        if (reads.get(tab) !== read) return;
        if (text.kind !== 'text') {
          reads.set(tab, { ...read, content: text });
          return;
        }
        const lines = splitLines(text.text);
        const shown: Read = { ...read, content: { kind: 'text', lines, tokens: undefined } };
        reads.set(tab, shown);
        if (lines.length === 0) return;
        // As the view holds the lines: joined with `\n`, whatever ended them.
        const tokens = await work.highlight(file.path.text, lines.join('\n'));
        const now = reads.get(tab);
        if (now !== shown || tokens === undefined || now.content.kind !== 'text') return;
        reads.set(tab, { ...now, content: { ...now.content, tokens } });
      },
      (error: unknown) => {
        if (reads.get(tab) !== read) return;
        // Main's own words for what it refused; anything else is logged, and said plainly.
        if (!(error instanceof IpcError)) work.log('Lo couldn’t read a file whole:', error);
        const why = error instanceof IpcError ? error.message : 'Lo couldn’t read it.';
        reads.set(tab, { ...read, content: { kind: 'failed', why } });
      },
    )
    .catch((error: unknown) => work.log('Lo couldn’t highlight a file:', error));
}

/** What reading tab `tab`'s whole files asks of main and the background process. */
export function wholeWork(tab: string): WholeWork {
  return {
    whole: (input) => main().whole({ id: tab, ...input }),
    async highlight(path, text) {
      const [tokens] = await diffJobs().highlight({ files: [{ path, old: null, new: text }] });
      return tokens?.new;
    },
    log: (message, error) => console.error(message, error),
  };
}
