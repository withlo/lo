import { useId, type HTMLAttributes, type ReactNode, type Ref } from 'react';

import { Button } from './Button.tsx';
import { showFormat } from './controls.ts';
import { Key } from './Key.tsx';
import { PaletteHint } from './Palette.tsx';
import { ShownText } from './ShownText.tsx';
import { PathName, SourceMark, type AnswerSource } from './Source.tsx';

/** An answer in a file of the repository: its line, and where the answer came from. */
export interface PeekPlace {
  /** What identifies it, and what `selected` and `onPick` name. */
  key: string;
  /** The file's path in the repository. */
  path: string;
  /** The line the answer is on, from 1. */
  line: number;
  source: AnswerSource;
  /** What sets it apart from the other answers: "overload", "same name". */
  note?: string | undefined;
  /**
   * The module the word is imported from, when this answer is the asking file's import of it and
   * the language server found no definition: its row says Lo doesn't install it. The path and line
   * are the import's own.
   */
  from?: string | undefined;
  outside?: false | undefined;
}

/**
 * An answer outside the repository, such as a toolchain's own sources. Lo never reads one, so the
 * row says so and names no file; there's no code to show for it and nothing to go to.
 */
export interface PeekOutside {
  key: string;
  outside: true;
  source: AnswerSource;
  note?: string | undefined;
}

/** One answer of a peek. */
export type PeekCandidate = PeekPlace | PeekOutside;

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
  /**
   * The answers to pick between. A language server's answer within its deadline is shown alone, so
   * they come from one source: the server's, or else the syntax index's, with the asking file's
   * import of the word, if it has one, first.
   */
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
  /** The button that goes to the answer shown was pressed. It can't, for one outside the repository. */
  onGo?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  /** The list of answers, which takes focus. */
  listRef?: Ref<HTMLDivElement> | undefined;
  /**
   * The shown answer's code, as the diff view draws a peek's. An answer outside the repository has
   * none, and the peek says so in its place.
   */
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

/** What a peek's head shows: the word, how many answers, and its two buttons. */
export interface PeekHeadProps {
  /** The word the peek answers for. */
  name: string;
  /** How many answers it has. */
  count: number;
  /** The revision the answers are read at: "r5". */
  at?: string | undefined;
  /** What the button that goes to the answer says. Defaults to opening the file whole. */
  goLabel?: string | undefined;
  /** Whether the answer shown can be gone to: one outside the repository can't. */
  goes: boolean;
  keys?: PeekKeys | undefined;
  onGo?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
}

/**
 * The head of a peek, in a row its caller lays out: an eye, the word and how many answers it has,
 * at which revision, the way to go to the one shown, and the way to close it.
 */
export function PeekHead({
  name,
  count,
  at,
  goLabel = 'Open the whole file',
  goes,
  keys,
  onGo,
  onClose,
}: PeekHeadProps) {
  const closeLabel = keys?.close ? `Close (${keys.close.join(' ')})` : 'Close';
  return (
    <>
      <EyeIcon />
      <span className="max-w-full min-w-0 truncate">
        <strong className="font-semibold text-fg">
          <ShownText text={name} />
        </strong>{' '}
        · <span className="lo-num">{definitions(count)}</span>
      </span>
      {at !== undefined && (
        <span className="flex-none">
          at <ShownText text={at} />
        </span>
      )}
      <span className="flex-1" />
      <span className="peek-go">
        <Button variant="ghost" size="sm" disabled={!goes} onClick={() => onGo?.()}>
          {goLabel}
          {keys?.go && <Key keys={keys.go} quiet />}
        </Button>
      </span>
      <span className="peek-close">
        <Button variant="ghost" size="sm" icon aria-label={closeLabel} onClick={() => onClose?.()}>
          <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </Button>
      </span>
    </>
  );
}

export interface PeekListProps {
  candidates: readonly PeekCandidate[];
  /** The answer whose code shows, by key. */
  selected: string | undefined;
  onPick?: ((key: string) => void) | undefined;
  listRef?: Ref<HTMLDivElement> | undefined;
  className?: string | undefined;
}

/**
 * A peek's answers: one focusable list, as the threads panel's is, whose active descendant is the
 * answer the keyboard is on, the one whose code shows. Each says where it is and where it came
 * from.
 */
