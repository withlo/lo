/**
 * Reads the format's structure from markdown-it's tokens, once the whole document is parsed: which
 * fences open and close blocks, what each block holds, the sections, the glossary, and every target.
 * It finds what's wrong with each, and marks what's kept for the mapping to build. Every step is a
 * pass over the tokens with an explicit stack, so deep or long input costs time in proportion to
 * its size and never recursion.
 */

import { MAX_NAME } from '@lo/markdown';
import type { Token } from 'markdown-it';

import { OTHER, unreadLink } from './addresses.ts';
import { quote, type FindingCode, type Findings } from './findings.ts';
import { LIMITS, MIN_STEPS, MIN_TABS } from './limits.ts';
import { utf8Length } from './source.ts';
import {
  CLOSE,
  closes,
  FENCE,
  GLOSSARY_CLOSE,
  GLOSSARY_OPEN,
  LINE,
  OPEN,
  opening,
  PART_CLOSE,
  PART_OPEN,
  PARTS_CLOSE,
  PARTS_OPEN,
  TERM_CLOSE,
  TERM_OPEN,
} from './syntax.ts';
import { bytes, CODE, readCode, readFigure, readTerm, TERM, type Read } from './targets.ts';
import type { CodeRange, CodeTarget, Overview } from './tree.ts';

/** The kinds of block. */
export const BLOCKS = ['code', 'figure', 'walkthrough', 'step', 'tabs', 'tab', 'fold'] as const;
export type BlockKind = (typeof BLOCKS)[number];

/** What a block that's kept is built from. */
export type BlockMeta =
  | { kind: 'code'; target: CodeRange }
  | { kind: 'figure'; path: string; reference: FigureReference }
  | { kind: 'walkthrough'; title: string }
  | { kind: 'step'; target: CodeRange }
  | { kind: 'tabs' }
  | { kind: 'tab'; title: string }
  | { kind: 'fold'; title: string };

/** Code the overview points at, and where. */
export interface CodeReference {
  target: CodeTarget;
  /** The line of `artifact.md` it's on, counting from 1. */
  line: number;
  /** What points there: a `:::code` block, a walkthrough's step or a link. */
  from: 'block' | 'step' | 'link';
}

/** A figure the overview shows, and where. */
export interface FigureReference {
  /** `figures/` and the file's name. */
  path: string;
  line: number;
  /**
   * The parts its list links, in the order written: each by an id it may have, linked once to
   * code, a term or a section. Only an SVG has parts.
   */
  parts: PartReference[];
}

/** A part of a figure, by its id, and the line of `artifact.md` its link is on. */
export interface PartReference {
  id: string;
  line: number;
}

/** A block whose fences are open while the tokens inside it are read. */
interface Opened {
  token: Token;
  /** Its kind as written, known or not. */
  written: string;
  kind: BlockKind | undefined;
  line: number;
  /** How many blocks it's in, itself included. */
  depth: number;
  /** Its steps, or its tabs. */
  members: number;
  /** Whether it's been found holding something it can't, which is reported once. */
  strayed: boolean;
  /** The index of its first token of text, or -1. */
  text: number;
  /** The index of the last token directly inside it, or -1. */
  last: number;
}

type Section = 'start' | 'tldr' | 'glossary' | 'other' | 'footnotes';

/**
 * The most characters of code and term targets the links in the tree may hold together: as many
 * as the limit on targets lets through, each at the longest a target may be. A link to the format's
 * own target is claimed before `@lo/markdown` charges it against its limit on addresses, so this is
 * that limit's stand-in, and one definition of a reference used over and over can't make the tree
 * far larger than the text.
 */
const CLAIMED = LIMITS.targets * LIMITS.argument;

export class Reading {
  readonly references: CodeReference[] = [];
  readonly figures: FigureReference[] = [];
  /** The blocks kept, by their opening token. */
  readonly blocks = new WeakMap<Token, BlockMeta>();
  /** The glossary's items kept, by their opening token. */
  readonly terms = new WeakMap<Token, { name: string; key: string }>();
  /** A figure's parts kept, by their item's opening token: the part's id. */
  readonly parts = new WeakMap<Token, string>();

