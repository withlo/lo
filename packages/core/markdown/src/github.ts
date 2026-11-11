/**
 * GitHub's rendering of a post (`bodyHTML`) to Lo's tree. GitHub has already sanitized it, but it's
 * read as untrusted anyway: parsed with a cap on the elements built, stripped of what GitHub never
 * shows, flattened past a depth before anything that recurses reads it, sanitized again against an
 * allowlist far tighter than GitHub's own, and mapped by a closed switch that knows GitHub's markup
 * (mentions, alerts, task lists, highlighted code, footnotes, math and diagrams) as GitHub renders
 * it. Every link and image passes the same rules as Markdown's, through the same builder. A
 * rendering too long to read, or one that would build too much, shows from the post's Markdown.
 */

import type { Element, ElementContent, Properties, Root, RootContent } from 'hast';
import { fromParse5 } from 'hast-util-from-parse5';
import { sanitize, type Schema } from 'hast-util-sanitize';

import { append, assemble, type FootnotePart, type Part } from './assemble.ts';
import { Builder } from './build.ts';
import { parseHtml, prepare, REMOVED } from './html.ts';
import { resolveLimits, type Limits } from './limits.ts';
import { fragmentName } from './links.ts';
import { finish, markdownTree } from './markdown.ts';
import type { Repo } from './references.ts';
import type { Alert, Block, Inline, ListItem, Note, Table, Tree } from './tree.ts';

/** A post as GitHub gives it: its rendering, and the Markdown it was rendered from. */
export interface Post {
  html: string;
  markdown: string;
}

export interface GithubOptions {
  /** The address of the page the post is on, which relative links resolve against. */
  page?: string;
  /** The repository the post is in, for its Markdown when that's what shows. */
  repo?: Repo;
  limits?: Partial<Limits>;
}

/** How many elements deep the HTML may nest, for each level of the tree's depth limit. */
const ELEMENTS_PER_LEVEL = 4;

/** How many elements a parse may build, for each node the tree may hold. */
const ELEMENTS_PER_NODE = 4;

/**
 * `post` as Lo's tree, from GitHub's rendering, or from its Markdown when the rendering is longer
 * than the limit on HTML, would build too many elements, or overflows the stack anyway. Pure and
 * synchronous; never throws on any text.
 */
export function githubTree(post: Post, options: GithubOptions = {}): Tree {
  const limits = resolveLimits(options.limits);
  const fromMarkdown = (): Tree =>
    markdownTree(post.markdown, { page: options.page, repo: options.repo, limits });
  if (utf8Length(post.html, limits.html) > limits.html) return fromMarkdown();
  const fragment = parseHtml(post.html.toWellFormed(), ELEMENTS_PER_NODE * limits.nodes);
  if (!fragment) return fromMarkdown();
  try {
    const notes = new Set<Note>();
    if (prepare(fragment, ELEMENTS_PER_LEVEL * limits.depth)) notes.add('deep');
    const root = sanitize(fromParse5(fragment), SCHEMA);
    if (root.type !== 'root') return finish([], notes, []);
    const builder = new Builder(limits, notes, options.page);
    return finish(new Mapper(root, builder).map(), notes, builder.diagnostics);
  } catch (error) {
    // Nothing recurses past the elements' depth limit, so this is a backstop.
    if (!(error instanceof RangeError)) throw error;
    return fromMarkdown();
  }
}

