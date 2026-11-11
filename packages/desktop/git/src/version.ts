/** A git version, from `git --version`. */
export interface GitVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * The oldest git Lo runs: 2.41 added `--attr-source`, which keeps a repository's own
 * `.gitattributes` out of what Lo reads and checks out (2.40 added `git merge-tree --merge-base`,
 * which rebase-aware comparison needs). A git must also honor `GIT_NO_LAZY_FETCH`, which finding
 * git checks by asking it.
 */
export const MINIMUM_VERSION: GitVersion = { major: 2, minor: 41, patch: 0 };

/** Parses `git --version`'s output, such as `git version 2.39.5 (Apple Git-154)`. */
export function parseVersion(output: string): GitVersion | undefined {
  const words = output.trim().split(/\s+/);
  if (words[0] !== 'git' || words[1] !== 'version' || words[2] === undefined) return undefined;
  // Anything after the numbers, such as `.rc1`, `-rc1` or `.windows.1`, is ignored.
  const numbers: number[] = [];
  for (const part of words[2].split(/[.-]/)) {
    if (!/^\d+$/.test(part)) break;
    numbers.push(Number(part));
  }
  const [major, minor, patch = 0] = numbers;
  if (major === undefined || minor === undefined) return undefined;
  return { major, minor, patch };
}

/** Negative when `a` is older than `b`, zero when they're the same, positive when it's newer. */
export function compareVersions(a: GitVersion, b: GitVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function formatVersion(version: GitVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}
