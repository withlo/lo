// A term's card: what a term in the text shows while the pointer rests on it or it has keyboard
// focus. Its head (the term, its tags and its `⋯`), its definition, the one it replaces, who it's
// by, its suggestions and a foot of hints. The card takes no focus, and a screen reader never hears
// it: the term's own keys and menu do everything its buttons do, and the term's row in the glossary
// holds the same words.

import type { ComponentPropsWithRef, ReactNode } from 'react';

import { runControl } from '../commands/control.ts';
import type { Target } from '../commands/targets.ts';
import { withoutBidi } from '../controls.ts';
import { HintButton } from '../HintButton.tsx';
import { HintRow } from '../HintRow.tsx';
import { LinkButton } from '../LinkButton.tsx';
import { MoreButton } from '../MoreButton.tsx';
import { useControl } from '../useControl.ts';
import { TermByline, type TermBylineShown } from './TermByline.tsx';
import { suggestionsCount, TermBefore, TermTags, type TermMarks } from './TermTags.tsx';

/** A hint in a card's foot: a command, by its id, what it runs on, and its words in the foot. */
export interface TermHint {
  /** The command it runs: `terms.edit`. */
  readonly command: string;
  /** What it runs on, as the term's keys would: the term. */
  readonly target?: Target | undefined;
  /** Its words, where the command's label is too long for the foot: "Edit…" for "Edit term…". */
  readonly label?: ReactNode;
}

export interface TermCardProps extends Omit<ComponentPropsWithRef<'div'>, 'children' | 'title'> {
  /** The term, as its definition names it: "bucket". */
  term: string;
  /** Its tags in the head: New or Changed, and Locked. Its suggestions are a link, not a tag. */
  marks?: Omit<TermMarks, 'suggestions'> | undefined;
  /**
   * Its definition: the store's whole, or an overview's own first paragraph, as the caller draws
   * it, links that take a click and all. Nothing says "In the glossary." in its place, for an
   * overview's own definition that doesn't start with a paragraph.
   */
  definition?: ReactNode;
  /** There's more of an overview's own definition than the card shows: "More in the glossary." */
  more?: boolean | undefined;
  /** On a Changed term, the definition it replaces, under the "Before" tag. */
  before?: ReactNode;
  /**
   * Who the definition is by, which the card draws as a `TermByline` that takes no focus. None for
   * a term the store doesn't hold.
   */
  byline?: TermBylineShown | undefined;
  /**
   * On a locked term with suggestions: how many, as a link under the byline that runs `command`
   * (Show history) on `target`, the term.
   */
  suggestions?: { count: number; command: string; target?: Target | undefined } | undefined;
  /**
   * The foot's hints: "Edit…" `i` with push access, then "History". Each shows only while its
   * command can run, and the foot only while one does.
   */
  hints?: readonly TermHint[] | undefined;
  /** The term has keyboard focus, where its keys work: the foot's hints show their key chips. */
  keys?: boolean | undefined;
  /**
   * The term has a menu, which its `⋯` opens under itself: the card's own `contextmenu` should open
   * it, as a right-click on the card does.
   */
  menu?: boolean | undefined;
}

/**
 * A term's card, 320 px at every width, on `lo-bg-overlay`. It draws what it's given and takes no
 * focus: none of its controls is a tab stop, and a click on one leaves focus where it was, so a
 * card a key opened stays open. A popup holds it, which places it under the term and spreads its
 * props on it (`render`), as Base UI's preview card does.
 */
export function TermCard({
  term,
  marks,
  definition,
  more = false,
  before,
  byline,
  suggestions,
  hints = [],
  keys = false,
  menu = false,
  className,
  ...card
}: TermCardProps) {
  const name = withoutBidi(term);
  return (
    <div
      // The term's row in the glossary holds the same words, and describes the term.
      aria-hidden="true"
      {...card}
      className={`lo-popover lo-hovercard ${className ?? ''}`}
    >
      <div className="flex items-start gap-8">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-8 gap-y-4">
          <span className="lo-hovercard__term line-clamp-2 min-w-0 wrap-anywhere">{name}</span>
          <TermTags {...marks} />
        </div>
        {menu && (
          <span className="-my-2 flex-none">
            <MoreButton label={`More actions for ${name}`} focusable={false} />
          </span>
        )}
      </div>
      {definition === undefined ? (
        <div className="lo-hovercard__body lo-hovercard__more">In the glossary.</div>
      ) : (
        <div className="lo-hovercard__body">
          {definition}
          {more && <span className="lo-hovercard__more"> More in the glossary.</span>}
        </div>
      )}
      {before !== undefined && <TermBefore>{before}</TermBefore>}
      {byline !== undefined && (
        <div className="mt-8">
          <TermByline {...byline} focusable={false} />
        </div>
      )}
      {suggestions !== undefined && suggestions.count > 0 && (
        <div className="mt-4">
          <LinkButton
            focusable={false}
            onClick={() => runControl(suggestions.command, suggestions.target)}
          >
            {suggestionsCount(suggestions.count)}
          </LinkButton>
        </div>
      )}
      {hints.length > 0 && (
        <div className="lo-hovercard__foot mt-8 border-t border-border pt-8">
          <HintRow className="-mx-8 gap-4">
            {hints.map((hint) => (
              <CardHint key={hint.command} hint={hint} keys={keys} />
            ))}
          </HintRow>
        </div>
      )}
    </div>
  );
}

/** One of the foot's hints, left out while its command can't run: the term's menu says why. */
function CardHint({ hint, keys }: { hint: TermHint; keys: boolean }) {
  const control = useControl(hint.command, hint.target);
  if (control === undefined || control.off !== undefined) return null;
  return (
    <HintButton command={hint.command} target={hint.target} chip={keys} focusable={false}>
      {hint.label}
    </HintButton>
  );
}
