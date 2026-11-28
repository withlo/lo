/**
 * The overview as it lays out while it's read: the outline beside the article, the article at
 * reading measure, with bars where the words will be.
 */

import { Skeleton } from '../Spinner.tsx';
import { CodeSkeleton } from './CodeBlock.tsx';

/** One of the article's pieces while it's read, by the widths of its bars. */
type Piece =
  | { readonly kind: 'heading'; readonly width: string }
  | { readonly kind: 'lead' | 'text'; readonly lines: readonly string[] }
  | { readonly kind: 'code'; readonly path: string; readonly rows: number };

/**
 * The article's pieces: the tl;dr's heading and its paragraph, set larger, then sections of
 * paragraphs and code blocks, as many as fill the view in a window of the usual height.
 */
const ARTICLE: readonly Piece[] = [
  { kind: 'heading', width: 'w-1/12' },
  { kind: 'lead', lines: ['w-full', 'w-full', 'w-2/5'] },
  { kind: 'heading', width: 'w-1/4' },
  { kind: 'text', lines: ['w-full', 'w-3/5'] },
  { kind: 'code', path: 'w-1/4', rows: 5 },
  { kind: 'text', lines: ['w-full', 'w-1/3'] },
  { kind: 'heading', width: 'w-1/5' },
  { kind: 'text', lines: ['w-full', 'w-full', 'w-1/2'] },
  { kind: 'code', path: 'w-1/3', rows: 3 },
  { kind: 'text', lines: ['w-full', 'w-2/5'] },
  { kind: 'heading', width: 'w-1/3' },
  { kind: 'text', lines: ['w-full', 'w-full', 'w-3/5'] },
];

/** The outline's sections, by the widths of their bars. */
const SECTIONS: readonly string[] = ['w-1/5', 'w-1/2', 'w-2/5', 'w-3/4', 'w-1/3'];

/** A line of text's place: a bar in the middle of its line's height. */
function Line({ width }: { width: string }) {
  return (
    <div className="flex h-1lh items-center">
      <Skeleton className={width} />
    </div>
  );
}

/** A piece of the article's place, at its height. */
function PieceSkeleton({ piece }: { piece: Piece }) {
  switch (piece.kind) {
    case 'heading':
      return (
        <div className="lo-ov-skeleton__heading flex h-1lh items-center read-h2">
          <Skeleton className={`h-12 ${piece.width}`} />
        </div>
      );
    case 'lead':
    case 'text':
      return (
        <div
          className={`lo-ov-skeleton__text ${piece.kind === 'lead' ? 'read-lead' : 'read-body'}`}
        >
          {piece.lines.map((width, line) => (
            // By its place: the lines are fixed, and their widths repeat.
            <Line key={line} width={width} />
          ))}
        </div>
      );
    case 'code':
      return (
        <div className="lo-codeblock">
          <div className="lo-codeblock__head">
            <Skeleton className={piece.path} />
          </div>
          <div className="lo-codeblock__body">
            <CodeSkeleton rows={piece.rows} />
          </div>
        </div>
      );
    default:
      piece satisfies never;
      throw new Error(`A piece of an overview Lo doesn’t know: ${JSON.stringify(piece)}.`);
  }
}

/**
 * The overview as it lays out while it's read, where `OverviewDocument` will draw it: the outline
 * of its sections beside the article, which holds its byline, the tl;dr's heading and paragraph,
 * and sections of paragraphs and code blocks, each at its height and inset, with bars where the
 * words will be. It's as tall as fills the view in a window of the usual height, for the view to
 * cut off at its foot. The overview takes its place in one Swap. Put it in `Skeletons`, which says
 * what's read.
 */
export function OverviewSkeleton() {
  return (
    <div className="lo-ov-skeleton">
      <div className="lo-ov-skeleton__toc">
        <div className="lo-ov-skeleton__label">
          <Line width="w-1/3" />
        </div>
        {SECTIONS.map((width, section) => (
          <div key={section} className="lo-ov-skeleton__item">
            <Skeleton className={width} />
          </div>
        ))}
        {/* Its buttons that move between blocks, their words inset as theirs are. */}
        <div className="lo-ov-skeleton__foot">
          <div className="flex h-control-h-sm items-center px-8">
            <Skeleton className="w-1/3" />
          </div>
          <div className="flex h-control-h-sm items-center px-8">
            <Skeleton className="w-1/2" />
          </div>
        </div>
      </div>
      <div className="lo-ov-skeleton__article">
        <div className="lo-ov-skeleton__byline">
          <span className="size-20 flex-none rounded-pill bg-hover" />
          <Skeleton className="w-1/4" />
        </div>
        {ARTICLE.map((piece, at) => (
          <PieceSkeleton key={at} piece={piece} />
        ))}
      </div>
    </div>
  );
}