/** `text`'s length in UTF-8 bytes, counted no further than past `limit`. */
function utf8Length(text: string, limit: number): number {
  // A UTF-16 unit is at least one byte, so a text longer in units is longer in bytes.
  if (text.length > limit) return text.length;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

const ALERTS = ['note', 'tip', 'important', 'warning', 'caution'] as const;

/**
 * The elements and attributes the mapping reads, and nothing else. Any other element is replaced
 * by its children; scripts, styles and the like are already gone. Classes and `data-*` attributes
 * stay only with the values GitHub's markup uses, which the mapping reads to know a mention, an
 * alert or a footnote; no class, style or attribute reaches the tree.
 */
export const SCHEMA: Schema = {
  tagNames: [
    'a',
    'b',
    'blockquote',
    'br',
    'code',
    'dd',
    'del',
    'details',
    'div',
    'dl',
    'dt',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'img',
    'input',
    'kbd',
    'li',
    'math-renderer',
    'ol',
    'p',
    'pre',
    's',
    'samp',
    'section',
    'strike',
    'strong',
    'sub',
    'summary',
    'sup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'tt',
    'ul',
    'var',
    'video',
  ],
  attributes: {
    a: [
      'href',
      'dataFootnoteRef',
      'dataFootnoteBackref',
      ['className', 'user-mention', 'team-mention', 'anchor'],
    ],
    img: ['src', 'alt', 'title', ['className', 'emoji']],
    div: [
      [
        'className',
        'markdown-alert',
        ...ALERTS.map((type) => `markdown-alert-${type}`),
        'highlight',
        /^highlight-(?:source|text)-[\w+#.-]{1,64}$/,
      ],
    ],
    p: [['className', 'markdown-alert-title']],
    pre: ['lang'],
    li: ['id', ['className', 'task-list-item']],
    input: [['type', 'checkbox'], 'checked'],
    section: [
      'dataFootnotes',
      'dataType',
      ['className', 'footnotes', 'js-render-needs-enrichment'],
    ],
    'math-renderer': [['className', 'js-display-math', 'js-inline-math']],
    ol: ['start'],
    th: ['align'],
    td: ['align'],
    details: ['open'],
    video: ['src'],
  },
  // The mapping reads ids only as names; nothing it builds is an id.
  clobber: [],
  protocols: { href: ['http', 'https'], src: ['http', 'https'] },
  required: {},
  ancestors: {},
  // Removed already, with their content; removed again here, should any reach this far.
  strip: [...REMOVED],
  allowComments: false,
  allowDoctypes: false,
};

/** Elements that stand as blocks of their own; any other is inline. */
const BLOCK_TAGS = new Set([
  'blockquote',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

function isElement(node: RootContent | ElementContent | undefined, tag?: string): node is Element {
  return node?.type === 'element' && (tag === undefined || node.tagName === tag);
}

function isBlock(node: RootContent | ElementContent): boolean {
  if (!isElement(node)) return false;
  if (node.tagName === 'math-renderer') return hasClass(node, 'js-display-math');
  return BLOCK_TAGS.has(node.tagName);
}

function classes(node: Element): string[] {
  const value = node.properties['className'];
  return Array.isArray(value) ? value.map(String) : [];
}

function hasClass(node: Element, name: string): boolean {
  return classes(node).includes(name);
}

function property(node: Element, name: keyof Properties): string | undefined {
  const value = node.properties[name];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
}

function isBlank(node: RootContent | ElementContent): boolean {
  return node.type === 'text' && node.value.trim() === '';
}

/** The text in `node`, read with an explicit stack, newlines setting blocks apart. */
export function textOf(node: Root | RootContent | ElementContent): string {
  let text = '';
  const stack: (Root | RootContent | ElementContent | '\n')[] = [node];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (next === '\n') {
      text += '\n';
      continue;
    }
    if (next.type === 'text') {
      text += next.value;
      continue;
    }
    if (next.type !== 'element' && next.type !== 'root') continue;
    if (next.type === 'element' && next.tagName === 'br') {
      text += '\n';
      continue;
    }
    const apart = next.type === 'element' && BLOCK_TAGS.has(next.tagName);
    if (apart) stack.push('\n');
    for (let i = next.children.length - 1; i >= 0; i--) stack.push(next.children[i]!);
    if (apart) stack.push('\n');
  }
  return text;
}

/** The text in `node` exactly as written, as code keeps it. */
function rawText(node: Element): string {
  let text = '';
  const stack: ElementContent[] = [node];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (next.type === 'text') text += next.value;
    else if (next.type === 'element') {
      for (let i = next.children.length - 1; i >= 0; i--) stack.push(next.children[i]!);
    }
  }
  return text;
}

/** Text as it reads on the page: every run of spaces and newlines one space. */
function collapse(text: string): string {
  return text.replace(/[ \t\n\r\f]+/g, ' ');
}

/** Plain text kept for a stand-in: its lines, without the blank ones around them. */
function lines(text: string): string {
  return text
    .split('\n')
    .map((line) => collapse(line).trim())
    .filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''))
    .join('\n')
    .trim();
}

class Mapper {
  private readonly root: Root;
  private readonly builder: Builder;
  private readonly headings = new Map<Element, string>();
  /** Each footnote's number, by its name. */
  private readonly footnotes = new Map<string, number>();

  constructor(root: Root, builder: Builder) {
    this.root = root;
    this.builder = builder;
  }

