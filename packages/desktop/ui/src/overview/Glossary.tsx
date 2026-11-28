// An overview's Glossary section: a row (`TermRow`) for each term it defines, the terms the pull
// request adds or changes first, by name, then a hairline and the rest, by name. With the repo's
// definitions, each row shows what the overview shows for its term: the repo's definition or the
// overview's own, its tags, and the definition a Changed term replaces; and under the section's
// heading, why the repo's definitions can't be used, where they can't. A row of a term they hold
// expands, by its chevron: who its definition is by, its lock, its other names, its suggestions and
// its earlier definitions. The terms the reader ignores leave the list for the Ignored group at its
// end, a fold that's closed whenever it's drawn.

import { useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import type { Definition, Glossary as GlossaryBlock, Overview, OverviewBlock } from '@lo/artifact';

import { Collapse, Swap } from '../Collapse.tsx';
import { Icon } from '../Icon.tsx';
import { MarkdownBlocks, MarkdownInlines } from '../markdown/index.ts';
import type { TermTarget } from '../commands/targets.ts';
import { TermByline } from './TermByline.tsx';
import { TermRow, type TermDetails } from './TermRow.tsx';
import {
  alphabetical,
  ReachedContext,
  TERM_ATTRIBUTE,
  useGlossary,
  type TermShown,
  type TermShownDetails,
} from './terms.ts';

/** What marks the Glossary section's own box, which holds its rows. */
const GLOSSARY_ATTRIBUTE = 'data-lo-glossary';

/** What marks the row of a term the pull request adds or changes. */
const MARKED_ATTRIBUTE = 'data-lo-marked';

/** What marks the Ignored group, which holds the rows of the terms the reader ignores. */
const IGNORED_ATTRIBUTE = 'data-lo-ignored';

/** What marks the Ignored group's own row, which opens and closes it. */
const IGNORED_FOLD_ATTRIBUTE = 'data-lo-ignored-fold';

/**
 * Every term the overview defines, as a row: those it marks first, then the rest, each by name,
 * whatever order they were written in, and those the reader ignores in the Ignored group at the
 * end. A row comes and goes from the list with the Open move, as its term is ignored or shown
 * again. The row a reader reached from a term in the text is tinted until they move on.
 */
export function Glossary({ node }: { node: GlossaryBlock }) {
  const { glossary, terms } = useGlossary();
  const { target, leave } = useContext(ReachedContext);
  const { marked, rest, ignored } = useMemo(() => {
    const listed = alphabetical(node.terms);
    const tagged = (term: Definition) => terms?.of(term.key)?.marks.mark !== undefined;
    const isIgnored = (term: Definition) => terms?.of(term.key)?.ignored === true;
    const first = listed.filter((term) => tagged(term));
    const others = listed.filter((term) => !tagged(term));
    return {
      marked: first,
      rest: others,
      // In the list's own order: the marked ones keep their tags, and still go first.
      ignored: [...first, ...others].filter((term) => isIgnored(term)),
    };
  }, [node.terms, terms]);
  // The terms ignored as the section was last drawn: one ignored since, in an open group, opens
  // there as its row leaves the list.
  const before = useRef<ReadonlySet<string> | undefined>(undefined);
  useEffect(() => {
    before.current = new Set(ignored.map((own) => own.key));
  }, [ignored]);
  const arrived = (key: string) => before.current !== undefined && !before.current.has(key);

  const commands = terms?.commands;
  const row = (own: Definition, place: 'list' | 'ignored') => {
    const shown = terms?.of(own.key);
    const isMarked = shown?.marks.mark !== undefined;
    const reached = own.key === target && place === 'list';
    // A term the repo's definitions hold expands, in the list: in the Ignored group, "Stop
    // ignoring" takes its chevron's place.
    const expands = place === 'list' && commands !== undefined && shown?.details !== undefined;
    return (
      <TermRow
        {...{
          [TERM_ATTRIBUTE]: own.key,
          [MARKED_ATTRIBUTE]: isMarked && place === 'list' ? '' : undefined,
        }}
        term={own.name}
        marks={shown?.marks}
        definition={
          // The repo's definition, once it's read, fades in over the overview's own.
          <Swap id={shown?.source ?? 'overview'} className="lo-term-row__blocks">
            <MarkdownBlocks<Overview> blocks={shown?.blocks ?? own.children} />
          </Swap>
        }
        before={shown?.before && <Opening blocks={shown.before} />}
        menu={terms?.menu !== undefined}
        expand={expands ? { command: commands.expand, target: rowTarget(own.key) } : undefined}
        expanded={expands && terms?.expanded?.(own.key) === true}
        details={expands && shown.details ? detailsOf(shown, shown.details) : undefined}
        stop
        ignored={place === 'ignored'}
        onStopIgnoring={() => terms?.stopIgnoring?.(own.key)}
        reached={reached}
        // The term in the text goes to its row in the list, which the group's copy doesn't take.
        termId={place === 'list' ? glossary.termId(own.key) : undefined}
        definitionId={place === 'list' ? glossary.definitionId(own.key) : undefined}
        onBlur={reached ? leave : undefined}
      />
    );
  };
  /** A row of the list, there while the reader doesn't ignore its term. */
  const listed = (own: Definition) => (
    <Collapse key={own.key} open={terms?.of(own.key)?.ignored !== true}>
      {row(own, 'list')}
    </Collapse>
  );
  const shownOf = (list: readonly Definition[]) =>
    list.filter((own) => terms?.of(own.key)?.ignored !== true).length;

  const note = terms?.note;
  const noted = note !== undefined && note !== null;
  return (
    <div className="lo-glossary" {...{ [GLOSSARY_ATTRIBUTE]: '' }}>
      {/* It comes and goes as the repo's definitions can't be used, or can again. */}
      <Collapse open={noted}>{noted && <div className="lo-glossary__note">{note}</div>}</Collapse>
      {marked.length > 0 && <div>{marked.map(listed)}</div>}
      {rest.length > 0 && (
        // A hairline between the terms the pull request adds or changes and the rest.
        <div className={shownOf(marked) > 0 && shownOf(rest) > 0 ? 'lo-glossary__rest' : undefined}>
          {rest.map(listed)}
        </div>
      )}
      <Collapse open={ignored.length > 0}>
        {ignored.length > 0 && (
          <IgnoredGroup count={ignored.length}>
            {ignored.map((own) => (
              <Collapse key={own.key} open appear={arrived(own.key)}>
                {row(own, 'ignored')}
              </Collapse>
            ))}
          </IgnoredGroup>
        )}
      </Collapse>
    </div>
  );
}

/**
 * The Ignored group: a fold's row, "Ignored" and how many, which opens and closes the rows of the
 * terms the reader ignores under it. It's closed whenever it's drawn anew.
 */
function IgnoredGroup({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const held = useId();
  return (
    <div className="lo-glossary__ignored" {...{ [IGNORED_ATTRIBUTE]: '' }}>
      <button
        type="button"
        className="lo-glossary__fold move-tint"
        aria-expanded={open}
        aria-controls={open ? held : undefined}
        {...{ [IGNORED_FOLD_ATTRIBUTE]: '' }}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon
          name="chevron-right"
          size={16}
          className={`text-fg-subtle transition-transform ease-out ${open ? 'rotate-90' : ''}`}
        />
        <span>Ignored</span>
        <span className="lo-count lo-num text-fg-muted text-micro">
          {count.toLocaleString('en-US')}
        </span>
      </button>
      <Collapse open={open}>
        <div id={held}>{children}</div>
      </Collapse>
    </div>
  );
}

/** The term `key` names, as its row's controls act on it. */
function rowTarget(key: string): TermTarget {
  return { kind: 'term', term: key, row: true };
}

/**
 * What the row of a term the repo's definitions hold shows expanded: who its definition is by, its
 * lock, its other names, its suggestions and its earlier definitions, each with who it's by.
 */
function detailsOf(shown: TermShown, details: TermShownDetails): TermDetails {
  return {
    byline: shown.byline && <TermByline {...shown.byline} />,
    locked: details.locked,
    aliases: details.aliases,
    suggestions: details.suggestions.map((suggestion) => ({
      key: suggestion.key,
      definition: <Opening blocks={suggestion.blocks} />,
      byline: <TermByline {...suggestion.byline} />,
    })),
    earlier: details.earlier.map((earlier) => ({
      key: earlier.key,
      definition: <Opening blocks={earlier.blocks} />,
      byline: <TermByline {...earlier.byline} />,
    })),
    capped: details.capped,
  };
}

/** A definition the repo's definitions hold, one paragraph, as words that run on from a tag. */
function Opening({ blocks }: { blocks: readonly OverviewBlock[] }) {
  const [first] = blocks;
  return first?.kind === 'paragraph' ? <MarkdownInlines<Overview> nodes={first.children} /> : null;
}

/** Where an overview's Glossary section is drawn in `article`, its heading and its rows. */
export interface GlossaryParts {
  /** The section's own box, which holds its rows. */
  readonly box: HTMLElement;
  /** Its heading: the last of the article's second-level headings before its box. */
  readonly heading: HTMLElement | undefined;
  /**
   * Its first row: the first term the pull request adds or changes, else its first term, of those
   * the reader doesn't ignore; with none, the Ignored group's row, which holds them.
   */
  readonly first: HTMLElement | undefined;
  /** That row's term, or the Ignored group's row, which a jump to the row focuses. */
  readonly term: HTMLElement | undefined;
}

/** Whether `row`, in a Glossary section, is in its list now: not ignored, nor on its way out. */
function inList(row: Element): boolean {
  return row.closest(`[${IGNORED_ATTRIBUTE}], [data-closed]`) === null;
}

/**
 * The row of the term `key` names in `box`, a Glossary section's, in its list: not in the Ignored
 * group, nor on its way out of the list.
 */
export function termRowIn(box: Element, key: string): HTMLElement | undefined {
  return [...box.querySelectorAll<HTMLElement>('[data-lo-term-row]')].find(
    (row) => row.getAttribute(TERM_ATTRIBUTE) === key && inList(row),
  );
}

/** The Glossary section drawn in `article`, an overview's, if it has one. */
export function glossaryIn(article: Element): GlossaryParts | undefined {
  const box = article.querySelector<HTMLElement>(`[${GLOSSARY_ATTRIBUTE}]`);
  if (!box) return undefined;
  const headings = [...article.querySelectorAll<HTMLElement>('h2')].filter(
    (heading) => (heading.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
  const rows = [...box.querySelectorAll<HTMLElement>('[data-lo-term-row]')].filter(inList);
  const row = rows.find((each) => each.hasAttribute(MARKED_ATTRIBUTE)) ?? rows[0];
  const fold = box.querySelector<HTMLElement>(`[${IGNORED_FOLD_ATTRIBUTE}]`) ?? undefined;
  const term = row?.querySelector<HTMLElement>('.lo-term-row__term') ?? undefined;
  return { box, heading: headings.at(-1), first: row ?? fold, term: term ?? fold };
}
