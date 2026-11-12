// What an overview's code blocks and walkthrough steps show, from how its check left the code they
// point at and what main read of it: the code itself, which each reads when it comes near the
// screen; or what it says in the code's place, and what the reader can do about it. Plain
// functions, each tested alone.

import { LIMITS, type CheckedCode, type CodeRange, type CodeState } from '@lo/artifact';
import { splitLines, type FileDiff } from '@lo/diff';

import type { DiffedText } from '../../diff/window/shared.ts';
import type { BlockText } from '../contract.ts';
import type { CodeRead, CodeSeen } from './checking.ts';
import { shortId } from './says.ts';

/** How the check left a block's code, and what main answered for its file, if it read it. */
export interface Target {
  readonly code: CodeState;
  readonly answer: CodeSeen | undefined;
}

/** What the check couldn't say of a block's code: it wasn't among what the check read. */
const UNCHECKED: CodeState = { state: 'unread', why: 'failed' };

/** A target's key: its lines and its path, which no target names longer than `LIMITS.argument`. */
function keyOf({ path, lines }: CodeRange): string {
  return `${lines.start}-${lines.end}:${path}`;
}

/**
 * How each block's code stands, from the check's `code`, one for each place the overview points
 * at code, and what main read, `read`. Every place that names the same lines of the same file
 * stands the same, so a block finds its own by what it names.
 */
export function targetsOf(
  code: readonly CheckedCode[],
  read: CodeRead,
): (target: CodeRange) => Target {
  const states = new Map<string, CodeState>();
  for (const { reference, code: state } of code) {
    const { target } = reference;
    if (target.lines) states.set(keyOf({ ...target, lines: target.lines }), state);
  }
  const answers = new Map<string, CodeSeen>();
  if (read.kind === 'read') {
    for (const { path, answer } of read.files) if (!answers.has(path)) answers.set(path, answer);
  }
  return (target) => ({
    code: states.get(keyOf(target)) ?? UNCHECKED,
    answer: answers.get(target.path),
  });
}

/** Part of what a block says: words, or a path set as code. */
export type Words = readonly (string | { readonly code: string })[];

/**
 * What a block shows:
 *
 * - `code`: the code, read from the local copy;
 * - `note`: what it says in its place, in a frame for its variant, with what the reader can do:
 *   find a file of the name it gave (`find`), or open the file at the newest revision Lo has
 *   (`latest`).
 */
export type Shows =
  | { readonly kind: 'code' }
  | {
      readonly kind: 'note';
      readonly variant: 'code' | 'unresolved' | 'missing';
      readonly title: string;
      readonly words: Words;
      readonly action?:
        { readonly kind: 'find'; readonly name: string } | { readonly kind: 'latest' };
    };

/** What a file is, in words, when it isn't a file. */
function notAFile(answer: CodeSeen | undefined): string {
  if (answer?.kind !== 'notFile') return 'something other than a file';
  switch (answer.is) {
    case 'folder':
      return 'a folder';
    case 'link':
      return 'a symbolic link';
    case 'submodule':
      return 'a submodule';
    default:
      answer.is satisfies never;
      return 'something other than a file';
  }
}

/** A range of lines in words: `line 12`, or `lines 12–44`. */
function linesWords({ start, end }: CodeRange['lines']): string {
  return start === end ? `line ${start}` : `lines ${start}–${end}`;
}

/** The file's name, past its last `/`. */
export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * What a block pointing at `target` shows, as its check left it (`found`) and as far as the code
 * was read (`read`), at `commit`, the commit the overview describes.
 */
