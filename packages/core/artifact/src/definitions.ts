/**
 * What the repository's definitions may hold. A term is plain text, as a glossary writes it. A
 * definition is part of a paragraph, read as Markdown: text, inline code, and links to code and
 * terms, nothing else. An overview's glossary marks the terms whose definitions go into them, and
 * both are held to these rules, so whatever an overview may mark, they may hold.
 */

import { inlineTokens } from '@lo/markdown';
import type { Token } from 'markdown-it';

import { UNSAFE } from './findings.ts';
import { LIMITS } from './limits.ts';
import { CODE, readCode, readTerm, TERM } from './targets.ts';

/**
 * Whether `text`, a term or an alias, is plain: no control or invisible character, line breaks and
 * tabs included, and no space at either end.
 */
export function isPlainTerm(text: string): boolean {
  return !UNSAFE.test(text) && text === text.trim();
}

/**
 * What a definition's tokens, `tokens`, hold that a definition can't: `what`, such as "bold text",
 * and for a link to code or a term whose address is wrong, `why`. Undefined when they hold nothing
 * else.
 */
export function notDefinition(
  tokens: readonly Token[],
): { what: string; why?: string } | undefined {
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'text_special':
      case 'code_inline':
      case 'softbreak':
      case 'link_close':
        continue;
      case 'link_open': {
        const href = token.attrGet('href');
        const read =
          typeof href !== 'string'
            ? undefined
            : href.startsWith(CODE)
              ? readCode(href.slice(CODE.length), 'any')
              : href.startsWith(TERM)
                ? readTerm(href.slice(TERM.length))
                : undefined;
        if (read === undefined) return { what: "a link that isn't to code or a term" };
        if (!read.ok) return { what: 'a link whose address is wrong', why: read.message };
        continue;
      }
      default:
        return { what: KINDS.get(token.type) ?? 'formatting' };
    }
  }
  return undefined;
}

/** What each other token a definition may not hold is, in words. */
const KINDS: ReadonlyMap<string, string> = new Map([
  ['strong_open', 'bold text'],
  ['em_open', 'emphasis'],
  ['s_open', 'struck-through text'],
  ['image', 'an image'],
  ['html_inline', 'HTML'],
  ['hardbreak', 'a hard line break'],
  ['footnote_ref', 'a footnote'],
]);

/**
 * What `text`, a definition as written, holds that a definition can't, read alone as part of a
 * paragraph; undefined when it holds nothing else.
 */
export function notDefinitionText(text: string): { what: string; why?: string } | undefined {
  const tokens = inlineTokens(text, LIMITS.depth);
  return tokens === undefined ? { what: 'formatting nested too deep' } : notDefinition(tokens);
}
