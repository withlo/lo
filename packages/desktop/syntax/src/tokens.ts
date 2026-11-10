// The syntax tokens `design/css/code.css` styles, as `lo-syn-<token>` classes, and how a capture
// in a highlight query picks one.

/** Every token, by its number in a highlight's triples. */
export const tokens = [
  'attribute',
  'boolean',
  'comment',
  'comment-doc',
  'constant',
  'constant-builtin',
  'constructor',
  'emphasis',
  'emphasis-strong',
  'enum',
  'function',
  'function-method',
  'keyword',
  'label',
  'link_text',
  'link_uri',
  'namespace',
  'number',
  'operator',
  'preproc',
  'property',
  'punctuation',
  'punctuation-bracket',
  'punctuation-delimiter',
  'punctuation-list_marker',
  'punctuation-special',
  'selector',
  'selector-pseudo',
  'string',
  'string-escape',
  'string-regex',
  'string-special',
  'string-special-symbol',
  'tag',
  'text-literal',
  'title',
  'type',
  'type-builtin',
  'variable',
  'variable-parameter',
  'variable-special',
  'variant',
] as const;

export type Token = (typeof tokens)[number];

const numbers = new Map<string, number>(tokens.map((token, index) => [token, index]));

/**
 * Captures that are meant to have no style: whole paragraphs and JSX text, which keep the plain
 * text color, and markup Lo doesn't style. Captures starting with `_` only feed predicates.
 */
export const unstyled: ReadonlySet<string> = new Set([
  'embedded',
  'nested',
  'strikethrough',
  'text',
]);

/**
 * The token a capture picks, as its number: the capture's name with dots turned to dashes, cut
 * back a part at a time until it names a token (`@keyword.control` is `keyword`). None for a
 * capture with no token.
 */
export function tokenOf(capture: string): number | undefined {
  let name = capture.replaceAll('.', '-');
  for (;;) {
    const token = numbers.get(name);
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
