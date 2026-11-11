/**
 * Markdown to Lo's tree: the comment box's preview, offline drafts, overviews, and a post whose
 * HTML is too long to read. The text comes from anyone, so every step is bounded: the text is cut
 * to a length, nothing nested far past the depth limit reaches a step that recurses, and the tree
 * is assembled under the depth and node limits as built. The mapping is a closed switch over the
 * parser's tokens, each kind with only the fields Lo sets. Raw HTML shows as its text, and links
 * and images pass Lo's rules or become text.
 */

import type { Token } from 'markdown-it';

import { append, assemble, plainBlocks, type FootnotePart, type Part } from './assemble.ts';
import { Builder } from './build.ts';
import { withoutComments } from './html.ts';
import { cut, resolveLimits, type Limits } from './limits.ts';
import { environment, parser, type Plugin } from './parser.ts';
import { isLogin, isRepoName, type Repo } from './references.ts';
import type {
  Alert,
  Block,
  Diagnostic,
  Extension,
  Inline,
  ListItem,
  Note,
  Paragraph,
  Plain,
  Table,
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

/**
 * How far past the depth limit tokens may nest before the part holding them shows as its lines
 * without being built. What is built is measured again, exactly.
 */
const SLACK = 4;

/** `text`, Markdown from anyone, as Lo's tree. Pure and synchronous; never throws on any text. */
export function markdownTree<X extends Extension = Plain>(
  text: string,
  options: MarkdownOptions<X> = {},
): Tree<X> {
  const limits = resolveLimits(options.limits);
  const kept = cut(text, limits.length);
  const notes = new Set<Note>(kept.cut ? ['cut'] : []);
  // As markdown-it reads it, so its line numbers count the same lines.
  const source = kept.text.toWellFormed().replace(/\r\n?/g, '\n').replaceAll('\0', '�');
  const repo = options.repo && isLogin(options.repo.owner) && isRepoName(options.repo.name);
  const env = environment(repo ? options.repo : undefined);
  try {
    // Past this markdown-it reads no deeper; whatever it reaches is more than the slack past the
    // limit, so the part shows as its own lines and nothing markdown-it skipped is lost.
    const nesting = limits.depth + SLACK + 2;
    const tokens = parser(nesting, options.syntax?.plugins).parse(source, env);
    const mapper = new Mapper<X>(tokens, source, options, limits, notes);
    return finish(mapper.map(), notes, mapper.builder.diagnostics);
  } catch (error) {
    // Nothing recurses far past the depth limit, so this is a backstop: text that overflows the
    // stack anyway shows as plain text rather than failing the job, saying only that.
    if (!(error instanceof RangeError)) throw error;
    const fallback = new Set<Note>(kept.cut ? ['cut', 'deep'] : ['deep']);
    return finish(plainBlocks(source), fallback, []);
  }
}

export function finish<X extends Extension>(
  blocks: Block<X>[],
  notes: ReadonlySet<Note>,
  diagnostics: Diagnostic[],
): Tree<X> {
  const order: Note[] = ['cut', 'deep', 'nodes'];
  return { blocks, notes: order.filter((note) => notes.has(note)), diagnostics };
}

/** A stretch of tokens, `[start, end)`. */
interface Region {
  start: number;
  end: number;
}

class Mapper<X extends Extension> {
  readonly builder: Builder<X>;
  private readonly tokens: Token[];
  private readonly source: string;
  private readonly limits: Limits;
  private readonly close: Int32Array;
  private readonly lineStarts: number[];
  private readonly headingNames = new Map<number, string>();
  private readonly footnoteNames = new Map<number, string>();
  private readonly syntax: Syntax<X>;
  private readonly breaks: boolean;

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
    this.close = matchingCloses(tokens);
    this.lineStarts = lineStarts(source);
    this.syntax = options.syntax ?? {};
    this.breaks = options.breaks ?? true;
    this.builder = new Builder<X>(limits, notes, options.page, this.syntax.link);
  }

  map(): Block<X>[] {
    const parts: (Part<X> & { region: Region })[] = [];
    const footnotes: (FootnotePart<X> & { region: Region })[] = [];
    for (let i = 0; i < this.tokens.length; i = this.after(i)) {
      const token = this.tokens[i]!;
      if (token.type !== 'footnote_block_open') {
        parts.push(this.part({ start: i, end: this.after(i) }, 0));
        continue;
      }
      for (let j = i + 1; j < this.close[i]!; j = this.after(j)) {
        const item = this.tokens[j]!;
        const id = Number(item.meta?.['id']);
        if (item.type !== 'footnote_open' || !Number.isSafeInteger(id) || id < 0) continue;
        const label = labelOf(item);
        const name = `fn-${label}`;
        this.footnoteNames.set(id, name);
        this.builder.references.set(name, `[^${label}]`);
        footnotes.push({
          ...this.part({ start: j + 1, end: this.close[j]! }, 2),
          name,
          number: id + 1,
        });
      }
    }
    // Every name first, so a link can go to a heading or footnote further on.
    for (const footnote of footnotes) this.builder.anchors.reserve(footnote.name);
    for (const part of [...parts, ...footnotes]) this.nameHeadings(part.region);
    return assemble(this.builder, parts, footnotes, (index) => {
      const from = parts[index]?.line;
      return from === undefined ? '' : this.lines(from, this.lineStarts.length);
    });
  }

  /**
   * The part of the document in `region`, `depth` levels in. Tokens nested far past the depth
   * limit aren't built at all, so nothing that recurses meets them: the part shows as its lines.
   */
  private part(region: Region, depth: number): Part<X> & { region: Region } {
    const from = this.firstLine(region);
    const to = this.lastLine(region);
    const plain = (): string =>
      from === undefined || to === undefined ? '' : this.lines(from, to);
    if (this.nesting(region, depth) > this.limits.depth + SLACK) {
      this.builder.notes.add('deep');
      return { region: { start: 0, end: 0 }, build: () => plainBlocks(plain()), plain, line: from };
    }
    return { region, build: () => this.blocks(region.start, region.end), plain, line: from };
  }

  /** How deep tokens in `region` nest, starting `depth` levels in, read with an explicit stack. */
  private nesting(region: Region, depth: number): number {
    let level = depth;
    let deepest = depth;
    for (let i = region.start; i < region.end; i++) {
      const token = this.tokens[i]!;
      level = Math.max(depth, level + token.nesting);
      deepest = Math.max(deepest, level);
      let inner = level;
      for (const child of token.children ?? []) {
        inner = Math.max(level, inner + child.nesting);
        deepest = Math.max(deepest, inner);
      }
    }
    return deepest;
  }

  /** The index after the token at `i` and, when it opens, everything up to its close. */
  private after(i: number): number {
    const close = this.close[i]!;
    return close >= 0 ? close + 1 : i + 1;
  }

  private firstLine({ start, end }: Region): number | undefined {
    for (let i = start; i < end; i++) {
      const map = this.tokens[i]?.map;
      if (map) return map[0];
    }
    return undefined;
  }

  private lastLine({ start, end }: Region): number | undefined {
    let last: number | undefined;
    for (let i = start; i < end; i++) {
      const map = this.tokens[i]?.map;
      if (map) last = Math.max(last ?? 0, map[1]);
    }
    return last;
  }

  /** The text of lines `[from, to)`. */
  private lines(from: number, to: number): string {
    const start = this.lineStarts[from] ?? this.source.length;
    const end = this.lineStarts[to] ?? this.source.length;
    return this.source.slice(start, end);
  }

  private nameHeadings({ start, end }: Region): void {
    for (let i = start; i < end; i++) {
      if (this.tokens[i]?.type !== 'heading_open') continue;
      const inline = this.tokens[i + 1];
      const text = inline?.children ? textOf(inline.children) : '';
      this.headingNames.set(i, this.builder.anchors.heading(text));
    }
  }

  // The mapping: a closed switch over token types, recursing no deeper than the tokens nest.

  private blocks(start: number, end: number, top = start === 0 || this.isTop(start)): Block<X>[] {
    const out: Block<X>[] = [];
    for (let i = start; i < end; i = this.after(i)) {
      const token = this.tokens[i]!;
      if (token.map) this.builder.line = token.map[0] + 1;
      append(out, this.block(i, top));
    }
    return out;
  }

  /** Whether the token at `i` sits at the document's top level. */
  private isTop(i: number): boolean {
    return this.tokens[i]?.level === 0 && this.tokens[i]?.type !== 'footnote_open';
  }

  private block(i: number, top: boolean): Block<X>[] {
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
        return [this.quote(i, close, top)];
      case 'bullet_list_open':
      case 'ordered_list_open':
        return [this.list(i, close)];
      case 'fence':
        return [fence(token)];
      case 'code_block':
        return [{ kind: 'code', text: withoutNewline(token.content) }];
      case 'hr':
        return [{ kind: 'rule' }];
      case 'html_block':
        this.builder.diagnose('html');
        return plainBlocks(withoutComments(token.content, 4 * this.limits.nodes));
      case 'table_open':
        return [this.table(i, close)];
      default: {
        // An extension's token, which its handler maps; or anything else, as its children or its
        // text. Never dropped, never passed through.
        const children = close >= 0 ? this.blocks(i + 1, close, false) : undefined;
        const handler = own(this.syntax.blocks, token.type);
        const made = handler?.(token, children ?? [], { line: this.builder.line });
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

  /** A quote, or GitHub's alert: a quote at the top level whose first line is its marker alone. */
  private quote(i: number, close: number, top: boolean): Block<X> {
    const type = top ? alertType(this.tokens, i, close) : undefined;
    if (type) {
      // The marker and the line break after it.
      const inline = this.tokens[i + 2]!;
      const skip = inline.children?.[1]?.type.endsWith('break') ? 2 : 1;
      inline.children = inline.children?.slice(skip) ?? null;
      const children = this.blocks(i + 1, close, false).filter(
        (block, index) => index > 0 || !isParagraph(block) || block.children.length > 0,
      );
      const alert: Alert<X> = { kind: 'alert', type, children };
      return alert;
    }
    return { kind: 'quote', children: this.blocks(i + 1, close, false) };
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
      const children = this.blocks(j + 1, itemClose, false);
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
    const { builder } = this;
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
            push(out, linked ? inner() : builder.link(token.attrGet('href'), inner(true)));
            break;
          case 'image':
            push(out, builder.image(token.attrGet('src'), textOf(token.children ?? []), linked));
            break;
          case 'html_inline':
            builder.diagnose('html');
            // An inline HTML comment is a token of its own, which GitHub never shows.
            if (!token.content.startsWith('<!--'))
              push(out, [{ kind: 'text', value: token.content }]);
            break;
          case 'footnote_ref':
            push(out, this.footnoteReference(token));
            break;
          case 'lo_mention':
            push(out, builder.mention(String(token.meta?.['name']), token.content));
            break;
          default: {
            // An extension's token, which its handler maps; or anything else, as its children
            // or its text.
            const mapped = to >= 0 ? inner() : undefined;
            const handler = own(this.syntax.inlines, token.type);
            const made = handler?.(token, mapped ?? [], { line: builder.line });
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

  private footnoteReference(token: Token): Inline<X>[] {
    const id = Number(token.meta?.['id']);
    const name = this.footnoteNames.get(id);
    if (name === undefined) return [{ kind: 'text', value: `[^${labelOf(token)}]` }];
    return [{ kind: 'footnoteReference', name, number: id + 1 }];
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
    } else if (token.type === 'html_inline' && !token.content.startsWith('<!--')) {
      // Raw HTML is its text, here as everywhere; a comment, nothing.
      text += token.content;
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

/**
 * The alert the quote opening at `i` and closing at `close` is, when its first line is GitHub's
 * marker alone, in any case, and something follows it.
 */
function alertType(tokens: readonly Token[], i: number, close: number): Alert['type'] | undefined {
  if (tokens[i + 1]?.type !== 'paragraph_open') return undefined;
  const children = tokens[i + 2]?.children;
  const first = children?.[0];
  if (first?.type !== 'text') return undefined;
  const second = children?.[1];
  if (second && second.type !== 'softbreak' && second.type !== 'hardbreak') return undefined;
  const type = ALERTS.get(first.content.trimEnd().toLowerCase());
  // GitHub leaves a marker with nothing after it a quote: more in its paragraph, or another block.
  const more = (children?.length ?? 0) > 2 || i + 4 < close;
  return more ? type : undefined;
}

/**
 * Whether the list item opening at `i` is a task, `[ ]` or `[x]` and a space at the start of its
 * first paragraph, and if so whether it's ticked. The marker is taken out of the paragraph.
 */
function taskMarker(tokens: readonly Token[], i: number): boolean | undefined {
  if (tokens[i + 1]?.type !== 'paragraph_open') return undefined;
  const children = tokens[i + 2]?.children;
  const first = children?.[0];
  if (first?.type !== 'text') return undefined;
  // Space must follow, so `[ ]` with nothing after it is text, as on GitHub: markdown-it has
  // already taken the space off a paragraph's end.
  const marker = /^\[([ xX])\][ \t]+/.exec(first.content);
  if (!marker) return undefined;
  first.content = first.content.slice(marker[0].length);
  return marker[1] !== ' ';
}

/** A fenced block: a suggestion, or code, with its language when that's a plain name. */
function fence<X extends Extension>(token: Token): Block<X> {
  const text = withoutNewline(token.content);
  const language = token.info.trim().split(/\s/, 1)[0] ?? '';
  if (language === 'suggestion') return { kind: 'suggestion', text };
  return /^[A-Za-z0-9][\w+#.-]{0,63}$/.test(language)
    ? { kind: 'code', language, text }
    : { kind: 'code', text };
}

function withoutNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}