  map(): Block[] {
    const parts: Part[] = [];
    const footnotes: FootnotePart[] = [];
    let run: RootContent[] = [];
    const endRun = (): void => {
      if (run.some((node) => !isBlank(node))) parts.push(this.part(run));
      run = [];
    };
    for (const node of this.root.children) {
      if (isElement(node, 'section') && node.properties['dataFootnotes'] !== undefined) {
        endRun();
        append(footnotes, this.footnoteParts(node));
      } else if (isBlock(node)) {
        endRun();
        parts.push(this.part([node]));
      } else {
        run.push(node);
      }
    }
    endRun();
    this.nameHeadings();
    return assemble(this.builder, parts, footnotes, (index) =>
      parts
        .slice(index)
        .map((part) => part.plain())
        .join('\n\n'),
    );
  }

  private part(nodes: readonly RootContent[]): Part {
    const plain = (): string => lines(nodes.map((node) => textOf(node)).join(''));
    return { build: () => this.blocks(nodes), plain };
  }

  /** The footnotes in GitHub's footnote section, each named as its references name it. */
  private footnoteParts(section: Element): FootnotePart[] {
    const list = section.children.find((child) => isElement(child, 'ol'));
    if (!isElement(list)) return [];
    const items = list.children.filter((child): child is Element => isElement(child, 'li'));
    // References name the first footnote with each name. One with no name, or a name already
    // taken, still shows, under a name no reference can mean, given once every name is known.
    const taken = new Set<string>();
    const names = items.map((item) => {
      const name = fragmentName(`#${property(item, 'id') ?? ''}`) ?? '';
      if (name === '' || taken.has(name) || this.footnotes.has(name)) return undefined;
      taken.add(name);
      return name;
    });
    return items.map((item, index) => {
      const number = index + 1;
      let name = names[index];
      for (let repeat = 1; name === undefined; repeat++) {
        const candidate = `fn-${number}-${repeat}`;
        if (taken.has(candidate) || this.footnotes.has(candidate)) continue;
        taken.add(candidate);
        name = candidate;
      }
      this.footnotes.set(name, number);
      this.builder.anchors.reserve(name);
      this.builder.references.set(name, `[${number}]`);
      return {
        name,
        number,
        build: () => this.blocks(item.children),
        plain: () => lines(textOf(item)),
      };
    });
  }

