/**
 * Reads `artifact.md`, an overview's text, into its header, its tree, the code it points at and
 * what's wrong with it. It comes from anyone who can push to a pull request's repository, so the
 * parse is bounded on any input: the file's size is checked before its text is read, every pass
 * over it takes time in proportion to it, and it never recurses deeper than the limits allow.
 */

import { markdownTree, type Diagnostic, type Note } from '@lo/markdown';

import { Findings, type Finding } from './findings.ts';
import { readHeader, type Header } from './header.ts';
import { FORMAT, LIMITS } from './limits.ts';
import { settle, syntax, type Building } from './map.ts';
import { Reading, type CodeReference, type FigureReference } from './reading.ts';
import { readSource } from './source.ts';
import type { OverviewTree } from './tree.ts';

export interface ParsedArtifact {
  /** The header, when it holds its three keys, each valid, for a format this version reads. */
  header?: Header;
  /**
   * The format the header names, when it names one. Past {@link FORMAT}, nothing after the header
   * was read, and the findings say only that.
   */
  format?: number;
  /** `artifact.md`'s size in bytes of UTF-8, a byte-order mark aside. */
  size: number;
  /** What the overview shows. Empty when its text wasn't read. */
  tree: OverviewTree;
  /** Every place it points at code, in the order of their lines. */
  references: CodeReference[];
  /** Every figure it shows, in order. */
  figures: FigureReference[];
  /** What's wrong with it: any error makes it invalid. At most {@link LIMITS.findings}. */
  findings: Finding[];
}

/**
 * `source`, an overview's `artifact.md`, as bytes or text, read. Pure and synchronous, and never
 * throws: what can't be read is a finding.
 */
export function parseArtifact(source: Uint8Array | string): ParsedArtifact {
  try {
    return read(source);
  } catch {
    // Nothing above throws on any input, so this is a backstop: an overview that makes a step
    // fail is refused, saying only that.
    const findings = new Findings();
    findings.add(
      'unreadable',
      undefined,
      "Lo couldn't read artifact.md, for a reason it can't name.",
    );
    return { size: 0, ...nothing(), findings: findings.list() };
  }
}

function read(source: Uint8Array | string): ParsedArtifact {
  const findings = new Findings();
  const file = readSource(source);
  const head = readHeader(file.start, findings);
  const known = {
    ...(head.header ? { header: head.header } : {}),
    ...(head.format === undefined ? {} : { format: head.format }),
    size: file.size,
  };
  if (head.format !== undefined && head.format > FORMAT) {
    return { ...known, ...nothing(), findings: findings.list() };
  }
  if (file.size > LIMITS.size) {
    findings.add(
      'too-large',
      undefined,
      `artifact.md is larger than ${LIMITS.size / 1024} KiB, the most an overview's text may be. Shorten it.`,
    );
    return { ...known, ...nothing(), findings: findings.list() };
  }
  // Where a header that never closes ends is unknown, so nothing after it is read.
  if (head.lines === undefined) return { ...known, ...nothing(), findings: findings.list() };
  const text = file.text();
  if (!text.ok) {
    findings.add('encoding', text.line, "artifact.md isn't UTF-8 from this line on.");
    return { ...known, ...nothing(), findings: findings.list() };
  }

  const reading = new Reading(findings);
  const built = markdownTree<Building>(blank(text.text, head.lines), {
    syntax: syntax(reading),
    // An overview is a document, as a README is: a newline in a paragraph is a space.
    breaks: false,
    limits: { length: LIMITS.size, nodes: LIMITS.nodes, depth: LIMITS.depth },
  });
  for (const note of built.notes) noted(findings, note);
  for (const diagnostic of built.diagnostics) diagnosed(findings, diagnostic);
  return {
    ...known,
    tree: settle(built),
    references: reading.references.toSorted((a, b) => a.line - b.line),
    figures: reading.figures,
    findings: findings.list(),
  };
}

function nothing(): Pick<ParsedArtifact, 'tree' | 'references' | 'figures'> {
  return { tree: { blocks: [], notes: [], diagnostics: [] }, references: [], figures: [] };
}

/** `text` with its first `lines` lines, the header's, left empty, so the rest keep their numbers. */
function blank(text: string, lines: number): string {
  let at = 0;
  for (let line = 0; line < lines; line++) {
    const end = text.indexOf('\n', at);
    if (end < 0) return '\n'.repeat(lines);
    at = end + 1;
  }
  return '\n'.repeat(lines) + text.slice(at);
}

/** What Markdown's note on the tree means for an overview. */
function noted(findings: Findings, note: Note): void {
  switch (note) {
    case 'cut':
      // The text is never longer than the length limit, so it's never cut; if it were, it
      // would be for its size.
      findings.add('too-large', undefined, 'artifact.md is too long for Lo to show all of it.');
      return;
    case 'deep':
      findings.add(
        'too-deep',
        undefined,
        `Some of the overview nests more than ${LIMITS.depth} levels deep, which shows as plain text. Nest it less.`,
      );
      return;
    case 'nodes':
      findings.add(
        'too-many-nodes',
        undefined,
        `The overview holds more than ${LIMITS.nodes.toLocaleString('en-US')} pieces, such as paragraphs, links and list items, past which it shows as plain text. Shorten it.`,
      );
      return;
    default:
      note satisfies never;
      throw new Error(`Unknown note ${String(note)}`);
  }
}

/** What Markdown's diagnostic means for an overview: each is a warning, since it still shows. */
function diagnosed(findings: Findings, diagnostic: Diagnostic): void {
  const { code, line } = diagnostic;
  switch (code) {
    case 'html':
      findings.add('raw-html', line, 'Raw HTML shows as its text. Write Markdown instead.');
      return;
    case 'image':
      findings.add(
        'outside-image',
        line,
        "An image from outside GitHub shows as a link. Show the overview's own images with :::figure.",
      );
      return;
    case 'link':
      findings.add(
        'dead-link',
        line,
        "A link here goes nowhere Lo opens, so it shows as text. Link to a web page, to code:, to term: or to a #section that's there.",
      );
      return;
    default:
      code satisfies never;
      throw new Error(`Unknown diagnostic ${String(code)}`);
  }
}
