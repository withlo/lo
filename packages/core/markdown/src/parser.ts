/**
 * The Markdown parser: markdown-it, set up to read GitHub's Markdown. It was chosen for its time:
 * every pathological pattern of CommonMark's own suite and of GitHub's extensions parses in time
 * in proportion to the text, which a parser fed by anyone must, and it nests no deeper than it's
 * told.
 */

import MarkdownIt, {
  type Env,
  type MarkdownIt as Parser,
  type StateCore,
  type StateInline,
  type Token,
} from 'markdown-it';
import footnote from 'markdown-it-footnote';

import { findReferences, type Repo } from './references.ts';

/** A markdown-it plugin, which adds syntax. */
export type Plugin = (md: Parser) => void;

/** The key under which a parse's environment holds what Lo gives it beyond its text. */
const LO = 'lo';

/**
 * markdown-it's environment for one parse of text in `repo`. Footnote labels are looked up
 * whatever their case, as GitHub matches `[^A]` to `[^a]:`.
 */
export function environment(repo: Repo | undefined): Env {
  const labels: Record<string, unknown> = Object.create(null);
  const refs = new Proxy(labels, {
    get: (target, key) => (typeof key === 'string' ? target[key.toLowerCase()] : undefined),
    set: (target, key, value) => {
      if (typeof key === 'string') target[key.toLowerCase()] = value;
      return true;
    },
  });
  return { [LO]: { repo }, footnotes: { refs } };
}

function repoOf(env: Env): Repo | undefined {
  const lo = env[LO];
  if (typeof lo !== 'object' || lo === null || !('repo' in lo)) return undefined;
  const repo = lo.repo;
  return typeof repo === 'object' &&
    repo !== null &&
    'owner' in repo &&
    'name' in repo &&
    typeof repo.owner === 'string' &&
    typeof repo.name === 'string'
    ? { owner: repo.owner, name: repo.name }
    : undefined;
}

const parsers = new Map<number, Parser>();
const extended = new WeakMap<readonly Plugin[], Map<number, Parser>>();

/**
 * The parser for text nesting no deeper than `nesting` levels, with `plugins`' syntax added. Each
 * is made once and kept: a parser holds only its settings, and every parse keeps its own state in
 * its environment.
 */
export function parser(nesting: number, plugins: readonly Plugin[] | undefined): Parser {
  let cache = parsers;
  if (plugins && plugins.length > 0) {
    cache = extended.get(plugins) ?? new Map();
    extended.set(plugins, cache);
  }
  let found = cache.get(nesting);
  if (!found) {
    found = create(nesting, plugins ?? []);
    cache.set(nesting, found);
  }
  return found;
}

function create(nesting: number, plugins: readonly Plugin[]): Parser {
  const md = new MarkdownIt('default', {
    // HTML is read as HTML only so it can be told apart: Lo shows it as its text.
    html: true,
    linkify: true,
    typographer: false,
    // Past this, markdown-it reads no deeper. Lo's own limit is lower, and it shows what lies
    // below that limit as the text's own lines, so nothing markdown-it skips is lost.
    maxNesting: nesting,
  });
  md.use(footnote);
  // GitHub has no inline footnotes, `^[like this]`.
  md.inline.ruler.disable('footnote_inline');
  md.core.ruler.at('footnote_tail', footnoteTail);
  // GitHub strikes through text between one tilde or two.
  md.inline.ruler.at('strikethrough', tildes);
  md.inline.ruler2.at('strikethrough', strikes);
  // GitHub's autolinks: addresses with `http://` or `https://`, and `www.` ones (`lo_text` drops
  // the bare domains linkify-it also finds). Email addresses would become `mailto:` links, which
  // Lo shows as text anyway.
  md.linkify.set({ fuzzyLink: true, fuzzyEmail: false, fuzzyIP: false });
  // Every link is kept as written, for Lo's own rules to decide.
  md.validateLink = () => true;
  md.normalizeLink = (url) => url;
  md.core.ruler.push('lo_text', loText);
  for (const plugin of plugins) md.use(plugin);
  return md;
}

