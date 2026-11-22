// What converting a chain to a GitHub stack says: why it can't, what a plan will do, and why it
// went wrong. Main words it all, from the core's reasons and plans and GitHub's answers. Nothing
// here calls Electron or GitHub.

import {
  describeMergeRefusal,
  GithubError,
  MAX_OPEN_PULL_REQUESTS,
  type MergeRefusal,
  type OpenPullRequestList,
} from '@lo/github';
import { layerOf, type Gap, type Plan, type Reason, type Stacks } from '@lo/stacks';

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

/** Why the chain through `context.number` can't be converted to a GitHub stack, a line a reason. */
export function reasonsText(reasons: readonly Reason[], context: ReasonContext): string[] {
  return reasons.flatMap((reason) => reasonText(reason, context));
}

function reasonText(reason: Reason, context: ReasonContext): string[] {
  const { number, repository, forest } = context;
  switch (reason.kind) {
    case 'incomplete':
      return reason.gaps.map((gap) => gapText(gap, context));
    case 'notOpen':
      return [`#${number} isn’t open`];
    case 'alreadyStacked':
      return ['Already a GitHub stack'];
    case 'noStacksApi':
      return [`GitHub stacks aren’t available for ${repository}`];
    case 'tooShort': {
      const above = layerOf(forest, number)?.children.length ?? 0;
      return [
        above > 1
          ? `Show one of the layers above #${number} first`
          : 'A GitHub stack needs 2 pull requests',
      ];
    }
    case 'stackGoesOn':
      return [`The GitHub stack has other layers above #${reason.past}`];
    case 'fromFork':
      return [`#${reason.pr} is from a fork`];
    case 'queued':
      return [`#${reason.pr} is in the merge queue`];
    case 'onTrunk':
      return [`#${reason.pr}’s base branch is ${reason.base}`];
    case 'inAnotherStack':
      return [`#${reason.pr} is in another GitHub stack`];
    default:
      throw new Error(`a reason Lo doesn't know: ${JSON.stringify(reason satisfies never)}`);
  }
}

/** Why what Lo read leaves it unsure of the stack. */
function gapText(gap: Gap, { repository }: ReasonContext): string {
  switch (gap.kind) {
    case 'openPullRequests':
      return `${repository} has over ${counted(MAX_OPEN_PULL_REQUESTS)} open pull requests`;
    case 'mergedPullRequests':
      return CHECKING_MERGED;
    case 'rulesets':
      return `Couldn’t read ${repository}’s branch rules`;
    default:
      throw new Error(`a gap Lo doesn't know: ${JSON.stringify(gap satisfies never)}`);
  }
}

/** What's said while merged pull requests a stack links through are still being looked up. */
export const CHECKING_MERGED = 'Checking merged pull requests…';

/** What's said while what a refusal waits on is still being read. */
const CHECKING = 'Checking…';

/** Lo's own reasons, before it asks GitHub or the core anything. */
export const OWN = {
  nobody: 'Sign in to convert to GitHub stack',
  noAccountYet: CHECKING,
  running: (repository: string) => `Another stack in ${repository} is still converting`,
  merging: (prs: readonly number[]) =>
    `${numbers(prs)} ${prs.length === 1 ? 'is' : 'are'} still merging`,
  unread: CHECKING,
  layersUnread: CHECKING,
} as const;

/** Why something sent or read didn't go, and GitHub's own words for it. */
export interface Cause {
  /** One line, from the causes every error is worded by, or nothing for a cause not known. */
  readonly reason: string | null;
  /** GitHub's own words, or the error's, as they came. */
  readonly details: string | null;
}

/** What GitHub said, as a sentence. */
function detailsOf(error: unknown): string {
  return error instanceof Error ? sentence(error.message) : sentence(String(error));
}

