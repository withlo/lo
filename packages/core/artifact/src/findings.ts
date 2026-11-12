/**
 * What reading an overview found wrong with it. Lo's "can't be read" report and the checker show
 * the same findings, so each has a stable code, and its message says what's wrong and, where it
 * helps, what to write instead.
 */

import { LIMITS } from './limits.ts';

/**
 * Each finding's code, with whether it's an error, which makes the overview invalid, or a warning,
 * which leaves it shown.
 */
const SEVERITIES = {
  // The file.
  unreadable: 'error',
  'too-large': 'error',
  encoding: 'error',
  // The header.
  'header-missing': 'error',
  'header-unclosed': 'error',
  'header-line': 'error',
  'header-key': 'error',
  'header-twice': 'error',
  'format-missing': 'error',
  'format-invalid': 'error',
  'format-newer': 'error',
  'pr-missing': 'error',
  'pr-invalid': 'error',
  'commit-missing': 'error',
  'commit-invalid': 'error',
  // Sections and headings.
  'title-heading': 'error',
  'section-in-block': 'error',
  'tldr-first': 'error',
  'tldr-empty': 'error',
  'tldr-twice': 'error',
  'glossary-twice': 'error',
  'glossary-content': 'error',
  'glossary-item': 'error',
  // Blocks.
  'block-unknown': 'error',
  'block-unclosed': 'error',
  'block-unopened': 'error',
  'block-nesting': 'error',
  'block-misplaced': 'error',
  'block-argument': 'error',
  'block-content': 'error',
  'walkthrough-steps': 'error',
  'tabs-tabs': 'error',
  'step-text': 'error',
  'figure-path': 'error',
  'figure-caption': 'error',
  'figure-part': 'error',
  'figure-count': 'error',
  // Targets and terms.
  'target-path': 'error',
  'target-lines': 'error',
  'target-term': 'error',
  'target-count': 'error',
  'term-undefined': 'error',
  'term-twice': 'error',
  'term-unused': 'warning',
  // What Markdown shows differently from how it's written.
  'too-deep': 'error',
  'too-many-nodes': 'error',
  'raw-html': 'warning',
  'outside-image': 'warning',
  'dead-link': 'warning',
  'link-address': 'warning',
  // What the overview's commit holds.
  'artifact-missing': 'error',
  'artifact-not-file': 'error',
  'pr-mismatch': 'error',
  'tree-extra': 'error',
  'tree-count': 'error',
  'tree-size': 'error',
  'figure-missing': 'error',
  'figure-not-file': 'error',
  // The figures it shows.
  'figure-type': 'error',
  'figure-header': 'error',
  'figure-too-large': 'error',
  'figure-encoding': 'error',
  'figure-content': 'error',
  'figure-part-missing': 'error',
  'figure-color': 'warning',
  // The code its targets name, at the header's commit.
  'code-commit': 'error',
  'code-missing': 'error',
  'code-not-file': 'error',
  'code-binary': 'error',
  'code-lines': 'error',
  'code-too-large': 'error',
} as const;

export type FindingCode = keyof typeof SEVERITIES;
export type Severity = 'error' | 'warning';

export interface Finding {
  code: FindingCode;
  severity: Severity;
  /**
   * The file it's in, from the overview's root: `artifact.md`, or for what the commit holds, the
   * path it's about, quoted as a message quotes the overview's text. A finding about a figure is
   * in `artifact.md`, on the line of the block that shows it.
   */
  file: string;
  /** The line it's on, counting from 1, when it's on one. */
  line?: number;
  /** One or two sentences, for a reader of the overview or its writer. */
  message: string;
}

/** The file every finding of the parse, and of the code its targets name, is in. */
export const ARTIFACT = 'artifact.md';

export function severityOf(code: FindingCode): Severity {
  return SEVERITIES[code];
}

/** Every finding's code. */
export const FINDING_CODES: readonly FindingCode[] = Object.freeze(
  Object.keys(SEVERITIES).filter(isFindingCode),
);

/** Whether `code` is a finding's code. */
export function isFindingCode(code: string): code is FindingCode {
  return Object.hasOwn(SEVERITIES, code);
}

/**
 * Findings as they're made, up to the limit of each kind. Errors are kept before warnings, so an
 * overview with errors always reports one, however many warnings came first.
 */
export class Findings {
  private readonly errors: Finding[] = [];
  private readonly warnings: Finding[] = [];

  add(code: FindingCode, line: number | undefined, message: string, file = ARTIFACT): void {
    const severity = severityOf(code);
    this.keep(
      line === undefined
        ? { code, severity, file, message }
        : { code, severity, file, line, message },
    );
  }

  /** Adds `finding`, made elsewhere, such as by the parse. */
  keep(finding: Finding): void {
    const list = finding.severity === 'error' ? this.errors : this.warnings;
    if (list.length >= LIMITS.findings) return;
    list.push(finding);
  }

  /** Whether any error was found, kept or not. */
  get failed(): boolean {
    return this.errors.length > 0;
  }

  /**
   * The findings kept, in the order of their lines, those without a line first, and on one line,
   * errors first.
   */
  list(): Finding[] {
    const kept = [...this.errors, ...this.warnings.slice(0, LIMITS.findings - this.errors.length)];
    return kept.toSorted((a, b) => (a.line ?? 0) - (b.line ?? 0));
  }
}

/** The longest stretch of the overview's own text a message quotes, in characters. */
const QUOTE = 60;

/**
 * A character that's invisible or moves what's around it: a control character, invisible
 * formatting such as a right-to-left override or a zero-width joiner, a lone surrogate, or a line
 * or paragraph separator. A message never quotes one, and a path or a term never holds one.
 */
export const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

/**
 * `text`, from the overview, as a message may quote it: control characters, invisible formatting
 * and lone surrogates each shown as U+FFFD, so a message can't move a terminal's cursor, reorder
 * what's around it or hide what it says, and cut to a few dozen characters.
 */
export function quote(text: string): string {
  let out = '';
  let count = 0;
  for (const char of text) {
    if (count === QUOTE) return `${out}…`;
    out += UNSAFE.test(char) ? '\uFFFD' : char;
    count += 1;
  }
  return out;
}
