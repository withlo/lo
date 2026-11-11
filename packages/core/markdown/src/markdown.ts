/**
 * Markdown to Lo's tree: the comment box's preview, offline drafts and overviews. The text comes
 * from anyone, so every step is bounded: the text is cut to a length, nothing past the depth limit
 * reaches a step that recurses, the tree's size is capped, and the mapping is a closed switch over
 * the parser's tokens, each kind with only the fields Lo sets. Raw HTML shows as its text, and
 * links and images pass Lo's rules or become text.
 */

import type { Token } from 'markdown-it';

import { Anchors } from './anchors.ts';
import { imageAddress } from './images.ts';
import { cut, MAX_ADDRESS, MAX_DIAGNOSTICS, resolveLimits, type Limits } from './limits.ts';
import { fragmentName, webLink } from './links.ts';
import { environment, parser, type Plugin } from './parser.ts';
import { isLogin, isRepoName, type Repo } from './references.ts';
import type {
  Alert,
  Block,
  Diagnostic,
  Extension,
  Footnote,
  Inline,
  ListItem,
  Note,
  Paragraph,
  Plain,
  Table,
  Target,
  Text,
  Tree,
} from './tree.ts';

export interface MarkdownOptions<X extends Extension = Plain> {
  /** The repository `#123` and `GH-123` resolve against. Without one, they stay text. */
  repo?: Repo;
  /** The address of the page the text is on, which relative links resolve against. */
  page?: string;
  /** Whether a newline inside a paragraph breaks the line, as in GitHub's comments. Default true. */
  breaks?: boolean;
  limits?: Partial<Limits>;
  /** Syntax an extension adds, such as the overview format's blocks. */
  syntax?: Syntax<X>;
}

/**
 * What an extension adds: markdown-it plugins for its syntax, and handlers that turn the tokens
 * they make into the extension's nodes. Its tokens count toward the depth and node limits like any
 * other, and an open token's children reach its handler already mapped.
 */
export interface Syntax<X extends Extension> {
  plugins?: readonly Plugin[];
  /**
   * By the token types the plugins add; Lo's own types are always Lo's. A handler that returns
   * undefined leaves its token's children, or its text, in its place.
   */
  blocks?: Readonly<Record<string, BlockHandler<X>>>;
  inlines?: Readonly<Record<string, InlineHandler<X>>>;
  /** Claims a link's address before Lo's rules see it: a target of the extension's own, or undefined. */
  link?: (href: string) => X['target'] | undefined;
}

export interface HandlerContext {
  /** The line the token is on, from 1, when the parser knows it. */
  line?: number;
}

export type BlockHandler<X extends Extension> = (
  token: Token,
  children: Block<X>[],
  context: HandlerContext,
) => Block<X> | undefined;

export type InlineHandler<X extends Extension> = (
  token: Token,
  children: Inline<X>[],
  context: HandlerContext,
) => Inline<X> | undefined;

/** The nodes of a stretch of plain text standing in for content Lo doesn't show as it is. */
const PLAIN_NODES = 2;

/** `text`, Markdown from anyone, as Lo's tree. Pure and synchronous; never throws on any text. */
export function markdownTree<X extends Extension = Plain>(
  text: string,
  options: MarkdownOptions<X> = {},
): Tree<X> {
  const limits = resolveLimits(options.limits);
  const notes = new Set<Note>();
  const kept = cut(text, limits.length);
  if (kept.cut) notes.add('cut');
  // As markdown-it reads it, so its line numbers count the same lines.
  const source = kept.text.toWellFormed().replace(/\r\n?/g, '\n').replaceAll('\0', '�');
  const repo = options.repo && isLogin(options.repo.owner) && isRepoName(options.repo.name);
  const env = environment(repo ? options.repo : undefined);
  try {
    // A few levels past the limit, so whatever is too deep is seen to be.
    const tokens = parser(limits.depth + 4, options.syntax?.plugins).parse(source, env);
    const mapper = new Mapper<X>(tokens, source, options, limits, notes);
    return finish({ blocks: mapper.map(), notes, diagnostics: mapper.diagnostics });
  } catch (error) {
    // Nothing recurses past the nesting limit, so this is a backstop: text that overflows the
    // stack anyway shows as plain text rather than failing the job.
    if (!(error instanceof RangeError)) throw error;
    notes.add('deep');
    return finish({ blocks: plainBlocks(source), notes, diagnostics: [] });
  }
}

