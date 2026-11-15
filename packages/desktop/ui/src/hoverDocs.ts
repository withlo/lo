// The docs of a type hover, made ready to draw as text: what a language server wrote, which a
// reader can't be asked to trust. Its format characters show as marks (see `controls.ts`), and each
// link and image shows where it goes, since a card has nothing to follow and the words of a link
// can say anything.

import { webLink, type Tree } from '@lo/markdown';

import { secureLink } from './markdown/links.ts';
import { isRecord } from './markdown/scope.ts';
import { showFormat, showProse, splitFormat } from './controls.ts';

/** A link in a hover's docs: the words it shows, where it goes, and whether it's an image. */
export interface HoverLink {
  text: string;
  /** The page, as `URL` writes it: a host that imitates another reads as punycode. */
  url: string;
  image: boolean;
}

/**
 * The words of `nodes`, as the card draws them: a text, a code, and what's inside the rest. What
 * isn't words, such as a break, leaves none.
 */
function wordsOf(nodes: unknown): string {
  if (!Array.isArray(nodes)) return '';
  return nodes
    .map((node: unknown) => {
      if (!isRecord(node)) return '';
      const { value, children } = node;
      if (typeof value === 'string') return value;
      return wordsOf(children);
    })
    .join('');
}

/** The link `node` is, if it is one a web page can be read from. */
function linkOf(node: Record<string, unknown>): HoverLink | undefined {
  const { kind, target, children, url, alt, name } = node;
  if (kind === 'link' && isRecord(target) && target['kind'] === 'web') {
    const page = typeof target['url'] === 'string' ? webLink(target['url']) : undefined;
    return page === undefined ? undefined : { text: wordsOf(children), url: page, image: false };
  }
  if (kind === 'image' && typeof url === 'string' && typeof alt === 'string') {
    const page = webLink(url);
    return page === undefined
      ? undefined
      : { text: alt === '' ? 'Image' : alt, url: page, image: true };
  }
  if (kind === 'mention' && typeof url === 'string' && typeof name === 'string') {
    const page = webLink(url);
    return page === undefined ? undefined : { text: `@${name}`, url: page, image: false };
  }
  return undefined;
}

/**
 * The links in `docs` that Lo can open, in the order they come, each address once: what a key on
 * the hover can offer to open, as the card itself has nothing to press. A link that main would
 * refuse, such as a plain `http:` page, isn't among them, though the card still shows where it
 * goes. An image is a link to the image.
 */
export function hoverLinks(docs: Tree): HoverLink[] {
  const found = new Map<string, HoverLink>();
  const stack: unknown[] = [docs.blocks];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push(value[i]);
      continue;
    }
    if (!isRecord(value)) continue;
    const link = linkOf(value);
    if (link && secureLink(link.url) !== undefined && !found.has(link.url)) {
      found.set(link.url, link);
    }
    // What's inside, last first so the stack gives it back in order.
    const inner = Object.values(value).filter((field) => typeof field === 'object');
    for (let i = inner.length - 1; i >= 0; i--) stack.push(inner[i]);
  }
  return [...found.values()];
}

/** The nodes that show where a link goes: " (https://example.com/)", the address as code. */
function address(url: string): unknown[] {
  return [
    { kind: 'text', value: ' (' },
    { kind: 'inlineCode', value: showFormat(url) },
    { kind: 'text', value: ')' },
  ];
}

/** What `node`, one of a list of blocks or of text, becomes in the card. */
function drawn(node: unknown): unknown[] {
  if (!isRecord(node)) return [node];
  switch (node['kind']) {
    case 'text': {
      const value = node['value'];
      if (typeof value !== 'string') return [node];
      // A mark is its own node, as code, between the text that was around it.
      return splitFormat(value, true).map((piece) =>
        typeof piece === 'string'
          ? { ...node, value: piece }
          : { kind: 'inlineCode', value: piece.code },
      );
    }
    case 'inlineCode': {
      const value = node['value'];
      return [typeof value === 'string' ? { ...node, value: showFormat(value) } : node];
    }
    case 'suggestion': {
      const text = node['text'];
      return [typeof text === 'string' ? { ...node, text: showFormat(text) } : node];
    }
    case 'link': {
      const link = linkOf(node);
      if (!link) return [node];
      // A link whose words are its address needs no second one.
      return link.text === link.url ? [node] : [node, ...address(link.url)];
    }
    case 'image': {
      const alt = node['alt'];
      const shown = typeof alt === 'string' ? { ...node, alt: showProse(alt) } : node;
      const link = linkOf(node);
      return link ? [shown, ...address(link.url)] : [shown];
    }
    case 'mention': {
      const name = node['name'];
      const shown = typeof name === 'string' ? { ...node, name: showFormat(name) } : node;
      const link = linkOf(node);
      return link ? [shown, ...address(link.url)] : [shown];
    }
    default:
      return [node];
  }
}

/**
 * `docs` made ready to draw in the card, as a new tree. Prose shows the format characters that
 * reorder text or hide it as marks, and keeps the few that scripts and emoji are written with.
 * Code shows every one. A link and an image are followed by the address they go to.
 */
export function showDocs(docs: Tree): Tree {
  const shown: Tree = JSON.parse(JSON.stringify(docs), (_key, value: unknown) =>
    Array.isArray(value) ? value.flatMap(drawn) : value,
  );
  return shown;
}
