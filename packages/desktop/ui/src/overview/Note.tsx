// What an overview says of lines of code, as a note under them in a diff shows it: its words drawn
// as the overview draws them, with their emphasis, code and lists. A link to code or a term shows
// as its words, since the note is read beside the code it's about, and "Read it in the overview"
// goes back to where they lead. A block of the overview's own, such as a figure, shows nothing.

import { useMemo } from 'react';

import type { Overview, OverviewBlock, OverviewTree } from '@lo/artifact';

import { Markdown, type Followed, type MarkdownExtension } from '../markdown/index.ts';

export interface OverviewNoteProps {
  /** What the note says: blocks of the overview, cut short as the note shows them. */
  blocks: readonly OverviewBlock[];
  /** A link to a web page was followed, from `from`. */
  onFollow?: ((target: Followed<Overview>, from: Element) => void) | undefined;
}

const NOTE: MarkdownExtension<Overview> = {
  block: () => null,
  link: (_target, children) => children,
};

export function OverviewNote({ blocks, onFollow }: OverviewNoteProps) {
  const tree = useMemo<OverviewTree>(
    () => ({ blocks: [...blocks], notes: [], diagnostics: [] }),
    [blocks],
  );
  return (
    <Markdown<Overview>
      tree={tree}
      extension={NOTE}
      onFollow={onFollow}
      className="lo-ovnote__words"
    />
  );
}