/**
 * Moves footnotes' definitions to a block at the end, in the order they're first referenced,
 * each found whatever its case, as the environment looks them up, and labelled as its definition
 * writes it, as GitHub names it. Adapted from the footnote
 * plugin's own rule (MIT), which copies every token so far for each footnote, taking time in
 * proportion to the square of the footnotes; this takes each token once. A label's first
 * definition counts, and a footnote's backlinks are left to the renderer.
 */
function footnoteTail(state: StateCore): boolean {
  const kept: Token[] = [];
  const definitions = new Map<string, { label: string; tokens: Token[] }>();
  const open: { label: string; tokens: Token[] }[] = [];
  for (const token of state.tokens) {
    if (token.type === 'footnote_reference_open') {
      const label: unknown = token.meta?.['label'];
      open.push({ label: typeof label === 'string' ? label : '', tokens: [] });
      continue;
    }
    if (token.type === 'footnote_reference_close') {
      const done = open.pop();
      const key = done?.label.toLowerCase();
      if (done && key !== undefined && !definitions.has(key)) definitions.set(key, done);
      continue;
    }
    (open.at(-1)?.tokens ?? kept).push(token);
  }
  state.tokens = kept;
  const footnotes: unknown = state.env['footnotes'];
  const list: unknown =
    typeof footnotes === 'object' && footnotes !== null && 'list' in footnotes
      ? footnotes.list
      : undefined;
  if (!Array.isArray(list) || list.length === 0) return true;
  state.tokens.push(new state.Token('footnote_block_open', '', 1));
  for (const [id, item] of list.entries()) {
    const raw: unknown =
      typeof item === 'object' && item !== null && 'label' in item ? item.label : '';
    const definition = definitions.get(typeof raw === 'string' ? raw.toLowerCase() : '');
    const opening = new state.Token('footnote_open', '', 1);
    opening.meta = { id, label: definition?.label ?? raw };
    state.tokens.push(opening);
    for (const token of definition?.tokens ?? []) state.tokens.push(token);
    state.tokens.push(new state.Token('footnote_close', '', -1));
  }
  state.tokens.push(new state.Token('footnote_block_close', '', -1));
  return true;
}

/**
 * Runs of tildes, as GitHub reads them: a run of one or two that can open or close a
 * strikethrough, by the rules for emphasis, is marked for `strikes`; three or more are text.
 * Adapted from markdown-it's own strikethrough rule (MIT), which takes runs of two only.
 */
function tildes(state: StateInline, silent: boolean): boolean {
  if (silent || state.src.charCodeAt(state.pos) !== 0x7e) return false;
  const scanned = state.scanDelims(state.pos, true);
  const token = state.push('text', '', 0);
  token.content = '~'.repeat(scanned.length);
  if (scanned.length <= 2) {
    token.meta = {
      tilde: { length: scanned.length, open: scanned.can_open, close: scanned.can_close },
    };
  }
  state.pos += scanned.length;
  return true;
}

/**
 * Pairs runs of tildes as GitHub does: a closing run takes the nearest opening run before it, in
 * the same link, and strikes through only if the two are the same length. With a stack, so in
 * time in proportion to the runs.
 */
function strikes(state: StateInline): boolean {
  const levels: Token[][] = [[]];
  for (const token of state.tokens) {
    if (token.type === 'link_open') {
      levels.push([]);
      continue;
    }
    if (token.type === 'link_close') {
      if (levels.length > 1) levels.pop();
      continue;
    }
    const run = tildeRun(token);
    if (!run) continue;
    const openers = levels.at(-1)!;
    const opener = openers.at(-1);
    const openerRun = opener && tildeRun(opener);
    if (run.close && opener && openerRun?.length === run.length) {
      openers.pop();
      strike(opener, 's_open', 1);
      strike(token, 's_close', -1);
      continue;
    }
    if (run.open) openers.push(token);
  }
  return true;
}

