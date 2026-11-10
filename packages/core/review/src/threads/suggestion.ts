/**
 * Suggested changes (`docs/design.md`, "Comments": "Suggestions"): a comment whose `suggestion`
 * block holds the lines as they should read, which the pull request's author can apply on GitHub.
 */

import { Lines } from '../threads.ts';

/**
 * Whether a comment on `lines` can suggest a change: GitHub applies suggestions to the head's lines
 * only, so every line must be on the right side.
 */
export function takesSuggestion(lines: Lines): boolean {
  return Lines.first(lines).side === 'RIGHT' && lines.end.side === 'RIGHT';
}

/**
 * A `suggestion` block holding `lines`, the selected lines' text without line endings, for the
 * comment box to open with. A `\r` left at the end of a line, from a file with Windows line
 * endings, is dropped. Its fence is longer than any run of backticks that starts a line, so lines
 * with fences of their own, such as Markdown's, stay inside it. No lines suggests deleting the
 * selected ones.
 */
export function suggestionBlock(lines: readonly string[]): string {
  const longest = lines.reduce((most, line) => Math.max(most, openingBackticks(line)), 0);
  const fence = '`'.repeat(Math.max(longest, 2) + 1);
  const body = lines.map((line) => `${line.endsWith('\r') ? line.slice(0, -1) : line}\n`);
  return `${fence}suggestion\n${body.join('')}${fence}`;
}

/** How many backticks `line` starts with, after any indentation. */
function openingBackticks(line: string): number {
  const text = line.trimStart();
  return text.length - text.replace(/^`+/, '').length;
}
