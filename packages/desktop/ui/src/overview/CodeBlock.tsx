/**
 * A code block's frame, and how it draws whatever it shows: the file and lines it points at in its
 * head, and under it the code, or what it says in the code's place. The code is real code, which
 * whoever has it draws; a plain fenced block is never code from the pull request, and draws as an
 * illustration.
 */

import type { ReactNode, Ref } from 'react';

import type { CodeRange } from '@lo/artifact';
import type { Code } from '@lo/markdown';

import { lineRange } from './placeholders.tsx';
import { ExcerptSpace } from './space.tsx';

/**
 * How a code block draws: its code, the file or lines it names missing (`unresolved`), or its
 * commit gone (`missing`).
 */
export type CodeBlockVariant = 'code' | 'unresolved' | 'missing';

/** A path, its file's name set apart. */
export function PathName({ path }: { path: string }) {
  const slash = path.lastIndexOf('/');
  return (
    <>
      {path.slice(0, slash + 1)}
      <b>{path.slice(slash + 1)}</b>
    </>
  );
}

/**
 * A code block: the file and lines `target` names, with what the reader can do about them,
 * `actions`, in its head, where they stay whatever happens to the body; under them, `flag`, when
 * lines it shows changed since (a {@link CodeFlag}); and under that, `children`.
 */
export function CodeBlock({
  target,
  variant = 'code',
  actions,
  flag,
  children,
}: {
  target: CodeRange;
  variant?: CodeBlockVariant | undefined;
  actions?: ReactNode;
  flag?: ReactNode;
  children: ReactNode;
}) {
  const className = variant === 'code' ? 'lo-codeblock' : `lo-codeblock lo-codeblock--${variant}`;
  return (
    <div className={className}>
      <div className="lo-codeblock__head">
        <span className="lo-codeblock__path">
          <PathName path={target.path} />
        </span>
        <span className="lo-codeblock__lines">{lineRange(target.lines)}</span>
        {actions !== undefined && <span className="lo-codeblock__actions">{actions}</span>}
      </div>
      {flag}
      {children}
    </div>
  );
}

/**
 * Under a code block's head, when lines it shows changed since the commit it shows: which, in
 * `children`, and the way to the comparison, `action`.
 */
export function CodeFlag({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="lo-codeblock__flag" role="note" data-lo-code-flag="">
      <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9.5a1 1 0 0 1-.87 1.5H2.8a1 1 0 0 1-.87-1.5Z" />
        <path d="M8 6.25v3M8 11.25v.01" />
      </svg>
      <span className="lo-codeblock__flagtext">{children}</span>
      {action}
    </div>
  );
}

/**
 * Where a code block's code goes: from the start at least as tall as an excerpt of `rows` lines,
 * whatever it holds until the code comes, so code that doesn't wrap and adds no lines moves
 * nothing as it comes.
 */
export function CodeBody({
  rows,
  children,
  ref,
}: {
  rows: number;
  children?: ReactNode;
  ref?: Ref<HTMLDivElement> | undefined;
}) {
  return (
    <div ref={ref} className="lo-codeblock__body">
      <div className="lo-codeblock__space">
        <ExcerptSpace rows={rows} />
      </div>
      {children}
    </div>
  );
}

/** What a code block says in its code's place: why, and what the reader can do about it. */
export function CodeNote({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="lo-codeblock__msg">
      <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9.5a1 1 0 0 1-.87 1.5H2.8a1 1 0 0 1-.87-1.5Z" />
        <path d="M8 6.25v3M8 11.25v.01" />
      </svg>
      <div className="min-w-0">
        <strong>{title}</strong> {children}
        {action !== undefined && <div>{action}</div>}
      </div>
    </div>
  );
}

/**
 * A plain fenced block in an overview: never code from the pull request, so it's drawn as an
 * illustration, dashed and labeled as one, with no line numbers or highlighting.
 */
export function Illustration({ node }: { node: Code }) {
  return (
    <div className="lo-codeblock lo-codeblock--illustration">
      <div className="lo-codeblock__head">
        <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1.75a6.25 6.25 0 1 1 0 12.5a6.25 6.25 0 1 1 0-12.5Z" />
          <path d="M8 7.25V11M8 5v.01" />
        </svg>
        <span>
          <strong>Illustration</strong> · not code from this PR
        </span>
      </div>
      <pre>{node.text}</pre>
    </div>
  );
}
