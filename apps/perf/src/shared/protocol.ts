// What main, the background process and the window send each other.

import type { FileChanges, FileDiff, MovedBlock } from '@lo/diff';

/** Files over this many changed lines stay out of the documents until they're loaded. */
export const largeFile = 5000;

/** A changed file, as main reads it from the cache. */
export interface PullFile {
  path: string;
  previousPath?: string | undefined;
  status: string;
  /** Lines added and removed, as GitHub counts them. */
  additions: number;
  deletions: number;
  /** Each version's text, or none for a side the file isn't on, or for a file not shown. */
  old?: string | undefined;
  new?: string | undefined;
  /** Why the file isn't shown as a diff. */
  skipped?: 'too-large' | 'binary' | undefined;
  /**
   * Lines GitHub's diff leaves out, which the page shows as placeholders until the whole file
   * comes, as the local copy brings it.
   */
  gaps?: { side: 'old' | 'new'; from: number; to: number }[] | undefined;
}

/** A review thread, on a file's line on one side, with each comment's length. */
export interface PullThread {
  file: number;
  side: 'old' | 'new';
  line: number;
  comments: number[];
}

/** A pull request, as the window shows it. */
export interface Pull {
  name: string;
  repo: string;
  number: number;
  files: PullFile[];
  threads: PullThread[];
  /** How long after its diff a file with gaps gets its whole lines, in ms. */
  copyAfterMs?: number | undefined;
}

/** What main sends the window when it asks for the pull request. */
export interface PullReply {
  pull: Pull;
  /** The nonce the content security policy lets CodeMirror's style elements use. */
  nonce: string;
}

/** A file to diff and highlight, as main sends it to the background process. */
export interface Job {
  index: number;
  path: string;
  previousPath?: string | undefined;
  old?: string | undefined;
  new?: string | undefined;
}

/** A large file's text, as main gives it to the window when it's loaded. */
export interface Loaded {
  old?: string | undefined;
  new?: string | undefined;
}

/** A file main sends the background process after the work, when the window loads it. */
export interface LaterJob {
  type: 'job';
  job: Job;
}

/** What main sends the background process, with the port to the window. */
export interface Work {
  jobs: Job[];
  /** How many files the pull request has, so moves can name files by their index. */
  files: number;
  /** The syntax package's folder, which holds the grammars and queries. */
  syntaxFolder: string;
  /** The worker threads' built entry. */
  workerEntry: string;
}

/** A worker's answer for one file. */
export interface Done {
  index: number;
  diff: FileDiff;
  changes: FileChanges;
  tokens: { old?: Uint32Array | undefined; new?: Uint32Array | undefined };
  /** How long the diff took, and the highlighting, in milliseconds. */
  diffMs: number;
  highlightMs: number;
  /** Whether the worker's highlighter can't go on, so the worker should be replaced. */
  replace: boolean;
}

/** What the background process sends the window. */
export type Result =
  | {
      type: 'file';
      index: number;
      diff: FileDiff;
      tokens: Done['tokens'];
      diffMs: number;
      highlightMs: number;
    }
  | { type: 'moves'; moves: MovedBlock[]; ms: number }
  /** Every diff and the moves are done, `ms` after the background process got the work. */
  | { type: 'done'; ms: number };