  /** Names every heading, in order, as GitHub makes its anchors, so links find them. */
  private nameHeadings(): void {
    const stack: (Root | RootContent)[] = [this.root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.type !== 'element' && node.type !== 'root') continue;
      if (node.type === 'element' && /^h[1-6]$/.test(node.tagName)) {
        this.headings.set(node, this.builder.anchors.heading(collapse(textOf(node)).trim()));
        continue;
      }
      // The footnote section's own heading is the renderer's to show.
      if (
        node.type === 'element' &&
        node.tagName === 'section' &&
        node.properties['dataFootnotes'] !== undefined
      ) {
        continue;
      }
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
    }
  }

  // The mapping: a closed switch over the elements the schema lets through, recursing no deeper
  // than the elements nest, which `prepare` capped.

  /** Blocks from `nodes`, inline content between blocks gathered into paragraphs. */
  private blocks(nodes: readonly (RootContent | ElementContent)[]): Block[] {
    const out: Block[] = [];
    let run: (RootContent | ElementContent)[] = [];
    const endRun = (): void => {
      if (run.length > 0) {
        const children = this.paragraph(run);
        if (children.length > 0) out.push({ kind: 'paragraph', children });
      }
      run = [];
    };
    for (const node of nodes) {
      if (isElement(node) && isBlock(node)) {
        endRun();
        append(out, this.block(node));
      } else {
        run.push(node);
      }
    }
    endRun();
    return out;
  }

  private block(node: Element): Block[] {
    switch (node.tagName) {
      case 'p': {
        if (hasClass(node, 'markdown-alert-title')) return [];
        const children = this.paragraph(node.children);
        return children.length > 0 ? [{ kind: 'paragraph', children }] : [];
      }
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return [
          {
            kind: 'heading',
            level: headingLevel(node.tagName),
            anchor: this.headings.get(node) ?? '',
            children: this.paragraph(node.children),
          },
        ];
      case 'blockquote':
        return [{ kind: 'quote', children: this.blocks(node.children) }];
      case 'ul':
      case 'ol':
        return [this.list(node)];
      case 'pre':
        return [this.pre(node)];
      case 'table':
        return [this.table(node)];
      case 'hr':
        return [{ kind: 'rule' }];
      case 'details':
        return [this.details(node)];
      case 'div':
        return this.div(node);
      case 'section':
        return this.section(node);
      case 'math-renderer':
        return [{ kind: 'code', language: 'math', text: math(rawText(node)) }];
      case 'dt': {
        const children = this.paragraph(node.children);
        return children.length > 0
          ? [{ kind: 'paragraph', children: [{ kind: 'strong', children }] }]
          : [];
      }
      default:
        // `dl`, `dd`, `li`, `summary` and table parts out of place: their content.
        return this.blocks(node.children);
    }
  }

  /** GitHub's alerts and highlighted code are `div`s; any other `div` is its content. */
  private div(node: Element): Block[] {
    const names = classes(node);
    if (names.includes('markdown-alert')) {
      const type = ALERTS.find((alert) => names.includes(`markdown-alert-${alert}`));
      const children = this.blocks(node.children);
      if (type) {
        const alert: Alert = { kind: 'alert', type, children };
        return [alert];
      }
      return [{ kind: 'quote', children }];
    }
    if (names.includes('highlight')) {
      const scope = names.find((name) => /^highlight-(?:source|text)-/.test(name));
      const language = scope?.replace(/^highlight-(?:source|text)-/, '').split('-')[0];
      const text = withoutNewline(rawText(node));
      return [
        language && isLanguage(language)
          ? { kind: 'code', language, text }
          : { kind: 'code', text },
      ];
    }
    return this.blocks(node.children);
  }

  /** A diagram GitHub renders in the page, as its code; any other section, its content. */
  private section(node: Element): Block[] {
    if (hasClass(node, 'js-render-needs-enrichment')) {
      const pre = find(node, 'pre');
      const language = (pre && property(pre, 'lang')) ?? property(node, 'dataType');
      const text = withoutNewline(rawText(pre ?? node));
      return [
        language && isLanguage(language)
          ? { kind: 'code', language, text }
          : { kind: 'code', text },
      ];
    }
    return this.blocks(node.children);
  }

  private pre(node: Element): Block {
    const text = withoutNewline(rawText(node));
    const language = property(node, 'lang');
    if (language === 'suggestion') return { kind: 'suggestion', text };
    return language && isLanguage(language)
      ? { kind: 'code', language, text }
      : { kind: 'code', text };
  }

  private list(node: Element): Block {
    const ordered = node.tagName === 'ol';
    const start = Number(property(node, 'start') ?? 1);
    const items: ListItem[] = [];
    let tight = true;
    let loose: (RootContent | ElementContent)[] = [];
    const endLoose = (): void => {
      if (loose.some((child) => !isBlank(child))) items.push({ children: this.blocks(loose) });
      loose = [];
    };
    for (const child of node.children) {
      if (!isElement(child, 'li')) {
        loose.push(child);
        continue;
      }
      endLoose();
      if (child.children.some((grandchild) => isElement(grandchild, 'p'))) tight = false;
      items.push(this.item(child));
    }
    endLoose();
    return {
      kind: 'list',
      ordered,
      start: ordered && Number.isSafeInteger(start) && start >= 0 && start < 1e9 ? start : 1,
      tight,
      items,
    };
  }

  /** A list item, ticked or not when it's a task: GitHub marks it with a checkbox first. */
  private item(node: Element): ListItem {
    if (!hasClass(node, 'task-list-item')) return { children: this.blocks(node.children) };
    const children = [...node.children];
    const first = children.findIndex((child) => !isBlank(child));
    const box = children[first];
    if (!isElement(box, 'input') || property(box, 'type') !== 'checkbox') {
      return { children: this.blocks(node.children) };
    }
    children.splice(0, first + 1);
    return { checked: Boolean(box.properties['checked']), children: this.blocks(children) };
  }

  private table(node: Element): Table {
    const rows: { cells: Element[]; head: boolean }[] = [];
    // Rows in order, through the table's sections, which nest no further.
    const visit = (parent: Element, head: boolean): void => {
      for (const child of parent.children) {
        if (!isElement(child)) continue;
        if (child.tagName === 'tr') {
          const cells = child.children.filter(
            (cell): cell is Element => isElement(cell, 'td') || isElement(cell, 'th'),
          );
          rows.push({ cells, head: head || cells.every((cell) => cell.tagName === 'th') });
        } else if (['thead', 'tbody', 'tfoot'].includes(child.tagName)) {
          visit(child, child.tagName === 'thead');
        }
      }
    };
    visit(node, false);
    const headRow = rows[0]?.head ? rows.shift() : undefined;
    const cell = (element: Element): Inline[] => this.paragraph(element.children);
    const head = headRow?.cells.map(cell) ?? [];
    const align = (headRow?.cells ?? rows[0]?.cells ?? []).map((element) => {
      const value = property(element, 'align');
      return value === 'left' || value === 'center' || value === 'right' ? value : 'none';
    });
    return { kind: 'table', align, head, rows: rows.map((row) => row.cells.map(cell)) };
  }

  private details(node: Element): Block {
    const summary = node.children.find((child) => isElement(child, 'summary'));
    const rest = node.children.filter((child) => child !== summary);
    return {
      kind: 'details',
      open: node.properties['open'] !== undefined && node.properties['open'] !== false,
      summary: isElement(summary) ? this.paragraph(summary.children) : [],
      children: this.blocks(rest),
    };
  }

  /** Inline content laid out as on the page: spaces collapsed, and none at a line's ends. */
  private paragraph(nodes: readonly (RootContent | ElementContent)[]): Inline[] {
    const out = this.inlines(nodes, false);
    trimInlines(out);
    return out;
  }

  /** Inline nodes. `linked` when inside a link, where another link can't go. */
  private inlines(nodes: readonly (RootContent | ElementContent)[], linked: boolean): Inline[] {
    const out: Inline[] = [];
    for (const node of nodes) {
      if (node.type === 'text') push(out, [{ kind: 'text', value: collapse(node.value) }]);
      else if (node.type === 'element') push(out, this.inline(node, linked));
    }
    return out;
  }

  private inline(node: Element, linked: boolean): Inline[] {
    const made = this.element(node, linked);
    // A container with nothing in it shows nothing, and isn't kept to fill the tree.
    return made.filter((inline) => !('children' in inline) || inline.children.length > 0);
  }

  private element(node: Element, linked: boolean): Inline[] {
    const children = (inLink = linked): Inline[] => this.inlines(node.children, inLink);
    switch (node.tagName) {
      case 'a':
        return this.anchor(node, linked);
      case 'img':
        if (hasClass(node, 'emoji')) {
          const alt = property(node, 'alt') ?? property(node, 'title') ?? '';
          return alt === '' ? [] : [{ kind: 'text', value: alt }];
        }
        return this.builder.image(
          property(node, 'src'),
          collapse(property(node, 'alt') ?? ''),
          linked,
        );
      case 'br':
        return [{ kind: 'break' }];
      case 'strong':
      case 'b':
        return [{ kind: 'strong', children: children() }];
      case 'em':
      case 'i':
      case 'var':
        return [{ kind: 'emphasis', children: children() }];
      case 'del':
      case 's':
      case 'strike':
        return [{ kind: 'strike', children: children() }];
      case 'code':
      case 'samp':
      case 'tt':
        return [{ kind: 'inlineCode', value: rawText(node) }];
      case 'sub':
        return [{ kind: 'sub', children: children() }];
      case 'sup': {
        // GitHub writes a footnote's reference as a link in `sup`.
        const only = node.children.filter((child) => !isBlank(child));
        if (
          only.length === 1 &&
          isElement(only[0], 'a') &&
          only[0].properties['dataFootnoteRef'] !== undefined
        ) {
          return this.anchor(only[0], linked);
        }
        return [{ kind: 'sup', children: children() }];
      }
      case 'kbd':
        return [{ kind: 'kbd', children: children() }];
      case 'math-renderer':
        return [{ kind: 'inlineCode', value: math(rawText(node)) }];
      case 'video': {
        const src = property(node, 'src');
        if (src === undefined) return [];
        return linked
          ? [{ kind: 'text', value: src }]
          : this.builder.link(src, [{ kind: 'text', value: src }]);
      }
      case 'input':
        return [];
      default:
        // Blocks within inline content, and anything else: their content.
        return children();
    }
  }

  private anchor(node: Element, linked: boolean): Inline[] {
    const href = property(node, 'href');
    if (node.properties['dataFootnoteRef'] !== undefined) {
      const name = href === undefined ? undefined : fragmentName(href);
      const number = name === undefined ? undefined : this.footnotes.get(name);
      if (name !== undefined && number !== undefined)
        return [{ kind: 'footnoteReference', name, number }];
      return this.inlines(node.children, linked);
    }
    // Footnotes' links back, and headings' permalinks, are the renderer's to draw: GitHub's hold
    // an arrow, or only an icon. Anything else marked as one is an ordinary link.
    const written = collapse(textOf(node)).trim();
    if (node.properties['dataFootnoteBackref'] !== undefined && /^↩\d*$/.test(written)) return [];
    if (hasClass(node, 'anchor') && written === '') return [];
    if (hasClass(node, 'user-mention') || hasClass(node, 'team-mention')) {
      if (written.startsWith('@') && !linked)
        return this.builder.mention(written.slice(1), written);
    }
    // GitHub links each image to itself; the image is enough.
    const content = node.children.filter((child) => !isBlank(child));
    const [image] = content;
    if (
      content.length === 1 &&
      isElement(image, 'img') &&
      href !== undefined &&
      property(image, 'src') === href
    ) {
      return this.inline(image, linked);
    }
    if (href === undefined || linked) return this.inlines(node.children, linked);
    return this.builder.link(href, this.inlines(node.children, true));
  }
}

