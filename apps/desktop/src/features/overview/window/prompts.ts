// The prompts Lo offers to copy into a coding agent: to write a pull request's overview, update
// it, fix it or make it smaller. The reader pastes one into an agent that runs tools, so a prompt
// holds only Lo's own words, the pull request's link and number, and revision labels: never text
// the pull request or its overview wrote, such as a title, a branch, a path or a finding, which
// would hand its author a way to instruct the agent.

import { parsePullLink } from '@lo/review';

import type { Revision } from './facts.ts';

/** What a prompt asks for: a first overview, one brought up to date, fixed or made smaller. */
export type PromptKind = 'write' | 'update' | 'fix' | 'shrink';

/** A pull request, as its tab opened it. */
export interface PromptPull {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/**
 * What a prompt says, all of it Lo's own: which kind it is, the pull request, and for an update,
 * the revision the overview describes and the newest, when both are revisions.
 */
export interface PromptFacts {
  readonly kind: PromptKind;
  readonly pull: PromptPull;
  readonly written?: Revision | undefined;
  readonly newest?: Revision | undefined;
}

/**
 * The pull request's link, as GitHub writes it, when its owner, name and number are ones GitHub
 * allows and read back the same; otherwise none, so nothing else gets into a prompt as a link.
 */
export function pullLink({ owner, repo, number }: PromptPull): string | undefined {
  const link = `https://github.com/${owner}/${repo}/pull/${number}`;
  try {
    const read = parsePullLink(link);
    return read.owner === owner && read.repo === repo && read.number === number ? link : undefined;
  } catch {
    return undefined;
  }
}

/** A revision's label, `r3`, for a revision Lo numbered; none for anything else. */
function label(revision: Revision | undefined): string | undefined {
  const number = revision?.number;
  return number !== undefined && Number.isSafeInteger(number) && number > 0
    ? `r${number}`
    : undefined;
}

/**
 * The prompt `facts` make, or none when the pull request's link isn't one Lo can vouch for. Every
 * word is Lo's: the link, the ref and the revision labels are made here from numbers and names
 * GitHub allows.
 */
export function promptOf(facts: PromptFacts): string | undefined {
  const link = pullLink(facts.pull);
  if (link === undefined || !Number.isSafeInteger(facts.pull.number)) return undefined;
  const ref = `refs/lo/pr/${facts.pull.number}`;
  switch (facts.kind) {
    case 'write':
      return [
        'Write a Lo overview for this pull request:',
        link,
        '',
        'Use the lo-overview skill. Read the diff, the description',
        'and the commits; write artifact.md and its figures; run the',
        `checker; then push to ${ref}.`,
      ].join('\n');
    case 'update': {
      const written = label(facts.written);
      const newest = label(facts.newest);
      const since =
        written !== undefined && newest !== undefined && written !== newest
          ? ['', `The overview at ${ref} describes ${written}. The pull request is at ${newest}.`]
          : [];
      return [
        'Update the Lo overview for this pull request:',
        link,
        ...since,
        '',
        `Use the lo-overview skill. Read the overview at ${ref}, then`,
        'the diff, the description and the commits; bring artifact.md',
        'and its figures up to date with the pull request as it is now;',
        `run the checker; then push to ${ref}.`,
      ].join('\n');
    }
    case 'fix':
      return [
        'Fix the Lo overview for this pull request:',
        link,
        '',
        `Lo can't read the overview at ${ref}. Use the lo-overview`,
        'skill: run its checker on the overview, fix each problem it',
        'reports, and run it again until it passes; then push to',
        `${ref}.`,
      ].join('\n');
    case 'shrink':
      return [
        'Make the Lo overview for this pull request smaller:',
        link,
        '',
        `The overview at ${ref} is past Lo's limits. Use the`,
        'lo-overview skill: make its figures smaller, as SVG where',
        'they can be, and cut what it holds that it doesn’t show,',
        `until the checker passes; then push to ${ref}.`,
      ].join('\n');
    default:
      facts.kind satisfies never;
      throw new Error(`A kind of prompt Lo doesn't know: ${String(facts.kind)}.`);
  }
}