function finish<X extends Extension>(tree: {
  blocks: Block<X>[];
  notes: Set<Note>;
  diagnostics: Diagnostic[];
}): Tree<X> {
  const order: Note[] = ['cut', 'deep', 'nodes'];
  return {
    blocks: tree.blocks,
    notes: order.filter((note) => tree.notes.has(note)),
    diagnostics: tree.diagnostics,
  };
}

/** `text` as one plain paragraph, or nothing when it's empty. */
function plainBlocks<X extends Extension>(text: string): Block<X>[] {
  const value = text.replace(/\n+$/, '');
  return value === '' ? [] : [{ kind: 'paragraph', children: [{ kind: 'text', value }] }];
}

/** A stretch of tokens, `[start, end)`, and how it's shown. */
interface Region {
  start: number;
  end: number;
  /** Shown as the text of these lines, `[from, to)`, instead of its tokens. */
  plain?: [number, number];
}

/** What the guard measured of a stretch of tokens. */
interface Measure {
  depth: number;
  nodes: number;
}

/** Tokens that wrap others without a node of their own in Lo's tree. */
const WRAPPERS = new Set(['thead_open', 'thead_close', 'tbody_open', 'tbody_close']);
/** Tokens that make no node of their own. */
const UNCOUNTED = new Set(['inline', 'footnote_anchor']);

class Mapper<X extends Extension> {
  readonly diagnostics: Diagnostic[] = [];
  private readonly close: Int32Array;
  private readonly lineStarts: number[];
  private readonly anchors = new Anchors();
  private readonly headingNames = new Map<number, string>();
  private readonly footnoteNames = new Map<number, string>();
  private readonly syntax: Syntax<X>;
  private readonly page: string | undefined;
  private readonly breaks: boolean;
  private readonly tokens: Token[];
  private readonly source: string;
  private readonly limits: Limits;
  private readonly notes: Set<Note>;
  private images = 0;
  private addresses = 0;
  private line: number | undefined;

  constructor(
    tokens: Token[],
    source: string,
    options: MarkdownOptions<X>,
    limits: Limits,
    notes: Set<Note>,
  ) {
    this.tokens = tokens;
    this.source = source;
    this.limits = limits;
    this.notes = notes;
    this.close = matchingCloses(tokens);
    this.lineStarts = lineStarts(source);
    this.syntax = options.syntax ?? {};
    this.page = options.page;
    this.breaks = options.breaks ?? true;
  }

  map(): Block<X>[] {
    const { main, footnotes } = this.guard();
    for (const [, item] of footnotes) this.footnoteNames.set(item.id, item.name);
    for (const [, item] of footnotes) this.anchors.reserve(item.name);
    for (const region of [...main, ...[...footnotes.values()].map((item) => item.region)]) {
      if (!region.plain) this.nameHeadings(region);
    }
    const blocks: Block<X>[] = [];
    for (const region of main) blocks.push(...this.region(region));
    if (footnotes.size > 0) {
      const items: Footnote<X>[] = [];
      for (const item of footnotes.values()) {
        items.push({ name: item.name, number: item.id + 1, children: this.region(item.region) });
      }
      blocks.push({ kind: 'footnotes', items });
    }
    return blocks;
  }

  // The guard: measures every stretch of tokens with an explicit stack, before anything that
  // recurses sees it, and decides what shows as plain text.

