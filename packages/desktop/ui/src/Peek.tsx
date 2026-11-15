import { useId, type HTMLAttributes, type ReactNode, type Ref } from 'react';

import { Button } from './Button.tsx';
import { Key } from './Key.tsx';
import { PaletteHint } from './Palette.tsx';
import { PathName, SourceMark, type AnswerSource } from './Source.tsx';

/** One answer of a peek: a line somewhere in the repository, and where the answer came from. */
export interface PeekCandidate {
  /** What identifies it, and what `selected` and `onPick` name. */
  key: string;
  /** The file's path in the repository. */
  path: string;
  /** The line the answer is on, from 1. */
  line: number;
  source: AnswerSource;
  /** What sets it apart from the other answers: "overload", "same name". */
  note?: string | undefined;
}

/**
 * The keys of a peek's actions, as this system shows each (`['j', 'k']`, `['g', 'r']`). An action
 * with no keys shows none.
 */
export interface PeekKeys {
  /** Pick the next or previous answer. */
  move?: readonly string[] | undefined;
  /** Go to the answer shown. */
  go?: readonly string[] | undefined;
  /** List every reference of the word. */
  references?: readonly string[] | undefined;
  /** Back to where the peek was opened from. */
  back?: readonly string[] | undefined;
  close?: readonly string[] | undefined;
}

export interface PeekProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'role' | 'aria-label' | 'tabIndex'
> {
  /** The word the peek answers for. */
  name: string;
  /** The answers, a language server's first. */
  candidates: readonly PeekCandidate[];
  /** The answer whose code shows, by key: the one `j` and `k` have reached. */
  selected: string | undefined;
  /** The revision the answers are read at: "r5". */
  at?: string | undefined;
  /** What the foot says of the answer shown: its path, its revision, and whether the PR added it. */
  meta?: string | undefined;
  /** What the button that goes to the answer says. Defaults to opening the file whole. */
  goLabel?: string | undefined;
  keys?: PeekKeys | undefined;
  /** An answer was clicked: it's the one shown. */
  onPick?: ((key: string) => void) | undefined;
  /** The button that goes to the answer shown was pressed. */
  onGo?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  /** The list of answers, which takes focus. */
  listRef?: Ref<HTMLDivElement> | undefined;
  /** The shown answer's code, as the diff view draws a peek's. */
  children?: ReactNode;
}

/** "1 definition", "3 definitions". */
function definitions(count: number): string {
  return `${count} ${count === 1 ? 'definition' : 'definitions'}`;
}

/** An eye: the mark of looking at something without leaving where you are. */
function EyeIcon() {
  return (
    <svg className="lo-i lo-i--sm flex-none" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 8s2.25-4.25 6-4.25S14 8 14 8s-2.25 4.25-6 4.25S2 8 2 8Z" />
      <circle cx="8" cy="8" r="1.75" />
    </svg>
  );
}

/**
 * The frame around a peek's code, under the line the reader asked about: what was asked, how many
 * answers there are, the way to go to the one shown, the list of answers with where each came from,
 * and the keys. The code is what the diff view draws for the answer shown, so the frame takes it as
 * its child.
 *
 * The list is one focusable element, as the threads panel's is: the answer the keyboard is on is its
 * active descendant, and is the one whose code shows. With a single answer the list is one row
 * above the code.
 */
export function Peek({
  name,
  candidates,
  selected,
  at,
  meta,
  goLabel = 'Open the whole file',
  keys,
  onPick,
  onGo,
  onClose,
  listRef,
  children,
  className = '',
  ...rest
}: PeekProps) {
  const prefix = useId();
  const single = candidates.length === 1;
  const index = candidates.findIndex((each) => each.key === selected);
  const closeLabel = keys?.close ? `Close (${keys.close.join(' ')})` : 'Close';
  return (
    <div
      role="dialog"
      aria-label={`Definitions of ${name}`}
      className={`peek ${single ? 'peek-single' : ''} overflow-hidden rounded-md bg-bg-raised text-fg ring-1 ring-border text-ui focus-within:shadow-ring ${className}`}
      {...rest}
    >
      <div className="col-span-full flex h-32 min-w-0 items-center gap-8 border-b border-border-subtle ps-12 pe-8 text-fg-muted text-small">
        <EyeIcon />
        <span className="min-w-0 truncate">
          <strong className="font-semibold text-fg">{name}</strong> ·{' '}
          <span className="lo-num">{definitions(candidates.length)}</span>
        </span>
        {at !== undefined && <span className="flex-none">at {at}</span>}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => onGo?.()}>
          {goLabel}
          {keys?.go && <Key keys={keys.go} quiet />}
        </Button>
        <Button variant="ghost" size="sm" icon aria-label={closeLabel} onClick={() => onClose?.()}>
          <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </Button>
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Candidates"
        tabIndex={0}
        aria-activedescendant={index === -1 ? undefined : `${prefix}-${index}`}
        className={`group/list flex peek-list flex-col gap-2 overflow-auto p-6 ${single ? 'border-b' : 'border-e'} border-border-subtle`}
      >
        {candidates.map((each, place) => (
          <div
            key={each.key}
            id={`${prefix}-${place}`}
            role="option"
            aria-selected={each.key === selected}
            data-key={each.key}
            className={`peek-answer cursor-default gap-x-8 gap-y-2 rounded-sm px-8 py-6 hover:bg-hover ${each.key === selected ? 'bg-current-strong group-focus-visible/list:shadow-ring-inset' : ''}`}
            onClick={() => onPick?.(each.key)}
          >
            <span className="min-w-0 code-small">
              <PathName path={each.path} strong />
            </span>
            <span className="lo-num text-fg-muted text-small">{each.line}</span>
            <span className="col-span-full min-w-0 text-fg-muted text-small">
              <SourceMark source={each.source} note={each.note} />
            </span>
          </div>
        ))}
      </div>
      <div className="min-w-0 bg-code-bg">{children}</div>
      <div className="col-span-full flex h-32 min-w-0 items-center gap-12 border-t border-border-subtle ps-12 pe-8 text-fg-muted text-small">
        <span className="lo-num min-w-0 truncate">{meta}</span>
        <span className="flex-1" />
        {keys?.move && !single && <PaletteHint keys={keys.move}>Candidate</PaletteHint>}
        {keys?.references && <PaletteHint keys={keys.references}>References</PaletteHint>}
        {keys?.back && <PaletteHint keys={keys.back}>Back</PaletteHint>}
      </div>
    </div>
  );
}
