/**
 * How code, figures and walkthroughs show until their views are given to the document: what they
 * point at and their own words, with nothing read from the repository or the overview's commit.
 */

import type { Excerpt, Figure, Lines, Overview, Walkthrough } from '@lo/artifact';

import { MarkdownBlocks } from '../markdown/index.ts';

/** A range of lines as the code block's head writes it: `L12`, or `L12–44`. */
export function lineRange({ start, end }: Lines): string {
  return start === end ? `L${start}` : `L${start}–${end}`;
}

/** A code block's head: the file, its name set apart, and the lines. */
export function ExcerptHead({ node }: { node: Excerpt }) {
  const { path, lines } = node.target;
  const slash = path.lastIndexOf('/');
  return (
    <div className="lo-codeblock">
      <div className="lo-codeblock__head">
        <span className="lo-codeblock__path">
          {path.slice(0, slash + 1)}
          <b>{path.slice(slash + 1)}</b>
        </span>
        <span className="lo-codeblock__lines">{lineRange(lines)}</span>
      </div>
    </div>
  );
}

/** A figure's caption. */
export function FigureCaption({ node }: { node: Figure }) {
  return (
    <figure className="lo-figure">
      <figcaption>
        <MarkdownBlocks<Overview> blocks={node.caption} />
      </figcaption>
    </figure>
  );
}

/** A walkthrough's title and its steps' words. */
export function WalkthroughSteps({ node }: { node: Walkthrough }) {
  return (
    <div className="lo-walk">
      <div className="lo-walk__head">
        <span className="lo-walk__title">{node.title}</span>
      </div>
      <ol className="lo-walk__steps">
        {node.steps.map((step, index) => (
          <li key={index} className="lo-walk__step">
            <div className="min-w-0 space-y-6">
              <MarkdownBlocks<Overview> blocks={step.children} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
