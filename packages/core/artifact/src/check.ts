/**
 * Checks a parsed overview against what it points at: its own commit, which holds `artifact.md`
 * and its figures, and the repository's code at the commit its header names. Lo and the checker
 * run the same checks through their own readers, so an overview the checker passes shows in Lo
 * with nothing broken, and one Lo refuses whole fails the checker.
 */

import { checkCode, type CheckedCode } from './code.ts';
import { article, caseIndex, readCommit, type Sizes } from './commit.ts';
import { checkFigures, type CheckedFigure } from './figures.ts';
import { ARTIFACT, Findings, quote, type Finding } from './findings.ts';
import type { Header } from './header.ts';
import { ARTIFACT_READ, CHECK_TIMEOUT, FORMAT, LIMITS } from './limits.ts';
import { tooLong, type ParsedArtifact } from './parse.ts';
import type { CodeReader, OverviewFiles } from './readers.ts';

/**
 * What Lo does with an overview.
 *
 * - `invalid`: it can't be read as an overview, and the findings say why. Lo shows the pull
 *   request's diff instead.
 * - `newer`: it's written in a format newer than this version reads.
 * - `tooLarge`: its text, or its commit's files and folders or bytes, are past their limits.
 * - `shown`: Lo shows it, with each target's code resolved, broken or unread, and each figure kept,
 *   left out or unread. Its commit may still hold what an overview can't, which Lo never reads and
 *   the checker refuses.
 */
export type Outcome =
  | { kind: 'invalid' }
  | { kind: 'newer'; format: number }
  | { kind: 'tooLarge'; what: 'text' | 'entries' | 'bytes'; sizes: Sizes }
  | { kind: 'shown'; header: Header; code: CheckedCode[]; figures: CheckedFigure[] };

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
  /**
   * How long reading its code and figures may take, in milliseconds: {@link CHECK_TIMEOUT} unless
   * given.
   */
  timeout?: number | undefined;
  /** Stops reading its code and figures: what isn't read by then is left unread. */
  signal?: AbortSignal | undefined;
}

/**
 * Checks `parsed`, the overview's `artifact.md` parsed, against `files`, the overview's commit, and
 * against the code its targets name, read through `readCode`. `parsed` is undefined when the commit
 * holds no file `artifact.md`, or one larger than {@link ARTIFACT_READ}, which isn't read: when the
 * listing gives it a larger size, it's too large, whatever was parsed. Never rejects: a reader that
 * fails or is too slow leaves code, or a figure, unread.
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
  given: ParsedArtifact | undefined,
  files: OverviewFiles,
  readCode: CodeReader,
  options: CheckOptions,
): Promise<CheckedArtifact> {
  const tree = new Findings();
  const commit = readCommit(files.entries, tree);
  // Made once, when a path that isn't there is first looked up in another case.
  let index: Map<string, string> | undefined;
  const otherCase = (path: string): string => {
    index ??= caseIndex(commit.kinds);
    const other = index.get(path.toLowerCase());
    return other === undefined || other === path
      ? ''
      : ` It has ${quote(other)}: names match exactly, in the same case.`;
  };

  const { artifact } = commit;
  if (artifact?.kind !== 'file') {
    // What was parsed, if anything, isn't the overview's text.
    const findings = new Findings();
    if (artifact === undefined) {
      findings.add(
        'artifact-missing',
        undefined,
        `The overview's commit has no artifact.md, the overview's text.${otherCase(ARTIFACT)}`,
      );
    } else {
      findings.add(
        'artifact-not-file',
        undefined,
        `artifact.md is ${article(artifact.kind)}. It's the overview's text, a file.`,
      );
    }
    for (const finding of tree.list()) findings.keep(finding);
    return { outcome: { kind: 'invalid' }, findings: findings.list() };
  }
  // The listing's size comes first: a file it says is too large to read isn't what was parsed, so
  // that parse is set aside, whatever it found.
  const listedLong = artifact.size !== undefined && artifact.size > ARTIFACT_READ;
  const parsed = listedLong ? undefined : given;
  // A newer format may hold what this version doesn't know, other files or more of them included:
  // only the parse's word on it counts.
  if (parsed?.format !== undefined && parsed.format > FORMAT) {
    return { outcome: { kind: 'newer', format: parsed.format }, findings: parsed.findings };
  }

  const findings = new Findings();
  const long = listedLong || (parsed?.findings.some(({ code }) => code === 'too-large') ?? false);
  if (parsed) for (const finding of parsed.findings) findings.keep(finding);
  else if (long) tooLong(findings);
  for (const finding of tree.list()) findings.keep(finding);
  const past = long ? 'text' : commit.past;
  if (past !== undefined) {
    return {
      outcome: { kind: 'tooLarge', what: past, sizes: commit.sizes },
      findings: findings.list(),
    };
  }
  if (!parsed) return unreadable("Lo couldn't read artifact.md, for a reason it can't name.");
  if (commit.unsized !== undefined) {
    return unreadable(
      `Lo couldn't tell how large ${quote(commit.unsized)} is, so it couldn't check the overview's size.`,
    );
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
  // An invalid overview's figures and code are checked too, so the checker reports all that's
  // wrong at once. Past the limit on figures, the overview is invalid, and the rest aren't looked
  // for.
  const { code, figures } = await withDeadline(options, async (signal) => ({
    figures: await checkFigures(
      parsed.figures.slice(0, LIMITS.figures),
      commit.kinds,
      (path, cap, stop) => files.read(path, cap, stop),
      findings,
      signal,
      otherCase,
    ),
    code: header
      ? await checkCode(parsed.references, header.commit, readCode, findings, signal)
      : [],
  }));
  if (invalid || mismatch || !header) {
    return { outcome: { kind: 'invalid' }, findings: findings.list() };
  }
  return { outcome: { kind: 'shown', header, code, figures }, findings: findings.list() };
}

/** Runs `read` with a signal that aborts once `options`' signal does, or its time is up. */
async function withDeadline<T>(
  options: CheckOptions,
  read: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const stop = new AbortController();
  const outer = options.signal;
  const abort = (): void => stop.abort();
  if (outer?.aborted) stop.abort();
  outer?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutOf(options.timeout));
  try {
    return await read(stop.signal);
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