  private guard(): {
    main: Region[];
    footnotes: Map<number, { id: number; name: string; region: Region }>;
  } {
    const main: Region[] = [];
    const footnotes = new Map<number, { id: number; name: string; region: Region }>();
    let nodes = 0;
    let full = false;
    for (let i = 0; i < this.tokens.length; i = this.after(i)) {
      const token = this.tokens[i];
      if (!token) break;
      if (token.type === 'footnote_block_open') {
        for (let j = i + 1; j < this.close[i]!; j = this.after(j)) {
          const item = this.tokens[j];
          if (item?.type !== 'footnote_open') continue;
          const id = Number(item.meta?.['id']);
          const label = labelOf(item);
          if (!Number.isSafeInteger(id) || id < 0) continue;
          const { region, nodes: inside } = this.fit({ start: j + 1, end: this.close[j]! }, 2);
          const size = 1 + inside;
          if (full || nodes + size > this.limits.nodes) {
            full = true;
            this.notes.add('nodes');
            continue;
          }
          nodes += size;
          footnotes.set(id, { id, name: `fn-${label}`, region });
        }
        continue;
      }
      if (full) continue;
      const { region, nodes: size } = this.fit({ start: i, end: this.after(i) }, 0);
      if (nodes + size > this.limits.nodes) {
        // The rest of the text, from this block on, shows as its lines.
        full = true;
        this.notes.add('nodes');
        const from = this.firstLine(i, this.tokens.length);
        if (from !== undefined) {
          main.push({ start: i, end: this.tokens.length, plain: [from, this.lineStarts.length] });
          nodes += PLAIN_NODES;
        }
        continue;
      }
      nodes += size;
      main.push(region);
    }
    return { main, footnotes };
  }

  /**
   * `region`, at `depth` levels in, shown as plain text when it nests past the depth limit, and
   * how many nodes it makes.
   */
  private fit(region: Region, depth: number): { region: Region; nodes: number } {
    const measure = this.measure(region.start, region.end, depth);
    if (measure.depth <= this.limits.depth) return { region, nodes: measure.nodes };
    this.notes.add('deep');
    const from = this.firstLine(region.start, region.end);
    const to = this.lastLine(region.start, region.end);
    const plain: [number, number] = from === undefined || to === undefined ? [0, 0] : [from, to];
    return { region: { ...region, plain }, nodes: PLAIN_NODES };
  }

  /** How deep tokens `[start, end)` nest, starting `depth` levels in, and how many nodes they make. */
  private measure(start: number, end: number, depth: number): Measure {
    let level = depth;
    let deepest = depth;
    let nodes = 0;
    for (let i = start; i < end; i++) {
      const token = this.tokens[i];
      if (!token) break;
      if (WRAPPERS.has(token.type)) continue;
      if (token.nesting === 1) {
        level += 1;
        nodes += 1;
        deepest = Math.max(deepest, level);
      } else if (token.nesting === -1) {
        level = Math.max(depth, level - 1);
      } else if (!UNCOUNTED.has(token.type)) {
        nodes += 1;
      }
      if (token.type === 'inline' && token.children) {
        let inner = level;
        for (const child of token.children) {
          if (child.nesting === 1) {
            inner += 1;
            nodes += 1;
            deepest = Math.max(deepest, inner);
          } else if (child.nesting === -1) {
            inner = Math.max(level, inner - 1);
          } else {
            nodes += 1;
          }
        }
      }
    }
    return { depth: deepest, nodes };
  }

  /** The index after the token at `i` and, when it opens, everything up to its close. */
  private after(i: number): number {
    const close = this.close[i]!;
    return close >= 0 ? close + 1 : i + 1;
  }

  private firstLine(start: number, end: number): number | undefined {
    for (let i = start; i < end; i++) {
      const map = this.tokens[i]?.map;
      if (map) return map[0];
    }
    return undefined;
  }

  private lastLine(start: number, end: number): number | undefined {
    let last: number | undefined;
    for (let i = start; i < end; i++) {
      const map = this.tokens[i]?.map;
      if (map) last = Math.max(last ?? 0, map[1]);
    }
    return last;
  }

  private lines([from, to]: [number, number]): string {
    const start = this.lineStarts[from] ?? this.source.length;
    const end = this.lineStarts[to] ?? this.source.length;
    return this.source.slice(start, end);
  }

  private nameHeadings(region: Region): void {
    for (let i = region.start; i < region.end; i++) {
      const token = this.tokens[i];
      if (token?.type !== 'heading_open') continue;
      const inline = this.tokens[i + 1];
      this.headingNames.set(
        i,
        this.anchors.heading(inline?.children ? textOf(inline.children) : ''),
      );
    }
  }

