import { Fragment, useId, useMemo, type HTMLAttributes, type MouseEvent } from 'react';

import type { Code, Details, Plain, Tree } from '@lo/markdown';

import { showDocs } from './hoverDocs.ts';
import { Key } from './Key.tsx';
import {
  Anchors,
  drawBlocks,
  drawInlines,
  MarkdownBlocks,
  MarkdownNotes,
  MarkdownProvider,
  scopePrefix,
  useRendering,
  type MarkdownExtension,
  type Rendering,
} from './markdown/index.ts';
import { ShownText } from './ShownText.tsx';
import { PathName, SourceMark, type AnswerSource } from './Source.tsx';
import { Spinner } from './Spinner.tsx';

/** The keys a type hover's foot points to, as this system shows each. A missing one shows none. */
export interface TypeHoverKeys {
  /** Go to the word's definition. */
  definition?: readonly string[] | undefined;
  close?: readonly string[] | undefined;
}

/** A stretch of a signature, and what it is when the language says: "keyword", "type". */
export interface SignatureRun {
  text: string;
  /** A name from the syntax tokens: the stretch is coloured as the code view colours it. */
  token?: string | undefined;
}

/**
 * How a code block in the docs is coloured: the caller's lexer, asked for the block's text and the
 * language its writer named, if any. It answers with the block's stretches, which together are
 * exactly its text, or with nothing to leave it plain. It only colours: what it returns is text,
 * so the card stays as it was.
 */
export type HighlightCode = (code: {
  text: string;
  language: string | undefined;
}) => readonly SignatureRun[] | undefined;

export interface TypeHoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role'> {
  /**
   * The word's declaration, drawn as code: a string, or its stretches, to highlight it. It sets its
   * own line breaks, and a word too long for the card breaks to fit it.
   */
  signature: string | readonly SignatureRun[];
  /**
   * The documentation, as `@lo/markdown`'s tree. A link or an image in it shows as its words with
   * the address it goes to after them, and a fold as its title over what's in it: a hover loads
   * nothing and holds nothing to press. {@link hoverLinks} lists the links, to open one by a key.
   */
  docs?: Tree | undefined;
  /** Colours the docs' code blocks. Without it they're plain. Keep it the same between draws. */
  highlight?: HighlightCode | undefined;
  /** Where the answer came from. */
  source: AnswerSource;
  /** Where the word is declared. */
  location?: { path: string; line: number } | undefined;
  keys?: TypeHoverKeys | undefined;
}

/**
 * What the pointer resting on a word, or `K`, shows beside it: its signature as code, what its
 * documentation says, and where the answer came from. It never takes focus: nothing in it is a
 * stop for `Tab`, a click gives focus back to where it was, and `Esc` or moving on closes it. Place
 * it at the word's box.
 */
