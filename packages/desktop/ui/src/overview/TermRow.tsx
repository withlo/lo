// A term as a glossary lists it, wherever one does: an overview's Glossary section and the repo's
// glossary. Three columns: the term with its tags under it, its definition (and the one a Changed
// term replaces), and the row's end controls, its `⋯` and the chevron that expands it. Expanded, the
// definition's column goes on with who it's by, its lock, the other names it goes by, the
// suggestions waiting on it and its earlier definitions. In its own box under 420 px wide it's one
// column: the term and its tags, the end controls on the term's line, then the definition.

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';

import { Button } from '../Button.tsx';
import { Collapse } from '../Collapse.tsx';
import { runControl } from '../commands/control.ts';
import { CommandButton } from '../CommandButton.tsx';
import { withoutBidi } from '../controls.ts';
import { EmptyState } from '../EmptyState.tsx';
import { UNFOCUSABLE } from '../focus.ts';
import { LinkButton } from '../LinkButton.tsx';
import { MoreButton } from '../MoreButton.tsx';
import { Chevron } from './Chevron.tsx';
import type { TermHint } from './TermCard.tsx';
import { TermBefore, TermTags, type TermMarks } from './TermTags.tsx';

/** How many of a term's earlier definitions show before "Show 12 more". */
export const EARLIER_SHOWN = 5;

/** A definition a merged pull request offered for a locked term. */
export interface TermSuggestion {
  /** What tells it from the term's other suggestions. */
  key: string;
  /** Its definition, as the caller draws it. */
  definition: ReactNode;
  /** Who offered it: a `TermByline`. */
  byline: ReactNode;
  /** "Accept": the command that makes it the term's definition, on this suggestion. */
  accept?: Pick<TermHint, 'command' | 'target'> | undefined;
  /** "Dismiss": the command that drops it, on this suggestion. */
  dismiss?: Pick<TermHint, 'command' | 'target'> | undefined;
  /** Accept or Dismiss is at work on it, until the store shows it: "Accepting…", "Dismissing…". */
  busy?: 'accept' | 'dismiss' | undefined;
}

/** One of a term's earlier definitions, which an edit, an accepted suggestion or a merge replaced. */
export interface TermEarlier {
  /** What tells it from the term's other earlier definitions. */
  key: string;
  /** The definition, as the caller draws it. */
  definition: ReactNode;
  /** Who it was by: a `TermByline`. */
  byline: ReactNode;
}

/** What a term's row holds expanded, from the store. */
export interface TermDetails {
  /** Who its definition is by: a `TermByline`. */
  byline?: ReactNode;
  /** Who locked it, by login, and when, as Lo writes a time past: "Locked by elle-kzn · 2 d ago". */
  locked?: { by: string; when: string } | undefined;
  /** The other names it goes by: "Also written as buckets, token bucket". */
  aliases?: readonly string[] | undefined;
  /** What merged pull requests offered for it, a locked term: oldest first. */
  suggestions?: readonly TermSuggestion[] | undefined;
  /** Its earlier definitions, newest first. */
  earlier: readonly TermEarlier[];
  /** The store keeps no more of its earlier definitions than these: "Earlier changes aren’t listed." */
  capped?: boolean | undefined;
}

export interface TermRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  /** The term, as its definition names it: "bucket". */
  term: string;
  /** Its tags, under it: New or Changed, Locked, and its suggestions. */
  marks?: TermMarks | undefined;
  /** Its definition, as the caller draws it: an overview's own may be several blocks. */
  definition: ReactNode;
  /** On a Changed term, the definition it replaces, under the "Before" tag. */
  before?: ReactNode;
  /** It has a menu, which its `⋯` opens under itself, as a right-click on the row does. */
  menu?: boolean | undefined;
  /**
   * The command its chevron runs, Expand term and then Collapse term, on the term: on a term the
   * store holds. Without it, no chevron, and the room it takes is kept.
   */
  expand?: Pick<TermHint, 'command' | 'target'> | undefined;
  /** It's expanded: what `details` holds shows under its definition. */
  expanded?: boolean | undefined;
  /** What it holds expanded. */
  details?: TermDetails | undefined;
  /** What went wrong with what was asked of it, under the row: an inline `Problem`. */
  problem?: ReactNode;
  /**
   * It's in the Ignored group, in `lo-fg-muted`, with "Stop ignoring" in its chevron's place, which
   * calls `onStopIgnoring`.
   */
  ignored?: boolean | undefined;
  onStopIgnoring?: (() => void) | undefined;
  /** Its term is a stop for `Tab`, as in an overview's Glossary section. */
  stop?: boolean | undefined;
  /** The row the keyboard is on, in a list that holds focus itself: the row's chips show. */
  focused?: boolean | undefined;
  /** The row the reader went to from the term in the text, tinted until they move on. */
  reached?: boolean | undefined;
  /** Its term's id, which the term in the text is described by and goes to. */
  termId?: string | undefined;
  /** Its definition's id, which the term in the text is described by. */
  definitionId?: string | undefined;
  /** Its term, the element a `Tab` stops at and a jump to the row focuses. */
  termRef?: Ref<HTMLSpanElement> | undefined;
}