  // The mapping: a closed switch over token types. The guard has bounded how deep it recurses.

  private region(region: Region): Block<X>[] {
    if (region.plain) return plainBlocks(this.lines(region.plain));
    return this.blocks(region.start, region.end);
  }

  private blocks(start: number, end: number): Block<X>[] {
    const out: Block<X>[] = [];
    for (let i = start; i < end; i = this.after(i)) {
      const token = this.tokens[i];
      if (!token) break;
      if (token.map) this.line = token.map[0] + 1;
      out.push(...this.block(i));
    }
    return out;
  }

  private block(i: number): Block<X>[] {
    const token = this.tokens[i]!;
    const close = this.close[i]!;
    switch (token.type) {
      case 'paragraph_open':
        return [{ kind: 'paragraph', children: this.inlineIn(i + 1, close) }];
      case 'heading_open':
        return [
          {
            kind: 'heading',
            level: headingLevel(token.tag),
            anchor: this.headingNames.get(i) ?? '',
            children: this.inlineIn(i + 1, close),
          },
        ];
      case 'blockquote_open':
        return [this.quote(i, close)];
      case 'bullet_list_open':
      case 'ordered_list_open':
        return [this.list(i, close)];
      case 'fence':
        return [this.fence(token)];
      case 'code_block':
        return [{ kind: 'code', text: withoutNewline(token.content) }];
      case 'hr':
        return [{ kind: 'rule' }];
      case 'html_block':
        this.diagnose('html');
        return plainBlocks(withoutComments(token.content));
      case 'table_open':
        return [this.table(i, close)];
      default: {
        // An extension's token, which its handler maps; or anything else, as its children or its
        // text. Never dropped, never passed through.
        const children = close >= 0 ? this.blocks(i + 1, close) : undefined;
        const made = own(this.syntax.blocks, token.type)?.(token, children ?? [], {
          line: this.line,
        });
        if (made) return [made];
        return children ?? plainBlocks(token.content);
      }
    }
  }

  /** The inline content of the block whose tokens are `[start, end)`. */
  private inlineIn(start: number, end: number): Inline<X>[] {
    const out: Inline<X>[] = [];
    for (let i = start; i < end; i++) {
      const token = this.tokens[i];
      if (token?.type === 'inline' && token.children) push(out, this.inlines(token.children));
    }
    return out;
  }

  private quote(i: number, close: number): Block<X> {
    const type = alertType(this.tokens, i);
    if (type) {
      // The marker and the line break after it.
      const inline = this.tokens[i + 2]!;
      const skip = inline.children?.[1]?.type.endsWith('break') ? 2 : 1;
      inline.children = inline.children?.slice(skip) ?? null;
      const children = this.blocks(i + 1, close).filter(
        (block, index) => index > 0 || !isParagraph(block) || block.children.length > 0,
      );
      const alert: Alert<X> = { kind: 'alert', type, children };
      return alert;
    }
    return { kind: 'quote', children: this.blocks(i + 1, close) };
  }

  private list(i: number, close: number): Block<X> {
    const token = this.tokens[i]!;
    const ordered = token.type === 'ordered_list_open';
    const start = Number(token.attrGet('start') ?? 1);
    const items: ListItem<X>[] = [];
    let tight = true;
    for (let j = i + 1; j < close; j = this.after(j)) {
      const item = this.tokens[j];
      if (item?.type !== 'list_item_open') continue;
      const itemClose = this.close[j]!;
      for (let k = j + 1; k < itemClose; k = this.after(k)) {
        const child = this.tokens[k];
        if (child?.type === 'paragraph_open' && !child.hidden) tight = false;
      }
      const checked = taskMarker(this.tokens, j);
      const children = this.blocks(j + 1, itemClose);
      items.push(checked === undefined ? { children } : { checked, children });
    }
    return {
      kind: 'list',
      ordered,
      start: ordered && Number.isSafeInteger(start) && start >= 0 && start < 1e9 ? start : 1,
      tight,
      items,
    };
  }