  private readonly findings: Findings;
  private readonly definitions = new Map<string, { name: string; line: number }>();
  private readonly uses: { key: string; line: number }[] = [];
  /** How many targets the overview has, past the limit or not. */
  private targets = 0;
  /**
   * The lines of the first targets in the document, one past the limit's worth, in order: only
   * these are kept, however many there are, and the last is where the limit was passed.
   */
  private readonly firstTargets: number[] = [];
  /** Each code or term link's address, read once however many links name it. */
  private readonly linked = new Map<string, Read<Overview['target']>>();
  /** The characters of the code and term targets claimed for the tree so far. */
  private claimed = 0;
  /** How many links whose address Markdown can't read have been reported. */
  private unread = 0;

  private section: Section = 'start';
  private seen = { tldr: false, glossary: false, first: false };
  private tldr = { line: 0, text: false };
  private glossary = { line: 0, list: false, strayed: false };

  constructor(findings: Findings) {
    this.findings = findings;
  }

  /** Reads `tokens`, the whole document's, as markdown-it's last core rule. */
  read(tokens: Token[]): void {
    this.pair(tokens);
    const close = matchingCloses(tokens);
    this.walk(tokens, close);
    this.links(tokens);
    this.settle();
  }

  private add(code: FindingCode, line: number | undefined, message: string): void {
    this.findings.add(code, line, message);
  }

