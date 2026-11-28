// An overview's sections, as its article draws them: each of its own second-level headings, with
// the blocks under it, up to the next. Every section but the tl;dr's folds: its heading keeps its
// place, and what's under it goes. A section is known by its heading's block number, Lo's own, and
// by its heading's words, which are the overview's.

import type { OverviewBlock } from '@lo/artifact';
import { plainText } from '@lo/markdown';

/** The tl;dr's anchor: the section that never folds. */
export const TLDR_ANCHOR = 'tldr';

/** One of an overview's sections. */
export interface OverviewSection {
  /** Its heading's block number. */
  readonly heading: number;
  /** The heading as plain text, as the outline writes it. */
  readonly name: string;
  /** Its heading's anchor, which links and the outline go to. */
  readonly anchor: string;
  /** The block numbers under its heading: from `from` up to, not including, `to`. */
  readonly from: number;
  readonly to: number;
  /** It folds: every section but the tl;dr. */
  readonly folds: boolean;
}

/** The most of a heading's words the outline and a section's name keep. */
const NAME_MAX = 200;

/** The plain text of `heading`, an overview's block, as the outline writes it. */
export function headingName(heading: OverviewBlock): string {
  return plainText({ blocks: [heading], notes: [], diagnostics: [] }, NAME_MAX);
}

const known = new WeakMap<readonly OverviewBlock[], readonly OverviewSection[]>();

/**
 * The sections of `blocks`, an overview's, in the order they're written: one for each of its own
 * second-level headings. What comes before the first isn't in one. The same list for the same
 * blocks.
 */
export function sectionsOf(blocks: readonly OverviewBlock[]): readonly OverviewSection[] {
  const kept = known.get(blocks);
  if (kept) return kept;
  const headings: { at: number; anchor: string; node: OverviewBlock }[] = [];
  for (const [at, block] of blocks.entries()) {
    if (block.kind === 'heading' && block.level === 2) {
      headings.push({ at, anchor: block.anchor, node: block });
    }
  }
  const sections = headings.map(({ at, anchor, node }, index): OverviewSection => ({
    heading: at,
    name: headingName(node),
    anchor,
    from: at + 1,
    to: headings[index + 1]?.at ?? blocks.length,
    folds: anchor !== TLDR_ANCHOR,
  }));
  known.set(blocks, sections);
  return sections;
}

/** The section block `block` is in, or heads; none for a block before the first heading. */
export function sectionAt(
  sections: readonly OverviewSection[],
  block: number,
): OverviewSection | undefined {
  return sections.findLast((section) => section.heading <= block && block < section.to);
}
