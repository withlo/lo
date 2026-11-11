/**
 * A repository's trunks: its long-lived branches, which `findStacks` never makes a layer. They're
 * its default branch, and the branches its branch protection rules and branch rulesets name,
 * matched the way GitHub matches them.
 *
 * - **Branch protection rules** come from each pull request's base and head branch
 *   (`refUpdateRule { pattern }`), which anyone who can read the repository sees. The repository's
 *   own list (`branchProtectionRules`) is empty for anyone who can't administer it.
 * - **Rulesets** count only when they're active. One that names a branch exactly, such as
 *   `refs/heads/develop` or `~DEFAULT_BRANCH`, makes it a trunk whatever it enforces, even only
 *   GitHub's defaults for a new ruleset (no deletions, no force pushes). One that matches by
 *   pattern counts only when it gates merging, with a rule that requires a pull request, a merge
 *   queue, status checks or deployments, or restricts updates: branches nobody pushes work to. A
 *   pattern ruleset that only enforces a policy, such as signed commits or Copilot review, often
 *   covers work branches too.
 * - **A rule that covers every branch** says nothing about which are long-lived, so it makes no
 *   branch a trunk: an include of `~ALL` or of wildcards alone (`*`, `?` and `/`, after
 *   `refs/heads/`), in a ruleset without excludes, or a protection rule's `*`. With excludes, such a
 *   ruleset protects everything but the excluded branches, and those it covers are trunks.
 *
 * A long-lived branch that nothing protects can't be told from a work branch.
 */

import type { RefNames } from '@lo/github';

import type { PullRequest } from './stacks.ts';

/** The special name a ruleset includes or excludes the default branch by. */
export const DEFAULT_BRANCH = '~DEFAULT_BRANCH';
/** The special name a ruleset includes every branch by. */
export const ALL = '~ALL';
/** What a ruleset's ref name patterns match a branch's name after. */
const HEADS = 'refs/heads/';

/** What decides a repository's trunks. */
export interface Trunks {
  /** `defaultBranchRef { name }`, or nothing for an empty repository. */
  readonly defaultBranch: string | undefined;
  /** The patterns of the branch protection rules that cover its pull requests' branches, matched against branch names. */
  readonly protected: readonly string[];
  /** The ref name conditions of the repository's active branch rulesets. */
  readonly rulesets: readonly RefNames[];
}

/** No default branch, protection or rulesets: no trunks. */
export const NO_TRUNKS: Trunks = { defaultBranch: undefined, protected: [], rulesets: [] };

/**
 * Whether `branch` is a trunk: the default branch, or a branch a protection rule or ruleset names,
 * other than by covering every branch.
 */
export function isTrunk(trunks: Trunks, branch: string): boolean {
  const { defaultBranch } = trunks;
  return (
    defaultBranch === branch ||
    trunks.protected.some((pattern) => !coversEveryBranch(pattern) && fnmatch(pattern, branch)) ||
    trunks.rulesets.some((ruleset) => names(ruleset, branch, defaultBranch))
  );
}

/**
 * The trunks among the branches `prs` target or come from, for `findStacks`: the default branch
 * first, then the others by name. A fork's branch is never one, whatever its name.
 */
export function trunksAmong(trunks: Trunks, prs: readonly PullRequest[]): string[] {
  const branches = new Set([
    ...prs.map((pr) => pr.baseRef),
    ...prs.filter((pr) => pr.headInBaseRepo).map((pr) => pr.headRef),
  ]);
  const { defaultBranch } = trunks;
  if (defaultBranch !== undefined) branches.delete(defaultBranch);
  const others = [...branches]
    .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .filter((branch) => isTrunk(trunks, branch));
  return defaultBranch === undefined ? others : [defaultBranch, ...others];
}

/** Whether `ruleset`'s condition covers `branch`, as GitHub decides. */
export function covers(
  ruleset: RefNames,
  branch: string,
  defaultBranch: string | undefined,
): boolean {
  const matches = (pattern: string) => refMatches(pattern, branch, defaultBranch);
  return ruleset.include.some(matches) && !ruleset.exclude.some(matches);
}

/**
 * Whether `ruleset` names `branch` as a trunk: it covers it by an exact include, or by a pattern
 * while it gates merging. A pattern that covers every branch counts only with excludes.
 */
function names(ruleset: RefNames, branch: string, defaultBranch: string | undefined): boolean {
  const matches = (pattern: string) => refMatches(pattern, branch, defaultBranch);
  const everythingBut = ruleset.exclude.length > 0;
  const counts = (pattern: string) =>
    isExact(pattern) || (ruleset.gatesMerging && (everythingBut || !coversEveryBranch(pattern)));
  return ruleset.include.filter(counts).some(matches) && !ruleset.exclude.some(matches);
}

/** Whether a ruleset's ref name pattern matches `branch`. */
function refMatches(pattern: string, branch: string, defaultBranch: string | undefined): boolean {
  if (pattern === ALL) return true;
  if (pattern === DEFAULT_BRANCH) return defaultBranch === branch;
  return fnmatch(pattern, `${HEADS}${branch}`);
}

/**
 * Whether a ruleset's include names one branch: `~DEFAULT_BRANCH`, or a full ref name without
 * wildcards or sets.
 */
