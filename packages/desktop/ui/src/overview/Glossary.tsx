// An overview's Glossary section: a row (`TermRow`) for each term it defines, the terms the pull
// request adds or changes first, by name, then a hairline and the rest, by name. With the repo's
// definitions, each row shows what the overview shows for its term: the repo's definition or the
// overview's own, its tags, and the definition a Changed term replaces; and under the section's
// heading, why the repo's definitions can't be used, where they can't.

import { useContext, useMemo } from 'react';

import type { Definition, Glossary as GlossaryBlock, Overview, OverviewBlock } from '@lo/artifact';

import { Collapse, Swap } from '../Collapse.tsx';
import { MarkdownBlocks, MarkdownInlines } from '../markdown/index.ts';
import { TermRow } from './TermRow.tsx';
import { alphabetical, ReachedContext, useGlossary } from './terms.ts';

/** What marks the Glossary section's own box, which holds its rows. */
const GLOSSARY_ATTRIBUTE = 'data-lo-glossary';

/** What marks the row of a term the pull request adds or changes. */
const MARKED_ATTRIBUTE = 'data-lo-marked';

/**
 * Every term the overview defines, as a row: those it marks first, then the rest, each by name,
 * whatever order they were written in. The row a reader reached from a term in the text is tinted
 * until they move on.
 */
export function Glossary({ node }: { node: GlossaryBlock }) {
  const { glossary, terms } = useGlossary();
  const { target, leave } = useContext(ReachedContext);
  const { marked, rest } = useMemo(() => {
    const listed = alphabetical(node.terms);
    const tagged = (term: Definition) => terms?.of(term.key)?.marks.mark !== undefined;
    return {
      marked: listed.filter((term) => tagged(term)),
      rest: listed.filter((term) => !tagged(term)),
    };
  }, [node.terms, terms]);

  const row = (own: Definition, isMarked: boolean) => {
    const shown = terms?.of(own.key);
    const reached = own.key === target;
    return (
      <TermRow
        key={own.key}
        {...{ [MARKED_ATTRIBUTE]: isMarked ? '' : undefined }}
        term={own.name}
        marks={shown?.marks}
        definition={
          // The repo's definition, once it's read, fades in over the overview's own.
          <Swap id={shown?.source ?? 'overview'} className="lo-term-row__blocks">
            <MarkdownBlocks<Overview> blocks={shown?.blocks ?? own.children} />
          </Swap>
        }
        before={shown?.before && <Opening blocks={shown.before} />}
        reached={reached}
        termId={glossary.termId(own.key)}
        definitionId={glossary.definitionId(own.key)}
        onBlur={reached ? leave : undefined}
      />
    );
  };

  const note = terms?.note;
  const noted = note !== undefined && note !== null;
  return (
    <div className="lo-glossary" {...{ [GLOSSARY_ATTRIBUTE]: '' }}>
      {/* It comes and goes as the repo's definitions can't be used, or can again. */}
      <Collapse open={noted}>{noted && <div className="lo-glossary__note">{note}</div>}</Collapse>
      {marked.length > 0 && <div>{marked.map((own) => row(own, true))}</div>}
      {rest.length > 0 && (
        // A hairline between the terms the pull request adds or changes and the rest.
        <div className={marked.length > 0 ? 'lo-glossary__rest' : undefined}>
          {rest.map((own) => row(own, false))}
        </div>
      )}
    </div>
  );
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
  /** Its first row: the first term the pull request adds or changes, else its first term. */
  readonly first: HTMLElement | undefined;
  /** That row's term, which a jump to the row focuses. */
  readonly term: HTMLElement | undefined;
}

/** The Glossary section drawn in `article`, an overview's, if it has one. */
export function glossaryIn(article: Element): GlossaryParts | undefined {
  const box = article.querySelector<HTMLElement>(`[${GLOSSARY_ATTRIBUTE}]`);
  if (!box) return undefined;
  const headings = [...article.querySelectorAll<HTMLElement>('h2')].filter(
    (heading) => (heading.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
  const first =
    box.querySelector<HTMLElement>(`[data-lo-term-row][${MARKED_ATTRIBUTE}]`) ??
    box.querySelector<HTMLElement>('[data-lo-term-row]') ??
    undefined;
  const term = first?.querySelector<HTMLElement>('.lo-term-row__term') ?? undefined;
  return { box, heading: headings.at(-1), first, term };
}
