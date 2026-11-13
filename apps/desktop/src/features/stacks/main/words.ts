// What making a chain a GitHub stack says: why it can't, what a plan will do, and how it went. Main
// words it all, from the core's reasons and plans and GitHub's answers. Nothing here calls Electron
// or GitHub.

import {
  GithubError,
  MAX_OPEN_PULL_REQUESTS,
  openPullRequest,
  type OpenPullRequestList,
} from '@lo/github';
import { layerOf, type Gap, type Plan, type Reason, type Rule, type Stacks } from '@lo/stacks';

/** Pull requests' numbers as a sentence names them: "#45", "#45 and #46", "#45, #46 and #47". */
export function numbers(prs: readonly number[]): string {
  const named = prs.map((pr) => `#${pr}`);
  const last = named.pop();
  if (last === undefined) return '';
  return named.length === 0 ? last : `${named.join(', ')} and ${last}`;
}

/** A count as the interface writes it: "1,342". */
function counted(value: number): string {
  return value.toLocaleString('en-US');
}

/** `text` with its first letter capital, as a sentence starts. */
export function sentence(text: string): string {
  const trimmed = text.trim();
  const ended = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return ended.charAt(0).toUpperCase() + ended.slice(1);
}

/** What the core's reasons are worded from, beyond the reasons themselves. */
export interface ReasonContext {
  /** The pull request asked about. */
  readonly number: number;
  /** Its repository's name, as GitHub gives it. */
  readonly repository: string;
  readonly forest: Stacks;
  readonly list: OpenPullRequestList;
}

/** Why the chain through `context.number` can't be made a GitHub stack, a sentence a reason. */
export function reasonsText(reasons: readonly Reason[], context: ReasonContext): string[] {
  return reasons.flatMap((reason) => reasonText(reason, context));
}

function reasonText(reason: Reason, context: ReasonContext): string[] {
  const { number, repository, forest } = context;
  switch (reason.kind) {
    case 'incomplete':
      return reason.gaps.map((gap) => gapText(gap, context));
    case 'notOpen':
      return [`#${number} isn't open.`];
    case 'alreadyStacked':
      return [`This is GitHub stack #${reason.stack} already.`];
    case 'noStacksApi':
      return [`GitHub's Stacks API isn't available for ${repository}.`];
    case 'tooShort': {
      const above = layerOf(forest, number)?.children.length ?? 0;
      return [
        above > 1
          ? `#${number} has ${above} layers on it. Show one of them, then try again.`
          : 'A GitHub stack needs two PRs.',
      ];
    }
    case 'stackGoesOn':
      return [
        `GitHub stack #${reason.stack} goes on above #${reason.past} with other PRs, and a stack takes new PRs only at its top.`,
      ];
    case 'fromFork':
      return [
        `#${reason.pr} comes from a fork, and a GitHub stack holds only PRs from ${repository}.`,
      ];
    case 'queued':
      return [`#${reason.pr} is in a merge queue.`];
    case 'onTrunk':
      return [
        `#${reason.pr} merges into ${reason.base}, a long-lived branch, and Lo never moves a PR off one.`,
      ];
    case 'inAnotherStack':
      return [
        `#${reason.pr} is in GitHub stack #${reason.stack} already, and a PR can be in only one.`,
      ];
    default:
      throw new Error(`a reason Lo doesn't know: ${JSON.stringify(reason satisfies never)}`);
  }
}

/** Why what Lo read leaves it unsure of the stack. */
function gapText(gap: Gap, { repository, list }: ReasonContext): string {
  switch (gap.kind) {
    case 'openPullRequests':
      return `Lo reads the ${counted(MAX_OPEN_PULL_REQUESTS)} newest of ${repository}'s ${counted(list.totalCount)} open PRs, so it can't be sure of this stack.`;
    case 'mergedPullRequests':
      return "Some merged PRs weren't looked up yet, so Lo can't be sure of this stack.";
    case 'rulesets':
      return `Lo couldn't read ${repository}'s rulesets, so it can't be sure of this stack.`;
    default:
      throw new Error(`a gap Lo doesn't know: ${JSON.stringify(gap satisfies never)}`);
  }
}

/** Lo's own reasons, before it asks GitHub or the core anything. */
export const OWN = {
  nobody: 'Sign in to change base branches.',
  noAccountYet: 'Lo is still working out which account this tab acts as.',
  running: (repository: string) =>
    `Lo is already changing ${repository}'s base branches. Wait for that to finish.`,
  unread: (repository: string) => `Lo is still reading ${repository}'s open PRs.`,
  stale: (repository: string) =>
    `Lo couldn't list ${repository}'s open PRs again since its last changes. Try again in a moment.`,
  stacksChanged: (repository: string) =>
    `${repository}'s GitHub stacks changed since Lo last listed its PRs. Try again in a moment.`,
  stacksUnread: (number: number, error: unknown) =>
    `Lo couldn't ask GitHub which stack #${number} is in: ${errorText(error)}`,
  layersUnread: "Lo is still reading these PRs' state. Try again in a moment.",
  noPoller: (login: string, error: unknown) => `Lo can't act as ${login} now: ${errorText(error)}`,
} as const;

