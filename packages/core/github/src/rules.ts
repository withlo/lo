/**
 * A branch's rules, as they bear on merging into it: its classic branch protection, read through
 * GraphQL (`BaseRules`), and the active rules of its rulesets, read through REST
 * (`GET /repos/{owner}/{repo}/rules/branches/{branch}`), which anyone who can read the repository
 * may ask. The rulesets are asked again with their ETag, so an unchanged answer is free.
 */

import type { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import { nextLink } from './files.ts';
import type { BaseRulesFragment } from './generated/graphql.ts';
import { isRecord } from './graphql.ts';
import { PAGE_SIZE } from './pager.ts';
import type { RepoRef } from './refs.ts';

/**
 * A branch's classic branch protection rule. Anyone who can read the repository sees part of it
 * (`refUpdateRule`); only those who can administer it see all of it (`branchProtectionRule`).
 */
export interface Protection {
  /**
   * Whether all of it was read. Otherwise whether it dismisses stale approvals, wants the latest
   * push approved by someone else, wants the head up to date, requires deployments or locks the
   * branch is unknown, and reads as not.
   */
  complete: boolean;
  /** `requiredApprovingReviewCount`, when it requires approving reviews. */
  requiredApprovals: number;
  /** `requiresCodeOwnerReviews`. */
  codeOwnerReview: boolean;
  /** `requiresConversationResolution`. */
  conversationResolution: boolean;
  /** `dismissesStaleReviews`. */
  dismissStaleReviews: boolean;
  /** `requireLastPushApproval`. */
  lastPushApproval: boolean;
  /** `requiresStrictStatusChecks`, when it requires status checks. */
  strict: boolean;
  /**
   * The checks it requires (`requiredStatusCheckContexts`, which names them only, or
   * `requiredStatusChecks`).
   */
  requiredChecks: CheckRequirement[];
  /** `requiresLinearHistory`. */
  linearHistory: boolean;
  /** `requiresSignatures`, `requiresCommitSignatures`. */
  signatures: boolean;
  /** `requiresDeployments`. */
  deployments: boolean;
  /** `lockBranch`. */
  lockBranch: boolean;
  /**
   * `refUpdateRule.viewerCanPush`: the rule's push restrictions don't keep the account out. It may
   * be false for every writer on a branch that requires pull requests, so whether the account can
   * merge doesn't rest on it: GitHub says so if it refuses the merge.
   */
  viewerCanPush: boolean;
}

/** A check a branch's rules require. */
export interface CheckRequirement {
  /** The check run's name or the commit status's context it must report under. */
  name: string;
  /** The app it must come from (`app.databaseId`, REST's `integration_id`), when the rule pins one. */
  app: number | undefined;
}

/** The active rules of a branch's rulesets, its organization's included. */
export interface BranchRules {
  /** The branch they apply to. */
  branch: string;
  rules: BranchRule[];
  /** The answer's ETag, which the next read sends. */
  etag: string | undefined;
  /** Why they couldn't be read. Lo then may not see every rule. */
  unavailable: string | undefined;
  /** Whether there were more than a page of them. */
  cutShort: boolean;
}

/** Rules for `branch` that weren't read. */
export function noBranchRules(branch: string): BranchRules {
  return { branch, rules: [], etag: undefined, unavailable: undefined, cutShort: false };
}

/** A rule that applies to a branch, by its REST `type`. */
export type BranchRule =
  /** `pull_request`. */
  | { kind: 'pullRequest'; rule: PullRequestRule }
  /** `required_status_checks`. */
  | { kind: 'requiredStatusChecks'; rule: StatusChecksRule }
  /** `merge_queue`, with its `merge_method`. */
  | { kind: 'mergeQueue'; method: string | undefined }
  /** `required_linear_history`: no merge commits. */
  | { kind: 'requiredLinearHistory' }
  /**
   * `required_signatures`. GitHub can't sign a rebase merge's commits, so Lo doesn't offer it;
   * what else it blocks Lo doesn't model.
   */
  | { kind: 'requiredSignatures' }
  /**
   * A rule of REST type `type` that never keeps a pull request from merging, such as one against
   * deleting the branch or force-pushing to it, or one that asks Copilot to review.
   */
  | { kind: 'harmless'; type: string }
  /**
   * Any other rule, of REST type `type`, which may keep a pull request from merging for a reason Lo
   * doesn't model, such as required deployments, code scanning or restricted updates, or a rule
   * newer than Lo.
   */
  | { kind: 'other'; type: string };

/** A `pull_request` rule's parameters. */
export interface PullRequestRule {
  /** `required_approving_review_count`. */
  requiredApprovals: number;
  /** `require_code_owner_review`. */
  codeOwnerReview: boolean;
  /** `required_review_thread_resolution`. */
  conversationResolution: boolean;
  /** `dismiss_stale_reviews_on_push`. */
  dismissStaleReviews: boolean;
  /** `require_last_push_approval`. */
  lastPushApproval: boolean;
  /** `allowed_merge_methods`, or nothing when it doesn't narrow them. */
  allowedMethods: string[] | undefined;
  /** Whether it has `required_reviewers`: reviewers required by file pattern, which Lo doesn't model. */
  requiredReviewers: boolean;
  /**
   * `require_extra_approval_for_unattributed_changes`: one more approval for a pull request Copilot
   * opened, which Lo doesn't model.
   */
  extraApprovalForCopilot: boolean;
}

/** A `required_status_checks` rule's parameters. */
export interface StatusChecksRule {
  /** `strict_required_status_checks_policy`: the head must be up to date with the base. */
  strict: boolean;
  /** The checks it requires (`required_status_checks`). */
  checks: CheckRequirement[];
}

/** The rule types that never keep a pull request from merging. */
const HARMLESS_RULES: ReadonlySet<string> = new Set([
  'creation',
  'deletion',
  'non_fast_forward',
  'copilot_code_review',
  'tag_name_pattern',
]);

/**
 * A rule as REST lists it: its `type` and `parameters`. One whose parameters Lo can't read is one
 * Lo doesn't model. Throws when it isn't a rule at all.
 */
export function branchRuleFromRest(json: unknown): BranchRule {
  if (!isRecord(json) || typeof json['type'] !== 'string') {
    throw new GithubError({ kind: 'decode', message: "a branch's rule had no type" });
  }
  const type = json['type'];
  const parameters = json['parameters'];
  return (
    modelled(type, parameters) ??
    (HARMLESS_RULES.has(type) ? { kind: 'harmless', type } : { kind: 'other', type })
  );
}

/** The rule of type `type` with `parameters`, when Lo models it and can read them. */
function modelled(type: string, parameters: unknown): BranchRule | undefined {
  const params = isRecord(parameters) ? new Params(parameters) : undefined;
  switch (type) {
    case 'pull_request': {
      if (!params) return undefined;
      const allowed = params.optional('allowed_merge_methods', strings);
      const reviewers = params.optional('required_reviewers', list);
      const rule: PullRequestRule = {
        requiredApprovals: params.optional('required_approving_review_count', count) ?? 0,
        codeOwnerReview: params.optional('require_code_owner_review', flag) ?? false,
        conversationResolution: params.optional('required_review_thread_resolution', flag) ?? false,
        dismissStaleReviews: params.optional('dismiss_stale_reviews_on_push', flag) ?? false,
        lastPushApproval: params.optional('require_last_push_approval', flag) ?? false,
        allowedMethods: allowed,
        requiredReviewers: (reviewers?.length ?? 0) > 0,
        extraApprovalForCopilot:
          params.optional('require_extra_approval_for_unattributed_changes', flag) ?? false,
      };
      return params.failed ? undefined : { kind: 'pullRequest', rule };
    }
    case 'required_status_checks': {
      if (!params) return undefined;
      const strict = params.optional('strict_required_status_checks_policy', flag) ?? false;
      const checks = params.optional('required_status_checks', requirements);
      if (params.failed || checks === undefined) return undefined;
      return { kind: 'requiredStatusChecks', rule: { strict, checks } };
    }
    case 'merge_queue': {
      const method = params?.optional('merge_method', text);
      return { kind: 'mergeQueue', method: params?.failed ? undefined : method };
    }
    case 'required_linear_history':
      return { kind: 'requiredLinearHistory' };
    case 'required_signatures':
      return { kind: 'requiredSignatures' };
    default:
      return undefined;
  }
}

/** A rule's parameters, read one at a time; any of the wrong type fails them all. */
class Params {
  readonly #values: Record<string, unknown>;
  failed = false;

  constructor(values: Record<string, unknown>) {
    this.#values = values;
  }

  /** The parameter `name` read by `read`, or nothing when it's missing or null. */
  optional<T>(name: string, read: (value: unknown) => T | undefined): T | undefined {
    const value = this.#values[name];
    if (value === undefined || value === null) return undefined;
    const found = read(value);
    if (found === undefined) this.failed = true;
    return found;
  }
}

function flag(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function list(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const read = value.map(text);
  return read.every((item) => item !== undefined) ? read : undefined;
}

function requirements(value: unknown): CheckRequirement[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const read = value.map((item): CheckRequirement | undefined => {
    if (!isRecord(item) || typeof item['context'] !== 'string') return undefined;
    const app = item['integration_id'];
    if (app !== undefined && app !== null && !Number.isSafeInteger(app)) return undefined;
    return { name: item['context'], app: typeof app === 'number' ? app : undefined };
  });
  return read.every((item) => item !== undefined) ? read : undefined;
}

/** The rules in REST's answer, a list of them. */
function readRules(json: unknown): BranchRule[] {
  if (!Array.isArray(json)) {
    throw new GithubError({ kind: 'decode', message: "a branch's rules weren't a list" });
  }
  return json.map(branchRuleFromRest);
}

/**
 * A branch's name for a URL's path: its slashes kept, anything else but letters, digits and `-._~`
 * percent-encoded, such as the `#` a branch's name may hold.
 */
export function branchPath(branch: string): string {
  return [...new TextEncoder().encode(branch)]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /[A-Za-z0-9\-._~/]/.test(char)
        ? char
        : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}

/**
 * The active rules of `repo`'s `branch`, asked with the ETag of `known` when it's the same
 * branch's and was read: an unchanged answer is `known` again, for free.
 */
export async function branchRules(
  client: GithubClient,
  repo: RepoRef,
  branch: string,
  known?: BranchRules,
): Promise<BranchRules> {
  const reusable = known?.branch === branch && known.unavailable === undefined ? known : undefined;
  const path = `/repos/${repo.owner}/${repo.name}/rules/branches/${branchPath(branch)}?per_page=${PAGE_SIZE}`;
  const etag = reusable?.etag;
  const response = await client.send('GET', path, {
    condition: etag === undefined ? undefined : { ifNoneMatch: etag },
  });
  if (response.status === 304 && reusable) return structuredClone(reusable);
  const link = response.header('link');
  return {
    branch,
    rules: response.json(readRules),
    etag: response.etag,
    unavailable: undefined,
    cutShort: link !== undefined && nextLink(link) !== undefined,
  };
}

/** A branch's classic protection, as much of it as the account sees, if it has one. */
export function protectionFrom(base: BaseRulesFragment | null | undefined): Protection | undefined {
  if (!base) return undefined;
  const visible = base.refUpdateRule;
  const viewerCanPush = visible?.viewerCanPush ?? true;
  const full = base.branchProtectionRule;
  if (full) {
    return {
      complete: true,
      requiredApprovals: full.requiresApprovingReviews
        ? reviews(full.requiredApprovingReviewCount)
        : 0,
      codeOwnerReview: full.requiresCodeOwnerReviews,
      conversationResolution: full.requiresConversationResolution,
      dismissStaleReviews: full.dismissesStaleReviews,
      lastPushApproval: full.requireLastPushApproval,
      strict: full.requiresStatusChecks && full.requiresStrictStatusChecks,
      requiredChecks: full.requiresStatusChecks
        ? (full.requiredStatusChecks ?? []).map((check) => ({
            name: check.context,
            app: check.app?.databaseId ?? undefined,
          }))
        : [],
      linearHistory: full.requiresLinearHistory,
      signatures: full.requiresCommitSignatures,
      deployments: full.requiresDeployments,
      lockBranch: full.lockBranch,
      viewerCanPush,
    };
  }
  if (!visible) return undefined;
  return {
    complete: false,
    requiredApprovals: reviews(visible.requiredApprovingReviewCount),
    codeOwnerReview: visible.requiresCodeOwnerReviews,
    conversationResolution: visible.requiresConversationResolution,
    dismissStaleReviews: false,
    lastPushApproval: false,
    strict: false,
    requiredChecks: (visible.requiredStatusCheckContexts ?? []).flatMap((name) =>
      name === null ? [] : [{ name, app: undefined }],
    ),
    linearHistory: visible.requiresLinearHistory,
    signatures: visible.requiresSignatures,
    deployments: false,
    lockBranch: false,
    viewerCanPush,
  };
}

/** A count of approving reviews GitHub gave, or 0 for none or one that isn't a count. */
function reviews(given: number | null): number {
  return given !== null && Number.isSafeInteger(given) && given >= 0 ? given : 0;
}