export function showsOf(target: CodeRange, found: Target, read: CodeRead, commit: string): Shows {
  const { code, answer } = found;
  const at = shortId(commit);
  const path = { code: target.path };
  switch (code.state) {
    case 'resolved':
      return { kind: 'code' };
    case 'unread':
      return unreadShows(read, answer, code.why);
    case 'broken': {
      const { why } = code;
      switch (why) {
        case 'missing':
          return {
            kind: 'note',
            variant: 'unresolved',
            title: 'This reference doesn’t resolve.',
            words: [
              'There’s no ',
              path,
              ` at ${at}, so Lo can’t show the code it names. It may have been renamed, or never pushed.`,
            ],
            action: { kind: 'find', name: nameOf(target.path) },
          };
        case 'lines':
          return {
            kind: 'note',
            variant: 'unresolved',
            title: 'This reference doesn’t resolve.',
            words: [path, ` at ${at} has no ${linesWords(target.lines)}, so Lo can’t show them.`],
          };
        case 'notFile':
          return {
            kind: 'note',
            variant: 'unresolved',
            title: 'This reference doesn’t resolve.',
            words: [path, ` at ${at} is ${notAFile(answer)}, so it has no lines to show.`],
          };
        case 'binary':
          return {
            kind: 'note',
            variant: 'unresolved',
            title: 'This code isn’t text.',
            words: [path, ` at ${at} isn’t text, so it has no lines to show.`],
          };
        case 'tooLarge':
          return {
            kind: 'note',
            variant: 'unresolved',
            title: 'This file is too large to show.',
            words: [
              path,
              ` at ${at} is larger than ${LIMITS.file / 2 ** 20} MB, the most Lo reads of a file to show its lines.`,
            ],
          };
        case 'commit':
          return {
            kind: 'note',
            variant: 'missing',
            title: 'The commit this overview describes is gone.',
            words: [
              `GitHub no longer has ${at}, so Lo can’t show the code it had. The file may still be in the pull request.`,
            ],
            action: { kind: 'latest' },
          };
        default:
          why satisfies never;
          return unreadShows(read, answer, 'failed');
      }
    }
    default:
      // From the background process: say so, rather than show what Lo doesn't know.
      code satisfies never;
      return unreadShows(read, answer, 'failed');
  }
}

/** A note in a code block's own frame. */
function note(title: string, words: Words): Shows {
  return { kind: 'note', variant: 'code', title, words };
}

/** What a block shows when its code wasn't read: why, as far as Lo knows. */
function unreadShows(
  read: CodeRead,
  answer: CodeSeen | undefined,
  why: 'failed' | 'stopped',
): Shows {
  switch (read.kind) {
    case 'waiting':
      return note('Waiting for the local copy.', [
        'Lo shows this code once it has fetched the pull request.',
      ]);
    case 'noGit':
      return note('Lo needs git to show this code.', [
        'Code comes from the pull request’s local copy, which git fetches.',
      ]);
    case 'failed':
      return note('Lo couldn’t read this code.', [read.why]);
    case 'none':
    case 'read':
      if (answer?.kind === 'unread') return note('Lo couldn’t read this code.', [answer.why]);
      return note('Lo couldn’t read this code.', [
        why === 'stopped'
          ? 'Reading the overview’s code took too long.'
          : 'The local copy didn’t give it.',
      ]);
    default:
      read satisfies never;
      return note('Lo couldn’t read this code.', []);
  }
}

/** A file diffed, as `diffTexts` diffs it, highlighted or not, or why it couldn't be. */
type Diffed =
  | Pick<Extract<DiffedText, { ok: true }>, 'ok' | 'diff' | 'tokens'>
  | Extract<DiffedText, { ok: false }>;

/**
 * What a code block draws once its file is read, `read`, and diffed from where the pull request's
 * diff of it starts, `diffed`: each side's lines, the diff when the pull request changes the file,
 * and each side's highlighting. A file the pull request doesn't change shows as plain lines, as it
 * does when Lo couldn't read where the diff starts, or diff it.
 */
export function excerptOf(
  read: Extract<BlockText, { kind: 'text' }>,
  diffed: Diffed | undefined,
): {
  lines: { old: string[]; new: string[] };
  diff: FileDiff | undefined;
  tokens: { old?: Uint32Array | undefined; new?: Uint32Array | undefined };
} {
  const lines = { old: [] as string[], new: splitLines(read.text) };
  const tokens = diffed?.ok ? diffed.tokens : {};
  const base = read.base;
  if (!diffed?.ok || (base?.kind !== 'changed' && base?.kind !== 'added')) {
    return { lines, diff: undefined, tokens: { new: tokens.new } };
  }
  if (base.kind === 'changed') lines.old = splitLines(base.text);
  return { lines, diff: diffed.diff, tokens };
}

/** What `diffTexts` diffs for a file read as `read`: from where its diff starts, when it changed. */
export function textsOf(
  path: string,
  read: Extract<BlockText, { kind: 'text' }>,
): { path: string; old: string | null; new: string | null } {
  const old = read.base?.kind === 'changed' ? read.base.text : null;
  return { path, old, new: read.text };
}
