// What the overview's view says: who wrote it and when, why it can't be shown (its findings by
// line, its sizes by kind, the format it's in) and why it couldn't be fetched, with when it's
// fetched again. Plain functions of what main and the check found, so each wording is tested alone.

import { FORMAT, LIMITS, type Finding, type SizeKind, type Sizes } from '@lo/artifact';
import { ago, bytes, clock } from '@lo/ui';

import { explain } from '../../../window/explain.ts';
import type { Byline, OverviewCommit, Problem } from '../contract.ts';

/**
 * Who wrote an overview: their login, when GitHub matched the commit to an account; else the name
 * the commit gives its author, which anyone can write, so it's never drawn as Lo's own words; or
 * nobody Lo can name.
 */
export type Author =
  { kind: 'login'; login: string } | { kind: 'name'; name: string } | { kind: 'unknown' };

export function authorOf(byline: Byline): Author {
  if (byline.login !== null) return { kind: 'login', login: byline.login };
  const name = plainName(byline.name);
  return name === '' ? { kind: 'unknown' } : { kind: 'name', name };
}

/**
 * Quotation marks, straight and curly, what passes for them, and the dots that set the byline's
 * parts apart. An apostrophe between letters, as in O'Brien, isn't one.
 */
const MARKS = /["“”„‟«»‹›〝〞〟＂″‶ʺ˝״·•‧∙⋅・･ᐧ⸱⸳ꞏ]|(?<!\p{L})['‘’‚‛＇]|['‘’‚‛＇](?!\p{L})/gu;

/**
 * The name a commit gives its author, without what could close Lo's quotes around it early or pass
 * for the byline's own separators, on one line.
 */
function plainName(name: string): string {
  return name.replaceAll(MARKS, ' ').replaceAll(/\s+/g, ' ').trim();
}

/** Lines of a file, after its name and `·`: "line 3", "lines 3–9". */
export function linesOf({ start, end }: { start: number; end: number }): string {
  return start === end ? `line ${start}` : `lines ${start}–${end}`;
}

/** A commit's short ID, as the byline and the reports write it. */
export function shortId(id: string): string {
  return id.slice(0, 7);
}

/** `count` and a noun, made plural past one: "1 problem", "2 problems". */
function counted(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/**
 * Where a finding is, as Details lists it: its line, and the file when it isn't `artifact.md`
 * itself, or the file alone: "Line 12", "notes.md · line 3".
 */
export function findingPlace(finding: Finding): string {
  const own = finding.file === 'artifact.md';
  if (finding.line !== undefined) {
    return own ? `Line ${finding.line}` : `${finding.file} · line ${finding.line}`;
  }
  return own ? 'artifact.md' : finding.file;
}

/** Why an overview its check refused can't be shown: "It has 2 problems." */
export function invalidSummary(findings: readonly Finding[]): string {
  const errors = findings.filter((each) => each.severity === 'error').length;
  return `It has ${counted(Math.max(errors, 1), 'problem')}.`;
}

/**
 * The commit an overview is at, who wrote it and when, as Details starts: "a91c4e2 · ravi-k ·
 * 2 d ago", or the commit alone until main has read who wrote it.
 */
export function writtenText(commit: OverviewCommit, now: number): string {
  const { byline } = commit;
  const id = shortId(commit.id);
  if (byline === null) return id;
  const author = authorOf(byline);
  const who =
    author.kind === 'login'
      ? author.login
      : author.kind === 'name'
        ? `“${author.name}”`
        : undefined;
  return [id, who, ago(byline.at, now)].filter((part) => part !== undefined).join(' · ');
}

/** A kind of file, as the "too large" report names it. */
export function kindName(kind: SizeKind): string {
  switch (kind) {
    case 'artifact':
      return 'artifact.md';
    case 'svg':
      return 'SVG figures';
    case 'png':
      return 'PNG figures';
    case 'jpg':
    case 'jpeg':
      return 'JPEG figures';
    case 'gif':
      return 'GIF figures';
    case 'webp':
      return 'WebP figures';
    case 'other':
      return 'Other files';
    default:
      kind satisfies never;
      return 'Other files';
  }
}

/** Why the overview is too large, against the limit for what it's past. */
export function tooLargeWords(what: 'text' | 'entries' | 'bytes', sizes: Sizes): string {
  switch (what) {
    case 'text':
      return `Its text is over the ${bytes(LIMITS.size)} limit.`;
    case 'entries':
      return `It has more than ${counted(LIMITS.entries, 'file and folder', 'files and folders')}.`;
    case 'bytes':
      return `It’s ${bytes(sizes.bytes, 'up')}, over the ${bytes(LIMITS.commit)} limit.`;
    default:
      what satisfies never;
      return 'It’s over the size limit.';
  }
}

/** The sizes of each kind of file, largest first, as the "too large" report lists them. */
export function sizeRows(sizes: Sizes): { kind: string; size: string }[] {
  return sizes.kinds.map((each) => ({
    kind: kindName(each.kind),
    size: `${counted(each.files, 'file')} · ${bytes(each.bytes)}`,
  }));
}

/** Why an overview in a newer format can't be shown. */
export const NEWER_REASON = 'It needs a newer version of Lo.';

/**
 * The formats behind Details, for an overview in a newer one: "Format 2. This version reads
 * format 1."
 */
export function newerDetails(format: number): string {
  return `Format ${format.toLocaleString('en-US')}. This version reads ${
    FORMAT === 1 ? 'format 1' : `formats 1 to ${FORMAT}`
  }.`;
}

/**
 * Why the overview couldn't be fetched, as an error's reason says it: its cause, such as "GitHub
 * didn’t respond.", or nothing where it isn't known, and when it's fetched again, `retryAt`, which
 * the reason counts down after it ("Retrying in 8 s.") unless the cause says when itself. GitHub's
 * own words go behind Details.
 */
export function problemReason(problem: Problem): { cause: string; retryAt?: number | undefined } {
  const { retryAt } = problem;
  switch (problem.kind) {
    case 'signedOut':
      return { cause: `${problem.login} is signed out.` };
    case 'rateLimited':
      return problem.secondary
        ? { cause: 'GitHub’s rate limit was reached.', retryAt }
        : { cause: `GitHub’s rate limit resets at ${clock(retryAt)}.` };
    case 'blocked':
      return {
        cause:
          problem.why === 'sso'
            ? `${problem.org} requires single sign-on.`
            : `${problem.org} hasn’t approved Lo.`,
        retryAt,
      };
    case 'offline':
      return { cause: explain(problem.cause) ?? '', retryAt };
    case 'failed':
      return { cause: 'GitHub returned an error.', retryAt };
    default:
      problem satisfies never;
      return { cause: '', retryAt };
  }
}
