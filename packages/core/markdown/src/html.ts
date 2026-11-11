/**
 * HTML read with parse5, the HTML standard's own parsing algorithm, so HTML means here what it
 * means to GitHub and to a browser. parse5 itself recurses nowhere and takes time in proportion to
 * the text, but the standard's algorithm can build far more elements than the text holds: a
 * formatting element closed early is made again for each later run of text, so 20 KB can build a
 * million elements. Each parse is given a cap on the elements it builds.
 */

import { defaultTreeAdapter, parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

export type Fragment = DefaultTreeAdapterTypes.DocumentFragment;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

/** Thrown inside a parse to stop it once it has built more elements than it may. */
class Overbuilt extends Error {}

/**
 * `html` parsed as the content of an element, or undefined when it would build more than
 * `elements` elements. With `locations`, each node keeps where it was in `html`.
 */
export function parseHtml(html: string, elements: number, locations = false): Fragment | undefined {
  let built = 0;
  const treeAdapter: typeof defaultTreeAdapter = {
    ...defaultTreeAdapter,
    createElement(tagName, namespaceURI, attrs) {
      built += 1;
      if (built > elements) throw new Overbuilt();
      return defaultTreeAdapter.createElement(tagName, namespaceURI, attrs);
    },
  };
  try {
    return parseFragment(html, { treeAdapter, sourceCodeLocationInfo: locations });
  } catch (error) {
    if (error instanceof Overbuilt) return undefined;
    throw error;
  }
}

/** The child nodes of `node`, a template's content included. */
export function childrenOf(node: ChildNode | Fragment): ChildNode[] {
  if (!('childNodes' in node)) return [];
  if (node.nodeName === 'template' && 'content' in node) return node.content.childNodes;
  return node.childNodes;
}

/**
 * `html` without its comments, as an HTML parser finds them: `<!--` inside an attribute's value or
 * a script is no comment, and a comment left open runs to the end. GitHub never shows them.
 * When the HTML would build more than `elements` elements, it's left as it is.
 */
export function withoutComments(html: string, elements: number): string {
  if (!html.includes('<!') && !html.includes('<?') && !html.includes('</')) return html;
  const fragment = parseHtml(html, elements, true);
  if (!fragment) return html;
  const comments: [number, number][] = [];
  const stack: (ChildNode | Fragment)[] = [fragment];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.nodeName === '#comment' && node.sourceCodeLocation) {
      comments.push([node.sourceCodeLocation.startOffset, node.sourceCodeLocation.endOffset]);
    }
    for (const child of childrenOf(node)) stack.push(child);
  }
  if (comments.length === 0) return html;
  comments.sort((a, b) => a[0] - b[0]);
  let out = '';
  let at = 0;
  for (const [start, end] of comments) {
    if (start < at) continue;
    out += html.slice(at, start);
    at = end;
  }
  return out + html.slice(at);
}

/** Elements GitHub never shows, nor their content: removed before anything else reads the HTML. */
export const REMOVED: ReadonlySet<string> = new Set([
  'script',
  'style',
  'template',
  'svg',
  'math',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'noscript',
  'noembed',
  'noframes',
  'head',
  'title',
  'base',
  'link',
  'meta',
]);

/** Elements whose text stands apart from the text around it. */
const BLOCKS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'td',
  'th',
  'tr',
  'ul',
]);

/**
 * Prepares a parsed fragment for the steps that recurse: removes what GitHub never shows (scripts,
 * styles, templates, SVG and MathML, frames and objects, and comments), and replaces whatever
 * nests deeper than `depth` elements with its text. With an explicit stack, so no nesting
 * overflows it. Returns whether anything was nested too deep.
 */
export function prepare(fragment: Fragment, depth: number): boolean {
  let flattened = false;
  const stack: { node: ParentNode; depth: number }[] = [{ node: fragment, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth: at } = stack.pop()!;
    const kept: ChildNode[] = [];
    for (const child of node.childNodes) {
      if (child.nodeName === '#comment' || child.nodeName === '#documentType') continue;
      if ('tagName' in child && REMOVED.has(child.tagName)) continue;
      kept.push(child);
    }
    node.childNodes = kept;
    for (const child of kept) {
      if (!('childNodes' in child)) continue;
      if (at + 1 >= depth && child.childNodes.some((grandchild) => 'tagName' in grandchild)) {
        flattened = true;
        const text = textOf(child);
        child.childNodes = [];
        if (text !== '') defaultTreeAdapter.insertText(child, text);
        continue;
      }
      stack.push({ node: child, depth: at + 1 });
    }
  }
  return flattened;
}

/** The text in `root`, with the text of elements that stand apart set apart by newlines. */
export function textOf(root: ChildNode | Fragment): string {
  let text = '';
  const stack: (ChildNode | Fragment | '\n')[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === '\n') {
      text += '\n';
      continue;
    }
    if (node.nodeName === '#text' && 'value' in node) {
      text += node.value;
      continue;
    }
    if ('tagName' in node && REMOVED.has(node.tagName)) continue;
    const apart = 'tagName' in node && BLOCKS.has(node.tagName);
    if (apart) stack.push('\n');
    const children = childrenOf(node);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
    if (apart) stack.push('\n');
  }
  return text;
}
