// The lines of the code the overview's blocks draw, for the diff's keys that read lines: `yy` in a
// code block or a walkthrough's step copies its lines, with a count or the lines `v` selected, as
// it does in the diff. Each code view is known by its own id for its file, while it's drawn.

import type { Span } from '@lo/ui/commands';

import type { CodeElsewhere } from '../../diff/window/shared.ts';

/** A file's lines as a block draws them: at the overview's commit (`new`) and at its base. */
export interface DrawnLines {
  readonly old: readonly string[];
  readonly new: readonly string[];
}

/** The lines of `span` in `lines`, on its side, either way round, within the file. */
export function spanLines(lines: DrawnLines, span: Span): readonly string[] {
  const from = Math.min(span.from, span.to);
  const to = Math.max(span.from, span.to);
  return lines[span.side].slice(Math.max(0, from - 1), to);
}

/** The lines of each code view a block draws, by its id for its file. */
const drawn = new Map<string, DrawnLines>();

/** Notes the lines code view `file` draws, until the returned function says it's gone. */
export function drawnLines(file: string, lines: DrawnLines): () => void {
  drawn.set(file, lines);
  return () => {
    if (drawn.get(file) === lines) drawn.delete(file);
  };
}

/** The code the overview's blocks draw, as the diff's keys read it. */
export const blockCode: CodeElsewhere = {
  has: (file) => drawn.has(file),
  lines: (span) => {
    const lines = drawn.get(span.file);
    return lines ? spanLines(lines, span) : [];
  },
};