  /**
   * Pairs the fences: one with nothing after its colons closes the innermost block open in the
   * same container (a list item, a quote, the document), so a block never ends in a different
   * container from the one it started in. Paired fences become an open and a close; the rest
   * become lines of text.
   */
  private pair(tokens: Token[]): void {
    const frames: number[][] = [[]];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token.type === FENCE) {
        const frame = frames.at(-1)!;
        if (!closes(token.info)) {
          frame.push(i);
          continue;
        }
        const open = frame.pop();
        if (open === undefined) {
          token.type = LINE;
          this.add('block-unopened', lineOf(token), 'This ::: closes no block. Remove it.');
          continue;
        }
        tokens[open]!.type = OPEN;
        tokens[open]!.nesting = 1;
        token.type = CLOSE;
        token.nesting = -1;
      } else if (token.nesting === 1) {
        frames.push([]);
      } else if (token.nesting === -1 && frames.length > 1) {
        this.unclosed(tokens, frames.pop()!);
      }
    }
    for (const frame of frames) this.unclosed(tokens, frame);
  }

  private unclosed(tokens: Token[], frame: readonly number[]): void {
    for (const index of frame) {
      const token = tokens[index]!;
      token.type = LINE;
      const { kind } = opening(token.info);
      this.add('block-unclosed', lineOf(token), `This :::${quote(kind)} has no closing :::.`);
    }
  }

  /** Reads the blocks and sections, with a stack of what each token sits in. */
  private walk(tokens: Token[], close: Int32Array): void {
    // What each open token is: a block of the format's, or undefined for one of Markdown's. The
    // first is the document.
    const frames: (Opened | undefined)[] = [undefined];
    const open: Opened[] = [];
    let line: number | undefined;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token.map) line = token.map[0] + 1;
      if (token.nesting === -1) {
        const frame = frames.pop();
        if (frame) {
          open.pop();
          this.finish(tokens, close, frame);
        }
        continue;
      }
      const parent = frames.at(-1);
      const opened = token.type === OPEN ? this.open(token, parent, open.length + 1) : undefined;
      if (parent) this.child(parent, token, i, opened);
      else if (frames.length === 1) this.sectionChild(tokens, close, token, i, line);
      if (token.type === 'heading_open') this.heading(token, open.length > 0, line);
      if (
        token.type === 'inline' &&
        tokens[i - 1]?.type !== 'heading_open' &&
        token.content.trim() !== ''
      ) {
        const inner = open.at(-1);
        if (inner && inner.text < 0) inner.text = i;
        if (this.section === 'tldr') this.tldr.text = true;
      }
      if (token.nesting === 1) {
        frames.push(opened);
        if (opened) open.push(opened);
      }
    }
    this.endSection();
    if (!this.seen.tldr) this.notFirst(undefined);
  }

  /** A block opening at `token`, directly inside `parent`, `depth` blocks deep. */
  private open(token: Token, parent: Opened | undefined, depth: number): Opened {
    const line = lineOf(token) ?? 1;
    const { kind: written, argument } = opening(token.info);
    const kind = BLOCKS.find((known) => known === written);
    const opened: Opened = {
      token,
      written,
      kind,
      line,
      depth,
      members: 0,
      strayed: false,
      text: -1,
      last: -1,
    };
    if (depth === LIMITS.nesting + 1) {
      this.add('block-nesting', line, `Blocks nest at most ${LIMITS.nesting} deep.`);
    }
    if (!kind) {
      this.add('block-unknown', line, `:::${quote(written)} isn't a block Lo knows.`);
      return opened;
    }
    if (utf8Length(argument, LIMITS.argument + 1) > LIMITS.argument) {
      this.add('block-argument', line, `This :::${kind}'s argument is longer than ${bytes()}.`);
      return opened;
    }
    const meta = this.meta(kind, argument, parent, line);
    if (meta) this.blocks.set(token, meta);
    return opened;
  }

  /** What a block of `kind` is built from, when its argument and place allow it. */
  private meta(
    kind: BlockKind,
    argument: string,
    parent: Opened | undefined,
    line: number,
  ): BlockMeta | undefined {
    switch (kind) {
      case 'code':
      case 'step': {
        if (kind === 'step' && parent?.kind !== 'walkthrough') {
          this.add('block-misplaced', line, 'A :::step sits directly inside a :::walkthrough.');
          return undefined;
        }
        // A walkthrough left out, for its argument, leaves its steps out with it.
        if (kind === 'step' && !(parent && this.blocks.has(parent.token))) return undefined;
        if (argument === '') {
          this.add(
            'block-argument',
            line,
            `A :::${kind} names its lines, such as :::${kind} src/cache.ts#L12-L44.`,
          );
          return undefined;
        }
        const read = readCode(unbracket(argument), 'range');
        if (!read.ok) {
          this.add(read.code, line, read.message);
          return undefined;
        }
        if (this.target(line)) {
          this.references.push({
            target: read.value,
            line,
            from: kind === 'code' ? 'block' : 'step',
          });
        }
        return { kind, target: read.value };
      }
      case 'figure': {
        if (argument === '') {
          this.add(
            'block-argument',
            line,
            'A :::figure names its file, such as :::figure figures/flow.svg.',
          );
          return undefined;
        }
        const read = readFigure(unbracket(argument));
        if (!read.ok) {
          this.add(read.code, line, read.message);
          return undefined;
        }
        const reference: FigureReference = { path: read.value, line, parts: [] };
        this.figures.push(reference);
        if (this.figures.length === LIMITS.figures + 1) {
          this.add('figure-count', line, `An overview has at most ${LIMITS.figures} figures.`);
        }
        return { kind, path: read.value, reference };
      }
      case 'tabs':
        if (argument !== '') {
          this.add(
            'block-argument',
            line,
            'A :::tabs block has no title. Give each :::tab inside it one.',
          );
        }
        return { kind };
      case 'tab':
        if (parent?.kind !== 'tabs') {
          this.add('block-misplaced', line, 'A :::tab sits directly inside a :::tabs block.');
          return undefined;
        }
        if (!this.blocks.has(parent.token)) return undefined;
        return { kind, title: this.title(kind, argument, line) };
      case 'walkthrough':
      case 'fold':
        return { kind, title: this.title(kind, argument, line) };
      default:
        kind satisfies never;
        throw new Error(`Unknown block kind ${String(kind)}`);
    }
  }

  private title(kind: BlockKind, argument: string, line: number): string {
    if (argument === '') this.add('block-argument', line, `A :::${kind} needs a title.`);
    return argument;
  }

  /** `token`, at `index`, directly inside the block `parent`. */
  private child(parent: Opened, token: Token, index: number, opened: Opened | undefined): void {
    parent.last = index;
    const line = lineOf(token) ?? parent.line;
    switch (parent.kind) {
      case 'walkthrough':
        if (opened?.written === 'step') this.member(parent, line, 'steps', LIMITS.steps);
        else this.stray(parent, line, 'A :::walkthrough holds only :::step blocks.');
        return;
      case 'tabs':
        if (opened?.written === 'tab') this.member(parent, line, 'tabs', LIMITS.tabs);
        else this.stray(parent, line, 'A :::tabs block holds only :::tab blocks.');
        return;
      case 'code':
        this.stray(parent, line, 'A :::code block is empty. Lo fills it in from its lines.');
        return;
      case 'step':
        if (opened) this.stray(parent, line, 'A step holds only text, no blocks.');
        return;
      case 'figure':
        if (opened) this.stray(parent, line, 'A figure holds only its caption and its parts.');
        return;
      case 'tab':
      case 'fold':
      case undefined:
        return;
      default:
        parent.kind satisfies never;
        throw new Error(`Unknown block kind ${String(parent.kind)}`);
    }
  }

  private member(parent: Opened, line: number, what: 'steps' | 'tabs', most: number): void {
    parent.members += 1;
    if (parent.members !== most + 1) return;
    if (what === 'steps') {
      this.add('walkthrough-steps', line, `A walkthrough has at most ${most} steps.`);
    } else {
      this.add('tabs-tabs', line, `A :::tabs block has at most ${most} tabs.`);
    }
  }

  private stray(parent: Opened, line: number, message: string): void {
    if (parent.strayed) return;
    parent.strayed = true;
    this.add('block-content', line, message);
  }

  /** Checks what a block held, once its closing fence is reached. */
  private finish(tokens: Token[], close: Int32Array, opened: Opened): void {
    switch (opened.kind) {
      case 'walkthrough':
        if (opened.members < MIN_STEPS) {
          this.add(
            'walkthrough-steps',
            opened.line,
            `A walkthrough has at least ${MIN_STEPS} steps, and this one has ${opened.members}. With fewer, write prose.`,
          );
        }
        return;
      case 'tabs':
        if (opened.members < MIN_TABS) {
          this.add(
            'tabs-tabs',
            opened.line,
            `A :::tabs block holds at least ${MIN_TABS} tabs, and this one has ${opened.members}.`,
          );
        }
        return;
      case 'step':
        if (opened.text < 0) {
          this.add('step-text', opened.line, 'This step has no text. Say what its lines do.');
        }
        return;
      case 'figure': {
        const last = opened.last < 0 ? undefined : tokens[opened.last];
        const list = last !== undefined && isList(last) ? opened.last : -1;
        const meta = this.blocks.get(opened.token);
        if (list >= 0 && meta?.kind === 'figure') {
          if (meta.path.endsWith('.svg')) {
            meta.reference.parts = this.partList(tokens, close, list);
          } else {
            this.add(
              'figure-part',
              lineOf(tokens[list]!),
              `Only an SVG's parts can be linked, and ${quote(meta.path)} isn't one. Leave the list of parts out.`,
            );
          }
        }
        if (opened.text < 0 || (list >= 0 && opened.text >= list)) {
          this.add(
            'figure-caption',
            opened.line,
            'This figure has no caption. Say what it shows in a sentence or two.',
          );
        }
        return;
      }
      case 'code':
      case 'tab':
      case 'fold':
      case undefined:
        return;
      default:
        opened.kind satisfies never;
        throw new Error(`Unknown block kind ${String(opened.kind)}`);
    }
  }

  /**
   * A figure's last list, at `at`: each item one link to a part, `- [part-id](target)`. Returns the
   * parts kept.
   */
  private partList(tokens: Token[], close: Int32Array, at: number): PartReference[] {
    const ids = new Set<string>();
    const kept: PartReference[] = [];
    for (let j = at + 1; j < close[at]!; j = close[j]! + 1) {
      const item = tokens[j]!;
      if (item.type !== 'list_item_open') continue;
      const line = lineOf(item);
      const link = singleLink(tokens, close, j);
      if (!link) {
        this.add(
          'figure-part',
          line,
          "Each item of a figure's last list is one link to a part, such as - [cache](code:src/cache.ts).",
        );
        continue;
      }
      const { id, href } = link;
      if (!isPartId(id)) {
        this.add(
          'figure-part',
          line,
          `"${quote(id)}" isn't a part's id: a letter or _, then letters, digits, _, . or -, up to ${MAX_NAME} in all.`,
        );
        continue;
      }
      if (!href.startsWith(CODE) && !href.startsWith(TERM) && !href.startsWith('#')) {
        this.add(
          'figure-part',
          line,
          `The part "${id}" links to ${quote(href)}. A part links to code:, term: or a #section.`,
        );
        continue;
      }
      if (ids.has(id)) {
        this.add('figure-part', line, `The part "${id}" is linked twice.`);
        continue;
      }
      ids.add(id);
      kept.push({ id, line: line ?? lineOf(tokens[at]!) ?? 1 });
      this.parts.set(item, id);
      item.type = PART_OPEN;
      tokens[close[j]!]!.type = PART_CLOSE;
    }
    tokens[at]!.type = PARTS_OPEN;
    tokens[close[at]!]!.type = PARTS_CLOSE;
    return kept;
  }

  private heading(token: Token, inBlock: boolean, line: number | undefined): void {
    if (token.tag === 'h1') {
      this.add(
        'title-heading',
        line,
        "An overview has no # heading: the pull request's title is its title. Start each section with ##.",
      );
    } else if (token.tag === 'h2' && inBlock) {
      this.add(
        'section-in-block',
        line,
        '## starts a section, so it sits outside blocks. Use ### inside one.',
      );
    }
  }

  // Sections: what sits at the document's top level.

  private sectionChild(
    tokens: Token[],
    close: Int32Array,
    token: Token,
    index: number,
    line: number | undefined,
  ): void {
    if (this.section === 'footnotes') return;
    if (token.type === 'footnote_block_open') {
      // Footnotes are gathered at the end, outside every section.
      this.endSection();
      this.section = 'footnotes';
      return;
    }
    if (token.type === 'heading_open' && token.tag === 'h2') {
      this.endSection();
      this.beginSection(tokens[index + 1]?.content ?? '', line ?? 1);
      return;
    }
    switch (this.section) {
      case 'start':
        this.notFirst(line);
        return;
      case 'glossary':
        if (!this.glossary.list && isList(token)) {
          this.glossary.list = true;
          this.readGlossary(tokens, close, index);
        } else if (!this.glossary.strayed) {
          this.glossary.strayed = true;
          this.add(
            'glossary-content',
            line,
            'The glossary holds only one list, of **Term**: definition items.',
          );
        }
        return;
      case 'tldr':
      case 'other':
        return;
      default:
        this.section satisfies never;
        throw new Error(`Unknown section ${String(this.section)}`);
    }
  }

  private beginSection(title: string, line: number): void {
    const name = title.trim().toLowerCase();
    if (this.section === 'start' && name !== 'tl;dr') this.notFirst(line);
    if (name === 'tl;dr') {
      if (this.seen.tldr) {
        this.add('tldr-twice', line, 'An overview has one tl;dr.');
        this.section = 'other';
        return;
      }
      this.seen.tldr = true;
      this.section = 'tldr';
      this.tldr = { line, text: false };
      return;
    }
    if (name === 'glossary') {
      if (this.seen.glossary) {
        this.add('glossary-twice', line, 'An overview has one glossary.');
        this.section = 'other';
        return;
      }
      this.seen.glossary = true;
      this.section = 'glossary';
      this.glossary = { line, list: false, strayed: false };
      return;
    }
    this.section = 'other';
  }

  private endSection(): void {
    if (this.section === 'tldr' && !this.tldr.text) {
      this.add(
        'tldr-empty',
        this.tldr.line,
        'The tl;dr has no text. Say what the PR does and why.',
      );
    }
    if (this.section === 'glossary' && !this.glossary.list && !this.glossary.strayed) {
      this.add(
        'glossary-content',
        this.glossary.line,
        'The glossary has no items. List each term as **Term**: definition, or leave the section out.',
      );
    }
  }

  /** Reports, once, that the overview doesn't start with its tl;dr. */
  private notFirst(line: number | undefined): void {
    if (this.seen.first) return;
    this.seen.first = true;
    this.add('tldr-first', line, 'An overview starts with ## tl;dr: what the PR does and why.');
  }

  /** The glossary's list, at `at`: each item `**Term**: definition`. */
  private readGlossary(tokens: Token[], close: Int32Array, at: number): void {
    for (let j = at + 1; j < close[at]!; j = close[j]! + 1) {
      const item = tokens[j]!;
      if (item.type !== 'list_item_open') continue;
      const line = lineOf(item);
      const found = definition(tokens, close, j);
      if (!found.ok) {
        this.add('glossary-item', line, found.message);
        continue;
      }
      const term = readTerm(found.name);
      if (!term.ok) {
        this.add('glossary-item', line, term.message);
        continue;
      }
      const { key } = term.value;
      const earlier = this.definitions.get(key);
      if (earlier) {
        this.add(
          'term-twice',
          line,
          `"${quote(found.name)}" is defined twice, here and on line ${earlier.line}. Define each term once.`,
        );
        continue;
      }
      this.definitions.set(key, { name: found.name, line: line ?? 1 });
      found.take();
      this.terms.set(item, { name: found.name, key });
      item.type = TERM_OPEN;
      tokens[close[j]!]!.type = TERM_CLOSE;
    }
    tokens[at]!.type = GLOSSARY_OPEN;
    tokens[close[at]!]!.type = GLOSSARY_CLOSE;
  }

  // Links.

  /**
   * Reports each link to code, a term or a section whose address Markdown can't read, such as
   * `[a](term:b c)`, which shows as its text. It looks at `tokens` before their text is joined, as
   * the core rule that joins it comes next, so that an escaped bracket is still an escape.
   */
  unreadLinks(tokens: Token[]): void {
    let line = 1;
    for (const token of tokens) {
      if (token.map) line = token.map[0] + 1;
      // Only an inline's own text holds the `](` that starts such a link.
      if (token.type === 'inline' && token.children && token.content.includes('](')) {
        this.unreadIn(token.children, line);
      }
      if (this.unread >= LIMITS.findings) return;
    }
  }

  /** The unread links in `children`, an inline token's, which starts on line `first`. */
  private unreadIn(children: readonly Token[], first: number): void {
    // The tokens' text as one, with a marker for each that isn't text, so a link whose label or
    // address has emphasis or code inside is still one.
    let text = '';
    const lines = new Map<number, number>();
    for (const child of children) {
      switch (child.type) {
        case 'text':
          text += child.content;
          break;
        case 'text_special':
          // A backslash before no punctuation is only a backslash; any other is an escape or an
          // entity, which no bracket or parenthesis written so counts.
          text += child.markup === child.content ? child.content : OTHER;
          break;
        case 'link_open':
        case 'link_close':
          // An address in the text that linkify made a link of, which `lo_text` makes text again.
          if (child.markup !== 'linkify') text += OTHER;
          break;
        case 'softbreak':
        case 'hardbreak':
          text += '\n';
          break;
        case 'html_inline':
          lines.set(text.length, count(child.content));
          text += OTHER;
          break;
        case 'image':
          lines.set(text.length, breaks(child.children));
          text += OTHER;
          break;
        default:
          text += OTHER;
          break;
      }
    }
    const open: { at: number; line: number; image: boolean }[] = [];
    let line = first;
    for (let at = 0; at < text.length; at++) {
      const char = text[at];
      if (char === '\n') {
        line += 1;
      } else if (char === OTHER) {
        line += lines.get(at) ?? 0;
      } else if (char === '[') {
        open.push({ at, line, image: text[at - 1] === '!' });
      } else if (char === ']') {
        const from = open.pop();
        // An image isn't a link, whatever it points at.
        if (!from || from.image || text[at + 1] !== '(') continue;
        const message = unreadLink(text, from.at, at);
        if (message === undefined) continue;
        this.add('link-address', from.line, message);
        this.unread += 1;
        // The findings keep no more, so there's no use looking for more.
        if (this.unread >= LIMITS.findings) return;
      }
    }
  }

  /** Reads each link's target, and takes out links to the format's targets that are invalid. */
  private links(tokens: Token[]): void {
    let line = 1;
    for (const token of tokens) {
      if (token.map) line = token.map[0] + 1;
      if (token.type === 'inline' && token.children) {
        token.children = this.inlineLinks(token.children, line);
      }
    }
  }

  /** `children`, an inline token's, starting on `first`, without the links refused. */
  private inlineLinks(children: Token[], first: number): Token[] {
    let line = first;
    let level = 0;
    let dropping = -1;
    const dropped = new Set<number>();
    for (const [index, child] of children.entries()) {
      switch (child.type) {
        case 'softbreak':
        case 'hardbreak':
          line += 1;
          break;
        case 'html_inline':
          line += count(child.content);
          break;
        case 'image':
          line += breaks(child.children);
          break;
        case 'link_open': {
          level += 1;
          const href = child.attrGet('href');
          if (dropping < 0 && typeof href === 'string' && !this.linkTarget(href, line)) {
            dropped.add(index);
            dropping = level;
          }
          break;
        }
        case 'link_close':
          if (level === dropping) {
            dropped.add(index);
            dropping = -1;
          }
          level -= 1;
          break;
        default:
          break;
      }
    }
    return dropped.size === 0 ? children : children.filter((_, index) => !dropped.has(index));
  }

  /**
   * Reads a link to `href` on `line`: false when it names a target of the format's wrongly, or
   * past the limit on targets, so it shows as its text.
   */
  private linkTarget(href: string, line: number): boolean {
    const read = this.readLink(href);
    if (read === undefined) {
      if (href.startsWith('#')) this.target(line);
      return true;
    }
    if (!read.ok) {
      this.add(read.code, line, read.message);
      return false;
    }
    // Past the limit, the overview is invalid, and what's past it isn't kept.
    if (!this.target(line)) return false;
    if (read.value.kind === 'code') {
      this.references.push({ target: read.value, line, from: 'link' });
    } else {
      this.uses.push({ key: read.value.key, line });
    }
    return true;
  }

  /** A link's address read as code or a term, once for each address; undefined for any other. */
  private readLink(href: string): Read<Overview['target']> | undefined {
    const known = this.linked.get(href);
    if (known) return known;
    let read: Read<Overview['target']>;
    if (href.startsWith(CODE)) read = readCode(href.slice(CODE.length), 'any');
    else if (href.startsWith(TERM)) read = readTerm(href.slice(TERM.length));
    else return undefined;
    this.linked.set(href, read);
    return read;
  }

  /**
   * The target a link to `href` goes to in the tree, when it's to code or a term: only one this
   * reading kept, and only while the tree's targets stay within {@link CLAIMED}.
   */
  claim(href: string): Overview['target'] | undefined {
    const read = this.linked.get(href);
    if (!read?.ok) return undefined;
    const size = read.value.kind === 'code' ? read.value.path.length : read.value.key.length;
    if (this.claimed + size > CLAIMED) return undefined;
    this.claimed += size;
    return read.value;
  }

  /**
   * Counts a target on `line`: whether it's within the limit. Only the first lines in the document
   * are kept, one past the limit's worth.
   */
  private target(line: number): boolean {
    this.targets += 1;
    const lines = this.firstTargets;
    if (lines.length <= LIMITS.targets || line < lines.at(-1)!) {
      // Blocks are read before links, so a line can come before those already kept.
      let at = lines.length;
      while (at > 0 && lines[at - 1]! > line) at -= 1;
      lines.splice(at, 0, line);
      if (lines.length > LIMITS.targets + 1) lines.pop();
    }
    return this.targets <= LIMITS.targets;
  }

  /** What needs the whole document read: the limit on targets, and the terms. */
  private settle(): void {
    if (this.targets > LIMITS.targets) {
      const line = this.firstTargets[LIMITS.targets];
      this.add(
        'target-count',
        line,
        `An overview points at most ${LIMITS.targets} times at code, terms and sections. Point at fewer.`,
      );
    }
    const used = new Set<string>();
    for (const { key, line } of this.uses) {
      used.add(key);
      if (!this.definitions.has(key)) {
        this.add(
          'term-undefined',
          line,
          `The glossary doesn't define "${quote(key)}". Define it there, or don't link it as a term.`,
        );
      }
    }
    for (const [key, { name, line }] of this.definitions) {
      if (!used.has(key)) {
        this.add(
          'term-unused',
          line,
          `Nothing links to "${quote(name)}". Link its uses with term:, or leave it out.`,
        );
      }
    }
  }
}

