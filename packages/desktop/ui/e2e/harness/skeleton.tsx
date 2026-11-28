// The page the skeleton spec drives: an overview, its code waiting as a code block's does while the
// local copy comes, and the overview's skeleton, each in a middle view's box of its own, as wide as
// the spec says, and where each one's pieces are.

import { createRoot } from 'react-dom/client';

import { parseArtifact } from '@lo/artifact';

import {
  CodeBlock,
  CodeBody,
  CodeSkeleton,
  OverviewDocument,
  OverviewSkeleton,
} from '../../src/overview/index.ts';

const ARTIFACT = [
  '---',
  'format: 1',
  'pr: 1',
  'commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87',
  '---',
  '',
  '## tl;dr',
  '',
  'The parser moves to its own module and splits on either line ending, so a file saved on Windows reads as the same lines.',
  '',
  '## How it works',
  '',
  'The parser now splits on either line ending:',
  '',
  ':::code src/parser.ts#L1-L5',
  ':::',
  '',
  'The formatter takes its line from the new path.',
  '',
  '## Where to look',
  '',
  'The split itself.',
  '',
].join('\n');

/** Each box: a middle view's, which the spec sizes, cutting off what's past its foot. */
const BOX = 'middle-view overflow-hidden';

/** A box on the page, from its view's top left. */
interface Place {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where `element` is from `box`'s top left, unless it isn't drawn. */
function place(box: Element, element: Element | null | undefined): Place | undefined {
  if (!element || element.getClientRects().length === 0) return undefined;
  const from = box.getBoundingClientRect();
  const at = element.getBoundingClientRect();
  return { x: at.x - from.x, y: at.y - from.y, width: at.width, height: at.height };
}

/** Each line of `block`'s code still to come: its height, and its bar's middle from its top. */
function lines(block: Element | null) {
  return [...(block?.querySelectorAll('.lo-codeblock__skeleton .cm-line') ?? [])].map((line) => {
    const row = line.getBoundingClientRect();
    const bar = line.querySelector('.skeleton')!.getBoundingClientRect();
    return { height: row.height, middle: bar.y + bar.height / 2 - row.y };
  });
}

/** Where the overview's pieces are in its view. */
function overviewPlaces(view: HTMLElement) {
  const of = (element: Element | null | undefined) => place(view, element);
  const article = view.querySelector('.lo-ov__article')!;
  const headings = article.querySelectorAll('h2');
  const paragraphs = article.querySelectorAll('p');
  const code = article.querySelector('.lo-codeblock');
  const lead = article.querySelector('.lo-lead');
  return {
    label: of(view.querySelector('.lo-toc__label')),
    section: of(view.querySelector('.lo-toc__item')),
    byline: of(article.querySelector('.lo-ov-byline')),
    headings: [of(headings[0]), of(headings[1])],
    lead: of(lead),
    leadLine: lead ? parseFloat(getComputedStyle(lead).lineHeight) : undefined,
    paragraph: of(paragraphs[1]),
    code: of(code),
    after: of(paragraphs[2]),
    lines: lines(code),
  };
}

/** Where the skeleton's pieces are in its view, as the overview's are. */
function skeletonPlaces(view: HTMLElement): ReturnType<typeof overviewPlaces> {
  const of = (element: Element | null | undefined) => place(view, element);
  const headings = view.querySelectorAll('.lo-ov-skeleton__heading');
  const block = view.querySelector('.lo-ov-skeleton__article > .lo-codeblock');
  return {
    label: of(view.querySelector('.lo-ov-skeleton__label')),
    section: of(view.querySelector('.lo-ov-skeleton__item')),
    byline: of(view.querySelector('.lo-ov-skeleton__byline')),
    headings: [of(headings[0]), of(headings[1])],
    lead: of(headings[0]?.nextElementSibling),
    leadLine: of(headings[0]?.nextElementSibling?.firstElementChild)?.height,
    paragraph: of(headings[1]?.nextElementSibling),
    code: of(block),
    after: of(block?.nextElementSibling),
    lines: lines(block),
  };
}

const skeleton = {
  /**
   * Where the overview's pieces are, and the skeleton's, each from its view's top left, once both
   * views are `width` wide: the outline's label and first section, the byline, the first two
   * headings, the tl;dr's paragraph and its line's height, the paragraph after the second heading,
   * the first code block and the paragraph after it, and the code block's lines.
   */
  async places(width: number) {
    const overview = document.getElementById('overview')!;
    const view = document.getElementById('skeleton')!;
    for (const box of [overview, view]) {
      box.style.width = `${width}px`;
      box.style.height = '900px';
    }
    await window.waits.frames(`the overview and its skeleton laid out ${width} px wide`, 3);
    return { overview: overviewPlaces(overview), skeleton: skeletonPlaces(view) };
  },
};

Object.assign(window, { skeleton });

declare global {
  interface Window {
    /** What the skeleton's spec measures the page with. */
    skeleton: typeof skeleton;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('The page has no root.');
createRoot(root).render(
  <>
    <div id="overview" className={BOX}>
      <OverviewDocument
        tree={parseArtifact(ARTIFACT).tree}
        byline={
          <div className="lo-ov-bylines">
            <div className="lo-ov-byline">
              <span className="size-20" />
              rozed-bot
            </div>
          </div>
        }
        views={{
          excerpt: (node) => (
            <CodeBlock target={node.target}>
              <CodeBody rows={5}>
                <CodeSkeleton rows={5} />
              </CodeBody>
            </CodeBlock>
          ),
        }}
      />
    </div>
    <div id="skeleton" className={BOX}>
      <OverviewSkeleton />
    </div>
  </>,
);
