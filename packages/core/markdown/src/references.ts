/**
 * GitHub's references in plain text: `@login` and `@org/team` mentions, and `#123`,
 * `owner/repo#123` and `GH-123` issue and pull request references. Each is found by scanning from
 * its `@` or `#` with bounded look-behind, so any text costs time in proportion to its length.
 */

/** A repository on GitHub. */
export interface Repo {
  owner: string;
  name: string;
}

export type Found =
  | { kind: 'mention'; start: number; end: number; name: string; url: string }
  | { kind: 'reference'; start: number; end: number; url: string };

/** The longest login GitHub allows. */
const LOGIN = 39;
/** The longest repository name GitHub allows. */
const REPO = 100;
/** The longest team slug Lo reads. */
const TEAM = 100;
/** The largest issue number Lo reads, 2³¹ − 1. */
const NUMBER = 2_147_483_647;

/** Whether `code`, a UTF-16 unit, is a word character as GitHub's patterns read one. */
function isWord(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f
  );
}

function isAlnum(code: number): boolean {
  return isWord(code) && code !== 0x5f;
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** Whether `name` is a login GitHub allows: letters, digits and single hyphens between them. */
export function isLogin(name: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(name);
}

/** Whether `name` is a repository name GitHub allows. */
export function isRepoName(name: string): boolean {
  return name.length <= REPO && /^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..';
}

/** The mentions and references in `text`, in order, none overlapping. `#123` needs a `repo`. */
export function findReferences(text: string, repo: Repo | undefined): Found[] {
  const found: Found[] = [];
  // Where each marker next appears, searched again only once it's behind: searching for all
  // three each time would read the rest of the text once for every marker found.
  let mention = -1;
  let hash = -1;
  let gh = -1;
  let at = 0;
  while (at < text.length) {
    if (mention !== Infinity && mention < at) mention = position(text.indexOf('@', at));
    if (hash !== Infinity && hash < at) hash = position(text.indexOf('#', at));
    if (gh !== Infinity && gh < at) gh = position(text.indexOf('GH-', at));
    const next = Math.min(mention, hash, gh);
    if (next === Infinity) break;
    const match =
      next === mention
        ? mentionAt(text, next)
        : next === hash
          ? referenceAt(text, next, repo)
          : ghAt(text, next, repo);
    if (match && match.start >= at) {
      found.push(match);
      at = match.end;
    } else {
      at = next + 1;
    }
  }
  return found;
}

function position(index: number): number {
  return index === -1 ? Infinity : index;
}

/** The mention whose `@` is at `index`, read as GitHub's mention filter reads one. */
function mentionAt(text: string, index: number): Found | undefined {
  if (index > 0 && isWord(text.charCodeAt(index - 1))) return undefined;
  let end = index + 1;
  while (end < text.length && end - index - 1 <= LOGIN) {
    const code = text.charCodeAt(end);
    if (!isAlnum(code) && code !== 0x2d) break;
    end += 1;
  }
  const login = text.slice(index + 1, end);
  if (!isLogin(login)) return undefined;
  let name = login;
  let url = `https://github.com/${login}`;
  if (text.charCodeAt(end) === 0x2f) {
    let teamEnd = end + 1;
    while (teamEnd < text.length && teamEnd - end - 1 <= TEAM) {
      const code = text.charCodeAt(teamEnd);
      if (!isWord(code) && code !== 0x2d) break;
      teamEnd += 1;
    }
    const team = text.slice(end + 1, teamEnd);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(team)) return undefined;
    name = `${login}/${team}`;
    url = `https://github.com/orgs/${login}/teams/${team}`;
    end = teamEnd;
  }
  if (!endsAMention(text, end)) return undefined;
  return { kind: 'mention', start: index, end, name, url };
}

/** Whether a mention may end at `end`: before the text's end, dots and then a non-word, or a non-word that isn't a slash. */
function endsAMention(text: string, end: number): boolean {
  if (end >= text.length) return true;
  let after = end;
  while (after < text.length && text.charCodeAt(after) === 0x2e) after += 1;
  if (after > end) return after >= text.length || !isWord(text.charCodeAt(after));
  const code = text.charCodeAt(end);
  return !isWord(code) && code !== 0x2f;
}

/** The issue number written at `start`, and where it ends, if it's a whole number in range. */
function numberAt(text: string, start: number): { number: number; end: number } | undefined {
  let end = start;
  while (end < text.length && isDigit(text.charCodeAt(end)) && end - start <= 10) end += 1;
  if (end === start || end - start > 10) return undefined;
  if (end < text.length && isWord(text.charCodeAt(end))) return undefined;
  const number = Number(text.slice(start, end));
  if (!Number.isSafeInteger(number) || number < 1 || number > NUMBER) return undefined;
  return { number, end };
}

/** The reference whose `#` is at `index`: `#123` in `repo`, or `owner/repo#123` written before it. */
function referenceAt(text: string, index: number, repo: Repo | undefined): Found | undefined {
  const number = numberAt(text, index + 1);
  if (!number) return undefined;
  const named = repoBefore(text, index);
  if (named) {
    return {
      kind: 'reference',
      start: named.start,
      end: number.end,
      url: issueUrl(named.repo, number.number),
    };
  }
  if (!repo || !startsAReference(text, index)) return undefined;
  return { kind: 'reference', start: index, end: number.end, url: issueUrl(repo, number.number) };
}

/** `GH-123` at `index`, in `repo`. */
function ghAt(text: string, index: number, repo: Repo | undefined): Found | undefined {
  if (!repo || !startsAReference(text, index)) return undefined;
  const number = numberAt(text, index + 3);
  if (!number) return undefined;
  return { kind: 'reference', start: index, end: number.end, url: issueUrl(repo, number.number) };
}

/** Whether a reference may start at `index`: at the start, or after a non-word that isn't `/`, `#` or `&`. */
function startsAReference(text: string, index: number): boolean {
  if (index === 0) return true;
  const before = text.charCodeAt(index - 1);
  return !isWord(before) && before !== 0x2f && before !== 0x23 && before !== 0x26;
}

/** `owner/repo` written just before `index`, read backwards no further than the longest names. */
function repoBefore(text: string, index: number): { repo: Repo; start: number } | undefined {
  let slash = index;
  while (slash > 0 && index - slash < REPO) {
    const code = text.charCodeAt(slash - 1);
    if (!isWord(code) && code !== 0x2e && code !== 0x2d) break;
    slash -= 1;
  }
  if (slash === index || slash === 0 || text.charCodeAt(slash - 1) !== 0x2f) return undefined;
  const name = text.slice(slash, index);
  let start = slash - 1;
  while (start > 0 && slash - 1 - start < LOGIN) {
    const code = text.charCodeAt(start - 1);
    if (!isAlnum(code) && code !== 0x2d) break;
    start -= 1;
  }
  const owner = text.slice(start, slash - 1);
  if (!isLogin(owner) || !isRepoName(name)) return undefined;
  if (start > 0) {
    const before = text.charCodeAt(start - 1);
    if (isWord(before) || before === 0x2f || before === 0x2d || before === 0x2e) return undefined;
  }
  return { repo: { owner, name }, start };
}

function issueUrl(repo: Repo, number: number): string {
  return `https://github.com/${repo.owner}/${repo.name}/issues/${number}`;
}