/**
 * A term's row in a glossary. It draws what it's given. Its end controls show on the row under the
 * pointer or with focus, and keep their room otherwise; neither is a stop for `Tab`, since the
 * term's own keys do what they do: `⏎` expands, `Menu` opens its menu. So the term is a button that
 * says whether the row is expanded, which a click on it expands and collapses as its chevron does,
 * and focus in what the row holds expanded goes back to it as the row collapses.
 */
export function TermRow({
  term,
  marks,
  definition,
  before,
  menu = false,
  expand,
  expanded = false,
  details,
  problem,
  ignored = false,
  onStopIgnoring,
  stop = false,
  focused = false,
  reached = false,
  termId,
  definitionId,
  termRef,
  className,
  ...row
}: TermRowProps) {
  const held = useId();
  const name = withoutBidi(term);
  const open = expanded && details !== undefined;
  const own = useRef<HTMLSpanElement | null>(null);
  const shown = useRef<HTMLDivElement>(null);
  // The term is the caller's too, as `termRef`.
  const termElement = useCallback(
    (element: HTMLSpanElement | null) => {
      own.current = element;
      if (typeof termRef === 'function') termRef(element);
      else if (termRef) termRef.current = element;
    },
    [termRef],
  );
  // What's leaving takes no focus: focus in it would fall out of the page, so it goes to the term.
  useLayoutEffect(() => {
    if (open) return;
    const box = shown.current;
    if (box?.contains(box.ownerDocument.activeElement) === true) own.current?.focus();
  }, [open]);
  const tags = <TermTags {...marks} />;
  const tagged =
    marks !== undefined &&
    (marks.mark !== undefined || marks.locked === true || (marks.suggestions ?? 0) > 0);
  return (
    <div
      {...row}
      data-key-scope=""
      data-focused={focused ? '' : undefined}
      data-lo-term-row=""
      className={`lo-term-row group/row ${className ?? ''}`}
    >
      <div
        className={[
          'lo-term-row__grid',
          ignored ? 'is-ignored' : '',
          reached ? 'is-target' : '',
          focused ? 'group-focus-visible/list:shadow-ring-inset' : '',
        ].join(' ')}
      >
        <div className="lo-term-row__head">
          <span
            ref={termElement}
            id={termId}
            tabIndex={stop ? 0 : -1}
            // What `Tab` goes between in an overview's block (`linksIn`).
            data-lo-stop={stop ? '' : undefined}
            // `⏎` on it expands the row, as its chevron does.
            role={expand === undefined ? undefined : 'button'}
            aria-expanded={expand === undefined ? undefined : expanded}
            aria-controls={expand !== undefined && open ? held : undefined}
            className="lo-term-row__term"
            // A click does what its chevron does, as a button's does, but for one that ends a
            // drag selecting its words.
            onClick={
              expand === undefined
                ? undefined
                : (event) => {
                    if (selecting(event.currentTarget)) return;
                    runControl(expand.command, expand.target);
                  }
            }
          >
            {name}
          </span>
          {tagged && <div className="flex flex-wrap gap-6">{tags}</div>}
        </div>
        <div id={definitionId} className="lo-term-row__definition">
          {definition}
          {before !== undefined && <TermBefore>{before}</TermBefore>}
          <Collapse open={open}>
            {details !== undefined && <Details id={held} details={details} box={shown} />}
          </Collapse>
        </div>
        <div className="lo-term-row__end invisible group-focus-within/row:visible group-hover/row:visible group-data-focused/row:visible">
          {menu && <MoreButton label={`More actions for ${name}`} focusable={false} />}
          {ignored ? (
            <Button variant="ghost" size="sm" {...UNFOCUSABLE} onClick={onStopIgnoring}>
              Stop ignoring
            </Button>
          ) : (
            expand !== undefined && (
              <Chevron
                command={expand}
                open={expanded}
                controls={open ? held : undefined}
                focusable={false}
              />
            )
          )}
        </div>
        <Collapse open={problem !== undefined && problem !== null} className="lo-term-row__problem">
          {problem !== undefined && problem !== null && <div className="pt-8">{problem}</div>}
        </Collapse>
      </div>
    </div>
  );
}