/** A block's argument as a target: inside `<` and `>` when it's written so, for a path with spaces. */
function unbracket(argument: string): string {
  return argument.length >= 2 && argument.startsWith('<') && argument.endsWith('>')
    ? argument.slice(1, -1)
    : argument;
}

function lineOf(token: Token): number | undefined {
  return token.map ? token.map[0] + 1 : undefined;
}

function isList(token: Token): boolean {
  return token.type === 'bullet_list_open' || token.type === 'ordered_list_open';
}

/** Whether `id` can be an element's id in a figure, as `sanitizeSvg` keeps one. */
function isPartId(id: string): boolean {
  return id.length <= MAX_NAME && /^[A-Za-z_][\w.-]*$/.test(id);
}

/**
 * The link the list item at `j` is, when it's one paragraph holding one link to plain text: its
 * text and address.
 */
function singleLink(
  tokens: readonly Token[],
  close: Int32Array,
  j: number,
): { id: string; href: string } | undefined {
  if (close[j] !== j + 4) return undefined;
  if (tokens[j + 1]?.type !== 'paragraph_open' || tokens[j + 3]?.type !== 'paragraph_close') {
    return undefined;
  }
  const children = (tokens[j + 2]?.children ?? []).filter(isWritten);
  const first = children[0];
  if (first?.type !== 'link_open' || children.at(-1)?.type !== 'link_close') return undefined;
  let id = '';
  for (const child of children.slice(1, -1)) {
    if (child.type !== 'text') return undefined;
    id += child.content;
  }
  const href = first.attrGet('href');
  return typeof href === 'string' ? { id, href } : undefined;
}