  private fence(token: Token): Block<X> {
    const text = withoutNewline(token.content);
    const language = token.info.trim().split(/\s/, 1)[0] ?? '';
    if (language === 'suggestion') return { kind: 'suggestion', text };
    return /^[A-Za-z0-9][\w+#.-]{0,63}$/.test(language)
      ? { kind: 'code', language, text }
      : { kind: 'code', text };
  }

  private table(i: number, close: number): Table<X> {
    const align: Table<X>['align'] = [];
    const head: Inline<X>[][] = [];
    const rows: Inline<X>[][][] = [];
    let inHead = false;
    let row: Inline<X>[][] | undefined;
    for (let j = i + 1; j < close; j++) {
      const token = this.tokens[j]!;
      switch (token.type) {
        case 'thead_open':
          inHead = true;
          break;
        case 'thead_close':
          inHead = false;
          break;
        case 'tr_open':
          row = [];
          break;
        case 'tr_close':
          if (row && !inHead) rows.push(row);
          row = undefined;
          break;
        case 'th_open':
        case 'td_open': {
          const cellClose = this.close[j]!;
          const cell = this.inlineIn(j + 1, cellClose);
          if (inHead) {
            head.push(cell);
            align.push(alignment(token.attrGet('style')));
          } else {
            row?.push(cell);
          }
          j = cellClose;
          break;
        }
        default:
          break;
      }
    }
    return { kind: 'table', align, head, rows };
  }

  /** Inline tokens as Lo's inline nodes. */
  private inlines(children: Token[]): Inline<X>[] {
    const close = matchingCloses(children);
    // `linked` when inside a link, where another link can't go.
    const walk = (start: number, end: number, linked: boolean): Inline<X>[] => {
      const out: Inline<X>[] = [];
      for (let i = start; i < end; i++) {
        const token = children[i]!;
        const to = close[i]!;
        const inner = (inLink = linked): Inline<X>[] => (to >= 0 ? walk(i + 1, to, inLink) : []);
        switch (token.type) {
          case 'text':
          case 'text_special':
            push(out, [{ kind: 'text', value: token.content }]);
            break;
          case 'softbreak':
            push(out, [this.breaks ? { kind: 'break' } : { kind: 'text', value: ' ' }]);
            break;
          case 'hardbreak':
            push(out, [{ kind: 'break' }]);
            break;
          case 'code_inline':
            push(out, [{ kind: 'inlineCode', value: token.content }]);
            break;
          case 'strong_open':
            push(out, [{ kind: 'strong', children: inner() }]);
            break;
          case 'em_open':
            push(out, [{ kind: 'emphasis', children: inner() }]);
            break;
          case 's_open':
            push(out, [{ kind: 'strike', children: inner() }]);
            break;
          case 'link_open':
            push(out, linked ? inner() : this.link(token.attrGet('href'), inner(true)));
            break;
          case 'image':
            push(out, this.image(token, linked));
            break;
          case 'html_inline': {
            this.diagnose('html');
            const value = withoutComments(token.content);
            if (value !== '') push(out, [{ kind: 'text', value }]);
            break;
          }
          case 'footnote_ref':
            push(out, this.footnoteReference(token));
            break;
          case 'lo_mention':
            push(out, this.mention(token));
            break;
          default: {
            // An extension's token, which its handler maps; or anything else, as its children
            // or its text.
            const mapped = to >= 0 ? inner() : undefined;
            const made = own(this.syntax.inlines, token.type)?.(token, mapped ?? [], {
              line: this.line,
            });
            if (made) push(out, [made]);
            else push(out, mapped ?? [{ kind: 'text', value: token.content }]);
          }
        }
        if (to >= 0) i = to;
      }
      return out;
    };
    return walk(0, children.length, false);
  }

  /** A link to `href` holding `children`, or the children alone when Lo won't follow it. */
  private link(href: string | number | null, children: Inline<X>[]): Inline<X>[] {
    const target = typeof href === 'string' ? this.target(href) : undefined;
    if (target) return [{ kind: 'link', target, children }];
    this.diagnose('link');
    return children;
  }

  /** Where a link to `href` goes, or undefined when Lo won't follow it. */
  private target(href: string): Target<X> | undefined {
    const claimed = this.syntax.link?.(href);
    if (claimed) return claimed;
    const name = fragmentName(href);
    if (name !== undefined && this.anchors.has(name)) {
      const charged = this.address(href, () => name);
      return charged === undefined ? undefined : { kind: 'anchor', name: charged };
    }
    const url = this.address(href, (address) => webLink(address, this.page));
    return url === undefined ? undefined : { kind: 'web', url };
  }

  /**
   * `read(href)`, charged against the limit on addresses, or undefined when it's refused or the
   * limit is spent. An address too long to keep isn't read at all, so a huge one named by
   * reference over and over costs nothing.
   */
  private address(href: string, read: (href: string) => string | undefined): string | undefined {
    if (href.length > MAX_ADDRESS) return undefined;
    const url = read(href);
    // Normalizing can lengthen an address, so the limits hold for what's kept.
    if (url === undefined || url.length > MAX_ADDRESS) return undefined;
    if (this.addresses + url.length > this.limits.addresses) return undefined;
    this.addresses += url.length;
    return url;
  }

  /** An image, or when Lo won't load it, a link to it (unless `linked`) or its alt text. */
  private image(token: Token, linked: boolean): Inline<X>[] {
    const src = token.attrGet('src');
    const alt = token.children ? textOf(token.children) : token.content;
    if (typeof src !== 'string') return alt === '' ? [] : [{ kind: 'text', value: alt }];
    if (this.images < this.limits.images) {
      const url = this.address(src, (address) => imageAddress(address, this.page));
      if (url !== undefined) {
        this.images += 1;
        return [{ kind: 'image', url, alt }];
      }
      this.diagnose('image');
    }
    // Shown as a link to where it is, by its alt text, or as the alt text alone.
    const url = linked ? undefined : this.address(src, (address) => webLink(address, this.page));
    if (url !== undefined) {
      return [
        {
          kind: 'link',
          target: { kind: 'web', url },
          children: [{ kind: 'text', value: alt === '' ? url : alt }],
        },
      ];
    }
    return alt === '' ? [] : [{ kind: 'text', value: alt }];
  }

  private footnoteReference(token: Token): Inline<X>[] {
    const id = Number(token.meta?.['id']);
    const name = this.footnoteNames.get(id);
    if (name === undefined) return [{ kind: 'text', value: `[^${labelOf(token)}]` }];
    return [{ kind: 'footnoteReference', name, number: id + 1 }];
  }

  private mention(token: Token): Inline<X>[] {
    const name = token.meta?.['name'];
    const url = token.meta?.['url'];
    if (typeof name === 'string' && typeof url === 'string') {
      const charged = this.address(url, (address) => webLink(address));
      if (charged !== undefined) return [{ kind: 'mention', name, url: charged }];
    }
    return [{ kind: 'text', value: token.content }];
  }

  private diagnose(code: Diagnostic['code']): void {
    if (this.diagnostics.length >= MAX_DIAGNOSTICS) return;
    this.diagnostics.push(this.line === undefined ? { code } : { code, line: this.line });
  }
}

/** For each token that opens, the index of the token that closes it; -1 for every other. */
function matchingCloses(tokens: readonly Token[]): Int32Array {
  const close = new Int32Array(tokens.length).fill(-1);
  const open: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const nesting = tokens[i]!.nesting;
    if (nesting === 1) open.push(i);
    else if (nesting === -1) {
      const from = open.pop();
      if (from !== undefined) close[from] = i;
    }
  }
  // Left open by a plugin: closed at the end.
  for (const from of open) close[from] = tokens.length;
  return close;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let at = source.indexOf('\n'); at !== -1; at = source.indexOf('\n', at + 1)) {
    starts.push(at + 1);
  }
  return starts;
}

