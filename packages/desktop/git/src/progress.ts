/**
 * Progress of a fetch, read from git's progress output, so the app can show the first copy of a
 * big repository coming in, and what a slow fetch waits on.
 */

/** One update from git, such as "Receiving objects: 45% (555/1234)". */
export interface Progress {
  /**
   * What git is doing, in its words: "Counting objects", "Receiving objects", "Resolving
   * deltas"… git prefixes the ones GitHub does with `remote: `, and this doesn't.
   */
  readonly stage: string;
  /** How many items are done. */
  readonly done: number;
  /** How many there are, when git knows. */
  readonly total?: number | undefined;
}

/** How far through the stage git is, from 0 to 100, when it knows the total. */
export function percent(progress: Progress): number | undefined {
  const { done, total } = progress;
  if (total === undefined || total <= 0) return undefined;
  // In whole numbers, so no count a line claims rounds up to the next percent.
  return Number((BigInt(Math.min(done, total)) * 100n) / BigInt(total));
}

/**
 * The stage and how far through it git is, as Lo writes it: "receiving objects, 44% of 1234", or
 * "enumerating objects, 12" when git doesn't know how many there are.
 */
export function describeProgress(progress: Progress): string {
  const stage = progress.stage.toLowerCase();
  const shown = percent(progress);
  if (shown !== undefined && progress.total !== undefined) {
    return `${stage}, ${shown}% of ${progress.total}`;
  }
  return `${stage}, ${progress.done}`;
}

/**
 * What a fetch is doing, or waiting on, for the app to show while it runs, so a slow one never
 * looks stuck. A fetch reports one as it changes, and again every second while it waits. Times
 * are in milliseconds.
 */
export type Activity =
  /**
   * Waiting for whatever writes to the repository's copy to finish, since one thing writes to it
   * at a time: another fetch, a repack or a checkout. `holder` says what, when it said.
   */
  | { kind: 'waitingForLock'; holder?: string | undefined; waited: number }
  /** git is connecting to GitHub, which hasn't answered yet. */
  | { kind: 'connecting'; elapsed: number }
  /**
   * GitHub answered, and is working out what to send and preparing it. `progress` is the last it
   * said of that, if anything, such as "Counting objects".
   */
  | { kind: 'preparing'; elapsed: number; progress?: Progress | undefined }
  /** The objects are coming in, or git is going through them: "Receiving objects", "Resolving deltas". */
  | { kind: 'transferring'; elapsed: number; progress: Progress };

/**
 * Who wrote a progress line: GitHub, preparing what to send, whose lines git prefixes with
 * `remote: `, or git itself, receiving and indexing what GitHub sends.
 */
export type ProgressSource = 'remote' | 'local';

/**
 * Parses one line of git's progress output, such as `remote: Counting objects:  25% (1/4)` or
 * `Receiving objects:  45% (555/1234), 1.20 MiB | 2.40 MiB/s`, and says who wrote it. Other lines
 * give `undefined`.
 */
export function parseProgressLine(
  line: string,
): { source: ProgressSource; progress: Progress } | undefined {
  let rest = line.trim();
  let source: ProgressSource = 'local';
  if (rest.startsWith('remote:')) {
    source = 'remote';
    rest = rest.slice('remote:'.length).trimStart();
  }
  const colon = rest.indexOf(': ');
  if (colon === -1) return undefined;
  const stage = rest.slice(0, colon);
  const counts = rest.slice(colon + 2).trimStart();
  let done: number | undefined;
  let total: number | undefined;
  const open = counts.indexOf('(');
  if (open !== -1) {
    // "45% (555/1234), 1.20 MiB | 2.40 MiB/s"
    const close = counts.indexOf(')', open);
    if (close === -1) return undefined;
    const [left, right, ...more] = counts.slice(open + 1, close).split('/');
    if (more.length > 0) return undefined;
    done = count(left);
    total = count(right);
    if (total === undefined) return undefined;
  } else {
    // "4, done." or "4"
    done = count(counts.split(/[, ]/)[0]);
  }
  if (done === undefined || !/^[A-Za-z ]+$/.test(stage)) return undefined;
  return { source, progress: { stage, done, total } };
}

/** A count git wrote, if it's a whole number a JavaScript number holds exactly. */
function count(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d+$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}
