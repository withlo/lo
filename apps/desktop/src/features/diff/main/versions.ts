// Each changed file's versions, as the diff starts it out: from the local copy's comparison, or from
// GitHub's list of the pull request's files until the copy is ready. Nothing here calls Electron.

import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';

import {
  changedPath,
  changedSize,
  type ChangedFile,
  type FileVersion,
  isModeChangeOnly,
  isSubmodule,
} from '@lo/git';
import type { PullFile } from '@lo/github';
import {
  type ChangedFile as ReviewFile,
  githubChange,
  initialCollapse,
  initialState,
  MAX_SHOWN_BYTES,
  sizeText,
} from '@lo/review';

import { PATH_LIMIT, type Change, type TreePath } from '../../tree/contract.ts';
import type { FileSide, FileVersions, Start } from '../contract.ts';
import { FAR_LINES } from '../jobs.ts';

/**
 * `bytes`, a path as git stores it, as the window takes it: one longer than the tree's limit with
 * the SHA-256 of its bytes, by which it's known, as the tree knows it.
 */
export function treePathOf(bytes: Uint8Array): TreePath {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = buffer.toString('utf8');
  const path: TreePath = isUtf8(buffer) ? { text } : { text, hex: buffer.toString('hex') };
  if (buffer.length <= PATH_LIMIT) return path;
  return { ...path, digest: createHash('sha256').update(buffer).digest('hex') };
}

/** `text`, a path as GitHub gives it, as the window takes it. */
function textPathOf(text: string): TreePath {
  return treePathOf(Buffer.from(text, 'utf8'));
}

/** How git's change shows. */
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

function sideOf(version: FileVersion | undefined): FileSide | null {
  if (version === undefined || version.mode === 'submodule') return null;
  return { blob: version.oid, size: version.size ?? null };
}

/**
 * How a file starts out, and why: binary or unchanged files have no diff to show; generated ones
 * start closed; large ones are kept out until asked for. `loads` says whether a diff could load at
 * all, which a binary or unchanged file's can't, so its size doesn't matter.
 */
function startOf(
  file: ReviewFile,
  shape: { binary: boolean; unchanged: boolean },
): Pick<FileVersions, 'start' | 'generated' | 'large'> {
  const state = initialState(file);
  const generated = state.generated ?? null;
  if (shape.binary) return { start: 'binary', generated, large: null };
  if (shape.unchanged) return { start: 'unchanged', generated, large: null };
  const collapse = initialCollapse(file, true);
  if (collapse?.kind === 'large') return { start: 'large', generated, large: collapse.why };
  if (file.size !== undefined && file.size > MAX_SHOWN_BYTES) {
    return { start: 'large', generated, large: `${sizeText(file.size)}, more than Lo shows` };
  }
  const start: Start = collapse ? 'collapsed' : 'shown';
  return { start, generated, large: null };
}

/**
 * A file the local copy's comparison lists. `linguistGenerated` is its `linguist-generated`
 * attribute in the head, if `.gitattributes` says.
 */
export function localVersions(file: ChangedFile, linguistGenerated?: boolean): FileVersions {
  const path = treePathOf(changedPath(file));
  const change = changeOf(file);
  const previous = change === 'renamed' && file.old ? treePathOf(file.old.path) : null;
  const additions = file.lines?.added ?? 0;
  const deletions = file.lines?.deleted ?? 0;
  const old = sideOf(file.old);
  const added = sideOf(file.new);
  const submodule = submoduleSides(file);
  // A submodule whose commit moved has no text to show; a file that became one, or was one, shows
  // the side that's a file.
  const unchanged =
    submodule === 'both' ||
    isModeChangeOnly(file) ||
    (old !== null && added !== null && old.blob === added.blob);
  const review: ReviewFile = {
    path: path.text,
    previousPath: previous?.text,
    additions,
    deletions,
    binary: file.binary,
    size: changedSize(file),
    linguistGenerated,
  };
  return {
    path,
    previous,
    change,
    additions,
    deletions,
    old,
    new: added,
    ...startOf(review, { binary: file.binary && submodule === null, unchanged }),
    submodule,
  };
}

/** Which of a changed file's sides are submodules, if any are. */
function submoduleSides(file: ChangedFile): FileVersions['submodule'] {
  if (!isSubmodule(file)) return null;
  const old = file.old?.mode === 'submodule';
  const added = file.new?.mode === 'submodule';
  if (old && added) return 'both';
  return added ? 'new' : 'old';
}

/** How far down a patch's hunks reach, on the side that reaches further, in lines. */
export function patchReach(patch: string): number {
  let reach = 0;
  for (const match of patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [, oldStart = '0', oldCount = '1', newStart = '0', newCount = '1'] = match;
    reach = Math.max(
      reach,
      Number(oldStart) + Number(oldCount),
      Number(newStart) + Number(newCount),
    );
  }
  return reach;
}

/**
 * A file GitHub lists, until the local copy lists it, with whether GitHub gave its patch. GitHub's
 * list doesn't say what `.gitattributes` marks generated, so only lockfiles count as generated,
 * nor what's binary: a file changed without a patch or a changed line is taken for binary, and a
 * rename or a change of mode without one for unchanged. One with changed lines but no patch is too
 * large for GitHub to show, and waits for the local copy.
 */
export function githubVersions(file: PullFile): FileVersions {
  const change = githubChange(file.status);
  const previous = file.status === 'renamed' ? file.previous_filename : undefined;
  const review: ReviewFile = {
    path: file.filename,
    previousPath: previous,
    additions: file.additions,
    deletions: file.deletions,
    binary: false,
  };
  const noPatch = file.patch === undefined;
  const counted = file.additions + file.deletions > 0;
  const far = file.patch !== undefined && patchReach(file.patch) > FAR_LINES;
  const quiet = noPatch && !counted;
  const binary = quiet && (change === 'modified' || change === 'added' || change === 'deleted');
  const shape = startOf(review, { binary, unchanged: quiet && !binary });
  return {
    path: textPathOf(file.filename),
    previous: previous === undefined ? null : textPathOf(previous),
    change,
    additions: file.additions,
    deletions: file.deletions,
    old: null,
    new: null,
    submodule: null,
    ...(shape.start === 'large'
      ? shape
      : noPatch && counted
        ? {
            ...shape,
            start: 'large',
            large: 'too large for GitHub’s diff: it loads from the local copy',
          }
        : far
          ? {
              ...shape,
              start: 'large',
              large: `GitHub’s diff of it reaches past line ${FAR_LINES.toLocaleString('en-US')}: it loads from the local copy`,
            }
          : shape),
  };
}