/** A time of day, as this computer writes it: "14:05". */
function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Why `error` stopped what was asked of GitHub as `login`, as every error says it. */
export function causeOf(error: unknown, login: string): Cause {
  const details = detailsOf(error);
  if (!(error instanceof GithubError)) return { reason: null, details };
  const { detail } = error;
  switch (detail.kind) {
    case 'network':
      if (detail.failure === 'offline') return { reason: 'Offline.', details };
      if (detail.failure === 'tunnel') {
        return { reason: 'The proxy couldn’t connect to GitHub.', details };
      }
      return { reason: NO_ANSWER, details };
    case 'rateLimited': {
      const at =
        detail.reset === undefined
          ? detail.retryAfter === undefined
            ? undefined
            : Date.now() + detail.retryAfter * 1000
          : detail.reset * 1000;
      return {
        reason:
          at === undefined
            ? 'GitHub’s rate limit was reached.'
            : `GitHub’s rate limit resets at ${timeOf(at)}.`,
        details,
      };
    }
    case 'unauthorized':
      return { reason: `${detail.missing ?? login} is signed out.`, details };
    case 'tokenUnavailable':
      return {
        reason: `${login}’s sign-in can’t be read from the ${process.platform === 'darwin' ? 'Keychain' : 'keyring'}.`,
        details,
      };
    case 'notFound':
      return { reason: `It doesn’t exist, or ${login} can’t see it.`, details };
    case 'api':
    case 'graphql':
      return { reason: 'GitHub returned an error.', details };
    case 'ssoRequired':
    case 'oauthAppRestricted':
    case 'refusedUrl':
    case 'inconsistent':
    case 'decode':
      // No cause of its own: GitHub's words say it.
      return { reason: null, details };
    default:
      // GitHub may fail in a way Lo doesn't know yet: its words say it.
      detail satisfies never;
      return { reason: null, details };
  }
}

/** Why GitHub's answer is not known. */
export const NO_ANSWER = 'GitHub didn’t respond.';

/** Why GitHub refused a change a conversion sent, as every refused write says it. */
export function refusalCause(refusal: MergeRefusal, login: string): Cause {
  const details = `${describeMergeRefusal(refusal)}.`;
  switch (refusal.refusal) {
    case 'stackChanged':
      return { reason: STACK_CHANGED, details };
    case 'noPermission':
      return { reason: `${login} doesn’t have permission.`, details };
    case 'alreadyStacked':
      return { reason: 'One of these pull requests is already in a GitHub stack.', details };
    case 'notAChain':
      return { reason: 'Each pull request must be based on the one below it.', details };
    case 'stackBusy':
      return { reason: 'GitHub is still changing this stack.', details };
    case 'baseChanged':
      return { reason: `Its base branch is now ${refusal.now}.`, details };
    case 'paused':
      return { reason: `GitHub’s rate limit resets at ${timeOf(refusal.until)}.`, details };
    case 'other':
      return { reason: 'GitHub returned an error.', details };
    // Refusals of a merge, never of a conversion's change: GitHub's words say them.
    case 'autoMergeNotAllowed':
    case 'canMergeNow':
    case 'closed':
    case 'conflict':
    case 'draft':
    case 'headMoved':
    case 'layerMoved':
    case 'merged':
    case 'noMergeQueue':
    case 'notACommit':
    case 'queueUnchecked':
    case 'rules':
    case 'stackNeedsRebase':
    case 'stacked':
    case 'unchecked':
    case 'unnamedAbove':
    case 'unnamedLayers':
      return { reason: null, details };
    default:
      refusal satisfies never;
      return { reason: null, details };
  }
}

/** Why a plan is gone, or GitHub's stacks aren't as the list has them. */
export const STACK_CHANGED = 'The stack has changed.';

/** An error as GitHub's own words say it, a sentence. */
export function errorText(error: unknown): string {
  return detailsOf(error);
}

/** The pull requests a plan converts to a GitHub stack, or adds to one, bottom to top. */
export function stackedBy(plan: Plan): readonly number[] {
  const last = plan.steps.at(-1);
  return last && last.kind !== 'retarget' ? last.prs : plan.path;
}

/** What the confirmation of `plan` says, but its steps. */
export interface PlanWords {
  /** The repository and how many layers: "e2e · 3 layers". */
  readonly description: string;
  /** What GitHub will show once a layer moves, when one does. */
  readonly warning: string | undefined;
}

/** What the confirmation of `plan` says, for a pull request in `repository`. */
export function planWords(plan: Plan, repository: string): PlanWords {
  const layers = stackedBy(plan).length;
  const moves = plan.steps.some((step) => step.kind === 'retarget');
  return {
    description: `${repository} · ${layers} ${layers === 1 ? 'layer' : 'layers'}`,
    warning: moves
      ? 'On GitHub, each moved pull request’s diff shows only its own commits.'
      : undefined,
  };
}

/**
 * What the offer over the stack's tree says of `plan`, before anyone asks for it, in one line: a
 * branch stack merges a layer at a time, and layers that sit on a GitHub stack aren't in it.
 */
export function calloutText(plan: Plan): string {
  const last = plan.steps.at(-1);
  if (last?.kind === 'addToStack') {
    return last.prs.length === 1
      ? `${numbers(last.prs)} isn’t in the GitHub stack below it.`
      : `${numbers(last.prs)} aren’t in the GitHub stack below them.`;
  }
  return 'This branch stack merges one layer at a time.';
}