/** The plain text of inline tokens, as an image's alt text or a heading's slug reads it. */
function textOf(children: readonly Token[]): string {
  let text = '';
  const stack: (readonly Token[])[] = [children];
  const at: number[] = [0];
  while (stack.length > 0) {
    const list = stack.at(-1)!;
    const index = at.at(-1)!;
    if (index >= list.length) {
      stack.pop();
      at.pop();
      continue;
    }
    at[at.length - 1] = index + 1;
    const token = list[index]!;
    if (token.type === 'text' || token.type === 'text_special' || token.type === 'code_inline') {
      text += token.content;
    } else if (token.type === 'softbreak' || token.type === 'hardbreak') {
      text += ' ';
    } else if (token.type === 'lo_mention') {
      text += token.content;
    } else if (token.type === 'html_inline') {
      // Raw HTML is its text, here as everywhere.
      text += withoutComments(token.content);
    } else if (token.type === 'image' && token.children) {
      stack.push(token.children);
      at.push(0);
    }
  }
  return text;
}

/** Adds `nodes` to `out`, joining text to text and leaving out empty text. */
function push<X extends Extension>(out: Inline<X>[], nodes: readonly Inline<X>[]): void {
  for (const node of nodes) {
    if (isText(node)) {
      if (node.value === '') continue;
      const last = out.at(-1);
      if (last !== undefined && isText(last)) {
        out[out.length - 1] = { kind: 'text', value: last.value + node.value };
        continue;
      }
    }
    out.push(node);
  }
}

