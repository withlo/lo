// A definition as it will read, drawn by the overview's own inline renderer as a term's card draws
// it, 13/20: its code as code, a link into the code as a link, and a link to a term as a term in
// the text, none of which goes anywhere or takes focus. What's written in Edit term shows here.

import type { Overview, OverviewBlock } from '@lo/artifact';
import { useMemo, type ReactNode } from 'react';

import { Anchors, MarkdownInlines, MarkdownProvider, type Rendering } from '../markdown/index.ts';

export interface DefinitionPreviewProps {
  /** The definition's blocks, as the store reads it: one paragraph, or none for an empty one. */
  blocks: readonly OverviewBlock[];
  /** What it says while there's nothing to show: "Nothing to preview". */
  empty?: ReactNode;
}

/** A definition as it will read: nothing of it follows a click or takes focus. */
export function DefinitionPreview({ blocks, empty }: DefinitionPreviewProps) {
  const rendering = useMemo<Rendering<Overview>>(
    () => ({
      anchors: new Anchors('lo-preview', []),
      follow: () => undefined,
      extension: {
        link: (target, children) =>
          target.kind === 'term' ? (
            <span className="lo-term">{children}</span>
          ) : (
            <span className="lo-definition-preview__link">{children}</span>
          ),
      },
      interactive: true,
      focusable: false,
    }),
    [],
  );
  const [first] = blocks;
  return (
    <div className="lo-definition-preview lo-selectable">
      {first?.kind === 'paragraph' ? (
        <MarkdownProvider rendering={rendering}>
          <MarkdownInlines<Overview> nodes={first.children} />
        </MarkdownProvider>
      ) : (
        <span className="text-fg-subtle">{empty}</span>
      )}
    </div>
  );
}