/** An error as the dialog says it: GitHub's own words when they're known. */
export function errorText(error: unknown): string {
  if (error instanceof GithubError) return sentence(error.message);
  if (error instanceof Error) return sentence(error.message);
  return sentence(String(error));
}

/** What the confirmation shows of a plan, in words, but its rows. */
export interface PlanWords {
  readonly title: string;
  readonly description: string;
  readonly heading: string;
  readonly stack: string;
  readonly warning: string | undefined;
  readonly confirm: string;
}

/** The pull requests a plan makes a GitHub stack of, or adds to one, bottom to top. */
export function stackedBy(plan: Plan): readonly number[] {
  const last = plan.steps.at(-1);
  return last && last.kind !== 'retarget' ? last.prs : plan.path;
}

/** What the confirmation of `plan` says, for the pull request `number` in `repository`. */
export function planWords(
  plan: Plan,
  { repository, forest, list }: Omit<ReasonContext, 'number'>,
): PlanWords {
  const last = plan.steps.at(-1);
  const added = stackedBy(plan);
  const moves = plan.steps.flatMap((step) => (step.kind === 'retarget' ? [step.retarget] : []));
  const changes = moves.length;
  const heading =
    changes === 0
      ? '1 · No base branch changes'
      : changes === 1
        ? '1 · One base branch changes'
        : `1 · ${changes} base branches change`;
  const heads = new Map(
    plan.path.map((number) => [openPullRequest(list, number)?.headRefName, number] as const),
  );
  // Each pull request moved onto the head branch of the one below shows only its own commits.
  const shrinking = moves.filter((move) => heads.has(move.to));
  const who = shrinking.map((move) => {
    const author = openPullRequest(list, move.pr)?.author?.login;
    return `${author ?? `#${move.pr}'s author`} will see #${move.pr}'s diff shrink to its own commits.`;
  });
  const warning =
    changes === 0
      ? undefined
      : ['Base branches change for everyone, on GitHub too.', ...who].join(' ');
  if (last?.kind === 'addToStack') {
    return {
      title: `Add ${added.length === 1 ? 'this PR' : `these ${added.length} PRs`} to GitHub stack #${last.stack}?`,
      description: `${repository} · on GitHub stack #${last.stack}`,
      heading,
      stack: `${numbers(added)} ${added.length === 1 ? 'joins' : 'join'} GitHub stack #${last.stack}, at its top.`,
      warning,
      confirm: 'Add to the stack',
    };
  }
  return {
    title: `Make these ${plan.path.length} PRs a GitHub stack?`,
    description: `${repository} · ${foundBy(plan, forest)}`,
    heading,
    stack: `${plan.path.map((number) => `#${number}`).join(' → ')}, through GitHub's Stacks API.`,
    warning,
    confirm: 'Make the stack',
  };
}

/**
 * The rules that linked the path's layers to each other, a GitHub stack's as a base branch's, since
 * its layers sit on each other's branches.
 */
function rulesOf(plan: Plan, forest: Stacks): ReadonlySet<Rule> {
  return new Set<Rule>(
    plan.path.flatMap((number) => {
      const rule = layerOf(forest, number)?.rule;
      return rule === undefined ? [] : [rule === 'nativeStack' ? 'baseBranch' : rule];
    }),
  );
}

/** How the path's layers were found to sit on each other: "found by base branch". */
function foundBy(plan: Plan, forest: Stacks): string {
  const rules = rulesOf(plan, forest);
  if (rules.has('baseBranch') && rules.has('sharedCommits')) {
    return 'found by base branch and shared commits';
  }
  if (rules.has('sharedCommits')) return 'found by shared commits';
  return 'found by base branch';
}

/**
 * What the offer over the stack's tree says of `plan`, before anyone asks for it: what the chain is
 * now, worded for how it was found, and what being a GitHub stack would change.
 */
export function calloutText(plan: Plan, forest: Stacks): string {
  const last = plan.steps.at(-1);
  if (last?.kind === 'addToStack') {
    const one = last.prs.length === 1;
    return `${numbers(last.prs)} ${one ? 'sits' : 'sit'} on GitHub stack #${last.stack} but ${one ? "isn't" : "aren't"} in it. In it, ${one ? 'it' : 'they'}'d merge with the layers below.`;
  }
  const rules = rulesOf(plan, forest);
  const now =
    rules.has('baseBranch') && rules.has('sharedCommits')
      ? "sit on each other's branches and share commits"
      : rules.has('sharedCommits')
        ? 'share commits'
        : "sit on each other's branches";
  return `These PRs ${now} but aren't a GitHub stack. As one, they'd merge together.`;
}

/** What a conversion made, once it's done, for the toast: "Made #1, #2 and #3 a GitHub stack". */
export function madeText(plan: Plan): string {
  const last = plan.steps.at(-1);
  if (last?.kind === 'addToStack')
    return `Added ${numbers(last.prs)} to GitHub stack #${last.stack}`;
  return `Made ${numbers(stackedBy(plan))} a GitHub stack`;
}
