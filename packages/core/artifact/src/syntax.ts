/**
 * The format's syntax, added to markdown-it: lines of three or more colons. Each becomes one
 * token, and nothing more is decided here: which open a block and which close one is settled once
 * the whole document is read, so the blocks' contents are parsed as Markdown like any other, and a
 * fence of colons inside a code block, or inside a list item the block doesn't hold, is never
 * taken for one of the block's own.
 */

import type { MarkdownIt, StateBlock } from 'markdown-it';

/** A line of colons, before it's known what it does. */
export const FENCE = 'lo_fence';
/** A fence that opens a block, and the one that closes it. */
export const OPEN = 'lo_block_open';
export const CLOSE = 'lo_block_close';
/** A fence that neither opens nor closes a block: shown as its text. */
export const LINE = 'lo_line';
/** The glossary's list, and each of its items. */
export const GLOSSARY_OPEN = 'lo_glossary_open';
export const GLOSSARY_CLOSE = 'lo_glossary_close';
export const TERM_OPEN = 'lo_term_open';
export const TERM_CLOSE = 'lo_term_close';
/** A figure's last list, which links its parts, and each of its items. */
export const PARTS_OPEN = 'lo_parts_open';
export const PARTS_CLOSE = 'lo_parts_close';
export const PART_OPEN = 'lo_part_open';
export const PART_CLOSE = 'lo_part_close';

/** Adds the fences to `md`. */
export function fences(md: MarkdownIt): void {
  // Like a fenced code block, a fence ends a paragraph, a reference, a quote or a list.
  md.block.ruler.before('fence', FENCE, fence, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
}

/**
 * A line of three or more colons, indented less than code: the colons, then what follows them,
 * which is empty for a fence that closes a block and the block's kind and argument for one that
 * opens one.
 */
function fence(state: StateBlock, start: number, _end: number, silent: boolean): boolean {
  if (state.sCount[start]! - state.blkIndent >= 4) return false;
  const from = state.bMarks[start]! + state.tShift[start]!;
  const to = state.eMarks[start]!;
  let at = from;
  while (at < to && state.src.charCodeAt(at) === 0x3a) at += 1;
  if (at - from < 3) return false;
  if (silent) return true;
  const token = state.push(FENCE, 'div', 0);
  token.map = [start, start + 1];
  token.markup = state.src.slice(from, at);
  token.info = state.src.slice(at, to);
  token.content = state.src.slice(from, to);
  state.line = start + 1;
  return true;
}

/** Whether a fence closes a block: nothing but spaces follows its colons. */
export function closes(info: string): boolean {
  return info.trim() === '';
}

/** A fence's kind and argument: the first word after its colons, and the rest, trimmed. */
export function opening(info: string): { kind: string; argument: string } {
  const text = info.trim();
  let end = 0;
  while (end < text.length && !/\s/.test(text[end]!)) end += 1;
  return { kind: text.slice(0, end), argument: text.slice(end).trim() };
}
