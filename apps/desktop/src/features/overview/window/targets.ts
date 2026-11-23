// What an overview's code blocks and walkthrough steps show, from how its check left the code they
// point at and what main read of it: the code itself, which each reads when it comes near the
// screen; or what it says in the code's place, and what the reader can do about it. Plain
// functions, each tested alone.

import { LIMITS, type CheckedCode, type CodeRange, type CodeState } from '@lo/artifact';
import { splitLines, type FileDiff } from '@lo/diff';

import type { DiffedText } from '../../diff/window/shared.ts';
import type { BlockText, CodeCause } from '../contract.ts';
import type { CodeRead, CodeSeen } from './checking.ts';

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
 * - `waiting`: the code's room, as the code will be laid out, while the local copy comes;
 * - `note`: what it says in its place, in a frame for its variant, with what the reader can do:
 *   find a file of the name it gave (`find`), or open the file at the newest revision Lo has
 *   (`latest`).
 */
export type Shows =
  | { readonly kind: 'code' }
  | { readonly kind: 'waiting' }
  | {
      readonly kind: 'note';
      readonly variant: 'code' | 'unresolved' | 'missing';
      readonly title: string;
      readonly words: Words;
      readonly action?:
        { readonly kind: 'find'; readonly name: string } | { readonly kind: 'latest' };
    };

/** What a block whose code can't be shown says in its place, whichever the reason. */
export const CANT_SHOW = 'Can’t show this code';

/** What a path is, in words, when it isn't a file: `is a folder`. */
function notAFile(answer: CodeSeen | undefined): string {
  if (answer?.kind !== 'notFile') return 'isn’t a file';
  switch (answer.is) {
    case 'folder':
      return 'is a folder';
    case 'link':
      return 'is a symbolic link';
    case 'submodule':
      return 'is a submodule';
    default:
      answer.is satisfies never;
      return 'isn’t a file';
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

/** A note on code that can't be shown, in a frame for `variant`. */
function cantShow(
  variant: 'unresolved' | 'missing',
  words: Words,
  action?: Extract<Shows, { kind: 'note' }>['action'],
): Shows {
  return action === undefined
    ? { kind: 'note', variant, title: CANT_SHOW, words }
    : { kind: 'note', variant, title: CANT_SHOW, words, action };
}

/**
 * What a block pointing at `target` shows, as its check left it (`found`) and as far as the code
 * was read (`read`), in `written`, the revision the overview describes as Lo names it.
 */
export function showsOf(target: CodeRange, found: Target, read: CodeRead, written: string): Shows {
  const { code, answer } = found;
  const path = { code: target.path };
  switch (code.state) {
    case 'resolved':
      return { kind: 'code' };
    case 'unread':
      return unreadShows(read, answer, code.why, target.path, written);
    case 'broken': {
      const { why } = code;
      switch (why) {
        case 'missing':
          return cantShow('unresolved', [path, ` isn’t in ${written}.`], {
            kind: 'find',
            name: nameOf(target.path),
          });
        case 'lines':
          return cantShow('unresolved', [
            path,
            ` has no ${linesWords(target.lines)} in ${written}.`,
          ]);
        case 'notFile':
          return cantShow('unresolved', [path, ` ${notAFile(answer)} in ${written}.`]);
        case 'binary':
          return cantShow('unresolved', [path, ' isn’t text.']);
        case 'tooLarge':
          return cantShow('unresolved', [path, ` is over the ${LIMITS.file / 2 ** 20} MB limit.`]);
        case 'commit':
          return cantShow('missing', [`${written}’s commit is no longer on GitHub.`], {
            kind: 'latest',
          });
        default:
          why satisfies never;
          return unreadShows(read, answer, 'failed', target.path, written);
      }
    }
    default:
      // From the background process: say so, rather than show what Lo doesn't know.
      code satisfies never;
      return unreadShows(read, answer, 'failed', target.path, written);
  }
}

/** A note in a code block's own frame. */
function note(title: string, words: Words): Shows {
  return { kind: 'note', variant: 'code', title, words };
}

/**
 * Why Lo couldn't read a block's code, at `path`, as main gives its cause, in `written`, the
 * revision the overview describes as Lo names it: nothing where Lo doesn't know the cause, or the
 * wait says it.
 */
export function causeWords(cause: CodeCause, path: string, written: string): Words {
  const file = { code: path };
  switch (cause) {
    case 'noGit':
      return ['Git wasn’t found.'];
    case 'notFetched':
      return ['Can’t fetch the local copy.'];
    case 'noCommit':
      return [`${written}’s commit isn’t in the local copy.`];
    case 'noFile':
      return [file, ` isn’t in ${written}.`];
    case 'notFile':
      return [file, ` isn’t a file in ${written}.`];
    case 'binary':
      return [file, ' isn’t text.'];
    case 'tooLarge':
      return [file, ` is over the ${LIMITS.file / 2 ** 20} MB limit.`];
    case 'offline':
      return ['Offline.'];
    case 'spent':
      return ['This overview’s code is over the size limit.'];
    case 'notDownloaded':
      return ['GitHub didn’t respond.'];
    case 'notReady':
    case 'unknown':
      return [];
    default:
      // From main: say nothing, rather than what Lo doesn't know.
      cause satisfies never;
      return [];
  }
}

/** What a block shows when its code, at `path` in `written`, wasn't read: why, where Lo knows. */
function unreadShows(
  read: CodeRead,
  answer: CodeSeen | undefined,
  why: 'failed' | 'stopped',
  path: string,
  written: string,
): Shows {
  switch (read.kind) {
    case 'waiting':
      return { kind: 'waiting' };
    case 'noGit':
      return note(CANT_SHOW, causeWords('noGit', path, written));
    case 'failed':
      return note(CANT_SHOW, causeWords(read.why, path, written));
    case 'none':
    case 'read':
      if (answer?.kind === 'unread') {
        return note(CANT_SHOW, causeWords(answer.why, path, written));
      }
      return note(CANT_SHOW, why === 'stopped' ? ['It took too long.'] : []);
    default:
      read satisfies never;
      return note(CANT_SHOW, []);
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