export function TypeHover({
  signature,
  docs,
  highlight,
  source,
  location,
  keys,
  className = '',
  onMouseDown,
  ...rest
}: TypeHoverProps) {
  const documented = docs !== undefined && docs.blocks.length > 0;
  return (
    <div
      role="tooltip"
      className={`typehover overflow-hidden rounded-md bg-bg-overlay text-fg shadow-pop text-ui ${className}`}
      onMouseDown={(event) => {
        keepFocus(event);
        onMouseDown?.(event);
      }}
      {...rest}
    >
      {/* Its parts scroll by the wheel alone: they take no focus, by `Tab` or by a click. */}
      <div
        ref={scrollByWheel}
        className={`typehover-part bg-code-bg px-12 py-8 wrap-anywhere whitespace-pre-wrap code-small ${documented ? 'border-b border-border-subtle' : ''}`}
      >
        <CodeRuns value={signature} />
      </div>
      {documented && <Docs tree={docs} highlight={highlight} />}
      <div
        className={`flex flex-wrap items-baseline gap-x-12 gap-y-2 px-12 pt-6 pb-8 text-fg-muted text-small ${documented ? '' : 'border-t border-border-subtle'}`}
      >
        <SourceMark
          source={source}
          note={source.kind === 'server' && !documented ? 'No doc comment' : undefined}
        />
        <span className="flex-1" />
        {location !== undefined && (
          <span className="flex max-w-full min-w-0 items-baseline code-small">
            <PathName path={location.path} />
            <span className="flex-none">:{location.line}</span>
          </span>
        )}
        {keys?.definition && (
          <span className="inline-flex flex-none items-center gap-6 whitespace-nowrap">
            <Key keys={keys.definition} quiet /> Definition
          </span>
        )}
        {keys?.close && (
          <span className="inline-flex flex-none items-center gap-6 whitespace-nowrap">
            <Key keys={keys.close} quiet /> Close
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A press on the card lands on text, which can't take focus, so the browser takes focus from
 * whatever had it. The card gives it back once the press is over, not before: stopping the press
 * would stop it selecting text, which a reader copies a signature by. A selection made meanwhile
 * is kept, since focusing an editor would put its own caret in its place.
 */
function keepFocus(event: MouseEvent<HTMLElement>): void {
  const page = event.currentTarget.ownerDocument;
  const before = page.activeElement;
  if (!(before instanceof HTMLElement) || before === page.body) return;
  page.addEventListener(
    'mouseup',
    () => {
      if (!before.isConnected || page.activeElement === before) return;
      const selection = page.getSelection();
      const kept =
        selection !== null && selection.rangeCount > 0 && !selection.isCollapsed
          ? selection.getRangeAt(0).cloneRange()
          : undefined;
      before.focus({ preventScroll: true });
      if (selection !== null && kept !== undefined) {
        selection.removeAllRanges();
        selection.addRange(kept);
      }
    },
    // The press may end anywhere, and a page that stops it ending is no business of the card's.
    { once: true, capture: true },
  );
}

/** Code as text, each stretch with the colour of its token. */
function CodeRuns({ value }: { value: string | readonly SignatureRun[] }) {
  if (typeof value === 'string') return <ShownText text={value} />;
  return value.map((run, index) =>
    run.token === undefined ? (
      <Fragment key={index}>
        <ShownText text={run.text} />
      </Fragment>
    ) : (
      <span key={index} className={`lo-syn-${run.token}`}>
        <ShownText text={run.text} />
      </span>
    ),
  );
}

/** A code block of the docs, wrapped to the card, coloured as far as the caller colours it. */
function DocCode({ node, highlight }: { node: Code; highlight: HighlightCode | undefined }) {
  const runs = highlight?.({ text: node.text, language: node.language });
  // Runs that don't add up to the block's text would change what it says: it stays plain.
  const whole = runs?.map((run) => run.text).join('') === node.text;
  return (
    <pre className="rounded-md bg-hover px-12 py-8 wrap-anywhere whitespace-pre-wrap">
      <code className="rounded-none bg-transparent p-0 shadow-none code-text">
        <CodeRuns value={runs !== undefined && whole ? runs : node.text} />
      </code>
    </pre>
  );
}

/** A fold as its title above what it holds, drawn open: a card has no way to open it. */
function DocFold({ node }: { node: Details }) {
  const r = useRendering();
  return (
    <div className="space-y-4">
      <p className="font-semibold">{drawInlines(node.summary, r)}</p>
      {drawBlocks(node.children, r)}
    </div>
  );
}

/** No link here can be followed, so none is asked to. */
function noFollow(): void {}

/** Scrolls a part by the wheel, which is all that can reach it: no key and no click does. */
function onWheel(event: WheelEvent): void {
  const part = event.currentTarget;
  if (!(part instanceof HTMLElement)) return;
  const top = Math.min(
    part.scrollHeight - part.clientHeight,
    Math.max(0, part.scrollTop + event.deltaY),
  );
  // At either end it leaves the wheel to whatever is behind it.
  if (top === part.scrollTop) return;
  part.scrollTop = top;
  event.preventDefault();
}

/**
 * A ref for a part of the card that can be taller than it shows. It doesn't scroll for itself, as
 * a scroller would, since Chromium makes one a stop for `Tab`, and a `tabindex` to stop that makes
 * a click focus it. So it's cut short, and the wheel scrolls it.
 */
function scrollByWheel(part: HTMLElement | null): (() => void) | undefined {
  if (!part) return undefined;
  // Not passive, so the wheel can be kept from scrolling what's behind the card too.
  part.addEventListener('wheel', onWheel, { passive: false });
  return () => part.removeEventListener('wheel', onWheel);
}

/**
 * The docs, drawn from text no more trusted than a comment: links as their words and where they go,
 * folds open, and code and tables wrapped to the card, not scrolled in it. Format characters that
 * hide or reorder text show as marks, though not the few that scripts and emoji are written with,
 * and each paragraph reads in the direction of its own text.
 */
function Docs({ tree, highlight }: { tree: Tree; highlight: HighlightCode | undefined }) {
  const prefix = scopePrefix(useId());
  const shown = useMemo(() => showDocs(tree), [tree]);
  const anchors = useMemo(() => new Anchors(prefix, shown.blocks), [prefix, shown.blocks]);
  const rendering = useMemo<Rendering>(() => {
    const extension: MarkdownExtension<Plain> = {
      code: (node) => <DocCode node={node} highlight={highlight} />,
      details: (node) => <DocFold node={node} />,
    };
    return { anchors, follow: noFollow, extension, interactive: false, dir: 'auto' };
  }, [anchors, highlight]);
  return (
    <MarkdownProvider rendering={rendering}>
      <div
        ref={scrollByWheel}
        className="lo-prose typehover-part typehover-docs px-12 py-8 wrap-anywhere read-comment"
      >
        <MarkdownBlocks blocks={shown.blocks} />
        <MarkdownNotes notes={shown.notes} />
      </div>
    </MarkdownProvider>
  );
}

export interface TypeHoverWaitingProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'role'
> {
  /** The language server that hasn't answered yet: "TypeScript". */
  server: string;
  /**
   * What the syntax index knows the word as, when it knows it: "method", "function", "class". It
   * keeps the reader from waiting on nothing.
   */
  known?: { name: string; kind: string } | undefined;
}

/** "a method", "an interface". */
function withArticle(kind: string): string {
  return `${/^[aeio]/i.test(kind) ? 'an' : 'a'} ${kind}`;
}

/**
 * The card when the language server is still starting: the wait, and what the syntax index knows of
 * the word meanwhile, so `K` is never an empty box.
 */
export function TypeHoverWaiting({
  server,
  known,
  className = '',
  onMouseDown,
  ...rest
}: TypeHoverWaitingProps) {
  return (
    <div
      role="tooltip"
      className={`flex typehover items-baseline gap-8 overflow-hidden rounded-md bg-bg-overlay px-12 py-8 text-fg shadow-pop read-comment ${className}`}
      onMouseDown={(event) => {
        keepFocus(event);
        onMouseDown?.(event);
      }}
      {...rest}
    >
      <Spinner size="xs" />
      <span className="min-w-0 text-fg-muted">
        <ShownText text={server} /> is still starting.
        {known !== undefined && (
          <>
            {' '}
            The syntax index knows{' '}
            <code className="text-fg code-small">
              <ShownText text={known.name} />
            </code>{' '}
            as <ShownText text={withArticle(known.kind)} />.
          </>
        )}
      </span>
    </div>
  );
}
