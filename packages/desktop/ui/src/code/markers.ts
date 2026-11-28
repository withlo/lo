// Overview notes' marks, in a lane of their own, last before the code on the side an overview
// marks, drawn as every range is (`ranges.ts`): a ball on the first row of each note's last line,
// ringed brighter while its note is open, and a stem up the lane to a tick on its first. Notes that
// end on one line share its ball, which opens them together. The lane is there from the start, as
// wide with no marks as with them, so marks that arrive later change no line's width or height,
// and nothing on screen moves. Unchanged lines collapsed into one block carry the stems that pass
// or start in them, and the ball of a note that ends among them.

import type { Extension, Text } from '@codemirror/state';
import { type EditorView, gutter } from '@codemirror/view';

import {
  defineLane,
  type LaneMark,
  type LaneRange,
  type LaneUpdate,
  laneUpdate,
  rangeUnder,
} from './ranges.ts';

/** What a ball says, as its tooltip and to a screen reader: what a click on it does. */
export const BALL_TIP = 'Show overview note';

/** The notes that end on a line, by their keys in the overview's order, and whether one is open. */
export interface NoteEnds {
  readonly keys: readonly string[];
  readonly open: boolean;
}

/** A ball as the lane's mark. */
class BallMark implements LaneMark {
  readonly keys: readonly string[];
  readonly open: boolean;

  constructor({ keys, open }: NoteEnds) {
    this.keys = keys;
    this.open = open;
  }

  same(other: LaneMark): boolean {
    return (
      other instanceof BallMark &&
      other.open === this.open &&
      other.keys.length === this.keys.length &&
      other.keys.every((key, index) => key === this.keys[index])
    );
  }

  draw(): HTMLElement {
    const ball = document.createElement('span');
    ball.className = `lo-ov-marker${this.open ? ' is-open' : ''}`;
    ball.dataset.tip = BALL_TIP;
    ball.setAttribute('aria-label', BALL_TIP);
    return ball;
  }
}

/** The overview's lane in each editor's state. A fold holds the ball of every note ending in it. */
const lane = defineLane('notes', {
  foldMark: (marks) =>
    new BallMark({
      keys: marks.flatMap((mark) => mark.keys),
      open: marks.some((mark) => mark instanceof BallMark && mark.open),
    }),
  markTarget: true,
});

/** The lane draws, in each part of the text, what each update says, as for a file's notes. */
export const setNotesLane = lane.set;

/**
 * The lane's cells for the part of `doc` from `from` to `to`, by document line: a ball on each line
 * of `ends`, and the stems of `ranges` beside each line they cover, those `lit` names lit.
 */
export function notesLaneUpdate(
  doc: Text,
  span: { readonly from: number; readonly to: number },
  ranges: readonly LaneRange[],
  ends: ReadonlyMap<number, NoteEnds>,
  lit: ReadonlySet<string>,
): LaneUpdate {
  const marks = new Map<number, LaneMark>();
  for (const [line, end] of ends) marks.set(line, new BallMark(end));
  return laneUpdate(doc, 'notes', span, ranges, marks, {
    lit,
    target: () => true,
    markTarget: true,
  });
}

/** What the overview's lane asks of its code view. */
export interface NotesSource {
  /** A press on the ball beside document lines `first` to `last`: the notes ending there open. */
  clicked(first: number, last: number): void;
  /** A press on the stem of the note `key`: it opens, or closes. */
  stem(key: string): void;
}

/** The document lines a line block covers, first to last. */
function linesOf(view: EditorView, from: number, to: number): { first: number; last: number } {
  const { doc } = view.state;
  return { first: doc.lineAt(from).number, last: doc.lineAt(to).number };
}

/** Whether `event` is on a marker's ball. */
function onBall(event: Event): boolean {
  return event.target instanceof Element && event.target.closest('.lo-ov-marker') !== null;
}

/**
 * The overview's lane, drawn from what the editor's state keeps of it (`setNotesLane`). A ball, or a
 * stem, acts as it's pressed, in the press's own frame, so what its note moves comes with the
 * reader's input, never in a frame after it; a click then does nothing more. A click on a ball with
 * no press before it, as a screen reader's, acts the same. Focus stays where it is, and no text is
 * selected.
 */
export function markerGutter(source: NotesSource): Extension {
  return [
    lane.field,
    gutter({
      class: 'lo-ovcolumn',
      markers: lane.cells,
      widgetMarker: lane.widgetMarker,
      lineMarkerChange: (update) =>
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setNotesLane)),
        ),
      domEventHandlers: {
        mousedown: (view, line, event) => {
          if (!(event instanceof MouseEvent)) return false;
          if (onBall(event)) {
            event.preventDefault();
            if (event.button === 0) {
              const { first, last } = linesOf(view, line.from, line.to);
              source.clicked(first, last);
            }
            return true;
          }
          const under = rangeUnder(event);
          if (under?.kind !== 'notes') return false;
          event.preventDefault();
          if (event.button === 0) source.stem(under.key);
          return true;
        },
        click: (view, line, event) => {
          if (!onBall(event)) return false;
          if (event instanceof MouseEvent && event.detail === 0) {
            const { first, last } = linesOf(view, line.from, line.to);
            source.clicked(first, last);
          }
          return true;
        },
      },
    }),
  ];
}