/** Whether `node` is text. Extensions' kinds never reuse Lo's. */
function isText(node: { kind: string }): node is Text {
  return node.kind === 'text';
}

function isParagraph<X extends Extension>(node: { kind: string }): node is Paragraph<X> {
  return node.kind === 'paragraph';
}

function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
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

const ALIGNMENTS = new Map<unknown, Table['align'][number]>([
  ['text-align:left', 'left'],
  ['text-align:center', 'center'],
  ['text-align:right', 'right'],
]);

/** A column's alignment, from the style markdown-it gives its cells. */
function alignment(style: string | number | null): Table['align'][number] {
  return ALIGNMENTS.get(style) ?? 'none';
}

/** A footnote's label, as the footnote plugin keeps it. */
function labelOf(token: Token): string {
  const label = token.meta?.['label'];
  return typeof label === 'string' ? label : '';
}

const ALERTS = new Map<string, Alert['type']>([
  ['[!note]', 'note'],
  ['[!tip]', 'tip'],
  ['[!important]', 'important'],
  ['[!warning]', 'warning'],
  ['[!caution]', 'caution'],
]);

/** The alert the quote opening at `i` is, when its first line is GitHub's marker alone. */
function alertType(tokens: readonly Token[], i: number): Alert['type'] | undefined {
  if (tokens[i + 1]?.type !== 'paragraph_open') return undefined;
  const children = tokens[i + 2]?.children;
  const first = children?.[0];
  if (first?.type !== 'text') return undefined;
  const second = children?.[1];
  if (second && second.type !== 'softbreak' && second.type !== 'hardbreak') return undefined;
  return ALERTS.get(first.content.trimEnd().toLowerCase());
}

/**
 * Whether the list item opening at `i` is a task, `[ ]` or `[x]` at the start of its first
 * paragraph, and if so whether it's ticked. The marker is taken out of the paragraph.
 */
function taskMarker(tokens: readonly Token[], i: number): boolean | undefined {
  if (tokens[i + 1]?.type !== 'paragraph_open') return undefined;
  const first = tokens[i + 2]?.children?.[0];
  if (first?.type !== 'text') return undefined;
  const marker = /^\[([ xX])\](?:[ \t]+|$)/.exec(first.content);
  if (!marker) return undefined;
  first.content = first.content.slice(marker[0].length);
  return marker[1] !== ' ';
}

function withoutNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/**
 * `html` without its comments, which GitHub never shows either. An unclosed comment stays, so no
 * text is hidden that GitHub would show.
 */
function withoutComments(html: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = html.indexOf('<!--', at);
    if (open === -1) break;
    const end = html.indexOf('-->', open + 4);
    if (end === -1) break;
    out += html.slice(at, open);
    at = end + 3;
  }
  return out + html.slice(at);
}
