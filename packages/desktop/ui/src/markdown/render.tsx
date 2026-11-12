/**
 * Draws `@lo/markdown`'s tree: a closed switch over each node's `kind`, which makes only Lo's own
 * elements and sets every attribute itself. Nothing in the tree is markup, an attribute, a class or
 * a style, so whatever the text said, the page holds only what this file writes. Text is set only
 * as text, never as HTML, and nothing loads from anywhere.
 *
 * Links have no address on the page. Following one hands its target to the document, which opens
 * an `https://` page through main, moves to an anchor in itself, or gives an extension's target
 * (an overview's code or term) to whoever shows it. An anchor's name never becomes an id: the
 * document's `Anchors` give each one an id of Lo's own.
 */

import {
  createContext,
  Fragment,
  useContext,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

import type {
  Alert,
  Block,
  Break,
  Code,
  Details,
  Emphasis,
  Extension,
  FootnoteReference,
  Footnotes,
  Heading,
  Image,
  Inline,
  InlineCode,
  Kbd,
  Link,
  List,
  Mention,
  Note,
  Paragraph,
  Plain,
  Quote,
  Rule,
  Strike,
  Strong,
  Sub,
  Suggestion,
  Sup,
  Table,
  Target,
  Text,
} from '@lo/markdown';

import { secureLink } from './links.ts';
import type { Anchors } from './scope.ts';

/** Where a reader followed a link: an `https://` page, a name in the document, or the extension's. */
export type Followed<X extends Extension = Plain> =
  { kind: 'web'; url: string } | { kind: 'anchor'; name: string } | X['target'];

/**
 * What an extension of the tree, such as the overview format, draws itself. Each is a closed switch
 * of its own over the extension's kinds.
 */
export interface MarkdownExtension<X extends Extension> {
  /** One of the extension's blocks. */
  block?(node: X['block']): ReactNode;
  /** One of the extension's inline nodes. */
  inline?(node: X['inline']): ReactNode;
  /** A link to one of the extension's targets, around what the link shows. */
  link?(target: X['target'], children: ReactNode): ReactNode;
  /** A `details` block, in place of the plain fold. */
  details?(node: Details<X>): ReactNode;
  /** A fenced block of code, in place of the plain one. */
  code?(node: Code): ReactNode;
}

/** How a document draws: its anchors, where its links go, and its extension. */
export interface Rendering<X extends Extension = Plain> {
  readonly anchors: Anchors;
  /** A link was followed, from `from`. Web targets are only ever `https://` pages. */
  follow(target: Followed<X>, from: Element): void;
  readonly extension: MarkdownExtension<X>;
  /**
   * Whether links can be followed. A copy of text from elsewhere in the document, such as a
   * term's definition in its hover card, shows them as their text.
   */
  readonly interactive: boolean;
}

const RenderingContext = createContext<Rendering<Extension> | undefined>(undefined);

/** Gives `children` the document's rendering. */
export function MarkdownProvider<X extends Extension>({
  rendering,
  children,
}: {
  rendering: Rendering<X>;
  children: ReactNode;
}) {
  return <RenderingContext value={rendering}>{children}</RenderingContext>;
}

/** The document's rendering, from the nearest `MarkdownProvider`. */
export function useRendering<X extends Extension = Plain>(): Rendering<X> {
  const rendering = useContext(RenderingContext);
  if (!rendering) throw new Error('Markdown is drawn only inside a MarkdownProvider.');
  return rendering;
}

/** `blocks`, in order. */
export function MarkdownBlocks<X extends Extension = Plain>({
  blocks,
}: {
  blocks: readonly Block<X>[];
}) {
  const r = useRendering<X>();
  return drawBlocks(blocks, r);
}

/** One block. */
export function MarkdownBlock<X extends Extension = Plain>({ node }: { node: Block<X> }) {
  const r = useRendering<X>();
  return drawBlock(node, r);
}

/** Inline nodes, in order. */
export function MarkdownInlines<X extends Extension = Plain>({
  nodes,
}: {
  nodes: readonly Inline<X>[];
}) {
  const r = useRendering<X>();
  return drawInlines(nodes, r);
}

/** What the reader should know about how the text is shown, one line each. */
export function MarkdownNotes({ notes }: { notes: readonly Note[] }) {
  if (notes.length === 0) return null;
  return notes.map((note) => (
    <p key={note} role="note" className="text-fg-muted text-small">
      {noteText(note)}
    </p>
  ));
}

function noteText(note: Note): string {
  switch (note) {
    case 'cut':
      return 'This is too long to show whole, so only its start is here.';
    case 'deep':
      return 'Some of this nests too deeply to show, so it shows as plain text.';
    case 'nodes':
      return 'This holds too much to show whole, so the rest shows as plain text.';
    default:
      note satisfies never;
      throw new Error(`A note Lo doesn't know: ${JSON.stringify(note)}.`);
  }
}

/** The blocks `@lo/markdown` makes itself, whatever the extension. */
type PlainBlock<X extends Extension> =
  | Paragraph<X>
  | Heading<X>
  | Quote<X>
  | Alert<X>
  | List<X>
  | Code
  | Table<X>
  | Rule
  | Details<X>
  | Suggestion
  | Footnotes<X>;

/** The inline nodes `@lo/markdown` makes itself. */
type PlainInline<X extends Extension> =
  | Text
  | Strong<X>
  | Emphasis<X>
  | Strike<X>
  | InlineCode
  | Link<X>
  | Image
  | Break
  | Sub<X>
  | Sup<X>
  | Kbd<X>
  | Mention
  | FootnoteReference;

/** The targets `@lo/markdown` makes itself. */
type PlainTarget = { kind: 'web'; url: string } | { kind: 'anchor'; name: string };

/** Every kind of plain block, so a kind `@lo/markdown` adds fails to compile until it's drawn. */
const PLAIN_BLOCKS: ReadonlySet<string> = new Set(
  Object.keys({
    paragraph: true,
    heading: true,
    quote: true,
    alert: true,
    list: true,
    code: true,
    table: true,
    rule: true,
    details: true,
    suggestion: true,
    footnotes: true,
  } satisfies Record<Block['kind'], true>),
);

const PLAIN_INLINES: ReadonlySet<string> = new Set(
  Object.keys({
    text: true,
    strong: true,
    emphasis: true,
    strike: true,
    inlineCode: true,
    link: true,
    image: true,
    break: true,
    sub: true,
    sup: true,
    kbd: true,
    mention: true,
    footnoteReference: true,
  } satisfies Record<Inline['kind'], true>),
);

function isPlainBlock<X extends Extension>(node: Block<X>): node is PlainBlock<X> {
  return PLAIN_BLOCKS.has(node.kind);
}

function isPlainInline<X extends Extension>(node: Inline<X>): node is PlainInline<X> {
  return PLAIN_INLINES.has(node.kind);
}

function isParagraph<X extends Extension>(node: Block<X>): node is Paragraph<X> {
  return node.kind === 'paragraph';
}

/** Whether `target` is a page or an anchor, read from its own fields. */
function isPlainTarget<X extends Extension>(target: Target<X>): target is PlainTarget {
  if (target.kind === 'web') return 'url' in target && typeof target.url === 'string';
  if (target.kind === 'anchor') return 'name' in target && typeof target.name === 'string';
  return false;
}

export function drawBlocks<X extends Extension>(
  blocks: readonly Block<X>[],
  r: Rendering<X>,
): ReactNode {
  return blocks.map((node, index) => <Fragment key={index}>{drawBlock(node, r)}</Fragment>);
}

export function drawBlock<X extends Extension>(node: Block<X>, r: Rendering<X>): ReactNode {
  if (!isPlainBlock(node)) {
    if (!r.extension.block) {
      throw new Error(`A kind of block Lo doesn't draw here: ${JSON.stringify(node.kind)}.`);
    }
    return r.extension.block(node);
  }
  const plain = node;
  switch (plain.kind) {
    case 'paragraph':
      return <p>{drawInlines(plain.children, r)}</p>;
    case 'heading':
      return heading(plain, r);
    case 'quote':
      return (
        <blockquote className="space-y-8 border-s-2 border-border-strong ps-12 text-fg-muted">
          {drawBlocks(plain.children, r)}
        </blockquote>
      );
    case 'alert':
      return alert(plain, r);
    case 'list':
      return list(plain, r);
    case 'code':
      return r.extension.code ? r.extension.code(plain) : <Fence text={plain.text} />;
    case 'table':
      return table(plain, r);
    case 'rule':
      return <hr className="h-px max-w-read-measure border-0 bg-border" />;
    case 'details':
      return r.extension.details ? r.extension.details(plain) : <Fold node={plain} />;
    case 'suggestion':
      return (
        <div className="max-w-read-measure overflow-hidden rounded-md border border-border">
          <p className="bg-bg-chrome px-12 py-6 text-fg-muted text-small">Suggested change</p>
          <Fence text={plain.text} bare />
        </div>
      );
    case 'footnotes':
      return footnotes(plain, r);
    default:
      plain satisfies never;
      throw new Error(`A kind of block Lo doesn't know: ${JSON.stringify(node.kind)}.`);
  }
}

function heading<X extends Extension>(node: Heading<X>, r: Rendering<X>): ReactNode {
  // Headings take focus when a link moves to them, so the keyboard reads on from there.
  const props = { id: r.anchors.id(node.anchor), tabIndex: -1 };
  const content = drawInlines(node.children, r);
  switch (node.level) {
    case 1:
      return <h1 {...props}>{content}</h1>;
    case 2:
      return <h2 {...props}>{content}</h2>;
    case 3:
      return <h3 {...props}>{content}</h3>;
    case 4:
      return <h4 {...props}>{content}</h4>;
    case 5:
      return <h5 {...props}>{content}</h5>;
    case 6:
      return <h6 {...props}>{content}</h6>;
    default:
      node.level satisfies never;
      throw new Error(`A heading level Lo doesn't know: ${JSON.stringify(node.level)}.`);
  }
}

/** Each alert's word, and the status it's drawn in: the color never shows without the word. */
function alertTone(kind: Alert['type']): { label: string; box: string; word: string } {
  switch (kind) {
    case 'note':
      return { label: 'Note', box: 'border-info-border bg-info-bg', word: 'text-info' };
    case 'tip':
      return { label: 'Tip', box: 'border-success-border bg-success-bg', word: 'text-success' };
    case 'important':
      return { label: 'Important', box: 'border-info-border bg-info-bg', word: 'text-info' };
    case 'warning':
      return { label: 'Warning', box: 'border-warning-border bg-warning-bg', word: 'text-warning' };
    case 'caution':
      return { label: 'Caution', box: 'border-danger-border bg-danger-bg', word: 'text-danger' };
    default:
      kind satisfies never;
      throw new Error(`A kind of alert Lo doesn't know: ${JSON.stringify(kind)}.`);
  }
}

function alert<X extends Extension>(node: Alert<X>, r: Rendering<X>): ReactNode {
  const tone = alertTone(node.type);
  return (
    <div
      role="note"
      className={`max-w-read-measure space-y-6 rounded-md border px-12 py-8 ${tone.box}`}
    >
      <p className={`font-semibold ${tone.word}`}>{tone.label}</p>
      {drawBlocks(node.children, r)}
    </div>
  );
}

function list<X extends Extension>(node: List<X>, r: Rendering<X>): ReactNode {
  const items = node.items.map((item, index) => {
    const classes = [item.checked === undefined ? '' : 'list-none', node.tight ? '' : 'space-y-8'];
    return (
      <li key={index} className={classes.join(' ').trim() || undefined}>
        {item.checked !== undefined && <TaskMark done={item.checked} />}
        {node.tight
          ? item.children.map((child, at) => (
              <Fragment key={at}>
                {/* A tight list's paragraphs are their text, as GitHub draws them. */}
                {isParagraph(child) ? drawInlines(child.children, r) : drawBlock(child, r)}
              </Fragment>
            ))
          : drawBlocks(item.children, r)}
      </li>
    );
  });
  if (!node.ordered) return <ul>{items}</ul>;
  return <ol start={node.start === 1 ? undefined : node.start}>{items}</ol>;
}

/** A task's mark: a ring not yet done, a ball done. */
function TaskMark({ done }: { done: boolean }) {
  return (
    <span
      role="img"
      aria-label={done ? 'Done' : 'Not done'}
      className={`me-6 inline-block ball align-middle ${done ? 'ball-viewed' : ''}`}
    />
  );
}

function alignment(align: Table['align'][number] | undefined): string | undefined {
  switch (align) {
    case 'left':
      return 'text-left';
    case 'center':
      return 'text-center';
    case 'right':
      return 'text-right';
    case 'none':
    case undefined:
      return undefined;
    default:
      align satisfies never;
      throw new Error(`An alignment Lo doesn't know: ${JSON.stringify(align)}.`);
  }
}

function table<X extends Extension>(node: Table<X>, r: Rendering<X>): ReactNode {
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            {node.head.map((cell, index) => (
              <th key={index} className={alignment(node.align[index])}>
                {drawInlines(cell, r)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {node.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, at) => (
                <td key={at} className={alignment(node.align[at])}>
                  {drawInlines(cell, r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function footnotes<X extends Extension>(node: Footnotes<X>, r: Rendering<X>): ReactNode {
  return (
    <section
      aria-label="Footnotes"
      className="max-w-read-measure border-t border-border-subtle pt-12 text-fg-muted text-small"
    >
      <ol>
        {node.items.map((item) => (
          <li key={item.number} id={r.anchors.id(item.name)} tabIndex={-1} className="space-y-6">
            {drawBlocks(item.children, r)}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Code as written, never highlighted: Lo can't know it's the language it says. */
function Fence({ text, bare = false }: { text: string; bare?: boolean }) {
  return (
    <pre
      className={`overflow-x-auto px-12 py-8 ${bare ? 'bg-bg' : 'max-w-read-measure rounded-md bg-hover'}`}
    >
      <code className="rounded-none bg-transparent p-0 shadow-none code-text">{text}</code>
    </pre>
  );
}

export interface FoldProps<X extends Extension> {
  node: Details<X>;
  /** What kind of thing is behind the title, such as "More detail", at the end of its row. */
  kind?: string | undefined;
  className?: string | undefined;
  /** Its number among a document's blocks, for a fold the block keys stop at. */
  number?: number | undefined;
  /** What goes at the end of the title's row, such as a focused block's keys. */
  summaryEnd?: ReactNode;
}

/**
 * Content behind a title, open or closed as the text says to start. Clicking the title, `⏎` or
 * `Space` on it, opens and closes it.
 */
export function Fold<X extends Extension>({
  node,
  kind,
  className,
  number,
  summaryEnd,
}: FoldProps<X>) {
  const r = useRendering<X>();
  const [open, setOpen] = useState(node.open);
  // The browser's own toggle is left out, so what's open is always what Lo says.
  const toggle = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    setOpen((was) => !was);
  };
  return (
    <details
      className={className === undefined ? 'lo-fold' : `lo-fold ${className}`}
      data-lo-block={number}
      open={open}
      // The browser opens a fold itself to show what find in page found in it.
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !modified(event)) toggle(event);
        }}
      >
        <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
        <span className="min-w-0">{drawInlines(node.summary, r)}</span>
        {kind !== undefined && <span className="lo-fold__kind">{kind}</span>}
        {summaryEnd}
      </summary>
      <div className="lo-fold__body">{drawBlocks(node.children, r)}</div>
    </details>
  );
}

export function drawInlines<X extends Extension>(
  nodes: readonly Inline<X>[],
  r: Rendering<X>,
): ReactNode {
  return nodes.map((node, index) => <Fragment key={index}>{drawInline(node, r)}</Fragment>);
}

function drawInline<X extends Extension>(node: Inline<X>, r: Rendering<X>): ReactNode {
  if (!isPlainInline(node)) {
    if (!r.extension.inline) {
      throw new Error(`A kind of text Lo doesn't draw here: ${JSON.stringify(node.kind)}.`);
    }
    return r.extension.inline(node);
  }
  const plain = node;
  switch (plain.kind) {
    case 'text':
      return lines(plain.value);
    case 'strong':
      return <strong>{drawInlines(plain.children, r)}</strong>;
    case 'emphasis':
      return <em>{drawInlines(plain.children, r)}</em>;
    case 'strike':
      return <del>{drawInlines(plain.children, r)}</del>;
    case 'inlineCode':
      return <code>{plain.value}</code>;
    case 'link':
      return drawLink(plain.target, drawInlines(plain.children, r), r);
    case 'image':
      // Shown as a link to the image until Lo can show it without loading it from its host.
      return drawLink({ kind: 'web', url: plain.url }, plain.alt === '' ? 'Image' : plain.alt, r);
    case 'break':
      return <br />;
    case 'sub':
      return <sub>{drawInlines(plain.children, r)}</sub>;
    case 'sup':
      return <sup>{drawInlines(plain.children, r)}</sup>;
    case 'kbd':
      return (
        <kbd className="rounded-xs border border-border-strong px-4 key-edge code-key">
          {drawInlines(plain.children, r)}
        </kbd>
      );
    case 'mention':
      return drawLink({ kind: 'web', url: plain.url }, `@${plain.name}`, r);
    case 'footnoteReference':
      return (
        <sup>
          {drawLink(
            { kind: 'anchor', name: plain.name },
            String(plain.number),
            r,
            `Footnote ${plain.number}`,
          )}
        </sup>
      );
    default:
      plain satisfies never;
      throw new Error(`A kind of text Lo doesn't know: ${JSON.stringify(node.kind)}.`);
  }
}

/** A text's lines, with its newlines as line breaks. */
function lines(value: string): ReactNode {
  if (!value.includes('\n')) return value;
  return value.split('\n').map((line, index) => (
    <Fragment key={index}>
      {index > 0 && <br />}
      {line}
    </Fragment>
  ));
}

/**
 * A link to `target` around `children`, or only `children` when it can't be followed: a page that
 * isn't `https://`, an anchor the document doesn't have, or any link in a copy of text.
 */
function drawLink<X extends Extension>(
  target: Target<X>,
  children: ReactNode,
  r: Rendering<X>,
  label?: string,
): ReactNode {
  if (!r.interactive) return children;
  if (!isPlainTarget(target))
    return r.extension.link ? r.extension.link(target, children) : children;
  const plain = target;
  if (plain.kind === 'web') {
    const url = secureLink(plain.url);
    if (url === undefined) return children;
    return (
      <FollowLink target={{ kind: 'web', url }} label={label}>
        {children}
      </FollowLink>
    );
  }
  if (r.anchors.id(plain.name) === undefined) return children;
  return (
    <FollowLink target={{ kind: 'anchor', name: plain.name }} label={label}>
      {children}
    </FollowLink>
  );
}

function modified(event: KeyboardEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

export interface FollowLinkProps<X extends Extension> {
  target: Followed<X>;
  children: ReactNode;
  /** What a screen reader says for it, when its text doesn't say it all. */
  label?: string | undefined;
  className?: string | undefined;
}

/**
 * A link with no address: a click or `⏎` hands its target to the document. With no `href`, the
 * page itself can't navigate, open a window or drag the address anywhere.
 */
export function FollowLink<X extends Extension>({
  target,
  children,
  label,
  className,
}: FollowLinkProps<X>) {
  const r = useRendering<X>();
  return (
    <a
      role="link"
      tabIndex={0}
      aria-label={label}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        r.follow(target, event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || modified(event)) return;
        event.preventDefault();
        r.follow(target, event.currentTarget);
      }}
    >
      {children}
    </a>
  );
}
