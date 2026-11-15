import type { HTMLAttributes, ReactNode } from 'react';

import type { Tree } from '@lo/markdown';

import { Key } from './Key.tsx';
import { Markdown, type MarkdownProps } from './markdown/index.ts';
import { PathName, SourceMark, type AnswerSource } from './Source.tsx';
import { Spinner } from './Spinner.tsx';

/** The keys a type hover's foot points to, as this system shows each. A missing one shows none. */
export interface TypeHoverKeys {
  /** Go to the word's definition. */
  definition?: readonly string[] | undefined;
  close?: readonly string[] | undefined;
}

export interface TypeHoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role'> {
  /**
   * The word's declaration, drawn as code: a string, or nodes that highlight it. It sets its own
   * line breaks.
   */
  signature: ReactNode;
  /**
   * The documentation, as `@lo/markdown`'s tree. An image in it shows as a link: a hover loads
   * nothing. Without docs, the foot says so when a language server was asked.
   */
  docs?: Tree | undefined;
  /** Where the answer came from. */
  source: AnswerSource;
  /** Where the word is declared. */
  location?: { path: string; line: number } | undefined;
  keys?: TypeHoverKeys | undefined;
  /** A link in the docs was followed. */
  onFollow?: MarkdownProps['onFollow'];
  /** How the docs draw what Lo's Markdown leaves to the caller, such as a highlighted code block. */
  extension?: MarkdownProps['extension'];
}

/**
 * What the pointer resting on a word, or `K`, shows beside it: its signature as code, what its
 * documentation says, and where the answer came from. It never takes focus and holds nothing that
 * isn't also in the code, so `Esc` or moving on closes it. Place it at the word's box.
 */
export function TypeHover({
  signature,
  docs,
  source,
  location,
  keys,
  onFollow,
  extension,
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
      <div
        className={`typehover-part bg-code-bg px-12 py-8 whitespace-pre-wrap code-small ${documented ? 'border-b border-border-subtle' : ''}`}
      >
        {signature}
      </div>
      {documented && (
        <Markdown
          tree={docs}
          onFollow={onFollow}
          extension={extension}
          className="lo-prose typehover-part px-12 py-8 read-comment"
        />
      )}
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
