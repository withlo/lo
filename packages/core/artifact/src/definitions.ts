/**
 * What the repository's definitions may hold. A term is plain text, as a glossary writes it. A
 * definition is part of a paragraph, read as Markdown: text, inline code, and links to code and
 * terms, nothing else. An overview's glossary marks the terms whose definitions go into them, and
 * both are held to these rules, so whatever an overview may mark, they may hold.
 */

import { ANY_REFERENCE, inlineTokens, type Inline } from '@lo/markdown';
import type { Token } from 'markdown-it';

import { UNSAFE } from './findings.ts';
import { LIMITS } from './limits.ts';
import { CODE, readCode, readTerm, TERM } from './targets.ts';
import type { Overview, OverviewBlock } from './tree.ts';

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
        // GitHub's references, `#123` or `owner/repo#123`, which Markdown alone reads as text.
        if (token.markup === 'reference') return { what: 'a link to an issue or a pull request' };
        const href = token.attrGet('href');
        if (href === ANY_REFERENCE) return { what: 'a reference-style link', why: REFERENCES };
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

const REFERENCES =
  'A definition is read alone, where no reference is defined: write the link inline, as [label](code:path), or put a backslash before its brackets.';

/** What each other token a definition may not hold is, in words. */
const KINDS: ReadonlyMap<string, string> = new Map([
  ['strong_open', 'bold text'],
  ['em_open', 'emphasis'],
  ['s_open', 'struck-through text'],
  ['image', 'an image'],
  ['html_inline', 'HTML'],
  ['hardbreak', 'a hard line break'],
  ['footnote_ref', 'a footnote'],
  ['lo_mention', 'a mention of a person or a team'],
]);

/**
 * `text`, a definition as written, read alone as part of a paragraph, as the repository's
 * definitions hold it: its tokens, with each reference-style link read as a link to
 * {@link ANY_REFERENCE}, since it reads as a link wherever its label is defined, and read in a
 * repository, since a definition always shows in one, where `#123` links to an issue. Undefined for
 * text nested too deep to read.
 */
export function definitionTokens(text: string): Token[] | undefined {
  return inlineTokens(text, { depth: LIMITS.depth, references: 'any', repo: SHOWN_IN });
}

/** A repository a definition shows in: any one reads `#123` the same way. */
const SHOWN_IN = { owner: 'owner', name: 'repo' };

/**
 * What `text`, a definition as written, holds that a definition can't, read alone as part of a
 * paragraph: a control or invisible character, or what {@link notDefinition} says of its tokens.
 * Undefined when it holds nothing else.
 */
export function notDefinitionText(text: string): { what: string; why?: string } | undefined {
  if (UNSAFE.test(text)) return { what: 'a control or invisible character' };
  const tokens = definitionTokens(text);
  return tokens === undefined ? { what: 'formatting nested too deep' } : notDefinition(tokens);
}

/**
 * `text`, a definition as the repository's definitions hold it, as an overview's tree holds a
 * glossary item's: one paragraph of its text, inline code and links to code and terms, read alone
 * as the store reads it, so it shows as it reads there. None for an empty definition. Undefined
 * when it holds what a definition can't, which the store refuses.
 */
export function definitionBlocks(text: string): OverviewBlock[] | undefined {
  if (notDefinitionText(text) !== undefined) return undefined;
  const tokens = definitionTokens(text);
  if (tokens === undefined) return undefined;
  const paragraph: Inline<Overview>[] = [];
  // The inlines each link open holds, innermost last: a link's label can't hold another link.
  const open: Inline<Overview>[][] = [];
  let into = paragraph;
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'text_special':
      case 'softbreak': {
        // A definition is on one line, and a break in it reads as a space, as in an overview.
        const value = token.type === 'softbreak' ? ' ' : token.content;
        const last = into.at(-1);
        if (last?.kind === 'text') last.value += value;
        else if (value !== '') into.push({ kind: 'text', value });
        break;
      }
      case 'code_inline':
        into.push({ kind: 'inlineCode', value: token.content });
        break;
      case 'link_open': {
        const href = String(token.attrGet('href'));
        const read = href.startsWith(CODE)
          ? readCode(href.slice(CODE.length), 'any')
          : href.startsWith(TERM)
            ? readTerm(href.slice(TERM.length))
            : undefined;
        if (!read?.ok) return undefined;
        const children: Inline<Overview>[] = [];
        into.push({ kind: 'link', target: read.value, children });
        open.push(into);
        into = children;
        break;
      }
      case 'link_close':
        into = open.pop() ?? paragraph;
        break;
      default:
        // `notDefinition` lets nothing else through.
        return undefined;
    }
  }
  return paragraph.length === 0 ? [] : [{ kind: 'paragraph', children: paragraph }];
}
