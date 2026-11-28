/**
 * Checks a parsed overview against what it points at: its own commit, which holds `artifact.md`
 * and its figures, and the repository's code at the commit its header names. Lo and the checker
 * run the same checks through their own readers, so an overview the checker passes shows in Lo
 * with nothing broken, and one Lo refuses whole fails the checker.
 */

import { checkCode, type CheckedCode } from './code.ts';
import { article, caseIndex, readCommit, type Sizes } from './commit.ts';
import { checkFigures, type CheckedFigure } from './figures.ts';
import { ARTIFACT, Findings, quote, type Finding, type FindingCode } from './findings.ts';
import type { Header } from './header.ts';
import { ARTIFACT_READ, CHECK_TIMEOUT, FORMAT, LIMITS } from './limits.ts';
import { tooLong, type ParsedArtifact } from './parse.ts';
import type { GlossaryEntry } from './reading.ts';
import type { CodeReader, OverviewFiles } from './readers.ts';
import { utf8Length } from './source.ts';
import { STORE_LIMITS, STORE_REF, type StoreRead } from './store.ts';

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

export type CheckOptions = {
  /**
   * How long reading its code and figures may take, in milliseconds: {@link CHECK_TIMEOUT} unless
   * given.
   */
  timeout?: number | undefined;
  /** Stops reading its code and figures: what isn't read by then is left unread. */
  signal?: AbortSignal | undefined;
  /**
   * The repository's definitions, as read from {@link STORE_REF}, which the glossary's marks are
   * checked against: each term it doesn't mark must be there with the same definition, each it
   * marks new must not be there, and each it marks changed must be there with another. Without
   * them, the marks aren't checked.
   */
  store?: StoreRead | undefined;
} & OnRef;

/**
 * The ref the overview is on, which its header must name: a pull request's, a stack's, or, when
 * neither is given, any.
 */
export type OnRef =
  | {
      /**
       * The pull request whose ref the overview is on, `refs/lo/pr/<pr>`. A header naming another,
       * or a stack's overview, makes it invalid.
       */
      pr?: number | undefined;
      stack?: undefined;
    }
  | {
      /**
       * The stack whose ref the overview is on, `refs/lo/stack/<stack>`. A header naming another,
       * or a pull request's overview, makes it invalid.
       */
      stack?: number | undefined;
      pr?: undefined;
    };

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
  const other = header ? mismatchOf(header, options) : undefined;
  if (other) findings.add(other[0], undefined, other[1]);
  const mismatch = other !== undefined;
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
  // Like the code, the marks are the overview's to get right, but Lo shows it all the same.
  checkMarks(parsed.glossary, options.store, findings);
  if (invalid || mismatch || !header) {
    return { outcome: { kind: 'invalid' }, findings: findings.list() };
  }
  return { outcome: { kind: 'shown', header, code, figures }, findings: findings.list() };
}

/**
 * Adds what's wrong with the marks of `glossary`, the overview's: a marked term's definition that
 * the repository's definitions can't hold, and, given `store`, each mark that doesn't say how the
 * term stands to them.
 */
function checkMarks(
  glossary: readonly GlossaryEntry[],
  store: StoreRead | undefined,
  findings: Findings,
): void {
  for (const { name, mark, line, definition, storable } of glossary) {
    if (mark === undefined || storable) continue;
    const length = definition === undefined ? 0 : utf8Length(definition, Infinity);
    findings.add(
      'mark-definition',
      line,
      length > STORE_LIMITS.definition
        ? `"${quote(name)}" is marked (${mark}), and its definition is ${length.toLocaleString('en-US')} bytes. The repository's definitions hold at most ${STORE_LIMITS.definition.toLocaleString('en-US')}: shorten it, or take the mark off.`
        : `"${quote(name)}" is marked (${mark}), so its definition goes into the repository's definitions, which hold one paragraph of text, inline code and links to code and terms. Write it so, or take the mark off.`,
    );
  }
  if (store === undefined || glossary.length === 0) return;
  if (!store.ok) {
    findings.add(
      'store-unread',
      undefined,
      `The repository's definitions, at ${STORE_REF}, can't be read, so the glossary's marks weren't checked. ${store.problem.message}`,
    );
    return;
  }
  const { names, terms } = store.store;
  for (const { name, key, mark, line, definition } of glossary) {
    const owner = names.get(key);
    const stored = owner === undefined ? undefined : terms.get(owner);
    const term = `"${quote(name)}"`;
    if (stored === undefined) {
      if (mark === 'new') continue;
      findings.add(
        'term-not-stored',
        line,
        mark === 'changed'
          ? `${term} is marked (changed), and the repository's definitions don't have it. Mark it (new).`
          : `The repository's definitions don't have ${term}. Mark it (new): **${quote(name)}** (new): definition.`,
      );
      continue;
    }
    const same = definition !== undefined && sameDefinition(definition, stored.definition);
    // A term may be in them as another's alias.
    const as = stored.key === key ? '' : `, as another name for "${quote(stored.term)}"`;
    if (mark === 'new') {
      findings.add(
        'term-stored',
        line,
        same
          ? `${term} is marked (new), and the repository's definitions have it${as}, with this definition. Take the mark off.`
          : `${term} is marked (new), and the repository's definitions have it${as}. Mark it (changed) to change its definition.`,
      );
    } else if (mark === 'changed') {
      // A definition they can't hold is a finding of its own, above.
      if (same) {
        findings.add(
          'term-unchanged',
          line,
          `${term} is marked (changed), and its definition is the repository's${as} already. Take the mark off.`,
        );
      }
    } else if (!same) {
      findings.add(
        'term-differs',
        line,
        `${term}'s definition isn't the one in the repository's definitions${as}, which says "${quote(stored.definition)}". Write that, or mark it (changed): **${quote(name)}** (changed): definition.`,
      );
    }
  }
}

/** Whether two definitions, as written, are the same, but for the runs of spaces in them. */
function sameDefinition(a: string, b: string): boolean {
  const squeezed = (text: string): string => text.replace(/[ \t]+/g, ' ').trim();
  return squeezed(a) === squeezed(b);
}

/** What's wrong with `header` for the ref `options` say the overview is on: a code and a message. */
function mismatchOf(header: Header, options: CheckOptions): [FindingCode, string] | undefined {
  const { pr, stack } = options;
  if (pr !== undefined && header.pr === undefined) {
    return [
      'pr-mismatch',
      `This is the overview of stack ${header.stack}, and it's on pull request #${pr}. A pull request's overview says pr: ${pr}.`,
    ];
  }
  if (pr !== undefined && header.pr !== pr) {
    return [
      'pr-mismatch',
      `The header says pr: ${header.pr}, and the overview is on pull request #${pr}.`,
    ];
  }
  if (stack !== undefined && header.pr !== undefined) {
    return [
      'stack-mismatch',
      `This is the overview of pull request #${header.pr}, and it's on stack ${stack}. A stack's overview says stack: ${stack} in place of pr.`,
    ];
  }
  if (stack !== undefined && header.stack !== stack) {
    return [
      'stack-mismatch',
      `The header says stack: ${header.stack}, and the overview is on stack ${stack}.`,
    ];
  }
  return undefined;
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