/** Whether words in `element` are selected, as a drag across them ends. */
function selecting(element: Element): boolean {
  const selection = element.ownerDocument.getSelection();
  return (
    selection !== null &&
    !selection.isCollapsed &&
    selection.rangeCount > 0 &&
    element.contains(selection.getRangeAt(0).commonAncestorContainer)
  );
}

/** What a term's row holds expanded, `lo-sp-8` apart, under its definition. */
function Details({
  id,
  details,
  box,
}: {
  id: string;
  details: TermDetails;
  box: Ref<HTMLDivElement>;
}) {
  const { byline, locked, aliases = [], suggestions = [], earlier, capped = false } = details;
  return (
    <div ref={box} id={id} className="flex flex-col gap-8 pt-8">
      {byline}
      {locked !== undefined && (
        <div className="text-fg-muted text-small">
          Locked by {withoutBidi(locked.by)} · <span className="lo-num">{locked.when}</span>
        </div>
      )}
      {aliases.length > 0 && (
        <div className="text-fg-muted text-small">
          Also written as {aliases.map((alias) => withoutBidi(alias)).join(', ')}
        </div>
      )}
      {suggestions.length > 0 && (
        <Part label="Suggestions">
          {suggestions.map((suggestion) => (
            <Suggested key={suggestion.key} suggestion={suggestion} />
          ))}
        </Part>
      )}
      <Earlier earlier={earlier} capped={capped} />
    </div>
  );
}

/** A labelled part of what a row holds expanded: Suggestions, History. */
function Part({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-8">
      <div id={id} className="label-caps text-fg-muted text-label">
        {label}
      </div>
      {children}
    </div>
  );
}

/** A suggestion: its definition and byline, with Accept and Dismiss at its end. */
function Suggested({ suggestion }: { suggestion: TermSuggestion }) {
  const { definition, byline, accept, dismiss, busy } = suggestion;
  return (
    <div className="flex items-start gap-8">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="text-fg read-comment">{definition}</div>
        {byline}
      </div>
      <div className="flex flex-none items-start gap-4">
        {accept !== undefined && (
          <CommandButton
            size="sm"
            command={accept.command}
            target={accept.target}
            busy={busy === 'accept'}
            working="Accepting…"
          >
            Accept
          </CommandButton>
        )}
        {dismiss !== undefined && (
          <CommandButton
            size="sm"
            command={dismiss.command}
            target={dismiss.target}
            busy={busy === 'dismiss'}
            working="Dismissing…"
          >
            Dismiss
          </CommandButton>
        )}
      </div>
    </div>
  );
}

/**
 * A term's earlier definitions: five, then the rest on asking, or none. "Show 12 more" goes once
 * it's pressed, and focus goes on to the first of the rest, where reading goes on.
 */
function Earlier({ earlier, capped }: { earlier: readonly TermEarlier[]; capped: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? earlier : earlier.slice(0, EARLIER_SHOWN);
  const rest = earlier.length - shown.length;
  const firstOfRest = useRef<HTMLDivElement>(null);
  const handOn = useRef(false);
  useLayoutEffect(() => {
    if (!handOn.current) return;
    handOn.current = false;
    firstOfRest.current?.focus();
  }, [all]);
  return (
    <Part label="History">
      {earlier.length === 0 ? (
        <EmptyState fit="row" icon="history" title="No earlier definitions" />
      ) : (
        shown.map((entry, at) => {
          const first = all && at === EARLIER_SHOWN;
          return (
            <div
              key={entry.key}
              ref={first ? firstOfRest : undefined}
              tabIndex={first ? -1 : undefined}
              className="flex min-w-0 flex-col gap-4 rounded-xs"
            >
              <div className="text-fg-muted read-comment">{entry.definition}</div>
              {entry.byline}
            </div>
          );
        })
      )}
      {rest > 0 && (
        <div>
          <LinkButton
            onClick={() => {
              handOn.current = true;
              setAll(true);
            }}
          >{`Show ${rest.toLocaleString('en-US')} more`}</LinkButton>
        </div>
      )}
      {rest === 0 && capped && (
        <div className="text-fg-subtle text-small">Earlier changes aren’t listed.</div>
      )}
    </Part>
  );
}