/**
 * The glossary item at `j`, when it starts `**Term**:` with a definition after it: the term, and
 * a way to take the term and its colon out of the definition, once it's kept.
 */
function definition(
  tokens: readonly Token[],
  close: Int32Array,
  j: number,
): { ok: true; name: string; take: () => void } | { ok: false; message: string } {
  const shape = {
    ok: false,
    message: 'Write each glossary item as **Term**: definition.',
  } as const;
  const inline = tokens[j + 2];
  if (tokens[j + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline' || !inline.children) {
    return shape;
  }
  const children = inline.children.filter(isWritten);
  if (children[0]?.type !== 'strong_open') return shape;
  let depth = 0;
  let end = -1;
  for (const [index, child] of children.entries()) {
    if (child.type === 'strong_open') depth += 1;
    if (child.type === 'strong_close' && --depth === 0) {
      end = index;
      break;
    }
  }
  if (end < 0) return shape;
  let name = '';
  for (const child of children.slice(1, end)) {
    if (child.type !== 'text' && child.type !== 'code_inline') {
      return { ok: false, message: 'A term is plain text, with no links or formatting inside.' };
    }
    name += child.content;
  }
  const after = children[end + 1];
  if (after?.type !== 'text' || !after.content.startsWith(':')) return shape;
  const rest = after.content.slice(1).trimStart();
  let next = end + 2;
  while (children[next]?.type === 'softbreak' || children[next]?.type === 'hardbreak') next += 1;
  if (rest === '' && next >= children.length && close[j] === j + 4) {
    return { ok: false, message: `"${quote(name)}" has no definition.` };
  }
  return {
    ok: true,
    name,
    take: () => {
      after.content = rest;
      inline.children = rest === '' ? children.slice(next) : [after, ...children.slice(end + 2)];
    },
  };
}

/** Whether `token` isn't empty text, which markdown-it leaves where emphasis was looked for. */
function isWritten(token: Token): boolean {
  return token.type !== 'text' || token.content !== '';
}

/** How many newlines `text` holds. */
function count(text: string): number {
  let lines = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) lines += 1;
  return lines;
}

/** How many line breaks `children` hold, an image's alt text's. */
function breaks(children: readonly Token[] | null): number {
  let lines = 0;
  for (const child of children ?? []) {
    if (child.type === 'softbreak' || child.type === 'hardbreak') lines += 1;
  }
  return lines;
}

/** For each token that opens, the index of the token that closes it; -1 for every other. */
export function matchingCloses(tokens: readonly Token[]): Int32Array {
  const close = new Int32Array(tokens.length).fill(-1);
  const open: number[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token.nesting === 1) open.push(index);
    else if (token.nesting === -1) {
      const from = open.pop();
      if (from !== undefined) close[from] = index;
    }
  }
  for (const from of open) close[from] = tokens.length;
  return close;
}
