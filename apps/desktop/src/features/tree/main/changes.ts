// The files a pull request changes, as the tree marks them: from the local copy's diff, or from
// GitHub's list of the pull request's files until the copy is ready, each with how it changed, a
// rename's old path, and why it counts as generated. Nothing here calls Electron.

import { changedPath, type ChangedFile } from '@lo/git';
import { fileHead, type PullFile } from '@lo/github';
import { githubChange, whyGenerated } from '@lo/review';

import type { Change, Changed } from '../contract.ts';
import { textPathOf, treePathOf } from './paths.ts';

/** How git's change shows in the tree. */
function changeOf(file: ChangedFile): Change {
  const { change } = file;
  switch (change.kind) {
    case 'added':
    case 'deleted':
    case 'modified':
    case 'typeChanged':
    case 'renamed':
      return change.kind;
    default:
      change satisfies never;
      throw new Error(`A change Lo doesn't know: ${JSON.stringify(change)}.`);
  }
}

/** What `whyGenerated` takes besides the path and the attribute, which it doesn't look at. */
const counts = { additions: 0, deletions: 0, binary: false } as const;

/**
 * The tree's mark for a file the local copy's diff lists. `linguistGenerated` is its
 * `linguist-generated` attribute in the head, if `.gitattributes` says.
 */
export function localChange(file: ChangedFile, linguistGenerated?: boolean): Changed {
  const path = treePathOf(changedPath(file));
  const change = changeOf(file);
  const old = file.old;
  return {
    path,
    change,
    previous: change === 'renamed' && old !== undefined ? treePathOf(old.path) : null,
    generated: whyGenerated({ ...counts, path: path.text, linguistGenerated }) ?? null,
  };
}

/**
 * The tree's mark for a file GitHub lists, until the local copy lists it. GitHub's list doesn't
 * say what `.gitattributes` marks generated, so only lockfiles count as generated.
 */
export function githubChanged(file: PullFile): Changed {
  const change = githubChange(file.status);
  const previous = file.status === 'renamed' ? file.previous_filename : undefined;
  return {
    path: textPathOf(file.filename),
    change,
    previous: previous === undefined ? null : textPathOf(previous),
    generated: whyGenerated({ ...counts, path: file.filename }) ?? null,
  };
}

/**
 * Whether GitHub listed `files` at `head`: their links name the head they were listed at, and the
 * list is of GitHub's newest head, which can be past the one on screen. A list whose links don't
 * say, as when every file was removed, is taken as `head`'s.
 */
export function listedAt(files: readonly PullFile[], head: string): boolean {
  return files.every((file) => {
    const at = fileHead(file);
    return at === undefined || at === head;
  });
}

/**
 * How many of `changes` are files at the head with paths longer than `PATH_LIMIT` bytes: the
 * listing leaves them out, but the tree shows them, as every changed file.
 */
export function longAtHead(changes: readonly Changed[]): number {
  return changes.filter((change) => change.path.digest !== undefined && change.change !== 'deleted')
    .length;
}
