/**
 * Checks a parsed overview against what it points at: its own commit, which holds `artifact.md`
 * and its figures, and the repository's code at the commit its header names. Lo and the checker
 * run the same checks through their own readers, so an overview the checker passes shows in Lo
 * with nothing broken, and one Lo refuses whole fails the checker.
 */

import { checkCode, type CheckedCode } from './code.ts';
import { article, readCommit, type CommitContents, type Sizes } from './commit.ts';
import { ARTIFACT, Findings, quote, type Finding } from './findings.ts';
import type { Header } from './header.ts';
import { CHECK_TIMEOUT, FORMAT } from './limits.ts';
import type { ParsedArtifact } from './parse.ts';
import type { CodeReader, OverviewFiles } from './readers.ts';

/**
 * What Lo does with an overview.
 *
 * - `invalid`: it can't be read as an overview, and the findings say why. Lo shows the pull
 *   request's diff instead.
 * - `newer`: it's written in a format newer than this version reads.
 * - `tooLarge`: its text, or its commit's files and folders or bytes, are past their limits.
 * - `shown`: Lo shows it, with each target's code resolved, broken or unread. Its commit may still
 *   hold what an overview can't, which Lo never reads and the checker refuses.
 */
export type Outcome =
  | { kind: 'invalid' }
  | { kind: 'newer'; format: number }
  | { kind: 'tooLarge'; what: 'text' | 'entries' | 'bytes'; sizes: Sizes }
  | { kind: 'shown'; header: Header; code: CheckedCode[] };

export interface CheckedArtifact {
  outcome: Outcome;
  /**
   * What's wrong with the overview, the parse's findings included, at most
   * {@link LIMITS.findings}. Any error fails the checker.
   */
  findings: Finding[];
}

export interface CheckOptions {
  /** The pull request whose ref the overview is on. A header naming another makes it invalid. */
  pr?: number | undefined;
  /** How long reading its code may take, in milliseconds: {@link CHECK_TIMEOUT} unless given. */
  timeout?: number | undefined;
  /** Stops reading its code: what isn't read by then is left unread. */
  signal?: AbortSignal | undefined;
}

/**
 * Checks `parsed`, the overview's `artifact.md` parsed, against `files`, the overview's commit, and
 * against the code its targets name, read through `readCode`. `parsed` is undefined when the commit
 * holds no file `artifact.md` to parse. Never rejects: a reader that fails or is too slow leaves
 * code unread.
 */
export async function checkArtifact(
  parsed: ParsedArtifact | undefined,
  files: OverviewFiles,
  readCode: CodeReader,
  options: CheckOptions = {},
): Promise<CheckedArtifact> {
  try {
    return await check(parsed, files, readCode, options);
  } catch {
    // Nothing above throws on what a reader gives, so this is a backstop: an overview that makes a
    // step fail is refused, saying only that.
    return unreadable("Lo couldn't check the overview, for a reason it can't name.");
  }
}

async function check(
  parsed: ParsedArtifact | undefined,
  files: OverviewFiles,
  readCode: CodeReader,
  options: CheckOptions,
): Promise<CheckedArtifact> {
  const tree = new Findings();
  const commit = readCommit(files.entries, tree);
  if (commit.artifact !== 'file') {
    // What was parsed, if anything, isn't the overview's text.
    const findings = new Findings();
    if (commit.artifact === undefined) {
      findings.add(
        'artifact-missing',
        undefined,
        `The overview's commit has no artifact.md, the overview's text.${otherCase(commit, ARTIFACT)}`,
      );
    } else {
      findings.add(
        'artifact-not-file',
        undefined,
        `artifact.md is ${article(commit.artifact)}. It's the overview's text, a file.`,
      );
    }
    for (const finding of tree.list()) findings.keep(finding);
    return { outcome: { kind: 'invalid' }, findings: findings.list() };
  }
  if (!parsed) return unreadable("Lo couldn't read artifact.md, for a reason it can't name.");
  // A newer format may hold what this version doesn't know: only the parse's word on it counts.
  if (parsed.format !== undefined && parsed.format > FORMAT) {
    return { outcome: { kind: 'newer', format: parsed.format }, findings: parsed.findings };
  }

  const findings = new Findings();
  for (const finding of parsed.findings) findings.keep(finding);
  for (const finding of tree.list()) findings.keep(finding);
  const past = parsed.findings.some(({ code }) => code === 'too-large') ? 'text' : commit.past;
  if (past !== undefined) {
    return {
      outcome: { kind: 'tooLarge', what: past, sizes: commit.sizes },
      findings: findings.list(),
    };
  }

  const invalid = parsed.findings.some(({ severity }) => severity === 'error');
  const { header } = parsed;
  let mismatch = false;
  if (header && options.pr !== undefined && header.pr !== options.pr) {
    mismatch = true;
    findings.add(
      'pr-mismatch',
      undefined,
      `The header says pr: ${header.pr}, and the overview is on pull request #${options.pr}.`,
    );
  }
  for (const { path, line } of parsed.figures) {
    const kind = commit.kinds.get(path);
    if (kind === undefined) {
      findings.add(
        'figure-missing',
        line,
        `${quote(path)} isn't in the overview's commit.${otherCase(commit, path)}`,
      );
    } else if (kind !== 'file') {
      findings.add('figure-not-file', line, `${quote(path)} is ${article(kind)}, not a file.`);
    }
  }
  // An invalid overview's code is checked too, so the checker reports all that's wrong at once.
  const code = header ? await codeOf(parsed, header, readCode, findings, options) : [];
  if (invalid || mismatch || !header) {
    return { outcome: { kind: 'invalid' }, findings: findings.list() };
  }
  return { outcome: { kind: 'shown', header, code }, findings: findings.list() };
}

/** Checks the code `parsed` names at `header`'s commit, within the time `options` allows. */
async function codeOf(
  parsed: ParsedArtifact,
  header: Header,
  readCode: CodeReader,
  findings: Findings,
  options: CheckOptions,
): Promise<CheckedCode[]> {
  const stop = new AbortController();
  const outer = options.signal;
  const abort = (): void => stop.abort();
  if (outer?.aborted) stop.abort();
  outer?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutOf(options.timeout));
  try {
    return await checkCode(parsed.references, header.commit, readCode, findings, stop.signal);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', abort);
  }
}

/** `timeout`, if it's a number of milliseconds a timer can wait; otherwise the default. */
function timeoutOf(timeout: number | undefined): number {
  if (timeout === undefined || !Number.isFinite(timeout) || timeout < 0) return CHECK_TIMEOUT;
  // The longest a timer waits: past it, a timer fires at once.
  return Math.min(timeout, 2 ** 31 - 1);
}

/** An overview refused for `message`, a reason that isn't its own. */
function unreadable(message: string): CheckedArtifact {
  const findings = new Findings();
  findings.add('unreadable', undefined, message);
  return { outcome: { kind: 'invalid' }, findings: findings.list() };
}

/** A sentence naming a path in the commit that differs from `path` only in case, when there is one. */
function otherCase(commit: CommitContents, path: string): string {
  const lower = path.toLowerCase();
  // The first in order of their paths, so a listing in any order names the same.
  let other: string | undefined;
  for (const listed of commit.kinds.keys()) {
    if (
      listed !== path &&
      listed.toLowerCase() === lower &&
      (other === undefined || listed < other)
    ) {
      other = listed;
    }
  }
  return other === undefined
    ? ''
    : ` It has ${quote(other)}: names match exactly, in the same case.`;
}
