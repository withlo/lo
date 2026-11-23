// What the tree can't list, in words: main sends why as a kind, with what Git or GitHub said, and
// the window writes a title and one reason for the line over the files and Go to file.

import { explain } from '../../../window/explain.ts';
import type { TreeProblem, Unlisted } from '../contract.ts';

/** A title, and one reason when there's one to give. */
export interface TreeWords {
  readonly title: string;
  readonly reason?: string | undefined;
}

/** Why only the changed files are listed. */
export function unlistedWords(why: Unlisted): TreeWords {
  const title = 'Unchanged files aren’t listed';
  switch (why.kind) {
    case 'tooManyBytes':
      return { title, reason: 'The repo’s file list is over 32 MB.' };
    case 'tooManyFiles':
      return { title, reason: `The repo has over ${why.limit.toLocaleString('en')} files.` };
    case 'truncated':
      return { title, reason: 'GitHub lists only part of this repo.' };
    case 'failed':
      return { title, reason: explain(why.cause) };
    default:
      throw new Error(`A reason Lo doesn't know: ${JSON.stringify(why satisfies never)}`);
  }
}

/** What couldn't be read, and why. */
export function problemWords(problem: TreeProblem): TreeWords {
  const title = problem.what === 'files' ? 'Can’t list the files' : 'Can’t list the changed files';
  const { why } = problem;
  switch (why.kind) {
    case 'local':
      return { title, reason: 'The local copy can’t be used.' };
    case 'tooLarge':
      return {
        title,
        reason: `The changes are over the ${Math.round(why.limit / 2 ** 20)} MB limit.`,
      };
    case 'github':
      return { title, reason: explain(why.cause) };
    default:
      throw new Error(`A problem Lo doesn't know: ${JSON.stringify(why satisfies never)}`);
  }
}

/** `words` on one line, the reason after the title. */
export function oneLine(words: TreeWords): string {
  return words.reason === undefined ? words.title : `${words.title} · ${words.reason}`;
}
