/**
 * What the renderer writes into the page, and nothing else: these elements, each with only the
 * attributes listed for it (and `class`, on any). Nothing in a tree names an element or an
 * attribute, so this is what `render.tsx`'s switches make, whatever the text said; the tests hold
 * every hostile fixture to it. No attribute holds a style or a handler, and only an image's and its
 * picture's sources hold an address: one on Lo's image scheme, which main serves, and only when the
 * document gives one. A source's media is Lo's own, for its theme.
 */
export const MARKDOWN_ELEMENTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  p: ['role', 'dir'],
  h1: ['id', 'tabindex'],
  h2: ['id', 'tabindex'],
  h3: ['id', 'tabindex'],
  h4: ['id', 'tabindex'],
  h5: ['id', 'tabindex'],
  h6: ['id', 'tabindex'],
  blockquote: [],
  div: ['role'],
  ul: [],
  ol: ['start'],
  li: ['id', 'tabindex', 'dir'],
  // `aria-hidden` on a suggested change's −/+ signs, which the `del` and `ins` say already.
  span: ['role', 'aria-label', 'aria-hidden'],
  pre: [],
  code: [],
  table: [],
  thead: [],
  tbody: [],
  tr: [],
  th: [],
  td: [],
  hr: [],
  details: ['open'],
  summary: [],
  section: ['aria-label'],
  strong: [],
  em: [],
  del: [],
  // A suggested change's added lines, as `del` holds its removed ones.
  ins: [],
  br: [],
  sub: [],
  sup: [],
  kbd: [],
  a: ['role', 'tabindex', 'aria-label'],
  img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
  // An image for each theme: the window's color scheme picks the source.
  picture: [],
  source: ['media', 'srcset'],
  // The fold's chevron, Lo's own icon.
  svg: ['viewBox', 'aria-hidden'],
  path: ['d'],
});

/** Whether the renderer may write `attribute` on `element`. */
export function isMarkdownAttribute(element: string, attribute: string): boolean {
  if (attribute === 'class') return true;
  return (
    Object.hasOwn(MARKDOWN_ELEMENTS, element) && MARKDOWN_ELEMENTS[element]!.includes(attribute)
  );
}
