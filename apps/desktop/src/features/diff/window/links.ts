// GitHub's links into a pull request's changes: a file's place, and a line's, as `yl` copies them and
// `gx` opens them.

/** A pull request on github.com. */
export interface PullName {
  owner: string;
  repo: string;
  number: number;
}

/** The SHA-256 of `text` in hex, as GitHub names a file's place in a pull request's changes. */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * GitHub's link to a file in a pull request's changes, at a line if given: `L` and the old line's
 * number on the old side, `R` and the new line's on the new. A path that isn't UTF-8 has no anchor
 * GitHub would find, so its link is to the changes as a whole.
 */
export async function changesLink(
  pull: PullName,
  path: { text: string; hex?: string | undefined },
  line?: { side: 'old' | 'new'; line: number },
): Promise<string> {
  const files = `https://github.com/${pull.owner}/${pull.repo}/pull/${pull.number}/files`;
  if (path.hex !== undefined) return files;
  const anchor = `#diff-${await sha256(path.text)}`;
  if (!line) return `${files}${anchor}`;
  return `${files}${anchor}${line.side === 'old' ? 'L' : 'R'}${line.line}`;
}
