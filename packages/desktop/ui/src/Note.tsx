import { useRef, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import type { Target } from './commands/targets.ts';
import { NOTE_TEXT } from './edits.ts';
import { useGiveUp } from './giveUp.ts';
import { HintButton } from './HintButton.tsx';
import { Icon } from './Icon.tsx';
import { threadCard } from './Thread.tsx';

/** The words of the control that closes an overview note, and its tooltip. */
export const CLOSE_NOTE = 'Close overview note';

export interface NoteProps {
  /**
   * Where it's drawn: in a `popover` over the code, beside lines, whose shell is its ground; or on
   * a `card` of its own under its last line, between lines, in a thread card's frame.
   */
  variant?: 'popover' | 'card' | undefined;
  /** What a screen reader calls it: "Overview note, lines 2–15". */
  label: string;
  /** The section of the overview it's from, by its name, in its head. */
  section?: string | undefined;
  /** In a popover, the lines it's on, in its head: "Lines 2–15". */
  lines?: string | undefined;
  /**
   * In a popover, the popover pinned: its key chips and its Close show, in room a preview keeps for
   * them, so pinning it moves nothing. On a card, the keyboard on it: its key chips show, and its
   * ring.
   */
  focused?: boolean | undefined;
  /** "Show in overview": the command its button runs, and what it runs on. */
  show?: { readonly command: string; readonly target?: Target | undefined } | undefined;
  /**
   * In a popover, its Close: the popover's, on its first note. On a card, its collapse control,
   * which closes it.
   */
  onClose?: (() => void) | undefined;
  /** Close's keys, as this system shows them. */
  closeKeys?: readonly string[] | undefined;
  /** Its words, already drawn, or the element they're drawn in. */
  children?: ReactNode;
}

/**
 * What a note's head gives up, in order, as it narrows, so it stays one line: the section's name,
 * the key chips, and "Show in overview"'s words for its icon. Only then are its lines cut short.
 */
const STEPS = ['detail', 'keys', 'labels'];

/**
 * What an overview says of lines of a diff, opened from its ball, laid out as a thread is: its head
 * one line, with the ball, "Overview", its lines in a popover and its section, and at the right
 * "Show in overview" and Close, or a card's collapse; then its words, in a comment's type and
 * colour, flush with the head's left edge. A preview shows no key chips and no Close, and keeps
 * their room. Its words are the caller's, drawn already, in the element a code view measures them
 * by (`NOTE_TEXT`).
 */
export function Note({
  variant = 'card',
  label,
  section,
  lines,
  focused = false,
  show,
  onClose,
  closeKeys,
  children,
}: NoteProps) {
  const head = useRef<HTMLDivElement | null>(null);
  useGiveUp(head, STEPS);
  const popover = variant === 'popover';
  const close =
    onClose &&
    (popover ? (
      // Only a pinned popover has it, in room a preview keeps, so pinning moves nothing.
      <span
        aria-hidden={focused ? undefined : true}
        className={focused ? 'flex move-swap' : 'invisible flex'}
      >
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={CLOSE_NOTE}
          tabIndex={focused ? undefined : -1}
          hint={CLOSE_NOTE}
          hintKeys={closeKeys}
          onClick={onClose}
        >
          <Icon name="x" size={14} />
        </Button>
      </span>
    ) : (
      <Button
        variant="ghost"
        size="sm"
        icon
        aria-label={CLOSE_NOTE}
        aria-expanded
        hint={CLOSE_NOTE}
        onClick={onClose}
      >
        <Icon name="chevron-up" size={16} />
      </Button>
    ));
  return (
    <div
      role="group"
      aria-label={label}
      data-focused={focused ? '' : undefined}
      data-key-scope=""
      // In a popover, a preview keeps the room of the chips a pinned one shows.
      data-key-room={popover ? '' : undefined}
      className={popover ? 'text-fg' : threadCard(focused)}
    >
      <div
        ref={head}
        data-pop-head={popover ? '' : undefined}
        className={`give-up flex h-32 items-center gap-8 border-b border-border-subtle ps-12 pe-6 whitespace-nowrap text-fg-muted text-small ${popover ? 'sticky top-0 z-1 bg-bg-overlay' : ''}`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-8">
          <span aria-hidden="true" className="note-ball" />
          <span className="flex-none text-small-medium text-fg">Overview</span>
          {popover && lines !== undefined && (
            <span data-fit className="min-w-cut truncate">
              {lines}
            </span>
          )}
          {section !== undefined && section !== '' && (
            <span data-gives="detail" className="flex-none">
              {section}
            </span>
          )}
        </span>
        <span className="flex flex-none items-center gap-2">
          {show && (
            <HintButton
              command={show.command}
              target={show.target}
              icon="scroll-text"
              keyWhen="focus"
            >
              Show in overview
            </HintButton>
          )}
          {close}
        </span>
      </div>
      <div {...{ [NOTE_TEXT]: '' }} className="lo-selectable px-12 py-8 text-fg read-comment">
        {children}
      </div>
    </div>
  );
}
