// How a capture in a highlight query picks one of the syntax tokens `design/css/code.css` styles,
// as `lo-syn-<token>` classes. The tokens are listed in `design/syntax.json`, which the code views
// read too, so they draw the classes without loading this package.

import names from '@lo/design/syntax.json' with { type: 'json' };

/** Every token, by its number in a highlight's triples. */
export const tokens: readonly string[] = names;

const numbers = new Map<string, number>(tokens.map((token, index) => [token, index]));

/**
 * Captures that are meant to have no style, by their full names: whole paragraphs and JSX text,
 * which keep the plain text color, markup Lo doesn't style, a capture that only takes a style
 * away (`@none`), and names that ride beside another capture of the same text (`@type @module`,
 * `@comment @spell`). Captures starting with `_` only feed predicates.
 */
export const unstyled: ReadonlySet<string> = new Set([
  'embedded',
  'modifier',
  'module',
  'module.struct',
  'nested',
  'none',
  'spell',
  'strikethrough.markup',
  'text',
  'text.jsx',
]);

/**
 * Older names for tokens that some queries still use: Kotlin's `@float` is every other query's
 * `@number`, and its `@include` a `@keyword`. Rust's lifetimes take the style of labels, which
 * they're written like (`'outer: loop`).
 */
const aliases = new Map<string, number>(
  Object.entries({
    character: 'string',
    float: 'number',
    include: 'keyword',
    lifetime: 'label',
    parameter: 'variable-parameter',
  }).map(([alias, token]) => [alias, numbers.get(token)!]),
);

/**
 * The token a capture picks, as its number: the capture's name with dots turned to dashes, cut
 * back a part at a time until it names a token (`@keyword.control` is `keyword`) or an older
 * name for one (`@float` is `number`). None for a capture with no token.
 */
export function tokenOf(capture: string): number | undefined {
  let name = capture.replaceAll('.', '-');
  for (;;) {
    const token = numbers.get(name) ?? aliases.get(name);
    if (token !== undefined) return token;
    const cut = name.lastIndexOf('-');
    if (cut === -1) return undefined;
    name = name.slice(0, cut);
  }
}

/** The class that styles token number `token`. */
export function tokenClass(token: number): string {
  return `lo-syn-${tokens[token] ?? ''}`;
}
