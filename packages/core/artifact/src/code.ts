/**
 * The code an overview's targets name, checked at the commit its header names: each file is
 * there, is a file, is text, and has the lines named. Each file is read in the order the overview
 * first names it: its first 8 KiB, then the rest only when it's text and not too large, and at most
 * {@link LIMITS.code} bytes of files in all. So which targets resolve never depends on how fast
 * the reader is. A reader that fails, or is too slow, leaves its code unread, and never keeps the
 * check waiting.
 */

import { article } from './commit.ts';
import { quote, type Findings } from './findings.ts';
import { BINARY_WINDOW, LIMITS } from './limits.ts';
import { checkedAnswer, type CodeReader, type EntryKind, type FileAnswer } from './readers.ts';
import type { CodeReference } from './reading.ts';

/**
 * What a target's code is at the overview's commit.
 *
 * - `resolved`: it's there to show.
 * - `broken`: it isn't, and why: the commit is gone, nothing is at the path, the path is a link,
 *   folder or submodule, the file isn't text, the lines are past its end, or it's too large.
 * - `unread`: the reader failed, or was stopped, before it answered.
 */
export type CodeState =
  | { state: 'resolved' }
  | { state: 'broken'; why: 'commit' | 'missing' | 'notFile' | 'binary' | 'lines' | 'tooLarge' }
  | { state: 'unread'; why: 'failed' | 'stopped' };

/** A place the overview points at code, and what's there. */
export interface CheckedCode {
  reference: CodeReference;
  code: CodeState;
}

/** What reading a file found, kept for the targets that name it: never its bytes. */
type Found =
  | { kind: 'there' }
  | { kind: 'text'; lines: number }
  | { kind: 'binary' }
  | { kind: 'tooLarge'; past: 'file' | 'code' }
  | { kind: 'missing' }
  | { kind: 'notFile'; is: Exclude<EntryKind, 'file'> }
  | { kind: 'noCommit' }
  | Unread;

type Unread = { kind: 'unread'; why: 'failed' | 'stopped' };

/**
 * Checks the code each of `references` names at `commit`, through `readCode`, adding what's wrong
 * to `findings`. Once `signal` aborts, what isn't read yet is left unread.
 */
export async function checkCode(
  references: readonly CodeReference[],
  commit: string,
  readCode: CodeReader,
  findings: Findings,
  signal: AbortSignal,
): Promise<CheckedCode[]> {
  // Each file once, in the order of the lines first naming it, with whether lines are named in it.
  const paths = new Map<string, { lines: boolean }>();
  for (const { target } of references) {
    const known = paths.get(target.path);
    if (known) known.lines ||= target.lines !== undefined;
    else paths.set(target.path, { lines: target.lines !== undefined });
  }

  const read = (path: string, cap: number): Promise<FileAnswer | Unread> =>
    answered(() => readCode(commit, path, cap, signal), cap, signal);
  const found = new Map<string, Found>();
  let used = 0;
  let gone = false;
  for (const [path, { lines }] of paths) {
    if (gone) {
      found.set(path, { kind: 'noCommit' });
      continue;
    }
    const file = lines
      ? await readLines(read, path, LIMITS.code - used)
      : { found: there(await read(path, 0)), size: 0 };
    used += file.size;
    if (file.found.kind === 'noCommit') gone = true;
    found.set(path, file.found);
  }

  if (gone) {
    findings.add(
      'code-commit',
      undefined,
      `The repository doesn't have commit ${commit}, the one the header names, so its code can't be shown.`,
    );
  }
  return references.map((reference) => {
    const file = found.get(reference.target.path) ?? { kind: 'unread', why: 'stopped' };
    const code = stateOf(reference, file);
    if (code.state === 'broken') report(findings, reference, file);
    return { reference, code };
  });
}

/** What reading a file named whole found: only whether it's there. */
function there(answer: FileAnswer | Unread): Found {
  return answer.kind === 'file' ? { kind: 'there' } : answer;
}

/**
 * Reads the file at `path` for its lines, with `room` bytes left to read, and how many bytes that
 * takes. Its first 8 KiB come first, so a file that's binary or too large is read no further.
 */
async function readLines(
  read: (path: string, cap: number) => Promise<FileAnswer | Unread>,
  path: string,
  room: number,
): Promise<{ found: Found; size: number }> {
  const head = await read(path, Math.min(BINARY_WINDOW, room));
  if (head.kind !== 'file') return { found: head, size: 0 };
  const taken = head.bytes.length;
  if (head.bytes.includes(0)) return { found: { kind: 'binary' }, size: taken };
  if (head.size > LIMITS.file) return { found: { kind: 'tooLarge', past: 'file' }, size: taken };
  if (head.size > room) return { found: { kind: 'tooLarge', past: 'code' }, size: taken };
  if (taken === head.size) return { found: text(head.bytes), size: taken };
  const whole = await read(path, head.size);
  if (whole.kind !== 'file' || whole.size !== head.size) {
    // The same file at the same commit, answered differently.
    return {
      found: whole.kind === 'unread' ? whole : { kind: 'unread', why: 'failed' },
      size: taken,
    };
  }
  return { found: text(whole.bytes), size: head.size };
}

