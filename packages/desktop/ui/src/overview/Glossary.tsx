import { Fragment, useMemo } from 'react';

import type { Glossary as GlossaryBlock, Overview } from '@lo/artifact';

import { MarkdownBlocks } from '../markdown/index.ts';
import { alphabetical, useGlossary } from './terms.ts';

/**
 * Every defined term and its definition, in alphabetical order, whatever order they were written
 * in. The entry a reader reached from a term in the text is marked until they move on.
 */
export function Glossary({ node }: { node: GlossaryBlock }) {
  const { glossary, target, leave } = useGlossary();
  const terms = useMemo(() => alphabetical(node.terms), [node.terms]);
  return (
    <dl className="lo-glossary">
      {terms.map((term, index) => {
        const reached = term.key === target ? 'is-target' : undefined;
        return (
          <Fragment key={index}>
            <dt
              id={glossary.termId(term.key)}
              tabIndex={-1}
              className={reached}
              onBlur={reached ? leave : undefined}
            >
              {term.name}
            </dt>
            <dd id={glossary.definitionId(term.key)} className={reached}>
              <MarkdownBlocks<Overview> blocks={term.children} />
            </dd>
          </Fragment>
        );
      })}
    </dl>
  );
}