/** The first `tag` element in `node`, found with an explicit stack. */
function find(node: Element, tag: string): Element | undefined {
  const stack: ElementContent[] = node.children.toReversed();
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (next.type !== 'element') continue;
    if (next.tagName === tag) return next;
    for (let i = next.children.length - 1; i >= 0; i--) stack.push(next.children[i]!);
  }
  return undefined;
}

function headingLevel(tag: string): 1 | 2 | 3 | 4 | 5 | 6 {
  switch (tag) {
    case 'h1':
      return 1;
    case 'h2':
      return 2;
    case 'h3':
      return 3;
    case 'h4':
      return 4;
    case 'h5':
      return 5;
    default:
      return 6;
  }
}

function isLanguage(name: string): boolean {
  return /^[A-Za-z0-9][\w+#.-]{0,63}$/.test(name);
}

function withoutNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/** TeX as GitHub writes it for its renderer, without the dollars around it. */
function math(text: string): string {
  const trimmed = text.trim();
  for (const fence of ['$$', '$']) {
    if (
      trimmed.length >= 2 * fence.length &&
      trimmed.startsWith(fence) &&
      trimmed.endsWith(fence)
    ) {
      return trimmed.slice(fence.length, -fence.length).trim();
    }
  }
  return trimmed;
}

/** Adds `nodes` to `out`, joining text to text and leaving out empty text. */
function push(out: Inline[], nodes: readonly Inline[]): void {
  for (const node of nodes) {
    if (node.kind === 'text') {
      if (node.value === '') continue;
      const last = out.at(-1);
      if (last?.kind === 'text') {
        out[out.length - 1] = { kind: 'text', value: last.value + node.value };
        continue;
      }
    }
    out.push(node);
  }
}

/**
 * Takes the spaces off each line's ends, as a page lays text out: at the paragraph's start and
 * end, and either side of each break, at any depth of inline nesting.
 */
function trimInlines(list: Inline[]): void {
  trimEdge(list, 'start');
  trimEdge(list, 'end');
  trimBreaks(list);
}

/** Trims the text at one end of `list`, the first or last text however deeply nested. */
function trimEdge(list: Inline[], edge: 'start' | 'end'): void {
  let children: Inline[] | undefined = list;
  while (children && children.length > 0) {
    const index: number = edge === 'start' ? 0 : children.length - 1;
    const node: Inline = children[index]!;
    if (node.kind === 'text') {
      const value = edge === 'start' ? node.value.trimStart() : node.value.trimEnd();
      if (value === '') {
        children.splice(index, 1);
        continue;
      }
      children[index] = { kind: 'text', value };
      return;
    }
    children = 'children' in node ? node.children : undefined;
  }
}

/** Trims text either side of every break, in `list` and the inline nodes in it. */
function trimBreaks(list: Inline[]): void {
  const kept: Inline[] = [];
  for (const [i, node] of list.entries()) {
    if (node.kind !== 'text') {
      if ('children' in node) trimBreaks(node.children);
      kept.push(node);
      continue;
    }
    let value = node.value;
    if (list[i - 1]?.kind === 'break') value = value.trimStart();
    if (list[i + 1]?.kind === 'break') value = value.trimEnd();
    if (value !== '') kept.push({ kind: 'text', value });
  }
  // A break at the very end shows nothing.
  while (kept.at(-1)?.kind === 'break') kept.pop();
  list.length = 0;
  append(list, kept);
}