function text(bytes: Uint8Array): Found {
  return { kind: 'text', lines: lineCount(bytes) };
}

/**
 * What `read()` answers, held to `cap`; or, when it throws, fails, gives something that isn't an
 * answer or hasn't answered when `signal` aborts, why it's unread.
 */
async function answered(
  read: () => Promise<unknown>,
  cap: number,
  signal: AbortSignal,
): Promise<FileAnswer | Unread> {
  if (signal.aborted) return { kind: 'unread', why: 'stopped' };
  return new Promise((resolve) => {
    const stop = (): void => resolve({ kind: 'unread', why: 'stopped' });
    signal.addEventListener('abort', stop, { once: true });
    const settle = (answer: FileAnswer | undefined): void => {
      signal.removeEventListener('abort', stop);
      resolve(answer ?? { kind: 'unread', why: 'failed' });
    };
    let reading: Promise<unknown>;
    try {
      reading = Promise.resolve(read());
    } catch {
      settle(undefined);
      return;
    }
    reading.then(
      (value: unknown) => settle(checkedAnswer(value, cap)),
      () => settle(undefined),
    );
  });
}

/** How many lines `bytes` holds: each ends at a newline, and the last may end without one. */
export function lineCount(bytes: Uint8Array): number {
  let lines = 0;
  for (let at = bytes.indexOf(0x0a); at !== -1; at = bytes.indexOf(0x0a, at + 1)) lines += 1;
  return bytes.length > 0 && bytes.at(-1) !== 0x0a ? lines + 1 : lines;
}

function stateOf(reference: CodeReference, found: Found): CodeState {
  // A file named whole only has to be there.
  const { lines } = reference.target;
  const whole = lines === undefined;
  switch (found.kind) {
    case 'there':
      return { state: 'resolved' };
    case 'text':
      return lines === undefined || lines.end <= found.lines
        ? { state: 'resolved' }
        : { state: 'broken', why: 'lines' };
    case 'binary':
      return whole ? { state: 'resolved' } : { state: 'broken', why: 'binary' };
    case 'tooLarge':
      return whole ? { state: 'resolved' } : { state: 'broken', why: 'tooLarge' };
    case 'missing':
      return { state: 'broken', why: 'missing' };
    case 'notFile':
      return { state: 'broken', why: 'notFile' };
    case 'noCommit':
      return { state: 'broken', why: 'commit' };
    case 'unread':
      return { state: 'unread', why: found.why };
    default:
      found satisfies never;
      throw new Error(`Unknown file ${JSON.stringify(found)}`);
  }
}

/** Adds the finding for `reference`, whose code is broken as `found` says. */
function report(findings: Findings, reference: CodeReference, found: Found): void {
  const { line, target } = reference;
  const path = quote(target.path);
  switch (found.kind) {
    case 'there':
    case 'noCommit':
    case 'unread':
      // Nothing's wrong with a file that's there; the commit is said to be gone once, for every
      // target; and code unread isn't the overview's doing.
      return;
    case 'missing':
      findings.add(
        'code-missing',
        line,
        `${path} isn't at the header's commit. A path names a file exactly, in the same case.`,
      );
      return;
    case 'notFile':
      findings.add('code-not-file', line, `${path} is ${article(found.is)}, not a file.`);
      return;
    case 'binary':
      findings.add('code-binary', line, `${path} isn't text, so it has no lines to show.`);
      return;
    case 'text': {
      const has =
        found.lines === 0
          ? 'has no lines'
          : `has ${found.lines.toLocaleString('en-US')} line${found.lines === 1 ? '' : 's'}`;
      findings.add('code-lines', line, `${path} ${has}, so ${range(reference)}.`);
      return;
    }
    case 'tooLarge':
      findings.add(
        'code-too-large',
        line,
        found.past === 'code'
          ? `Lo reads at most ${mebibytes(LIMITS.code)} of code for an overview, and the files named before ${path} take that up. Name fewer large files.`
          : `${path} is larger than ${mebibytes(LIMITS.file)}, the most Lo reads of a file to show its lines.`,
      );
      return;
    default:
      found satisfies never;
      throw new Error(`Unknown file ${JSON.stringify(found)}`);
  }
}

/** What isn't there of the lines `reference` names, in words. */
function range(reference: CodeReference): string {
  const { lines } = reference.target;
  if (!lines || lines.start === lines.end) return `line ${lines?.start ?? 0} isn't there`;
  return `lines ${lines.start} to ${lines.end} aren't all there`;
}

function mebibytes(bytes: number): string {
  return `${bytes / (1024 * 1024)} MiB`;
}
