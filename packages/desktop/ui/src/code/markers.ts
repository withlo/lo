// Overview markers, in a gutter of their own before the line numbers: a ball on the first line a
// block of the pull request's overview explains, and a rail down the rest. The gutter is there from
// the start, as wide with no markers as with them, so markers that arrive later change no line's
// width or height, and nothing on screen moves. Unchanged lines collapsed into one block carry the
// rail where it passes through them, and the ball where a marked range starts among them. The rail
// runs on past what's drawn between a range's lines, such as spacers, threads and, inline, the
// other side's lines: each sits half a line from the lines around it.

import type { Extension } from '@codemirror/state';
import { type BlockInfo, type EditorView, gutter, GutterMarker } from '@codemirror/view';

import { marksChanged } from './marks.ts';
import { CollapsedWidget, FileNoteWidget, HeaderWidget } from './widgets.ts';

/** Lines `from` to `to` of one side of a file that a marker covers, and its note's key. */
export interface MarkedLines {
  readonly from: number;
  readonly to: number;
  readonly key: string;
}

/**
 * The marked ranges on one side of a file, and the lines of it that a line or block shows: half a
 * line from a line for what's drawn next to it, such as 4.5 between lines 4 and 5.
 */
export interface MarkedSpan {
  readonly ranges: readonly MarkedLines[];
  readonly first: number;
  readonly last: number;
}

/** What a ball says, on hover and to a screen reader. */
export const BALL_TITLE = 'Explained in the overview';

/**
 * The gutter beside a line, or a collapsed block: the rail, its ends where no range goes on past
 * the line, and the ball where a range starts, ringed brighter while its note is open.
 */
export class OverviewMarker extends GutterMarker {
  readonly first: boolean;
  readonly last: boolean;
  readonly ball: boolean;
  readonly open: boolean;
  override readonly elementClass: string;

  constructor(first: boolean, last: boolean, ball: boolean, open: boolean) {
    super();
    this.first = first;
    this.last = last;
    this.ball = ball;
    this.open = open;
    this.elementClass = `lo-ovgutter lo-ov-range${first ? ' is-first' : ''}${last ? ' is-last' : ''}`;
  }

  override eq(other: OverviewMarker): boolean {
    return (
      other.first === this.first &&
      other.last === this.last &&
      other.ball === this.ball &&
      other.open === this.open
    );
  }

  override toDOM(): Node {
    if (!this.ball) return document.createTextNode('');
    const ball = document.createElement('span');
    ball.className = `lo-ov-marker${this.open ? ' is-open' : ''}`;
    ball.title = BALL_TITLE;
    ball.setAttribute('aria-label', BALL_TITLE);
    return ball;
  }
}

/**
 * The marker for what a line or a collapsed block shows, from the ranges marked on each side of it:
 * none where no range covers it.
 */
export function markerOf(
  spans: readonly MarkedSpan[],
  open: (key: string) => boolean,
): OverviewMarker | null {
  let covered = false;
  let ball = false;
  let opened = false;
  let before = false;
  let after = false;
  for (const { ranges, first, last } of spans) {
    for (const range of ranges) {
      if (range.to < first || range.from > last) continue;
      covered = true;
      if (range.from >= first) {
        ball = true;
        opened ||= open(range.key);
      } else {
        before = true;
      }
      if (range.to > last) after = true;
    }
  }
  return covered ? new OverviewMarker(!before, !after, ball, opened) : null;
}

/** The keys of the ranges that start among what a line or block shows: those its ball opens. */
export function startingIn(spans: readonly MarkedSpan[]): string[] {
  return spans.flatMap(({ ranges, first, last }) =>
    ranges.filter((range) => range.from >= first && range.from <= last).map(({ key }) => key),
  );
}

/** Where an editor's markers come from, by its document lines. */
export interface MarkerSource {
  /** Whether there are any marks: without them, the gutter asks no more. */
  active(): boolean;
  /** The marker for document lines `first` to `last`: one line, or those a collapsed block holds. */
  markerAt(first: number, last: number): GutterMarker | null;
  /** The marker beside a block drawn between lines: before document line `line`, or after it. */
  markerBetween(line: number, after: boolean): GutterMarker | null;
  /** A press on the ball beside document lines `first` to `last`, or a click with no press. */
  clicked(first: number, last: number): void;
}

/** The document lines a line block covers, first to last. */
function linesOf(view: EditorView, block: BlockInfo): { first: number; last: number } {
  const { doc } = view.state;
  return { first: doc.lineAt(block.from).number, last: doc.lineAt(block.to).number };
}

/** Whether `event` is on a marker's ball. */
function onBall(event: Event): boolean {
  return event.target instanceof Element && event.target.closest('.lo-ov-marker') !== null;
}

/** The markers' gutter, from `source`, drawn again whenever a code view's marks change. */
export function markerGutter(source: MarkerSource): Extension {
  return gutter({
    class: 'lo-ovcolumn',
    lineMarker: (view, line) => {
      if (!source.active()) return null;
      const { first, last } = linesOf(view, line);
      return source.markerAt(first, last);
    },
    widgetMarker: (view, widget, block) => {
      if (!source.active()) return null;
      if (widget instanceof CollapsedWidget) {
        const { first, last } = linesOf(view, block);
        return source.markerAt(first, last);
      }
      // A file's own blocks, in place of its lines, aren't between them.
      if (widget instanceof HeaderWidget || widget instanceof FileNoteWidget) return null;
      // A block at a line's start is drawn before it; one at its end, after it.
      const line = view.state.doc.lineAt(block.from);
      return source.markerBetween(line.number, block.from > line.from || line.from === line.to);
    },
    lineMarkerChange: (update) =>
      update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(marksChanged)),
      ),
    // The ball acts as it's pressed, in the press's own frame, so what its note moves comes with
    // the reader's input, never in a frame after it; a click then does nothing more. A click with
    // no press before it, as a screen reader's, acts the same.
    domEventHandlers: {
      // Focus stays where it is, and no text is selected.
      mousedown: (view, line, event) => {
        if (!onBall(event)) return false;
        event.preventDefault();
        if (event instanceof MouseEvent && event.button === 0) {
          const { first, last } = linesOf(view, line);
          source.clicked(first, last);
        }
        return true;
      },
      click: (view, line, event) => {
        if (!onBall(event)) return false;
        if (event instanceof MouseEvent && event.detail === 0) {
          const { first, last } = linesOf(view, line);
          source.clicked(first, last);
        }
        return true;
      },
    },
  });
}
