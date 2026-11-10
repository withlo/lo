// A whole pull request's diff: each file's diff, and the code moved within and between files.

import {
  diffText,
  type DiffOptions,
  type FileDiff,
  lineWords,
  splitLines,
  type WordRange,
} from './file.ts';
import { type FileChanges, type Line, type Move, Moves } from './moved.ts';

/** A changed file: its paths and both versions, or `undefined` for a side it doesn't exist on. */
export interface FileVersions {
  path: string;
  oldPath?: string | undefined;
  old: string | undefined;
  new: string | undefined;
}

/** A moved block, with the words that changed in each of its edited lines. */
export interface MovedBlock extends Move {
  /** Ranges on the edited lines, by their old and new numbers. */
  words: { old: WordRange[]; new: WordRange[] };
}

export interface PullRequestDiff {
  /** Each file's diff, in the order the files came in. */
  files: FileDiff[];
  /** By where they land. `new Moves(moves)` finds the move a line is in. */
  moves: MovedBlock[];
}

/**
 * Diffs every file of a pull request, then finds the code it moves. Each file's diff is
 * independent, so a caller with workers can run `diffText` and `changedLines` on each in parallel
 * and pass the results to `findMoves`, as this does in turn.
 */
export function diffPullRequest(
  files: readonly FileVersions[],
  options: DiffOptions = {},
): PullRequestDiff {
  const diffs: FileDiff[] = [];
  const changes: FileChanges[] = [];
  for (const file of files) {
    const diff = diffText(file.old, file.new, options);
    diffs.push(diff);
    changes.push(changedLines(file, diff));
  }
  return { files: diffs, moves: findMoves(changes, options) };
}

/** A file's deleted and added lines, from its diff, as `findMoves` reads them. */
export function changedLines(
  file: Pick<FileVersions, 'path' | 'oldPath'> & {
    old: string | readonly string[] | undefined;
    new: string | readonly string[] | undefined;
  },
  diff: FileDiff,
): FileChanges {
  const old = toLines(file.old);
  const added = toLines(file.new);
  const deleted: Line[] = [];
  const addedLines: Line[] = [];
  for (const change of diff.changes) {
    for (let number = change.old.start; number < change.old.end; number++) {
      deleted.push({ number, text: old[number - 1] ?? '' });
    }
    for (let number = change.new.start; number < change.new.end; number++) {
      addedLines.push({ number, text: added[number - 1] ?? '' });
    }
  }
  return { path: file.path, oldPath: file.oldPath, deleted, added: addedLines };
}

function toLines(text: string | readonly string[] | undefined): readonly string[] {
  if (text === undefined) return [];
  return typeof text === 'string' ? splitLines(text) : text;
}

/** The text of each line, by its number. */
function byNumber(lines: readonly Line[]): Map<number, string> {
  return new Map(lines.map((line) => [line.number, line.text]));
}

/**
 * Finds the code moved among every file's changed lines, and the words that changed in each moved
 * line that was edited on the way.
 */
export function findMoves(
  files: readonly FileChanges[],
  options: Pick<DiffOptions, 'budget'> = {},
): MovedBlock[] {
  const deleted = files.map((file) => byNumber(file.deleted));
  const added = files.map((file) => byNumber(file.added));
  return Moves.find(files).all.map((moved) => {
    const words: MovedBlock['words'] = { old: [], new: [] };
    for (const edit of moved.edits) {
      const found = lineWords(
        deleted[moved.from.file]!.get(edit.old) ?? '',
        added[moved.to.file]!.get(edit.new) ?? '',
        options,
      );
      words.old.push(...found.old.map((range) => ({ ...range, line: edit.old })));
      words.new.push(...found.new.map((range) => ({ ...range, line: edit.new })));
    }
    return { ...moved, words };
  });
}
