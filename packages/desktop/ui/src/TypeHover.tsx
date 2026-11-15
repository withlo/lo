import { Fragment, useId, useMemo, type HTMLAttributes } from 'react';

import type { Details, Plain, Tree } from '@lo/markdown';

import { showControls, showControlsIn } from './controls.ts';
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

export interface TypeHoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role'> {
  /**
   * The word's declaration, drawn as code: a string, or its stretches, to highlight it. It sets its
   * own line breaks, and a word too long for the card breaks to fit it.
   */
  signature: string | readonly SignatureRun[];
  /**
   * The documentation, as `@lo/markdown`'s tree. A link or an image in it shows as its words, and a
   * fold as its title over what's in it: a hover loads nothing and holds nothing to press.
   */
  docs?: Tree | undefined;
  /** Where the answer came from. */
  source: AnswerSource;
  /** Where the word is declared. */
  location?: { path: string; line: number } | undefined;
  keys?: TypeHoverKeys | undefined;
}

/**
 * What the pointer resting on a word, or `K`, shows beside it: its signature as code, what its
 * documentation says, and where the answer came from. It never takes focus: nothing in it is a
 * stop for `Tab`, so `Esc` or moving on closes it. Place it at the word's box.
 */
export function TypeHover({
  signature,
  docs,
  source,
  location,
  keys,
  className = '',
  ...rest
}: TypeHoverProps) {
  const documented = docs !== undefined && docs.blocks.length > 0;
  return (
    <div
      role="tooltip"
      className={`typehover overflow-hidden rounded-md bg-bg-overlay text-fg shadow-pop text-ui ${className}`}
      {...rest}
    >
      {/* A part that scrolls is still no stop for `Tab`: -1 leaves it to the wheel. */}
      <div
        tabIndex={-1}
        className={`typehover-part bg-code-bg px-12 py-8 wrap-anywhere whitespace-pre-wrap code-small ${documented ? 'border-b border-border-subtle' : ''}`}
      >
        <Signature value={signature} />
      </div>
      {documented && <Docs tree={docs} />}
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

/** A signature's text, each stretch with the colour of its token. */
function Signature({ value }: { value: string | readonly SignatureRun[] }) {
  if (typeof value === 'string') return showControls(value);
  return value.map((run, index) =>
    run.token === undefined ? (
      <Fragment key={index}>{showControls(run.text)}</Fragment>
    ) : (
      <span key={index} className={`lo-syn-${run.token}`}>
        {showControls(run.text)}
      </span>
    ),
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

/** What a hover draws of its own: a fold nothing in it can press. */
const STATIC: MarkdownExtension<Plain> = {
  details: (node) => <DocFold node={node} />,
};

/** No link here can be followed, so none is asked to. */
function noFollow(): void {}

/**
 * The docs, drawn from text no more trusted than a comment: links as their words, folds open, and
 * code and tables wrapped to the card, not scrolled in it. Its bidirectional controls show, as in
 * the code beside it.
 */
function Docs({ tree }: { tree: Tree }) {
  const prefix = scopePrefix(useId());
  const shown = useMemo(() => showControlsIn(tree), [tree]);
  const anchors = useMemo(() => new Anchors(prefix, shown.blocks), [prefix, shown.blocks]);
  const rendering = useMemo<Rendering>(
    () => ({ anchors, follow: noFollow, extension: STATIC, interactive: false }),
    [anchors],
  );
  return (
    <MarkdownProvider rendering={rendering}>
      <div
        tabIndex={-1}
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
  ...rest
}: TypeHoverWaitingProps) {
  return (
    <div
      role="tooltip"
      className={`flex typehover items-baseline gap-8 overflow-hidden rounded-md bg-bg-overlay px-12 py-8 text-fg shadow-pop read-comment ${className}`}
      {...rest}
    >
      <Spinner size="xs" />
      <span className="min-w-0 text-fg-muted">
        {server} is still starting.
        {known !== undefined && (
          <>
            {' '}
            The syntax index knows <code className="text-fg code-small">{known.name}</code> as{' '}
            {withArticle(known.kind)}.
          </>
        )}
      </span>
    </div>
  );
}
