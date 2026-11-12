// What the overview's view says: who wrote it and when, why it can't be shown (its findings by
// line, its sizes by kind, the format it's in) and why it couldn't be read, with when Lo tries
// again. Plain functions of what main and the check found, so each wording is tested alone.

import { FORMAT, LIMITS, type Finding, type SizeKind, type Sizes } from '@lo/artifact';

import type { Byline, Problem } from '../contract.ts';

/** `seconds` in the largest whole unit, or nothing under a minute. */
function whole(seconds: number): string | undefined {
  if (seconds < 60) return undefined;
  const [count, unit] =
    seconds < 3_600
      ? [Math.floor(seconds / 60), 'minute']
      : seconds < 86_400
        ? [Math.floor(seconds / 3_600), 'hour']
        : [Math.floor(seconds / 86_400), 'day'];
  if (count === 1) return unit === 'hour' ? 'an hour' : `a ${unit}`;
  return `${count} ${unit}s`;
}

/** How long before `now` `then` was: "just now", "5 minutes ago", "2 days ago". */
export function ago(then: number, now: number): string {
  const said = whole(Math.floor(Math.max(0, now - then) / 1000));
  return said === undefined ? 'just now' : `${said} ago`;
}

/** How long until `then`, from `now`, for what counts down: "in 8 s", "in 2 minutes". */
export function until(then: number, now: number): string {
  const seconds = Math.max(1, Math.ceil((then - now) / 1000));
  if (seconds < 60) return `in ${seconds} s`;
  return `in ${whole(Math.ceil(seconds / 60) * 60) ?? `${seconds} s`}`;
}

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

/** A commit's short ID, as the byline and the reports write it. */
export function shortId(id: string): string {
  return id.slice(0, 7);
}

/** `count` and a noun, made plural past one: "1 problem", "2 problems". */
function counted(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/** A size in bytes as people read it: "820 bytes", "48 KB", "74 MB". */
export function bytes(size: number): string {
  if (size < 1024) return counted(size, 'byte');
  const kb = size / 1024;
  if (kb < 1024) return `${Math.round(kb).toLocaleString('en-US')} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, '') : Math.round(mb).toLocaleString('en-US')} MB`;
}

/**
 * Where a finding is, as the report's first column says it: its line, and the file when it isn't
 * `artifact.md` itself, or the file alone.
 */
export function findingPlace(finding: Finding): string {
  const own = finding.file === 'artifact.md';
  if (finding.line !== undefined) {
    return own ? `line ${finding.line}` : `${finding.file}, line ${finding.line}`;
  }
  return own ? 'artifact.md' : finding.file;
}

/** What the "can't be read" report says of the findings: "The checker found 2 problems". */
export function invalidSummary(findings: readonly Finding[]): string {
  const errors = findings.filter((each) => each.severity === 'error').length;
  return errors === 0
    ? 'Lo found a problem in the overview.'
    : `Lo found ${counted(errors, 'problem')} in the overview.`;
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

/** Why the overview is too large, against Lo's limit for what it's past. */
export function tooLargeWords(what: 'text' | 'entries' | 'bytes', sizes: Sizes): string {
  switch (what) {
    case 'text':
      return `Its artifact.md is larger than ${bytes(LIMITS.size)}, the most Lo reads.`;
    case 'entries':
      return `It holds more than ${counted(LIMITS.entries, 'file and folder', 'files and folders')}, and Lo shows overviews of up to ${LIMITS.entries.toLocaleString('en-US')}.`;
    case 'bytes': {
      const [largest] = sizes.kinds;
      const most =
        largest && largest.bytes > sizes.bytes / 2
          ? ` Most of it is ${kindName(largest.kind)}: ${counted(largest.files, 'file')}, ${bytes(largest.bytes)} in all.`
          : '';
      return `It's ${bytes(sizes.bytes)}, and Lo shows overviews up to ${bytes(LIMITS.commit)}.${most}`;
    }
    default:
      what satisfies never;
      return 'It’s past Lo’s limits.';
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
export function newerWords(format: number): string {
  return `It's written in format ${format.toLocaleString('en-US')}, and this Lo reads ${
    FORMAT === 1 ? 'format 1' : `formats 1 to ${FORMAT}`
  }.`;
}

/**
 * Why the ref couldn't be read, and when Lo tries again: "GitHub couldn't be reached while Lo read
 * refs/lo/pr/80. Trying again in 8 s."
 */
export function problemWords(problem: Problem, ref: string, now: number): string {
  const again = `Trying again ${until(problem.retryAt, now)}.`;
  switch (problem.kind) {
    case 'signedOut':
      return `${problem.login} is signed out, so Lo couldn't read ${ref}. Sign in again in Settings. ${again}`;
    case 'rateLimited':
      return problem.secondary
        ? `GitHub asked Lo to slow down while it read ${ref}. ${again}`
        : `GitHub's rate limit is used up, so Lo couldn't read ${ref}. ${again}`;
    case 'blocked':
      return `${problem.message.replace(/\.+$/, '')}. ${again}`;
    case 'offline':
      return `GitHub couldn't be reached while Lo read ${ref}. ${again}`;
    case 'failed':
      return `Lo couldn't read ${ref}: ${problem.message.replace(/\.+$/, '')}. ${again}`;
    default:
      problem satisfies never;
      return `Lo couldn't read ${ref}.`;
  }
}
