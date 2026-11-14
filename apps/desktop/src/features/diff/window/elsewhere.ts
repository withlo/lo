// Code another feature draws in code views of its own, such as an overview's code blocks, as the
// diff's keys that read lines reach it: `yy` copies a block's lines, with a count or the lines `v`
// selected, as it copies the diff's.

import type { Span } from '@lo/ui/commands';

/** What has the lines of code views another feature draws. */
export interface CodeElsewhere {
  /** Whether it draws the file a code view names `file`. */
  has(file: string): boolean;
  /** The text of `span`'s lines, in the code view that names its file `span.file`. */
  lines(span: Span): readonly string[];
}

const sources = new Set<CodeElsewhere>();

/** Takes `source` as one that draws code. Returns a function that lets it go. */
export function addCodeElsewhere(source: CodeElsewhere): () => void {
  sources.add(source);
  return () => {
    sources.delete(source);
  };
}

/** What draws the file a code view names `file`, if something besides the diff does. */
function sourceOf(file: string): CodeElsewhere | undefined {
  for (const source of sources) if (source.has(file)) return source;
  return undefined;
}

/** Whether something besides the diff draws the file a code view names `file`. */
export function drawnElsewhere(file: string): boolean {
  return sourceOf(file) !== undefined;
}

/**
 * The text of `spans`' lines, in order, where something besides the diff draws each one's file:
 * none when any isn't.
 */
export function linesElsewhere(spans: readonly Span[]): string[] | undefined {
  const lines: string[] = [];
  for (const span of spans) {
    const source = sourceOf(span.file);
    if (!source) return undefined;
    lines.push(...source.lines(span));
  }
  return lines;
}
