declare module 'markdown-it-footnote' {
  import type { MarkdownIt } from 'markdown-it';

  /** markdown-it's footnote plugin, which ships no types of its own. */
  export default function footnote(md: MarkdownIt): void;
}