function tildeRun(token: Token): { length: number; open: boolean; close: boolean } | undefined {
  const run: unknown = token.meta?.['tilde'];
  if (typeof run !== 'object' || run === null) return undefined;
  if (!('length' in run) || !('open' in run) || !('close' in run)) return undefined;
  const { length, open, close } = run;
  return typeof length === 'number' && typeof open === 'boolean' && typeof close === 'boolean'
    ? { length, open, close }
    : undefined;
}

function strike(token: Token, type: 's_open' | 's_close', nesting: 1 | -1): void {
  token.type = type;
  token.tag = 's';
  token.nesting = nesting;
  token.content = '';
  token.meta = null;
}

/**
 * Reads plain text as GitHub does: drops autolinks GitHub wouldn't make, and finds mentions and
 * references in text outside links and code.
 */
function loText(state: StateCore): void {
  const repo = repoOf(state.env);
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    block.children = rewrite(block.children, repo, state);
  }
}

function rewrite(children: readonly Token[], repo: Repo | undefined, state: StateCore): Token[] {
  const out: Token[] = [];
  let links = 0;
  for (let i = 0; i < children.length; i++) {
    const token = children[i];
    if (!token) continue;
    if (token.type === 'link_open' && token.markup === 'linkify') {
      const text = children[i + 1];
      const close = children[i + 2];
      if (
        text?.type === 'text' &&
        close?.type === 'link_close' &&
        !/^(?:https?:\/\/|www\.)/i.test(text.content)
      ) {
        pushText(out, text.content, text.level, state);
        i += 2;
        continue;
      }
    }
    if (token.type === 'link_open') links += 1;
    if (token.type === 'link_close') links = Math.max(0, links - 1);
    if (token.type === 'text' && links === 0) {
      pushText(out, token.content, token.level, state);
      continue;
    }
    out.push(token);
  }
  return out.flatMap((token) =>
    token.type === 'text' && token.meta?.['lo'] === 'plain'
      ? withReferences(token, repo, state)
      : [token],
  );
}

/** Adds `content` to `out`, joined to a plain text token just before it. */
function pushText(out: Token[], content: string, level: number, state: StateCore): void {
  const last = out.at(-1);
  if (last?.type === 'text' && last.meta?.['lo'] === 'plain') {
    last.content += content;
    return;
  }
  const token = new state.Token('text', '', 0);
  token.content = content;
  token.level = level;
  token.meta = { lo: 'plain' };
  out.push(token);
}

/** `token`, plain text, split around the mentions and references in it. */
function withReferences(token: Token, repo: Repo | undefined, state: StateCore): Token[] {
  const text = token.content;
  const found = findReferences(text, repo);
  if (found.length === 0) return [token];
  const out: Token[] = [];
  const plain = (content: string, level: number): void => {
    if (content === '') return;
    const piece = new state.Token('text', '', 0);
    piece.content = content;
    piece.level = level;
    out.push(piece);
  };
  let at = 0;
  for (const match of found) {
    plain(text.slice(at, match.start), token.level);
    const written = text.slice(match.start, match.end);
    if (match.kind === 'mention') {
      const mention = new state.Token('lo_mention', '', 0);
      mention.content = written;
      mention.level = token.level;
      mention.meta = { name: match.name, url: match.url };
      out.push(mention);
    } else {
      const open = new state.Token('link_open', 'a', 1);
      open.attrs = [['href', match.url]];
      open.markup = 'reference';
      open.level = token.level;
      out.push(open);
      plain(written, token.level + 1);
      const close = new state.Token('link_close', 'a', -1);
      close.markup = 'reference';
      close.level = token.level;
      out.push(close);
    }
    at = match.end;
  }
  plain(text.slice(at), token.level);
  return out;
}
