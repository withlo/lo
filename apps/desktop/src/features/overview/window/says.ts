// What the overview's view says: who wrote it and when, and whose copy it is; why it can't be shown
// (its findings by line, its sizes by kind, the format it's in) and why it couldn't be fetched,
// with when it's fetched again; the terms it adds and changes; why the repo's definitions can't be
// used, and why a term's row can't offer what they hold. Plain functions of what main and the check
// found, so each wording is tested alone.

import {
  FORMAT,
  LIMITS,
  STORE_LIMITS,
  type Account,
  type Finding,
  type SizeKind,
  type Sizes,
} from '@lo/artifact';
import { ago, bytes, clock, plainName } from '@lo/ui';

import { explain } from '../../../window/explain.ts';
import type { PullState } from '../../tab/contract.ts';
import type { Byline, OverviewCommit, Problem } from '../contract.ts';
import type { Copy } from './facts.ts';
import type { StoreFailure } from './terms.ts';

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

/** What an overview's byline says, after `·`, of the copy it shows. */
export function copyLabel(copy: Copy): string {
  switch (copy) {
    case 'fork':
      return 'from fork';
    case 'kept':
      return 'copy from fork';
    case 'saved':
      return 'saved copy';
    default:
      copy satisfies never;
      throw new Error(`A copy Lo doesn’t know: ${JSON.stringify(copy)}.`);
  }
}

/**
 * The line at the top of an overview whose glossary adds or changes terms, as a pull request in
 * state `state` does them: "Adds 2 definitions · changes 1", "Changes 3 definitions"; once it's
 * merged, as done: "Added 2 definitions · changed 1"; and closed without merging, as what it
 * would have done, one fact: "Would have added 2 definitions and changed 1". None when it does
 * neither.
 */
export function definitionsLine(
  added: number,
  changed: number,
  state: PullState,
): string | undefined {
  const [adds, changes, changesAlone] = LINE_WORDS[state];
  if (added > 0 && changed > 0) {
    return `${adds} ${counted(added, 'definition')}${changes} ${changed.toLocaleString('en-US')}`;
  }
  if (added > 0) return `${adds} ${counted(added, 'definition')}`;
  if (changed > 0) return `${changesAlone} ${counted(changed, 'definition')}`;
  return undefined;
}

/**
 * The line's words, by state: for adding; for changing after it, with what joins the two, `·`
 * between two facts, or "and" within one, for what a closed pull request would have done; and for
 * changing alone.
 */
const LINE_WORDS: Readonly<Record<PullState, readonly [string, string, string]>> = {
  open: ['Adds', ' · changes', 'Changes'],
  draft: ['Adds', ' · changes', 'Changes'],
  merged: ['Added', ' · changed', 'Changed'],
  closed: ['Would have added', ' and changed', 'Would have changed'],
};

/** The title of the Glossary section's note, when the repo's definitions can't be used. */
export const STORE_TITLE = 'Can’t read the repo’s glossary';

/** What the note says last: each definition shown is the overview's own. */
export const OWN_DEFINITIONS = 'These definitions are this overview’s own.';

/**
 * Why what a term's row offers from the repo's glossary can't be had for it: they're still being
 * read, the repo has none, or they don't hold it, as a term an open pull request adds, which joins
 * it as the pull request merges, or one the overview's own glossary doesn't list, which has no row
 * in it.
 */
export const GLOSSARY_READING = 'Reading the glossary…';
export const NO_GLOSSARY = 'This repo has no glossary';
export const NOT_IN_GLOSSARY = 'Not in the glossary';
export const NOT_IN_THIS_GLOSSARY = 'Not in this overview’s glossary';

/** Why a term pull request `number` adds isn't in the repo's glossary yet. */
export function joinsGlossary(number: number): string {
  return `Joins the glossary when #${number} merges`;
}

/** The words that say who a writer is, in a line: their login, or the name their commit gives. */
export function writerName(by: Account): string {
  return 'login' in by ? by.login : by.name;
}

/**
 * Why the repo's definitions can't be used, for any cause but GitHub's, which `problemReason`
 * words: the cause, with a file's name in backticks, which the note draws as code, or nothing
 * where it isn't known; what's behind Details, the parser's own words; and whether trying again
 * could help, which it can't for a store that's past its limits or can't be read, until it changes.
 */
export function storeReason(why: Exclude<StoreFailure, { kind: 'problem' }>): {
  cause: string;
  details?: string | undefined;
  again: boolean;
} {
  switch (why.kind) {
    case 'tooMany':
      return {
        cause: `It’s over ${STORE_LIMITS.terms.toLocaleString('en-US')} terms.`,
        again: false,
      };
    case 'tooLarge':
      return { cause: `It’s larger than ${bytes(STORE_LIMITS.size)}.`, again: false };
    case 'invalid': {
      const { at, code, message } = why.problem;
      const details = at === undefined ? message : `${at}: ${message}`;
      // One in a format a newer Lo writes says so, as an overview does.
      const cause = code === 'format-newer' ? NEWER_REASON : '`terms.json` can’t be read.';
      return { cause, details, again: false };
    }
    case 'notStore':
      return { cause: '`terms.json` can’t be read.', again: false };
    case 'failed':
      // Reading it on this computer: too long, out of memory, or a cause Lo can't tell.
      switch (why.code) {
        case 'timeout':
          return { cause: 'It took too long.', again: true };
        case 'memory':
          return { cause: 'It ran out of memory.', again: false };
        default:
          return { cause: '', again: true };
      }
    default:
      why satisfies never;
      throw new Error(`A failure Lo doesn’t know: ${JSON.stringify(why)}.`);
  }
}