export function isExact(pattern: string): boolean {
  return pattern === DEFAULT_BRANCH || (pattern.startsWith(HEADS) && !/[*?[\\]/.test(pattern));
}

/**
 * Whether a protection rule's or ruleset's pattern covers every branch, or nearly: `~ALL`, or a
 * pattern of `*`, `?` and `/` alone, after a ruleset's `refs/heads/`.
 */
function coversEveryBranch(pattern: string): boolean {
  const wildcards = pattern.startsWith(HEADS) ? pattern.slice(HEADS.length) : pattern;
  return pattern === ALL || /^[*?/]+$/.test(wildcards);
}

/**
 * Whether `name` matches `pattern` as Ruby's `File.fnmatch` with `File::FNM_PATHNAME` decides, which
 * is how GitHub matches branch protection and ruleset patterns:
 *
 * - `*` matches any run of characters but `/`, and `?` any one character but `/`;
 * - `**` as a whole segment before a `/` matches any number of directories, none included; `**`
 *   anywhere else is `*`;
 * - `[set]` matches one character in the set, which can hold ranges such as `a-z`, and `[!set]` one
 *   character outside it;
 * - `\` makes the next character plain, as in Ruby.
 *
 * GitHub doesn't support `{a,b}` (`File::FNM_EXTGLOB`), so braces are plain characters. It says a
 * set can't be complemented with `^` and `\` can't quote, without saying what they do instead; here
 * `^` is plain and `\` escapes. A branch's name can hold none of `\ ^ [ * ?`, so a pattern that
 * relies on either matches nothing real. Matching is case-sensitive, as git's names are.
 */
export function fnmatch(pattern: string, name: string): boolean {
  return matchSegments(pattern.split('/'), name.split('/'));
}

/** Matches a pattern's segments, split at `/`, against a name's. */
function matchSegments(pattern: readonly string[], name: readonly string[]): boolean {
  const [first, ...rest] = pattern;
  if (first === undefined) return name.length === 0;
  // `**/`: any number of directories, none included.
  if (first === '**' && rest.length > 0) {
    for (let skip = 0; skip <= name.length; skip++) {
      if (matchSegments(rest, name.slice(skip))) return true;
    }
    return false;
  }
  const [segment, ...nameRest] = name;
  if (segment === undefined) return false;
  return matchSegment(first, segment) && matchSegments(rest, nameRest);
}

/** Matches one segment of a pattern, which holds no `/`, against one segment of a name. */
function matchSegment(patternText: string, nameText: string): boolean {
  // By code point, as git's names and GitHub's patterns are matched.
  const pattern = Array.from(patternText);
  const name = Array.from(nameText);
  let p = 0;
  let n = 0;
  // Where to go on from after the last `*`: the pattern after it, and the name it has taken so far.
  let star: { after: number; taken: number } | undefined;
  while (n < name.length) {
    const c = pattern[p];
    const at = name[n] ?? '';
    if (c === '*') {
      star = { after: p + 1, taken: n };
      p += 1;
      continue;
    }
    let step: number | undefined;
    if (c === '?') step = 1;
    else if (c === '[') {
      const used = bracket(pattern.slice(p + 1), at);
      step = used === undefined ? undefined : used + 1;
    } else if (c === '\\' && p + 1 < pattern.length) step = pattern[p + 1] === at ? 2 : undefined;
    else if (c !== undefined) step = c === at ? 1 : undefined;
    if (step !== undefined) {
      p += step;
      n += 1;
    } else if (star) {
      // Let the last `*` take one more character, and try again from after it.
      star = { after: star.after, taken: star.taken + 1 };
      p = star.after;
      n = star.taken;
    } else {
      return false;
    }
  }
  return pattern.slice(p).every((rest) => rest === '*');
}

/**
 * Matches `c` against the set that starts just after a `[`, giving how many characters of `pattern`
 * the set takes up to and including its `]`, or nothing when `c` isn't in the set or the set never
 * ends. A `]` straight after the `[` or `[!` ends an empty set, as in Ruby.
 */
function bracket(pattern: readonly string[], c: string): number | undefined {
  const complement = pattern[0] === '!';
  let at = complement ? 1 : 0;
  // A character of the set, with a `\` before it taken as an escape.
  const plain = (from: number): [string, number] | undefined => {
    const first = pattern[from];
    if (first === undefined) return undefined;
    if (first !== '\\') return [first, from + 1];
    const escaped = pattern[from + 1];
    return escaped === undefined ? undefined : [escaped, from + 2];
  };
  let found = false;
  for (;;) {
    const next = pattern[at];
    if (next === undefined) return undefined;
    if (next === ']') {
      at += 1;
      break;
    }
    const low = plain(at);
    if (!low) return undefined;
    at = low[1];
    const range = pattern[at] === '-' && pattern[at + 1] !== undefined && pattern[at + 1] !== ']';
    let high = low[0];
    if (range) {
      const end = plain(at + 1);
      if (!end) return undefined;
      [high, at] = end;
    }
    const code = c.codePointAt(0) ?? -1;
    found ||= (low[0].codePointAt(0) ?? 0) <= code && code <= (high.codePointAt(0) ?? 0);
  }
  return found !== complement ? at : undefined;
}