export function PeekList({ candidates, selected, onPick, listRef, className = '' }: PeekListProps) {
  const prefix = useId();
  const index = candidates.findIndex((each) => each.key === selected);
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Candidates"
      tabIndex={0}
      aria-activedescendant={index === -1 ? undefined : `${prefix}-${index}`}
      className={`group/list flex flex-col gap-2 p-6 ${className}`}
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
          {each.outside === true ? (
            <span className="col-span-full min-w-0 truncate text-fg-muted text-small">
              Outside this repository
            </span>
          ) : (
            <>
              <span className="min-w-0 code-small">
                <PathName path={each.path} strong />
              </span>
              <span className="lo-num text-fg-muted text-small">{each.line}</span>
            </>
          )}
          <span className="col-span-full min-w-0 text-fg-muted text-small">
            <SourceMark
              wrap
              source={each.source}
              note={
                each.outside !== true && each.from !== undefined
                  ? `From ${each.from}, which Lo doesn't install`
                  : each.note
              }
            />
          </span>
        </div>
      ))}
    </div>
  );
}

export interface PeekFootProps {
  /** What it says of the answer shown: its path, its revision, and whether the PR added it. */
  meta?: string | undefined;
  /** Whether there's more than one answer to move between. */
  several: boolean;
  keys?: PeekKeys | undefined;
}

/** The foot of a peek, in a row its caller lays out: where the answer shown is, and the keys. */
export function PeekFoot({ meta, several, keys }: PeekFootProps) {
  return (
    <>
      <span className="lo-num min-w-0 truncate">
        {meta !== undefined && <ShownText text={meta} />}
      </span>
      <span className="flex-1" />
      {keys?.move && several && <PaletteHint keys={keys.move}>Candidate</PaletteHint>}
      {keys?.references && <PaletteHint keys={keys.references}>References</PaletteHint>}
      {keys?.back && <PaletteHint keys={keys.back}>Back</PaletteHint>}
    </>
  );
}

/**
 * The frame around a peek's code, under the line the reader asked about: what was asked, how many
 * answers there are, the way to go to the one shown, the list of answers with where each came from,
 * and the keys. The code is what the diff view draws for the answer shown, so the frame takes it as
 * its child. A code view's peek draws the head, the list and the foot in parts of its own.
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
  goLabel,
  keys,
  onPick,
  onGo,
  onClose,
  listRef,
  children,
  className = '',
  ...rest
}: PeekProps) {
  const single = candidates.length === 1;
  // An answer outside the repository has no file to go to.
  const shown = candidates.find((each) => each.key === selected);
  const goes = shown !== undefined && shown.outside !== true;
  return (
    <div
      role="dialog"
      aria-label={`Definitions of ${showFormat(name)}`}
      // The frame is the container its parts adapt to, so a peek in a narrow place stacks its list
      // above its code whatever the window's width is.
      className={`@container overflow-hidden rounded-md bg-bg-raised text-fg ring-1 ring-border text-ui focus-within:shadow-ring ${className}`}
      {...rest}
    >
      <div className={`peek ${single ? 'peek-single' : ''}`}>
        <div className="col-span-full flex min-h-32 min-w-0 flex-wrap items-center gap-x-8 gap-y-2 border-b border-border-subtle py-2 ps-12 pe-8 text-fg-muted text-small">
          <PeekHead
            name={name}
            count={candidates.length}
            at={at}
            goLabel={goLabel}
            goes={goes}
            keys={keys}
            onGo={onGo}
            onClose={onClose}
          />
        </div>
        <PeekList
          candidates={candidates}
          selected={selected}
          onPick={onPick}
          listRef={listRef}
          className={`peek-list overflow-auto ${single ? 'border-b border-border-subtle' : 'peek-rule'}`}
        />
        <div className="min-w-0 bg-code-bg">
          {children ??
            (shown?.outside === true && (
              <p className="m-0 px-12 py-8 text-fg-muted text-small">
                Lo doesn&apos;t read files outside this repository.
              </p>
            ))}
        </div>
        <div className="col-span-full flex min-h-32 min-w-0 flex-wrap items-center gap-x-12 gap-y-2 border-t border-border-subtle py-2 ps-12 pe-8 text-fg-muted text-small">
          <PeekFoot meta={meta} several={!single} keys={keys} />
        </div>
      </div>
    </div>
  );
}
