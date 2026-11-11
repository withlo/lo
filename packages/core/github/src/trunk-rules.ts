/**
 * The branch rulesets that name a repository's trunks: its long-lived branches, which finding
 * stacks never makes a layer. The repository's poller reads them with its open pull requests. A
 * failure never fails the open pull request list: the rulesets read before stay, the branches open
 * pull requests both target and come from are checked one by one instead, and
 * {@link TrunkRuleList.unavailable} says why.
 */

import type { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import {
  TrunkRulesDocument,
  type RepositoryRuleType,
  type TrunkRulesQuery,
} from './generated/graphql.ts';
import { isRecord } from './graphql.ts';
import { notFound } from './pager.ts';
import type { RepoRef } from './refs.ts';
import { branchPath } from './rules.ts';

/**
 * The rule types that gate merging into a branch: a ruleset holding one names the branches its
 * patterns match as trunks.
 */
export const GATING_RULES: readonly RepositoryRuleType[] = [
  'PULL_REQUEST',
  'MERGE_QUEUE',
  'REQUIRED_STATUS_CHECKS',
  'UPDATE',
  'REQUIRED_DEPLOYMENTS',
];

/** {@link GATING_RULES} as REST names them. */
const GATING_REST_RULES: readonly string[] = GATING_RULES.map((rule) => rule.toLowerCase());

/** The most branches checked one by one when the rulesets can't be read. */
export const MAX_BRANCHES_CHECKED = 10;

/**
 * An active branch ruleset's ref name condition (`conditions { refName { include exclude } }`): it
 * covers a branch when one of `include` matches it and none of `exclude` does. Patterns match a
 * branch's full ref name, such as `refs/heads/main`, or are `~DEFAULT_BRANCH` or `~ALL`.
 */
export interface RefNames {
  include: string[];
  exclude: string[];
  /** Whether the ruleset gates merging ({@link GATING_RULES}), which a pattern include needs to name trunks. */
  gatesMerging: boolean;
}

/** The branch rulesets that name a repository's trunks. */
export interface TrunkRuleList {
  /**
   * The ref name conditions of the active rulesets, each saying whether it gates merging. Rulesets
   * being evaluated or disabled name no trunk.
   */
  rulesets: RefNames[];
  /**
   * Why the rulesets couldn't be read, the last time they were tried. `rulesets` then holds what
   * was read before, if anything, and an exact include for each branch checked one by one that a
   * gating rule covers.
   */
  unavailable: string | undefined;
}

/** A repository without rulesets. */
export function noTrunkRules(): TrunkRuleList {
  return { rulesets: [], unavailable: undefined };
}

/** The active rulesets in the query's answer, or nothing when it has no repository or rulesets. */
function fromData(data: TrunkRulesQuery): TrunkRuleList | undefined {
  const rulesets = data.repository?.rulesets;
  if (!rulesets) return undefined;
  return {
    rulesets: (rulesets.nodes ?? []).flatMap((ruleset) => {
      if (ruleset?.enforcement !== 'ACTIVE') return [];
      const refName = ruleset.conditions.refName;
      if (!refName) return [];
      const gatesMerging = (ruleset.rules?.nodes ?? []).some(
        (rule) => rule !== null && GATING_RULES.includes(rule.type),
      );
      return [{ include: refName.include, exclude: refName.exclude, gatesMerging }];
    }),
    unavailable: undefined,
  };
}

/** The types of the rules REST says apply to a branch. */
function ruleTypes(json: unknown): string[] {
  if (!Array.isArray(json)) {
    throw new GithubError({ kind: 'decode', message: "a branch's rules weren't a list" });
  }
  return json.flatMap((rule) =>
    isRecord(rule) && typeof rule['type'] === 'string' ? [rule['type']] : [],
  );
}

/**
 * The branch rulesets that name `repo`'s trunks. Any error but the network's, the rate limit's or
 * the token's gives what `known` holds, or nothing, with the reason in
 * {@link TrunkRuleList.unavailable}. Then each of `branches`, at most
 * {@link MAX_BRANCHES_CHECKED}, is checked one by one through REST, which anyone who can read the
 * repository may ask.
 */
export async function readTrunkRules(
  client: GithubClient,
  repo: RepoRef,
  known: TrunkRuleList | undefined,
  branches: readonly string[],
): Promise<TrunkRuleList> {
  let failure: GithubError;
  try {
    const { data } = await client.graphqlWithErrors(
      TrunkRulesDocument,
      { owner: repo.owner, name: repo.name },
      2,
    );
    const read = fromData(data);
    if (read) return read;
    failure = notFound(`rulesets of ${repo.toString()}`);
  } catch (error) {
    if (!(error instanceof GithubError) || error.stopsTheRead()) throw error;
    failure = error;
  }
  const rules: TrunkRuleList = {
    rulesets: structuredClone(known?.rulesets ?? []),
    unavailable: failure.message,
  };
  for (const branch of branches.slice(0, MAX_BRANCHES_CHECKED)) {
    const include = `refs/heads/${branch}`;
    const named = rules.rulesets.some(
      (ruleset) => ruleset.include.length === 1 && ruleset.include[0] === include,
    );
    if (named) continue;
    let applied: string[];
    try {
      applied = await client.get(
        `/repos/${repo.owner}/${repo.name}/rules/branches/${branchPath(branch)}`,
        ruleTypes,
      );
    } catch (error) {
      if (!(error instanceof GithubError) || error.stopsTheRead()) throw error;
      break;
    }
    if (applied.some((type) => GATING_REST_RULES.includes(type))) {
      rules.rulesets.push({ include: [include], exclude: [], gatesMerging: true });
    }
  }
  return rules;
}
